# sim/ — Lawnbot Tycoon balance simulator

Node.js economy simulator. No dependencies, no build.

## Usage

```bash
node sim/simulate.js                     # both variants, 12h sim
node sim/simulate.js --hours 24          # longer sim
node sim/simulate.js --variant proposed  # single variant
node sim/simulate.js --variant current
```

## What it does

Runs an auto-buying heuristic player through the game economy and records a
per-second simulation of coins, gems, and rubies. Two balance variants are
defined in `balance.js`:

- **current** — the numbers as shipped in `js/config.js` / `js/state.js`.
- **proposed** — the candidate rebalance numbers under evaluation.

The simulator models:

- Coin income (mow capacity × supply-limited growth × coin multipliers × weighted grass species mix)
- Flower passive income
- All shop upgrades (robots, speed, range, value, growth, rate, crit) + tools + garden
- Coin-unlock grass species
- Prestige (with gem spend on Midas / growth / grass unlocks / etc.)
- Ascend (with ruby spend on coinMult / speed / growth / prestige/ascend boosts)

It does **not** model: hazards (gnomes, moles), weather, crew skills beyond
efficiency/foreman, quests, fuel. Those are treated as noise; if they shift
balance by ≥10% we'd need to extend.

## Purchasing heuristic

Greedy **shortest payback time** (cost / Δcoins-per-sec). Commits to the
best-payback target; while saving for it, also buys incidentals costing ≤10%
of the target. Mirrors real-player behavior of "save for the big thing but
grab obvious cheap wins along the way."

## Prestige / ascend heuristic

- **Prestige** when gem yield would ≥2× last prestige's yield, or run has
  lasted 45+ sim-minutes. First prestige requires ≥5 min in the run.
- **Ascend** when ruby yield would ≥2× current rubies AND ≥10 prestiges this
  cycle, or 3h since last ascend. First ascend requires ≥8 prestiges.

These are deliberately conservative. Real players might prestige more eagerly
once they've internalized the loop; the sim under-counts by design.

## Output

- `out/current.csv`, `out/proposed.csv` — per-10-second samples.
  Columns: `t_sec, coins_per_sec, total_earned, total_gems_earned, total_rubies_earned, events`
- `out/milestones.md` — comparison table.
- stdout:
  - Milestone comparison table
  - ASCII envelope plots of `log₁₀(coins/sec)` vs time
  - Sanity warnings (runaway growth, stagnation, plateaus)

## Interpreting metrics

| Metric | Good | Concerning |
| --- | --- | --- |
| Doubling time (hrs) | 1–3 h | <0.3h = runaway · >5h = stagnant |
| log₁₀(cps)~t R² (envelope) | >0.8 = smooth climb · 0.5–0.8 = tier-stepped (fine) | <0.4 = jagged with bad plateaus |
| First prestige | 10–20 min | <5 min = trivial · >45 min = grindy |
| First ascend | 2–5 hrs | <1 h = trivial · >8 h = invisible wall |

The envelope chart is the most honest signal — it shows peak income over time,
ignoring the sawtooth of prestige resets.

## Extending balance.js

Add a variant by copying `PROPOSED`, overriding only the deltas you want to
test. Then wire it into `simulate.js`'s `VARIANT_FILTER`. Keep variants self-
contained (no shared mutable objects).
