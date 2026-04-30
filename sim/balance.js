/* ============================================================
   Lawnbot Tycoon — balance variants for simulator.
   Pure data + formula functions. No game state, no DOM.

   Export CURRENT (shipped numbers from config.js/state.js) and
   PROPOSED (tweaked numbers under evaluation). The simulator swaps
   between them to produce side-by-side projections.

   Keep this file in lock-step with:
     - js/config.js    (CFG)
     - js/state.js     (COST, MAX, GARDEN_DEFS, GRASS_TYPES,
                        TOOL_TYPES, GEM_UPGRADES, RUBY_UPGRADES,
                        derived getters)
   ============================================================ */

'use strict';

// ---------- Shared constants (grid, bases). Do not vary by variant. ----------
const GRID_W = 48;
const GRID_H = 30;
const GRID_AREA = GRID_W * GRID_H;

// ---------- CURRENT (as shipped on main) ----------
const CURRENT = {
  label: 'current',

  // --- Core rates (CFG) ---
  growthRateBase: 0.013,
  mowSpeedBase: 90,
  mowRadiusBase: 14,         // px — tiles calculated via tileSize
  mowRateBase: 1.6,
  coinPerUnitBase: 1.0,

  prestigeThreshold: 10000,
  prestigeFormula: (run) => Math.floor(Math.pow(run / 2500, 0.55)),
  ascendThreshold: 50,
  ascendFormula: (g) => Math.floor(Math.pow(g / 50, 0.5)),

  // --- gemMult: linear in lifetime gems ---
  gemMult: (totalGemsEarned) => 1 + totalGemsEarned * 0.10,

  // --- Coin multiplier composition (multiplicative across every bucket) ---
  //     coinMult = (1 + value*0.15) * gemMult * fountainMult * rockMult
  //              * crewCoinMult * gemShopCoinMult * rubyShopCoinMult
  coinMult({ upgrades, garden, crew, gemUpgrades, rubyUpgrades, totalGemsEarned }) {
    const value      = 1 + upgrades.value * 0.15;
    const fountain   = 1 + garden.fountain * 0.08;
    const rock       = 1 + garden.rock * 0.005;
    const efficiency = crew.has('efficiency') ? 1.10 : 1;
    const gemShop    = 1 + (gemUpgrades.coinMult || 0) * 0.05;
    const rubyShop   = 1 + (rubyUpgrades.coinMult || 0) * 0.10;
    return value * this.gemMult(totalGemsEarned) * fountain * rock * efficiency * gemShop * rubyShop;
  },

  growthRate({ upgrades, garden, gemUpgrades, rubyUpgrades }) {
    const gemGrowth  = 1 + (gemUpgrades.growth || 0) * 0.03;
    const rubyGrowth = 1 + (rubyUpgrades.growth || 0) * 0.10;
    const treeGrowth = garden.tree * 0.01 + garden.pond * 0.03;
    return this.growthRateBase
      * (1 + upgrades.growth * 0.12 + treeGrowth)
      * gemGrowth
      * rubyGrowth;
  },

  mowRate({ upgrades, crew }) {
    const crewMult = crew.has('efficiency') ? 1.20 : 1;
    return this.mowRateBase * (1 + upgrades.rate * 0.15) * crewMult;
  },

  robotSpeed({ upgrades, garden, crew, rubyUpgrades }) {
    const shed     = 1 + garden.shed * 0.05;
    const foreman  = crew.has('foreman') ? 1.05 : 1;
    const rubySpd  = 1 + (rubyUpgrades.speed || 0) * 0.15;
    return this.mowSpeedBase * (1 + upgrades.speed * 0.10) * shed * foreman * rubySpd;
  },

  // --- Upgrade shop costs (COST/MAX) ---
  COST: {
    robots:  (n) => Math.ceil(25  * Math.pow(1.45, n - 1)),
    speed:   (n) => Math.ceil(40  * Math.pow(1.35, n)),
    range:   (n) => Math.ceil(60  * Math.pow(1.40, n)),
    value:   (n) => Math.ceil(80  * Math.pow(1.42, n)),
    growth:  (n) => Math.ceil(120 * Math.pow(1.45, n)),
    rate:    (n) => Math.ceil(150 * Math.pow(1.40, n)),
    crit:    (n) => Math.ceil(500 * Math.pow(1.55, n)),
  },
  MAX: {
    robots: 50, speed: 120, range: 60, value: 120, growth: 80, rate: 80, crit: 40,
  },

  TOOL_TYPES: [
    { name: 'Rusty Scissors',   rateMult: 1.0,  cost: 0 },
    { name: 'Hedge Shears',     rateMult: 2.0,  cost: 250 },
    { name: 'Push Mower',       rateMult: 3.6,  cost: 1800 },
    { name: 'Electric Trimmer', rateMult: 6.0,  cost: 9000 },
    { name: 'Pro Mower X1',     rateMult: 10.0, cost: 45000 },
    { name: 'Industrial Beast', rateMult: 18.0, cost: 200000 },
  ],

  // --- Garden (additive quantity, multiplicative effect) ---
  GARDEN: {
    flower:   { baseCost: 150,   mult: 1.28, max: 80 },
    tree:     { baseCost: 500,   mult: 1.40, max: 40 },
    rock:     { baseCost: 250,   mult: 1.32, max: 40 },
    pond:     { baseCost: 3000,  mult: 1.60, max: 10 },
    beehive:  { baseCost: 3000,  mult: 1.60, max: 12 },
    fountain: { baseCost: 10000, mult: 1.75, max: 10 },
    shed:     { baseCost: 4000,  mult: 1.55, max: 15 },
    gnome:    { baseCost: 1800,  mult: 1.50, max: 20 },
  },

  // --- Grass species (coin mult per mow) ---
  GRASS: [
    { key: 'normal',   coinMult: 1.0,   toughness: 1,   spawnBase: 0,     unlockCost: 0,       gemGated: false },
    { key: 'clover',   coinMult: 2.2,   toughness: 1.6, spawnBase: 12,    unlockCost: 3500,    gemGated: false },
    { key: 'thick',    coinMult: 4.0,   toughness: 2.4, spawnBase: 7,     unlockCost: 18000,   gemGated: false },
    { key: 'crystal',  coinMult: 9.0,   toughness: 4,   spawnBase: 3,     unlockCost: 110000,  gemGated: false },
    { key: 'golden',   coinMult: 22.0,  toughness: 7,   spawnBase: 1,     unlockCost: 650000,  gemGated: false },
    { key: 'obsidian', coinMult: 55.0,  toughness: 12,  spawnBase: 0.6,   gemUnlockCost: 15,   gemGated: true },
    { key: 'frost',    coinMult: 140.0, toughness: 20,  spawnBase: 0.3,   gemUnlockCost: 40,   gemGated: true },
    { key: 'void',     coinMult: 360.0, toughness: 35,  spawnBase: 0.12,  gemUnlockCost: 100,  gemGated: true },
  ],

  // --- Gem shop (costs in gems) ---
  GEM_UPGRADES: {
    coinMult:    { max: 20, baseCost: 2, growth: 1.35 },
    growth:      { max: 15, baseCost: 2, growth: 1.35 },
    crit:        { max: 15, baseCost: 3, growth: 1.40 },
    startCoins:  { max: 10, baseCost: 1, growth: 1.60 },
    prestigeBoost:{ max: 10, baseCost: 4, growth: 1.50 },
    grassObsidian:{ max: 1, baseCost: 15, growth: 1 },
    grassFrost:   { max: 1, baseCost: 40, growth: 1 },
    grassVoid:    { max: 1, baseCost: 100, growth: 1 },
  },
  startingCoinsFor: (lvl) => lvl ? 250 * (Math.pow(2, lvl) - 1) : 0,
  gemShopPrestigeMult: (lvl) => 1 + lvl * 0.10,

  // --- Ruby shop (costs in rubies) ---
  RUBY_UPGRADES: {
    coinMult:        { max: 30, baseCost: 1, growth: 1.6 },
    speed:           { max: 10, baseCost: 2, growth: 1.9 },
    growth:          { max: 10, baseCost: 2, growth: 1.7 },
    prestigeGemBoost:{ max: 10, baseCost: 3, growth: 1.9 },
    ascendBoost:     { max: 10, baseCost: 4, growth: 2.0 },
  },
  rubyShopPrestigeMult: (lvl) => 1 + lvl * 0.25,
  rubyShopAscendMult:   (lvl) => 1 + lvl * 0.15,
};

// ---------- PROPOSED (rebalance candidate) ----------
// Copy CURRENT first, then overlay the proposed deltas. Keeps diff readable.
const PROPOSED = {
  ...CURRENT,
  label: 'proposed',

  // §3.3 Prestige threshold + formula
  prestigeThreshold: 7000,
  prestigeFormula: (run) => Math.floor(Math.pow(run / 1500, 0.60)),
  ascendFormula: (g) => Math.floor(Math.pow(g / 40, 0.55)),

  // §3.1 gemMult — tuned via simulator (4 iterations).
  // Doubling 1.63h, R² 0.847, no plateaus >10min.
  gemMult: (g) => 1 + 0.35 * Math.pow(g, 0.65),

  // §3.2 Additive coin bucket (value + fountain + rock + crew + gemShop + rubyShop),
  //      multiplied ONLY by gemMult. Species mult still applies per-tile downstream.
  coinMult({ upgrades, garden, crew, gemUpgrades, rubyUpgrades, totalGemsEarned }) {
    const add =
        upgrades.value * 0.15
      + garden.fountain * 0.08
      + garden.rock * 0.005
      + (crew.has('efficiency') ? 0.10 : 0)
      + (gemUpgrades.coinMult || 0) * 0.08
      + (rubyUpgrades.coinMult || 0) * 0.10;
    return (1 + add) * this.gemMult(totalGemsEarned);
  },
  growthRate({ upgrades, garden, gemUpgrades, rubyUpgrades }) {
    const gemGrowth  = 1 + (gemUpgrades.growth || 0) * 0.05;
    const rubyGrowth = 1 + (rubyUpgrades.growth || 0) * 0.10;
    const treeGrowth = garden.tree * 0.01 + garden.pond * 0.03;
    return this.growthRateBase
      * (1 + upgrades.growth * 0.12 + treeGrowth)
      * gemGrowth
      * rubyGrowth;
  },

  // §3.8 Shed coefficient tightening
  robotSpeed({ upgrades, garden, crew, rubyUpgrades }) {
    const shed    = 1 + garden.shed * 0.03;
    const foreman = crew.has('foreman') ? 1.05 : 1;
    const rubySpd = 1 + (rubyUpgrades.speed || 0) * 0.15;
    return this.mowSpeedBase * (1 + upgrades.speed * 0.10) * shed * foreman * rubySpd;
  },

  // §3.5 Grass species compression
  GRASS: [
    { key: 'normal',   coinMult: 1.0,   toughness: 1,   spawnBase: 0,    unlockCost: 0,      gemGated: false },
    { key: 'clover',   coinMult: 2.0,   toughness: 1.6, spawnBase: 12,   unlockCost: 3500,   gemGated: false },
    { key: 'thick',    coinMult: 3.5,   toughness: 2.4, spawnBase: 7,    unlockCost: 18000,  gemGated: false },
    { key: 'crystal',  coinMult: 7.0,   toughness: 4,   spawnBase: 3,    unlockCost: 110000, gemGated: false },
    { key: 'golden',   coinMult: 16.0,  toughness: 7,   spawnBase: 1,    unlockCost: 650000, gemGated: false },
    { key: 'obsidian', coinMult: 35.0,  toughness: 12,  spawnBase: 0.6,  gemUnlockCost: 10,  gemGated: true },
    { key: 'frost',    coinMult: 75.0,  toughness: 20,  spawnBase: 0.3,  gemUnlockCost: 25,  gemGated: true },
    { key: 'void',     coinMult: 150.0, toughness: 35,  spawnBase: 0.12, gemUnlockCost: 60,  gemGated: true },
  ],

  // §3.9 Linear starting-coins upgrade (was 250*(2^L-1))
  startingCoinsFor: (lvl) => lvl * 500,

  // §3.4 Expanded gem-shop caps/coefficients (coinMult +8%/lvl, growth +5%/lvl)
  GEM_UPGRADES: {
    ...CURRENT.GEM_UPGRADES,
    coinMult: { max: 25, baseCost: 2, growth: 1.30 },
    growth:   { max: 20, baseCost: 2, growth: 1.30 },
  },

  // §3.8 Shed lowered to 3%/each — already applied above in robotSpeed.
};

module.exports = { CURRENT, PROPOSED, GRID_W, GRID_H, GRID_AREA };

// ---------- CANDIDATE (iterative tuning workspace) ----------
// Currently identical to PROPOSED — use for future experimentation.
const CANDIDATE = {
  ...PROPOSED,
  label: 'candidate',
};

module.exports.CANDIDATE = CANDIDATE;
