// ===== AUTO-IMPORTS =====
import { Assets } from './assets.js';
import { SAVE_KEY, loadGame, saveGame } from './save.js';
import { TOOL_TYPES, applyMapDimensions, decayCritCascade, gemLvl, startingCoinsFor, state } from './state.js';
import { applyThemeDom } from './themes.js';
import { bees, ensureBeesFromHives, ensureRobotCount, initWorld, robots } from './world.js';
import { checkAchievements, iconizeStaticHUD, renderShop, toast, updateHUD, wireUIEvents } from './ui.js';
import { render } from './render.js';
import { resizeCanvas } from './canvas.js';
import { updateAutoBuy, updateBee, updateBuffs, updateCrew, updateFlowerIncome, updateFuel, updateGnomeSpawnTimer, updateGoldenGnomes, updateGrass, updateMoles, updatePlayer, updateQuestTimer, updateRobot, updateTreasures, updateVisitorGnomes } from './ai.js';
import { updateDayNight, updateRivalry, updateWeather } from './atmosphere.js';
import { updateEvents } from './events.js';
// ===== END AUTO-IMPORTS =====

/* ============================================================
   Main loop + init
   ============================================================ */

let lastFrame = performance.now();
let accumulator = 0;
const TICK = 1 / 60;
// Throttle HUD DOM updates — values change at most a few times per second,
// but the loop runs at 60Hz. 10Hz is imperceptible and saves ~50 DOM touches/sec.
const HUD_INTERVAL = 0.1; // seconds
let hudAccum = 0;
// Render FPS cap. Sim still runs at 60Hz (via the TICK accumulator) but the
// visible canvas only needs ~30fps for smooth-looking robot motion — the
// grass field + features are near-static. This halves GPU/CPU time spent in
// render() on a battery-powered device, with no perceptible motion loss.
const RENDER_INTERVAL = 1 / 30;
let renderAccum = 0;
// When the tab is hidden the browser already throttles rAF to ~1Hz, but we
// still want to drain accumulated sim time (offline progress is handled at
// load; here we just avoid wasting cycles on canvas/DOM while backgrounded).
let wasHidden = false;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  // Skip all sim+render while hidden. rAF is heavily throttled when hidden
  // (~1Hz), so letting ticks accumulate would spike CPU on tab-refocus.
  // Resetting accumulator on focus matches how real idle time is collected
  // separately by the save system.
  if (document.hidden) {
    wasHidden = true;
    accumulator = 0;
    hudAccum = 0;
    return;
  }
  if (wasHidden) {
    wasHidden = false;
    accumulator = 0; // don't burn CPU catching up after a hidden gap
  }

  accumulator += dt;
  while (accumulator >= TICK) {
    updateDayNight(TICK);
    updateWeather(TICK);
    updateGrass(TICK);
    updateFlowerIncome(TICK);
    updateFuel(TICK);
    updatePlayer(TICK);
    for (const r of robots) updateRobot(r, TICK);
    for (const b of bees) updateBee(b, TICK);
    updateRivalry(TICK);
    updateQuestTimer(TICK);
    updateGnomeSpawnTimer(TICK);
    updateVisitorGnomes(TICK);
    updateTreasures(TICK);
    updateMoles(TICK);
    updateGoldenGnomes(TICK);
    updateBuffs(TICK);
    updateCrew(TICK);
    updateAutoBuy(TICK);
    decayCritCascade(TICK);
    updateEvents(TICK);
    accumulator -= TICK;
  }
  // FPS-capped render. Sim is frame-independent via the fixed-step
  // accumulator above, so throttling render has no gameplay effect.
  renderAccum += dt;
  if (renderAccum >= RENDER_INTERVAL) {
    renderAccum -= RENDER_INTERVAL;
    // Don't let renderAccum grow unbounded after a slow frame — it would
    // cause a burst of render calls to catch up, defeating the cap.
    if (renderAccum > RENDER_INTERVAL) renderAccum = 0;
    render();
  }
  hudAccum += dt;
  if (hudAccum >= HUD_INTERVAL) {
    hudAccum = 0;
    updateHUD();
  }
}

function init() {
  const loaded = loadGame();
  resizeCanvas();
  if (!loaded) {
    applyMapDimensions();
    initWorld();
    // Fresh run: apply starting bonuses from permanent gem upgrades.
    state.coins = startingCoinsFor(gemLvl('startCoins'));
    state.upgrades.robots = 1 + gemLvl('startRobot');
    state.upgrades.tool = Math.min(gemLvl('startTool'), TOOL_TYPES.length - 1);
  }
  ensureRobotCount();
  if (state._savedRobots) {
    const sr = state._savedRobots;
    for (let i = 0; i < Math.min(robots.length, sr.length); i++) {
      robots[i].x = sr[i][0]; robots[i].y = sr[i][1]; robots[i].angle = sr[i][2];
    if (sr[i][3]) robots[i].name = sr[i][3];
    }
    delete state._savedRobots;
  }
  ensureBeesFromHives();
  applyThemeDom();
  const muteBtn = document.getElementById('muteBtn');
  muteBtn.textContent = state.muted ? '🔇 Muted' : '🔊 Sound';
  wireUIEvents();
  renderShop();
  // Shop + achievements: skip while hidden (browsers already throttle
  // setInterval to ~1Hz when hidden, but a cheap guard is still worth it
  // because renderShop touches a lot of DOM).
  setInterval(() => {
    if (document.hidden) return;
    renderShop();
    checkAchievements();
  }, 500);
  setInterval(saveGame, 5000);
  window.addEventListener('beforeunload', saveGame);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });
  if (!localStorage.getItem(SAVE_KEY)) {
    setTimeout(() => toast('🤖 Welcome, CEO! Let the mowing begin.', '#8ff09e'), 300);
  }
  // Preload sprites in the background. Render code null-checks, so the loop
  // can start immediately; sprites pop in as they finish decoding. If the
  // sprite flag is off the preloaded images sit idle and cost nothing.
  // When decoding finishes we iconize the static HUD and force a shop
  // repaint so the first frame doesn't flash emoji-then-sprite.
  Assets.preloadAll().then(() => {
    iconizeStaticHUD();
    renderShop();
    updateHUD();
  }).catch(() => {});
  requestAnimationFrame(loop);
}

init();