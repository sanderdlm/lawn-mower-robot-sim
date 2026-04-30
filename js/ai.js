// ===== AUTO-IMPORTS =====
import { CFG, NEIGHBOR_NAMES, OBSTACLE, T } from './config.js';
import { GRASS_TYPES, QUEST_BY_ID, QUEST_HISTORY_MAX, QUEST_TYPES, activeFuelType, coinMult, critCascadeBonus, critChance, critMult, formatShort, fuelDrainRate, fuelRefillCost, getSetting, gnomeSpawnIntervalMult, growthRate, hasCrew, isElectric, moleSpawnIntervalMult, mowRadius, mowRate, noteCritForCascade, playerMowRadius, playerMowRate, robotSpeed, state, techAutoBuyInterval, techGoldenGnomeMult } from './state.js';
import { addParticle, beep, canvas, playGnomeGiggle, tileSize } from './canvas.js';
import { activeWeather, beesAreActive, rivalrySpeedBonus, trackRivalryEarnings, weatherFlowerMult } from './atmosphere.js';
import { collectTreasureIndex, showQuestOfferModal, toast, autoBuyCheapest } from './ui.js';
import { despawnMole, goldenGnomes, grass, grassSpecies, idx, inBounds, moles, player, robots, spawnEvilGnome, spawnGoldenGnome, spawnMole, spawnTreasureAt, spawnVisitorGnome, tiles, treasures, visitorGnomes } from './world.js';
import { mowPatternIsDark } from './render.js';
import { saveGame } from './save.js';
// ===== END AUTO-IMPORTS =====

/* ============================================================
   Robot AI, Bee AI, grass + flower income
   ============================================================ */

// Lawn-pedia: record a unique mowed grass species and toast on first cut.
// Skips index 0 ("Regular Grass") only if it had no key, but normal grass
// counts as a discovery the first time you mow anything — that's the carrot.
function pediaDiscoverSpecies(spec) {
  if (!spec || !spec.key || !state.pedia || !Array.isArray(state.pedia.species)) return;
  if (state.pedia.species.indexOf(spec.key) >= 0) return;
  state.pedia.species.push(spec.key);
  if (typeof toast === 'function') toast('📖 Discovered: ' + (spec.icon || '🌱') + ' ' + spec.name, '#c896ff');
}

// Does this robot prefer "dark" or "light" cells of the active pattern?
// Stable across calls (uses index in the fleet), so each robot sticks with
// one side of the pattern — that's what actually draws stripes/diagonals
// on the lawn instead of a uniform cut.
function robotPrefersDark(r) {
  const i = robots.indexOf(r);
  return (i & 1) === 0;
}

// Additive score nudge: matching tiles get a big bonus, non-matching tiles a
// smaller penalty. Multiplicative biases disappeared behind h*h/dist; additive
// bias keeps the pattern visible while still letting the bot switch sides
// when its preferred stripe is already cut short.
function patternScoreBonus(r, x, y) {
  const pat = state.activeMowPattern;
  if (!pat || pat === 'plain') return 0;
  const dark = mowPatternIsDark(x, y, pat);
  return dark === robotPrefersDark(r) ? 0.7 : -0.35;
}

function pickTarget(r) {
  const ts = tileSize;
  const cx = Math.floor(r.x / ts);
  const cy = Math.floor(r.y / ts);
  const searchR = 10;
  let best = null; let bestScore = -Infinity;
  for (let dy = -searchR; dy <= searchR; dy++) {
    for (let dx = -searchR; dx <= searchR; dx++) {
      const x = cx + dx, y = cy + dy;
      if (!inBounds(x, y)) continue;
      if (tiles[idx(x, y)] !== T.GRASS) continue;
      const h = grass[idx(x, y)];
      if (h < 0.2) continue;
      const dist = Math.hypot(dx, dy) + 0.1;
      const score = h * h / dist + patternScoreBonus(r, x, y) - Math.random() * 0.05;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  if (!best) {
    let bh = 0, bi = -1;
    for (let i = 0; i < grass.length; i++) {
      if (tiles[i] !== T.GRASS) continue;
      if (grass[i] > bh) { bh = grass[i]; bi = i; }
    }
    if (bi >= 0) best = { x: bi % CFG.gridW, y: Math.floor(bi / CFG.gridW) };
    else {
      for (let i = 0; i < 20; i++) {
        const rx = Math.floor(Math.random() * CFG.gridW);
        const ry = Math.floor(Math.random() * CFG.gridH);
        if (tiles[idx(rx, ry)] === T.GRASS) { best = { x: rx, y: ry }; break; }
      }
      if (!best) best = { x: cx, y: cy };
    }
  }
  r.target = best;
  r.lastTargetCheck = 0;
}

function obstacleRepulsion(px, py) {
  const ts = tileSize;
  const cx = Math.floor(px / ts), cy = Math.floor(py / ts);
  let ax = 0, ay = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx, y = cy + dy;
      if (!inBounds(x, y)) {
        const wx = Math.max(0, Math.min(CFG.gridW * ts, px));
        const wy = Math.max(0, Math.min(CFG.gridH * ts, py));
        const dX = px - wx, dY = py - wy;
        const d2 = dX*dX + dY*dY + 1;
        ax += dX / d2 * 500;
        ay += dY / d2 * 500;
        continue;
      }
      if (!OBSTACLE.has(tiles[idx(x, y)])) continue;
      const tcx = (x + 0.5) * ts, tcy = (y + 0.5) * ts;
      const dX = px - tcx, dY = py - tcy;
      const d = Math.hypot(dX, dY) + 0.001;
      if (d > ts * 1.8) continue;
      const strength = Math.pow((ts * 1.8 - d) / (ts * 1.8), 2);
      ax += (dX / d) * strength;
      ay += (dY / d) * strength;
    }
  }
  return { ax, ay };
}

function updateFuel(dt) {
  // Zen Mode: infinite fuel, no drain, no refueling needed.
  if (state.zenMode) { state.fuel = CFG.fuelMax; return; }
  const ft = activeFuelType();
  const net = (ft.recharge - fuelDrainRate()) * dt;
  state.fuel = Math.min(CFG.fuelMax, Math.max(0, state.fuel + net));
}

function updatePlayer(dt) {
  player.bladePhase += dt * 30;
  if (!player.active) return;
  const ts = tileSize;
  const rad = playerMowRadius();
  const rate = playerMowRate();
  const cellRad = Math.ceil(rad / ts) + 1;
  const ccx = Math.floor(player.x / ts);
  const ccy = Math.floor(player.y / ts);
  let mowedThisTick = 0;
  let critHit = false;
  let coinUnits = 0;
  for (let dy = -cellRad; dy <= cellRad; dy++) {
    for (let dx = -cellRad; dx <= cellRad; dx++) {
      const gx = ccx + dx, gy = ccy + dy;
      if (!inBounds(gx, gy)) continue;
      const k = idx(gx, gy);
      if (tiles[k] !== T.GRASS) continue;
      const tcx = (gx + 0.5) * ts, tcy = (gy + 0.5) * ts;
      const d = Math.hypot(tcx - player.x, tcy - player.y);
      if (d > rad) continue;
      const prev = grass[k];
      if (prev <= 0) continue;
      const spec = GRASS_TYPES[grassSpecies[k]] || GRASS_TYPES[0];
      const cut = Math.min(prev, (rate * dt * (1 - d / rad * 0.4)) / spec.toughness);
      grass[k] = Math.max(0, prev - cut);
      mowedThisTick += cut;
      coinUnits += cut * spec.coinMult;
      if (prev > 0.9 && grass[k] <= 0.9) { state.totalTilesMowed++; pediaDiscoverSpecies(spec); }
    }
  }
  if (mowedThisTick > 0) {
    player.lastMowed = performance.now();
    let coins = coinUnits * CFG.coinPerUnitBase * coinMult();
    if (Math.random() < critChance()) { coins *= critMult() + critCascadeBonus(); critHit = true; noteCritForCascade(); }
    state.coins += coins;
    state.totalEarnedAllTime += coins;
    state.totalEarnedThisRun += coins;
    if (Math.random() < 0.06 + (critHit ? 0.9 : 0)) {
      addParticle(player.x, player.y - 6, {
        text: (critHit ? 'CRIT! +' : '+') + formatShort(coins),
        color: critHit ? '#ff6bcf' : '#ffd34e',
        size: critHit ? 22 : 18,
      });
    }
  }
}

function updateRobot(r, dt) {
  if (r.dragging) {
    // While being dragged, animate blades/bob but skip AI, movement, and mowing.
    r.bladePhase += dt * 25;
    r.bob += dt * 10;
    return;
  }
  if (state.fuel <= 0) return;
  const ts = tileSize;
  if (!r.target) pickTarget(r);
  r.lastTargetCheck += dt;
  if (r.target) {
    const t = tiles[idx(r.target.x, r.target.y)];
    const th = grass[idx(r.target.x, r.target.y)];
    if (t !== T.GRASS || th < 0.1 || r.lastTargetCheck > CFG.targetRecheck) pickTarget(r);
  }
  if (!r.target) return;

  const tx = (r.target.x + 0.5) * ts;
  const ty = (r.target.y + 0.5) * ts;
  const dx = tx - r.x, dy = ty - r.y;
  const dist = Math.hypot(dx, dy);
  const seekX = dx / (dist + 0.001);
  const seekY = dy / (dist + 0.001);

  const rep = obstacleRepulsion(r.x, r.y);
  const avoidWeight = 2.8;
  let vx = seekX + rep.ax * avoidWeight;
  let vy = seekY + rep.ay * avoidWeight;
  const vmag = Math.hypot(vx, vy) + 0.001;
  vx /= vmag; vy /= vmag;

  const desiredAngle = Math.atan2(vy, vx);
  let angDiff = desiredAngle - r.angle;
  while (angDiff > Math.PI) angDiff -= 2 * Math.PI;
  while (angDiff < -Math.PI) angDiff += 2 * Math.PI;
  r.angle += angDiff * Math.min(1, dt * 10);

  const speed = robotSpeed() * (typeof rivalrySpeedBonus === 'function' ? rivalrySpeedBonus(r) : 1);
  if (dist > 2) {
    const nx = r.x + Math.cos(r.angle) * speed * dt;
    const ny = r.y + Math.sin(r.angle) * speed * dt;
    const tnx = Math.floor(nx / ts), tny = Math.floor(ny / ts);
    if (inBounds(tnx, tny) && !OBSTACLE.has(tiles[idx(tnx, tny)])) {
      r.x = nx; r.y = ny;
    } else {
      const tnx2 = Math.floor(nx / ts), tny2 = Math.floor(r.y / ts);
      if (inBounds(tnx2, tny2) && !OBSTACLE.has(tiles[idx(tnx2, tny2)])) r.x = nx;
      const tnx3 = Math.floor(r.x / ts), tny3 = Math.floor(ny / ts);
      if (inBounds(tnx3, tny3) && !OBSTACLE.has(tiles[idx(tnx3, tny3)])) r.y = ny;
    }
  }

  r.bladePhase += dt * 25;
  r.bob += dt * 10;

  // Mow
  const rad = mowRadius();
  const rate = mowRate();
  const cellRad = Math.ceil(rad / ts) + 1;
  const ccx = Math.floor(r.x / ts);
  const ccy = Math.floor(r.y / ts);
  let mowedThisTick = 0;
  let coinUnits = 0;
  let critHit = false;
  for (let dy2 = -cellRad; dy2 <= cellRad; dy2++) {
    for (let dx2 = -cellRad; dx2 <= cellRad; dx2++) {
      const gx = ccx + dx2, gy = ccy + dy2;
      if (!inBounds(gx, gy)) continue;
      const k = idx(gx, gy);
      if (tiles[k] !== T.GRASS) continue;
      const tcx = (gx + 0.5) * ts, tcy = (gy + 0.5) * ts;
      const d = Math.hypot(tcx - r.x, tcy - r.y);
      if (d > rad) continue;
      const prev = grass[k];
      if (prev <= 0) continue;
      const spec = GRASS_TYPES[grassSpecies[k]] || GRASS_TYPES[0];
      const cut = Math.min(prev, (rate * dt * (1 - d / rad * 0.4)) / spec.toughness);
      grass[k] = Math.max(0, prev - cut);
      mowedThisTick += cut;
      coinUnits += cut * spec.coinMult;
      if (prev > 0.9 && grass[k] <= 0.9) { state.totalTilesMowed++; pediaDiscoverSpecies(spec); }
    }
  }
  if (mowedThisTick > 0) {
    let coins = coinUnits * CFG.coinPerUnitBase * coinMult();
    if (Math.random() < critChance()) { coins *= critMult() + critCascadeBonus(); critHit = true; noteCritForCascade(); }
    state.coins += coins;
    state.totalEarnedAllTime += coins;
    state.totalEarnedThisRun += coins;
    if (typeof trackRivalryEarnings === 'function') trackRivalryEarnings(r, coins);
    if (Math.random() < 0.04 + (critHit ? 0.9 : 0)) {
      addParticle(r.x, r.y - 4, {
        text: (critHit ? 'CRIT! +' : '+') + formatShort(coins),
        color: critHit ? '#ff6bcf' : '#ffd34e',
        size: critHit ? 22 : 18,
      });
    }
  }
}

// ---------- Bee AI ----------
function pickBeeTarget(b) {
  const flowerIdxs = [];
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === T.FLOWER) flowerIdxs.push(i);
  const ts = tileSize;
  if (flowerIdxs.length === 0) {
    const angle = Math.random() * Math.PI * 2;
    const radius = ts * 1.2 + Math.random() * ts;
    b.target = {
      x: (b.homeX + 0.5) * ts + Math.cos(angle) * radius,
      y: (b.homeY + 0.5) * ts + Math.sin(angle) * radius,
      tx: -1, ty: -1,
    };
    return;
  }
  const pick = flowerIdxs[Math.floor(Math.random() * flowerIdxs.length)];
  const fx = pick % CFG.gridW, fy = Math.floor(pick / CFG.gridW);
  b.target = { x: (fx + 0.5) * ts, y: (fy + 0.5) * ts, tx: fx, ty: fy };
}

function updateBee(b, dt) {
  b.wingPhase += dt * 28;
  b.jitter += dt;
  // Rain/snow/storm: bees retreat to the hive and hide. They stop flying and
  // don't generate pollination rewards.
  if (typeof beesAreActive === 'function' && !beesAreActive()) {
    const ts = tileSize;
    const homeX = (b.homeX + 0.5) * ts;
    const homeY = (b.homeY + 0.5) * ts;
    const dx = homeX - b.x, dy = homeY - b.y;
    const d = Math.hypot(dx, dy);
    if (d > 2) {
      b.x += (dx / d) * CFG.beeSpeed * 0.7 * dt;
      b.y += (dy / d) * CFG.beeSpeed * 0.7 * dt;
      b.angle = Math.atan2(dy, dx);
    }
    b.state = 'flying'; // don't count a visit toward coins
    b.stateTime = 0;
    b.target = null;
    return;
  }
  if (!b.target) pickBeeTarget(b);
  const t = b.target;
  const ts = tileSize;
  if (b.state === 'flying') {
    const jx = Math.sin(b.jitter * 6) * 4;
    const jy = Math.cos(b.jitter * 7) * 4;
    const dx = (t.x + jx) - b.x, dy = (t.y + jy) - b.y;
    const dist = Math.hypot(dx, dy);
    b.angle = Math.atan2(dy, dx);
    if (dist < 4) {
      b.state = 'visiting';
      b.stateTime = 0;
    } else {
      b.x += (dx / dist) * CFG.beeSpeed * dt;
      b.y += (dy / dist) * CFG.beeSpeed * dt;
    }
  } else {
    b.stateTime += dt;
    b.x += Math.sin(b.stateTime * 12) * 0.2;
    b.y += Math.cos(b.stateTime * 14) * 0.15;
    if (b.stateTime > CFG.beeVisitDuration) {
      if (t.tx >= 0 && tiles[idx(t.tx, t.ty)] === T.FLOWER) {
        const coins = CFG.beeRewardPerVisit * coinMult();
        state.coins += coins;
        state.totalEarnedAllTime += coins;
        state.totalEarnedThisRun += coins;
        if (Math.random() < 0.35) addParticle(b.x, b.y - 4, { text: '+' + formatShort(coins), color: '#fff4a8', size: 16 });
        beep(900 + Math.random() * 400, 0.02, 'triangle', 0.015);
      }
      b.state = 'flying';
      pickBeeTarget(b);
    }
  }
}

// ---------- Grass + Flower income ----------
// Grass growth is sampled in chunks rather than every cell every tick.
// On the max-expanded 144×90 grid the full-array walk is ~13k cells at
// 60Hz = 780k iterations/s just to advance a float. Chunking reduces this
// to ~130k/s while preserving the observed growth rate: each cell is
// visited once every GRASS_CHUNKS ticks, and the applied rate is scaled by
// GRASS_CHUNKS so the per-second growth matches the old behavior exactly.
const GRASS_CHUNKS = 6;
let _grassChunk = 0;
function updateGrass(dt) {
  const rate = growthRate() * dt * GRASS_CHUNKS;
  const n = grass.length;
  const chunk = _grassChunk;
  _grassChunk = (chunk + 1) % GRASS_CHUNKS;
  // Visit every cell where (i % GRASS_CHUNKS) === chunk this tick.
  for (let i = chunk; i < n; i += GRASS_CHUNKS) {
    if (tiles[i] !== T.GRASS) { grass[i] = 0; continue; }
    const h = grass[i];
    if (h < 1.0) grass[i] = Math.min(1.0, h + rate * (1 - h * 0.6));
  }
}

// ---------- Neighbor quests ----------
function updateQuestTimer(dt) {
  if (state.zenMode) return; // Zen is a peaceful screensaver — no quests.
  if (state.activeQuest) { updateActiveQuest(dt); return; }
  if (document.querySelector('.quest-offer')) return; // modal already up
  state.questTimer -= dt;
  if (state.questTimer <= 0) {
    offerNeighborQuest();
    state.questTimer = CFG.neighborSpawnMin + Math.random() * (CFG.neighborSpawnMax - CFG.neighborSpawnMin);
  }
}

function offerNeighborQuest() {
  const tpl = QUEST_TYPES[Math.floor(Math.random() * QUEST_TYPES.length)];
  const goal = tpl.genGoal();
  const neighbor = NEIGHBOR_NAMES[Math.floor(Math.random() * NEIGHBOR_NAMES.length)];
  const flavor = tpl.flavor[Math.floor(Math.random() * tpl.flavor.length)];
  const quest = {
    id: tpl.id,
    neighbor,
    flavor,
    title: tpl.title(goal),
    goal,
    duration: tpl.duration,
    elapsed: 0,
    reward: tpl.reward(goal),
    rewardType: tpl.rewardType,
    startVal: tpl.getStart(),
  };
  showQuestOfferModal(quest);
}

function updateActiveQuest(dt) {
  const q = state.activeQuest;
  if (!q) return;
  q.elapsed += dt;
  const tpl = QUEST_BY_ID[q.id];
  if (!tpl) { state.activeQuest = null; return; }
  const progress = tpl.getDelta(q);
  if (progress >= q.goal) completeQuest();
  else if (q.elapsed >= q.duration) failQuest();
}

function recordQuest(q, outcome) {
  if (!Array.isArray(state.questHistory)) state.questHistory = [];
  state.questHistory.unshift({
    neighbor: q.neighbor,
    title: q.title,
    rewardType: q.rewardType,
    reward: q.reward,
    outcome,
    ts: Date.now(),
  });
  if (state.questHistory.length > QUEST_HISTORY_MAX) state.questHistory.length = QUEST_HISTORY_MAX;
}

function completeQuest() {
  const q = state.activeQuest;
  if (q.rewardType === 'gems') {
    state.gems += q.reward;
    toast(`🎉 ${q.neighbor} pays up: +${q.reward} 💎`, '#72f2ff');
  } else {
    state.coins += q.reward;
    state.totalEarnedAllTime += q.reward;
    state.totalEarnedThisRun += q.reward;
    toast(`🎉 ${q.neighbor} pays up: +${formatShort(q.reward)} 💰`, '#8ff09e');
  }
  state.questsCompleted = (state.questsCompleted || 0) + 1;
  recordQuest(q, 'success');
  beep(880, 0.12, 'triangle', 0.1);
  setTimeout(() => beep(1320, 0.18, 'triangle', 0.08), 120);
  state.activeQuest = null;
  state.questTimer = CFG.neighborSpawnMin + Math.random() * (CFG.neighborSpawnMax - CFG.neighborSpawnMin);
  saveGame();
}

function failQuest() {
  const q = state.activeQuest;
  toast(`😞 ${q.neighbor} walks away disappointed`, '#ffb4b4');
  beep(200, 0.15, 'square', 0.05);
  recordQuest(q, 'failed');
  state.activeQuest = null;
  state.questTimer = CFG.neighborSpawnMin + Math.random() * (CFG.neighborSpawnMax - CFG.neighborSpawnMin);
}

// ---------- Visitor Gnome + Treasure AI ----------
function updateGnomeSpawnTimer(dt) {
  if ((state.garden.gnome || 0) <= 0) return;
  state.gnomeTimer -= dt;
  if (state.gnomeTimer <= 0) {
    if (visitorGnomes.length < 2) {
      // 25% roll for an evil gnome, but only if there's actually a treasure
      // on the ground to steal — otherwise fall through to a normal gnome.
      if (treasures.length > 0 && Math.random() < 0.25) spawnEvilGnome();
      else spawnVisitorGnome();
    }
    const mult = gnomeSpawnIntervalMult();
    state.gnomeTimer = (CFG.gnomeSpawnMin + Math.random() * (CFG.gnomeSpawnMax - CFG.gnomeSpawnMin)) * mult;
  }
}

function updateVisitorGnome(g, dt) {
  const ts = tileSize;
  const speed = CFG.gnomeWalkSpeed * (g.evil ? 1.15 : 1);
  const moveTo = (tx, ty) => {
    const dx = tx - g.x, dy = ty - g.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) return true;
    const step = Math.min(dist, speed * dt);
    g.x += (dx / dist) * step;
    g.y += (dy / dist) * step;
    if (Math.abs(dx) > 0.5) g.facing = dx > 0 ? 1 : -1;
    return false;
  };

  if (g.evil) { updateEvilGnome(g, dt, moveTo); return; }

  if (g.state === 'walking') {
    g.walkPhase += dt * 9;
    if (moveTo(g.targetX, g.targetY)) {
      g.state = 'digging';
      g.stateTime = 0;
    }
  } else if (g.state === 'digging') {
    g.stateTime += dt;
    g.walkPhase += dt * 3;
    // Drop a treasure halfway through the dig
    if (!g.hasDropped && g.stateTime > CFG.gnomeDigDuration * 0.55) {
      spawnTreasureAt(g.digCell.x, g.digCell.y);
      g.hasDropped = true;
      const cx = (g.digCell.x + 0.5) * ts;
      const cy = (g.digCell.y + 0.5) * ts;
      for (let i = 0; i < 6; i++) {
        addParticle(cx + (Math.random() - 0.5) * ts, cy - 2, {
          text: '·', color: '#8b5a2b', size: 10 + Math.random() * 6,
        });
      }
      playGnomeGiggle();
      toast('🧙 A gnome hid something in the garden!', '#c6a8ff');
    }
    if (g.stateTime > CFG.gnomeDigDuration) {
      g.state = 'leaving';
      g.stateTime = 0;
    }
  } else if (g.state === 'leaving') {
    g.walkPhase += dt * 10;
    if (moveTo(g.exitX, g.exitY)) {
      g.state = 'gone';
    }
  }
}

// Evil gnome behaviour: chase down the targeted treasure, grab it, flee.
// If the treasure is already gone (collected/expired) when the gnome arrives,
// it gives up and leaves empty-handed.
function updateEvilGnome(g, dt, moveTo) {
  const findTarget = () => treasures.find(t => t.tileX === g.targetTileX && t.tileY === g.targetTileY);
  if (g.state === 'walking') {
    g.walkPhase += dt * 11;
    const target = findTarget();
    if (!target) {
      // Treasure already collected — sulk and leave.
      g.state = 'leaving';
      g.stateTime = 0;
      return;
    }
    // Keep tracking the treasure position in case it moves (it doesn't today
    // but keeps the gnome aimed at the exact tile centre).
    g.targetX = target.x; g.targetY = target.y;
    if (moveTo(g.targetX, g.targetY)) {
      g.state = 'stealing';
      g.stateTime = 0;
    }
  } else if (g.state === 'stealing') {
    g.stateTime += dt;
    g.walkPhase += dt * 4;
    if (!g.hasStolen && g.stateTime > 0.35) {
      const idx = treasures.findIndex(t => t.tileX === g.targetTileX && t.tileY === g.targetTileY);
      if (idx >= 0) {
        const stolen = treasures.splice(idx, 1)[0];
        g.hasStolen = true;
        g.stolenType = stolen.type;
        if (typeof addParticle === 'function') {
          addParticle(stolen.x, stolen.y - 6, {
            text: '👿 MINE!', color: '#ff6bcf', size: 16, gravity: -30,
          });
          for (let i = 0; i < 10; i++) {
            addParticle(stolen.x + (Math.random() - 0.5) * 14, stolen.y + (Math.random() - 0.5) * 10, {
              text: '✦', color: '#ff4e7a', size: 10 + Math.random() * 4, gravity: -10,
            });
          }
        }
        if (typeof toast === 'function') toast(`💢 ${g.name} snatched a ${stolen.type === 'skin' ? 'skin chest' : stolen.type === 'pattern' ? 'pattern chest' : 'coin chest'}!`, '#ff8fa0');
        if (typeof beep === 'function') {
          beep(220, 0.08, 'sawtooth', 0.06);
          setTimeout(() => beep(160, 0.12, 'sawtooth', 0.05), 80);
        }
      } else {
        // Disappeared mid-grab (rare). Abandon.
        g.state = 'leaving';
        g.stateTime = 0;
        return;
      }
    }
    if (g.stateTime > 0.9) {
      g.state = 'leaving';
      g.stateTime = 0;
    }
  } else if (g.state === 'leaving') {
    g.walkPhase += dt * 12;
    if (moveTo(g.exitX, g.exitY)) {
      g.state = 'gone';
    }
  }
}

function updateVisitorGnomes(dt) {
  for (let i = visitorGnomes.length - 1; i >= 0; i--) {
    updateVisitorGnome(visitorGnomes[i], dt);
    if (visitorGnomes[i].state === 'gone') visitorGnomes.splice(i, 1);
  }
}

function updateTreasures(dt) {
  for (let i = treasures.length - 1; i >= 0; i--) {
    const t = treasures[i];
    t.life -= dt;
    t.born += dt;
    t.phase += dt;
    if (t.life <= 0) {
      treasures.splice(i, 1);
      continue;
    }
    // Sparkles
    if (Math.random() < 0.12) {
      addParticle(t.x + (Math.random() - 0.5) * tileSize * 0.9,
                  t.y - tileSize * 0.25 + (Math.random() - 0.5) * 4, {
        text: '✦', color: t.type === 'skin' ? '#ff6bcf' : '#ffd34e',
        size: t.type === 'skin' ? 11 : 9, gravity: -20,
      });
    }
  }
}

function updateCrew(dt) {
  // Auto-refueler
  if (hasCrew('autoRefuel') && !isElectric()) {
    const pct = state.fuel / CFG.fuelMax;
    if (pct < 0.25) {
      const cost = fuelRefillCost();
      if (state.coins >= cost) {
        state.coins -= cost;
        state.fuel = CFG.fuelMax;
        beep(380, 0.05, 'sine', 0.04);
        addParticle(canvas.width * 0.5, 24, {
          text: '⛽ Auto-refueled', color: '#ff9f1c', size: 13, gravity: 40,
        });
      }
    }
  }
  // Treasure scout
  if (hasCrew('scout')) {
    for (let i = treasures.length - 1; i >= 0; i--) {
      const t = treasures[i];
      if (t.born > CFG.scoutAutoDelay) {
        collectTreasureIndex(i, true);
      }
    }
  }
}

// ---------- Moles ----------
function nextMoleInterval() {
  const mult = (typeof moleSpawnIntervalMult === 'function') ? moleSpawnIntervalMult() : 1;
  return (CFG.moleSpawnMin + Math.random() * (CFG.moleSpawnMax - CFG.moleSpawnMin)) * mult;
}
let moleSpawnTimer = nextMoleInterval();

function updateMoles(dt) {
  moleSpawnTimer -= dt;
  if (moleSpawnTimer <= 0) {
    spawnMole();
    moleSpawnTimer = nextMoleInterval();
  }
  for (let i = moles.length - 1; i >= 0; i--) {
    const m = moles[i];
    m.life -= dt;
    m.phase += dt;
    m.peekPhase += dt * 2.5;
    if (m.life <= 0) {
      despawnMole(m);
      moles.splice(i, 1);
    }
  }
}

let flowerIncomeAccum = 0;
function updateFlowerIncome(dt) {
  const flowers = state.garden.flower;
  if (flowers <= 0) return;
  const wMult = typeof weatherFlowerMult === 'function' ? weatherFlowerMult() : 1;
  if (wMult <= 0) return; // snow (heavy) can pause flower income entirely
  const perSec = flowers * CFG.flowerCoinPerSec * coinMult() * wMult;
  const earned = perSec * dt;
  state.coins += earned;
  state.totalEarnedAllTime += earned;
  state.totalEarnedThisRun += earned;
  flowerIncomeAccum += earned;
  if (flowerIncomeAccum > 5) {
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] === T.FLOWER && Math.random() < 0.02) {
        const fx = i % CFG.gridW, fy = Math.floor(i / CFG.gridW);
        const ts = tileSize;
        addParticle((fx + 0.5) * ts, (fy + 0.2) * ts, { text: '+' + formatShort(flowerIncomeAccum), color: '#ffb6ef', size: 16 });
        flowerIncomeAccum = 0;
        break;
      }
    }
    if (flowerIncomeAccum > 20) flowerIncomeAccum = 0;
  }
}

// Bookkeeper crew member: every 3s buys the cheapest affordable Bot/Tool
// upgrade. Driven from the main loop so it ticks even while the shop is on
// another tab. No-op without the crew node or with the toggle disabled.
function updateAutoBuy(dt) {
  if (!hasCrew('accountant')) return;
  if (!getSetting('autoBuyer')) return;
  state.autoBuyTimer = (state.autoBuyTimer || 0) - dt;
  if (state.autoBuyTimer > 0) return;
  state.autoBuyTimer = techAutoBuyInterval();
  autoBuyCheapest();
}

// ---------- Golden Gnomes (rare clickable buff spawns) ----------
function updateGoldenGnomes(dt) {
  // Don't spawn during Zen / storms / night-time. Active gnomes still tick down
  // so a daylight-spawned one finishes its life cleanly if dusk arrives.
  const w = (typeof activeWeather === 'function') ? activeWeather() : null;
  const time = state.timeOfDay || 12;
  const blockSpawn = state.zenMode
    || (w && w.id === 'storm')
    || time < 5 || time >= 21;

  if (!blockSpawn) {
    if (!isFinite(state.goldenGnomeTimer)) state.goldenGnomeTimer = 60 + Math.random() * 60;
    state.goldenGnomeTimer -= dt;
    if (state.goldenGnomeTimer <= 0) {
      if (goldenGnomes.length === 0) spawnGoldenGnome();
      const keenBoost = hasCrew('keenEye') ? (1 / 1.5) : 1;
      state.goldenGnomeTimer = (300 + Math.random() * 240) * keenBoost / techGoldenGnomeMult();
    }
  }

  // Update existing gnomes regardless of spawn gating.
  if (goldenGnomes.length === 0) return;
  const W = canvas.width, H = canvas.height;
  for (let i = goldenGnomes.length - 1; i >= 0; i--) {
    const g = goldenGnomes[i];
    g.life -= dt;
    g.pulse += dt * 4;
    g.x += g.vx * dt * 30;
    g.y += g.vy * dt * 30;
    if (g.x < tileSize * 0.5)        { g.x = tileSize * 0.5;        g.vx = Math.abs(g.vx); }
    if (g.x > W - tileSize * 0.5)    { g.x = W - tileSize * 0.5;    g.vx = -Math.abs(g.vx); }
    if (g.y < tileSize * 0.5)        { g.y = tileSize * 0.5;        g.vy = Math.abs(g.vy); }
    if (g.y > H - tileSize * 0.5)    { g.y = H - tileSize * 0.5;    g.vy = -Math.abs(g.vy); }
    if (g.life <= 0) {
      goldenGnomes.splice(i, 1);
      if (typeof toast === 'function') toast('✨ A golden gnome scurried away...', '#aab0c0');
    }
  }
}

// ---------- Active buff timers ----------
function updateBuffs(dt) {
  if (!Array.isArray(state.activeBuffs) || state.activeBuffs.length === 0) return;
  for (let i = state.activeBuffs.length - 1; i >= 0; i--) {
    const b = state.activeBuffs[i];
    b.expires -= dt;
    if (b.expires <= 0) {
      state.activeBuffs.splice(i, 1);
      if (typeof toast === 'function') toast(`${b.icon || '⏳'} ${b.name} expired`, '#aab0c0');
    }
  }
}

// ===== AUTO-EXPORTS =====
export { updateAutoBuy, updateBee, updateBuffs, updateCrew, updateFlowerIncome, updateFuel, updateGnomeSpawnTimer, updateGoldenGnomes, updateGrass, updateMoles, updatePlayer, updateQuestTimer, updateRobot, updateTreasures, updateVisitorGnomes };
