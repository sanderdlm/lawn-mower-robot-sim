#!/usr/bin/env python3
"""
Generate Lawnbot Tycoon sprite sheet via OpenRouter (gpt-5.4-image-2).

Usage:
    OPENROUTER_API_KEY=sk-or-v1-... python3 scripts/gen_spritesheet.py

Output: assets/spritesheet.png (+ assets/spritesheet_raw.json for debugging)
"""
import base64
import json
import os
import sys
import urllib.request

API_KEY = os.environ.get("OPENROUTER_API_KEY")
if not API_KEY:
    print("ERROR: set OPENROUTER_API_KEY", file=sys.stderr)
    sys.exit(1)

MODEL = "openai/gpt-5.4-image-2"
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets")
os.makedirs(OUT_DIR, exist_ok=True)

PROMPT = """Create a single top-down 2D game sprite sheet (PNG, transparent background, 2048x2048) for a cozy idle-game called Lawnbot Tycoon. Art style: clean flat-shaded cartoon with soft cel-shading, chunky outlines, top-down / 3/4 orthographic perspective. Consistent lighting from upper-left, soft drop-shadow under each sprite.

Layout: uniform 128x128 grid cells, 16 columns x 16 rows. Every sprite centered in its cell, must read clearly at 64x64.

Row 1 - Robot mowers (top-down):
1. Basic round red mower-bot with spinning blade and antenna
2. Upgraded blue mower-bot with dual blades
3. Gold premium mower-bot with racing stripes
4. Rusty patched variant
5. Futuristic neon mower-bot with glowing cyan trim
6. Evil dark mower-bot with red glowing eye

Row 2 - Tiles (seamless 128x128 top-down squares):
1. Lush green grass (tall)
2. Mowed short grass
3. Autumn brown grass
4. Moonlit blue-tinted grass
5. Zen raked sand with concentric rings
6. Retro pixel-art chunky green grass

Row 3 - Obstacles / garden features (top-down):
1. Leafy tree
2. Gray boulder
3. Small round pond with lily pad
4. Colorful flower cluster
5. Wooden beehive with honeycomb
6. Stone fountain with water
7. Wooden garden shed with red roof
8. Friendly red-hat garden gnome
9. Evil black-hat gnome with glowing red eyes
10. Mole dirt mound with paws

Row 4 - Characters & creatures (top-down):
1. Cartoon bee
2. Mole peeking out of ground
3. Neighbor woman with apron and gray bun
4. Neighbor man with tanktop and sunglasses
5. Mayor in suit with sash
6. Player avatar pushing mower

Row 5 - Flower variants (six colored flowers):
pink+yellow, orange+yellow, purple+white, red+yellow, white+yellow, orange+cream

Row 6 - Currencies & items:
Gold coin, coin stack, cyan gem, red ruby, closed treasure chest, open treasure chest with gold, green fuel can, blue energy crystal

Row 7 - UI icons (flat high-contrast 96x96):
shop cart, wrench, robot head, grass blade, flower, bee, gnome, ruby, gem, coin, star, lock, checkmark, X, gear, trophy

Row 8 - Weather & atmosphere FX:
rain drop, snowflake, storm cloud with lightning, fog puff, sun, moon, falling leaf, sparkle starburst

Row 9 - Particles & effects:
grass clipping burst, coin sparkle, dust cloud, water splash, crit starburst, smoke puff, heart, exclamation bubble

Rows 10-16: leave transparent / empty for expansion.

Style rules: saturated natural palette (greens #2f9c4a #196a2c, warm browns, accent yellows/pinks), 3px dark outlines, flat cel shading (no gradients on characters), transparent background, no text, no watermarks, no cell borders drawn, sprites do not bleed between cells.

Output: single 2048x2048 PNG, transparent background."""


def main():
    body = {
        "model": MODEL,
        "modalities": ["image", "text"],
        "messages": [
            {"role": "user", "content": PROMPT},
        ],
    }
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/anomalyco/lawnbot-tycoon",
            "X-Title": "Lawnbot Tycoon sprite sheet gen",
        },
    )
    print(f"Requesting image from {MODEL} (this may take 30-90s)...")
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.loads(r.read())

    raw_path = os.path.join(OUT_DIR, "spritesheet_raw.json")
    with open(raw_path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Raw response saved: {raw_path}")

    # OpenRouter returns images in message.images[*].image_url.url as data URLs
    msg = data["choices"][0]["message"]
    images = msg.get("images") or []
    if not images:
        # Some providers inline as content parts
        content = msg.get("content")
        if isinstance(content, list):
            images = [c for c in content if c.get("type") == "image_url"]

    if not images:
        print("ERROR: no image in response. See spritesheet_raw.json", file=sys.stderr)
        sys.exit(2)

    url = images[0].get("image_url", {}).get("url") or images[0].get("url")
    if not url:
        print("ERROR: image entry missing url", file=sys.stderr)
        sys.exit(3)

    if url.startswith("data:"):
        b64 = url.split(",", 1)[1]
        png = base64.b64decode(b64)
    else:
        with urllib.request.urlopen(url) as ir:
            png = ir.read()

    out = os.path.join(OUT_DIR, "spritesheet.png")
    with open(out, "wb") as f:
        f.write(png)
    print(f"Wrote {out} ({len(png) // 1024} KB)")


if __name__ == "__main__":
    main()
