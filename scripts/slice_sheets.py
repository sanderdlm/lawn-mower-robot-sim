#!/usr/bin/env python3
"""
Slice each per-sheet PNG in assets/sheets/ into individual sprite PNGs.

For each sheet we know the expected sprite count and naming order, so we can
verify the slice.

Input:  assets/sheets/<name>.png  (RGB with baked checker background)
Output: assets/sprites/<name>/<sprite>.png  (RGBA cropped + padded)
        assets/sprites/atlas.json           (manifest with all sprites)
"""
import json
import os

from PIL import Image

SHEETS_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "sheets")
OUT_DIR    = os.path.join(os.path.dirname(__file__), "..", "assets", "sprites")

# name -> list of sprite names in left-to-right (+ top-to-bottom for grids) order
SHEET_LAYOUTS = {
    "robots": {
        "layout": "row",
        "names": ["basic_red", "upgraded_blue", "gold_premium", "rusty", "neon", "evil"],
    },
    "tiles": {
        "layout": "row",
        "names": ["grass_tall", "grass_short", "grass_autumn", "grass_moonlit",
                  "sand_zen", "grass_pixel"],
    },
    "features": {
        "layout": "row",
        "names": ["tree", "rock", "pond", "flower_cluster", "beehive",
                  "fountain", "shed", "gnome_friendly", "gnome_evil", "mole_mound"],
    },
    "characters": {
        "layout": "row",
        "names": ["bee", "mole", "neighbor_granny", "neighbor_chad",
                  "mayor", "player_mower"],
    },
    "flowers": {
        "layout": "row",
        "names": ["pink", "orange", "purple", "red", "white", "yellow"],
    },
    "items": {
        "layout": "row",
        "names": ["coin", "coin_stack", "gem", "ruby",
                  "chest_closed", "chest_open", "fuel_can", "energy_crystal"],
    },
    "ui_icons": {
        # prompt asked for 4x4 grid => 16 icons, row-major
        "layout": "grid",
        "rows": 4,
        "names": ["cart", "wrench", "robot_head", "grass_blade",
                  "flower", "bee", "gnome", "ruby",
                  "gem", "coin", "star", "lock",
                  "check", "cross", "gear", "trophy"],
    },
    "weather_fx": {
        "layout": "row",
        "names": ["rain", "snow", "storm", "fog", "sun", "moon", "leaf", "sparkle"],
    },
    "particles": {
        "layout": "row",
        "names": ["clippings", "coin_sparkle", "dust", "splash",
                  "crit", "smoke", "heart", "exclaim"],
    },
}


def is_bg_pixel(p):
    r, g, b = p[0], p[1], p[2]
    if r < 220 or g < 220 or b < 220:
        return False
    return abs(r - g) <= 5 and abs(g - b) <= 5 and abs(r - b) <= 5


def build_rgba_and_mask(im):
    im = im.convert("RGB")
    w, h = im.size
    src = im.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    mask = [bytearray(w) for _ in range(h)]
    for y in range(h):
        row = mask[y]
        for x in range(w):
            p = src[x, y]
            if not is_bg_pixel(p):
                op[x, y] = (p[0], p[1], p[2], 255)
                row[x] = 1
    return out, mask


def find_bands(sig, min_gap, min_band, min_content):
    n = len(sig)
    bands = []
    i = 0
    while i < n:
        if sig[i] < min_content:
            i += 1
            continue
        start = i
        gap_run = 0
        end = i
        while i < n:
            if sig[i] >= min_content:
                end = i
                gap_run = 0
            else:
                gap_run += 1
                if gap_run >= min_gap:
                    break
            i += 1
        if end - start + 1 >= min_band:
            bands.append((start, end + 1))
    return bands


def col_content(mask, x, y0, y1):
    return sum(mask[y][x] for y in range(y0, y1))


def row_content(mask, y, x0=0, x1=None):
    if x1 is None: x1 = len(mask[0])
    row = mask[y]
    return sum(row[x] for x in range(x0, x1))


def split_by_valleys(sig, expected_n, min_split_gap=8):
    """Given a 1D signal, return up to expected_n bands by cutting at the
    deepest valleys. This is better than fixed-threshold find_bands when
    sprites sit close together (faint bridge of noise between them)."""
    n = len(sig)
    # Find outer content span
    idxs = [i for i, s in enumerate(sig) if s > 0]
    if not idxs:
        return []
    left, right = idxs[0], idxs[-1] + 1
    if expected_n <= 1:
        return [(left, right)]

    # Walk window, find the (expected_n - 1) deepest local valleys.
    # A valid split candidate must have sig[i] < 0.3 * max(sig[left:right]) and
    # be at least min_split_gap away from edges and from already-picked splits.
    peak = max(sig[left:right]) or 1
    thresh = max(3, int(peak * 0.30))
    candidates = []
    i = left + min_split_gap
    while i < right - min_split_gap:
        if sig[i] <= thresh:
            # find the local min within a small window
            j_lo = max(left, i - 6); j_hi = min(right, i + 7)
            local_min = min(sig[j_lo:j_hi])
            if sig[i] == local_min:
                candidates.append((sig[i], i))
                i += min_split_gap
                continue
        i += 1

    candidates.sort(key=lambda c: c[0])  # deepest first
    picks = []
    for (_, idx) in candidates:
        if all(abs(idx - p) >= min_split_gap for p in picks):
            picks.append(idx)
            if len(picks) == expected_n - 1:
                break
    picks.sort()
    bands = []
    prev = left
    for p in picks:
        bands.append((prev, p))
        prev = p
    bands.append((prev, right))
    # Trim bg at edges of each band
    def trim(a, b):
        while a < b and sig[a] < 3: a += 1
        while b > a and sig[b - 1] < 3: b -= 1
        return (a, b)
    bands = [trim(a, b) for a, b in bands]
    # drop empty/degenerate bands
    bands = [b for b in bands if b[1] - b[0] >= 8]
    return bands


def slice_row(rgba, mask, w, h, expected_n, pad=6):
    """Find the single content row in the image, then split by column gutters."""
    row_sig = [sum(mask[y]) for y in range(h)]
    row_bands = find_bands(row_sig, min_gap=4, min_band=30, min_content=8)
    if not row_bands:
        return []
    y0 = row_bands[0][0]
    y1 = row_bands[-1][1]   # span whole content (some sprites taller than others)

    col_sig = [col_content(mask, x, y0, y1) for x in range(w)]

    # Primary: valley-splitting targeted to expected_n.
    col_bands = split_by_valleys(col_sig, expected_n, min_split_gap=10)

    # Fallback to threshold-based if valley split failed badly.
    if len(col_bands) != expected_n:
        alt = find_bands(col_sig, min_gap=3, min_band=10, min_content=4)
        if abs(len(alt) - expected_n) < abs(len(col_bands) - expected_n):
            col_bands = alt

    crops = []
    for (x0, x1) in col_bands:
        # tight y-bounds
        sy0, sy1 = y1, y0
        for yy in range(y0, y1):
            if any(mask[yy][xx] for xx in range(x0, x1)):
                if yy < sy0: sy0 = yy
                if yy > sy1: sy1 = yy
        cx0 = max(0, x0 - pad); cy0 = max(0, sy0 - pad)
        cx1 = min(w, x1 + pad); cy1 = min(h, sy1 + 1 + pad)
        crops.append(rgba.crop((cx0, cy0, cx1, cy1)))
    return crops


def slice_grid(rgba, mask, w, h, rows, cols, pad=6):
    """Find rows of content, then split each row by columns."""
    row_sig = [sum(mask[y]) for y in range(h)]
    row_bands = find_bands(row_sig, min_gap=6, min_band=30, min_content=15)

    # If we over/under-detected, fall back to even-divide within overall content
    if len(row_bands) != rows:
        # find overall content y-range
        idxs = [i for i, s in enumerate(row_sig) if s > 10]
        if idxs:
            y_top, y_bot = idxs[0], idxs[-1]
            step = (y_bot - y_top) / rows
            row_bands = [(int(y_top + i*step), int(y_top + (i+1)*step)) for i in range(rows)]

    crops = []
    for (y0, y1) in row_bands:
        col_sig = [col_content(mask, x, y0, y1) for x in range(w)]
        col_bands = find_bands(col_sig, min_gap=6, min_band=12, min_content=3)
        for gap in (4, 3):
            if len(col_bands) >= cols:
                break
            col_bands = find_bands(col_sig, min_gap=gap, min_band=10, min_content=2)
        col_bands = col_bands[:cols]
        for (x0, x1) in col_bands:
            sy0, sy1 = y1, y0
            for yy in range(y0, y1):
                if any(mask[yy][xx] for xx in range(x0, x1)):
                    if yy < sy0: sy0 = yy
                    if yy > sy1: sy1 = yy
            if sy1 < sy0:
                sy0, sy1 = y0, y1 - 1
            cx0 = max(0, x0 - pad); cy0 = max(0, sy0 - pad)
            cx1 = min(w, x1 + pad); cy1 = min(h, sy1 + 1 + pad)
            crops.append(rgba.crop((cx0, cy0, cx1, cy1)))
    return crops


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {"sheets": {}}

    for sheet_name, cfg in SHEET_LAYOUTS.items():
        src = os.path.join(SHEETS_DIR, f"{sheet_name}.png")
        if not os.path.exists(src):
            print(f"  [SKIP] {sheet_name}: not found at {src}")
            continue

        im = Image.open(src)
        rgba, mask = build_rgba_and_mask(im)
        w, h = rgba.size
        names = cfg["names"]

        if cfg["layout"] == "row":
            crops = slice_row(rgba, mask, w, h, len(names))
        elif cfg["layout"] == "grid":
            crops = slice_grid(rgba, mask, w, h, cfg["rows"], len(names) // cfg["rows"])
        else:
            continue

        out_sub = os.path.join(OUT_DIR, sheet_name)
        os.makedirs(out_sub, exist_ok=True)
        sheet_info = []
        for i, crop in enumerate(crops):
            name = names[i] if i < len(names) else f"{sheet_name}_{i+1}"
            p = os.path.join(out_sub, f"{name}.png")
            crop.save(p, "PNG", optimize=True)
            sheet_info.append({
                "name": name,
                "file": f"sprites/{sheet_name}/{name}.png",
                "size": list(crop.size),
            })

        status = "OK" if len(crops) == len(names) else f"WARN got {len(crops)}/{len(names)}"
        print(f"  [{status:15s}] {sheet_name:12s} -> {len(crops)} sprites")
        manifest["sheets"][sheet_name] = sheet_info

    mp = os.path.join(OUT_DIR, "atlas.json")
    with open(mp, "w") as f:
        json.dump(manifest, f, indent=2)
    total = sum(len(v) for v in manifest["sheets"].values())
    print(f"\nWrote {total} sprite files. Manifest: {mp}")


if __name__ == "__main__":
    main()
