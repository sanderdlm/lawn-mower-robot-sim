/* ============================================================
   LAWNBOT TYCOON — config / constants
   ============================================================ */

const CFG = {
  gridW: 48,
  gridH: 30,
  growthRateBase: 0.013,
  mowSpeedBase: 90,
  mowRadiusBase: 14,
  mowRateBase: 1.6,
  coinPerUnitBase: 1.0,
  targetRecheck: 0.35,
  maxParticles: 260,
  prestigeThreshold: 7000,
  prestigeFormula: (totalThisRun) => Math.floor(Math.pow(totalThisRun / 1500, 0.60)),
  // Ascend (ruby) prestige: wipes gem-tier progress (coins/upgrades/garden/
  // crew/grass/gemUpgrades/gems/totalGemsEarned). Keeps rubies + rubyUpgrades.
  // totalGemsEarned drives the reward; 40 gems earned ≈ 1 ruby.
  ascendThreshold: 50,
  ascendFormula: (totalGemsEarned) => Math.floor(Math.pow(totalGemsEarned / 40, 0.55)),
  beePerHive: 3,
  beeSpeed: 80,
  flowerCoinPerSec: 0.35,
  beeRewardPerVisit: 2.2,
  beeVisitDuration: 0.55,
  fuelDrainBase: 0.25,  // fuel per robot per second (benzine)
  fuelMax: 100,
  gnomeSpawnMin: 75,   // seconds between wandering gnome visits (min)
  gnomeSpawnMax: 180,  // seconds between wandering gnome visits (max)
  gnomeWalkSpeed: 34,  // px/sec
  gnomeDigDuration: 2.2,
  treasureLifetime: 75, // seconds before a treasure vanishes
  treasureSkinChance: 0.045, // 4.5% chance a treasure contains a skin
  scoutAutoDelay: 8,   // seconds scout employee waits before grabbing
  playerBaseRadiusTiles: 0.6, // starter-tool cutting radius, in tile units
  playerBaseMowRate: 2.4,     // grass units/sec cut by the starter tool
  neighborSpawnMin: 90,       // seconds between neighbor quest offers (min)
  neighborSpawnMax: 220,      // seconds between neighbor quest offers (max)
  questDeclineCooldown: 45,   // seconds after declining before next offer
  moleSpawnMin: 25,           // seconds between mole appearances (min)
  moleSpawnMax: 70,           // seconds between mole appearances (max)
  moleLifetimeMin: 15,        // how long a mole-hole blocks a tile (min)
  moleLifetimeMax: 45,        // how long a mole-hole blocks a tile (max)
};

// Base grid dimensions (before map expansion upgrades).
CFG.baseGridW = CFG.gridW;
CFG.baseGridH = CFG.gridH;

// Tile types
const T = {
  GRASS: 0, TREE: 1, ROCK: 2, POND: 3, FLOWER: 4,
  BEEHIVE: 5, FOUNTAIN: 6, SHED: 7, GNOME: 8, MOLE_HOLE: 9,
};
const OBSTACLE = new Set([T.TREE, T.ROCK, T.POND, T.FLOWER, T.BEEHIVE, T.FOUNTAIN, T.SHED, T.GNOME, T.MOLE_HOLE]);

const ROBOT_NAMES = [
  'Chompski', 'Sir Mows-a-Lot', 'Blades McGee', 'Lawnald',
  'Clippington', 'Mowzilla', 'Herbinator', 'Snip Snip',
  'Grassy K', 'Bladerunner', 'Grassassin', 'Whirly Boi',
  'Blade Pitt', 'Clint Eastweed', 'Jeff Bezgrass', 'Lawn Skywalker',
  'Cliposaurus', 'Turf McGurk', 'Mowbius', 'Rumble Clippings',
  'Grassy McFly', 'Snip Lord', 'The Clipster', 'Chop Chop',
  'Bartholomew', 'Unit Zero', 'Vroom Vroom', 'Hedge Fondler',
  'Ol\' Rusty', 'Doomba',
];

const NEIGHBOR_NAMES = [
  'Mrs. Buttersworth', 'Chad McNeighbor', 'Granny Grass',
  'Mayor Turf', 'Old Man Withers', 'Karen-Anne',
  'Steve the HOA Guy', 'Mr. Pickles', 'Aunt Petunia',
  'Doctor Hedges', 'Pastor Mowbry', 'Cousin Earl',
  'Barb from next door', 'Jerry the Plumber', 'Reverend Sod',
];

const GNOME_NAMES = [
  'Grimble', 'Snorky', 'Twigsworth', 'Plonkus', 'Old Mungus',
  'Borfle', 'Sneaky Pete', 'Grumio', 'Wobblekin', 'Big Herbert',
  'Crunchwhistle', 'Flopsworth', 'Grumblebottom', 'Eeek', 'Norbertus',
  'Wee Spriggins', 'Dinkleworth', 'Bogsworth', 'Smudge', 'Toadbriar',
];

const EVIL_GNOME_NAMES = [
  'Blackwart', 'Grimshade', 'Mordrex', 'Hex Vulgo', 'Malgrub',
  'Rotwhistle', 'Sir Scowl', 'Vexgore', 'Knavish Cob', 'Snarlfang',
  'Ickus Drear', 'Grimclaw', 'Spite', 'Nasty Norbert', 'Crooksworth',
];

const FLOWER_PALETTE = [
  ['#ff7fb4', '#ffe24b'],
  ['#ffd447', '#ff7a1f'],
  ['#b07bff', '#ffffff'],
  ['#ff3f56', '#ffe45a'],
  ['#ffffff', '#ffe24b'],
  ['#ff9f1c', '#fff1cf'],
];

// ===== AUTO-EXPORTS =====
export { CFG, EVIL_GNOME_NAMES, FLOWER_PALETTE, GNOME_NAMES, NEIGHBOR_NAMES, OBSTACLE, ROBOT_NAMES, T };
