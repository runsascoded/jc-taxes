"""Path definitions for jc-taxes project."""
from pathlib import Path

# Project root (relative to this file)
ROOT = Path(__file__).parent.parent.parent

# Data directory
DATA = ROOT / "data"

# Cache for raw JSON API responses
CACHE = DATA / "cache"

# Parcel data from JC Open Data
PARCELS = DATA / "jc_parcels.parquet"

# Account index (built by enumerate-accounts)
ACCOUNTS_INDEX = DATA / "accounts_index.parquet"

# Exported tax data
TAXES = DATA / "taxes.parquet"


def ensure_dirs():
    """Create required directories if they don't exist."""
    CACHE.mkdir(parents=True, exist_ok=True)
