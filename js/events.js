// ===== AUTO-IMPORTS =====
import { formatShort, getSetting, state, techOracleEventMult, techOracleRewardMult } from './state.js';
import { beep } from './canvas.js';
import { toast } from './ui.js';
import { T } from './config.js';
import { grass, tiles } from './world.js';
// ===== END AUTO-IMPORTS =====

/* ============================================================
   Random events + scrolling news ticker
   ============================================================ */

// Flavor headlines — pure cosmetic, fed into the ticker between events.
const FLAVOR = [
  'Local bee union demands more flowers.',
  'Crystal grass futures up 4% on speculation.',
  'Rumor: a golden gnome was sighted near Old Man Withers\' lawn.',
  'Weather service: "Probably weather, possibly more."',
  'Mole population at all-time high — pest control overwhelmed.',
  'Mowhawk High wins regional landscaping championship.',
  'Sprinkler magnate buys third yacht, calls it "modest".',
  'Fountain enthusiasts gather for annual splash-off.',
  'Beehive HOA fines homeowner for "insufficient daisies".',
  'Robot uprising postponed; mowers cite lawn backlog.',
  'Garden gnome caught reading existential philosophy.',
  'Koi pond stocks tumble after sushi rumor.',
  'Lawnpedia entry #42 reaches one million page views.',
  'New study: grass grows back. More at 11.',
  'Mowhawk Industries unveils experimental triple-blade prototype.',
  'Fertilizer prices stable amid global compost shortage.',
  'Local rock awarded "Most Stationary" for sixth year running.',
  'Hedge fund collapses; literal hedge unaffected.',
  'Tree expresses cautious optimism about photosynthesis.',
  'Rivalry season heats up — mowers vie for the gold crown.',
  'Old Man Withers spotted yelling at clouds again.',
  'Beekeeper convention buzzes with controversy.',
  'Pest control union reaches tentative deal with moles.',
  'Weather machine inventor: "I regret nothing."',
  'Garden shed marketplace reaches new heights of opulence.',
  'Critics divided on new mowing pattern: "stripes or chaos?"',
  'Frostmoor expedition returns with frozen bee samples.',
  'Voidlands visitors report mild dizziness, no refunds offered.',
  'Goldshire mayor demands more golden gnomes for tourism.',
  'Treasure hunters dig up ordinary rock, declare it priceless.',
  'CEO of LawnBot Tycoon spotted enjoying their lawn.',
  'Weekly horoscope: Aries should mow diagonally on Tuesday.',
];

function avgGrassPct() {
  if (!grass || !tiles) return 0;
  let total = 0, n = 0;
  for (let i = 0; i < grass.length; i++) {
    if (tiles[i] === T.GRASS) { total += grass[i]; n++; }
  }
  return n > 0 ? total / n : 0;
}

const EVENTS = [
  {
    id: 'hoa', name: 'HOA Inspection',
    headline: '🏛️ HOA INSPECTION INCOMING — 60s to reach 95% lawn growth!',
    duration: 60, target: 0.95,
    description: 'Reach 95% average lawn growth.',
    init() {},
    progress() { return avgGrassPct(); },
    onSuccess() {
      state.gems += 5;
      state.totalGemsEarned = (state.totalGemsEarned || 0) + 5;
      toast('🏛️ Inspection passed! +5 💎', '#8ff09e');
      pushNews('🏛️ HOA satisfied — +5 💎', 'win');
    },
    onFail() {
      toast('🏛️ Inspection failed. Reputation -- (no penalty, you\'ll do better next time)', '#ffb4b4');
      pushNews('🏛️ HOA unimpressed.', 'danger');
    },
  },
  {
    id: 'drought', name: 'Drought Warning',
    headline: '🌵 DROUGHT — growth halved for 3 minutes (or pay 5000💰 to irrigate)',
    duration: 180, target: null,
    description: 'Growth halved. Pay 5000💰 to irrigate early.',
    init() {},
    progress() { return 0; },
    onSuccess() {
      toast('🌵 Drought ended — rain returns.', '#ffd34e');
      pushNews('🌵 Drought subsided.', 'win');
    },
    onFail: null,
    irrigate() {
      if (state.coins < 5000) {
        toast('Need 5000💰 to irrigate.', '#ffb4b4');
        return false;
      }
      state.coins -= 5000;
      toast('💧 Irrigated! Drought ended.', '#8ff09e');
      pushNews('💧 Irrigation crews break the drought.', 'win');
      state.activeEvent = null;
      return true;
    },
  },
  {
    id: 'subsidy', name: 'Fertilizer Subsidy',
    headline: '🧪 SUBSIDY — Growth/Fertilizer upgrades 50% off for 3 minutes!',
    duration: 180, target: null,
    description: 'Growth upgrades cost 50% less. Stock up!',
    init() {},
    progress() { return 0; },
    onSuccess() {
      toast('🧪 Subsidy expired.', '#ffd34e');
      pushNews('🧪 Fertilizer subsidy program ended.', 'alert');
    },
    onFail: null,
  },
  {
    id: 'parade', name: 'Parade Route',
    headline: '🎉 PARADE — mow a stripes pattern for 90s for a 1 ruby reward!',
    duration: 90, target: 60,
    description: 'Mow 60 tiles while striping the lawn.',
    init(ctx) {
      ctx.lastTotal = state.totalTilesMowed;
      ctx.counted = 0;
      ctx.requiredPattern = (Array.isArray(state.patternsUnlocked) && state.patternsUnlocked.indexOf('stripes') >= 0)
        ? 'stripes' : 'plain';
    },
    tick(ctx) {
      const delta = state.totalTilesMowed - (ctx.lastTotal || 0);
      ctx.lastTotal = state.totalTilesMowed;
      if (delta > 0 && state.activeMowPattern === ctx.requiredPattern) {
        ctx.counted = (ctx.counted || 0) + delta;
      }
    },
    progress(ctx) { return ctx.counted || 0; },
    onSuccess() {
      state.rubies = (state.rubies || 0) + 1;
      state.totalRubiesEarned = (state.totalRubiesEarned || 0) + 1;
      toast('🎉 Parade success! +1 ♦️', '#ff6b8b');
      pushNews('🎉 Parade success — crowd throws +1 ♦️', 'win');
    },
    onFail() {
      toast('Parade fizzled.', '#aaa');
      pushNews('🎉 Parade fizzled.', 'danger');
    },
  },
  {
    id: 'wedding', name: 'Neighbor\'s Wedding',
    headline: '💒 WEDDING — place 5+ flowers in 90s for a goodwill gift (3 💎)',
    duration: 90, target: 5,
    description: 'Plant 5 flowers as a wedding gift.',
    init(ctx) { ctx.startFlowers = state.garden.flower || 0; },
    progress(ctx) { return Math.max(0, (state.garden.flower || 0) - (ctx.startFlowers || 0)); },
    onSuccess() {
      state.gems += 3;
      state.totalGemsEarned = (state.totalGemsEarned || 0) + 3;
      toast('💒 Wedding gift delivered! +3 💎', '#8ff09e');
      pushNews('💒 Wedding gift delivered — +3 💎', 'win');
    },
    onFail() {
      toast('The wedding went on without your flowers.', '#aaa');
      pushNews('💒 Wedding wilted without flowers.', 'danger');
    },
  },
];
const EVENT_BY_ID = Object.fromEntries(EVENTS.map(e => [e.id, e]));

// ---------- News ticker ----------
let newsQueue = [];               // most-recent first
let lastTickerRefresh = 0;        // performance.now() of last full rebuild

function htmlEscape(s) {
  return String(s).replace(/[&<>"]/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[ch]));
}

function pickFlavor(n) {
  const out = [];
  const used = new Set();
  let safety = n * 6;
  while (out.length < n && used.size < FLAVOR.length && safety-- > 0) {
    const i = (Math.random() * FLAVOR.length) | 0;
    if (used.has(i)) continue;
    used.add(i);
    out.push(FLAVOR[i]);
  }
  return out;
}

function pushNews(text, kind) {
  newsQueue.unshift({ text, kind: kind || '' });
  if (newsQueue.length > 10) newsQueue.length = 10;
  refreshNewsTicker(true);
}

function refreshNewsTicker(force) {
  const now = performance.now();
  if (!force && now - lastTickerRefresh < 60000) return;
  lastTickerRefresh = now;
  const ticker = document.getElementById('newsTicker');
  const track = document.getElementById('newsTrack');
  if (!ticker || !track) return;
  const enabled = getSetting('newsTicker') !== false && !state.zenMode;
  ticker.style.display = enabled ? '' : 'none';
  if (!enabled) { track.innerHTML = ''; return; }
  const items = [];
  if (state.activeEvent) items.push({ text: state.activeEvent.headline, kind: 'alert' });
  for (const n of newsQueue) items.push(n);
  for (const f of pickFlavor(8)) items.push({ text: f, kind: '' });
  // Duplicate the strip so the linear scroll loops without a visible gap.
  const html = items.concat(items)
    .map(i => `<span class="item ${i.kind}">${htmlEscape(i.text)}</span>`)
    .join('');
  track.innerHTML = html;
}

// ---------- Event scheduler ----------
function spawnEvent() {
  const def = EVENTS[(Math.random() * EVENTS.length) | 0];
  const ctx = {};
  if (def.init) def.init(ctx);
  state.activeEvent = {
    id: def.id, name: def.name, headline: def.headline,
    duration: def.duration, target: def.target,
    started: Date.now() / 1000,
    ctx,
  };
  beep(880, 0.08, 'square', 0.06);
  setTimeout(() => beep(660, 0.08, 'square', 0.06), 110);
  pushNews(def.headline, 'alert');
  if (typeof toast === 'function') toast(`📰 ${def.name}!`, '#ffd34e');
}

function callRewardWithOracle(fn, ctx) {
  const mult = techOracleRewardMult();
  if (mult <= 1) { fn(ctx); return; }
  const before = {
    gems: state.gems || 0,
    totalGemsEarned: state.totalGemsEarned || 0,
    rubies: state.rubies || 0,
    totalRubiesEarned: state.totalRubiesEarned || 0,
    coins: state.coins || 0,
    totalEarnedThisRun: state.totalEarnedThisRun || 0,
    totalEarnedAllTime: state.totalEarnedAllTime || 0,
  };
  fn(ctx);
  const extra = (k) => Math.max(0, (state[k] || 0) - (before[k] || 0)) * (mult - 1);
  const dGems = extra('gems');
  const dGemsTotal = extra('totalGemsEarned');
  const dRubies = extra('rubies');
  const dRubiesTotal = extra('totalRubiesEarned');
  const dCoins = extra('coins');
  const dRun = extra('totalEarnedThisRun');
  const dAll = extra('totalEarnedAllTime');
  if (dGems)        state.gems              = (state.gems              || 0) + dGems;
  if (dGemsTotal)   state.totalGemsEarned   = (state.totalGemsEarned   || 0) + dGemsTotal;
  if (dRubies)      state.rubies            = (state.rubies            || 0) + dRubies;
  if (dRubiesTotal) state.totalRubiesEarned = (state.totalRubiesEarned || 0) + dRubiesTotal;
  if (dCoins)       state.coins             = (state.coins             || 0) + dCoins;
  if (dRun)         state.totalEarnedThisRun= (state.totalEarnedThisRun|| 0) + dRun;
  if (dAll)         state.totalEarnedAllTime= (state.totalEarnedAllTime|| 0) + dAll;
}

function updateEvents(dt) {
  if (state.zenMode) return;
  if (getSetting('newsTicker') === false) {
    if (state.activeEvent) state.activeEvent = null;
    refreshNewsTicker(false);
    return;
  }

  if (state.activeEvent) {
    const def = EVENT_BY_ID[state.activeEvent.id];
    if (!def) {
      state.activeEvent = null;
    } else {
      const ctx = state.activeEvent.ctx || (state.activeEvent.ctx = {});
      if (def.tick) def.tick(ctx);
      const now = Date.now() / 1000;
      const elapsed = now - state.activeEvent.started;
      const remaining = state.activeEvent.duration - elapsed;
      const goalMet = def.target != null && def.progress(ctx) >= def.target;
      if (goalMet) {
        if (def.onSuccess) callRewardWithOracle(def.onSuccess, ctx);
        state.activeEvent = null;
      } else if (remaining <= 0) {
        // No-target events (drought, subsidy) treat expiration as natural success.
        if (def.target == null) {
          if (def.onSuccess) callRewardWithOracle(def.onSuccess, ctx);
        } else if (def.onFail) {
          def.onFail(ctx);
        }
        state.activeEvent = null;
      }
    }
  } else {
    if (!isFinite(state.eventTimer)) state.eventTimer = 240 + Math.random() * 180;
    state.eventTimer -= dt;
    if (state.eventTimer <= 0) {
      spawnEvent();
      state.eventTimer = (240 + Math.random() * 180) / techOracleEventMult();
    }
  }

  refreshNewsTicker(false);
}

function tryIrrigate() {
  if (!state.activeEvent || state.activeEvent.id !== 'drought') return false;
  const def = EVENT_BY_ID.drought;
  return def.irrigate ? def.irrigate() : false;
}

function updateEventBanner() {
  const banner = document.getElementById('eventBanner');
  if (!banner) return;
  const ev = state.activeEvent;
  const enabled = getSetting('newsTicker') !== false && !state.zenMode;
  if (!ev || !enabled) {
    if (banner.style.display !== 'none') {
      banner.style.display = 'none';
      banner.innerHTML = '';
    }
    return;
  }
  const def = EVENT_BY_ID[ev.id];
  if (!def) { banner.style.display = 'none'; return; }
  const now = Date.now() / 1000;
  const remaining = Math.max(0, ev.duration - (now - ev.started));
  const ctx = ev.ctx || {};
  const progress = def.target != null ? def.progress(ctx) : 0;
  const target = def.target;
  const pct = target != null
    ? Math.min(100, (progress / target) * 100)
    : Math.min(100, ((ev.duration - remaining) / ev.duration) * 100);
  const progStr = target != null
    ? `${formatShort(progress)}/${formatShort(target)}`
    : `${(target == null ? '⏳' : '')}`;
  let actionBtn = '';
  if (ev.id === 'drought') {
    const can = state.coins >= 5000;
    actionBtn = `<button class="ev-action" id="evIrrigateBtn"${can ? '' : ' disabled'}>💧 Irrigate (5000💰)</button>`;
  }
  banner.style.display = '';
  banner.innerHTML =
    `<span class="q-name">📰 ${htmlEscape(def.name)}</span>` +
    `<span class="q-title">${htmlEscape(def.description)}</span>` +
    `<div class="q-bar"><div class="q-fill" style="width:${pct}%"></div></div>` +
    (target != null ? `<span class="q-progress">${progStr}</span>` : '') +
    `<span class="q-time">⏱ ${remaining.toFixed(0)}s</span>` +
    actionBtn;
  const btn = banner.querySelector('#evIrrigateBtn');
  if (btn) btn.addEventListener('click', tryIrrigate);
}

// ===== AUTO-EXPORTS =====
export { EVENTS, EVENT_BY_ID, FLAVOR, pushNews, refreshNewsTicker, tryIrrigate, updateEventBanner, updateEvents };
