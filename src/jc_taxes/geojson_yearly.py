#!/usr/bin/env python3
"""Generate year-specific GeoJSON files showing taxes paid per parcel."""
import json
import re
from collections import defaultdict
from pathlib import Path

import pandas as pd
import shapely
import shapely.wkb
import shapely.ops
from pyproj import Transformer
from utz import err

from .paths import CACHE, DATA, PARCELS, PARCELS_COMBINED

# Transformers for different CRS scenarios
wgs84_to_njsp = Transformer.from_crs("EPSG:4326", "EPSG:3424", always_xy=True)
njsp_to_wgs84 = Transformer.from_crs("EPSG:3424", "EPSG:4326", always_xy=True)


def load_addresses(cache_dir: Path = CACHE) -> dict[str, str]:
    """Load property addresses from cached account JSON files.

    Returns:
        dict mapping "block-lot" to PropertyLocation address string
    """
    addresses = {}
    json_files = list(cache_dir.glob("*.json"))
    for path in json_files:
        try:
            with open(path) as f:
                data = json.load(f)
            acct = data.get("accountInquiryVM", {})
            block = str(acct.get("Block", "")).strip()
            lot = str(acct.get("Lot", "")).strip()
            prop_loc = acct.get("PropertyLocation", "")
            if block and lot and prop_loc:
                key = f"{block}-{lot}"
                if key not in addresses:
                    addresses[key] = prop_loc.strip()
        except Exception:
            continue
    return addresses


def normalize_street(s: str) -> str:
    """Normalize street name variants (AVENUE→AVE, STREET→ST, etc.)."""
    s = re.sub(r"\s*\(.*\)$", "", s)  # Remove parenthetical notes like (INSD)
    s = s.rstrip(".")
    s = re.sub(r"\bSTREET$", "ST", s)
    s = re.sub(r"\bAVENUE$", "AVE", s)
    s = re.sub(r"\bROAD$", "RD", s)
    s = re.sub(r"\bDRIVE$", "DR", s)
    s = re.sub(r"\bPLACE$", "PL", s)
    s = re.sub(r"\bBOULEVARD$", "BLVD", s)
    s = re.sub(r"\bLANE$", "LN", s)
    s = re.sub(r"\bCOURT$", "CT", s)
    s = re.sub(r"\bTERRACE$", "TER", s)
    return s.strip()


def summarize_block_streets(addresses: dict[str, str]) -> dict[str, str]:
    """Build a street summary per block from lot-level addresses.

    Returns:
        dict mapping block number to summary like "HOPKINS AVE 147-179 / ST PAULS AVE 144-174"
    """
    block_addrs: dict[str, list[str]] = defaultdict(list)
    for key, addr in addresses.items():
        block = key.split("-")[0]
        block_addrs[block].append(addr)

    summaries = {}
    for block, addrs in block_addrs.items():
        streets: dict[str, list[int]] = defaultdict(list)
        for addr in addrs:
            m = re.match(r"(\d+)\s+(.+)", addr)
            if m:
                num = int(m.group(1))
                street = normalize_street(m.group(2))
                streets[street].append(num)
        parts = []
        for street in sorted(streets, key=lambda s: -len(streets[s])):
            nums = sorted(streets[street])
            if nums:
                parts.append(f"{street} {min(nums)}-{max(nums)}")
            if len(parts) >= 3:
                break
        if parts:
            summaries[block] = " / ".join(parts)
    return summaries


def generate_yearly_geojson(
    year: int,
    output_dir: Path | None = None,
    aggregate: str = "lot",  # "block", "lot", or "unit"
) -> dict:
    """
    Generate GeoJSON for a specific tax year showing payments.

    Args:
        year: Tax year to visualize
        output_dir: Output directory (default: www/public/)
        aggregate: "block" = dissolve by block,
                   "lot" = dissolve condo units into lots,
                   "unit" = show individual units with their payments

    Returns:
        GeoJSON FeatureCollection dict
    """
    if output_dir is None:
        output_dir = DATA.parent / "www" / "public"
    output_dir.mkdir(parents=True, exist_ok=True)

    payments_path = DATA / "payments.parquet"
    if not payments_path.exists():
        err(f"Payments file not found: {payments_path}")
        err("Run: python -m jc_taxes.payments")
        return {}

    # Load data - prefer combined parcels if available
    parcels_path = PARCELS_COMBINED if PARCELS_COMBINED.exists() else PARCELS
    err(f"Loading parcels from {parcels_path}")
    parcels = pd.read_parquet(parcels_path)

    err(f"Loading payments for year {year}")
    payments = pd.read_parquet(payments_path)
    payments = payments[payments["Year"] == year]
    err(f"  {len(payments):,} payment records for {year}")

    # Load addresses from cached accounts
    err("Loading addresses from cache...")
    addresses = load_addresses()
    err(f"  {len(addresses):,} addresses loaded")

    # Build block-level street summaries
    block_streets = summarize_block_streets(addresses)

    # Create join keys based on aggregation level
    if aggregate == "unit":
        # Join on block-lot-qualifier for individual unit payments
        parcels["join_key"] = (
            parcels["block"].str.strip() + "-" +
            parcels["lot"].str.strip() + "-" +
            parcels["qual"].fillna("").str.strip()
        )
        payments["join_key"] = (
            payments["Block"].str.strip() + "-" +
            payments["Lot"].str.strip() + "-" +
            payments["Qualifier"].fillna("").str.strip()
        )
        # For address lookup, use block-lot key
        parcels["addr_key"] = parcels["block"].str.strip() + "-" + parcels["lot"].str.strip()
    elif aggregate == "block":
        # Join on block only for block-level aggregation
        parcels["join_key"] = parcels["block"].str.strip()
        payments["join_key"] = payments["Block"].str.strip()
        parcels["addr_key"] = parcels["join_key"]
    else:
        # Join on block-lot for lot-level aggregation
        parcels["join_key"] = parcels["block"].str.strip() + "-" + parcels["lot"].str.strip()
        payments["join_key"] = payments["Block"].str.strip() + "-" + payments["Lot"].str.strip()
        parcels["addr_key"] = parcels["join_key"]

    # Aggregate payments
    pay_agg = payments.groupby("join_key").agg({
        "Billed": "sum",
        "Paid": "sum",
    }).reset_index()
    pay_dict = pay_agg.set_index("join_key").to_dict("index")

    def clean_val(v):
        return None if pd.isna(v) else v

    def is_njsp(geom) -> bool:
        """Check if geometry is in NJ State Plane (large coordinate values)."""
        bounds = geom.bounds  # (minx, miny, maxx, maxy)
        # NJSP coordinates are typically 400k-700k for x, 0-900k for y
        # WGS84 for NJ is around -75 to -74 for x, 39-41 for y
        return bounds[0] > 1000  # Simple heuristic: x > 1000 means projected

    def get_geometry(row):
        """Extract geometry from row, handling both old and new parcel formats."""
        geom = None
        # Try 'geometry' column first (combined parcels from geopandas)
        g = row.get("geometry")
        if g is not None and not pd.isna(g):
            if isinstance(g, bytes):
                geom = shapely.wkb.loads(g)
            elif hasattr(g, 'geom_type'):  # Already a shapely object
                geom = g
        # Fall back to 'geo_shape' (old JC parcels format)
        if geom is None:
            geo_shape = row.get("geo_shape")
            if geo_shape is not None and not pd.isna(geo_shape):
                if isinstance(geo_shape, bytes):
                    geom = shapely.wkb.loads(geo_shape)
                elif isinstance(geo_shape, str):
                    geom = shapely.geometry.shape(json.loads(geo_shape))
        return geom

    def process_geometry(geom):
        """Convert geometry to WGS84 for GeoJSON and calculate area in sqft."""
        if geom is None:
            return None, None, 0.0

        if is_njsp(geom):
            # Already in NJ State Plane (feet) - area is direct, need to convert to WGS84 for GeoJSON
            area_sqft = geom.area
            geom_wgs84 = shapely.ops.transform(njsp_to_wgs84.transform, geom)
            geojson = json.loads(shapely.to_geojson(geom_wgs84))
        else:
            # In WGS84 - need to project to NJ State Plane for area
            projected = shapely.ops.transform(wgs84_to_njsp.transform, geom)
            area_sqft = projected.area
            geojson = json.loads(shapely.to_geojson(geom))

        return geojson, geom, area_sqft

    features = []

    if aggregate == "unit":
        # Unit-level: one feature per parcel row with individual payments
        err("Generating unit-level features...")
        for _, row in parcels.iterrows():
            geom = get_geometry(row)
            if geom is None:
                continue
            try:
                geometry, _, area_sqft = process_geometry(geom)
                if geometry is None:
                    continue
            except Exception:
                continue

            key = row["join_key"]
            addr_key = row["addr_key"]
            pay_data = pay_dict.get(key, {})
            paid = float(pay_data.get("Paid", 0) or 0)
            billed = float(pay_data.get("Billed", 0) or 0)
            paid_per_sqft = paid / area_sqft if area_sqft > 0 else 0.0

            properties = {
                "block": str(row.get("block", "")).strip(),
                "lot": str(row.get("lot", "")).strip(),
                "qual": clean_val(row.get("qual")),
                "addr": addresses.get(addr_key),
                "year": year,
                "paid": round(paid, 2),
                "billed": round(billed, 2),
                "area_sqft": round(area_sqft, 1),
                "paid_per_sqft": round(paid_per_sqft, 2),
            }
            features.append({"type": "Feature", "geometry": geometry, "properties": properties})
    else:
        # Lot-level or block-level: dissolve geometries
        level = "block" if aggregate == "block" else "lot"
        err(f"Aggregating geometries by {level}...")
        agg_geoms = {}   # join_key -> list of geometries
        agg_props = {}   # join_key -> {block, lot, addr_key}

        for _, row in parcels.iterrows():
            geom = get_geometry(row)
            if geom is None:
                continue

            key = row["join_key"]
            addr_key = row["addr_key"]
            if key not in agg_geoms:
                agg_geoms[key] = []
                agg_props[key] = {
                    "block": str(row.get("block", "")).strip(),
                    "lot": str(row.get("lot", "")).strip() if aggregate != "block" else None,
                    "addr_key": addr_key,
                }
            agg_geoms[key].append(geom)

        err(f"Dissolving {len(agg_geoms)} {level}s...")
        for key, geoms in agg_geoms.items():
            try:
                if len(geoms) == 1:
                    dissolved = geoms[0]
                else:
                    dissolved = shapely.ops.unary_union(geoms)
                geometry, _, area_sqft = process_geometry(dissolved)
                if geometry is None:
                    continue
            except Exception:
                continue

            pay_data = pay_dict.get(key, {})
            paid = float(pay_data.get("Paid", 0) or 0)
            billed = float(pay_data.get("Billed", 0) or 0)
            paid_per_sqft = paid / area_sqft if area_sqft > 0 else 0.0

            props = agg_props[key]
            addr_key = props["addr_key"]
            block_num = props["block"]
            properties = {
                "block": block_num,
                "lot": props["lot"],
                "addr": addresses.get(addr_key),
                "streets": block_streets.get(block_num) if aggregate == "block" else None,
                "year": year,
                "paid": round(paid, 2),
                "billed": round(billed, 2),
                "area_sqft": round(area_sqft, 1),
                "paid_per_sqft": round(paid_per_sqft, 2),
            }
            features.append({"type": "Feature", "geometry": geometry, "properties": properties})

    err(f"Generated {len(features)} features")

    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }

    suffix = {"unit": "-units", "block": "-blocks", "lot": "-lots"}.get(aggregate, "-lots")
    output = output_dir / f"taxes-{year}{suffix}.geojson"
    with open(output, "w") as f:
        json.dump(geojson, f)
    err(f"Wrote {output} ({output.stat().st_size / 1024 / 1024:.1f} MB)")

    return geojson


if __name__ == "__main__":
    import click

    @click.command()
    @click.option("-a", "--aggregate", default="lot", type=click.Choice(["block", "lot", "unit"]), help="Aggregation level")
    @click.option("-o", "--output-dir", type=Path, help="Output directory")
    @click.option("-y", "--year", default=2024, help="Tax year")
    def main(aggregate: str, output_dir: Path | None, year: int):
        """Generate yearly GeoJSON for tax visualization."""
        generate_yearly_geojson(year, output_dir, aggregate)

    main()
