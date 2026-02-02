#!/usr/bin/env python3
"""Generate year-specific GeoJSON files showing taxes paid per parcel."""
import json
from pathlib import Path

import pandas as pd
import shapely
import shapely.wkb
import shapely.ops
from pyproj import Transformer
from utz import err

from .paths import DATA, PARCELS

# Transform from WGS84 (lat/lon) to NJ State Plane (feet) for accurate area calculation
transformer = Transformer.from_crs("EPSG:4326", "EPSG:3424", always_xy=True)


def generate_yearly_geojson(
    year: int,
    output_dir: Path | None = None,
    aggregate: str = "lot",  # "lot" or "unit"
) -> dict:
    """
    Generate GeoJSON for a specific tax year showing payments.

    Args:
        year: Tax year to visualize
        output_dir: Output directory (default: www/public/)
        aggregate: "lot" = dissolve condo units into lots,
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

    # Load data
    err(f"Loading parcels from {PARCELS}")
    parcels = pd.read_parquet(PARCELS)

    err(f"Loading payments for year {year}")
    payments = pd.read_parquet(payments_path)
    payments = payments[payments["Year"] == year]
    err(f"  {len(payments):,} payment records for {year}")

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
    else:
        # Join on block-lot for lot-level aggregation
        parcels["join_key"] = parcels["block"].str.strip() + "-" + parcels["lot"].str.strip()
        payments["join_key"] = payments["Block"].str.strip() + "-" + payments["Lot"].str.strip()

    # Aggregate payments
    pay_agg = payments.groupby("join_key").agg({
        "Billed": "sum",
        "Paid": "sum",
    }).reset_index()
    pay_dict = pay_agg.set_index("join_key").to_dict("index")

    def clean_val(v):
        return None if pd.isna(v) else v

    features = []

    if aggregate == "unit":
        # Unit-level: one feature per parcel row with individual payments
        err("Generating unit-level features...")
        for _, row in parcels.iterrows():
            geo_shape = row.get("geo_shape")
            if pd.isna(geo_shape):
                continue

            try:
                if isinstance(geo_shape, bytes):
                    geom = shapely.wkb.loads(geo_shape)
                elif isinstance(geo_shape, str):
                    geom = shapely.geometry.shape(json.loads(geo_shape))
                else:
                    continue
                geometry = json.loads(shapely.to_geojson(geom))
                projected = shapely.ops.transform(transformer.transform, geom)
                area_sqft = projected.area
            except Exception:
                continue

            key = row["join_key"]
            pay_data = pay_dict.get(key, {})
            paid = float(pay_data.get("Paid", 0) or 0)
            billed = float(pay_data.get("Billed", 0) or 0)
            paid_per_sqft = paid / area_sqft if area_sqft > 0 else 0.0

            properties = {
                "block": str(row.get("block", "")).strip(),
                "lot": str(row.get("lot", "")).strip(),
                "qual": clean_val(row.get("qual")),
                "hadd": clean_val(row.get("hadd")),
                "hnum": clean_val(row.get("hnum")),
                "year": year,
                "paid": round(paid, 2),
                "billed": round(billed, 2),
                "area_sqft": round(area_sqft, 1),
                "paid_per_sqft": round(paid_per_sqft, 2),
            }
            features.append({"type": "Feature", "geometry": geometry, "properties": properties})
    else:
        # Lot-level: dissolve geometries by block-lot
        err("Aggregating geometries by lot...")
        lot_geoms = {}   # join_key -> list of geometries
        lot_props = {}   # join_key -> {hadd, hnum}

        for _, row in parcels.iterrows():
            geo_shape = row.get("geo_shape")
            if pd.isna(geo_shape):
                continue

            try:
                if isinstance(geo_shape, bytes):
                    geom = shapely.wkb.loads(geo_shape)
                elif isinstance(geo_shape, str):
                    geom = shapely.geometry.shape(json.loads(geo_shape))
                else:
                    continue
            except Exception:
                continue

            key = row["join_key"]
            if key not in lot_geoms:
                lot_geoms[key] = []
                lot_props[key] = {
                    "block": str(row.get("block", "")).strip(),
                    "lot": str(row.get("lot", "")).strip(),
                    "hadd": row.get("hadd"),
                    "hnum": row.get("hnum"),
                }
            lot_geoms[key].append(geom)

        err(f"Dissolving {len(lot_geoms)} lots...")
        for key, geoms in lot_geoms.items():
            try:
                if len(geoms) == 1:
                    dissolved = geoms[0]
                else:
                    dissolved = shapely.ops.unary_union(geoms)
                geometry = json.loads(shapely.to_geojson(dissolved))
                projected = shapely.ops.transform(transformer.transform, dissolved)
                area_sqft = projected.area
            except Exception:
                continue

            pay_data = pay_dict.get(key, {})
            paid = float(pay_data.get("Paid", 0) or 0)
            billed = float(pay_data.get("Billed", 0) or 0)
            paid_per_sqft = paid / area_sqft if area_sqft > 0 else 0.0

            props = lot_props[key]
            properties = {
                "block": props["block"],
                "lot": props["lot"],
                "hadd": clean_val(props.get("hadd")),
                "hnum": clean_val(props.get("hnum")),
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

    suffix = "-units" if aggregate == "unit" else ""
    output = output_dir / f"taxes-{year}{suffix}.geojson"
    with open(output, "w") as f:
        json.dump(geojson, f)
    err(f"Wrote {output} ({output.stat().st_size / 1024 / 1024:.1f} MB)")

    return geojson


if __name__ == "__main__":
    import click

    @click.command()
    @click.option("-a", "--aggregate", default="lot", type=click.Choice(["lot", "unit"]), help="Aggregation level")
    @click.option("-o", "--output-dir", type=Path, help="Output directory")
    @click.option("-y", "--year", default=2024, help="Tax year")
    def main(aggregate: str, output_dir: Path | None, year: int):
        """Generate yearly GeoJSON for tax visualization."""
        generate_yearly_geojson(year, output_dir, aggregate)

    main()
