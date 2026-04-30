// ===== AUTO-IMPORTS =====
import { iconize } from './assets.js';
import { AREA_BY_ID, AREA_DEFS, AREA_EXPAND_COST_GEMS, COST, FUEL_TYPES, GARDEN_BY_KEY, GARDEN_DEFS, GEM_BY_KEY, GEM_UPGRADES, GRASS_BY_KEY, GRASS_TYPES, MAX, MOW_PATTERN_BY_KEY, MOW_PATTERN_DEFS, QUEST_BY_ID, RARITY_COLORS, RUBY_BY_KEY, RUBY_UPGRADES, SETTING_DEFS, SKILL_BY_ID, SKILL_TREE, SKIN_BY_KEY, SKIN_DEFS, TECH_BY_KEY, TECH_TREE, TOOL_TYPES, ZEN_CONFIG_DEFAULT, ZEN_SLIDERS, activeFuelType, activeTool, applyMapDimensions, areaIsExpanded, areaUnlocked, critChance, critMult, currentArea, formatShort, fuelDrainRate, fuelRefillCost, gardenCost, gemLvl, gemMult, gemShopPrestigeMult, gemUpgradeCost, hasCrew, hasTech, isElectric, pediaBonusMult, playerMowRate, respecCost, rubyLvl, rubyShopAscendMult, rubyShopHasStartCrew, rubyShopHasWeatherControl, rubyShopPrestigeMult, rubyShopStartGems, rubyUpgradeCost, startingCoinsFor, state, techBuffDurationMult, techPicked, techPrestigeGemMult } from './state.js';
import { CFG, T } from './config.js';
import { DAY_TIME_KEYS, DAY_TIME_PRESETS, WEATHER_BY_ID, WEATHER_TYPES, activeWeather, takeZenPhoto } from './atmosphere.js';
import { addParticle, beep, canvas, flashCoin, particles, resizeCanvas, tileSize } from './canvas.js';
import { allocateWorldArrays, bees, clearActors, ensureBeesFromHives, ensureRobotCount, expandCurrentArea, flowerColors, goldenGnomes, grass, grassSpecies, initWorld, moles, placeAtRandomGrass, player, restoreWorldFromSnapshot, robots, switchArea, tiles, treasures, visitorGnomes } from './world.js';
import { applyThemeDom } from './themes.js';
import { clearTileCache, mowPatternTint } from './render.js';
import { resetGame, saveGame } from './save.js';
import { updateEventBanner } from './events.js';
// ===== END AUTO-IMPORTS =====

/* ============================================================
   HUD, shop UI, toasts, achievements, tabs, footer buttons
   ============================================================ */

// Assign innerHTML with emoji→sprite swap baked in. When the
// `useSprites` setting is off this is a straight passthrough, so it's
// safe to use at every shop/HUD site. See iconize() in js/assets.js.
function setHTML(el, html) {
  if (el) el.innerHTML = iconize(html);
}

// Walk static HUD DOM and re-run iconize on their current innerHTML.
// Called after sprites preload and whenever the `useSprites` toggle
// flips (see wireUIEvents settings handler). Idempotent — iconize is
// a no-op when sprites are off.
function iconizeStaticHUD() {
  const selectors = [
    '.title', '.currencies .ico', '.hud-pill',
    '.tab', '.shop-tabs button', '.footer-bar button',
  ];
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      // Stash the original emoji-flavoured HTML once so we can reset
      // it when the toggle flips back to off.
      if (!el.dataset.iconOrig) el.dataset.iconOrig = el.innerHTML;
      el.innerHTML = iconize(el.dataset.iconOrig);
    }
  }
}

// ---------- HUD ----------
let lastCoinDisplay = 0;
let lastRateSample = { t: performance.now(), coins: 0 };
let displayedRate = 0;
function updateHUD() {
  const coinAmt = document.getElementById('coinAmt');
  const newVal = formatShort(state.coins);
  if (coinAmt.textContent !== newVal) {
    coinAmt.textContent = newVal;
    if (state.coins - lastCoinDisplay > 0.0001) flashCoin();
    lastCoinDisplay = state.coins;
  }
  document.getElementById('gemAmt').textContent = formatShort(state.gems);
  document.getElementById('gemBonus').textContent = `+${Math.round((gemMult() - 1) * 100)}% bonus`;

  const now = performance.now();
  if (now - lastRateSample.t > 700) {
    const dt = (now - lastRateSample.t) / 1000;
    const earned = state.totalEarnedAllTime - lastRateSample.coins;
    const rate = earned / dt;
    displayedRate = displayedRate * 0.7 + rate * 0.3;
    lastRateSample.t = now; lastRateSample.coins = state.totalEarnedAllTime;
    document.getElementById('coinRate').textContent = `+${formatShort(displayedRate)} / sec`;
  }

  const fuelPct = state.fuel / CFG.fuelMax;
  const ft = activeFuelType();
  const fuelBar = document.getElementById('hudFuelBar');
  const fuelLabel = document.getElementById('hudFuelLabel');
  const refuelBtn = document.getElementById('refuelBtn');
  fuelBar.style.width = (fuelPct * 100) + '%';
  fuelBar.style.background = fuelPct < 0.25 ? 'linear-gradient(90deg,#ff2222,#ff6644)' : ft.barColor;
  const netRate = ft.recharge - fuelDrainRate();
  const rateStr = (netRate >= 0 ? '+' : '') + netRate.toFixed(2) + '/s';
  fuelLabel.textContent = ft.icon + ' ' + ft.name + ' ' + Math.round(fuelPct * 100) + '% (' + rateStr + ')';
  refuelBtn.style.display = ft.refuelable ? '' : 'none';
  const refillCost = fuelRefillCost();
  refuelBtn.disabled = state.coins < refillCost || state.fuel >= CFG.fuelMax;
  setHTML(document.getElementById('refuelCost'), '💰' + formatShort(refillCost));

  document.getElementById('hudRobots').textContent = state.upgrades.robots;
  let total = 0, count = 0;
  for (let i = 0; i < grass.length; i++) {
    if (tiles[i] === T.GRASS) { total += grass[i]; count++; }
  }
  const pct = count > 0 ? Math.round(total / count * 100) : 0;
  document.getElementById('hudGrass').textContent = pct + '%';
  document.getElementById('hudFlowers').textContent = state.garden.flower;
  document.getElementById('hudBees').textContent = bees.length;
  document.getElementById('hudTotal').textContent = formatShort(state.totalTilesMowed);

  // Atmosphere pill: weather icon + name, plus a small clock when relevant.
  const atmoEl = document.getElementById('hudAtmo');
  if (atmoEl && typeof activeWeather === 'function') {
    const weatherMode = (state.settings && state.settings.weather) || 'auto';
    const dayMode = (state.settings && state.settings.dayNight) || 'auto';
    const showW = weatherMode !== 'off';
    const showD = dayMode !== 'off';
    const w = activeWeather();
    const hour = Math.floor(state.timeOfDay || 12);
    let timeIco = '';
    if (showD) {
      if (hour < 5 || hour >= 20) timeIco = ' 🌙';
      else if (hour < 7)          timeIco = ' 🌅';
      else if (hour < 17)         timeIco = '';        // daytime — no icon clutter
      else if (hour < 20)         timeIco = ' 🌇';
    }
    const weatherText = showW ? `${w.icon} ${w.name}` : '';
    const hasControl = typeof rubyShopHasWeatherControl === 'function' && rubyShopHasWeatherControl();
    const lockLabel = hasControl && weatherMode !== 'auto' ? ' 🔒' : '';
    atmoEl.textContent = `${weatherText}${lockLabel}${timeIco}`.trim();
    atmoEl.style.display = (showW || timeIco) ? '' : 'none';
    atmoEl.style.cursor = hasControl ? 'pointer' : '';
    atmoEl.style.pointerEvents = hasControl ? 'auto' : '';
    atmoEl.title = hasControl ? 'Click to change weather' : 'Weather and time of day';
  }

  // Active buff pill — show timed buffs + countdown. Hidden if none active.
  const buffsEl = document.getElementById('hudBuffs');
  if (buffsEl) {
    const list = Array.isArray(state.activeBuffs) ? state.activeBuffs : [];
    if (list.length === 0) {
      buffsEl.style.display = 'none';
      buffsEl.textContent = '';
    } else {
      buffsEl.style.display = '';
      buffsEl.textContent = list
        .map(b => `${b.icon || '⏳'} ${b.name} ${Math.max(0, Math.ceil(b.expires))}s`)
        .join(' · ');
    }
  }

  const qBanner = document.getElementById('questBanner');
  if (qBanner) {
    const q = state.activeQuest;
    if (q && !state.zenMode) {
      const tpl = QUEST_BY_ID[q.id];
      const progress = tpl ? Math.max(0, tpl.getDelta(q)) : 0;
      const pctQ = Math.min(100, (progress / q.goal) * 100);
      const remaining = Math.max(0, q.duration - q.elapsed);
      const rewardStr = q.rewardType === 'gems' ? `+${q.reward}💎` : `+${formatShort(q.reward)}💰`;
      qBanner.style.display = '';
      qBanner.innerHTML =
        iconize(`<span class="q-name">👋 ${q.neighbor}</span>` +
        `<span class="q-title">${q.title}</span>` +
        `<div class="q-bar"><div class="q-fill" style="width:${pctQ}%"></div></div>` +
        `<span class="q-progress">${formatShort(progress)}/${formatShort(q.goal)}</span>` +
        `<span class="q-time">⏱ ${remaining.toFixed(0)}s</span>` +
        `<span class="q-reward">${rewardStr}</span>`);
    } else {
      qBanner.style.display = 'none';
    }
  }
  updateEventBanner();
}

function showQuestOfferModal(quest) {
  if (document.querySelector('.quest-offer')) return;
  if (gemLvl('autoQuest') > 0) {
    state.activeQuest = quest;
    beep(660, 0.08, 'sine', 0.06);
    toast(`📋 ${quest.neighbor}: ${quest.title}`, '#ffd34e');
    return;
  }
  const back = document.createElement('div');
  back.className = 'modal-backdrop quest-offer';
  const rewardStr = quest.rewardType === 'gems'
    ? `+${quest.reward} 💎`
    : `+${formatShort(quest.reward)} 💰`;
  back.innerHTML = iconize(`
    <div class="modal">
      <h2>👋 ${quest.neighbor}</h2>
      <p style="font-style:italic; opacity:0.85;">"${quest.flavor}"</p>
      <div class="big">${quest.title}</div>
      <p>Time limit: <b>${quest.duration}s</b> · Reward: <b>${rewardStr}</b></p>
      <div style="display:flex; gap:10px; justify-content:center; margin-top:12px;">
        <button id="qAccept">Accept</button>
        <button id="qDecline" class="danger">Decline</button>
      </div>
    </div>`);
  document.body.appendChild(back);
  back.querySelector('#qAccept').addEventListener('click', () => {
    state.activeQuest = quest;
    back.remove();
    beep(660, 0.08, 'sine', 0.06);
    toast(`📋 Quest accepted: ${quest.title}`, '#ffd34e');
  });
  back.querySelector('#qDecline').addEventListener('click', () => {
    back.remove();
    toast(`${quest.neighbor} grumbles and leaves...`, '#aaa');
    state.questTimer = CFG.questDeclineCooldown + Math.random() * 40;
  });
}

// ---------- Shop / Upgrades UI ----------
// Compact rows: short name, one-line status. Next-step detail lives in the button tooltip.
const UPGRADE_DEFS = [
  { key: 'robots', icon: '🤖', name: 'Robot',
    desc: (s) => `Fleet: ${s.upgrades.robots}`,
    effect: () => `Deploy one more robot on the lawn`, show: () => true },
  { key: 'speed',  icon: '⚡', name: 'Turbo Motors',
    desc: (s) => `+${s.upgrades.speed * 10}% move speed`,
    effect: () => `+10% robot move speed` },
  { key: 'range',  icon: '📏', name: 'Wider Blades',
    desc: (s) => `+${s.upgrades.range * 8}% cut range`,
    effect: () => `+8% cutting radius` },
  { key: 'rate',   icon: '🌀', name: 'Sharper Blades',
    desc: (s) => `+${s.upgrades.rate * 15}% mow rate`,
    effect: () => `+15% mow speed` },
  { key: 'value',  icon: '💰', name: 'Golden Clippings',
    desc: (s) => `+${s.upgrades.value * 15}% coin value`,
    effect: () => `+15% coins per mow` },
  { key: 'growth', icon: '🌱', name: 'Fertilizer',
    desc: (s) => `+${s.upgrades.growth * 12}% growth`,
    effect: () => `+12% grass regrowth` },
  { key: 'crit',    icon: '🎯', name: 'Lucky Mower',
    desc: () => `Crit ${(critChance()*100).toFixed(1)}% · ×${critMult()}`,
    effect: () => `+2% crit chance` },
  { key: 'fuelEff', icon: '🔩', name: 'Fuel Efficiency',
    desc: () => `Drain ${fuelDrainRate().toFixed(2)}/s`,
    effect: () => `-8% fuel consumption` },
  { key: 'pest',   icon: '🐹', name: 'Pest Control',
    desc: (s) => `Moles: +${s.upgrades.pest * 15}% interval · -${s.upgrades.pest * 8}% lifetime`,
    effect: () => `Rarer moles, shorter dig-ins` },
  { key: 'fuelType', icon: '⛽', name: 'Fuel Type',
    desc: (s) => {
      const cur = FUEL_TYPES[s.upgrades.fuelType];
      const nxt = FUEL_TYPES[s.upgrades.fuelType + 1];
      return nxt ? `${cur.icon} ${cur.name} → ${nxt.icon} ${nxt.name}` : `${cur.icon} ${cur.name} · MAX`;
    },
    effect: (s) => {
      const nxt = FUEL_TYPES[s.upgrades.fuelType + 1];
      return nxt ? `${(nxt.drainMult*100)|0}% drain · ${nxt.recharge}/s regen${nxt.refuelable ? '' : ' · no refuel needed'}` : '';
    },
  },
];

let activeTab = 'upgrades';

// ---------- Bulk-buy modifier ----------
// Hold Shift for ×10, Ctrl/Cmd for ×100, both for Max affordable.
// Session-only — never persisted.
let buyMult = 1;
function updateBuyMult(e) {
  const shift = !!e.shiftKey;
  const ctrl = !!(e.ctrlKey || e.metaKey);
  let next = 1;
  if (shift && ctrl) next = Infinity;
  else if (ctrl) next = 100;
  else if (shift) next = 10;
  if (next !== buyMult) {
    buyMult = next;
    renderShop();
  }
}
function buyMultLabel() {
  if (buyMult === Infinity) return 'MAX';
  if (buyMult > 1) return '×' + buyMult;
  return '';
}
// Plan a sequence of purchases. `nextCost(i)` returns cost of the (i+1)-th purchase,
// `canBuyMore(i)` returns true if another purchase is still allowed (not maxed).
// Returns { count, total } limited by buyMult and current coins.
function planBulk(nextCost, canBuyMore) {
  let count = 0, total = 0, coinsLeft = state.coins;
  while (count < buyMult && canBuyMore(count)) {
    const c = nextCost(count);
    if (!isFinite(c) || coinsLeft < c) break;
    coinsLeft -= c;
    total += c;
    count++;
  }
  return { count, total };
}

// Hide gem/ruby tabs until the player has actually touched those currencies.
// Called at the top of renderShop so visibility updates on every refresh.
function updateTabsVisibility() {
  const hasGems = (state.totalGemsEarned || 0) > 0 || (state.gems || 0) > 0;
  const hasRubies = (state.totalRubiesEarned || 0) > 0 || (state.rubies || 0) > 0;
  const hasAreas = rubyLvl('unlockAreas') > 0;
  const vis = { gemshop: hasGems, rubyshop: hasRubies, areas: hasAreas };
  for (const tab of document.querySelectorAll('.tab')) {
    const key = tab.dataset.tab;
    if (key in vis) tab.style.display = vis[key] ? '' : 'none';
  }
  // If the currently-active tab just got hidden, fall back to Bots.
  if (activeTab in vis && !vis[activeTab]) {
    activeTab = 'upgrades';
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === activeTab));
  }
}

function renderShop() {
  const list = document.getElementById('shopList');
  list.innerHTML = '';
  updateTabsVisibility();

  if (buyMult !== 1) {
    const hint = document.createElement('div');
    hint.className = 'buy-mode-hint';
    hint.textContent = `Bulk-buy mode: ${buyMultLabel()} (Shift ×10 · Ctrl ×100 · Shift+Ctrl MAX)`;
    list.appendChild(hint);
  }

  if (activeTab === 'prestige') { renderPrestige(list); return; }
  if (activeTab === 'garden')   { renderGarden(list);   return; }
  if (activeTab === 'crew')     { renderCrew(list);     return; }
  if (activeTab === 'skins')    { renderSkins(list);    return; }
  if (activeTab === 'tools')    { renderTools(list);    return; }
  if (activeTab === 'areas')    { renderAreas(list);     return; }
  if (activeTab === 'quests')   { renderQuests(list);    return; }
  if (activeTab === 'gemshop')  { renderGemShop(list);   return; }
  if (activeTab === 'rubyshop') { renderRubyShop(list);  return; }

  for (const up of UPGRADE_DEFS) {
    if (up.show && !up.show()) continue;
    const lvl = state.upgrades[up.key];
    const maxed = lvl >= MAX[up.key];
    const plan = maxed ? { count: 0, total: 0 } : planBulk(
      (i) => COST[up.key](lvl + i),
      (i) => lvl + i < MAX[up.key],
    );
    const singleCost = maxed ? Infinity : COST[up.key](lvl);
    const affordable = plan.count > 0;
    const row = document.createElement('div');
    row.className = 'upgrade' + (affordable ? ' affordable' : '') + (maxed ? ' maxed' : '');
    const tooltip = maxed ? 'Fully upgraded' : up.effect(state);
    const buyLabel = maxed ? 'MAX' : (plan.count > 1 ? `Buy ×${plan.count}` : 'Buy');
    const costLabel = maxed ? '—' : '💰 ' + formatShort(plan.count > 0 ? plan.total : singleCost);
    row.innerHTML = iconize(`
      <div class="icon">${up.icon}</div>
      <div class="info">
        <div class="name">${up.name} ${up.key !== 'robots' ? `<span class="lvl">Lv ${lvl}</span>` : ''}</div>
        <div class="effect">${maxed ? '⭐ MAXED' : up.desc(state)}</div>
      </div>
      <button class="buy" ${affordable ? '' : 'disabled'} title="${tooltip.replace(/"/g,'&quot;')}">
        ${buyLabel}
        <span class="cost">${costLabel}</span>
      </button>
    `);
    row.querySelector('.buy').addEventListener('click', () => buy(up.key));
    list.appendChild(row);
  }
}

function renderQuests(list) {
  const q = state.activeQuest;
  const nextIn = Math.max(0, state.questTimer || 0);

  const header = document.createElement('div');
  header.innerHTML = iconize(`
    <p style="font-size:12px; color:var(--ink-dim); margin-bottom:10px; line-height:1.4;">
      Neighbors drop by with odd jobs. Finish in time → earn
      <b style="color:#ffd34e;">coins</b> or rare <b style="color:#72f2ff;">gems</b>.
      Decline and they sulk off for a bit.
    </p>`);
  list.appendChild(header);

  const summary = document.createElement('div');
  summary.className = 'upgrade';
  summary.style.gridTemplateColumns = '42px 1fr auto';
  summary.innerHTML = iconize(`
    <div class="icon">📋</div>
    <div class="info">
      <div class="name">Quests Completed <span class="lvl">×${state.questsCompleted || 0}</span></div>
      <div class="effect">${q ? '🔥 Quest in progress' : `Next neighbor in ~${Math.ceil(nextIn)}s`}</div>
    </div>
    <div style="font-size:22px; text-align:right;">${q ? '👋' : '🕒'}</div>
  `);
  list.appendChild(summary);

  if (q) {
    const tpl = QUEST_BY_ID[q.id];
    const progress = tpl ? Math.max(0, tpl.getDelta(q)) : 0;
    const pctQ = Math.min(100, (progress / q.goal) * 100);
    const remaining = Math.max(0, q.duration - q.elapsed);
    const rewardStr = q.rewardType === 'gems' ? `+${q.reward} 💎` : `+${formatShort(q.reward)} 💰`;
    const active = document.createElement('div');
    active.className = 'upgrade affordable';
    active.innerHTML = iconize(`
      <div class="icon">👋</div>
      <div class="info">
        <div class="name">${q.neighbor} <span class="lvl">ACTIVE</span></div>
        <div class="effect">${q.title}</div>
        <div class="q-bar" style="margin-top:6px; width:100%;"><div class="q-fill" style="width:${pctQ}%"></div></div>
        <div style="font-size:11px; color:var(--ink-dim); margin-top:4px;">
          ${formatShort(progress)} / ${formatShort(q.goal)} · ⏱ ${remaining.toFixed(0)}s · ${rewardStr}
        </div>
      </div>
    `);
    list.appendChild(active);
  }

  const history = Array.isArray(state.questHistory) ? state.questHistory : [];
  const heading = document.createElement('p');
  heading.style.cssText = 'font-size:11px; color:var(--ink-dim); margin:14px 0 6px; text-transform:uppercase; letter-spacing:0.5px;';
  heading.textContent = history.length ? 'History' : 'No quests accepted yet';
  list.appendChild(heading);

  for (const h of history) {
    const ok = h.outcome === 'success';
    const rewardStr = h.rewardType === 'gems' ? `+${h.reward} 💎` : `+${formatShort(h.reward)} 💰`;
    const row = document.createElement('div');
    row.className = 'upgrade' + (ok ? '' : ' maxed');
    row.style.gridTemplateColumns = '42px 1fr auto';
    row.innerHTML = iconize(`
      <div class="icon">${ok ? '✅' : '❌'}</div>
      <div class="info">
        <div class="name">${h.neighbor}</div>
        <div class="effect">${h.title}</div>
      </div>
      <div style="text-align:right; font-size:11px;">
        <div style="color:${ok ? '#8ff09e' : '#ffb4b4'}; font-weight:700;">${ok ? 'SUCCESS' : 'FAILED'}</div>
        <div style="color:${ok ? '#ffd34e' : 'var(--ink-dim)'};">${ok ? rewardStr : '—'}</div>
      </div>
    `);
    list.appendChild(row);
  }
}

function renderGarden(list) {
  const header = document.createElement('div');
  header.innerHTML = iconize(`
    <p style="font-size:12px; color:var(--ink-dim); margin-bottom:10px; line-height:1.4;">
      Build your dream garden. Placements auto-drop on random grass.<br>
      <b style="color:var(--grass-xlight);">Bonuses stack.</b> 🌸 flowers feed 🐝 bees.
    </p>`);
  list.appendChild(header);
  for (const def of GARDEN_DEFS) {
    const owned = state.garden[def.key];
    const maxed = owned >= def.max;
    const plan = maxed ? { count: 0, total: 0 } : planBulk(
      (i) => Math.ceil(def.baseCost * Math.pow(def.mult, owned + i)),
      (i) => owned + i < def.max,
    );
    const singleCost = maxed ? Infinity : gardenCost(def.key);
    const affordable = plan.count > 0;
    const row = document.createElement('div');
    row.className = 'upgrade' + (affordable ? ' affordable' : '');
    const placeLabel = maxed ? 'MAX' : (plan.count > 1 ? `Place ×${plan.count}` : 'Place');
    const costLabel = maxed ? '—' : '💰 ' + formatShort(plan.count > 0 ? plan.total : singleCost);
    row.innerHTML = iconize(`
      <div class="icon">${def.icon}</div>
      <div class="info">
        <div class="name">${def.name} <span class="lvl">× ${owned}/${def.max}</span></div>
        <div class="effect">${def.desc()}</div>
      </div>
      <button class="buy" ${affordable ? '' : 'disabled'}>
        ${placeLabel}
        <span class="cost">${costLabel}</span>
      </button>
    `);
    row.querySelector('.buy').addEventListener('click', () => buyGarden(def.key));
    list.appendChild(row);
  }
}

function buyGarden(key) {
  const def = GARDEN_BY_KEY[key];
  const startOwned = state.garden[key];
  // Plan with predictive cost, but each buy also has to actually find free grass —
  // so we commit one-at-a-time and stop if a placement fails.
  const plan = planBulk(
    (i) => Math.ceil(def.baseCost * Math.pow(def.mult, startOwned + i)),
    (i) => startOwned + i < def.max,
  );
  if (plan.count === 0) return;
  let placedCount = 0;
  let spentSoFar = 0;
  let lastPlacement = null;
  for (let i = 0; i < plan.count; i++) {
    const cost = Math.ceil(def.baseCost * Math.pow(def.mult, startOwned + i));
    const placed = placeAtRandomGrass(def.type);
    if (!placed) break;
    state.coins -= cost;
    state.garden[key] = startOwned + i + 1;
    spentSoFar += cost;
    placedCount++;
    lastPlacement = placed;
  }
  if (placedCount === 0) {
    toast('⚠️ No free grass tile found!', '#ffb4b4');
    return;
  }
  beep(500 + startOwned * 15, 0.08, 'sine', 0.07);
  if (key === 'beehive') {
    ensureBeesFromHives();
    toast(`🐝 Placed ${placedCount} beehive${placedCount > 1 ? 's' : ''}!`, '#ffd34e');
  } else if (lastPlacement) {
    addParticle((lastPlacement.x + 0.5) * tileSize, (lastPlacement.y + 0.5) * tileSize, {
      text: (placedCount > 1 ? `×${placedCount} ` : '+') + def.icon, color: '#8ff09e', size: 18,
    });
  }
  if (placedCount < plan.count) toast(`⚠️ Only ${placedCount} of ${plan.count} placed — lawn is full.`, '#ffb4b4');
  renderShop();
  saveGame();
}

function renderTools(list) {
  const cur = activeTool();
  const header = document.createElement('div');
  header.innerHTML = iconize(`
    <p style="font-size:12px; color:var(--ink-dim); margin-bottom:10px; line-height:1.4;">
      Your character follows the mouse and mows grass where the cursor stands.<br>
      <b style="color:var(--grass-xlight);">Equipped:</b> ${cur.icon} ${cur.name}
      — ${playerMowRate().toFixed(1)} grass/sec · radius ${cur.radiusTiles.toFixed(1)} tiles.
    </p>`);
  list.appendChild(header);

  const startIdx = state.upgrades.tool;
  const toolPlan = planBulk(
    (i) => TOOL_TYPES[startIdx + 1 + i]?.upgradeCost ?? Infinity,
    (i) => startIdx + 1 + i < TOOL_TYPES.length,
  );
  // Which tiers will this click skip past?
  const skipUntil = startIdx + toolPlan.count;

  for (let i = 0; i < TOOL_TYPES.length; i++) {
    const tool = TOOL_TYPES[i];
    const owned = state.upgrades.tool >= i;
    const isNext = i === state.upgrades.tool + 1;
    const row = document.createElement('div');
    const classes = ['upgrade'];
    if (isNext && toolPlan.count > 0) classes.push('affordable');
    if (i === state.upgrades.tool) classes.push('active');
    if (isNext && i <= skipUntil && toolPlan.count > 1) classes.push('affordable');
    row.className = classes.join(' ');
    let btn;
    if (owned) {
      btn = `<button class="buy" disabled>${i === state.upgrades.tool ? '✔ EQUIPPED' : 'OWNED'}</button>`;
    } else if (isNext) {
      const canBuy = toolPlan.count > 0;
      const label = canBuy && toolPlan.count > 1 ? `Buy ×${toolPlan.count}` : 'Buy';
      const costText = canBuy ? formatShort(toolPlan.total) : formatShort(tool.upgradeCost ?? 0);
      btn = `<button class="buy" ${canBuy ? '' : 'disabled'}>${label}<span class="cost">💰 ${costText}</span></button>`;
    } else {
      btn = `<button class="buy" disabled>🔒 LOCKED</button>`;
    }
    row.innerHTML = iconize(`
      <div class="icon">${tool.icon}</div>
      <div class="info">
        <div class="name">${tool.name}</div>
        <div class="lvl">${tool.rateMult.toFixed(1)}× rate · ${tool.radiusTiles.toFixed(1)}-tile radius</div>
        <div class="effect">${i === 0 ? 'Starter tool — always owned' : `+${(((tool.rateMult / TOOL_TYPES[i-1].rateMult) - 1) * 100) | 0}% faster than prev`}</div>
      </div>
      ${btn}
    `);
    const buyBtn = row.querySelector('.buy');
    if (buyBtn && isNext && toolPlan.count > 0) buyBtn.addEventListener('click', () => buyTool(i));
    list.appendChild(row);
  }
}

function buyTool(idx) {
  if (idx !== state.upgrades.tool + 1) return;
  // Tiers are strictly sequential, so bulk = advance as many tiers as affordable.
  const startIdx = state.upgrades.tool;
  const plan = planBulk(
    (i) => TOOL_TYPES[startIdx + 1 + i]?.upgradeCost ?? Infinity,
    (i) => startIdx + 1 + i < TOOL_TYPES.length,
  );
  if (plan.count === 0) return;
  state.coins -= plan.total;
  state.upgrades.tool = startIdx + plan.count;
  const tool = TOOL_TYPES[state.upgrades.tool];
  beep(700 + state.upgrades.tool * 40, 0.08, 'sine', 0.07);
  setTimeout(() => beep(1040 + state.upgrades.tool * 50, 0.1, 'triangle', 0.06), 90);
  toast(`${tool.icon} Equipped: ${tool.name}!`, '#8ff09e');
  addParticle(canvas.width / 2, canvas.height / 2, {
    text: tool.icon + ' ' + tool.name, color: '#8ff09e', size: 22,
  });
  renderShop();
  saveGame();
}

// ---------- Areas (travel) ----------
// Each area is a distinct plot with its own default grass species. The
// player unlocks areas with coins / gems / rubies, then travels to them.
// World resets fresh on every travel — tile state does not persist per-area.
function canAffordArea(def) {
  return state.coins >= (def.costCoins || 0)
      && state.gems  >= (def.costGems  || 0)
      && state.rubies >= (def.costRubies || 0);
}

function payAreaCost(def) {
  state.coins  -= def.costCoins  || 0;
  state.gems   -= def.costGems   || 0;
  state.rubies -= def.costRubies || 0;
}

function formatAreaCost(def) {
  const parts = [];
  if (def.costCoins)  parts.push(`💰 ${formatShort(def.costCoins)}`);
  if (def.costGems)   parts.push(`💎 ${def.costGems}`);
  if (def.costRubies) parts.push(`♦️ ${def.costRubies}`);
  return parts.length ? parts.join(' + ') : 'Free';
}

function unlockArea(id) {
  const def = AREA_BY_ID[id]; if (!def) return;
  if (areaUnlocked(id)) return;
  if (!canAffordArea(def)) return;
  payAreaCost(def);
  state.areasUnlocked.push(id);
  toast(`${def.icon} ${def.name} unlocked!`, '#8ff09e');
  beep(600, 0.08, 'sine', 0.07);
  setTimeout(() => beep(960, 0.10, 'triangle', 0.06), 90);
  renderShop();
  saveGame();
}

function travelToArea(id) {
  if (state.activeArea === id) return;
  if (!switchArea(id)) return;
  const def = AREA_BY_ID[id];
  toast(`${def.icon} Travelled to ${def.name}`, '#ffd34e');
  beep(520, 0.12, 'sine', 0.08);
  renderShop();
  saveGame();
}

function buyAreaExpansion() {
  if (!expandCurrentArea()) return;
  const def = currentArea();
  toast(`🗺️ ${def.name} expanded to 3× size!`, '#ffd34e');
  beep(440, 0.18, 'triangle', 0.08);
  renderShop();
  saveGame();
}

function renderAreas(list) {
  const active = state.activeArea;
  const header = document.createElement('div');
  header.innerHTML = iconize(`
    <p style="font-size:12px; color:var(--ink-dim); margin-bottom:10px; line-height:1.4;">
      Unlock plots of premium grass and travel to them. Each area has its own default species — higher tiers pay far more per mow.
      Unlocked areas persist through Prestige and Ascend. Travelling resets the current plot's tile state.
    </p>
  `);
  list.appendChild(header);

  for (const def of AREA_DEFS) {
    const unlocked = areaUnlocked(def.id);
    const isActive = active === def.id;
    const affordable = unlocked ? true : canAffordArea(def);
    const row = document.createElement('div');
    row.className = 'upgrade' + (isActive ? ' active' : '') + (!unlocked && affordable ? ' affordable' : '');

    const speciesDef = GRASS_BY_KEY[def.species];
    const mult = speciesDef ? `${speciesDef.coinMult.toFixed(1)}× coins` : '';
    const effect = unlocked
      ? `${def.desc}${isActive ? ' · <b>You are here.</b>' : ''}`
      : `${def.desc}${mult ? ` · ${mult}` : ''}`;
    const lvlBadge = unlocked
      ? (isActive ? '<span class="lvl">ACTIVE</span>' : '<span class="lvl">OWNED</span>')
      : '<span class="lvl">🔒</span>';

    let btn;
    if (!unlocked) {
      btn = `<button class="buy" data-action="unlock" ${affordable ? '' : 'disabled'}>Unlock<span class="cost">${formatAreaCost(def)}</span></button>`;
    } else if (isActive) {
      const canExpand = !areaIsExpanded(def.id) && state.gems >= AREA_EXPAND_COST_GEMS;
      const expanded = areaIsExpanded(def.id);
      if (expanded) {
        btn = `<button class="buy" disabled>🗺️ Expanded</button>`;
      } else {
        btn = `<button class="buy" data-action="expand" ${canExpand ? '' : 'disabled'}>🗺️ Expand<span class="cost">💎 ${AREA_EXPAND_COST_GEMS}</span></button>`;
      }
    } else {
      btn = `<button class="buy" data-action="travel">Travel ➜</button>`;
    }

    row.innerHTML = iconize(`
      <div class="icon">${def.icon}</div>
      <div class="info">
        <div class="name">${def.name} ${lvlBadge}</div>
        <div class="effect">${effect}</div>
      </div>
      ${btn}
    `);
    const btnEl = row.querySelector('.buy');
    if (btnEl) {
      const action = btnEl.dataset.action;
      btnEl.addEventListener('click', () => {
        if (action === 'unlock') unlockArea(def.id);
        else if (action === 'travel') travelToArea(def.id);
        else if (action === 'expand') buyAreaExpansion();
      });
    }
    list.appendChild(row);
  }
}

// ---------- Gem shop (permanent, persists through prestige) ----------
function planGemBulk(key) {
  const def = GEM_BY_KEY[key]; if (!def) return { count: 0, total: 0 };
  let lvl = gemLvl(key);
  let gemsLeft = state.gems;
  let count = 0, total = 0;
  while (count < buyMult && lvl < def.max) {
    const c = gemUpgradeCost(key, lvl);
    if (!isFinite(c) || gemsLeft < c) break;
    gemsLeft -= c;
    total += c;
    count++;
    lvl++;
  }
  return { count, total };
}

// ---------- Stats ----------
let statsScope = 'current'; // 'current' | 'lifetime'

function statRow(icon, label, value) {
  const row = document.createElement('div');
  row.className = 'upgrade';
  row.style.gridTemplateColumns = '34px 1fr auto';
  row.innerHTML = iconize(`
    <div class="icon">${icon}</div>
    <div class="info"><div class="name">${label}</div></div>
    <div class="effect" style="font-weight:700; font-size:13px; color:var(--grass-xlight);">${value}</div>
  `);
  return row;
}

function renderStats(list) {
  list.innerHTML = '';
  const header = document.createElement('div');
  header.innerHTML = iconize(`
    <div class="tabs stats-scope-tabs" style="margin-bottom:10px;">
      <button class="tab ${statsScope === 'current'  ? 'active' : ''}" data-scope="current"><span class="tab-label">Current Prestige</span></button>
      <button class="tab ${statsScope === 'lifetime' ? 'active' : ''}" data-scope="lifetime"><span class="tab-label">Lifetime</span></button>
    </div>
  `);
  list.appendChild(header);
  header.querySelectorAll('[data-scope]').forEach(b =>
    b.addEventListener('click', () => { statsScope = b.dataset.scope; renderStats(list); }));

  const gardenTotal = Object.values(state.garden || {}).reduce((a, b) => a + b, 0);
  const skinsTotal = (typeof SKIN_DEFS !== 'undefined') ? SKIN_DEFS.length : (state.skinsUnlocked || []).length;
  const achievedCount = (typeof achieved !== 'undefined' && achieved.size) ? achieved.size : 0;

  if (statsScope === 'current') {
    list.appendChild(statRow('💰', 'Coins earned this run',       formatShort(state.totalEarnedThisRun || 0)));
    list.appendChild(statRow('🌱', 'Current coins',                formatShort(state.coins || 0)));
    list.appendChild(statRow('💎', 'Gems earned (since ascend)',   formatShort(state.totalGemsEarned || 0)));
    list.appendChild(statRow('💎', 'Current gems',                 formatShort(state.gems || 0)));
    list.appendChild(statRow('📋', 'Quests completed this run',    state.questsCompleted || 0));
    list.appendChild(statRow('🤖', 'Robots',                       state.upgrades.robots || 0));
    list.appendChild(statRow('🏡', 'Garden items placed',          gardenTotal));
    list.appendChild(statRow('👷', 'Crew hired',                   (state.crew || []).length));
    list.appendChild(statRow('⛽', 'Fuel',                         `${Math.round(state.fuel || 0)}%`));
  } else {
    list.appendChild(statRow('💰', 'Lifetime coins earned',        formatShort(state.totalEarnedAllTime || 0)));
    list.appendChild(statRow('🌾', 'Lifetime tiles mowed',         formatShort(state.totalTilesMowed || 0)));
    list.appendChild(statRow('🎁', 'Treasures opened',             state.treasuresCollected || 0));
    list.appendChild(statRow('🌟', 'Prestiges performed',          state.prestigeCount || 0));
    list.appendChild(statRow('♦️', 'Ascends performed',            state.ascendCount || 0));
    list.appendChild(statRow('♦️', 'Lifetime rubies earned',       formatShort(state.totalRubiesEarned || 0)));
    list.appendChild(statRow('♦️', 'Current rubies',               formatShort(state.rubies || 0)));
    list.appendChild(statRow('🏆', 'Achievements unlocked',        achievedCount));
    list.appendChild(statRow('🎨', 'Skins unlocked',               `${(state.skinsUnlocked || []).length} / ${skinsTotal}`));
    list.appendChild(statRow('〽️', 'Mow patterns unlocked',        (state.patternsUnlocked || []).length));
  }
}

function openStatsModal() {
  if (document.querySelector('.stats-modal-backdrop')) return;
  const back = document.createElement('div');
  back.className = 'modal-backdrop stats-modal-backdrop';
  back.innerHTML = iconize(`
    <div class="modal stats-modal">
      <h2>📊 STATS</h2>
      <div class="upgrades stats-list"></div>
      <button id="statsCloseBtn">Done</button>
    </div>`);
  document.body.appendChild(back);
  const list = back.querySelector('.stats-list');
  renderStats(list);
  const close = () => back.remove();
  back.querySelector('#statsCloseBtn').addEventListener('click', close);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });
}

// ---------- Lawn-pedia modal ----------
const PEDIA_TABS = [
  { id: 'species',   label: 'Species',   icon: '🌱' },
  { id: 'gnomes',    label: 'Gnomes',    icon: '🧙' },
  { id: 'treasures', label: 'Treasures', icon: '🎁' },
  { id: 'weather',   label: 'Weather',   icon: '🌦️' },
  { id: 'buffs',     label: 'Buffs',     icon: '✨' },
  { id: 'photos',    label: 'Photos',    icon: '📸' },
];
const PEDIA_RARITIES = [
  { id: 'common',   label: 'Common',   color: '#9fc4a2' },
  { id: 'uncommon', label: 'Uncommon', color: '#7df09e' },
  { id: 'rare',     label: 'Rare',     color: '#7ec8ff' },
  { id: 'epic',     label: 'Epic',     color: '#c896ff' },
];
const PEDIA_BUFF_DESCS = {
  frenzy:    'Mowing Frenzy: 7× coin income for 30s.',
  lucky:     'Lucky Strike: instant +1h of income.',
  blessed:   'Blessed Rain: instantly maxes all grass.',
  critStorm: 'Crit Storm: 100% crit chance, 10× crit for 20s.',
};
let pediaTab = 'species';

function rgbCss(c) { return c ? `rgb(${c[0]},${c[1]},${c[2]})` : '#7ed47e'; }

function renderPediaSpecies(body) {
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap:8px;';
  for (const spec of GRASS_TYPES) {
    const owned = (state.pedia.species || []).indexOf(spec.key) >= 0;
    const swatch = spec.color ? rgbCss(spec.color) : '#5fb05a';
    const card = document.createElement('div');
    card.style.cssText = `padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.08); background:rgba(0,0,0,0.25); ${owned ? '' : 'opacity:0.4; filter:grayscale(0.7);'}`;
    card.innerHTML = iconize(`
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
        <div style="width:22px; height:22px; border-radius:4px; background:${swatch}; box-shadow: inset 0 -4px 6px rgba(0,0,0,0.3);"></div>
        <div style="font-weight:700;">${spec.icon} ${owned ? spec.name : '???'}</div>
      </div>
      <div style="font-size:11px; color:var(--ink-dim); line-height:1.4;">
        ${owned ? `Coin ×${spec.coinMult.toFixed(1)} · Toughness ${spec.toughness.toFixed(1)}` : 'Undiscovered'}
      </div>`);
    grid.appendChild(card);
  }
  body.appendChild(grid);
}

function renderPediaGnomes(body) {
  const list = state.pedia.gnomes || [];
  const head = document.createElement('p');
  head.style.cssText = 'color:var(--ink-dim); font-size:12px; margin:0 0 10px;';
  head.innerHTML = iconize(`Met <b style="color:#c896ff;">${list.length}</b> gnome${list.length === 1 ? '' : 's'}.`);
  body.appendChild(head);
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'opacity:0.6; font-size:12px;';
    empty.textContent = 'No gnomes yet — wait for visitors, evil thieves, or rare golden gnomes.';
    body.appendChild(empty);
    return;
  }
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap:6px;';
  for (const name of list) {
    const isGolden = name === 'Golden Gnome';
    const card = document.createElement('div');
    card.style.cssText = `padding:8px 10px; border-radius:6px; background:rgba(0,0,0,0.25); border:1px solid ${isGolden ? '#ffd34e' : 'rgba(255,255,255,0.08)'}; font-weight:600; font-size:12px;`;
    card.innerHTML = iconize(`${isGolden ? '🌟' : '🧙'} ${name}`);
    grid.appendChild(card);
  }
  body.appendChild(grid);
}

function renderPediaTreasures(body) {
  const total = state.pedia.treasures || 0;
  const head = document.createElement('p');
  head.style.cssText = 'color:var(--ink-dim); font-size:12px; margin:0 0 10px;';
  head.innerHTML = iconize(`Opened <b style="color:#ffd34e;">${total}</b> treasure${total === 1 ? '' : 's'}.`);
  body.appendChild(head);
  const seen = state.pedia.treasureRare || [];
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap:8px;';
  for (const r of PEDIA_RARITIES) {
    const owned = seen.indexOf(r.id) >= 0;
    const card = document.createElement('div');
    card.style.cssText = `padding:10px; border-radius:8px; border:1px solid ${owned ? r.color : 'rgba(255,255,255,0.08)'}; background:rgba(0,0,0,0.25); ${owned ? '' : 'opacity:0.4;'}`;
    card.innerHTML = iconize(`
      <div style="font-weight:700; color:${owned ? r.color : 'var(--ink-dim)'};">🎁 ${owned ? r.label : '???'}</div>
      <div style="font-size:11px; color:var(--ink-dim); margin-top:4px;">${owned ? 'Discovered' : 'Undiscovered'}</div>`);
    grid.appendChild(card);
  }
  body.appendChild(grid);
}

function renderPediaWeather(body) {
  const seen = state.pedia.weather || {};
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap:8px;';
  for (const w of WEATHER_TYPES) {
    const secs = seen[w.id] || 0;
    const owned = secs > 0;
    const hours = secs / 3600;
    const display = hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.floor(secs / 60)}m ${Math.floor(secs % 60)}s`;
    const card = document.createElement('div');
    card.style.cssText = `padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.08); background:rgba(0,0,0,0.25); ${owned ? '' : 'opacity:0.4; filter:grayscale(0.7);'}`;
    card.innerHTML = iconize(`
      <div style="font-weight:700;">${w.icon} ${owned ? w.name : '???'}</div>
      <div style="font-size:11px; color:var(--ink-dim); margin-top:4px;">${owned ? display + ' endured' : 'Undiscovered'}</div>`);
    grid.appendChild(card);
  }
  body.appendChild(grid);
}

function renderPediaBuffs(body) {
  const seen = state.pedia.buffs || [];
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:8px;';
  for (const key of Object.keys(GOLDEN_BUFF_DEFS)) {
    const def = GOLDEN_BUFF_DEFS[key];
    const owned = seen.indexOf(key) >= 0;
    const card = document.createElement('div');
    card.style.cssText = `padding:10px; border-radius:8px; border:1px solid ${owned ? def.color : 'rgba(255,255,255,0.08)'}; background:rgba(0,0,0,0.25); ${owned ? '' : 'opacity:0.4;'}`;
    card.innerHTML = iconize(`
      <div style="font-weight:700; color:${owned ? def.color : 'var(--ink-dim)'};">${def.icon} ${owned ? def.name : '???'}</div>
      <div style="font-size:11px; color:var(--ink-dim); margin-top:4px; line-height:1.4;">
        ${owned ? (PEDIA_BUFF_DESCS[key] || '') + '<br>✅ Triggered' : 'Undiscovered'}
      </div>`);
    grid.appendChild(card);
  }
  body.appendChild(grid);
}

function renderPediaPhotos(body) {
  const photos = state.pedia.photos || [];
  if (photos.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'opacity:0.6; font-size:12px;';
    empty.textContent = 'No snapshots yet — press P in Zen Mode to save one. (Last 12 are kept.)';
    body.appendChild(empty);
    return;
  }
  const head = document.createElement('p');
  head.style.cssText = 'color:var(--ink-dim); font-size:12px; margin:0 0 10px;';
  head.innerHTML = iconize(`${photos.length} / 12 snapshot${photos.length === 1 ? '' : 's'} stored.`);
  body.appendChild(head);
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap:8px;';
  for (let i = photos.length - 1; i >= 0; i--) {
    const p = photos[i];
    const wrap = document.createElement('div');
    wrap.style.cssText = 'cursor:pointer; border-radius:6px; overflow:hidden; border:1px solid rgba(255,255,255,0.1); background:#000;';
    const img = document.createElement('img');
    img.src = p.dataUrl;
    img.style.cssText = 'width:100%; display:block;';
    img.alt = new Date(p.ts).toLocaleString();
    wrap.appendChild(img);
    const cap = document.createElement('div');
    cap.style.cssText = 'font-size:10px; color:var(--ink-dim); padding:4px 6px; text-align:center;';
    cap.textContent = new Date(p.ts).toLocaleString();
    wrap.appendChild(cap);
    wrap.addEventListener('click', () => openPediaPhotoLightbox(p));
    grid.appendChild(wrap);
  }
  body.appendChild(grid);
}

function openPediaPhotoLightbox(p) {
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.style.zIndex = 9999;
  const stamp = new Date(p.ts).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  back.innerHTML = iconize(`
    <div class="modal" style="max-width:min(90vw,900px);">
      <h2>📸 SNAPSHOT</h2>
      <img src="${p.dataUrl}" style="max-width:100%; max-height:70vh; display:block; margin:0 auto; border-radius:6px;" alt="snapshot"/>
      <div style="margin-top:10px; display:flex; gap:8px; justify-content:center;">
        <a id="pediaPhotoDl" href="${p.dataUrl}" download="lawnbot-zen-${stamp}.png"><button>⬇️ Download</button></a>
        <button id="pediaPhotoClose">Close</button>
      </div>
    </div>`);
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelector('#pediaPhotoClose').addEventListener('click', close);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
}

function renderPedia(body) {
  body.innerHTML = '';
  // Tab strip.
  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  tabs.style.cssText = 'margin-bottom:12px;';
  for (const t of PEDIA_TABS) {
    const b = document.createElement('button');
    b.className = 'tab' + (pediaTab === t.id ? ' active' : '');
    b.innerHTML = iconize(`<span class="tab-ico">${t.icon}</span><span class="tab-label">${t.label}</span>`);
    b.addEventListener('click', () => { pediaTab = t.id; renderPedia(body); });
    tabs.appendChild(b);
  }
  body.appendChild(tabs);
  const content = document.createElement('div');
  body.appendChild(content);
  if      (pediaTab === 'species')   renderPediaSpecies(content);
  else if (pediaTab === 'gnomes')    renderPediaGnomes(content);
  else if (pediaTab === 'treasures') renderPediaTreasures(content);
  else if (pediaTab === 'weather')   renderPediaWeather(content);
  else if (pediaTab === 'buffs')     renderPediaBuffs(content);
  else if (pediaTab === 'photos')    renderPediaPhotos(content);

  // Footer carrot: current pedia bonus.
  const bonusPct = (pediaBonusMult() - 1) * 100;
  const footer = document.createElement('p');
  footer.style.cssText = 'margin-top:14px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.08); font-size:12px; color:var(--ink-dim);';
  footer.innerHTML = iconize(`<b style="color:#c896ff;">📖 Pedia Bonus:</b> +${bonusPct.toFixed(1)}% coin income (from species, gnomes & buffs discovered).`);
  body.appendChild(footer);
}

function openPediaModal() {
  if (document.querySelector('.pedia-modal-backdrop')) return;
  const back = document.createElement('div');
  back.className = 'modal-backdrop pedia-modal-backdrop';
  back.innerHTML = iconize(`
    <div class="modal pedia-modal" style="max-width:min(92vw,720px);">
      <h2>📖 LAWN-PEDIA</h2>
      <div class="pedia-body"></div>
      <button id="pediaCloseBtn">Done</button>
    </div>`);
  document.body.appendChild(back);
  const body = back.querySelector('.pedia-body');
  renderPedia(body);
  const close = () => back.remove();
  back.querySelector('#pediaCloseBtn').addEventListener('click', close);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });
}

function renderGemShop(list) {
  const header = document.createElement('div');
  header.innerHTML = iconize(`
    <p style="font-size:12px; color:var(--ink-dim); margin-bottom:10px; line-height:1.4;">
      Spend 💎 gems on permanent upgrades. <b style="color:var(--gem);">These survive prestige.</b><br>
      Available: <b style="color:var(--gem);">${formatShort(state.gems)} 💎</b>
      · Lifetime: ${formatShort(state.totalGemsEarned || 0)} 💎 (${Math.round(gemMult() * 100 - 100)}% passive coin bonus)
    </p>`);
  list.appendChild(header);

  renderTechTree(list);

  const subhead = document.createElement('div');
  subhead.innerHTML = iconize(`
    <h3 style="margin:14px 0 6px; font-size:13px; color:var(--gem); letter-spacing:0.5px;">⚗️ COMMON UPGRADES</h3>`);
  list.appendChild(subhead);

  for (const def of GEM_UPGRADES) {
    const lvl = gemLvl(def.key);
    const maxed = lvl >= def.max;
    const plan = maxed ? { count: 0, total: 0 } : planGemBulk(def.key);
    const singleCost = maxed ? Infinity : gemUpgradeCost(def.key, lvl);
    const affordable = plan.count > 0;
    const row = document.createElement('div');
    row.className = 'upgrade' + (affordable ? ' affordable' : '') + (maxed ? ' maxed' : '');
    const label = maxed ? 'MAX' : (plan.count > 1 ? `Buy ×${plan.count}` : 'Buy');
    const costLabel = maxed ? '—' : '💎 ' + formatShort(plan.count > 0 ? plan.total : singleCost);
    row.innerHTML = iconize(`
      <div class="icon">${def.icon}</div>
      <div class="info">
        <div class="name">${def.name} <span class="lvl">Lv ${lvl}/${def.max}</span></div>
        <div class="effect">${def.statusText(lvl)}</div>
        <div class="effect" style="opacity:0.7;">${def.desc}</div>
      </div>
      <button class="buy" ${affordable ? '' : 'disabled'}>
        ${label}
        <span class="cost">${costLabel}</span>
      </button>
    `);
    const btn = row.querySelector('.buy');
    if (btn && affordable) btn.addEventListener('click', () => buyGemUpgrade(def.key));
    list.appendChild(row);
  }
}

// ---------- Tech tree (3 tiers × 3 mutually exclusive paths) ----------
function renderTechTree(list) {
  const wrap = document.createElement('div');
  wrap.className = 'tech-tree';
  wrap.innerHTML = iconize(`
    <h3 style="margin:4px 0 6px; font-size:13px; color:#c896ff; letter-spacing:0.5px;">🌳 TECH TREE</h3>
    <p style="font-size:11px; color:var(--ink-dim); margin:0 0 8px; line-height:1.4;">
      Pick one path per tier. Choices reset on Ascend, or respec for ${respecCost()} 💎 (50% refund).
    </p>`);

  for (let i = 0; i < TECH_TREE.length; i++) {
    const tier = TECH_TREE[i];
    const picked = techPicked(tier.key);
    const prevTier = i > 0 ? TECH_TREE[i - 1] : null;
    const prevPicked = prevTier ? techPicked(prevTier.key) : 'unlocked';
    const locked = !prevPicked;

    const row = document.createElement('div');
    row.className = 'tech-tier';
    const head = document.createElement('div');
    head.className = 'tech-tier-head';
    let respecHtml = '';
    if (picked) {
      const refund = Math.floor(respecCost() / 2);
      respecHtml = `<button class="tech-respec" data-tier="${tier.key}">Respec (${respecCost()}💎, refund ${refund}💎)</button>`;
    }
    head.innerHTML = iconize(`
      <span class="tech-tier-label">Tier ${tier.tier} · ${tier.cost} 💎</span>
      ${respecHtml}`);
    row.appendChild(head);

    const cards = document.createElement('div');
    cards.className = 'tech-choices';
    if (locked) {
      const ph = document.createElement('div');
      ph.className = 'tech-choice tech-choice-placeholder';
      ph.innerHTML = iconize(`<div class="tech-locked-note">🔒 Pick Tier ${prevTier.tier} first</div>`);
      cards.appendChild(ph);
    } else {
      for (const choice of tier.choices) {
        const card = document.createElement('div');
        const isActive = picked === choice.id;
        const isLocked = picked && !isActive;
        const affordable = !picked && state.gems >= tier.cost;
        card.className = 'tech-choice'
          + (isActive ? ' active' : '')
          + (isLocked ? ' locked' : '')
          + (affordable ? ' buyable' : '');
        card.innerHTML = iconize(`
          ${isActive ? `<div class="tech-badge">✅ ACTIVE</div>` : ''}
          ${isLocked ? `<div class="tech-badge tech-badge-locked">🔒 LOCKED</div>` : ''}
          <div class="tech-icon">${choice.icon}</div>
          <div class="tech-name">${choice.name}</div>
          <div class="tech-desc">${choice.desc}</div>
          ${(!picked) ? `<div class="tech-cost">${tier.cost} 💎</div>` : ''}
        `);
        if (!picked) {
          card.addEventListener('click', () => buyTechChoice(tier.key, choice.id));
        }
        cards.appendChild(card);
      }
    }
    row.appendChild(cards);
    wrap.appendChild(row);
  }
  list.appendChild(wrap);

  wrap.querySelectorAll('.tech-respec').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      respecTechTier(btn.dataset.tier);
    });
  });
}

function buyTechChoice(tierKey, choiceId) {
  const tier = TECH_BY_KEY[tierKey]; if (!tier) return;
  if (techPicked(tierKey)) { toast('Already picked — respec to change.', '#ffb4b4'); return; }
  // Confirm previous tier picked.
  const idx = TECH_TREE.indexOf(tier);
  if (idx > 0 && !techPicked(TECH_TREE[idx - 1].key)) {
    toast(`Pick Tier ${TECH_TREE[idx - 1].tier} first.`, '#ffb4b4');
    return;
  }
  if (state.gems < tier.cost) { toast(`Need ${tier.cost} 💎`, '#ffb4b4'); return; }
  const choice = tier.choices.find(c => c.id === choiceId); if (!choice) return;
  if (!confirm(`Pick ${choice.name} for ${tier.cost} 💎?\n\n${choice.desc}\n\nThe other two Tier ${tier.tier} options will be locked until you respec or Ascend.`)) return;
  state.gems -= tier.cost;
  if (!state.techTree) state.techTree = { tier1: null, tier2: null, tier3: null };
  state.techTree[tierKey] = choiceId;
  beep(880, 0.1, 'triangle', 0.08);
  setTimeout(() => beep(1320, 0.12, 'sine', 0.07), 90);
  addParticle(canvas.width / 2, canvas.height / 2, {
    text: `${choice.icon} ${choice.name} unlocked`,
    color: '#c896ff', size: 20,
  });
  renderShop();
  saveGame();
}

function respecTechTier(tierKey) {
  const tier = TECH_BY_KEY[tierKey]; if (!tier) return;
  if (!techPicked(tierKey)) return;
  const cost = respecCost();
  const refund = Math.floor(cost / 2);
  if (state.gems < cost) { toast(`Need ${cost} 💎 to respec`, '#ffb4b4'); return; }
  if (!confirm(`Respec Tier ${tier.tier}?\n\nCost: ${cost} 💎. Refund: ${refund} 💎. Net: -${cost - refund} 💎.\n\nThis also clears any later tiers that depend on this one.`)) return;
  state.gems -= (cost - refund);
  // Clear this tier and any later tiers (they depend on it).
  const startIdx = TECH_TREE.indexOf(tier);
  for (let i = startIdx; i < TECH_TREE.length; i++) {
    state.techTree[TECH_TREE[i].key] = null;
  }
  beep(440, 0.12, 'sawtooth', 0.07);
  toast(`Tier ${tier.tier}+ respec'd.`, '#c896ff');
  renderShop();
  saveGame();
}

function buyGemUpgrade(key) {
  const def = GEM_BY_KEY[key]; if (!def) return;
  const plan = planGemBulk(key);
  if (plan.count === 0) return;
  state.gems -= plan.total;
  state.gemUpgrades[key] = gemLvl(key) + plan.count;
  beep(720 + state.gemUpgrades[key] * 35, 0.08, 'triangle', 0.07);
  setTimeout(() => beep(1120 + state.gemUpgrades[key] * 45, 0.1, 'sine', 0.06), 80);
  addParticle(canvas.width / 2, canvas.height / 2, {
    text: `${def.icon} ${def.name} Lv ${state.gemUpgrades[key]}`,
    color: '#72f2ff', size: 20,
  });
  renderShop();
  saveGame();
}

// ---------- Ruby shop (persists through Ascend) ----------
function planRubyBulk(key) {
  const def = RUBY_BY_KEY[key]; if (!def) return { count: 0, total: 0 };
  let lvl = rubyLvl(key);
  let rubiesLeft = state.rubies || 0;
  let count = 0, total = 0;
  while (count < buyMult && lvl < def.max) {
    const c = rubyUpgradeCost(key, lvl);
    if (!isFinite(c) || rubiesLeft < c) break;
    rubiesLeft -= c;
    total += c;
    count++;
    lvl++;
  }
  return { count, total };
}

function renderRubyShop(list) {
  const header = document.createElement('div');
  const gainableNow = Math.floor(CFG.ascendFormula(state.totalGemsEarned || 0) * rubyShopAscendMult());
  header.innerHTML = iconize(`
    <p style="font-size:12px; color:var(--ink-dim); margin-bottom:10px; line-height:1.4;">
      Spend ♦️ rubies on the deepest permanent upgrades. <b style="color:#ff6b8b;">These survive every prestige AND ascend.</b><br>
      Rubies: <b style="color:#ff6b8b;">${formatShort(state.rubies || 0)} ♦️</b>
      · Lifetime: ${formatShort(state.totalRubiesEarned || 0)} ♦️
      · Pending at Ascend: <b style="color:#ff6b8b;">+${gainableNow}</b>
    </p>`);
  list.appendChild(header);

  for (const def of RUBY_UPGRADES) {
    const lvl = rubyLvl(def.key);
    const maxed = lvl >= def.max;
    const plan = maxed ? { count: 0, total: 0 } : planRubyBulk(def.key);
    const singleCost = maxed ? Infinity : rubyUpgradeCost(def.key, lvl);
    const affordable = plan.count > 0;
    const row = document.createElement('div');
    row.className = 'upgrade' + (affordable ? ' affordable' : '') + (maxed ? ' maxed' : '');
    const label = maxed ? 'MAX' : (plan.count > 1 ? `Buy ×${plan.count}` : 'Buy');
    const costLabel = maxed ? '—' : '♦️ ' + formatShort(plan.count > 0 ? plan.total : singleCost);
    row.innerHTML = iconize(`
      <div class="icon">${def.icon}</div>
      <div class="info">
        <div class="name">${def.name} <span class="lvl">Lv ${lvl}/${def.max}</span></div>
        <div class="effect" style="color:#ff8ea5;">${def.statusText(lvl)}</div>
        <div class="effect" style="opacity:0.7;">${def.desc}</div>
      </div>
      <button class="buy" ${affordable ? '' : 'disabled'}>
        ${label}
        <span class="cost">${costLabel}</span>
      </button>
    `);
    const btn = row.querySelector('.buy');
    if (btn && affordable) btn.addEventListener('click', () => buyRubyUpgrade(def.key));
    list.appendChild(row);
  }
}

function buyRubyUpgrade(key) {
  const def = RUBY_BY_KEY[key]; if (!def) return;
  const plan = planRubyBulk(key);
  if (plan.count === 0) return;
  state.rubies = (state.rubies || 0) - plan.total;
  state.rubyUpgrades[key] = rubyLvl(key) + plan.count;
  beep(520 + state.rubyUpgrades[key] * 30, 0.09, 'triangle', 0.08);
  setTimeout(() => beep(780 + state.rubyUpgrades[key] * 40, 0.1, 'sine', 0.07), 80);
  addParticle(canvas.width / 2, canvas.height / 2, {
    text: `${def.icon} ${def.name} Lv ${state.rubyUpgrades[key]}`,
    color: '#ff6b8b', size: 22,
  });
  renderShop();
  saveGame();
}

function renderPrestige(list) {
  const can = state.totalEarnedThisRun >= CFG.prestigeThreshold;
  const gain = CFG.prestigeFormula(state.totalEarnedThisRun);
  const wrap = document.createElement('div');
  wrap.className = 'prestige';
  wrap.innerHTML = iconize(`
    <h3>🌟 FERTILIZE THE LAWN</h3>
    <p>Reset your run (coins, robots, upgrades) for permanent gems.<br>
    Each gem grants <b>+10% coin bonus</b>, forever.</p>
    <div class="gain">💎 +${gain} gems</div>
    <p style="font-size:11px; opacity:0.7;">Threshold: ${formatShort(CFG.prestigeThreshold)} coins earned this run<br>
    Earned this run: ${formatShort(state.totalEarnedThisRun)}</p>
    <button id="prestigeBtn" ${can && gain > 0 ? '' : 'disabled'}>Fertilize (+${gain} 💎)</button>
  `);
  list.appendChild(wrap);
  const btn = wrap.querySelector('#prestigeBtn');
  if (btn) btn.addEventListener('click', doPrestige);

  const info = document.createElement('div');
  info.className = 'upgrade';
  info.style.gridTemplateColumns = '42px 1fr';
  info.innerHTML = iconize(`
    <div class="icon">💎</div>
    <div class="info">
      <div class="name">Current Gems: ${state.gems}</div>
      <div class="effect">Global bonus: +${Math.round((gemMult() - 1) * 100)}% to all coin income</div>
    </div>
  `);
  list.appendChild(info);

  // --- Ascend (ruby prestige) ---
  const ascendBase = CFG.ascendFormula(state.totalGemsEarned || 0);
  const ascendGain = Math.floor(ascendBase * rubyShopAscendMult());
  const canAscend = (state.totalGemsEarned || 0) >= CFG.ascendThreshold && ascendGain > 0;
  // Don't surface the Ascend tier at all until the player can make the
  // first ascension (or already has rubies from a past one).
  const revealAscend = canAscend || (state.totalRubiesEarned || 0) > 0 || (state.rubies || 0) > 0;
  if (!revealAscend) return;
  const ascend = document.createElement('div');
  ascend.className = 'prestige';
  ascend.style.background = 'linear-gradient(180deg, rgba(160, 30, 60, 0.65), rgba(40, 8, 20, 0.8))';
  ascend.style.borderColor = 'rgba(255, 90, 120, 0.55)';
  ascend.innerHTML = iconize(`
    <h3 style="color:#ff6b8b; text-shadow: 0 0 10px rgba(255,90,120,0.5);">♦️ ASCEND</h3>
    <p>A deeper reset. <b>Wipes everything</b> — coins, runs, upgrades,
    garden, crew, grass species, 💎 gems, gem shop. Keeps ♦️ rubies,
    ruby shop, skins, and patterns.</p>
    <div class="gain" style="color:#ff6b8b; text-shadow:0 0 10px rgba(255,90,120,0.4);">♦️ +${ascendGain} rubies</div>
    <p style="font-size:11px; opacity:0.7;">Threshold: ${CFG.ascendThreshold} 💎 earned cumulatively<br>
    Lifetime 💎 earned: ${formatShort(state.totalGemsEarned || 0)}</p>
    <button id="ascendBtn" ${canAscend ? '' : 'disabled'}
      style="background: linear-gradient(180deg,#ff4a6a,#9e1230); box-shadow: 0 4px 14px rgba(255,90,120,0.35);">
      Ascend (+${ascendGain} ♦️)
    </button>
  `);
  list.appendChild(ascend);
  const ab = ascend.querySelector('#ascendBtn');
  if (ab) ab.addEventListener('click', doAscend);

  const rubyInfo = document.createElement('div');
  rubyInfo.className = 'upgrade';
  rubyInfo.style.gridTemplateColumns = '42px 1fr';
  rubyInfo.innerHTML = iconize(`
    <div class="icon">♦️</div>
    <div class="info">
      <div class="name" style="color:#ff6b8b;">Current Rubies: ${state.rubies || 0}</div>
      <div class="effect">Lifetime ♦️: ${state.totalRubiesEarned || 0} · Spend in the ♦️ Rubies tab</div>
    </div>
  `);
  list.appendChild(rubyInfo);
}

function buy(key) {
  const startLvl = state.upgrades[key];
  const plan = planBulk(
    (i) => COST[key](startLvl + i),
    (i) => startLvl + i < MAX[key],
  );
  if (plan.count === 0) return;
  state.coins -= plan.total;
  state.upgrades[key] = startLvl + plan.count;
  if (key === 'robots') {
    ensureRobotCount();
    addParticle(canvas.width / 2, canvas.height / 2, {
      text: plan.count > 1 ? `+${plan.count} ROBOTS!` : 'NEW ROBOT!',
      color: '#8ff09e', size: 18,
    });
  }
  beep(660 + startLvl * 10, 0.08, 'square', 0.08);
  renderShop();
  saveGame();
}

// Single-purchase variant used by the Bookkeeper auto-buyer. Bypasses the
// bulk-buy modifier and skips screen-spamming particles, but still routes
// state mutations through the same paths so robots/tool counts stay sane.
const AUTO_BUY_KEYS = ['robots','speed','range','value','growth','rate','crit','fuelEff','pest','fuelType','tool'];
function autoBuyOne(key) {
  const lvl = state.upgrades[key] || 0;
  if (lvl >= MAX[key]) return false;
  const cost = COST[key](lvl);
  if (!isFinite(cost) || state.coins < cost) return false;
  state.coins -= cost;
  state.upgrades[key] = lvl + 1;
  if (key === 'robots') ensureRobotCount();
  beep(560 + lvl * 6, 0.05, 'sine', 0.04);
  renderShop();
  saveGame();
  return true;
}
function autoBuyCheapest() {
  let bestKey = null, bestCost = Infinity;
  for (const key of AUTO_BUY_KEYS) {
    const lvl = state.upgrades[key] || 0;
    if (lvl >= MAX[key]) continue;
    const cost = COST[key](lvl);
    if (!isFinite(cost)) continue;
    if (state.coins < cost) continue;
    if (cost < bestCost) { bestCost = cost; bestKey = key; }
  }
  if (bestKey) return autoBuyOne(bestKey);
  return false;
}

function doPrestige() {
  const baseGain = CFG.prestigeFormula(state.totalEarnedThisRun);
  const gain = Math.floor(baseGain * gemShopPrestigeMult() * rubyShopPrestigeMult() * techPrestigeGemMult());
  if (gain <= 0) return;
  if (!confirm(`Fertilize? You will gain ${gain} 💎 gems (permanent +${gain * 10}% bonus), but reset coins, robots, upgrades and garden.`)) return;
  state.gems += gain;
  state.totalGemsEarned = (state.totalGemsEarned || 0) + gain;
  state.prestigeCount = (state.prestigeCount || 0) + 1;
  state.coins = startingCoinsFor(gemLvl('startCoins'));
  state.totalEarnedThisRun = 0;
  state.critCascadeStack = 0;
  state.upgrades = {
    robots: 1 + gemLvl('startRobot'),
    speed: 0, range: 0, value: 0, growth: 0, rate: 0, crit: 0,
    fuelEff: 0, pest: 0, fuelType: 0,
    tool: Math.min(gemLvl('startTool'), TOOL_TYPES.length - 1),
  };
  state.garden   = { tree: 0, rock: 0, pond: 0, flower: 0, beehive: 0, fountain: 0, shed: 0, gnome: 0 };
  state.crew     = [];
  state.fuel     = CFG.fuelMax;
  state.gnomeTimer = 60 + Math.random() * 30;
  state.activeQuest = null;
  state.questTimer = 80 + Math.random() * 60;
  state.questHistory = [];
  state.questsCompleted = 0;
  applyMapDimensions();
  clearActors();
  initWorld();
  resizeCanvas();
  if (typeof clearTileCache === 'function') clearTileCache();
  ensureRobotCount();
  ensureBeesFromHives();
  toast(`🌟 Gained ${gain} 💎 Gems!`, '#8ff09e');
  beep(880, 0.15, 'triangle', 0.12);
  setTimeout(() => beep(1320, 0.2, 'triangle', 0.1), 100);
  renderShop();
  saveGame();
}

function doAscend() {
  const baseGain = CFG.ascendFormula(state.totalGemsEarned || 0);
  const gain = Math.floor(baseGain * rubyShopAscendMult());
  if (gain <= 0) return;
  if (!confirm(
    `♦️ ASCEND for ${gain} rubies?\n\n` +
    `This WIPES everything: coins, upgrades, garden, crew, grass unlocks, gems, gem-shop upgrades.\n` +
    `Your rubies, ruby-shop upgrades, skins, and mow patterns are KEPT.\n\n` +
    `Rubies are much rarer than gems — spend them wisely.`
  )) return;

  state.rubies = (state.rubies || 0) + gain;
  state.totalRubiesEarned = (state.totalRubiesEarned || 0) + gain;
  state.ascendCount = (state.ascendCount || 0) + 1;

  // Full wipe of the gem tier and below.
  state.coins = 0;
  state.totalEarnedThisRun = 0;
  state.critCascadeStack = 0;
  state.gems = rubyShopStartGems();
  state.totalGemsEarned = state.gems;
  state.gemUpgrades = {
    startCoins: 0, coinMult: 0, growth: 0, crit: 0,
    offline: 0, prestigeBoost: 0, startRobot: 0, startTool: 0,
    autoQuest: 0,
    pollination: 0, coopBots: 0, symbiosis: 0, critCascade: 0,
  };
  state.techTree = { tier1: null, tier2: null, tier3: null };
  state.upgrades = {
    robots: 1, speed: 0, range: 0, value: 0, growth: 0, rate: 0, crit: 0,
    fuelEff: 0, fuelType: 0, tool: 0,
  };
  state.garden   = { tree: 0, rock: 0, pond: 0, flower: 0, beehive: 0, fountain: 0, shed: 0, gnome: 0 };
  state.crew     = rubyShopHasStartCrew() ? ['foreman'] : [];
  state.fuel     = CFG.fuelMax;
  state.gnomeTimer = 60 + Math.random() * 30;
  state.activeQuest = null;
  state.questTimer = 80 + Math.random() * 60;
  state.questHistory = [];
  state.questsCompleted = 0;
  // Come home on ascend (areas and per-area expansion persist).
  state.activeArea = 'home';
  applyMapDimensions();
  clearActors();
  initWorld();
  resizeCanvas();
  if (typeof clearTileCache === 'function') clearTileCache();
  ensureRobotCount();
  ensureBeesFromHives();
  toast(`♦️ Ascended! +${gain} rubies.`, '#ff6b8b');
  beep(440, 0.18, 'triangle', 0.12);
  setTimeout(() => beep(660, 0.18, 'triangle', 0.10), 140);
  setTimeout(() => beep(990, 0.22, 'triangle', 0.08), 300);
  renderShop();
  saveGame();
}

// ---------- Crew skill tree ----------
function renderCrew(list) {
  const header = document.createElement('div');
  header.innerHTML = iconize(`
    <p style="font-size:12px; color:var(--ink-dim); margin-bottom:10px; line-height:1.4;">
      Hire specialists to automate the farm. Each tier requires the one above.
      🧙 A gnome might also drop by with gifts — collect his treasures or let your <b>Scout</b> grab them.
    </p>`);
  list.appendChild(header);

  const tree = document.createElement('div');
  tree.className = 'crew-tree';

  // SVG connectors: the tree has 3 tiers with 3 cols (foreman is col1/tier0).
  // Tier 0 → all tier 1 nodes (fan-out from foreman).
  // Tier 1 → matching tier 2 node (vertical).
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'crew-connectors');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  // coords in percentage space (0..100)
  const COL_X = [10, 30, 50, 70, 90];
  const TIER_Y = [14, 50, 86];
  // Foreman sits at the center column so the fan-out stays symmetric across 5 cols.
  const FOREMAN_X = COL_X[2];
  const lines = [
    { from: [FOREMAN_X, TIER_Y[0]], to: [COL_X[0], TIER_Y[1]], id: 'mechanic' },
    { from: [FOREMAN_X, TIER_Y[0]], to: [COL_X[1], TIER_Y[1]], id: 'keenEye' },
    { from: [FOREMAN_X, TIER_Y[0]], to: [COL_X[2], TIER_Y[1]], id: 'qualityControl' },
    { from: [FOREMAN_X, TIER_Y[0]], to: [COL_X[3], TIER_Y[1]], id: 'moleWarden' },
    { from: [FOREMAN_X, TIER_Y[0]], to: [COL_X[4], TIER_Y[1]], id: 'sprinkler' },
    { from: [COL_X[0], TIER_Y[1]], to: [COL_X[0], TIER_Y[2]], id: 'autoRefuel', parent: 'mechanic' },
    { from: [COL_X[1], TIER_Y[1]], to: [COL_X[1], TIER_Y[2]], id: 'scout', parent: 'keenEye' },
    { from: [COL_X[2], TIER_Y[1]], to: [COL_X[2], TIER_Y[2]], id: 'efficiency', parent: 'qualityControl' },
    { from: [COL_X[3], TIER_Y[1]], to: [COL_X[3], TIER_Y[2]], id: 'accountant', parent: 'moleWarden' },
    { from: [COL_X[4], TIER_Y[1]], to: [COL_X[4], TIER_Y[2]], id: 'headGardener', parent: 'sprinkler' },
  ];
  for (const L of lines) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', L.from[0]);
    line.setAttribute('y1', L.from[1]);
    line.setAttribute('x2', L.to[0]);
    line.setAttribute('y2', L.to[1]);
    const parentId = L.parent || 'foreman';
    const active = hasCrew(L.id) && hasCrew(parentId);
    const reachable = hasCrew(parentId);
    line.setAttribute('stroke', active ? '#ffd34e' : (reachable ? 'rgba(143,240,158,0.45)' : 'rgba(143,240,158,0.15)'));
    line.setAttribute('stroke-width', active ? '3' : '2');
    line.setAttribute('stroke-linecap', 'round');
    if (active) line.setAttribute('filter', 'drop-shadow(0 0 4px #ffd34e)');
    svg.appendChild(line);
  }
  tree.appendChild(svg);

  // Nodes positioned absolutely on the same 300x300 grid (% translated by CSS)
  for (const node of SKILL_TREE) {
    const el = document.createElement('div');
    const owned = hasCrew(node.id);
    const reqOk = !node.req || hasCrew(node.req);
    const affordable = state.coins >= node.cost;
    const buyable = !owned && reqOk && affordable;
    const locked = !reqOk;
    el.className = 'crew-node'
      + (owned ? ' owned' : '')
      + (buyable ? ' buyable' : '')
      + (locked ? ' locked' : '');
    // Foreman (tier 0) centers on col 2; others sit on their grid col.
    const x = (node.tier === 0 && node.id === 'foreman') ? FOREMAN_X : COL_X[node.col];
    el.style.left = x + '%';
    el.style.top  = TIER_Y[node.tier] + '%';
    el.innerHTML = iconize(`
      <div class="crew-icon">${node.icon}</div>
      <div class="crew-name">${owned ? node.crewName : node.name}</div>
      <div class="crew-desc">${node.desc}</div>
      <div class="crew-cost">${owned ? '✅ HIRED' : (locked ? '🔒 locked' : '💰 ' + formatShort(node.cost))}</div>
    `);
    if (buyable) {
      el.addEventListener('click', () => buyCrew(node.id));
    }
    tree.appendChild(el);
  }

  list.appendChild(tree);
}

function buyCrew(id) {
  const node = SKILL_BY_ID[id];
  if (!node) return;
  if (hasCrew(id)) return;
  if (node.req && !hasCrew(node.req)) return;
  if (state.coins < node.cost) return;
  state.coins -= node.cost;
  state.crew.push(id);
  beep(700, 0.10, 'triangle', 0.08);
  setTimeout(() => beep(1040, 0.12, 'triangle', 0.07), 90);
  toast(`${node.icon} Hired: ${node.name}!`, '#8ff09e');
  addParticle(canvas.width / 2, canvas.height / 2, {
    text: node.icon + ' ' + node.name, color: '#8ff09e', size: 18,
  });
  renderShop();
  saveGame();
}

// ---------- Skins tab ----------
function renderSkins(list) {
  const header = document.createElement('div');
  const unlocked = state.skinsUnlocked.length;
  header.innerHTML = iconize(`
    <p style="font-size:12px; color:var(--ink-dim); margin-bottom:10px; line-height:1.4;">
      Equip a skin for your mower fleet. Unlock rare skins from 🧙 <b>gnome treasures</b>.<br>
      Collected: <b style="color:var(--grass-xlight);">${unlocked}/${SKIN_DEFS.length}</b> · Treasures opened: <b style="color:var(--gold);">${state.treasuresCollected || 0}</b>
    </p>`);
  list.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'skin-grid';
  for (const skin of SKIN_DEFS) {
    const owned = state.skinsUnlocked.indexOf(skin.key) >= 0;
    const active = state.activeSkin === skin.key;
    const card = document.createElement('div');
    card.className = 'skin-card' + (owned ? ' owned' : ' locked') + (active ? ' active' : '');
    const preview = skinPreviewHTML(skin, owned);
    const rarityColor = RARITY_COLORS[skin.rarity] || '#9fc4a2';
    card.innerHTML = iconize(`
      <div class="skin-preview">${preview}</div>
      <div class="skin-name">${owned ? skin.name : '???'}</div>
      <div class="skin-rarity" style="color:${rarityColor};">${skin.rarity.toUpperCase()}</div>
      <div class="skin-action">${active ? '✔ Equipped' : (owned ? 'Equip' : '🔒 Locked')}</div>
    `);
    if (owned && !active) {
      card.addEventListener('click', () => {
        state.activeSkin = skin.key;
        beep(660, 0.08, 'sine', 0.06);
        toast(`🎨 Equipped ${skin.name}`, '#8ff09e');
        renderShop();
        saveGame();
      });
    }
    grid.appendChild(card);
  }
  list.appendChild(grid);

  // ---------- Mowing Patterns ----------
  const patHeader = document.createElement('div');
  const patOwned = state.patternsUnlocked.length;
  patHeader.innerHTML = iconize(`
    <p style="font-size:12px; color:var(--ink-dim); margin:16px 0 10px; line-height:1.4;">
      🪚 <b style="color:var(--grass-xlight);">Mowing Patterns</b> — styles your robots cut into the lawn.<br>
      Unlocked: <b style="color:var(--grass-xlight);">${patOwned}/${MOW_PATTERN_DEFS.length}</b> · Visible on freshly cut grass.
    </p>`);
  list.appendChild(patHeader);

  const patGrid = document.createElement('div');
  patGrid.className = 'pattern-grid';
  for (const pat of MOW_PATTERN_DEFS) {
    const owned = state.patternsUnlocked.indexOf(pat.key) >= 0;
    const active = state.activeMowPattern === pat.key;
    const affordable = !owned && state.coins >= pat.unlockCost;
    const card = document.createElement('div');
    card.className = 'pattern-card' + (owned ? ' owned' : ' locked') + (active ? ' active' : '') + (affordable ? ' affordable' : '');
    const preview = patternPreviewCanvas(pat.key);
    card.appendChild(preview);
    const meta = document.createElement('div');
    meta.className = 'pattern-meta';
    meta.innerHTML = iconize(`
      <div class="pattern-name">${pat.icon} ${pat.name}</div>
      <div class="pattern-desc">${pat.desc}</div>
      <div class="pattern-action">${active ? '✔ Equipped' : owned ? 'Equip' : (pat.unlockCost > 0 ? '💰 ' + formatShort(pat.unlockCost) : 'Unlock')}</div>`);
    card.appendChild(meta);
    if (owned && !active) {
      card.addEventListener('click', () => {
        state.activeMowPattern = pat.key;
        robots.forEach(rb => { rb.target = null; }); // re-route to new pattern
        beep(680, 0.08, 'sine', 0.06);
        toast(`🪚 Equipped ${pat.name}`, '#8ff09e');
        renderShop();
        saveGame();
      });
    } else if (!owned && affordable) {
      card.addEventListener('click', () => {
        if (state.coins < pat.unlockCost) return;
        state.coins -= pat.unlockCost;
        state.patternsUnlocked.push(pat.key);
        state.activeMowPattern = pat.key;
        robots.forEach(rb => { rb.target = null; });
        beep(720, 0.08, 'triangle', 0.07);
        setTimeout(() => beep(1080, 0.1, 'triangle', 0.06), 80);
        toast(`🪚 Unlocked ${pat.name}!`, '#ffd34e');
        renderShop();
        saveGame();
      });
    }
    patGrid.appendChild(card);
  }
  list.appendChild(patGrid);
}

// Draw a small preview of the pattern on a fake green tile grid so the
// player can recognize each style at a glance in the shop.
function patternPreviewCanvas(key) {
  const size = 72;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  c.className = 'pattern-preview';
  const g = c.getContext('2d');
  g.fillStyle = '#3a8840';
  g.fillRect(0, 0, size, size);
  const cells = 8;
  const cell = size / cells;
  const prev = state.activeMowPattern;
  state.activeMowPattern = key;
  for (let ty = 0; ty < cells; ty++) {
    for (let tx = 0; tx < cells; tx++) {
      const tint = mowPatternTint(tx, ty, 0);
      if (!tint) continue;
      g.fillStyle = tint.dark
        ? `rgba(0,0,0,${tint.alpha.toFixed(3)})`
        : `rgba(255,255,255,${(tint.alpha * 0.65).toFixed(3)})`;
      g.fillRect(tx * cell, ty * cell, cell, cell);
    }
  }
  state.activeMowPattern = prev;
  return c;
}

function skinPreviewHTML(skin, owned) {
  if (!owned) return `<div class="skin-silhouette">?</div>`;
  let grad;
  if (skin.body[0] === 'rainbow') {
    grad = `linear-gradient(135deg, #ff4a4a, #ffd34e, #58ffa0, #5ccaff, #b94dff)`;
  } else {
    grad = `linear-gradient(180deg, ${skin.body[0]}, ${skin.body[1]})`;
  }
  return `
    <div class="skin-chip" style="background:${grad}; border-color:${skin.trim};">
      <div class="skin-dot" style="background:${skin.accent};"></div>
      <div class="skin-panel" style="background:${skin.panel};"></div>
    </div>`;
}

// ---------- Treasure collection ----------
// Lawn-pedia rarity classifier. Skins use their own rarity; pattern blueprints
// are rare; coin treasures are bucketed by amount thresholds.
function treasureRarityOf(t) {
  if (!t) return 'common';
  if (t.type === 'skin' && t.skinKey) {
    const r = (SKIN_BY_KEY[t.skinKey] || {}).rarity;
    if (r === 'epic' || r === 'legendary') return 'epic';
    if (r === 'rare') return 'rare';
    if (r === 'uncommon') return 'uncommon';
    return 'common';
  }
  if (t.type === 'pattern') return 'rare';
  const a = t.amount || 0;
  if (a >= 1e6) return 'epic';
  if (a >= 1e5) return 'rare';
  if (a >= 1e4) return 'uncommon';
  return 'common';
}

function collectTreasureIndex(i, silent) {
  const t = treasures[i];
  if (!t) return;
  treasures.splice(i, 1);
  state.treasuresCollected = (state.treasuresCollected || 0) + 1;
  // Lawn-pedia tracking: count + per-rarity discovery.
  if (state.pedia) {
    state.pedia.treasures = (state.pedia.treasures || 0) + 1;
    const rar = treasureRarityOf(t);
    if (rar && Array.isArray(state.pedia.treasureRare) && state.pedia.treasureRare.indexOf(rar) < 0) {
      state.pedia.treasureRare.push(rar);
      toast('📖 Discovered: 🎁 ' + rar.charAt(0).toUpperCase() + rar.slice(1) + ' treasure', '#c896ff');
    }
  }
  if (t.type === 'skin' && t.skinKey && state.skinsUnlocked.indexOf(t.skinKey) < 0) {
    state.skinsUnlocked.push(t.skinKey);
    const skin = SKIN_BY_KEY[t.skinKey];
    showSkinUnlockModal(skin);
    beep(660, 0.10, 'triangle', 0.09);
    setTimeout(() => beep(990, 0.10, 'triangle', 0.08), 90);
    setTimeout(() => beep(1320, 0.18, 'triangle', 0.08), 200);
  } else if (t.type === 'pattern' && t.patternKey && state.patternsUnlocked.indexOf(t.patternKey) < 0) {
    state.patternsUnlocked.push(t.patternKey);
    const pat = MOW_PATTERN_BY_KEY[t.patternKey];
    showPatternUnlockModal(pat);
    beep(560, 0.10, 'triangle', 0.09);
    setTimeout(() => beep(880, 0.10, 'triangle', 0.08), 90);
    setTimeout(() => beep(1180, 0.18, 'triangle', 0.08), 200);
  } else {
    // fallback if the skin/pattern was already owned or for coin treasure
    let coins = t.amount;
    if (!coins || t.type === 'skin' || t.type === 'pattern') {
      coins = Math.max(120, Math.floor((displayedRate || 4) * 60));
    }
    state.coins += coins;
    state.totalEarnedAllTime += coins;
    state.totalEarnedThisRun += coins;
    addParticle(t.x, t.y - 6, {
      text: '+' + formatShort(coins), color: '#ffd34e', size: 18,
    });
    if (!silent) toast('🪙 Treasure opened: +' + formatShort(coins), '#ffd34e');
    beep(820, 0.08, 'triangle', 0.08);
    setTimeout(() => beep(1100, 0.1, 'triangle', 0.06), 80);
  }
  saveGame();
}

function showPatternUnlockModal(pat) {
  if (!pat) return;
  const preview = patternPreviewCanvas(pat.key);
  preview.style.cssText = 'width:120px; height:120px; display:block; margin:8px auto; border-radius:8px; border:1px solid rgba(0,0,0,0.45); box-shadow: inset 0 -8px 12px rgba(0,0,0,0.25);';
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = iconize(`
    <div class="modal skin-modal">
      <h2>🧙 GNOME'S BLUEPRINT!</h2>
      <p style="color:#8ff09e; font-weight:800; letter-spacing:1px;">MOWING PATTERN UNLOCKED</p>
      <div class="skin-modal-preview" id="patUnlockPreview"></div>
      <div class="big" style="color:#8ff09e;">${pat.icon} ${pat.name}</div>
      <p>${pat.desc}<br>Equip it now from the 🎨 Skins tab.</p>
      <button id="okBtn">Sweet!</button>
    </div>`);
  document.body.appendChild(back);
  back.querySelector('#patUnlockPreview').appendChild(preview);
  back.querySelector('#okBtn').addEventListener('click', () => back.remove());
}

function showSkinUnlockModal(skin) {
  const rarityColor = RARITY_COLORS[skin.rarity] || '#ffd34e';
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = iconize(`
    <div class="modal skin-modal">
      <h2>🧙 GNOME'S GIFT!</h2>
      <p style="color:${rarityColor}; font-weight:800; letter-spacing:1px;">${skin.rarity.toUpperCase()} SKIN UNLOCKED</p>
      <div class="skin-modal-preview">${skinPreviewHTML(skin, true)}</div>
      <div class="big" style="color:${rarityColor};">${skin.name}</div>
      <p>Equip it now from the 🎨 Skins tab.</p>
      <button id="okBtn">Sweet!</button>
    </div>`);
  document.body.appendChild(back);
  back.querySelector('#okBtn').addEventListener('click', () => back.remove());
}

function handleCanvasClick(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top)  * (canvas.height / rect.height);
  // Golden gnomes win the click — checked first so a hit consumes the event
  // and never falls through to garden-placement / treasure pickup.
  for (let i = goldenGnomes.length - 1; i >= 0; i--) {
    const g = goldenGnomes[i];
    if (Math.hypot(g.x - x, g.y - y) < tileSize) {
      triggerGoldenBuff(g);
      goldenGnomes.splice(i, 1);
      return;
    }
  }
  for (let i = treasures.length - 1; i >= 0; i--) {
    const t = treasures[i];
    const dx = t.x - x, dy = t.y - y;
    if (Math.hypot(dx, dy) < tileSize * 0.8) {
      collectTreasureIndex(i, false);
      return;
    }
  }
}

// ---------- Golden Gnome buff trigger ----------
const GOLDEN_BUFF_DEFS = {
  frenzy:    { name: 'Mowing Frenzy', icon: '🔥', duration: 30, color: '#ff8a3d' },
  lucky:     { name: 'Lucky Strike',  icon: '🍀', duration: 0,  color: '#7df09e' },
  blessed:   { name: 'Blessed Rain',  icon: '🌧️', duration: 0,  color: '#7ec8ff' },
  critStorm: { name: 'Crit Storm',    icon: '⚡', duration: 20, color: '#ffe27a' },
};

function triggerGoldenBuff(g) {
  const def = GOLDEN_BUFF_DEFS[g.buff] || GOLDEN_BUFF_DEFS.frenzy;
  // Lawn-pedia: record buff key on first trigger.
  if (state.pedia && Array.isArray(state.pedia.buffs) && state.pedia.buffs.indexOf(g.buff) < 0) {
    state.pedia.buffs.push(g.buff);
    toast('📖 Discovered: ' + def.icon + ' ' + def.name, '#c896ff');
  }
  // Particle burst at the gnome's position.
  for (let i = 0; i < 14; i++) {
    addParticle(g.x, g.y, { text: '✨', color: def.color, size: 10 + Math.random() * 8 });
  }
  // Cheery ascending arpeggio.
  [523, 659, 784, 1047].forEach((f, i) => {
    setTimeout(() => beep(f, 0.08, 'triangle', 0.06), i * 60);
  });

  if (g.buff === 'lucky') {
    const rate = (typeof displayedRate === 'number' && displayedRate > 0) ? displayedRate : 4;
    const gain = Math.min(1e12, Math.floor(rate * 3600));
    state.coins += gain;
    state.totalEarnedAllTime += gain;
    state.totalEarnedThisRun += gain;
    flashCoin();
    toast(`${def.icon} ${def.name}! +${formatShort(gain)} 💰 (1h of income)`, def.color);
    return;
  }
  if (g.buff === 'blessed') {
    if (grass && tiles) {
      for (let i = 0; i < grass.length; i++) {
        if (tiles[i] === T.GRASS) grass[i] = 1.0;
      }
    }
    toast(`${def.icon} ${def.name}! All grass instantly tall.`, def.color);
    return;
  }
  // Timed buffs (frenzy, critStorm) — push to active list.
  if (!Array.isArray(state.activeBuffs)) state.activeBuffs = [];
  const dur = def.duration * techBuffDurationMult();
  state.activeBuffs.push({
    key: g.buff,
    name: def.name,
    icon: def.icon,
    expires: dur,
  });
  toast(`${def.icon} ${def.name}! ${Math.round(dur)}s`, def.color);
}

// ---------- Settings modal ----------
function openSettingsModal() {
  if (document.querySelector('.settings-modal-backdrop')) return;
  const back = document.createElement('div');
  back.className = 'modal-backdrop settings-modal-backdrop';
  const rows = SETTING_DEFS.filter(def => !def.gate || def.gate()).map(def => {
    if (def.type === 'select') {
      const options = typeof def.options === 'function' ? def.options() : (def.options || []);
      const current = state.settings[def.key];
      const opts = options.map(opt => {
        const sel = opt.value === current ? ' selected' : '';
        const title = (opt.desc || '').replace(/"/g,'&quot;');
        return `<option value="${opt.value}"${sel} title="${title}">${opt.label}</option>`;
      }).join('');
      return `
        <div class="settings-row settings-row-select">
          <div class="settings-info">
            <div class="settings-label">${def.label}</div>
            <div class="settings-hint">${def.hint || ''}</div>
          </div>
          <select class="settings-select" data-key="${def.key}">${opts}</select>
        </div>`;
    }
    const hasValueMap = ('onValue' in def) || ('offValue' in def);
    const on = hasValueMap
      ? (state.settings[def.key] !== def.offValue)
      : !!state.settings[def.key];
    return `
      <label class="settings-row" data-key="${def.key}">
        <div class="settings-info">
          <div class="settings-label">${def.label}</div>
          <div class="settings-hint">${def.hint || ''}</div>
        </div>
        <span class="toggle ${on ? 'on' : ''}" data-key="${def.key}"><span class="knob"></span></span>
      </label>`;
  }).join('');
  back.innerHTML = iconize(`
    <div class="modal settings-modal">
      <h2>⚙️ SETTINGS</h2>
      <div class="settings-list">${rows}</div>
      <button id="settingsCloseBtn">Done</button>
    </div>`);
  document.body.appendChild(back);
  back.querySelectorAll('.toggle').forEach(t => {
    t.addEventListener('click', (e) => {
      e.preventDefault();
      const key = t.dataset.key;
      const def = SETTING_DEFS.find(d => d.key === key);
      const hasValueMap = def && (('onValue' in def) || ('offValue' in def));
      if (hasValueMap) {
        const isOn = state.settings[key] !== def.offValue;
        state.settings[key] = isOn ? def.offValue : def.onValue;
        t.classList.toggle('on', !isOn);
        beep(!isOn ? 720 : 520, 0.05, 'sine', 0.05);
      } else {
        state.settings[key] = !state.settings[key];
        t.classList.toggle('on', !!state.settings[key]);
        beep(state.settings[key] ? 720 : 520, 0.05, 'sine', 0.05);
      }
      // Sprite toggle swaps the static HUD emojis live + forces a shop
      // repaint so every existing rendered row picks up the new style.
      if (key === 'useSprites') {
        iconizeStaticHUD();
        renderShop();
        updateHUD();
      }
      saveGame();
    });
  });
  back.querySelectorAll('.settings-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const key = sel.dataset.key;
      const value = sel.value;
      state.settings[key] = value;
      if (key === 'theme' && typeof applyThemeDom === 'function') applyThemeDom();
      beep(620, 0.05, 'sine', 0.05);
      saveGame();
    });
  });
  const close = () => back.remove();
  back.querySelector('#settingsCloseBtn').addEventListener('click', close);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
}

// ---------- Zen Mode ----------
// Zen is a standalone screensaver world: a fresh garden composed from
// sliders (mowers, flowers, beehives, ...), completely decoupled from the
// player's progression. On enter we snapshot the live game; on exit we
// restore it. No coins, upgrades, or unlocks are affected by zen activity.
let zenSnapshot = null;

function openZenSetupModal() {
  if (state.zenMode) { exitZenMode(); return; }
  if (document.querySelector('.zen-setup-backdrop')) return;
  const cfg = Object.assign({}, ZEN_CONFIG_DEFAULT, state.zenConfig || {});
  const back = document.createElement('div');
  back.className = 'modal-backdrop zen-setup-backdrop';

  const sliderRow = (s) => `
    <div class="zen-slider" data-key="${s.key}">
      <div class="zen-slider-head">
        <span class="zen-slider-ico">${s.icon}</span>
        <span class="zen-slider-label">${s.label}</span>
        <span class="zen-slider-value" data-val="${s.key}">${cfg[s.key]}</span>
      </div>
      <input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${cfg[s.key]}" data-key="${s.key}">
    </div>`;
  const sliderGrid = ZEN_SLIDERS.map(sliderRow).join('');

  back.innerHTML = iconize(`
    <div class="modal zen-modal">
      <h2>🧘 ZEN MODE</h2>
      <p class="zen-tagline">Compose your garden screensaver.<br>
        <span class="zen-subnote">No fuel, no shopping — your real game is paused and untouched.</span></p>

      <div class="zen-body">
        <section class="zen-section">
          <div class="zen-section-head">Garden</div>
          <div class="zen-slider-grid">${sliderGrid}</div>
        </section>

        <section class="zen-section">
          <div class="zen-section-head">Mower Skin</div>
          <div class="zen-skin-grid" id="zenSkinGrid"></div>
        </section>

        <section class="zen-section">
          <div class="zen-section-head">Mowing Pattern</div>
          <div class="zen-pattern-grid" id="zenPatternGrid"></div>
        </section>

        <section class="zen-section">
          <div class="zen-section-head">Atmosphere</div>
          <div class="zen-atmosphere">
            <div class="zen-atmo-row" id="zenWeatherRow">
              <span class="zen-atmo-label">Weather</span>
              <div class="zen-atmo-chips" id="zenWeatherChips"></div>
            </div>
            <div class="zen-atmo-row" id="zenTimeRow">
              <span class="zen-atmo-label">Time of day</span>
              <div class="zen-atmo-chips" id="zenTimeChips"></div>
            </div>
            <div class="zen-atmo-row" id="zenRivalryRow">
              <span class="zen-atmo-label">Rivalry crown</span>
              <span class="toggle ${cfg.rivalry ? 'on' : ''}" id="zenRivalryToggle"><span class="knob"></span></span>
            </div>
          </div>
        </section>
      </div>

      <div class="zen-actions">
        <button id="zenResetBtn" class="ghost">Defaults</button>
        <button id="zenCancelBtn" class="ghost">Cancel</button>
        <button id="zenStartBtn">▶ Start Zen</button>
      </div>
    </div>`);
  document.body.appendChild(back);

  // Visual skin swatches — compact, single-row. Name in tooltip.
  const skinGrid = back.querySelector('#zenSkinGrid');
  for (const skin of SKIN_DEFS) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'zen-skin-tile' + (cfg.skin === skin.key ? ' active' : '');
    tile.dataset.zenKey = 'skin';
    tile.dataset.value = skin.key;
    tile.title = skin.name + ' · ' + (skin.rarity || 'base');
    tile.innerHTML = iconize(skinPreviewHTML(skin, true));
    skinGrid.appendChild(tile);
  }

  // Pattern thumbnails — compact, single-row. Name in tooltip.
  const patternGrid = back.querySelector('#zenPatternGrid');
  for (const pat of MOW_PATTERN_DEFS) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'zen-pattern-tile' + (cfg.pattern === pat.key ? ' active' : '');
    tile.dataset.zenKey = 'pattern';
    tile.dataset.value = pat.key;
    tile.title = pat.name + ' — ' + pat.desc;
    tile.appendChild(patternPreviewCanvas(pat.key));
    patternGrid.appendChild(tile);
  }

  // Weather chips: Auto + each weather type with icon.
  const weatherChips = back.querySelector('#zenWeatherChips');
  const weatherOptions = [{ id: 'auto', name: 'Auto', icon: '🔁' }, ...WEATHER_TYPES];
  for (const w of weatherOptions) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'settings-chip' + (cfg.weather === w.id ? ' active' : '');
    chip.dataset.zenKey = 'weather';
    chip.dataset.value = w.id;
    chip.title = w.name;
    chip.innerHTML = iconize(`${w.icon || ''} ${w.name}`.trim());
    weatherChips.appendChild(chip);
  }

  // Time-of-day chips: auto/dawn/day/dusk/night/off.
  const timeChips = back.querySelector('#zenTimeChips');
  const timeIcons = { auto: '🔁', dawn: '🌅', day: '☀️', dusk: '🌇', night: '🌙', off: '🚫' };
  for (const key of DAY_TIME_KEYS) {
    const preset = DAY_TIME_PRESETS[key];
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'settings-chip' + (cfg.dayTime === key ? ' active' : '');
    chip.dataset.zenKey = 'dayTime';
    chip.dataset.value = key;
    chip.title = preset.label || key;
    chip.innerHTML = iconize(`${timeIcons[key] || ''} ${preset.label || key}`.trim());
    timeChips.appendChild(chip);
  }

  // Rivalry toggle (zen-local).
  const rivalryToggle = back.querySelector('#zenRivalryToggle');
  rivalryToggle.addEventListener('click', () => {
    state.zenConfig.rivalry = !state.zenConfig.rivalry;
    rivalryToggle.classList.toggle('on', !!state.zenConfig.rivalry);
    beep(state.zenConfig.rivalry ? 720 : 520, 0.05, 'sine', 0.04);
  });

  back.querySelectorAll('input[type="range"]').forEach(input => {
    input.addEventListener('input', () => {
      const key = input.dataset.key;
      const val = parseInt(input.value, 10) || 0;
      state.zenConfig[key] = val;
      back.querySelector(`[data-val="${key}"]`).textContent = val;
    });
  });
  back.querySelectorAll('[data-zen-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.zenKey;
      state.zenConfig[key] = btn.dataset.value;
      back.querySelectorAll(`[data-zen-key="${key}"]`).forEach(s => s.classList.toggle('active', s === btn));
    });
  });

  const close = () => back.remove();
  back.querySelector('#zenCancelBtn').addEventListener('click', close);
  back.querySelector('#zenResetBtn').addEventListener('click', () => {
    Object.assign(state.zenConfig, ZEN_CONFIG_DEFAULT);
    back.querySelectorAll('input[type="range"]').forEach(input => {
      const key = input.dataset.key;
      input.value = state.zenConfig[key];
      back.querySelector(`[data-val="${key}"]`).textContent = state.zenConfig[key];
    });
    back.querySelectorAll('[data-zen-key]').forEach(btn => {
      const key = btn.dataset.zenKey;
      btn.classList.toggle('active', btn.dataset.value === state.zenConfig[key]);
    });
    rivalryToggle.classList.toggle('on', !!state.zenConfig.rivalry);
  });
  back.querySelector('#zenStartBtn').addEventListener('click', () => {
    close();
    enterZenMode();
  });
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
}

function enterZenMode() {
  if (state.zenMode) return;
  saveGame(); // persist real game first
  zenSnapshot = {
    coins: state.coins,
    gems: state.gems,
    totalEarnedAllTime: state.totalEarnedAllTime,
    totalEarnedThisRun: state.totalEarnedThisRun,
    totalTilesMowed: state.totalTilesMowed,
    fuel: state.fuel,
    upgrades: Object.assign({}, state.upgrades),
    garden: Object.assign({}, state.garden),
    gnomeTimer: state.gnomeTimer,
    skinsUnlocked: state.skinsUnlocked.slice(),
    activeSkin: state.activeSkin,
    activeMowPattern: state.activeMowPattern,
    patternsUnlocked: state.patternsUnlocked.slice(),
    treasuresCollected: state.treasuresCollected,
    settings: Object.assign({}, state.settings),
    timeOfDay: state.timeOfDay,
    weather: state.weather && { id: state.weather.id, intensity: state.weather.intensity, cycleTimer: state.weather.cycleTimer },
    grass: new Float32Array(grass),
    tiles: new Uint8Array(tiles),
    flowerColors: new Uint8Array(flowerColors),
    grassSpecies: grassSpecies ? new Uint8Array(grassSpecies) : null,
    robots, bees, visitorGnomes, treasures,
    moles: moles.slice(),
    particles: particles.slice(),
  };
  // Note: moles are replaced by buildZenWorld → clearActors() below.

  state.zenMode = true;
  document.body.classList.add('zen-mode');
  buildZenWorld(state.zenConfig);

  const el = document.documentElement;
  if (el.requestFullscreen && !document.fullscreenElement) {
    el.requestFullscreen().catch(() => {});
  }
  refitCanvas();
  toast('🧘 Zen Mode — breathe and watch.', '#c6a8ff');
}

function exitZenMode() {
  if (!state.zenMode || !zenSnapshot) {
    state.zenMode = false;
    document.body.classList.remove('zen-mode');
    return;
  }
  // Restore live game
  state.coins = zenSnapshot.coins;
  state.gems = zenSnapshot.gems;
  state.totalEarnedAllTime = zenSnapshot.totalEarnedAllTime;
  state.totalEarnedThisRun = zenSnapshot.totalEarnedThisRun;
  state.totalTilesMowed = zenSnapshot.totalTilesMowed;
  state.fuel = zenSnapshot.fuel;
  state.upgrades = zenSnapshot.upgrades;
  state.garden = zenSnapshot.garden;
  state.gnomeTimer = zenSnapshot.gnomeTimer;
  state.skinsUnlocked = zenSnapshot.skinsUnlocked;
  state.activeSkin = zenSnapshot.activeSkin;
  state.activeMowPattern = zenSnapshot.activeMowPattern;
  state.patternsUnlocked = zenSnapshot.patternsUnlocked;
  state.treasuresCollected = zenSnapshot.treasuresCollected;
  if (zenSnapshot.settings) state.settings = zenSnapshot.settings;
  if (zenSnapshot.timeOfDay != null) state.timeOfDay = zenSnapshot.timeOfDay;
  if (zenSnapshot.weather) state.weather = zenSnapshot.weather;
  restoreWorldFromSnapshot(zenSnapshot);
  particles.length = 0;
  for (const p of zenSnapshot.particles) particles.push(p);
  zenSnapshot = null;

  state.zenMode = false;
  document.body.classList.remove('zen-mode');
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
  refitCanvas();
  renderShop();
  saveGame();
}

function buildZenWorld(cfg) {
  allocateWorldArrays();
  for (let i = 0; i < grass.length; i++) grass[i] = 0.7 + Math.random() * 0.3;
  clearActors();
  particles.length = 0;

  const placeMany = (type, n) => { for (let i = 0; i < n; i++) placeAtRandomGrass(type); };
  placeMany(T.TREE,    cfg.trees);
  placeMany(T.ROCK,    cfg.rocks);
  placeMany(T.POND,    cfg.ponds);
  placeMany(T.FLOWER,  cfg.flowers);
  placeMany(T.BEEHIVE, cfg.beehives);
  placeMany(T.GNOME,   cfg.gnomes);

  // Bump gameplay knobs that drive robot/bee/flower counts.
  state.upgrades.robots = cfg.robots;
  state.garden = Object.assign({}, state.garden, {
    flower: cfg.flowers, beehive: cfg.beehives, tree: cfg.trees,
    rock: cfg.rocks, pond: cfg.ponds, gnome: cfg.gnomes,
  });
  ensureRobotCount();
  ensureBeesFromHives();
  state.fuel = CFG.fuelMax;

  // Apply zen-only cosmetic overrides. Any skin/pattern is fair game in zen,
  // regardless of the player's real unlocks — it's a preview space.
  if (cfg.skin && SKIN_BY_KEY[cfg.skin]) state.activeSkin = cfg.skin;
  if (cfg.pattern && MOW_PATTERN_BY_KEY[cfg.pattern]) state.activeMowPattern = cfg.pattern;

  // Atmosphere overrides: mutate the live `state.settings` so the update
  // functions pick them up. The snapshot's original settings are restored on
  // exit, so this isn't destructive to the main game.
  if (cfg.weather && (typeof WEATHER_BY_ID === 'undefined' || cfg.weather === 'auto' || WEATHER_BY_ID[cfg.weather])) {
    state.settings.weather = cfg.weather;
  }
  if (cfg.dayTime && (typeof DAY_TIME_PRESETS === 'undefined' || DAY_TIME_PRESETS[cfg.dayTime])) {
    state.settings.dayNight = cfg.dayTime;
  }
  if (typeof cfg.rivalry === 'boolean') state.settings.rivalry = cfg.rivalry;

  // Suppress visitor gnomes & their treasure popups — zen stays peaceful.
  state.gnomeTimer = Number.POSITIVE_INFINITY;
}

// Resize canvas to current container and rescale entity positions.
function refitCanvas() {
  const prev = tileSize;
  resizeCanvas();
  if (!prev || prev === tileSize) return;
  const scale = tileSize / prev;
  robots.forEach(r => { r.x *= scale; r.y *= scale; });
  bees.forEach(b => {
    b.x *= scale; b.y *= scale;
    if (b.target) { b.target.x *= scale; b.target.y *= scale; }
  });
  visitorGnomes.forEach(g => {
    g.x *= scale; g.y *= scale;
    g.targetX *= scale; g.targetY *= scale;
    g.exitX *= scale; g.exitY *= scale;
  });
  treasures.forEach(t => {
    t.x = (t.tileX + 0.5) * tileSize;
    t.y = (t.tileY + 0.5) * tileSize;
  });
}

// ---------- Toasts ----------
function toast(msg, color = '#ffd34e') {
  const c = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast';
  t.style.background = `linear-gradient(180deg, ${color}ee, ${color}aa)`;
  t.innerHTML = iconize(msg);
  c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ---------- Achievements ----------
const ACHIEVEMENTS = [
  { id: 'first',  cond: s => s.totalEarnedAllTime >= 100,   msg: 'Rookie Mower: earned 100 coins' },
  { id: 'k1',     cond: s => s.totalEarnedAllTime >= 1000,  msg: 'Green Thumb: earned 1K coins' },
  { id: 'k10',    cond: s => s.totalEarnedAllTime >= 10000, msg: 'Lawn Baron: earned 10K coins' },
  { id: 'k100',   cond: s => s.totalEarnedAllTime >= 1e5,   msg: 'Grass Tycoon: earned 100K coins' },
  { id: 'm1',     cond: s => s.totalEarnedAllTime >= 1e6,   msg: 'Turf Millionaire!' },
  { id: 'robot5', cond: s => s.upgrades.robots >= 5,        msg: '5-Bot Fleet assembled' },
  { id: 'robot15',cond: s => s.upgrades.robots >= 15,       msg: '15-Bot Army deployed' },
  { id: 'gems1',  cond: s => s.gems >= 1,                   msg: 'First Fertilization: +10% forever' },
];
const achieved = new Set();
function checkAchievements() {
  for (const a of ACHIEVEMENTS) {
    if (!achieved.has(a.id) && a.cond(state)) {
      achieved.add(a.id);
      toast('🏆 ' + a.msg, '#ffd34e');
      beep(1200, 0.1, 'triangle', 0.08);
    }
  }
}

// ---------- Tabs + footer buttons ----------
function wireUIEvents() {
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      activeTab = t.dataset.tab;
      renderShop();
    });
  });

  canvas.addEventListener('click', (e) => {
    if (suppressNextClick) { suppressNextClick = false; return; }
    handleCanvasClick(e);
  });

  // ---------- Robot drag-and-drop ----------
  // Player can pick up any robot and drop it somewhere else on the lawn.
  // While dragged, a robot pauses its AI (see updateRobot early-out on r.dragging).
  let draggingRobot = null;
  let dragOffX = 0, dragOffY = 0;
  let suppressNextClick = false;
  let dragMoved = false;
  function canvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top)  * (canvas.height / rect.height),
    };
  }
  function robotAt(x, y) {
    // Hit-test robots back-to-front so the topmost (last drawn) wins.
    for (let i = robots.length - 1; i >= 0; i--) {
      const r = robots[i];
      const s = Math.max(10, tileSize * 0.9);
      // Body is ~1.4s × s; use the larger half-extent as a forgiving circle.
      if (Math.hypot(r.x - x, r.y - y) < s * 0.8) return r;
    }
    return null;
  }
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const { x, y } = canvasCoords(e);
    const r = robotAt(x, y);
    if (!r) return;
    draggingRobot = r;
    r.dragging = true;
    dragOffX = r.x - x;
    dragOffY = r.y - y;
    dragMoved = false;
    canvas.style.cursor = 'grabbing';
    player.active = false; // hide the manual mower while dragging
    e.preventDefault();
  });
  window.addEventListener('mouseup', (e) => {
    if (!draggingRobot) return;
    draggingRobot.dragging = false;
    draggingRobot.target = null; // repick a fresh target at the new location
    draggingRobot.lastTargetCheck = 0;
    draggingRobot = null;
    canvas.style.cursor = 'none';
    if (dragMoved) suppressNextClick = true; // don't treat the drop as a treasure click
  });

  canvas.addEventListener('mousemove', (e) => {
    const { x, y } = canvasCoords(e);
    if (draggingRobot) {
      dragMoved = true;
      // Clamp to canvas bounds so the robot can't be flung off-screen.
      const nx = Math.max(0, Math.min(canvas.width, x + dragOffX));
      const ny = Math.max(0, Math.min(canvas.height, y + dragOffY));
      draggingRobot.x = nx;
      draggingRobot.y = ny;
      return;
    }
    player.x = x; player.y = y; player.active = true;
    let hover = false;
    for (const t of treasures) {
      if (Math.hypot(t.x - x, t.y - y) < tileSize * 0.8) { hover = true; break; }
    }
    if (robotAt(x, y)) {
      canvas.style.cursor = 'grab';
    } else {
      canvas.style.cursor = hover ? 'pointer' : 'none';
    }
  });
  canvas.addEventListener('mouseleave', () => {
    if (draggingRobot) return; // keep dragging even if the cursor slips out
    player.active = false; canvas.style.cursor = 'default';
  });
  canvas.addEventListener('mouseenter', () => { player.active = true; canvas.style.cursor = 'none'; });

  document.getElementById('refuelBtn').addEventListener('click', () => {
    if (isElectric()) return;
    const cost = fuelRefillCost();
    if (state.coins < cost || state.fuel >= CFG.fuelMax) return;
    state.coins -= cost;
    state.fuel = CFG.fuelMax;
    beep(440, 0.06, 'sine', 0.05);
    toast('⛽ Robots refueled!', '#ff9f1c');
    saveGame();
  });

  document.getElementById('saveBtn').addEventListener('click', () => { saveGame(); toast('💾 Game saved!', '#8ff09e'); });
  document.getElementById('resetBtn').addEventListener('click', resetGame);
  const muteBtn = document.getElementById('muteBtn');
  muteBtn.addEventListener('click', () => {
    state.muted = !state.muted;
    muteBtn.textContent = state.muted ? '🔇 Muted' : '🔊 Sound';
    saveGame();
  });

  document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);
  document.getElementById('zenBtn').addEventListener('click', openZenSetupModal);
  document.getElementById('statsBtn').addEventListener('click', openStatsModal);
  document.getElementById('pediaBtn').addEventListener('click', openPediaModal);
  document.getElementById('zenExit').addEventListener('click', exitZenMode);

  // Weather Machine: click HUD pill to cycle weather when ruby upgrade owned.
  const atmoEl = document.getElementById('hudAtmo');
  if (atmoEl) {
    const weatherCycle = ['auto', ...WEATHER_TYPES.map(w => w.id)];
    atmoEl.addEventListener('click', () => {
      if (typeof rubyShopHasWeatherControl !== 'function' || !rubyShopHasWeatherControl()) return;
      const cur = (state.settings && state.settings.weather) || 'auto';
      const idx = weatherCycle.indexOf(cur);
      const next = weatherCycle[(idx + 1) % weatherCycle.length];
      state.settings.weather = next;
      const label = next === 'auto' ? 'Auto' : (WEATHER_BY_ID[next] || {}).name || next;
      toast(`🌦️ Weather → ${label}`, '#72f2ff');
      beep(620, 0.06, 'sine', 0.05);
      saveGame();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.zenMode) exitZenMode();
    // Photo mode: `P` snapshots the canvas to a PNG download while in Zen.
    // Ignore when typing in an input and require no modifier keys so we
    // don't clash with browser shortcuts.
    if (state.zenMode && (e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tgt = e.target;
      const typing = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);
      if (!typing) {
        e.preventDefault();
        takeZenPhoto();
      }
    }
    updateBuyMult(e);
  });
  document.addEventListener('keyup', updateBuyMult);
  window.addEventListener('blur', () => { if (buyMult !== 1) { buyMult = 1; renderShop(); } });
  document.addEventListener('fullscreenchange', () => {
    // If the user exits fullscreen via browser UI, leave zen mode too.
    if (!document.fullscreenElement && state.zenMode) exitZenMode();
  });
}

// ===== AUTO-EXPORTS =====
export { achieved, autoBuyCheapest, checkAchievements, collectTreasureIndex, displayedRate, iconizeStaticHUD, renderShop, showQuestOfferModal, toast, updateHUD, wireUIEvents };
