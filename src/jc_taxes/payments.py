#!/usr/bin/env python3
"""Extract yearly payment data from cached account details."""
import json
from pathlib import Path

import pandas as pd
from utz import err

from .paths import CACHE, DATA


def extract_payments(
    cache_dir: Path = CACHE,
    output: Path | None = None,
) -> pd.DataFrame:
    """
    Extract yearly payment totals from cached JSON files.

    Returns DataFrame with columns:
        AccountNumber, Block, Lot, Qualifier, Year, Billed, Paid
    """
    if output is None:
        output = DATA / "payments.parquet"

    json_files = list(cache_dir.glob("*.json"))
    err(f"Processing {len(json_files)} cached files...")

    records = []
    for i, path in enumerate(json_files):
        if (i + 1) % 10000 == 0:
            err(f"  {i + 1}/{len(json_files)}")

        with open(path) as f:
            data = json.load(f)

        acct = data.get("accountInquiryVM", {})
        account_number = acct.get("AccountNumber")
        block = str(acct.get("Block", "")).strip()
        lot = str(acct.get("Lot", "")).strip()
        qualifier = str(acct.get("Qualifier", "")).strip()

        details = acct.get("Details", [])
        if not details:
            continue

        # Aggregate by year
        by_year: dict[int, dict] = {}
        for d in details:
            year = d.get("TaxYear")
            if not year:
                continue
            if year not in by_year:
                by_year[year] = {"billed": 0.0, "paid": 0.0}
            by_year[year]["billed"] += d.get("Billed", 0) or 0
            by_year[year]["paid"] += d.get("Paid", 0) or 0

        for year, totals in by_year.items():
            records.append({
                "AccountNumber": account_number,
                "Block": block,
                "Lot": lot,
                "Qualifier": qualifier,
                "Year": year,
                "Billed": totals["billed"],
                "Paid": abs(totals["paid"]),  # Paid is negative in source
            })

    df = pd.DataFrame(records)
    err(f"Extracted {len(df):,} year-account records")

    df.to_parquet(output, index=False)
    err(f"Wrote {output}")

    return df


if __name__ == "__main__":
    extract_payments()
