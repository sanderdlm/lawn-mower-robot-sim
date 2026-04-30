// ===== AUTO-IMPORTS =====
import { CFG, T } from './config.js';
import { THEMES } from './themes.js';
import { displayedRate } from './ui.js';
import { tileSize } from './canvas.js';
import { weatherFlowerMult, weatherGrowthMult, weatherSpeedMult } from './atmosphere.js';
import { bees } from './world.js';
// ===== END AUTO-IMPORTS =====

/* ============================================================
   State, costs, garden defs, derived values
   ============================================================ */

let state = {
  coins: 0,
  gems: 0,
  totalEarnedAllTime: 0,
  totalEarnedThisRun: 0,
  totalTilesMowed: 0,
  lastUpdate: Date.now(),
  muted: false,
  upgrades: {
    robots: 1, speed: 0, range: 0, value: 0, growth: 0, rate: 0, crit: 0,
    fuelEff: 0, pest: 0, fuelType: 0, tool: 0,
  },
  fuel: 100,
  garden: {
    tree: 0, rock: 0, pond: 0, flower: 0, beehive: 0, fountain: 0, shed: 0, gnome: 0,
  },
  crew: [],                 // unlocked skill-tree node ids
  skinsUnlocked: ['default'],
  activeSkin: 'default',
  gnomeTimer: 60 + Math.random() * 30, // seconds until next wandering gnome
  // Golden gnome (rare clickable buff spawn). Decremented in updateGoldenGnomes.
  goldenGnomeTimer: 60 + Math.random() * 60,
  // Active timed buffs from golden gnomes: { key, name, icon, expires } where
  // `expires` is seconds remaining. Decremented in updateBuffs.
  activeBuffs: [],
  autoBuyTimer: 0,          // Bookkeeper accountant: countdown to next auto-purchase
  treasuresCollected: 0,
  patternsUnlocked: ['plain'],
  activeMowPattern: 'plain',
  totalGemsEarned: 0,       // cumulative — drives the "+10%/gem" passive bonus
  prestigeCount: 0,         // lifetime Prestige (🌟) actions
  ascendCount: 0,           // lifetime Ascend (♦️) actions
  // Permanent upgrades purchased with gems. Survive prestige.
  gemUpgrades: {
    startCoins: 0, coinMult: 0, growth: 0, crit: 0,
    offline: 0, prestigeBoost: 0, startRobot: 0, startTool: 0,
    autoQuest: 0,
    pollination: 0, coopBots: 0, symbiosis: 0, critCascade: 0,
  },
  // Branching meta-progression layered on top of gemUpgrades. Each tier holds
  // one of three mutually exclusive choice ids (or null = not yet picked).
  // Resets on Ascend.
  techTree: { tier1: null, tier2: null, tier3: null },
  // Ascend (ruby) tier — survives super-prestige.
  rubies: 0,
  totalRubiesEarned: 0,
  rubyUpgrades: {
    coinMult: 0, gemBank: 0, speed: 0, crit: 0, growth: 0,
    prestigeGemBoost: 0, ascendBoost: 0, startCrew: 0, offlineCap: 0,
    weatherControl: 0, unlockAreas: 0,
  },
  // Travel areas — each area has its own default grass species. 'home' is always
  // unlocked. Unlocked areas persist through Prestige AND Ascend (like rubies/skins).
  areasUnlocked: ['home'],
  activeArea: 'home',
  // Per-area 3× map expansion. Unlocked by spending 1000 💎 per area from the
  // Areas tab. Persists forever (same lifetime as areasUnlocked).
  areaExpanded: {},
  settings: {
    showRobotNames: true,
    showGnomeNames: true,
    showParticles: true,
    scientificNumbers: false,
    theme: 'classic',
    dayNight: 'auto',   // auto | off | dawn | day | dusk | night
    weather: 'auto',    // auto | clear | rain | snow | storm | fog
    rivalry: true,      // crown the top-earning robot each 30s
    autoBuyer: true,    // Bookkeeper auto-buys cheapest Bot/Tool upgrade
    newsTicker: true,   // bottom-of-stage news ticker + random events
    useSprites: false,  // prefer PNG sprite pack over procedural drawing
  },
  timeOfDay: 12,                // 0..24, advances in auto mode
  weather: { id: 'clear', intensity: 0, cycleTimer: 90 },
  rivalryTimer: 30,
  zenMode: false,
  zenConfig: {
    robots: 6,
    flowers: 14,
    beehives: 3,
    trees: 10,
    rocks: 6,
    ponds: 2,
    gnomes: 2,
    skin: 'default',
    pattern: 'plain',
    weather: 'auto',
    dayTime: 'auto',
    rivalry: true,
  },
  activeQuest: null,                    // { id, neighbor, title, goal, duration, elapsed, reward, rewardType, startVal }
  questTimer: 80 + Math.random() * 60,  // seconds until next neighbor knocks
  questsCompleted: 0,
  questHistory: [],                     // { neighbor, title, rewardType, reward, outcome: 'success'|'failed', ts }
  // Random events / news ticker. activeEvent: { id, name, headline, started, duration, target, ctx }
  activeEvent: null,
  eventTimer: 240 + Math.random() * 180,
  critCascadeStack: 0,                  // runtime: bonus crit-mult from Crit Cascade gem upgrade
  // Lawn-pedia: collection log of one-time discoveries. Each unique entry in
  // species/gnomes/buffs grants a tiny permanent coin bonus via pediaBonusMult().
  pedia: {
    species: [],     // grass species keys ever mowed
    gnomes: [],      // unique gnome names met (visitor + evil + 'Golden Gnome')
    treasures: 0,    // running count of treasures opened
    treasureRare: [],// rarities ever opened ('common','uncommon','rare','epic')
    weather: {},     // weatherId -> total seconds endured
    buffs: [],       // golden gnome buff keys ever triggered
    photos: [],      // {ts, dataUrl} from Zen mode P key, capped at 12
  },
};

const QUEST_HISTORY_MAX = 30;

// ---------- Zen Mode: configurable screensaver world ----------
const ZEN_SLIDERS = [
  { key: 'robots',   icon: '🤖', label: 'Mowers',   min: 0, max: 20, step: 1 },
  { key: 'flowers',  icon: '🌸', label: 'Flowers',  min: 0, max: 40, step: 1 },
  { key: 'beehives', icon: '🐝', label: 'Beehives', min: 0, max: 12, step: 1 },
  { key: 'trees',    icon: '🌳', label: 'Trees',    min: 0, max: 20, step: 1 },
  { key: 'rocks',    icon: '🪨', label: 'Rocks',    min: 0, max: 20, step: 1 },
  { key: 'ponds',    icon: '💧', label: 'Ponds',    min: 0, max: 6,  step: 1 },
  { key: 'gnomes',   icon: '🧙', label: 'Gnomes',   min: 0, max: 10, step: 1 },
];
const ZEN_CONFIG_DEFAULT = { robots: 6, flowers: 14, beehives: 3, trees: 10, rocks: 6, ponds: 2, gnomes: 2, skin: 'default', pattern: 'plain', weather: 'auto', dayTime: 'auto', rivalry: true };

// ---------- Settings ----------
// Each entry is a toggle in the settings modal. Add more here; they render
// automatically and are persisted via save/load.
const SETTING_DEFS = [
  { type: 'toggle', key: 'showRobotNames', label: 'Show robot names', hint: 'Display nameplates above each mower.' },
  { type: 'toggle', key: 'showGnomeNames', label: 'Show gnome names', hint: 'Display names above visiting gnomes.' },
  { type: 'toggle', key: 'showParticles',  label: 'Floating numbers', hint: 'Show +coin pop-ups over the lawn.' },
  { type: 'toggle', key: 'rivalry',        label: 'Robot rivalry',    hint: 'Crown the top-earning robot every 30s (+5% speed).' },
  { type: 'toggle', key: 'useSprites',     label: 'Use sprite art',   hint: 'Render garden features, flowers and characters with the PNG sprite pack. Turn off for the original vector look.' },
  { type: 'toggle', key: 'scientificNumbers', label: 'Scientific notation', hint: 'Display big numbers as 1.23e6 instead of 1.23M.' },
  { type: 'select', key: 'theme',          label: 'Theme pack',       hint: 'Swap the lawn palette and stage background.',
    options: () => (typeof THEMES !== 'undefined' ? THEMES.map(t => ({ value: t.id, label: t.name, desc: t.desc })) : [{ value: 'classic', label: 'Classic' }]) },
  { type: 'toggle', key: 'dayNight',       label: 'Day / Night overlay', hint: 'Tint the lawn by time of day.',
    onValue: 'auto', offValue: 'off' },
  { type: 'toggle', key: 'weather',        label: 'Weather overlay',     hint: 'Show weather visuals and effects on the lawn.',
    onValue: 'auto', offValue: 'off' },
  { type: 'toggle', key: 'autoBuyer',      label: 'Auto-buy upgrades',   hint: 'Bean Counter Beatrice buys the cheapest affordable Bot/Tool upgrade every 3s.',
    gate: () => hasCrew('accountant') },
  { type: 'toggle', key: 'newsTicker',     label: 'News ticker',         hint: 'Show the bottom news ticker and trigger random events every few minutes.' },
];
function getSetting(key) {
  if (!state.settings) state.settings = {};
  return state.settings[key];
}

const FUEL_TYPES = [
  { name: 'Benzine',  icon: '⛽', drainMult: 1.00, recharge: 0.0, refuelable: true,  upgradeCost: 2000,  barColor: 'linear-gradient(90deg,#ff8c00,#ffb830)' },
  { name: 'Diesel',   icon: '🛢️', drainMult: 0.75, recharge: 0.0, refuelable: true,  upgradeCost: 8000,  barColor: 'linear-gradient(90deg,#c8a000,#f0c800)' },
  { name: 'Hybrid',   icon: '🔋', drainMult: 0.50, recharge: 0.8, refuelable: true,  upgradeCost: 20000, barColor: 'linear-gradient(90deg,#00b86e,#3affa0)' },
  { name: 'Electric', icon: '⚡', drainMult: 0.25, recharge: 1.5, refuelable: false, upgradeCost: null,  barColor: 'linear-gradient(90deg,#3bd4ff,#72f2ff)' },
];

// ---------- Neighbor quests ----------
// Each quest has a generator for the goal number, a progress function, a duration,
// and a reward. Progress = getDelta(startVal) — compare against quest.goal.
const QUEST_TYPES = [
  { id: 'mow_tiles',
    title: (g) => `Mow ${g} tiles of grass`,
    flavor: [
      'My lawn has grown way out of hand!',
      'The HOA is breathing down my neck.',
      'I lost my keys in the grass. Help?',
    ],
    genGoal: () => 60 + Math.floor(Math.random() * 180),
    duration: 60,
    reward: (g) => g * 6,
    rewardType: 'coins',
    getDelta: (q) => state.totalTilesMowed - q.startVal,
    getStart: () => state.totalTilesMowed,
  },
  { id: 'earn_coins',
    title: (g) => `Earn ${formatShort(g)} coins`,
    flavor: [
      'Prove you run a real business.',
      'Times are tight. Show me the money.',
      'Make some dough, kid.',
    ],
    genGoal: () => {
      const rate = (typeof displayedRate === 'number' && displayedRate > 0) ? displayedRate : 10;
      const base = Math.max(400, rate * 35);
      return Math.floor(base * (0.9 + Math.random() * 0.7));
    },
    duration: 45,
    reward: (g) => Math.floor(g * 0.45),
    rewardType: 'coins',
    getDelta: (q) => state.totalEarnedAllTime - q.startVal,
    getStart: () => state.totalEarnedAllTime,
  },
  { id: 'big_mow',
    title: (g) => `Mow ${g} tiles — marathon job`,
    flavor: [
      'I\'ll pay gems. Real gems.',
      'Only a pro can finish this.',
      'Stakes: high. Grass: higher.',
    ],
    genGoal: () => 400 + Math.floor(Math.random() * 500),
    duration: 150,
    reward: () => 2,
    rewardType: 'gems',
    getDelta: (q) => state.totalTilesMowed - q.startVal,
    getStart: () => state.totalTilesMowed,
  },
];
const QUEST_BY_ID = Object.fromEntries(QUEST_TYPES.map(q => [q.id, q]));

// ---------- Grass species ----------
// Index 0 is normal; others are unlockable rare species that randomly spawn
// on existing grass tiles. Higher coinMult = more coins per mow unit.
// toughness divides mow rate, so tougher grass takes longer to cut.
// spawnBase is the relative weight before any spawn-rate upgrades.
// Colors: [baseR, baseG, baseB] for the tile tint (blended with grass bucket).
const GRASS_TYPES = [
  { key: 'normal',  name: 'Regular Grass', icon: '🌱',
    coinMult: 1.0, toughness: 1.0, unlockCost: null, spawnBase: 0,
    color: null, accent: null },
  // Vivid jade-teal — clearly cooler than normal grass.
  { key: 'clover',  name: 'Lucky Clover',  icon: '☘️',
    coinMult: 2.0, toughness: 1.6, unlockCost: 3500, spawnBase: 12,
    color: [25, 200, 140], accent: [180, 255, 220] },
  // Warm amber/khaki — clearly yellow-brown, not green.
  { key: 'thick',   name: 'Thick Turf',    icon: '🌾',
    coinMult: 3.5, toughness: 2.4, unlockCost: 18000, spawnBase: 7,
    color: [190, 140, 30], accent: [255, 220, 120] },
  // Magenta/violet — completely off the green spectrum.
  { key: 'crystal', name: 'Crystal Grass', icon: '💎',
    coinMult: 7.0, toughness: 4.0, unlockCost: 110000, spawnBase: 3,
    color: [180, 90, 230], accent: [230, 200, 255] },
  // Bright saturated gold.
  { key: 'golden',  name: 'Golden Grass',  icon: '🌟',
    coinMult: 16.0, toughness: 7.0, unlockCost: 650000, spawnBase: 1,
    color: [255, 200, 30], accent: [255, 245, 180] },
  // ---- Exotic tiers — ONLY unlockable from the 💎 Gem Shop ----
  // unlockCost is null (can't be coin-unlocked); spawnUpgradeBase is the
  // starting coin cost for the per-species spawn-rate upgrade.
  // Smoky obsidian: deep charcoal with silver veins.
  { key: 'obsidian', name: 'Obsidian Turf', icon: '🌑',
    coinMult: 35.0, toughness: 12.0, unlockCost: null, gemGated: true, spawnBase: 0.6,
    spawnUpgradeBase: 50000,
    color: [45, 50, 65], accent: [210, 220, 245] },
  // Frost grass: pale ice-blue with a bright white sparkle.
  { key: 'frost',    name: 'Frost Grass',   icon: '❄️',
    coinMult: 75.0, toughness: 20.0, unlockCost: null, gemGated: true, spawnBase: 0.3,
    spawnUpgradeBase: 300000,
    color: [170, 225, 255], accent: [240, 250, 255] },
  // Void grass: violet-black with neon edges.
  { key: 'void',     name: 'Void Grass',    icon: '🌌',
    coinMult: 150.0, toughness: 35.0, unlockCost: null, gemGated: true, spawnBase: 0.12,
    spawnUpgradeBase: 2000000,
    color: [70, 20, 110], accent: [230, 120, 255] },
];
const GRASS_BY_KEY = Object.fromEntries(GRASS_TYPES.map((g, i) => [g.key, { ...g, idx: i }]));

// ---------- Travel areas ----------
// Each area has a default grass species (seeded on every tile when you travel
// there). Unlocks persist forever (like skins/patterns/rubies). Revealed behind
// the 'unlockAreas' ruby upgrade. Coin prices are big on purpose — owning an
// entire plot of high-tier grass is a major income boost.
const AREA_DEFS = [
  { id: 'home',     name: 'Home Lawn',        icon: '🏡', species: 'normal',
    costCoins: 0,        costGems: 0,  costRubies: 0,
    desc: 'The starter plot. Always yours.' },
  { id: 'clover',   name: 'Clover Meadow',    icon: '☘️', species: 'clover',
    costCoins: 35000,    costGems: 0,  costRubies: 0,
    desc: 'A lucky emerald meadow. 2.0× coin grass.' },
  { id: 'thicket',  name: 'Thicket Hollow',   icon: '🌾', species: 'thick',
    costCoins: 180000,   costGems: 5,  costRubies: 0,
    desc: 'Dense amber turf. 3.5× coin grass.' },
  { id: 'crystal',  name: 'Crystal Glade',    icon: '💎', species: 'crystal',
    costCoins: 1100000,  costGems: 20, costRubies: 0,
    desc: 'Shimmering violet growth. 7× coin grass.' },
  { id: 'goldshire',name: 'Goldshire',        icon: '🌟', species: 'golden',
    costCoins: 6500000,  costGems: 80, costRubies: 0,
    desc: 'Fields of solid gold. 16× coin grass.' },
  { id: 'obsidian', name: 'Obsidian Wastes',  icon: '🌑', species: 'obsidian',
    costCoins: 0,        costGems: 0,  costRubies: 1,
    desc: 'Volcanic charcoal fields. 35× coin grass.' },
  { id: 'frostmoor',name: 'Frostmoor',        icon: '❄️', species: 'frost',
    costCoins: 0,        costGems: 0,  costRubies: 3,
    desc: 'Icebound silver grass. 75× coin grass.' },
  { id: 'voidlands',name: 'The Voidlands',    icon: '🌌', species: 'void',
    costCoins: 0,        costGems: 0,  costRubies: 8,
    desc: 'Grass from beyond the veil. 150× coin grass.' },
];
const AREA_BY_ID = Object.fromEntries(AREA_DEFS.map(a => [a.id, a]));
const AREA_EXPAND_COST_GEMS = 1000;

function currentArea() { return AREA_BY_ID[state.activeArea] || AREA_BY_ID.home; }
function currentAreaSpeciesIdx() {
  const a = currentArea();
  const g = GRASS_BY_KEY[a.species];
  return g ? g.idx : 0;
}
function areaUnlocked(id) {
  return Array.isArray(state.areasUnlocked) && state.areasUnlocked.includes(id);
}
function areaIsExpanded(id) {
  return !!(state.areaExpanded && state.areaExpanded[id]);
}

// ---------- Player tools (progressive tiers) ----------
// rateMult multiplies CFG.playerBaseMowRate; radiusTiles is cutting radius in tile units.
const TOOL_TYPES = [
  { name: 'Rusty Scissors',   icon: '🪒', rateMult: 1.0,  radiusTiles: 0.6, upgradeCost: null },
  { name: 'Hedge Shears',     icon: '✂️', rateMult: 2.0,  radiusTiles: 0.8, upgradeCost: 250 },
  { name: 'Push Mower',       icon: '🌾', rateMult: 3.6,  radiusTiles: 1.0, upgradeCost: 1800 },
  { name: 'Electric Trimmer', icon: '⚡', rateMult: 6.0,  radiusTiles: 1.2, upgradeCost: 9000 },
  { name: 'Pro Mower X1',     icon: '🏎️', rateMult: 10.0, radiusTiles: 1.5, upgradeCost: 45000 },
  { name: 'Industrial Beast', icon: '🚜', rateMult: 18.0, radiusTiles: 2.0, upgradeCost: 200000 },
];

// ---------- Gem shop (permanent, survives prestige) ----------
// Costs are in gems. Cost(level) = ceil(base * growth^level).
const GEM_UPGRADES = [
  { key: 'startCoins',    icon: '💰', name: 'Cushion Bank',
    desc: 'Start each run with bonus coins.',
    max: 10, baseCost: 1, growth: 1.6,
    statusText: (lvl) => `Start with ${formatShort(startingCoinsFor(lvl))} coins` },
  { key: 'coinMult',      icon: '✨', name: 'Midas Blessing',
    desc: '+8% all coin income per level.',
    max: 25, baseCost: 2, growth: 1.35,
    statusText: (lvl) => `+${lvl * 8}% coin income` },
  { key: 'growth',        icon: '🌱', name: 'Green Thumb',
    desc: '+3% grass regrowth per level.',
    max: 20, baseCost: 2, growth: 1.35,
    statusText: (lvl) => `+${lvl * 3}% grass growth` },
  { key: 'crit',          icon: '🎯', name: 'Lucky Charm',
    desc: '+1% permanent crit chance per level.',
    max: 15, baseCost: 3, growth: 1.4,
    statusText: (lvl) => `+${lvl}% crit chance` },
  { key: 'offline',       icon: '💤', name: 'Overnight Wages',
    desc: 'Boost offline earnings.',
    max: 10, baseCost: 2, growth: 1.4,
    statusText: (lvl) => `+${lvl * 10}% offline income` },
  { key: 'prestigeBoost', icon: '💎', name: 'Prismatic Lens',
    desc: '+10% gems earned per prestige.',
    max: 10, baseCost: 4, growth: 1.5,
    statusText: (lvl) => `+${lvl * 10}% prestige gems` },
  { key: 'startRobot',    icon: '🤖', name: 'Veteran Fleet',
    desc: 'Start each run with extra robots.',
    max: 5, baseCost: 5, growth: 2.0,
    statusText: (lvl) => `Start with ${1 + lvl} robot${lvl > 0 ? 's' : ''}` },
  { key: 'startTool',     icon: '🛠️', name: 'Apprentice Kit',
    desc: 'Start each run with a better tool tier.',
    max: TOOL_TYPES.length - 1, baseCost: 6, growth: 2.2,
    statusText: (lvl) => {
      const t = TOOL_TYPES[Math.min(lvl, TOOL_TYPES.length - 1)];
      return `Start with ${t.icon} ${t.name}`;
    } },
  { key: 'autoQuest',     icon: '🤝', name: 'Open Door Policy',
    desc: 'Neighbor quests auto-accept — no more modal popups.',
    max: 1, baseCost: 8, growth: 1,
    statusText: (lvl) => lvl ? 'Quests auto-accepted' : 'Manual accept/decline' },
  { key: 'pollination',   icon: '🌻', name: 'Pollination Pact',
    desc: '+0.3% coin per (Bee × Flower) per level.',
    max: 5, baseCost: 8, growth: 1.7,
    statusText: (lvl) => {
      const pairs = (typeof bees !== 'undefined' ? bees.length : 0) * (state.garden.flower || 0);
      const pct = (lvl * 0.3 * pairs).toFixed(1);
      return `+${pct}% coin · 🐝×🌸 = ${pairs}`;
    } },
  { key: 'coopBots',      icon: '🤝', name: 'Robot Co-op',
    desc: 'Each extra robot adds +0.5% mow rate to every other robot per level.',
    max: 5, baseCost: 10, growth: 1.7,
    statusText: (lvl) => {
      const extra = Math.max(0, (state.upgrades.robots || 1) - 1);
      const pct = (lvl * 0.5 * extra).toFixed(1);
      return `+${pct}% mow rate · extra bots = ${extra}`;
    } },
  { key: 'symbiosis',     icon: '🌿', name: 'Garden Symbiosis',
    desc: '+1.5% growth per unique garden item type placed, per level.',
    max: 4, baseCost: 12, growth: 1.8,
    statusText: (lvl) => {
      const u = uniqueGardenTypes();
      const pct = (lvl * 1.5 * u).toFixed(1);
      return `+${pct}% growth · unique types = ${u}/8`;
    } },
  { key: 'critCascade',   icon: '⚡', name: 'Crit Cascade',
    desc: 'Each crit adds +0.4× to next crit mult, decays on miss. Hard cap 10×.',
    max: 5, baseCost: 15, growth: 1.9,
    statusText: (lvl) => {
      const stack = state.critCascadeStack || 0;
      return `Stack: +${stack.toFixed(1)}× · per-crit +${(0.4 * lvl).toFixed(1)}× · cap 10×`;
    } },
];

// Apply map dimensions based on the current area's expansion flag.
function applyMapDimensions() {
  if (areaIsExpanded(state.activeArea)) {
    CFG.gridW = CFG.baseGridW * 3;
    CFG.gridH = CFG.baseGridH * 3;
  } else {
    CFG.gridW = CFG.baseGridW;
    CFG.gridH = CFG.baseGridH;
  }
}

// ---------- Ruby shop (permanent, survives BOTH prestige and ascend) ----------
// Costs are in rubies. Rubies are end-game — very few per ascend.
const RUBY_UPGRADES = [
  { key: 'coinMult',         icon: '💰', name: 'Ruby Market',
    desc: '+20% all coin income per level (stacks with gem Midas).',
    max: 15, baseCost: 1, growth: 1.5,
    statusText: (lvl) => `+${lvl * 20}% coin income` },
  { key: 'gemBank',          icon: '💎', name: 'Gem Dowry',
    desc: 'Start every ascend with bonus gems (preserved).',
    max: 10, baseCost: 1, growth: 1.8,
    statusText: (lvl) => `Start each ascend with ${lvl * 5} gems` },
  { key: 'speed',            icon: '🏎️', name: 'Master Mower',
    desc: '+15% robot speed per level.',
    max: 10, baseCost: 2, growth: 1.9,
    statusText: (lvl) => `+${lvl * 15}% robot move speed` },
  { key: 'crit',             icon: '🎯', name: 'Bloody Precision',
    desc: '+2% permanent crit chance per level.',
    max: 15, baseCost: 2, growth: 1.7,
    statusText: (lvl) => `+${lvl * 2}% crit chance` },
  { key: 'growth',           icon: '🌱', name: 'Scarlet Bloom',
    desc: '+10% grass growth per level.',
    max: 10, baseCost: 2, growth: 1.7,
    statusText: (lvl) => `+${lvl * 10}% grass growth` },
  { key: 'prestigeGemBoost', icon: '✨', name: 'Prestige Multiplier',
    desc: '+25% gems per prestige per level (stacks with gem Lens).',
    max: 10, baseCost: 3, growth: 1.9,
    statusText: (lvl) => `+${lvl * 25}% prestige gems` },
  { key: 'ascendBoost',      icon: '♦️', name: 'Ruby Lens',
    desc: '+15% rubies per ascend per level.',
    max: 10, baseCost: 4, growth: 2.0,
    statusText: (lvl) => `+${lvl * 15}% ascend rubies` },
  { key: 'startCrew',        icon: '👷', name: 'Veteran Foreman',
    desc: 'Start every ascend with the Foreman already hired.',
    max: 1, baseCost: 5, growth: 1,
    statusText: (lvl) => lvl ? 'Foreman hired on every run' : 'Locked' },
  { key: 'offlineCap',       icon: '💤', name: 'Eternal Ledger',
    desc: '+4 hours of offline earnings cap per level (base 12h).',
    max: 12, baseCost: 3, growth: 1.8,
    statusText: (lvl) => `Offline cap: ${12 + lvl * 4} hours` },
  { key: 'weatherControl',  icon: '🌦️', name: 'Weather Machine',
    desc: 'Click the weather pill in the HUD to lock any weather you want.',
    max: 1, baseCost: 8, growth: 1,
    statusText: (lvl) => lvl ? '🌦️ Click HUD pill to choose weather' : 'Locked' },
  { key: 'unlockAreas',     icon: '🗺️', name: 'Travel Papers',
    desc: 'Reveals the 🗺️ Areas tab — travel to plots of premium grass.',
    max: 1, baseCost: 5, growth: 1,
    statusText: (lvl) => lvl ? '🗺️ Areas unlocked' : 'Locked' },
];
const RUBY_BY_KEY = Object.fromEntries(RUBY_UPGRADES.map(r => [r.key, r]));
function rubyLvl(key) { return (state.rubyUpgrades && state.rubyUpgrades[key]) || 0; }
function rubyUpgradeCost(key, lvl) {
  const def = RUBY_BY_KEY[key]; if (!def) return Infinity;
  const n = lvl ?? rubyLvl(key);
  if (n >= def.max) return Infinity;
  return Math.ceil(def.baseCost * Math.pow(def.growth, n));
}
function rubyShopCoinMult()    { return 1 + rubyLvl('coinMult') * 0.20; }
function rubyShopSpeedMult()   { return 1 + rubyLvl('speed') * 0.15; }
function rubyShopCritBonus()   { return rubyLvl('crit') * 0.02; }
function rubyShopGrowthMult()  { return 1 + rubyLvl('growth') * 0.10; }
function rubyShopPrestigeMult(){ return 1 + rubyLvl('prestigeGemBoost') * 0.25; }
function rubyShopAscendMult()  { return 1 + rubyLvl('ascendBoost') * 0.15; }
function rubyShopStartGems()   { return rubyLvl('gemBank') * 5; }
function rubyShopOfflineCapHours() { return 12 + rubyLvl('offlineCap') * 4; }
function rubyShopHasStartCrew() { return rubyLvl('startCrew') > 0; }
function rubyShopHasWeatherControl() { return rubyLvl('weatherControl') > 0; }
const GEM_BY_KEY = Object.fromEntries(GEM_UPGRADES.map(g => [g.key, g]));
function gemUpgradeCost(key, lvl) {
  const def = GEM_BY_KEY[key]; if (!def) return Infinity;
  const n = lvl ?? state.gemUpgrades?.[key] ?? 0;
  if (n >= def.max) return Infinity;
  let c = Math.ceil(def.baseCost * Math.pow(def.growth, n));
  if (key === 'growth' && subsidyActive()) c = Math.ceil(c * 0.5);
  return c;
}
function startingCoinsFor(lvl) {
  if (!lvl) return 0;
  return 250 * (Math.pow(2, lvl) - 1);
}

const COST = {
  robots:   (n) => Math.ceil(25   * Math.pow(1.45, n - 1)),
  speed:    (n) => Math.ceil(40   * Math.pow(1.35, n)),
  range:    (n) => Math.ceil(60   * Math.pow(1.40, n)),
  value:    (n) => Math.ceil(80   * Math.pow(1.42, n)),
  growth:   (n) => Math.ceil(120  * Math.pow(1.45, n) * (subsidyActive() ? 0.5 : 1)),
  rate:     (n) => Math.ceil(150  * Math.pow(1.40, n)),
  crit:     (n) => Math.ceil(500  * Math.pow(1.55, n)),
  fuelEff:  (n) => Math.ceil(80   * Math.pow(1.45, n)),
  pest:     (n) => Math.ceil(400  * Math.pow(1.48, n)),
  fuelType: (n) => FUEL_TYPES[n]?.upgradeCost ?? Infinity,
  tool:     (n) => TOOL_TYPES[n + 1]?.upgradeCost ?? Infinity,
};
const MAX = {
  robots: 50, speed: 120, range: 60, value: 120, growth: 80, rate: 80, crit: 40,
  fuelEff: 10, pest: 10, fuelType: 3, tool: TOOL_TYPES.length - 1,
};

const GARDEN_DEFS = [
  { key: 'flower',   type: T.FLOWER,   icon: '🌸', name: 'Flower Bed',
    desc: () => `+${CFG.flowerCoinPerSec} coins/sec each; attracts bees`,
    baseCost: 150,  mult: 1.28, max: 80 },
  { key: 'tree',     type: T.TREE,     icon: '🌳', name: 'Shade Tree',
    desc: () => `+1% grass growth each (shade retains moisture)`,
    baseCost: 500,  mult: 1.40, max: 40 },
  { key: 'rock',     type: T.ROCK,     icon: '🪨', name: 'Garden Rock',
    desc: () => `+0.5% coin value each (hidden treasure!)`,
    baseCost: 250,  mult: 1.32, max: 40 },
  { key: 'pond',     type: T.POND,     icon: '💧', name: 'Koi Pond',
    desc: () => `+3% grass growth each (dew everywhere)`,
    baseCost: 3000, mult: 1.60, max: 10 },
  { key: 'beehive',  type: T.BEEHIVE,  icon: '🐝', name: 'Beehive',
    desc: () => `Spawns ${CFG.beePerHive} bees; each pollination = coins`,
    baseCost: 3000, mult: 1.60, max: 12 },
  { key: 'fountain', type: T.FOUNTAIN, icon: '⛲', name: 'Fountain',
    desc: () => `+8% global coin income each (opulence boost)`,
    baseCost: 10000,mult: 1.75, max: 10 },
  { key: 'shed',     type: T.SHED,     icon: '🏚️', name: 'Garden Shed',
    desc: () => `+5% robot speed each (tune-ups!)`,
    baseCost: 4000, mult: 1.55, max: 15 },
  { key: 'gnome',    type: T.GNOME,    icon: '🧙', name: 'Garden Gnome',
    desc: () => `+1% crit chance each (mischievous luck)`,
    baseCost: 1800, mult: 1.50, max: 20 },
];
const GARDEN_BY_KEY = Object.fromEntries(GARDEN_DEFS.map(d => [d.key, d]));
function gardenCost(key) {
  const def = GARDEN_BY_KEY[key];
  return Math.ceil(def.baseCost * Math.pow(def.mult, state.garden[key]));
}

// ---------- Crew skill tree ----------
// 3-tier tree, each node unlocks once (no levels). (col is 0..2 for rendering)
const SKILL_TREE = [
  { id: 'foreman',    tier: 0, col: 1, icon: '👷', name: 'Hire Foreman',    crewName: 'Big Ron',
    desc: 'Recruit your first hand. +5% robot speed.',
    cost: 1200, req: null },

  { id: 'mechanic',   tier: 1, col: 0, icon: '🧰', name: 'Apprentice Mechanic', crewName: 'Grease McFix',
    desc: 'Refuel costs -25% and drain -5%.',
    cost: 3500, req: 'foreman' },
  { id: 'keenEye',    tier: 1, col: 1, icon: '👁️', name: 'Keen Eye',           crewName: 'Eagle-Eye Brenda',
    desc: 'Gnomes visit 35% more often · +60% skin drop chance.',
    cost: 4500, req: 'foreman' },
  { id: 'qualityControl', tier: 1, col: 2, icon: '🎯', name: 'Quality Control', crewName: 'Picky Patricia',
    desc: '+4% crit chance (stacks with gnomes).',
    cost: 5000, req: 'foreman' },
  { id: 'moleWarden', tier: 1, col: 3, icon: '🐹', name: 'Mole Warden', crewName: 'Burrow Bob',
    desc: 'Moles appear half as often and are evicted twice as fast.',
    cost: 6000, req: 'foreman' },
  { id: 'sprinkler', tier: 1, col: 4, icon: '💧', name: 'Sprinkler Tech', crewName: 'Drizzle Doug',
    desc: '+15% grass regrowth speed.',
    cost: 5500, req: 'foreman' },

  { id: 'autoRefuel', tier: 2, col: 0, icon: '⛽', name: 'Auto-Refueler',      crewName: 'Nozzle Dave',
    desc: 'Automatically refuel when fuel hits 25%.',
    cost: 12000, req: 'mechanic' },
  { id: 'scout',      tier: 2, col: 1, icon: '🔍', name: 'Treasure Scout',     crewName: 'Sneaky Steve',
    desc: 'Auto-collects gnome treasures after 8s.',
    cost: 15000, req: 'keenEye' },
  { id: 'efficiency', tier: 2, col: 2, icon: '⚙️', name: 'Efficiency Expert',  crewName: 'Spreadsheet Karen',
    desc: '+20% mow rate and +10% global coin income.',
    cost: 18000, req: 'qualityControl' },
  { id: 'headGardener', tier: 2, col: 4, icon: '🌻', name: 'Head Gardener',    crewName: 'Flora Faye',
    desc: '+30% grass regrowth (stacks with Sprinkler Tech).',
    cost: 20000, req: 'sprinkler' },
  { id: 'accountant', tier: 2, col: 3, icon: '📊', name: 'Bookkeeper',         crewName: 'Bean Counter Beatrice',
    desc: 'Auto-buys the cheapest affordable Bot/Tool upgrade every 3s. Toggle in Settings.',
    cost: 30000, req: 'moleWarden' },
];
const SKILL_BY_ID = Object.fromEntries(SKILL_TREE.map(s => [s.id, s]));
function hasCrew(id) { return state.crew && state.crew.indexOf(id) >= 0; }
function crewUnlockable(id) {
  const s = SKILL_BY_ID[id]; if (!s) return false;
  if (hasCrew(id)) return false;
  if (s.req && !hasCrew(s.req)) return false;
  return true;
}

// ---------- Mower skins ----------
const SKIN_DEFS = [
  { key: 'default', name: 'Classic Orange', rarity: 'base',
    body: ['#ff7a2e', '#c0421a'], trim: '#1a1a1a', accent: '#ff4a4a', panel: '#58ffa0' },
  { key: 'cherry',  name: 'Cherry Blaze', rarity: 'common',
    body: ['#ff3b5a', '#7c0e1f'], trim: '#2a0a0f', accent: '#ffd34e', panel: '#fff1c4' },
  { key: 'sky',     name: 'Sky Patrol', rarity: 'common',
    body: ['#5ccaff', '#1e6fa3'], trim: '#0a1a25', accent: '#ffd34e', panel: '#e9fbe7' },
  { key: 'forest',  name: 'Forest Ranger', rarity: 'uncommon',
    body: ['#58c85f', '#1e5d2c'], trim: '#0a1f12', accent: '#ffd34e', panel: '#8ff09e' },
  { key: 'neon',    name: 'Neon Rave', rarity: 'rare',
    body: ['#b94dff', '#3b1565'], trim: '#0f0322', accent: '#58ffa0', panel: '#72f2ff' },
  { key: 'stealth', name: 'Stealth Mk.II', rarity: 'rare',
    body: ['#3a3f45', '#0e1014'], trim: '#000000', accent: '#d0d3d9', panel: '#72f2ff' },
  { key: 'gold',    name: 'Gold Plated', rarity: 'epic',
    body: ['#ffe15a', '#b8860b'], trim: '#5a3a1e', accent: '#ff3333', panel: '#fff1c4' },
  { key: 'rainbow', name: 'Rainbow Runner', rarity: 'legendary',
    body: ['rainbow'], trim: '#1a1a1a', accent: '#ffffff', panel: '#ffffff' },
];
const SKIN_BY_KEY = Object.fromEntries(SKIN_DEFS.map(s => [s.key, s]));

// ---------- Mowing patterns ----------
// Visual patterns the robots cut into the lawn. Applied as a per-tile tint
// overlay in drawGrass(), strongest on freshly cut (short) grass.
const MOW_PATTERN_DEFS = [
  { key: 'plain',    name: 'Plain',          icon: '🟩', desc: 'No pattern — natural cut.',     unlockCost: 0 },
  { key: 'stripes',  name: 'Classic Stripes',icon: '🟨', desc: 'Alternating 1-tile rows.',      unlockCost: 2500 },
  { key: 'diagonal', name: 'Diagonal',       icon: '🔶', desc: '45° diagonal bands.',           unlockCost: 15000 },
  { key: 'checker',  name: 'Checkerboard',   icon: '🏁', desc: 'Formal garden 2×2 squares.',    unlockCost: 75000 },
  { key: 'diamonds', name: 'Argyle Diamonds',icon: '💠', desc: 'Lattice of diamonds.',          unlockCost: 400000 },
  { key: 'zigzag',   name: 'Zigzag',         icon: '⚡', desc: 'Playful chevron waves.',         unlockCost: 1800000 },
];
const MOW_PATTERN_BY_KEY = Object.fromEntries(MOW_PATTERN_DEFS.map(p => [p.key, p]));
const RARITY_COLORS = {
  base:      '#9fc4a2',
  common:    '#c6d4c8',
  uncommon:  '#5ccaff',
  rare:      '#b94dff',
  epic:      '#ffd34e',
  legendary: '#ff6bcf',
};
function skinDropChance() {
  return CFG.treasureSkinChance * (hasCrew('keenEye') ? 1.6 : 1);
}
function gnomeSpawnIntervalMult() {
  return hasCrew('keenEye') ? 1 / 1.35 : 1;
}

// ---------- Derived values ----------
function gemLvl(key)    { return (state.gemUpgrades && state.gemUpgrades[key]) || 0; }
function gemMult()      {
  const g = state.totalGemsEarned || state.gems;
  return 1 + 0.35 * Math.pow(g, 0.65);
}
function gemShopCoinMult() { return 1 + gemLvl('coinMult') * 0.08; }
function gemShopGrowthMult() { return 1 + gemLvl('growth') * 0.03; }
function gemShopCritBonus()  { return gemLvl('crit') * 0.01; }
function gemShopOfflineMult(){ return 1 + gemLvl('offline') * 0.10; }
function gemShopPrestigeMult(){ return 1 + gemLvl('prestigeBoost') * 0.10; }

// ---------- Tech tree (branching meta-progression on top of gem shop) ----------
const TECH_TREE = [
  { tier: 1, key: 'tier1', cost: 25, choices: [
    { id: 'eco',    icon: '💰', name: 'Economy',    desc: '+25% global coin income' },
    { id: 'mech',   icon: '⚙️',  name: 'Mechanical', desc: '+15% robot speed AND +15% mow rate' },
    { id: 'mystic', icon: '✨', name: 'Mystical',   desc: '+5% crit chance AND +1.5x crit multiplier' },
  ]},
  { tier: 2, key: 'tier2', cost: 80, choices: [
    { id: 'eco',    icon: '🏦', name: 'Banker',     desc: '+50% offline earnings AND +20% prestige gem yield' },
    { id: 'mech',   icon: '🔋', name: 'Engineer',   desc: 'Fuel drains 35% slower AND auto-buy interval -1s' },
    { id: 'mystic', icon: '🌌', name: 'Astronomer', desc: 'Golden Gnomes spawn 2x more often AND buffs last 50% longer' },
  ]},
  { tier: 3, key: 'tier3', cost: 250, choices: [
    { id: 'eco',    icon: '👑', name: 'Tycoon',      desc: 'All coin income x2 once you hit 1M lifetime tiles mowed' },
    { id: 'mech',   icon: '🤖', name: 'Singularity', desc: 'Each robot beyond the first adds +5% to ALL multipliers' },
    { id: 'mystic', icon: '🔮', name: 'Oracle',      desc: 'Random events spawn 2x more often AND rewards x3' },
  ]},
];
const TECH_BY_KEY = Object.fromEntries(TECH_TREE.map(t => [t.key, t]));
function techPicked(tierKey) {
  return (state.techTree && state.techTree[tierKey]) || null;
}
function hasTech(tierKey, id) {
  return techPicked(tierKey) === id;
}
function respecCost() { return 50; }
function techCoinMult()         { return hasTech('tier1', 'eco')    ? 1.25 : 1; }
function techSpeedMult()        { return hasTech('tier1', 'mech')   ? 1.15 : 1; }
function techMowRateMult()      { return hasTech('tier1', 'mech')   ? 1.15 : 1; }
function techCritChanceBonus()  { return hasTech('tier1', 'mystic') ? 0.05 : 0; }
function techCritMultBonus()    { return hasTech('tier1', 'mystic') ? 1.5  : 0; }
function techOfflineMult()      { return hasTech('tier2', 'eco')    ? 1.5  : 1; }
function techPrestigeGemMult()  { return hasTech('tier2', 'eco')    ? 1.2  : 1; }
function techFuelDrainMult()    { return hasTech('tier2', 'mech')   ? 0.65 : 1; }
function techAutoBuyInterval()  { return hasTech('tier2', 'mech')   ? 2.0  : 3.0; }
function techGoldenGnomeMult()  { return hasTech('tier2', 'mystic') ? 2    : 1; }
function techBuffDurationMult() { return hasTech('tier2', 'mystic') ? 1.5  : 1; }
function techTycoonMult()       {
  return hasTech('tier3', 'eco') && (state.totalTilesMowed || 0) >= 1e6 ? 2 : 1;
}
function techSingularityMult()  {
  if (!hasTech('tier3', 'mech')) return 1;
  return 1 + 0.05 * Math.max(0, (state.upgrades && state.upgrades.robots || 1) - 1);
}
function techOracleEventMult()  { return hasTech('tier3', 'mystic') ? 2 : 1; }
function techOracleRewardMult() { return hasTech('tier3', 'mystic') ? 3 : 1; }

// ---------- Synergy upgrades (gem shop, second-order multipliers) ----------
const GARDEN_TYPE_KEYS = ['tree', 'rock', 'pond', 'flower', 'beehive', 'fountain', 'shed', 'gnome'];
function uniqueGardenTypes() {
  let n = 0;
  for (const k of GARDEN_TYPE_KEYS) if ((state.garden && state.garden[k]) > 0) n++;
  return n;
}
function pollinationMult() {
  const lvl = gemLvl('pollination'); if (lvl <= 0) return 1;
  const beeCount = (typeof bees !== 'undefined' && bees) ? bees.length : 0;
  return 1 + 0.003 * lvl * beeCount * (state.garden.flower || 0);
}
// Lawn-pedia carrot: tiny permanent coin bonus per unique discovery.
// +0.5% per species mowed, +0.2% per gnome met, +0.1% per buff triggered.
function pediaBonusMult() {
  const p = state.pedia;
  if (!p) return 1;
  const sp = (p.species || []).length;
  const gn = (p.gnomes  || []).length;
  const bf = (p.buffs   || []).length;
  return 1 + 0.005 * sp + 0.002 * gn + 0.001 * bf;
}
function coopBotsMult() {
  const lvl = gemLvl('coopBots'); if (lvl <= 0) return 1;
  return 1 + 0.005 * lvl * Math.max(0, (state.upgrades.robots || 1) - 1);
}
function symbiosisMult() {
  const lvl = gemLvl('symbiosis'); if (lvl <= 0) return 1;
  return 1 + 0.015 * lvl * uniqueGardenTypes();
}
function critCascadeBonus() {
  if (gemLvl('critCascade') <= 0) return 0;
  const headroom = Math.max(0, 10 - critMult());
  return Math.min(headroom, state.critCascadeStack || 0);
}
function noteCritForCascade() {
  const lvl = gemLvl('critCascade'); if (lvl <= 0) return;
  const headroom = Math.max(0, 10 - critMult());
  state.critCascadeStack = Math.min(headroom, (state.critCascadeStack || 0) + 0.4 * lvl);
}
function decayCritCascade(dt) {
  if (!state.critCascadeStack) return;
  state.critCascadeStack = Math.max(0, state.critCascadeStack - 0.5 * dt);
}
function activeFuelType(){ return FUEL_TYPES[state.upgrades.fuelType] || FUEL_TYPES[0]; }
function isElectric()   { return !activeFuelType().refuelable; }
function fuelEffMult()  {
  const mechanic = hasCrew('mechanic') ? 0.95 : 1;
  return Math.max(0.1, (1 - state.upgrades.fuelEff * 0.08) * mechanic);
}
function fuelDrainRate(){ return CFG.fuelDrainBase * state.upgrades.robots * fuelEffMult() * activeFuelType().drainMult * techFuelDrainMult(); }
// Refuel price scales with how empty the tank is. A full-tank fill-up costs
// the old flat rate; a nearly-full tank costs almost nothing. Minimum 1 coin
// whenever there's anything at all to top up.
function fuelRefillCostFull(){
  const mechanicDisc = hasCrew('mechanic') ? 0.75 : 1;
  return Math.ceil(25 * state.upgrades.robots * fuelEffMult() * mechanicDisc);
}
function fuelRefillCost(){
  const missing = Math.max(0, CFG.fuelMax - state.fuel);
  if (missing <= 0) return 0;
  const pct = missing / CFG.fuelMax;
  return Math.max(1, Math.ceil(fuelRefillCostFull() * pct));
}
function shedMult()    { return 1 + state.garden.shed * 0.05; }
function fountainMult(){ return 1 + state.garden.fountain * 0.08; }
function rockMult()    { return 1 + state.garden.rock * 0.005; }
function treeGrowth()  { return state.garden.tree * 0.01 + state.garden.pond * 0.03; }
function gnomeCritBonus(){ return state.garden.gnome * 0.01; }
function crewSpeedMult(){ return hasCrew('foreman') ? 1.05 : 1; }
function crewCoinMult(){ return hasCrew('efficiency') ? 1.10 : 1; }
function crewMowRateMult(){ return hasCrew('efficiency') ? 1.20 : 1; }
function crewCritBonus(){ return hasCrew('qualityControl') ? 0.04 : 0; }
function crewGrowthMult(){
  let m = 1;
  if (hasCrew('sprinkler')) m *= 1.15;
  if (hasCrew('headGardener')) m *= 1.30;
  return m;
}
// Mole mitigation — stacks upgrade × crew. Larger interval = rarer moles;
// smaller lifetime = shorter downtime per tile.
function moleSpawnIntervalMult() {
  const up = 1 + (state.upgrades.pest || 0) * 0.15;
  const crew = hasCrew('moleWarden') ? 2.0 : 1;
  return up * crew;
}
function moleLifetimeMult() {
  const up = Math.max(0.2, 1 - (state.upgrades.pest || 0) * 0.08);
  const crew = hasCrew('moleWarden') ? 0.5 : 1;
  return up * crew;
}

function weatherSafeSpeed()  { return typeof weatherSpeedMult  === 'function' ? weatherSpeedMult()  : 1; }
function weatherSafeGrowth() { return typeof weatherGrowthMult === 'function' ? weatherGrowthMult() : 1; }
function weatherSafeFlower() { return typeof weatherFlowerMult === 'function' ? weatherFlowerMult() : 1; }
function robotSpeed()  { return CFG.mowSpeedBase * (1 + state.upgrades.speed * 0.10) * shedMult() * crewSpeedMult() * weatherSafeSpeed() * rubyShopSpeedMult() * techSpeedMult() * techSingularityMult(); }
function mowRadius()   { return CFG.mowRadiusBase * (1 + state.upgrades.range * 0.08); }
function coinMult()    { return (1 + state.upgrades.value * 0.15) * gemMult() * fountainMult() * rockMult() * crewCoinMult() * gemShopCoinMult() * rubyShopCoinMult() * pollinationMult() * pediaBonusMult() * techCoinMult() * techTycoonMult() * techSingularityMult() * (hasActiveBuff('frenzy') ? 7 : 1); }
function growthRate()  {
  const base = CFG.growthRateBase * (1 + state.upgrades.growth * 0.12 + treeGrowth()) * gemShopGrowthMult() * weatherSafeGrowth() * rubyShopGrowthMult() * crewGrowthMult() * symbiosisMult() * techSingularityMult();
  return droughtActive() ? base * 0.5 : base;
}
// Random-event modifiers — read by growthRate() and cost helpers above.
function droughtActive() { return !!(state.activeEvent && state.activeEvent.id === 'drought'); }
function subsidyActive() { return !!(state.activeEvent && state.activeEvent.id === 'subsidy'); }
function mowRate()     { return CFG.mowRateBase * (1 + state.upgrades.rate * 0.15) * crewMowRateMult() * coopBotsMult() * techMowRateMult() * techSingularityMult(); }
function critChance()  {
  if (hasActiveBuff('critStorm')) return 1.0;
  return Math.min(0.75, state.upgrades.crit * 0.02 + gnomeCritBonus() + crewCritBonus() + gemShopCritBonus() + rubyShopCritBonus() + techCritChanceBonus());
}
function critMult()    { return hasActiveBuff('critStorm') ? 10 : (5 + techCritMultBonus()); }

function hasActiveBuff(key) {
  if (!state.activeBuffs || state.activeBuffs.length === 0) return false;
  for (let i = 0; i < state.activeBuffs.length; i++) {
    if (state.activeBuffs[i].key === key) return true;
  }
  return false;
}

function activeTool()  { return TOOL_TYPES[state.upgrades.tool] || TOOL_TYPES[0]; }
function playerMowRate()   { return CFG.playerBaseMowRate * activeTool().rateMult * crewMowRateMult(); }
function playerMowRadius() { return tileSize * activeTool().radiusTiles; }

// ---------- Formatting ----------
const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
function formatShort(n) {
  if (!isFinite(n)) return '∞';
  if (n > 0 && n < 1) return n.toFixed(2);
  if (n < 10)  return n.toFixed(1).replace(/\.0$/, '');
  if (n < 1000) return (n | 0).toString();
  if (state.settings && state.settings.scientificNumbers) {
    // "1.23e+6" → "1.23e6"; strip trailing zeros in the mantissa for readability.
    return n.toExponential(2).replace('e+', 'e').replace(/(\.\d*?)0+e/, '$1e').replace(/\.e/, 'e');
  }
  let i = 0;
  while (n >= 1000 && i < SUFFIX.length - 1) { n /= 1000; i++; }
  return n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0) + SUFFIX[i];
}

// ===== AUTO-EXPORTS =====
export { AREA_BY_ID, AREA_DEFS, AREA_EXPAND_COST_GEMS, COST, FUEL_TYPES, GARDEN_BY_KEY, GARDEN_DEFS, GEM_BY_KEY, GEM_UPGRADES, GRASS_BY_KEY, GRASS_TYPES, MAX, MOW_PATTERN_BY_KEY, MOW_PATTERN_DEFS, QUEST_BY_ID, QUEST_HISTORY_MAX, QUEST_TYPES, RARITY_COLORS, RUBY_BY_KEY, RUBY_UPGRADES, SETTING_DEFS, SKILL_BY_ID, SKILL_TREE, SKIN_BY_KEY, SKIN_DEFS, TECH_BY_KEY, TECH_TREE, TOOL_TYPES, ZEN_CONFIG_DEFAULT, ZEN_SLIDERS, activeFuelType, activeTool, applyMapDimensions, areaIsExpanded, areaUnlocked, coinMult, coopBotsMult, critCascadeBonus, critChance, critMult, currentArea, currentAreaSpeciesIdx, decayCritCascade, droughtActive, formatShort, fuelDrainRate, fuelRefillCost, gardenCost, gemLvl, gemMult, gemShopOfflineMult, gemShopPrestigeMult, gemUpgradeCost, getSetting, gnomeSpawnIntervalMult, growthRate, hasActiveBuff, hasCrew, hasTech, isElectric, moleLifetimeMult, moleSpawnIntervalMult, mowRadius, mowRate, noteCritForCascade, pediaBonusMult, playerMowRadius, playerMowRate, pollinationMult, respecCost, robotSpeed, rubyLvl, rubyShopAscendMult, rubyShopHasStartCrew, rubyShopHasWeatherControl, rubyShopOfflineCapHours, rubyShopPrestigeMult, rubyShopStartGems, rubyUpgradeCost, skinDropChance, startingCoinsFor, state, subsidyActive, symbiosisMult, techAutoBuyInterval, techBuffDurationMult, techCoinMult, techCritChanceBonus, techCritMultBonus, techFuelDrainMult, techGoldenGnomeMult, techMowRateMult, techOfflineMult, techOracleEventMult, techOracleRewardMult, techPicked, techPrestigeGemMult, techSingularityMult, techSpeedMult, techTycoonMult, uniqueGardenTypes };
