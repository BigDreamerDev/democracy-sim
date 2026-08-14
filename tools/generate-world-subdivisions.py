#!/usr/bin/env python3
"""Generate docs/world-subdivisions.js from geoBoundaries ADM1 geometry.

The browser never downloads GIS data. This script is run by the developer and
writes ordinary precomputed SVG path strings, matching the existing world-map.js
architecture.

Usage from the repository root:
    python tools/generate-world-subdivisions.py

The script reads server/subdivisions.json so the geometry keys are exactly the
same ISO 3166-2 codes used by the Returning Officer territory editor. It uses
geoBoundaries gbOpen ADM1 simplified GeoJSON and matches features first by
shapeISO, then by normalized subdivision name. Downloads are cached under
.tools-cache/world-subdivisions/ so reruns do not redownload unchanged files.
"""

from __future__ import annotations

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
OUTPUT_FILE = ROOT / "docs" / "world-subdivisions.js"
CACHE_DIR = ROOT / ".tools-cache" / "world-subdivisions"

API = "https://www.geoboundaries.org/api/current/gbOpen/{alpha3}/ADM1/"
USER_AGENT = "democracy-sim subdivision map generator/1.0"
ROUND = 1
SIMPLIFY_TOLERANCE_PX = 0.20
MAX_WORKERS = 8
MIN_CALIBRATION_SIZE_PX = 5.0


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


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "", value.casefold())


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


def country_lon_mode(features):
    lons = []
    for feature in features:
        for ring in geometry_rings(feature.get("geometry")):
            lons.extend(float(p[0]) for p in ring if len(p) >= 2)
    if not lons:
        return False
    # Countries spanning the anti-meridian are easier to treat in a continuous
    # 0..360 longitude frame before fitting them into their existing country box.
    return max(lons) - min(lons) > 180


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


def rings_to_path(rings, scale, translate_x, translate_y):
    def transform(p):
        return (translate_x + p[0] * scale, translate_y + p[1] * scale)

    parts = []
    for ring in rings:
        pts = [transform(p) for p in ring]
        pts = simplify(pts, SIMPLIFY_TOLERANCE_PX)
        if len(pts) < 3:
            continue
        parts.append("M" + "L".join(f"{fmt(x)},{fmt(y)}" for x, y in pts) + "Z")
    return "".join(parts)


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


def download_country(alpha3: str):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = CACHE_DIR / f"{alpha3}-ADM1-simplified.geojson"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    metadata = fetch_json(API.format(alpha3=alpha3))
    url = metadata.get("simplifiedGeometryGeoJSON") or metadata.get("gjDownloadURL")
    if not url:
        raise RuntimeError(f"geoBoundaries returned no GeoJSON URL for {alpha3}")
    data = fetch_json(url)
    cache.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def match_features(expected, features):
    expected_by_code = {x["code"].upper(): x for x in expected}
    by_name = {}
    for item in expected:
        by_name.setdefault(normalize(item.get("name", "")), []).append(item)

    used = set()
    matched = {}
    leftovers = []
    for feature in features:
        props = feature.get("properties") or {}
        code = str(props.get("shapeISO") or props.get("shapeiso") or "").upper().strip()
        name = str(props.get("shapeName") or props.get("shapename") or props.get("name") or "").strip()
        target = expected_by_code.get(code)
        if target and target["code"] not in used:
            matched[target["code"]] = feature
            used.add(target["code"])
        else:
            leftovers.append((feature, name))

    still = [x for x in expected if x["code"] not in used]
    for feature, name in leftovers:
        key = normalize(name)
        candidates = [x for x in by_name.get(key, []) if x["code"] not in used]
        if len(candidates) == 1:
            target = candidates[0]
            matched[target["code"]] = feature
            used.add(target["code"])

    still = [x for x in expected if x["code"] not in used]
    unmatched_features = [(f, n) for f, n in leftovers if f not in matched.values()]
    for item in still[:]:
        wanted = normalize(item.get("name", ""))
        if not wanted:
            continue
        scored = []
        for feature, name in unmatched_features:
            got = normalize(name)
            if got:
                scored.append((difflib.SequenceMatcher(None, wanted, got).ratio(), feature, name))
        scored.sort(key=lambda x: x[0], reverse=True)
        if scored and scored[0][0] >= 0.90:
            score, feature, _ = scored[0]
            matched[item["code"]] = feature
            used.add(item["code"])
            unmatched_features = [(f, n) for f, n in unmatched_features if f is not feature]

    missing = [x for x in expected if x["code"] not in matched]
    return matched, missing


def main():
    subdivisions = json.loads(SUBDIVISIONS_FILE.read_text(encoding="utf-8"))
    alpha_map = json.loads(ALPHA_MAP_FILE.read_text(encoding="utf-8"))
    world = parse_world_map()
    target_boxes = {code: svg_bbox(path) for code, path in world["shapes"].items()}

    jobs = []
    for country_code, expected in subdivisions.items():
        if not expected or country_code not in target_boxes:
            continue
        alpha2 = expected[0]["code"].split("-", 1)[0]
        alpha3 = alpha_map.get(alpha2)
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

    shapes = {}
    parents = {}
    missing_report = {}
    matched_total = 0
    expected_total = 0

    for country_code, alpha3, expected in jobs:
        expected_total += len(expected)
        data = downloaded.get(country_code)
        if not data:
            missing_report[country_code] = [x["code"] for x in expected]
            continue
        features = data.get("features") or []
        matched, missing = match_features(expected, features)
        if missing:
            missing_report[country_code] = [x["code"] for x in missing]
        if not matched:
            continue

        projected_by_code = {}
        for code, feature in matched.items():
            projected_by_code[code] = projected_rings(feature)

        for code, rings in projected_by_code.items():
            d = rings_to_path(rings, scale, translate_x, translate_y)
            if not d:
                continue
            shapes[code] = d
            parents[code] = country_code
            matched_total += 1

    payload = {
        "width": world["width"],
        "height": world["height"],
        "shapes": dict(sorted(shapes.items())),
        "parents": dict(sorted(parents.items())),
        "source": "geoBoundaries gbOpen ADM1 simplified geometry (CC BY 4.0); globally projected with Natural Earth 1 and clipped to democracy-sim country paths",
        "projection": {"name": "Natural Earth 1", "scale": round(scale, 6), "translate": [round(translate_x, 4), round(translate_y, 4)]},
    }
    header = """/* Generated by tools/generate-world-subdivisions.py.\n\n   Subdivision geometry: geoBoundaries gbOpen ADM1, used under CC BY 4.0.\n   This file contains geometry and opaque subdivision codes only; subdivision\n   names remain in the Returning Officer API/UI. Do not hand-edit this file. */\n"""
    OUTPUT_FILE.write_text(header + "window.WORLD_SUBDIVISIONS = " + json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + ";\n", encoding="utf-8")

    print(f"Wrote {OUTPUT_FILE.relative_to(ROOT)} with {matched_total}/{expected_total} configured subdivision shapes.")
    if failures:
        print(f"Network/source failures for {len(failures)} countries:", file=sys.stderr)
        for code, msg in sorted(failures.items()):
            print(f"  {code}: {msg}", file=sys.stderr)
    if missing_report:
        total_missing = sum(len(v) for v in missing_report.values())
        print(f"{total_missing} configured subdivisions had no safe geometry match; they remain selectable but fall back to parent-country preview.")
        report_file = CACHE_DIR / "unmatched.json"
        report_file.write_text(json.dumps(missing_report, indent=2), encoding="utf-8")
        print(f"Match report: {report_file.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
