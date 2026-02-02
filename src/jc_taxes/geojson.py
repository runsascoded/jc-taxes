#!/usr/bin/env python3
"""Generate GeoJSON from parcels + tax data for visualization."""
import json
import sys
from pathlib import Path

import pandas as pd
from utz import err

from .paths import DATA, PARCELS, TAXES


def generate_geojson(
    output: Path | None = None,
    limit: int = 0,
) -> dict:
    """
    Join parcels geometry with tax data and output GeoJSON.

    Args:
        output: Output path (default: www/public/parcels.geojson)
        limit: Limit number of features (0 = all)

    Returns:
        GeoJSON FeatureCollection dict
    """
    if output is None:
        output = DATA.parent / "www" / "public" / "parcels.geojson"

    # Load data
    err(f"Loading parcels from {PARCELS}")
    parcels = pd.read_parquet(PARCELS)

    if TAXES.exists():
        err(f"Loading taxes from {TAXES}")
        taxes = pd.read_parquet(TAXES)

        # Create join keys
        parcels['join_key'] = parcels['block'].str.strip() + '-' + parcels['lot'].str.strip()
        taxes['join_key'] = taxes['Block'].str.strip() + '-' + taxes['Lot'].str.strip()

        # Aggregate taxes by block-lot (sum for multi-unit buildings)
        tax_agg = taxes.groupby('join_key').agg({
            'NetTaxable': 'sum',
            'TotalDue': 'sum',
            'Land': 'sum',
            'Improvement': 'sum',
            'OwnerName': 'first',
            'Address': 'first',
        }).reset_index()

        err(f"Joining {len(parcels)} parcels with {len(tax_agg)} tax records")
        parcels = parcels.merge(tax_agg, on='join_key', how='left')
    else:
        err(f"No tax data found at {TAXES}, using parcels only")

    # Parse geometry
    err("Parsing geometry...")
    features = []
    for _, row in parcels.iterrows():
        geo_shape = row.get('geo_shape')
        if pd.isna(geo_shape):
            continue

        # Parse WKB or GeoJSON geometry
        try:
            if isinstance(geo_shape, bytes):
                import shapely.wkb
                geom = shapely.wkb.loads(geo_shape)
                geometry = json.loads(shapely.to_geojson(geom))
            elif isinstance(geo_shape, str):
                geometry = json.loads(geo_shape)
            else:
                continue
        except Exception:
            continue

        def clean_val(v):
            """Convert pandas NaN to None for JSON serialization."""
            return None if pd.isna(v) else v

        properties = {
            'block': clean_val(row.get('block')),
            'lot': clean_val(row.get('lot')),
            'qual': clean_val(row.get('qual')),
            'hadd': clean_val(row.get('hadd')),
            'hnum': clean_val(row.get('hnum')),
        }

        # Add tax data if available
        if 'NetTaxable' in row and pd.notna(row['NetTaxable']):
            properties.update({
                'NetTaxable': float(row['NetTaxable']),
                'TotalDue': float(row.get('TotalDue', 0) or 0),
                'Land': float(row.get('Land', 0) or 0),
                'Improvement': float(row.get('Improvement', 0) or 0),
                'OwnerName': clean_val(row.get('OwnerName')),
                'Address': clean_val(row.get('Address')),
            })

        features.append({
            'type': 'Feature',
            'geometry': geometry,
            'properties': properties,
        })

        if limit and len(features) >= limit:
            break

    err(f"Generated {len(features)} features")

    geojson = {
        'type': 'FeatureCollection',
        'features': features,
    }

    # Write output
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, 'w') as f:
        json.dump(geojson, f)
    err(f"Wrote {output} ({output.stat().st_size / 1024 / 1024:.1f} MB)")

    return geojson


if __name__ == '__main__':
    import click

    @click.command()
    @click.option('-o', '--output', type=Path, help='Output path')
    @click.option('-l', '--limit', default=0, help='Limit features (0=all)')
    def main(output: Path | None, limit: int):
        """Generate GeoJSON for web visualization."""
        generate_geojson(output, limit)

    main()
