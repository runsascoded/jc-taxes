"""Parse encoded building descriptions into structured fields.

Building Desc values use a dash-separated encoding like "2S-F-D-2U-H":
  {N}S = stories, {N}U = units, {N}P = parking, G{N} = garages,
  F = frame, B = brick, BF/B+F = brick+frame, CB = cinder block, RC = reinforced concrete,
  BT = basement, D = dry interior, H = heated, NH = non-headed, C = condo/commercial.

Special values (not dash-encoded): VACANT LAND, COMMON AREA, CONDOMINIUM, etc.
"""
import re


SPECIAL_CATEGORIES = {
    "VACANT LAND": "vacant",
    "COMMON AREA": "common",
    "CONDOMINIUM": "condo",
    "PARKING UNIT": "parking",
    "PARKING LOT": "parking",
    "GCONDO": "condo",
}

# Regexes applied per dash-separated token
STORIES_RE = re.compile(r"^(\d+\.?\d*)S")
UNITS_RE = re.compile(r"^(\d+)U")
PARKING_RE = re.compile(r"(\d+)P$")
GARAGES_RE = re.compile(r"^G(\d*)$")

# Construction patterns to check per token (longer first)
CONSTRUCTION_MAP = {
    "B+F": "brick+frame",
    "BF": "brick+frame",
    "B&F": "brick+frame",
    "RC": "reinforced_concrete",
    "CB": "cinder_block",
}


def parse_building_desc(desc: str | None) -> dict:
    """Parse encoded building description into structured fields.

    Returns dict with keys: stories, units, construction, basement,
    heated, garages, parking, category. Missing fields → None.
    """
    result = {
        "stories": None,
        "units": None,
        "construction": None,
        "basement": None,
        "heated": None,
        "garages": None,
        "parking": None,
        "category": None,
    }

    if not desc or not desc.strip():
        return result

    desc = desc.strip().upper()

    # Check special categories first
    for pattern, cat in SPECIAL_CATEGORIES.items():
        if desc == pattern:
            result["category"] = cat
            return result

    # Check for CONDO/GCONDO suffix → category
    if "CONDO" in desc:
        result["category"] = "condo"

    # Split on dashes; each token is parsed independently
    tokens = desc.split("-")

    for tok in tokens:
        tok = tok.strip().rstrip(".")
        if not tok:
            continue

        # Stories: {N}S or {N}.{N}S (may have trailing chars like "2SFD2UH")
        m = STORIES_RE.search(tok)
        if m and result["stories"] is None:
            result["stories"] = float(m.group(1))
            # After extracting stories, check remainder for squished fields
            remainder = tok[m.end():]
            _parse_squished(remainder, result)
            continue

        # Units: {N}U (may appear as "2U", "2UH", "2UHBG3")
        m = UNITS_RE.search(tok)
        if m and result["units"] is None:
            result["units"] = int(m.group(1))
            remainder = tok[m.end():]
            _parse_squished(remainder, result)
            continue

        # Parking: {N}P
        m = PARKING_RE.search(tok)
        if m and result["parking"] is None:
            result["parking"] = int(m.group(1))
            continue

        # Garages: G or G{N}
        m = GARAGES_RE.match(tok)
        if m and result["garages"] is None:
            g_str = m.group(1)
            result["garages"] = int(g_str) if g_str else 1
            continue

        # Construction types (multi-char)
        for pat, cons_type in CONSTRUCTION_MAP.items():
            if tok == pat or tok.startswith(pat) or pat in tok:
                if result["construction"] is None:
                    result["construction"] = cons_type
                break

        # Single-char tokens
        if tok == "BT":
            result["basement"] = True
        elif tok == "NH":
            result["heated"] = False
        elif tok == "H" and result["heated"] is None:
            result["heated"] = True
        elif tok == "B" and result["construction"] is None:
            result["construction"] = "brick"
        elif tok == "F" and result["construction"] is None:
            result["construction"] = "frame"

    return result


def _parse_squished(s: str, result: dict):
    """Parse squished suffix like "FD2UH" or "HBG3" after stories/units extraction."""
    if not s:
        return

    # Construction
    for pat, cons_type in CONSTRUCTION_MAP.items():
        if pat in s and result["construction"] is None:
            result["construction"] = cons_type
            break
    if result["construction"] is None:
        if "F" in s:
            result["construction"] = "frame"
        elif "B" in s and "BT" not in s:
            result["construction"] = "brick"

    # Basement
    if "BT" in s:
        result["basement"] = True

    # Heated
    if "NH" in s:
        result["heated"] = False
    elif "H" in s and result["heated"] is None:
        result["heated"] = True

    # Garages in suffix: G or G{N}
    m = re.search(r"G(\d*)", s)
    if m and result["garages"] is None:
        g_str = m.group(1)
        result["garages"] = int(g_str) if g_str else 1

    # Units in suffix
    m = re.search(r"(\d+)U", s)
    if m and result["units"] is None:
        result["units"] = int(m.group(1))
