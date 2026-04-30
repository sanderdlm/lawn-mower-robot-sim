#!/usr/bin/env python3
"""
Slice the generated Lawnbot Tycoon sprite sheet into per-feature PNGs
using horizontal/vertical gutter detection (robust for sprites that
touch each other, like seamless tiles).

Input:  assets/spritesheet.png
Output: assets/sprites/<category>/<name>.png (RGBA, cropped + padded)
        assets/sprites/atlas.json
"""
import json
import os

from PIL import Image

SRC = os.path.join(os.path.dirname(__file__), "..", "assets", "spritesheet.png")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "sprites")

ROW_NAMES = [
    ("robots",     ["basic_red", "upgraded_blue", "gold_premium", "rusty", "neon"]),
    ("tiles",      ["grass_tall", "grass_short", "grass_autumn", "grass_moonlit",
                    "sand_zen", "grass_pixel"]),
    ("features",   ["tree", "rock", "pond", "flower_cluster", "beehive",
                    "fountain", "shed", "gnome_friendly", "gnome_evil",
                    "mole_mound"]),
    ("characters", ["bee", "mole", "neighbor_granny", "neighbor_chad",
                    "mayor", "player_mower"]),
    ("flowers",    ["pink", "orange", "purple", "red", "white", "yellow"]),
    ("items",      ["coin", "coin_stack", "gem", "ruby", "chest_closed",
                    "chest_open", "fuel_can", "energy_crystal"]),
    ("ui",         ["cart", "wrench", "robot_head", "grass_blade", "flower",
                    "bee", "gnome", "ruby", "gem", "coin", "star", "lock",
                    "check", "cross", "gear", "trophy"]),
    ("weather",    ["rain", "snow", "storm", "fog", "sun", "moon", "leaf",
                    "sparkle"]),
    ("particles",  ["clippings", "coin_sparkle", "dust", "splash", "crit",
                    "smoke", "heart", "exclaim"]),
]


def is_bg_pixel(p):
    r, g, b = p[0], p[1], p[2]
    if r < 220 or g < 220 or b < 220:
        return False
    return abs(r - g) <= 5 and abs(g - b) <= 5 and abs(r - b) <= 5


def build_rgba_and_mask(im):
    """Return (RGBA image with bg->transparent, 2D bool content mask)."""
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


def row_has_content(mask, y, x0=0, x1=None):
    """Fraction of non-bg pixels on scanline y in [x0, x1)."""
    if x1 is None: x1 = len(mask[0])
    row = mask[y]
    return sum(row[x] for x in range(x0, x1))


def col_has_content(mask, x, y0, y1):
    return sum(mask[y][x] for y in range(y0, y1))


def find_bands(sig, min_gap, min_band, min_content):
    """Given a 1D signal of non-bg pixel counts per index, return list of
    (start, end) ranges where content exists, separated by >= min_gap
    consecutive low indices.

    An index is 'content' if sig[i] >= min_content.
    A band must be at least min_band long.
    """
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


def main():
    im = Image.open(SRC)
    print(f"Loaded {SRC}: {im.size} {im.mode}")
    rgba, mask = build_rgba_and_mask(im)
    w, h = rgba.size

    # --- Step 1: find rows by per-scanline content count
    row_sig = [sum(mask[y]) for y in range(h)]
    # rows separated by a few scanlines with < ~20 non-bg px
    row_bands = find_bands(row_sig, min_gap=3, min_band=30, min_content=25)
    print(f"Detected {len(row_bands)} rows (y-ranges): {row_bands}")

    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {
        "source": "spritesheet.png",
        "generated_by": "scripts/slice_spritesheet.py",
        "groups": {},
    }

    for row_idx, (y0, y1) in enumerate(row_bands):
        if row_idx < len(ROW_NAMES):
            category, names = ROW_NAMES[row_idx]
        else:
            category, names = f"row{row_idx+1}", []
        cat_dir = os.path.join(OUT_DIR, category)
        os.makedirs(cat_dir, exist_ok=True)
        manifest["groups"][category] = []

        # --- Step 2: within this row, find columns by per-column content count
        col_sig = [col_has_content(mask, x, y0, y1) for x in range(w)]
        # Use smaller min_gap for tightly packed sprites
        col_bands = find_bands(col_sig, min_gap=4, min_band=12, min_content=2)
        print(f"  Row {row_idx+1} [{category}] y={y0}-{y1}: {len(col_bands)} sprites")

        for i, (x0, x1) in enumerate(col_bands):
            name = names[i] if i < len(names) else f"{category}_{i+1}"
            # tight crop inside the band
            # find actual tight y bounds for this sprite (may be smaller than row band)
            sy0, sy1 = y1, y0
            for yy in range(y0, y1):
                for xx in range(x0, x1):
                    if mask[yy][xx]:
                        if yy < sy0: sy0 = yy
                        if yy > sy1: sy1 = yy
                        break
            if sy1 < sy0:
                sy0, sy1 = y0, y1 - 1
            pad = 4
            cx0 = max(0, x0 - pad); cy0 = max(0, sy0 - pad)
            cx1 = min(w, x1 + pad); cy1 = min(h, sy1 + 1 + pad)
            crop = rgba.crop((cx0, cy0, cx1, cy1))
            out_path = os.path.join(cat_dir, f"{name}.png")
            crop.save(out_path, "PNG", optimize=True)
            manifest["groups"][category].append({
                "name": name,
                "file": f"sprites/{category}/{name}.png",
                "bbox_in_sheet": [cx0, cy0, cx1, cy1],
                "size": [cx1 - cx0, cy1 - cy0],
            })

    man_path = os.path.join(OUT_DIR, "atlas.json")
    with open(man_path, "w") as f:
        json.dump(manifest, f, indent=2)

    total = sum(len(g) for g in manifest["groups"].values())
    print(f"\nWrote {total} sprite files across {len(manifest['groups'])} categories")
    print(f"Manifest: {man_path}")


if __name__ == "__main__":
    main()
