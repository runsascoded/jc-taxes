#!/usr/bin/env python3
"""Generate year-specific GeoJSON files showing taxes paid per parcel."""
import json
import re
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import pandas as pd
import shapely
import shapely.wkb
import shapely.ops
from pyproj import Transformer
from utz import err

from .census import load_jc_census_blocks, load_jc_wards
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


AGGREGATE_CHOICES = ["block", "census-block", "lot", "unit", "ward"]
SUFFIX_MAP = {
    "unit": "-units",
    "block": "-blocks",
    "lot": "-lots",
    "census-block": "-census-blocks",
    "ward": "-wards",
}


def generate_yearly_geojson(
    year: int,
    output_dir: Path | None = None,
    aggregate: str = "lot",
) -> dict:
    """
    Generate GeoJSON for a specific tax year showing payments.

    Args:
        year: Tax year to visualize
        output_dir: Output directory (default: www/public/)
        aggregate: "block", "census-block", "lot", "unit", or "ward"

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

    # Census-block and ward aggregation: area-weighted lot → census block allocation
    if aggregate in ("census-block", "ward"):
        return _generate_census_geojson(
            year=year,
            aggregate=aggregate,
            parcels=parcels,
            payments=payments,
            output_dir=output_dir,
        )

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

    suffix = SUFFIX_MAP.get(aggregate, "-lots")
    output = output_dir / f"taxes-{year}{suffix}.geojson"
    with open(output, "w") as f:
        json.dump(geojson, f)
    err(f"Wrote {output} ({output.stat().st_size / 1024 / 1024:.1f} MB)")

    return geojson


def _build_lot_gdf(parcels: pd.DataFrame, payments: pd.DataFrame) -> gpd.GeoDataFrame:
    """Build lot-level GeoDataFrame in WGS84 with aggregated payments.

    Dissolves condo units into lots, converts all geometries to WGS84.
    Returns GeoDataFrame with columns: join_key, paid, billed, geometry (WGS84)
    """
    # Lot-level join key
    parcels = parcels.copy()
    parcels["join_key"] = parcels["block"].str.strip() + "-" + parcels["lot"].str.strip()
    payments = payments.copy()
    payments["join_key"] = payments["Block"].str.strip() + "-" + payments["Lot"].str.strip()

    pay_agg = payments.groupby("join_key").agg({"Billed": "sum", "Paid": "sum"}).reset_index()
    pay_dict = pay_agg.set_index("join_key").to_dict("index")

    # Collect geometries per lot, dissolve, convert to WGS84
    lot_geoms: dict[str, list] = defaultdict(list)
    for _, row in parcels.iterrows():
        geom = None
        g = row.get("geometry")
        if g is not None and not pd.isna(g):
            if isinstance(g, bytes):
                geom = shapely.wkb.loads(g)
            elif hasattr(g, "geom_type"):
                geom = g
        if geom is None:
            geo_shape = row.get("geo_shape")
            if geo_shape is not None and not pd.isna(geo_shape):
                if isinstance(geo_shape, bytes):
                    geom = shapely.wkb.loads(geo_shape)
                elif isinstance(geo_shape, str):
                    geom = shapely.geometry.shape(json.loads(geo_shape))
        if geom is not None:
            lot_geoms[row["join_key"]].append(geom)

    rows = []
    for key, geoms in lot_geoms.items():
        try:
            dissolved = geoms[0] if len(geoms) == 1 else shapely.ops.unary_union(geoms)
            # Convert NJSP → WGS84 if needed
            if dissolved.bounds[0] > 1000:
                dissolved = shapely.ops.transform(njsp_to_wgs84.transform, dissolved)
            pay = pay_dict.get(key, {})
            rows.append({
                "join_key": key,
                "paid": float(pay.get("Paid", 0) or 0),
                "billed": float(pay.get("Billed", 0) or 0),
                "geometry": dissolved,
            })
        except Exception:
            continue

    gdf = gpd.GeoDataFrame(rows, crs="EPSG:4326")
    err(f"Built {len(gdf)} lot geometries in WGS84")
    return gdf


def _generate_census_geojson(
    year: int,
    aggregate: str,
    parcels: pd.DataFrame,
    payments: pd.DataFrame,
    output_dir: Path,
) -> dict:
    """Generate census-block or ward level GeoJSON via area-weighted allocation."""
    lot_gdf = _build_lot_gdf(parcels, payments)
    cb_gdf = load_jc_census_blocks()

    # Project to NJSP for accurate area computation
    lot_proj = lot_gdf.to_crs("EPSG:3424")
    cb_proj = cb_gdf.to_crs("EPSG:3424")

    lot_proj["lot_area"] = lot_proj.geometry.area

    err("Computing lot × census-block overlay...")
    overlay = gpd.overlay(lot_proj, cb_proj, how="intersection")
    overlay["intersection_area"] = overlay.geometry.area
    overlay["weight"] = overlay["intersection_area"] / overlay["lot_area"]
    overlay["w_paid"] = overlay["paid"] * overlay["weight"]
    overlay["w_billed"] = overlay["billed"] * overlay["weight"]

    err(f"  {len(overlay)} intersection fragments from {len(lot_proj)} lots × {len(cb_proj)} census blocks")

    # Aggregate to census-block level
    cb_agg = overlay.groupby("GEOID").agg({
        "w_paid": "sum",
        "w_billed": "sum",
    }).rename(columns={"w_paid": "paid", "w_billed": "billed"})

    # Merge back census block attributes and geometry (WGS84)
    cb_result = cb_gdf.set_index("GEOID").join(cb_agg, how="left").reset_index()
    cb_result["paid"] = cb_result["paid"].fillna(0)
    cb_result["billed"] = cb_result["billed"].fillna(0)

    # Compute area in sqft (project to NJSP)
    cb_result_proj = cb_result.set_geometry("geometry").to_crs("EPSG:3424")
    cb_result["area_sqft"] = cb_result_proj.geometry.area

    cb_result["paid_per_sqft"] = cb_result.apply(
        lambda r: r["paid"] / r["area_sqft"] if r["area_sqft"] > 0 else 0, axis=1
    )
    cb_result["paid_per_capita"] = cb_result.apply(
        lambda r: r["paid"] / r["POP100"] if r["POP100"] > 0 else None, axis=1
    )

    if aggregate == "ward":
        return _aggregate_to_wards(year, cb_result, output_dir)

    # census-block output
    features = []
    for _, row in cb_result.iterrows():
        geojson_geom = json.loads(shapely.to_geojson(row.geometry))
        props = {
            "geoid": row["GEOID"],
            "ward": row["ward"],
            "year": year,
            "paid": round(row["paid"], 2),
            "billed": round(row["billed"], 2),
            "area_sqft": round(row["area_sqft"], 1),
            "paid_per_sqft": round(row["paid_per_sqft"], 2),
            "population": int(row["POP100"]),
            "paid_per_capita": round(row["paid_per_capita"], 2) if pd.notna(row["paid_per_capita"]) else None,
        }
        features.append({"type": "Feature", "geometry": geojson_geom, "properties": props})

    err(f"Generated {len(features)} census-block features")
    return _write_geojson(features, year, "census-block", output_dir)


def _aggregate_to_wards(
    year: int,
    cb_result: gpd.GeoDataFrame,
    output_dir: Path,
) -> dict:
    """Aggregate census-block results to ward level."""
    wards_gdf = load_jc_wards()

    ward_agg = cb_result.groupby("ward").agg({
        "paid": "sum",
        "billed": "sum",
        "POP100": "sum",
        "area_sqft": "sum",
    }).rename(columns={"POP100": "population"})

    ward_result = wards_gdf.set_index("ward").join(ward_agg, how="left").reset_index()
    ward_result["paid"] = ward_result["paid"].fillna(0)
    ward_result["billed"] = ward_result["billed"].fillna(0)
    ward_result["population"] = ward_result["population"].fillna(0).astype(int)
    ward_result["area_sqft"] = ward_result["area_sqft"].fillna(0)

    ward_result["paid_per_sqft"] = ward_result.apply(
        lambda r: r["paid"] / r["area_sqft"] if r["area_sqft"] > 0 else 0, axis=1
    )
    ward_result["paid_per_capita"] = ward_result.apply(
        lambda r: r["paid"] / r["population"] if r["population"] > 0 else None, axis=1
    )

    features = []
    for _, row in ward_result.iterrows():
        geojson_geom = json.loads(shapely.to_geojson(row.geometry))
        props = {
            "ward": row["ward"],
            "council_person": row["council_person"],
            "year": year,
            "paid": round(row["paid"], 2),
            "billed": round(row["billed"], 2),
            "area_sqft": round(row["area_sqft"], 1),
            "paid_per_sqft": round(row["paid_per_sqft"], 2),
            "population": int(row["population"]),
            "paid_per_capita": round(row["paid_per_capita"], 2) if pd.notna(row["paid_per_capita"]) else None,
        }
        features.append({"type": "Feature", "geometry": geojson_geom, "properties": props})

    err(f"Generated {len(features)} ward features")
    return _write_geojson(features, year, "ward", output_dir)


def _write_geojson(features: list, year: int, aggregate: str, output_dir: Path) -> dict:
    """Write GeoJSON FeatureCollection to disk."""
    geojson = {"type": "FeatureCollection", "features": features}
    suffix = SUFFIX_MAP.get(aggregate, "-lots")
    output = output_dir / f"taxes-{year}{suffix}.geojson"
    with open(output, "w") as f:
        json.dump(geojson, f)
    err(f"Wrote {output} ({output.stat().st_size / 1024 / 1024:.1f} MB)")
    return geojson


if __name__ == "__main__":
    import click

    @click.command()
    @click.option("-a", "--aggregate", default="lot", type=click.Choice(AGGREGATE_CHOICES), help="Aggregation level")
    @click.option("-o", "--output-dir", type=Path, help="Output directory")
    @click.option("-y", "--year", default=2024, help="Tax year")
    def main(aggregate: str, output_dir: Path | None, year: int):
        """Generate yearly GeoJSON for tax visualization."""
        generate_yearly_geojson(year, output_dir, aggregate)

    main()
