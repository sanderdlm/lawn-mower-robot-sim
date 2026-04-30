#!/usr/bin/env node
/* ============================================================
   Lawnbot Tycoon — economy simulator.

   Runs an auto-buying heuristic over the coin/gem/ruby economy
   defined in sim/balance.js and writes per-variant CSVs plus a
   milestone comparison table.

   Usage:
     node sim/simulate.js                     # both variants, 12h sim
     node sim/simulate.js --hours 24
     node sim/simulate.js --variant proposed  # just one
     node sim/simulate.js --seed 42

   Output:
     sim/out/current.csv, sim/out/proposed.csv
     sim/out/milestones.md
     stdout: milestone table, sanity warnings
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const { CURRENT, PROPOSED, CANDIDATE, GRID_AREA } = require('./balance.js');

// ---------- CLI ----------
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}
const SIM_HOURS = parseFloat(getArg('--hours', '12'));
const SIM_SECS = Math.floor(SIM_HOURS * 3600);
const VARIANT_FILTER = getArg('--variant', 'both');
const TICK = 1; // 1 simulated second per step

// ---------- State factory ----------
function freshState(cfg, carriedRubies, carriedRubyUpgrades) {
  const gemUpgrades = {};
  for (const k of Object.keys(cfg.GEM_UPGRADES)) gemUpgrades[k] = 0;
  const rubyUpgrades = { ...carriedRubyUpgrades };
  for (const k of Object.keys(cfg.RUBY_UPGRADES)) if (rubyUpgrades[k] == null) rubyUpgrades[k] = 0;
  const grassUnlocked = new Set(['normal']);

  return {
    // Currencies
    coins: 0,
    totalEarnedThisRun: 0,
    totalEarnedAllTime: 0,
    gems: 0,
    totalGemsEarned: 0,
    rubies: carriedRubies || 0,
    totalRubiesEarned: carriedRubies || 0,
    prestigeCount: 0,
    ascendCount: 0,

    // Upgrades
    upgrades: {
      robots: 1, speed: 0, range: 0, value: 0, growth: 0, rate: 0, crit: 0,
    },
    tool: 0, // index into cfg.TOOL_TYPES
    garden: {
      flower: 0, tree: 0, rock: 0, pond: 0, beehive: 0, fountain: 0, shed: 0, gnome: 0,
    },
    crew: new Set(),
    gemUpgrades,
    rubyUpgrades,
    grassUnlocked,

    // Tracking
    runStartT: 0,
    lastPrestigeT: 0,
    lastAscendT: 0,
    lastPrestigeYield: 0,
  };
}

// ---------- Derived economics ----------
function activeGrassMix(cfg, state) {
  // Weighted average coin multiplier over grass tiles, given which species are unlocked.
  // Normal grass fills whatever weight the rarer species don't.
  let totalWeight = 0;
  let weightedCoin = 0;
  for (const sp of cfg.GRASS) {
    if (!state.grassUnlocked.has(sp.key)) continue;
    const w = sp.key === 'normal' ? 1 : sp.spawnBase;
    totalWeight += w;
    weightedCoin += w * sp.coinMult;
  }
  // Add ambient "normal" filler so rarer grass doesn't dominate early.
  // Normal baseline weight = 50 means species take over gradually as you unlock them.
  const NORMAL_FILLER = 50;
  totalWeight += NORMAL_FILLER;
  weightedCoin += NORMAL_FILLER * 1.0;
  return weightedCoin / totalWeight;
}

function coinsPerSec(cfg, state) {
  // Capacity (grass units cut per second) = robots × mowRate × speed efficiency
  const mowRate = cfg.mowRate(state);
  const toolMult = cfg.TOOL_TYPES[state.tool].rateMult;
  const speed = cfg.robotSpeed(state);
  const speedFactor = Math.min(1, speed / (cfg.mowSpeedBase * 1.5));
  const capacity = state.upgrades.robots * mowRate * toolMult * speedFactor;

  // Supply (grass units grown per second across the grid)
  const growth = cfg.growthRate(state);
  const supply = GRID_AREA * growth;

  // Actual throughput bounded by supply
  const throughput = Math.min(capacity, supply);

  const avgSpeciesMult = activeGrassMix(cfg, state);
  const coinPer = cfg.coinPerUnitBase * cfg.coinMult(state) * avgSpeciesMult;

  // Flower passive income
  const flowerIncome = state.garden.flower * 0.35 * cfg.coinMult(state);

  return throughput * coinPer + flowerIncome;
}

// ---------- Purchase heuristic ----------
// Enumerate every buyable thing, estimate delta coins/sec per coin cost, buy best ROI.

function upgradeOptions(cfg, state) {
  const options = [];
  const base = coinsPerSec(cfg, state);

  // Helper: try an upgrade, measure delta, then revert.
  function tryDelta(applyFn, revertFn, cost, label) {
    if (!isFinite(cost) || cost <= 0) return;
    applyFn();
    const after = coinsPerSec(cfg, state);
    revertFn();
    const delta = after - base;
    if (delta <= 0) return;
    options.push({ label, cost, delta, roi: delta / cost });
  }

  // Coin-upgrade tiers
  for (const key of Object.keys(cfg.COST)) {
    const lvl = state.upgrades[key];
    if (lvl >= cfg.MAX[key]) continue;
    const cost = cfg.COST[key](lvl);
    tryDelta(
      () => { state.upgrades[key] = lvl + 1; },
      () => { state.upgrades[key] = lvl; },
      cost, `upgrade:${key}->${lvl + 1}`
    );
  }

  // Tool tier
  const nextTool = cfg.TOOL_TYPES[state.tool + 1];
  if (nextTool) {
    tryDelta(
      () => { state.tool += 1; },
      () => { state.tool -= 1; },
      nextTool.cost, `tool:${nextTool.name}`
    );
  }

  // Garden
  for (const [key, def] of Object.entries(cfg.GARDEN)) {
    if (state.garden[key] >= def.max) continue;
    const cost = Math.ceil(def.baseCost * Math.pow(def.mult, state.garden[key]));
    tryDelta(
      () => { state.garden[key] += 1; },
      () => { state.garden[key] -= 1; },
      cost, `garden:${key}->${state.garden[key] + 1}`
    );
  }

  // Grass species coin-unlock
  for (const sp of cfg.GRASS) {
    if (sp.gemGated || state.grassUnlocked.has(sp.key) || !sp.unlockCost) continue;
    tryDelta(
      () => { state.grassUnlocked.add(sp.key); },
      () => { state.grassUnlocked.delete(sp.key); },
      sp.unlockCost, `grass:${sp.key}`
    );
  }

  return options;
}

function bestCoinBuy(cfg, state) {
  const opts = upgradeOptions(cfg, state);
  if (!opts.length) return null;
  // Sort by payback time = cost / delta_cps (shortest first).
  opts.sort((a, b) => (a.cost / a.delta) - (b.cost / b.delta));

  // Strategy: commit to the #1 shortest-payback option. If unaffordable, save
  // for it — but still buy any incidental option costing ≤10% of it (keeps
  // the "buy small things while saving" feel without derailing big goals).
  const target = opts[0];
  if (target.cost <= state.coins) return target;

  const cheapLimit = Math.min(target.cost * 0.10, state.coins);
  for (const o of opts) {
    if (o === target) continue;
    if (o.cost <= cheapLimit) return o;
  }
  return null; // wait
}

// Apply a coin-buy option. Assumes affordability already checked.
function applyBuy(cfg, state, opt) {
  state.coins -= opt.cost;
  const [kind, rest] = opt.label.split(':');
  if (kind === 'upgrade') {
    const key = rest.split('->')[0];
    state.upgrades[key] += 1;
  } else if (kind === 'tool') {
    state.tool += 1;
  } else if (kind === 'garden') {
    const key = rest.split('->')[0];
    state.garden[key] += 1;
  } else if (kind === 'grass') {
    state.grassUnlocked.add(rest);
  }
}

// ---------- Gem / Ruby shop decisions ----------
// Heuristic: after prestige, spend gems on Midas (coinMult) and grassUnlocks in priority order.
function spendGems(cfg, state) {
  // Priority: unlock obsidian → frost → void → max coinMult → growth → prestigeBoost
  const order = ['grassObsidian', 'grassFrost', 'grassVoid', 'coinMult', 'growth', 'prestigeBoost', 'crit', 'startCoins'];
  let bought = true;
  while (bought) {
    bought = false;
    for (const key of order) {
      const def = cfg.GEM_UPGRADES[key];
      if (!def) continue;
      const lvl = state.gemUpgrades[key];
      if (lvl >= def.max) continue;
      const cost = Math.ceil(def.baseCost * Math.pow(def.growth, lvl));
      if (cost > state.gems) continue;
      state.gems -= cost;
      state.gemUpgrades[key] = lvl + 1;
      if (key === 'grassObsidian') state.grassUnlocked.add('obsidian');
      if (key === 'grassFrost')    state.grassUnlocked.add('frost');
      if (key === 'grassVoid')     state.grassUnlocked.add('void');
      bought = true;
    }
  }
}

function spendRubies(cfg, state) {
  const order = ['coinMult', 'speed', 'growth', 'prestigeGemBoost', 'ascendBoost'];
  let bought = true;
  while (bought) {
    bought = false;
    for (const key of order) {
      const def = cfg.RUBY_UPGRADES[key];
      if (!def) continue;
      const lvl = state.rubyUpgrades[key];
      if (lvl >= def.max) continue;
      const cost = Math.ceil(def.baseCost * Math.pow(def.growth, lvl));
      if (cost > state.rubies) continue;
      state.rubies -= cost;
      state.rubyUpgrades[key] = lvl + 1;
      bought = true;
    }
  }
}

// ---------- Prestige / Ascend decisions ----------
function maybePrestige(cfg, state, tSec) {
  if (state.totalEarnedThisRun < cfg.prestigeThreshold) return false;
  const yieldGems = Math.floor(
    cfg.prestigeFormula(state.totalEarnedThisRun)
    * cfg.gemShopPrestigeMult(state.gemUpgrades.prestigeBoost || 0)
    * cfg.rubyShopPrestigeMult(state.rubyUpgrades.prestigeGemBoost || 0)
  );
  if (yieldGems < 1) return false;

  // Hard cadence: no prestige in the first 5 minutes of a run (lets the
  // economy build real upgrades, not just flip the threshold).
  const runDuration = tSec - state.runStartT;
  if (runDuration < 300) return false;

  // Commit when yield would at least double last prestige's yield, OR
  // we've been running the same prestige for 45+ sim-minutes (stuck).
  const stuck = runDuration > 2700;
  const yieldy = yieldGems >= 2 * Math.max(1, state.lastPrestigeYield);
  if (!stuck && !yieldy && state.prestigeCount > 0) return false;

  doPrestige(cfg, state, tSec, yieldGems);
  return true;
}

function doPrestige(cfg, state, tSec, yieldGems) {
  state.gems += yieldGems;
  state.totalGemsEarned += yieldGems;
  state.prestigeCount += 1;
  state.lastPrestigeYield = yieldGems;
  state.lastPrestigeT = tSec;

  // Spend gems immediately.
  spendGems(cfg, state);

  // Reset coin-tier progress.
  const keepGems = state.gems;
  const keepTotalGemsEarned = state.totalGemsEarned;
  const keepTotalAllTime = state.totalEarnedAllTime;
  const keepRubies = state.rubies;
  const keepTotalRubiesEarned = state.totalRubiesEarned;
  const keepGemUpgrades = state.gemUpgrades;
  const keepRubyUpgrades = state.rubyUpgrades;
  const keepGrassUnlocked = new Set(state.grassUnlocked);
  const keepPrestigeCount = state.prestigeCount;
  const keepAscendCount = state.ascendCount;
  const keepLastPrestigeT = state.lastPrestigeT;
  const keepLastPrestigeYield = state.lastPrestigeYield;
  const keepLastAscendT = state.lastAscendT;

  // Reset coin-tier grass (non-gem-gated) unlocks.
  for (const sp of cfg.GRASS) {
    if (!sp.gemGated && sp.key !== 'normal') keepGrassUnlocked.delete(sp.key);
  }

  const fresh = freshState(cfg, keepRubies, keepRubyUpgrades);
  Object.assign(state, fresh);
  state.gems = keepGems;
  state.totalGemsEarned = keepTotalGemsEarned;
  state.totalEarnedAllTime = keepTotalAllTime;
  state.rubies = keepRubies;
  state.totalRubiesEarned = keepTotalRubiesEarned;
  state.gemUpgrades = keepGemUpgrades;
  state.rubyUpgrades = keepRubyUpgrades;
  state.grassUnlocked = keepGrassUnlocked;
  state.prestigeCount = keepPrestigeCount;
  state.ascendCount = keepAscendCount;
  state.lastPrestigeT = keepLastPrestigeT;
  state.lastPrestigeYield = keepLastPrestigeYield;
  state.lastAscendT = keepLastAscendT;
  state.runStartT = tSec;

  // Starting coins from gem shop.
  state.coins = cfg.startingCoinsFor(state.gemUpgrades.startCoins || 0);
}

function maybeAscend(cfg, state, tSec) {
  if (state.totalGemsEarned < cfg.ascendThreshold) return false;
  const yieldRubies = Math.floor(
    cfg.ascendFormula(state.totalGemsEarned)
    * cfg.rubyShopAscendMult(state.rubyUpgrades.ascendBoost || 0)
  );
  if (yieldRubies < 1) return false;

  // Ascend when yield ≥ 2× current rubies, at least 3h of real time since last,
  // and we've had at least 10 prestiges this ruby-cycle. Ascend is a big reset
  // so the bar should be meaningfully higher than prestige.
  const timeSinceAscend = tSec - state.lastAscendT;
  const prestigesThisCycle = state.prestigeCount - (state.ascendCount > 0 ? state.prestigesAtLastAscend || 0 : 0);
  const stuck = timeSinceAscend > 10800; // 3h
  const yieldy = yieldRubies >= 2 * Math.max(1, state.rubies) && prestigesThisCycle >= 10;
  if (!stuck && !yieldy && state.ascendCount > 0) return false;
  if (state.ascendCount === 0 && prestigesThisCycle < 8) return false;

  state.rubies += yieldRubies;
  state.totalRubiesEarned += yieldRubies;
  state.ascendCount += 1;
  state.lastAscendT = tSec;
  state.prestigesAtLastAscend = state.prestigeCount;

  spendRubies(cfg, state);

  // Full wipe except rubies + rubyUpgrades.
  const keepRubies = state.rubies;
  const keepTotalRubiesEarned = state.totalRubiesEarned;
  const keepRubyUpgrades = state.rubyUpgrades;
  const keepPrestigeCount = state.prestigeCount;
  const keepAscendCount = state.ascendCount;

  const fresh = freshState(cfg, keepRubies, keepRubyUpgrades);
  Object.assign(state, fresh);
  state.totalRubiesEarned = keepTotalRubiesEarned;
  state.prestigeCount = keepPrestigeCount;
  state.ascendCount = keepAscendCount;
  state.runStartT = tSec;
  state.lastAscendT = tSec;
  state.lastPrestigeT = tSec;
  state.lastPrestigeYield = 0;

  return true;
}

// ---------- Main simulation loop ----------
function runSim(cfg) {
  const state = freshState(cfg, 0, {});
  const samples = []; // { t, cps, totalEarned, gems, rubies, event }
  const milestones = {};
  const events = [];

  function recordMilestone(key, t) {
    if (milestones[key] == null) milestones[key] = t;
  }

  const SAMPLE_EVERY = 10; // seconds

  for (let t = 0; t < SIM_SECS; t += TICK) {
    const cps = coinsPerSec(cfg, state);
    state.coins += cps * TICK;
    state.totalEarnedThisRun += cps * TICK;
    state.totalEarnedAllTime += cps * TICK;

    // Buy everything affordable this tick (greedy ROI loop, max 20 buys/tick).
    let buys = 0;
    while (buys < 20) {
      const opt = bestCoinBuy(cfg, state);
      if (!opt || opt.cost > state.coins) break;
      const labelBefore = opt.label;
      applyBuy(cfg, state, opt);
      events.push({ t, label: labelBefore });
      // Record milestones
      if (labelBefore.startsWith('grass:')) recordMilestone(labelBefore, t);
      if (labelBefore.startsWith('tool:'))  recordMilestone(labelBefore, t);
      if (labelBefore === 'upgrade:robots->2') recordMilestone('2-robots', t);
      if (labelBefore === 'upgrade:robots->5') recordMilestone('5-robots', t);
      if (labelBefore === 'upgrade:robots->10') recordMilestone('10-robots', t);
      buys++;
    }

    // Prestige / Ascend checks (after each tick)
    if (maybePrestige(cfg, state, t)) {
      events.push({ t, label: `prestige-${state.prestigeCount}` });
      recordMilestone(`prestige-${state.prestigeCount}`, t);
    }
    if (maybeAscend(cfg, state, t)) {
      events.push({ t, label: `ascend-${state.ascendCount}` });
      recordMilestone(`ascend-${state.ascendCount}`, t);
    }

    // Sample for CSV
    if (t % SAMPLE_EVERY === 0) {
      samples.push({
        t,
        cps: Math.max(cps, 1e-9),
        totalEarned: state.totalEarnedAllTime,
        gems: state.totalGemsEarned,
        rubies: state.totalRubiesEarned,
      });
    }
  }

  return { samples, events, milestones, finalState: state };
}

// ---------- Output ----------
function writeCsv(file, samples, events) {
  const eventsAt = new Map();
  for (const e of events) {
    const key = Math.floor(e.t / 10) * 10;
    if (!eventsAt.has(key)) eventsAt.set(key, []);
    eventsAt.get(key).push(e.label);
  }
  const lines = ['t_sec,coins_per_sec,total_earned,total_gems_earned,total_rubies_earned,events'];
  for (const s of samples) {
    const ev = (eventsAt.get(s.t) || []).join('|');
    lines.push(`${s.t},${s.cps.toFixed(2)},${s.totalEarned.toFixed(2)},${s.gems},${s.rubies},${ev}`);
  }
  fs.writeFileSync(file, lines.join('\n'));
}

function fmtTime(sec) {
  if (sec == null) return 'never';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${(sec / 60).toFixed(1)}m`;
  return `${(sec / 3600).toFixed(2)}h`;
}

function fmtShort(n) {
  if (!isFinite(n)) return '∞';
  const abs = Math.abs(n);
  if (abs < 1000) return n.toFixed(1);
  const suffixes = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc'];
  let i = 0; let v = n;
  while (Math.abs(v) >= 1000 && i < suffixes.length - 1) { v /= 1000; i++; }
  return v.toFixed(v < 10 ? 2 : 1) + suffixes[i];
}

// ASCII plot of log10(cps) envelope vs time. Width chars wide, 10 rows tall.
function asciiEnvelope(samples, label, width = 70, height = 12) {
  let peak = 0;
  const env = samples.map(s => { if (s.cps > peak) peak = s.cps; return { t: s.t, cps: peak }; });
  const tMax = env[env.length - 1].t || 1;
  const logs = env.map(e => Math.log10(Math.max(1, e.cps)));
  const yMin = 0;
  const yMax = Math.max(...logs, 1);
  const grid = Array.from({ length: height }, () => Array(width).fill(' '));
  for (const e of env) {
    const x = Math.min(width - 1, Math.floor((e.t / tMax) * (width - 1)));
    const y = Math.min(height - 1, Math.floor(((Math.log10(Math.max(1, e.cps)) - yMin) / (yMax - yMin || 1)) * (height - 1)));
    grid[height - 1 - y][x] = '█';
  }
  const rows = grid.map(r => r.join(''));
  const header = `  log₁₀(coins/sec) envelope — ${label}`;
  const top = `  ${yMax.toFixed(1)} ┤`;
  const bot = `  ${yMin.toFixed(1)} ┤`;
  const axis = `      └${'─'.repeat(width)}`;
  const labelAxis = `       0h${' '.repeat(Math.max(0, width - 10))}${(tMax / 3600).toFixed(1)}h`;
  return [
    header,
    top + rows[0],
    ...rows.slice(1, -1).map(r => '      │' + r),
    bot + rows[rows.length - 1],
    axis,
    labelAxis,
  ].join('\n');
}
// Uses the running-max envelope of cps (prestiges reset coins/upgrades so
// raw cps sawtooths — the envelope is the meaningful progression curve).
function logLinearityR2(samples, minTime = 1800) {
  // Exclude the early ramp (first 30 min default): the opening climb from
  // 0 cps is inherently super-linear and dominates a naive fit, masking
  // whether mid/late game is linear on log-scale.
  const pts = [];
  let peak = 0;
  for (const s of samples) {
    if (s.cps > peak) peak = s.cps;
    if (s.t >= minTime && peak > 1) pts.push({ t: s.t, cps: peak });
  }
  if (pts.length < 10) return null;
  const xs = pts.map(p => p.t);
  const ys = pts.map(p => Math.log10(p.cps));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const r = sxy / Math.sqrt(sxx * syy);
  const slope = sxy / sxx; // log10 units per sec
  return { r2: r * r, slope, doublingHours: Math.log10(2) / slope / 3600 };
}

function summarizeVariant(label, result) {
  const m = result.milestones;
  const fs = result.finalState;
  const last = result.samples[result.samples.length - 1];
  const lin = logLinearityR2(result.samples);
  return {
    label,
    first_prestige: m['prestige-1'],
    second_prestige: m['prestige-2'],
    fifth_prestige: m['prestige-5'],
    tenth_prestige: m['prestige-10'],
    first_ascend: m['ascend-1'],
    tool_pro: m['tool:Pro Mower X1'],
    tool_industrial: m['tool:Industrial Beast'],
    grass_crystal: m['grass:crystal'],
    grass_golden: m['grass:golden'],
    final_cps: last.cps,
    final_total: last.totalEarned,
    total_gems: fs.totalGemsEarned,
    total_rubies: fs.totalRubiesEarned,
    prestiges: fs.prestigeCount,
    ascends: fs.ascendCount,
    logLinear_r2: lin ? lin.r2.toFixed(3) : 'n/a',
    doubling_hours: lin ? lin.doublingHours.toFixed(2) : 'n/a',
  };
}

function renderTable(summaries) {
  const rows = [
    ['Metric', ...summaries.map(s => s.label)],
    ['First prestige',          ...summaries.map(s => fmtTime(s.first_prestige))],
    ['Second prestige',         ...summaries.map(s => fmtTime(s.second_prestige))],
    ['Fifth prestige',          ...summaries.map(s => fmtTime(s.fifth_prestige))],
    ['Tenth prestige',          ...summaries.map(s => fmtTime(s.tenth_prestige))],
    ['First ascend',            ...summaries.map(s => fmtTime(s.first_ascend))],
    ['Pro Mower X1',            ...summaries.map(s => fmtTime(s.tool_pro))],
    ['Industrial Beast',        ...summaries.map(s => fmtTime(s.tool_industrial))],
    ['Crystal Grass unlock',    ...summaries.map(s => fmtTime(s.grass_crystal))],
    ['Golden Grass unlock',     ...summaries.map(s => fmtTime(s.grass_golden))],
    ['Final coins/sec',         ...summaries.map(s => fmtShort(s.final_cps))],
    ['Final total earned',      ...summaries.map(s => fmtShort(s.final_total))],
    ['Lifetime gems',           ...summaries.map(s => fmtShort(s.total_gems))],
    ['Lifetime rubies',         ...summaries.map(s => fmtShort(s.total_rubies))],
    ['Prestiges',               ...summaries.map(s => s.prestiges)],
    ['Ascends',                 ...summaries.map(s => s.ascends)],
    ['log10(cps)~t R²',         ...summaries.map(s => s.logLinear_r2)],
    ['Doubling time (hrs)',     ...summaries.map(s => s.doubling_hours)],
  ];
  const widths = rows[0].map((_, col) =>
    Math.max(...rows.map(r => String(r[col]).length))
  );
  return rows.map(r =>
    '| ' + r.map((v, i) => String(v).padEnd(widths[i])).join(' | ') + ' |'
  ).join('\n');
}

// ---------- Entry point ----------
function main() {
  const variants = [];
  if (VARIANT_FILTER === 'both' || VARIANT_FILTER === 'current')   variants.push(CURRENT);
  if (VARIANT_FILTER === 'both' || VARIANT_FILTER === 'proposed')  variants.push(PROPOSED);
  if (VARIANT_FILTER === 'candidate' || VARIANT_FILTER === 'all')  variants.push(CANDIDATE);
  if (VARIANT_FILTER === 'all') { variants.length = 0; variants.push(CURRENT, PROPOSED, CANDIDATE); }

  const outDir = path.join(__dirname, 'out');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log(`\nSimulating ${SIM_HOURS}h of play for variant(s): ${variants.map(v => v.label).join(', ')}\n`);

  const summaries = [];
  const results = [];
  for (const cfg of variants) {
    const t0 = Date.now();
    const result = runSim(cfg);
    const dt = Date.now() - t0;
    writeCsv(path.join(outDir, `${cfg.label}.csv`), result.samples, result.events);
    summaries.push(summarizeVariant(cfg.label, result));
    results.push({ cfg, result });
    console.log(`  ${cfg.label}: ${result.events.length} events, ${result.samples.length} samples, ${dt}ms`);
  }

  const table = renderTable(summaries);
  console.log('\n' + table + '\n');

  // ASCII envelope charts per variant.
  for (const { cfg, result } of results) {
    console.log('\n' + asciiEnvelope(result.samples, cfg.label));
  }
  console.log('');

  fs.writeFileSync(path.join(outDir, 'milestones.md'),
    `# Simulator milestones\n\nSimulated ${SIM_HOURS} hours of auto-played progression.\n\n${table}\n`);

  // Sanity warnings
  for (const s of summaries) {
    if (s.logLinear_r2 !== 'n/a' && parseFloat(s.logLinear_r2) < 0.70) {
      console.log(`⚠ ${s.label}: log(cps) is NOT linear in t (R²=${s.logLinear_r2}). Curve has bumps/plateaus — investigate.`);
    }
    if (s.doubling_hours !== 'n/a') {
      const dh = parseFloat(s.doubling_hours);
      if (dh < 0.05) console.log(`⚠ ${s.label}: income doubles every ${dh.toFixed(3)}h — runaway growth.`);
      if (dh > 4)    console.log(`⚠ ${s.label}: income doubles every ${dh.toFixed(2)}h — stagnant, player will quit.`);
    }
  }

  console.log(`\nCSVs + milestones.md written to ${outDir}\n`);
}

main();
