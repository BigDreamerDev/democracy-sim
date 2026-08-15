#!/usr/bin/env python3
"""Generate the docs/subdiv/ subdivision map from geoBoundaries ADM1 geometry.

The browser never downloads GIS data. This script is run by the developer and
writes ordinary precomputed SVG path strings, matching the existing world-map.js
architecture.

Usage from the repository root:
    python tools/generate-world-subdivisions.py
    python tools/generate-world-subdivisions.py --from-existing

Two things about the output are deliberate and load-bearing.

IDENTITY IS NOT IN THE KEY. The browser gets `s0001`, never `AE-AJ`. An ISO
3166-2 code names a real place all by itself, so a file keyed by ISO codes hands
any player who opens the console the entire real-world mapping — no name table
required. That breaks the same invariant `TERRITORY_NAMES` exists to protect.
The ISO codes stay in `server/subdivision-codes.json`, which the server reads
and never serves; the only route that will say `AE-AJ` out loud is behind the
Returning Officer's admin guard. Assignment is append-only: an id, once given
out, is what the database stores, so this file is read before it is written and
existing pairs are never renumbered.

NOTHING LOADS THE WHOLE WORLD. One file per parent territory, and each territory
twice: a coarse pass for the world view and a detail pass for the one country
somebody is actually looking at. 2,576 shapes in a 1000x500 viewBox is a mesh,
not a map, and it used to be a 2.9 MB blocking script on every page load.

The script reads server/subdivisions.json so the geometry lines up exactly with
the subdivisions the Returning Officer territory editor offers. It uses
geoBoundaries gbOpen ADM1 simplified GeoJSON and matches features first by
shapeISO, then by normalized subdivision name. Downloads are cached under
.tools-cache/world-subdivisions/ so reruns do not redownload unchanged files.

`--from-existing` rebuilds the docs/subdiv/ layout from a previously generated
docs/world-subdivisions.js instead of the network. It exists so the split and
the renumbering can be redone from geometry this script already produced,
without a fresh 168-country download.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import difflib
import json
import math
import re
import statistics
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUBDIVISIONS_FILE = ROOT / "server" / "subdivisions.json"
ALPHA_MAP_FILE = ROOT / "tools" / "iso-alpha2-alpha3.json"
WORLD_MAP_FILE = ROOT / "docs" / "world-map.js"
IDS_FILE = ROOT / "server" / "subdivision-codes.json"
OUTPUT_DIR = ROOT / "docs" / "subdiv"
LEGACY_OUTPUT_FILE = ROOT / "docs" / "world-subdivisions.js"
CACHE_DIR = ROOT / ".tools-cache" / "world-subdivisions"

API = "https://www.geoboundaries.org/api/current/gbOpen/{alpha3}/{level}/"
USER_AGENT = "democracy-sim subdivision map generator/1.0"
ROUND = 1
DETAIL_TOLERANCE_PX = 0.20
COARSE_TOLERANCE_PX = 1.10
MAX_WORKERS = 8
MIN_CALIBRATION_SIZE_PX = 5.0

CREDIT = "geoBoundaries gbOpen ADM1 (CC BY 4.0)"

NE_ADMIN1_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson"
NE_ADMIN1_CACHE = "ne_10m_admin_1.geojson"
NE_CREDIT = "Natural Earth 10m admin-1 (public domain)"

# A handful of ISO 3166-2 entries carry an official name in a regional
# language the source only ever writes in the national language, or the
# reverse — Spain's Basque Country, Navarre and Valencian Community. Word-order
# and substring matching cannot bridge two different languages for a handful
# of entries, so these are named explicitly. Each pair is a real, permanent
# translation, not a guess, and is only consulted as one more name a feature
# is allowed to match under — it still has to be the single candidate left.
NAME_ALIASES = {
    "ES-PV": ["País Vasco/Euskadi"],
    "ES-NC": ["Comunidad Foral de Navarra"],
    "ES-VC": ["Comunitat Valenciana"],
}

# Some ISO 3166-2 subdivisions are, in geoBoundaries, entire separate
# countries: France's and the Netherlands' overseas territories have their own
# alpha-3 and their own ADM0 boundary, so metropolitan France's or the
# Netherlands' ADM1 file was never going to contain them no matter how the
# names are compared. Where geoBoundaries hosts that alpha-3 at gbOpen, its
# whole-country ADM0 shape stands in for the subdivision. Verified present via
# the gbOpen API before being listed here; a code not listed either has no
# ADM0 entry at gbOpen (Saint Pierre and Miquelon, Saint Martin, the French
# Southern Territories, Sint Maarten, uninhabited Clipperton) or is resolved
# some other way.
TERRITORY_ADM0 = {
    "FR-971": "GLP",  # Guadeloupe
    "FR-972": "MTQ",  # Martinique
    "FR-973": "GUF",  # French Guiana
    "FR-974": "REU",  # Réunion
    "FR-976": "MYT",  # Mayotte
    "FR-PF": "PYF",  # French Polynesia
    "FR-NC": "NCL",  # New Caledonia
    "FR-WF": "WLF",  # Wallis and Futuna
    "FR-BL": "BLM",  # Saint Barthélemy
    "NL-AW": "ABW",  # Aruba
    "NL-CW": "CUW",  # Curaçao
}


def fetch_json(url: str, retries: int = 3):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                return json.load(response)
        except Exception as exc:  # network errors vary by platform
            last = exc
            if attempt + 1 < retries:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Could not download {url}: {last}")


def fix_mojibake(value: str) -> str:
    """Undo a UTF-8-decoded-as-Latin-1-then-re-encoded round trip.

    geoBoundaries' Chile file ships shapeName values like "RegiÃ³n de
    Antofagasta" instead of "Región de Antofagasta" — the bytes are fine, the
    file was written after decoding UTF-8 as Latin-1 once too many. Detect the
    telltale byte sequences before "fixing" text that was never broken; a name
    with no such sequence is returned untouched."""
    if not value or ("Ã" not in value and "Â" not in value and "â€" not in value):
        return value
    try:
        repaired = value.encode("latin1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value
    return repaired


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", fix_mojibake(value or ""))
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "", value.casefold())


def normalize_tokens(value: str) -> str:
    """Same as normalize(), but order-independent: words sorted before joining.

    Catches official ISO names written "Comma, Inverted de" for alphabetical
    sorting — "Asturias, Principado de" vs the source's "Principado de
    Asturias" — without a hand-maintained list of every language's word
    order conventions."""
    value = unicodedata.normalize("NFKD", fix_mojibake(value or ""))
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    words = re.findall(r"[a-z0-9]+", value.casefold())
    return "".join(sorted(words))


def country_alpha(expected, alpha_map):
    """(alpha2, alpha3) for a country's subdivision list, however its codes
    are prefixed.

    Normally the prefix before the first "-" in a subdivision code is the
    real ISO alpha-2 ("AZ-NX" -> "AZ"), and alpha_map (alpha2 -> alpha3) gives
    the rest. But `adopt_source_regions` permanently rewrites a country's
    codes to "{alpha3}-SRC01" once its ISO list matches nothing — Azerbaijan's
    entries read "AZE-SRC01" from then on. A later run that re-derives alpha2
    the naive way gets "AZE", which is not a key in alpha_map, so the country
    silently drops out of every job list. Checking both directions of
    alpha_map keeps an already-adopted country resolvable forever after."""
    if not expected:
        return None, None
    prefix = expected[0]["code"].split("-", 1)[0]
    if prefix in alpha_map:
        return prefix, alpha_map[prefix]
    reverse = {v: k for k, v in alpha_map.items()}
    if prefix in reverse:
        return reverse[prefix], prefix
    return prefix, None


def parse_world_map():
    text = WORLD_MAP_FILE.read_text(encoding="utf-8")
    match = re.search(r"window\.WORLD_MAP\s*=\s*(\{.*?\});\s*window\.TERRITORY_NAMES", text, re.S)
    if not match:
        raise RuntimeError("Could not parse window.WORLD_MAP from docs/world-map.js")
    return json.loads(match.group(1))


def svg_bbox(path: str):
    nums = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", path)]
    points = list(zip(nums[0::2], nums[1::2]))
    if not points:
        raise ValueError("SVG path has no coordinates")
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def natural_earth_raw(lon: float, lat: float):
    """d3-geo Natural Earth 1 raw projection formula (before scale/translate)."""
    lam = math.radians(lon)
    phi = math.radians(lat)
    phi2 = phi * phi
    phi4 = phi2 * phi2
    x = lam * (
        0.8707
        - 0.131979 * phi2
        + phi4 * (-0.013791 + phi4 * (0.003971 * phi2 - 0.001529 * phi4))
    )
    y = phi * (
        1.007226
        + phi2 * (0.015085 + phi4 * (-0.044475 + 0.028874 * phi2 - 0.005916 * phi4))
    )
    return x, -y  # SVG y grows downward


def geometry_rings(geometry):
    if not geometry:
        return []
    typ = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if typ == "Polygon":
        return coords
    if typ == "MultiPolygon":
        return [ring for polygon in coords for ring in polygon]
    return []


def projected_rings(feature):
    """Project lon/lat with the same Natural Earth raw formula as world-map.js.

    Crucially, this does *not* fit or stretch a feature to its parent country.
    Every subdivision is projected in one global coordinate system, so borders
    in neighbouring subdivisions remain geographically consistent.
    """
    out = []
    for ring in geometry_rings(feature.get("geometry")):
        points = []
        longitudes = [float(coord[0]) for coord in ring if len(coord) >= 2]
        # A single ring spanning the anti-meridian needs d3's spherical clipper
        # to be perfect. Skipping such a ring is safer than drawing a line right
        # across the world; ordinary multipart countries are unaffected because
        # their individual rings stay local.
        if longitudes and max(longitudes) - min(longitudes) > 180:
            continue
        for coord in ring:
            if len(coord) < 2:
                continue
            lon, lat = float(coord[0]), float(coord[1])
            points.append(natural_earth_raw(lon, lat))
        if len(points) >= 3:
            out.append(points)
    return out


def perpendicular_distance(p, a, b):
    if a == b:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    qx, qy = a[0] + t * dx, a[1] + t * dy
    return math.hypot(p[0] - qx, p[1] - qy)


def simplify(points, tolerance):
    if len(points) <= 4:
        return points
    closed = points[0] == points[-1]
    work = points[:-1] if closed else points[:]
    if len(work) <= 3:
        return points

    def dp(seq):
        if len(seq) <= 2:
            return seq
        a, b = seq[0], seq[-1]
        best_i, best_d = 0, 0.0
        for i in range(1, len(seq) - 1):
            d = perpendicular_distance(seq[i], a, b)
            if d > best_d:
                best_i, best_d = i, d
        if best_d > tolerance:
            left = dp(seq[: best_i + 1])
            right = dp(seq[best_i:])
            return left[:-1] + right
        return [a, b]

    result = dp(work)
    if closed and result and result[0] != result[-1]:
        result.append(result[0])
    return result


def fmt(n: float):
    value = round(n, ROUND)
    if value == 0:
        value = 0.0
    return f"{value:.{ROUND}f}".rstrip("0").rstrip(".")


def ring_extent(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return max(xs) - min(xs), max(ys) - min(ys)


def path_from_rings(rings, tolerance, drop_below_px=0.0):
    """One SVG path for a subdivision, simplified to `tolerance`.

    At coarse tolerance most island rings are smaller than a pixel and only cost
    bytes, so they are dropped — but never all of them. A subdivision that
    vanishes entirely at world scale is a holding the map cannot show, which is
    worse than a slightly wrong one, so the largest ring is always kept.
    """
    kept = []
    for ring in rings:
        pts = simplify(ring, tolerance)
        if len(pts) < 3:
            continue
        if drop_below_px:
            w, h = ring_extent(pts)
            if w < drop_below_px and h < drop_below_px:
                continue
        kept.append(pts)
    if not kept and rings:
        biggest = max(rings, key=lambda r: max(ring_extent(r), default=0))
        pts = simplify(biggest, tolerance)
        if len(pts) >= 3:
            kept.append(pts)
    return "".join("M" + "L".join(f"{fmt(x)},{fmt(y)}" for x, y in ring) + "Z" for ring in kept)


def parse_path(d: str):
    """Rings back out of one of our own generated `M x,y L x,y … Z` paths."""
    rings = []
    for chunk in d.split("M"):
        chunk = chunk.strip().rstrip("Z")
        if not chunk:
            continue
        points = []
        for pair in chunk.split("L"):
            pair = pair.strip()
            if not pair:
                continue
            x, _, y = pair.partition(",")
            try:
                points.append((float(x), float(y)))
            except ValueError:
                continue
        if len(points) >= 3:
            rings.append(points)
    return rings


def transform_rings(rings, scale, translate_x, translate_y):
    return [[(translate_x + x * scale, translate_y + y * scale) for x, y in ring] for ring in rings]


def projected_bbox(features):
    points = []
    for feature in features:
        for ring in projected_rings(feature):
            points.extend(ring)
    if not points:
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def calibrate_projection(downloaded, target_boxes):
    """Infer the scale/translation used by the existing country map.

    world-map.js was generated with d3's Natural Earth projection, but the old
    generator did not retain its scale/translate settings. We recover them from
    many countries at once. Using medians makes the fit robust to differences
    between Natural Earth coastlines and geoBoundaries coastlines/remote islands.

    This is intentionally one GLOBAL transform. A per-country fit is what caused
    subdivisions to look stretched and misaligned.
    """
    samples = []
    for country, data in downloaded.items():
        target = target_boxes.get(country)
        features = (data or {}).get("features") or []
        if not target or not features:
            continue
        source = projected_bbox(features)
        if not source:
            continue
        sx0, sy0, sx1, sy1 = source
        tx0, ty0, tx1, ty1 = target
        sw, sh = sx1 - sx0, sy1 - sy0
        tw, th = tx1 - tx0, ty1 - ty0
        if sw <= 0 or sh <= 0 or tw < MIN_CALIBRATION_SIZE_PX or th < MIN_CALIBRATION_SIZE_PX:
            continue
        rx, ry = tw / sw, th / sh
        # Very different source/target extents usually mean one dataset includes
        # a remote dependency/island the other omits. Do not let it skew the map.
        if rx <= 0 or ry <= 0 or max(rx, ry) / min(rx, ry) > 1.35:
            continue
        samples.append((country, source, target, rx, ry))

    if len(samples) < 8:
        raise RuntimeError("Not enough countries to calibrate the Natural Earth projection")

    ratio_seed = statistics.median([r for *_, rx, ry in samples for r in (rx, ry)])
    # Keep the central 70% by scale agreement; this discards dataset-extent
    # mismatches without hand-maintaining a country exception list.
    ranked = sorted(samples, key=lambda row: abs(((row[3] + row[4]) / 2) - ratio_seed))
    keep = ranked[: max(8, int(len(ranked) * 0.70))]
    scale = statistics.median([r for *_, rx, ry in keep for r in (rx, ry)])

    x_offsets, y_offsets = [], []
    residual_rows = []
    for country, source, target, rx, ry in keep:
        sx0, sy0, sx1, sy1 = source
        tx0, ty0, tx1, ty1 = target
        scx, scy = (sx0 + sx1) / 2, (sy0 + sy1) / 2
        tcx, tcy = (tx0 + tx1) / 2, (ty0 + ty1) / 2
        x_offsets.append(tcx - scx * scale)
        y_offsets.append(tcy - scy * scale)
    translate_x = statistics.median(x_offsets)
    translate_y = statistics.median(y_offsets)

    for country, source, target, rx, ry in keep:
        sx0, sy0, sx1, sy1 = source
        tx0, ty0, tx1, ty1 = target
        pred = (
            translate_x + sx0 * scale, translate_y + sy0 * scale,
            translate_x + sx1 * scale, translate_y + sy1 * scale,
        )
        residual = max(abs(pred[i] - target[i]) for i in range(4))
        residual_rows.append((residual, country))

    median_residual = statistics.median(r for r, _ in residual_rows)
    p90_index = min(len(residual_rows) - 1, int(len(residual_rows) * 0.90))
    p90_residual = sorted(r for r, _ in residual_rows)[p90_index]
    return scale, translate_x, translate_y, median_residual, p90_residual, len(keep)


def download_boundary(alpha3: str, level: str = "ADM1"):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = CACHE_DIR / f"{alpha3}-{level}-simplified.geojson"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    metadata = fetch_json(API.format(alpha3=alpha3, level=level))
    url = metadata.get("simplifiedGeometryGeoJSON") or metadata.get("gjDownloadURL")
    if not url:
        raise RuntimeError(f"geoBoundaries returned no GeoJSON URL for {alpha3} {level}")
    data = fetch_json(url)
    cache.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def download_country(alpha3: str):
    return download_boundary(alpha3, "ADM1")


def download_natural_earth():
    """Natural Earth's admin-1 set, used only as a fallback and only via its
    exact iso_3166_2 code — never by name. It predates several ISO renumbering
    rounds (Kazakhstan's 2023 codes, several 2018+ splits), so it cannot help
    with a subdivision ISO created after Natural Earth's own last edit, but
    for anything ISO renumbered or renamed with the *place* unchanged, its
    code field still names the right shape."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = CACHE_DIR / NE_ADMIN1_CACHE
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    data = fetch_json(NE_ADMIN1_URL)
    cache.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def natural_earth_index(data):
    index = {}
    for feature in data.get("features") or []:
        props = feature.get("properties") or {}
        code = str(props.get("iso_3166_2") or "").strip().upper()
        if not code or code == "-99":
            continue
        index.setdefault(code, []).append(feature)
    return index


def adopt_source_regions(jobs, downloaded, subdivisions):
    """Where the source draws a country differently from ISO, follow the source.

    geoBoundaries ADM1 is not always ISO 3166-2. Italy's ADM1 is five NUTS-1
    macro-regions with an empty `shapeISO`; the ISO list is twenty regions. None
    of them match, so Italy produced no geometry at all — while the Returning
    Officer's editor went on offering all twenty, because that list comes from
    the name table. Selecting one drew nothing, which is exactly the "missing
    subdivisions" complaint: nine countries, China, Italy and Poland among them.

    The editor may only offer what can actually be drawn, so when a country
    matches nothing we adopt the source's own regions as its subdivisions and
    rewrite the name table for that country. Countries that match normally are
    untouched, and a country that matches only partly keeps its ISO list — a
    half-adopted country would renumber ids that are already in the database.
    """
    revised = []
    for country_code, alpha3, expected in jobs:
        data = downloaded.get(country_code)
        features = (data or {}).get("features") or []
        if not features:
            revised.append((country_code, alpha3, expected))
            continue
        alpha2 = expected[0]["code"].split("-", 1)[0] if expected else None
        matched, _ = match_features(expected, features, alpha2=alpha2, alpha3=alpha3)
        if matched:
            revised.append((country_code, alpha3, expected))
            continue

        adopted = []
        for n, feature in enumerate(features, start=1):
            name = fix_mojibake(str((feature.get("properties") or {}).get("shapeName") or "").strip())
            if not name:
                continue
            # Namespaced so it can never collide with a real ISO 3166-2 code.
            adopted.append({"code": f"{alpha3}-SRC{n:02d}", "name": name, "type": "Region"})
        if not adopted:
            revised.append((country_code, alpha3, expected))
            continue

        print(f"  {country_code}: ISO list matched nothing; adopting {len(adopted)} source regions")
        subdivisions[country_code] = adopted
        revised.append((country_code, alpha3, adopted))
    return revised


def repair_code(code: str, alpha2: str | None, alpha3: str | None):
    """Plausible re-prefixings of a source shapeISO, never invented content.

    Syria's ADM1 stamps shapeISO with the alpha-3 prefix ("SYR-DI" instead of
    "SY-DI"); Belgium's drops the country prefix entirely ("WAL" instead of
    "BE-WAL"). Both are re-prefixings of the code the source already gives —
    the candidate is only ever used if it lands on a real expected code, so a
    coincidental collision (e.g. North Korea's shapeISO "KP05" happens to
    share digits with an unrelated ISO code) still has to pass that check
    before anything is matched to it. Because "KP05" already starts with the
    country's own alpha-2, it is not offered a candidate here at all — it
    would otherwise silently pair the wrong province with the wrong shape,
    since geoBoundaries' internal KP numbering is not ISO's."""
    if not code:
        return []
    candidates = []
    if "-" in code:
        prefix, rest = code.split("-", 1)
        if alpha3 and prefix == alpha3 and alpha2:
            candidates.append(f"{alpha2}-{rest}")
    elif alpha2 and not code.startswith(alpha2):
        candidates.append(f"{alpha2}-{code}")
    return candidates


def match_features(expected, features, alpha2: str | None = None, alpha3: str | None = None):
    expected_by_code = {x["code"].upper(): x for x in expected}
    by_name = {}
    by_tokens = {}
    for item in expected:
        names = [item.get("name", "")] + NAME_ALIASES.get(item["code"], [])
        for candidate_name in names:
            by_name.setdefault(normalize(candidate_name), []).append(item)
            by_tokens.setdefault(normalize_tokens(candidate_name), []).append(item)

    used = set()
    matched = {}
    leftovers = []
    for feature in features:
        props = feature.get("properties") or {}
        # A handful of sources punctuate shapeISO oddly (an underscore instead
        # of a hyphen, a trailing "*" flagging a disputed shape) — cosmetic,
        # not a different code, so it is cleaned up before comparison rather
        # than left to defeat an otherwise exact match.
        code = str(props.get("shapeISO") or props.get("shapeiso") or "").upper().strip()
        code = code.replace("_", "-").strip("*").strip()
        name = fix_mojibake(str(props.get("shapeName") or props.get("shapename") or props.get("name") or "").strip())
        target = expected_by_code.get(code)
        if not target:
            for candidate_code in repair_code(code, alpha2, alpha3):
                target = expected_by_code.get(candidate_code)
                if target:
                    break
        if target and target["code"] not in used:
            matched[target["code"]] = feature
            used.add(target["code"])
        else:
            leftovers.append((feature, name))

    # Pass 2: exact name match, either as written or word-order independent
    # ("Comunidad de Madrid" vs the ISO list's "Madrid, Comunidad de").
    for key_fn, table in ((normalize, by_name), (normalize_tokens, by_tokens)):
        for feature, name in leftovers:
            if feature in matched.values():
                continue
            key = key_fn(name)
            candidates = [x for x in table.get(key, []) if x["code"] not in used]
            if len(candidates) == 1:
                target = candidates[0]
                matched[target["code"]] = feature
                used.add(target["code"])

    # Pass 3: one name wholly contains the other ("Cataluña/Catalunya" source
    # name containing the ISO list's "Catalunya"). Gated on both names being
    # long enough that a short common word can't cause a false match, and
    # only taken when exactly one leftover feature qualifies for a given
    # expected entry — an ambiguous containment is left to pass 4 or unmatched.
    still = [x for x in expected if x["code"] not in used]
    unmatched_features = [(f, n) for f, n in leftovers if f not in matched.values()]
    for item in still:
        wanted = normalize(item.get("name", ""))
        if len(wanted) < 5:
            continue
        qualifying = []
        for feature, name in unmatched_features:
            got = normalize(name)
            if len(got) >= 5 and (wanted in got or got in wanted):
                qualifying.append(feature)
        if len(qualifying) == 1:
            matched[item["code"]] = qualifying[0]
            used.add(item["code"])
            unmatched_features = [(f, n) for f, n in unmatched_features if f is not qualifying[0]]

    # Pass 4: fuzzy match, tried both as written and word-order independent,
    # so "Zhambyl oblysy" can still find "Jambyl Region" despite the
    # transliteration difference.
    still = [x for x in expected if x["code"] not in used]
    for item in still[:]:
        wanted = normalize(item.get("name", ""))
        wanted_tokens = normalize_tokens(item.get("name", ""))
        if not wanted:
            continue
        scored = []
        for feature, name in unmatched_features:
            got = normalize(name)
            if not got:
                continue
            ratio = max(
                difflib.SequenceMatcher(None, wanted, got).ratio(),
                difflib.SequenceMatcher(None, wanted_tokens, normalize_tokens(name)).ratio(),
            )
            scored.append((ratio, feature, name))
        scored.sort(key=lambda x: x[0], reverse=True)
        if scored and scored[0][0] >= 0.90:
            score, feature, _ = scored[0]
            matched[item["code"]] = feature
            used.add(item["code"])
            unmatched_features = [(f, n) for f, n in unmatched_features if f is not feature]

    missing = [x for x in expected if x["code"] not in matched]
    return matched, missing


# ------------------------------------------------------------ fallback tiers
#
# Run in order of confidence after the primary ADM1 pass: an exact separate
# country first, then an exact ISO code from a second source, and only then a
# second name-matching pass one administrative level down. Each stage only
# looks at what the previous stage left in `missing_report` and only removes
# an entry once it actually has geometry for it.

def resolve_territory_overrides(missing_report, per_country, scale, translate_x, translate_y):
    resolved = 0
    for country_code, codes in list(missing_report.items()):
        still = []
        for code in codes:
            alpha3 = TERRITORY_ADM0.get(code)
            if not alpha3:
                still.append(code)
                continue
            try:
                data = download_boundary(alpha3, "ADM0")
            except Exception as exc:
                print(f"  {code}: ADM0 fetch failed for {alpha3}: {exc}", file=sys.stderr)
                still.append(code)
                continue
            rings = []
            for feature in data.get("features") or []:
                rings.extend(projected_rings(feature))
            if not rings:
                still.append(code)
                continue
            per_country.setdefault(country_code, {})[code] = transform_rings(rings, scale, translate_x, translate_y)
            resolved += 1
            print(f"  {code}: resolved via {alpha3} ADM0 (a separate geoBoundaries country)")
        if still:
            missing_report[country_code] = still
        else:
            del missing_report[country_code]
    return resolved


def resolve_from_natural_earth(missing_report, per_country, scale, translate_x, translate_y):
    try:
        data = download_natural_earth()
    except Exception as exc:
        print(f"Natural Earth fallback unavailable: {exc}", file=sys.stderr)
        return 0
    index = natural_earth_index(data)
    resolved = 0
    for country_code, codes in list(missing_report.items()):
        still = []
        for code in codes:
            features = index.get(code.upper())
            if not features:
                still.append(code)
                continue
            rings = []
            for feature in features:
                rings.extend(projected_rings(feature))
            if not rings:
                still.append(code)
                continue
            per_country.setdefault(country_code, {})[code] = transform_rings(rings, scale, translate_x, translate_y)
            resolved += 1
        if still:
            missing_report[country_code] = still
        else:
            del missing_report[country_code]
    return resolved


def resolve_from_adm2(missing_report, per_country, subdivisions, alpha_map, scale, translate_x, translate_y):
    """geoBoundaries ADM2, for an entity ISO lists that ADM1 folds into a
    larger parent — a city with county rights folded into its county, a
    governorate under a two-part national split. Reuses match_features(), so
    the same false-positive protections (unambiguous candidates only, a
    length-gated containment check, a 0.90 fuzzy floor) apply one level down."""
    resolved = 0
    for country_code, codes in list(missing_report.items()):
        expected_all = subdivisions.get(country_code) or []
        still_expected = [x for x in expected_all if x["code"] in codes]
        if not still_expected:
            continue
        alpha2, alpha3 = country_alpha(still_expected, alpha_map)
        if not alpha3:
            continue
        try:
            data = download_boundary(alpha3, "ADM2")
        except Exception as exc:
            print(f"  {country_code}: ADM2 fetch failed: {exc}", file=sys.stderr)
            continue
        features = data.get("features") or []
        if not features:
            continue
        matched, missing = match_features(still_expected, features, alpha2=alpha2, alpha3=alpha3)
        for iso, feature in matched.items():
            rings = transform_rings(projected_rings(feature), scale, translate_x, translate_y)
            if not rings:
                continue
            per_country.setdefault(country_code, {})[iso] = rings
            resolved += 1
            print(f"  {iso}: resolved via {alpha3} ADM2")
        remaining_codes = [x["code"] for x in missing]
        if remaining_codes:
            missing_report[country_code] = remaining_codes
        else:
            del missing_report[country_code]
    return resolved


# ------------------------------------------------------------ opaque ids

def load_ids() -> dict:
    if not IDS_FILE.exists():
        return {}
    data = json.loads(IDS_FILE.read_text(encoding="utf-8"))
    return dict(data.get("ids") or {})


def assign_ids(existing: dict, iso_codes) -> dict:
    """Append-only. A database row holds the id, so nothing already given out
    may be renumbered — a new subdivision takes the next free number, even if
    that leaves the numbering out of alphabetical order forever."""
    ids = dict(existing)
    used = {int(v[1:]) for v in ids.values() if re.fullmatch(r"s\d+", v)}
    nxt = (max(used) + 1) if used else 1
    for iso in sorted(set(iso_codes)):
        if iso in ids:
            continue
        ids[iso] = f"s{nxt:04d}"
        nxt += 1
    return ids


def write_ids(ids: dict, subdivisions: dict):
    """The only place the real world is written down, and it is never served.

    Render deploys `server/` and nothing else, so this has to live here rather
    than beside the generator, or the Returning Officer's own console would be
    unable to name what it is handing out."""
    by_country = {}
    for country, entries in subdivisions.items():
        for entry in entries:
            iso = entry.get("code")
            if iso in ids:
                by_country[ids[iso]] = country
    payload = {
        "note": "ISO 3166-2 <-> opaque subdivision id. Server-side only: nothing here may reach a player. Generated by tools/generate-world-subdivisions.py; assignment is append-only.",
        "ids": dict(sorted(ids.items())),
        "territories": dict(sorted(by_country.items())),
    }
    IDS_FILE.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


# ------------------------------------------------------------ output layout

def write_layout(width, height, per_country, ids, projection=None):
    """docs/subdiv/index.json + <territory>.json (coarse) + <territory>.d.json.

    Coarse is what the world view draws. Detail is fetched for the one territory
    somebody has opened, which is the only place the extra points are visible."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for stale in OUTPUT_DIR.glob("*.json"):
        stale.unlink()

    territories = {}
    # Which file holds a given subdivision. The client is handed opaque ids by
    # the API and has to know which territory file to fetch for each one; it
    # cannot derive that without downloading everything, which is the whole
    # thing this split exists to avoid.
    parents = {}
    total_coarse = total_detail = 0
    for country in sorted(per_country):
        coarse, detail = {}, {}
        for iso, rings in sorted(per_country[country].items()):
            sid = ids[iso]
            parents[sid] = country
            c = path_from_rings(rings, COARSE_TOLERANCE_PX, drop_below_px=0.8)
            d = path_from_rings(rings, DETAIL_TOLERANCE_PX)
            if c:
                coarse[sid] = c
            if d:
                detail[sid] = d
        if not detail:
            continue
        for name, shapes in ((f"{country}.json", coarse), (f"{country}.d.json", detail)):
            (OUTPUT_DIR / name).write_text(
                json.dumps({"t": country, "shapes": shapes}, separators=(",", ":"), ensure_ascii=False),
                encoding="utf-8",
            )
        territories[country] = len(detail)
        total_coarse += (OUTPUT_DIR / f"{country}.json").stat().st_size
        total_detail += (OUTPUT_DIR / f"{country}.d.json").stat().st_size

    index = {
        "width": width,
        "height": height,
        "credit": CREDIT,
        "territories": dict(sorted(territories.items())),
    }
    if projection:
        index["projection"] = projection
    (OUTPUT_DIR / "index.json").write_text(
        json.dumps(index, separators=(",", ":"), ensure_ascii=False), encoding="utf-8"
    )
    # Only for subdivisions that actually shipped a shape — a parent pointing at
    # a file with nothing in it would send the client after a 404.
    (OUTPUT_DIR / "parents.json").write_text(
        json.dumps(
            {sid: t for sid, t in sorted(parents.items()) if t in territories},
            separators=(",", ":"),
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return territories, total_coarse, total_detail


def report_layout(territories, total_coarse, total_detail):
    shapes = sum(territories.values())
    print(
        f"Wrote docs/subdiv/: {len(territories)} territories, {shapes} shapes. "
        f"Coarse {total_coarse / 1024:.0f} KB total, detail {total_detail / 1024:.0f} KB total; "
        f"largest single coarse file {max((f.stat().st_size for f in OUTPUT_DIR.glob('*.json') if not f.name.endswith('.d.json')), default=0) / 1024:.0f} KB."
    )
    if LEGACY_OUTPUT_FILE.exists():
        LEGACY_OUTPUT_FILE.unlink()
        print("Removed the old docs/world-subdivisions.js; nothing loads it any more.")


# ------------------------------------------------------------ the two modes

def build_from_existing():
    """Re-split geometry this script already produced. No network."""
    if not LEGACY_OUTPUT_FILE.exists():
        raise SystemExit("docs/world-subdivisions.js is gone; run without --from-existing to download afresh.")
    text = LEGACY_OUTPUT_FILE.read_text(encoding="utf-8")
    match = re.search(r"window\.WORLD_SUBDIVISIONS\s*=\s*(\{.*\});\s*$", text, re.S)
    if not match:
        raise SystemExit("Could not parse window.WORLD_SUBDIVISIONS from docs/world-subdivisions.js")
    payload = json.loads(match.group(1))
    subdivisions = json.loads(SUBDIVISIONS_FILE.read_text(encoding="utf-8"))

    ids = assign_ids(load_ids(), [e["code"] for entries in subdivisions.values() for e in entries])
    write_ids(ids, subdivisions)

    per_country = {}
    for iso, d in payload.get("shapes", {}).items():
        country = payload.get("parents", {}).get(iso)
        if not country or iso not in ids:
            continue
        per_country.setdefault(country, {})[iso] = parse_path(d)

    report_layout(*write_layout(
        payload.get("width", 1000), payload.get("height", 500), per_country, ids,
        projection=payload.get("projection"),
    ))


def build_from_source():
    subdivisions = json.loads(SUBDIVISIONS_FILE.read_text(encoding="utf-8"))
    alpha_map = json.loads(ALPHA_MAP_FILE.read_text(encoding="utf-8"))
    world = parse_world_map()
    target_boxes = {code: svg_bbox(path) for code, path in world["shapes"].items()}

    ids = assign_ids(load_ids(), [e["code"] for entries in subdivisions.values() for e in entries])
    write_ids(ids, subdivisions)

    jobs = []
    for country_code, expected in subdivisions.items():
        if not expected or country_code not in target_boxes:
            continue
        _, alpha3 = country_alpha(expected, alpha_map)
        if alpha3:
            jobs.append((country_code, alpha3, expected))

    downloaded = {}
    failures = {}
    print(f"Downloading/caching ADM1 geometry for {len(jobs)} countries…")
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        future_map = {pool.submit(download_country, alpha3): (country, alpha3) for country, alpha3, _ in jobs}
        for future in concurrent.futures.as_completed(future_map):
            country, alpha3 = future_map[future]
            try:
                downloaded[country] = future.result()
            except Exception as exc:
                failures[country] = str(exc)

    scale, translate_x, translate_y, median_residual, p90_residual, calibration_count = calibrate_projection(downloaded, target_boxes)
    print(
        f"Calibrated one global Natural Earth transform from {calibration_count} countries: "
        f"scale={scale:.4f}, translate=({translate_x:.2f}, {translate_y:.2f}); "
        f"median bbox residual={median_residual:.2f}px, p90={p90_residual:.2f}px"
    )

    per_country = {}
    missing_report = {}
    matched_total = 0
    expected_total = 0

    jobs = adopt_source_regions(jobs, downloaded, subdivisions)
    # Adoption rewrites the name table for those countries, so the ids and the
    # table the server reads are both refreshed before anything is drawn.
    ids = assign_ids(ids, [e["code"] for entries in subdivisions.values() for e in entries])
    write_ids(ids, subdivisions)
    SUBDIVISIONS_FILE.write_text(
        json.dumps({k: subdivisions[k] for k in sorted(subdivisions)}, indent=1, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    for country_code, alpha3, expected in jobs:
        expected_total += len(expected)
        data = downloaded.get(country_code)
        if not data:
            missing_report[country_code] = [x["code"] for x in expected]
            continue
        features = data.get("features") or []
        alpha2, _ = country_alpha(expected, alpha_map)
        matched, missing = match_features(expected, features, alpha2=alpha2, alpha3=alpha3)
        if missing:
            missing_report[country_code] = [x["code"] for x in missing]
        for iso, feature in matched.items():
            rings = transform_rings(projected_rings(feature), scale, translate_x, translate_y)
            if not rings:
                missing_report.setdefault(country_code, []).append(iso)
                continue
            per_country.setdefault(country_code, {})[iso] = rings
            matched_total += 1

    if missing_report:
        before = sum(len(v) for v in missing_report.values())
        resolved = resolve_territory_overrides(missing_report, per_country, scale, translate_x, translate_y)
        matched_total += resolved
        if resolved:
            print(f"Territory-override fallback: {resolved}/{before} resolved via a dependent territory's own ADM0.")

    if missing_report:
        before = sum(len(v) for v in missing_report.values())
        resolved = resolve_from_natural_earth(missing_report, per_country, scale, translate_x, translate_y)
        matched_total += resolved
        if resolved:
            print(f"Natural Earth fallback: {resolved}/{before} resolved by exact ISO 3166-2 code.")

    if missing_report:
        before = sum(len(v) for v in missing_report.values())
        resolved = resolve_from_adm2(missing_report, per_country, subdivisions, alpha_map, scale, translate_x, translate_y)
        matched_total += resolved
        if resolved:
            print(f"ADM2 fallback: {resolved}/{before} resolved one administrative level down.")

    report_layout(*write_layout(
        world["width"], world["height"], per_country, ids,
        projection={"name": "Natural Earth 1", "scale": round(scale, 6), "translate": [round(translate_x, 4), round(translate_y, 4)]},
    ))
    print(f"{matched_total}/{expected_total} configured subdivisions have geometry.")
    if failures:
        print(f"Network/source failures for {len(failures)} countries:", file=sys.stderr)
        for code, msg in sorted(failures.items()):
            print(f"  {code}: {msg}", file=sys.stderr)
    if missing_report:
        total_missing = sum(len(v) for v in missing_report.values())
        print(f"{total_missing} configured subdivisions had no safe geometry match; they remain selectable and the Returning Officer editor marks them as unmapped.")
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        report_file = CACHE_DIR / "unmatched.json"
        report_file.write_text(json.dumps(missing_report, indent=2), encoding="utf-8")
        print(f"Match report: {report_file.relative_to(ROOT)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--from-existing", action="store_true",
        help="rebuild docs/subdiv/ from an existing docs/world-subdivisions.js instead of downloading",
    )
    args = parser.parse_args()
    if args.from_existing:
        build_from_existing()
    else:
        build_from_source()


if __name__ == "__main__":
    main()
