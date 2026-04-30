#!/usr/bin/env python3
"""
Generate multiple themed sprite sheets for Lawnbot Tycoon via
OpenRouter (openai/gpt-5.4-image-2).

Usage:
    OPENROUTER_API_KEY=sk-or-v1-... python3 scripts/gen_sheets.py
    OPENROUTER_API_KEY=... python3 scripts/gen_sheets.py robots tiles  # subset

Output:
    assets/sheets/<name>.png
    assets/sheets/<name>.json  (raw response for debugging)
"""
import base64
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

API_KEY = os.environ.get("OPENROUTER_API_KEY")
if not API_KEY:
    print("ERROR: set OPENROUTER_API_KEY", file=sys.stderr)
    sys.exit(1)

MODEL = "openai/gpt-5.4-image-2"
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "sheets")
os.makedirs(OUT_DIR, exist_ok=True)

STYLE = (
    "Art style: clean flat-shaded cartoon with soft cel-shading, chunky dark "
    "outlines (~3px), top-down / 3/4 orthographic perspective, consistent "
    "lighting from upper-left, soft drop-shadow beneath each sprite, "
    "saturated natural palette (greens #2f9c4a #196a2c, warm browns, cheerful "
    "accent yellows/pinks). Transparent PNG background. NO text, NO watermarks, "
    "NO grid lines, NO cell borders, NO labels, sprites well-separated with "
    "clear empty space between them."
)

SHEETS = {
    "robots": (
        "A horizontal row of 6 cute top-down robot lawn-mowers, well spaced, "
        "each with spinning blade and antenna. Variants: "
        "(1) basic round red mower-bot, "
        "(2) upgraded blue mower-bot with dual blades, "
        "(3) gold premium mower-bot with racing stripes, "
        "(4) rusty patched variant with duct tape, "
        "(5) futuristic neon mower-bot with glowing cyan trim, "
        "(6) evil 'Doomba' dark mower-bot with single glowing red eye."
    ),
    "tiles": (
        "A horizontal row of 6 seamless 1:1 square game terrain tiles "
        "(top-down view, drawn as rounded squares with subtle shadow): "
        "(1) lush tall green grass, (2) freshly-mowed short grass, "
        "(3) autumn brown/orange grass, (4) moonlit dark-blue grass, "
        "(5) zen raked sand with concentric ring patterns, "
        "(6) retro chunky pixel-art green grass. Equal spacing."
    ),
    "features": (
        "A horizontal row of 10 top-down garden obstacles/features, well spaced: "
        "(1) leafy green tree, (2) gray boulder/rock, "
        "(3) small round pond with lily pad, (4) colorful flower cluster, "
        "(5) wooden beehive with honeycomb, (6) stone fountain with water, "
        "(7) wooden garden shed with red roof, (8) friendly red-hat garden gnome, "
        "(9) evil black-hat gnome with glowing red eyes and sneering face, "
        "(10) mole dirt mound with little paws sticking out."
    ),
    "characters": (
        "A horizontal row of 6 cute top-down characters, well spaced: "
        "(1) cartoon bee with blurred wings, "
        "(2) mole peeking out of a dirt hole, "
        "(3) elderly neighbor woman with apron and gray bun, "
        "(4) neighbor man in tanktop with sunglasses and muscular build, "
        "(5) mayor in suit with sash and medallion, "
        "(6) player avatar pushing a manual lawn mower."
    ),
    "flowers": (
        "A horizontal row of 6 top-down single flower sprites, each on a small "
        "leafy base, well spaced, cartoon style: "
        "(1) pink petals with yellow center, (2) orange petals with yellow center, "
        "(3) purple petals with white center, (4) red petals with yellow center, "
        "(5) white daisy with yellow center, (6) yellow petals with orange center."
    ),
    "items": (
        "A horizontal row of 8 top-down game items/currency, well spaced: "
        "(1) shiny gold coin with dollar symbol, (2) stack of gold coins, "
        "(3) cyan cut gemstone, (4) red cut ruby, "
        "(5) closed wooden treasure chest with iron bands, "
        "(6) open treasure chest overflowing with gold, "
        "(7) green gasoline jerry can with leaf symbol, "
        "(8) glowing blue energy crystal."
    ),
    "ui_icons": (
        "A grid of 16 flat game UI icons (4x4 grid, equal spacing, high contrast, "
        "bold shapes, slight drop-shadow, no text): "
        "shop cart, wrench/tool, cute robot head, grass blade tuft, flower bloom, "
        "bee, gnome silhouette, ruby gem, cyan gem, gold coin, yellow star, "
        "gray padlock, green checkmark, red X cross, gear/cog, gold trophy."
    ),
    "weather_fx": (
        "A horizontal row of 8 top-down weather and atmosphere effects, "
        "well spaced, cartoon style: "
        "(1) blue rain droplet, (2) white snowflake, "
        "(3) dark storm cloud with yellow lightning bolt, (4) soft gray fog puff, "
        "(5) bright sun, (6) crescent moon, (7) falling autumn leaf, "
        "(8) yellow sparkle starburst."
    ),
    "particles": (
        "A horizontal row of 8 top-down particle/FX sprites, well spaced, "
        "cartoon style: (1) green grass-clipping burst, (2) gold coin sparkle puff, "
        "(3) brown dust cloud, (4) blue water splash, "
        "(5) orange/yellow critical-hit starburst, (6) gray smoke puff, "
        "(7) red heart, (8) white speech bubble with exclamation mark."
    ),
}


def generate(name, prompt_body):
    full_prompt = (
        f"Generate a game sprite sheet PNG (transparent background, "
        f"approximately 1024x512 aspect). {prompt_body}\n\n{STYLE}"
    )
    body = {
        "model": MODEL,
        "modalities": ["image", "text"],
        "messages": [{"role": "user", "content": full_prompt}],
    }
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/anomalyco/lawnbot-tycoon",
            "X-Title": "Lawnbot Tycoon sprite sheets",
        },
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.loads(r.read())
    dt = time.time() - t0

    with open(os.path.join(OUT_DIR, f"{name}.json"), "w") as f:
        json.dump(data, f, indent=2)

    msg = data["choices"][0]["message"]
    images = msg.get("images") or []
    if not images and isinstance(msg.get("content"), list):
        images = [c for c in msg["content"] if c.get("type") == "image_url"]
    if not images:
        return name, None, dt, "no image in response"

    url = images[0].get("image_url", {}).get("url") or images[0].get("url")
    if not url:
        return name, None, dt, "image url missing"

    if url.startswith("data:"):
        png = base64.b64decode(url.split(",", 1)[1])
    else:
        with urllib.request.urlopen(url) as ir:
            png = ir.read()

    out_path = os.path.join(OUT_DIR, f"{name}.png")
    with open(out_path, "wb") as f:
        f.write(png)
    return name, out_path, dt, None


def main():
    requested = sys.argv[1:] or list(SHEETS.keys())
    unknown = [r for r in requested if r not in SHEETS]
    if unknown:
        print(f"Unknown sheets: {unknown}. Available: {list(SHEETS.keys())}")
        sys.exit(1)

    print(f"Generating {len(requested)} sheet(s) in parallel: {requested}")
    results = []
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(generate, n, SHEETS[n]): n for n in requested}
        for fut in as_completed(futs):
            name, path, dt, err = fut.result()
            if err:
                print(f"  [FAIL] {name}  ({dt:.1f}s)  {err}")
            else:
                kb = os.path.getsize(path) // 1024
                print(f"  [OK]   {name:12s} ({dt:.1f}s)  {kb} KB  -> {path}")
            results.append((name, path, err))

    ok = sum(1 for _, p, e in results if not e)
    print(f"\n{ok}/{len(results)} sheets generated in {OUT_DIR}")


if __name__ == "__main__":
    main()
