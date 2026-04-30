# LAWNBOT TYCOON — KNOWLEDGE BASE

**Generated:** 2026-04-21
**Commit:** a69fe9d
**Branch:** main

## OVERVIEW
Browser-based idle game. Robots mow a grid-based lawn for coins, player buys upgrades. Two prestige layers: **Prestige** (spend coins → gems, +10% coin each) and **Ascend** (spend total gems earned → rubies, persistent across gem resets). Vanilla JS + Canvas2D, no framework, no build step — serve static files.

## STRUCTURE
```
.
├── index.html        # shell + script load order
├── styles.css        # all CSS
├── sim/              # Node-only balance simulator (see sim/CLAUDE.md)
└── js/               # ES modules — single `<script type="module" src="js/main.js">` entry
    ├── config.js     # CFG constants (base + live grid size), tile type enum T, OBSTACLE set, FLOWER_PALETTE, prestige/ascend thresholds + formulas
    ├── state.js     # `state` singleton, COST/MAX tables, GARDEN_DEFS, GEM_UPGRADES/RUBY_UPGRADES, applyMapDimensions, derived math (coinMult, gemShop*Mult, rubyShop*Mult), formatShort
    ├── themes.js    # THEMES palette list, activeTheme(), applyThemeDom() (lawn+stage recolor)
    ├── world.js     # grass/tiles/flowerColors typed arrays, robots[], bees[], gnomes[], moles[], spawn helpers, expandMapLive (runtime grid reallocation)
    ├── canvas.js    # canvas + ctx, tileSize, resize handler, particles[], beep() synth, flashCoin()
    ├── assets.js    # optional image/json/audio registry (Assets.register/preloadAll/image)
    ├── atmosphere.js# day/night cycle, weather (rain/snow/storm/fog), robot rivalry, takeZenPhoto
    ├── ai.js        # updateRobot, updateBee, updateGrass, updateFlowerIncome, gnome/mole hazards (tick logic)
    ├── render.js    # drawGrass, tile sprites (tree/rock/pond/flower/beehive/fountain/shed/gnome/mole-mound), drawRobot, drawBee, render()
    ├── save.js      # localStorage save/load (SAVE_KEY = lawnbotTycoonSave_v4), offline earnings modal, resetGame
    ├── ui.js        # HUD, shop rendering (bots/tools/grass/garden/crew/skins/quests/gems/rubies/prestige tabs), renderStats + openStatsModal (footer 📊 button), buy/doAscend/doPrestige handlers, toast, achievements, wireUIEvents
    └── main.js      # loop (fixed-step 1/60), init — called once at end of main.js
```

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Add a new upgrade | `UPGRADE_DEFS` in `ui.js`, `COST`/`MAX` in `state.js`, derived formula in `state.js` |
| Add a placeable garden item | `GARDEN_DEFS` in `state.js`, tile type in `config.js` `T`, sprite in `render.js`, case in `drawFeatures()` |
| Tweak economy | `CFG` in `config.js` (base rates), derived multipliers in `state.js` |
| Change robot behavior | `pickTarget` / `updateRobot` in `ai.js` |
| New tile sprite | `render.js` (add `drawX`, wire into `drawFeatures` switch) |
| Save format bump | `SAVE_KEY` constant in `save.js`, then guard `loadGame` for old shape |
| Add a theme | append to `THEMES` in `themes.js`; `applyThemeDom()` recolors stage + grass cache |
| Tweak Ascend / ruby perks | `RUBY_SHOP` in `state.js`, `rubyShop*Mult()` derived getters, `doAscend()` in `ui.js` |
| Add a shop tab | `<button data-tab="X">` in `index.html`, matching render branch in `ui.js` shop rendering, gate in `revealAscend`-style hide logic if premature |
| Tune hazards | `CFG.gnomeSpawn*` / `CFG.moleSpawn*` in `config.js`, logic in `ai.js` (evil gnomes steal treasures, moles dig mounds) |
| Propose/validate balance changes | Edit `PROPOSED` in `sim/balance.js`, run `node sim/simulate.js` |

## CONVENTIONS
- **ES modules with explicit imports/exports.** Each file has an `// ===== AUTO-IMPORTS =====` block at top and `// ===== AUTO-EXPORTS =====` block at bottom. Loaded as a single `<script type="module" src="js/main.js">`; the rest are pulled in transitively.
- **Use named exports only — no default exports.** Every cross-file symbol is named.
- **Live `let` exports for rebindable state.** `grass`, `tiles`, `flowerColors`, `grassSpecies`, `robots`, `bees`, `visitorGnomes`, `treasures`, `moles` in `world.js` and `tileSize` in `canvas.js` are exported as `let` and importers see live updates. **Reassignment must happen inside the declaring module.** External callers go through helper functions: `allocateWorldArrays()`, `clearActors()`, `restoreWorldFromSnapshot(snap)` in `world.js`; `resizeCanvas()` for `tileSize`.
- **Module evaluation is one-shot.** `main.js` runs `init()` at the bottom; `import` statements pull in every dependency exactly once before that line executes.
- **State is a single mutable `state` object** exported from `state.js`. Do not shadow it. Mutate in place.
- **Typed arrays** (`Float32Array` for `grass`, `Uint8Array` for `tiles`/`flowerColors`) indexed via `idx(x, y) = y * CFG.gridW + x`.
- **Fixed-step tick = 1/60s.** `loop()` accumulates dt, drains in TICK-sized steps. Render after each frame.
- **Coins are floats.** UI formats via `formatShort` (K/M/B/... suffixes). Only `totalTilesMowed` is integer.
- **No build, no test framework.** Verify by serving + loading in browser.

## ANTI-PATTERNS (THIS PROJECT)
- **Never reassign an imported binding from another module.** Strict mode (implicit in modules) makes this a TypeError, and even when it would silently work it desyncs other importers. Rebindable state stays in its declaring module — call a helper instead (e.g., `allocateWorldArrays()` rather than `grass = new Float32Array(...)`).
- **Don't add a new top-level `let`/`const`/`function` referenced from another file without re-running `node check_modules.mjs`** — the script will report unresolved identifiers. Add it to the `export { ... }` block at the bottom of the declaring module and to the `import { ... }` line at the top of each consumer.
- **Don't introduce circular `import`s that read a binding at module-eval time.** All cross-module access happens inside function bodies (which run after every module's top-level code finishes). If you ever need a top-level expression that reads an imported value, refactor it into a function called later. Existing cycles: `state.js ↔ ui.js`, `state.js ↔ atmosphere.js`, `state.js ↔ canvas.js`, `world.js ↔ canvas.js`, `world.js ↔ render.js`, `world.js ↔ ui.js` — all safe because every reference is inside a function.
- **Don't add obstacle tile types without updating `OBSTACLE` set** in `config.js` — robots will path through them.
- **Don't use `amend` on save-format changes.** Bump `SAVE_KEY` version instead or handle both shapes in `loadGame`.
- **Don't cache `CFG.gridW`/`gridH` at module-load time** — both are mutable via `applyMapDimensions()` (driven by the `mapExpand` gem upgrade and per-area land deeds). Read them live, or you will desync after a mid-run expansion. The immutable base is `CFG.baseGridW`/`baseGridH`.
- **Don't allocate typed arrays in `loadGame` before restoring `state.gemUpgrades`.** The grid size depends on `mapExpand`/`areaExpanded`, so the relevant state + `applyMapDimensions()` must run *before* `allocateWorldArrays()`.

## COMMANDS
```bash
# Serve (no build needed — modules require an HTTP origin, not file://)
python3 -m http.server 8765
# then open http://localhost:8765/

# Syntax-check JS after edits (modules use ES module syntax)
for f in js/*.js; do node --check --input-type=module < "$f" || echo "FAIL: $f"; done

# Static module verification — confirms every referenced identifier is declared,
# imported, or in the browser-globals allowlist. Re-run after any cross-file
# symbol change.
node check_modules.mjs

# Balance simulator (both variants, 12h sim)
node sim/simulate.js
# See sim/README.md and sim/CLAUDE.md for variant/heuristic details.
```

## NOTES
- **Offline earnings** in `loadGame` are approximate — mow rate estimated via `tilesPerSec ≈ robots × mowRate × π × (mowRadius/ts)² × 0.25`, capped at 12h, scaled 0.5× for mowing income.
- **Prestige formula (post-rebalance):** `floor((totalThisRun / 1500) ^ 0.60)`. Threshold: 7 000 coins/run. Each lifetime gem = +10% coin income (via `gemMult()` — capped/softened, see `state.js`).
- **Ascend** (ruby tier) wipes gems + coin-tier upgrades/garden/crew/grass unlocks but keeps rubies, ruby-shop perks, skins, and patterns. Threshold: 50 💎 cumulatively. Gain = `floor((totalGemsEarned / 40) ^ 0.55) × rubyShopAscendMult()`. UI tab hidden until player can first Ascend (or already has rubies) — see `revealAscend` in `ui.js`. Reset wipes rubies too (see `resetGame` in `save.js`).
- **Bees** only exist when beehives placed; `ensureBeesFromHives()` reconciles `bees[]` to `garden.beehive × CFG.beePerHive`.
- **Gnomes & moles** are hazard actors in `world.js` (`gnomes[]`, `moles[]`), driven by `ai.js` spawn timers. Evil gnomes steal dropped treasure; moles leave mounds that block tiles until Pest Control / Mole Warden crew handles them. Gnome timer is gated — `updateGnomeSpawnTimer` early-returns until `state.garden.gnome > 0` (first Garden Gnome purchased).
- **Lifetime counters** `state.prestigeCount` / `state.ascendCount` increment in `doPrestige` / `doAscend`; surfaced by the 📊 footer button (`statsBtn` → `openStatsModal` → `renderStats`, with Current Prestige vs Lifetime scope toggle).
- **`Open Door Policy` gem upgrade** (`gemUpgrades.autoQuest`) makes `showQuestOfferModal` auto-accept and skip the popup.
- **`Land Deed` gem upgrade** (`gemUpgrades.mapExpand`, 1000 💎) triples the grid in each dimension (48×30 → 144×90). Live purchase calls `expandMapLive()` in `world.js` which reallocates typed arrays, copies old world into the top-left, scatters new trees/rocks/ponds, and rescales entity positions.
- **`Weather Machine` ruby upgrade** (`rubyUpgrades.weatherControl`, 8 ♦️) turns the HUD weather pill into a clickable weather-picker. Gated in `wireUIEvents` — click handler only fires when `rubyLvl('weatherControl') > 0`.
- **Resize handler rescales robot/bee positions** when tile size changes — avoids teleporting after window resize.
- **Crit chance capped at 75%** (`critChance()` in `state.js`). Sums gnome/crew/gem/ruby bonuses. Crit multiplier is fixed at 5×.
