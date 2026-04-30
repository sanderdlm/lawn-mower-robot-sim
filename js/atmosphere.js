// ===== AUTO-IMPORTS =====
import { addParticle, beep, canvas, ctx } from './canvas.js';
import { robots } from './world.js';
import { state } from './state.js';
import { toast } from './ui.js';
// ===== END AUTO-IMPORTS =====

/* ============================================================
   Atmosphere — day/night cycle, weather, robot rivalry
   ============================================================ */

// ---------- Day / night ----------
// state.timeOfDay is a float 0..24. Advances automatically in 'auto' mode;
// can be pinned to a preset hour via (state.settings && state.settings.dayNight). 'off' disables the
// overlay entirely (always bright noon).
const DAY_NIGHT_CYCLE_LENGTH = 300; // seconds for one full 24h loop
const DAY_TIME_PRESETS = {
  auto:  { advance: true,  hour: null, label: 'Cycle' },
  off:   { advance: false, hour: 12,   label: 'No overlay' },
  dawn:  { advance: false, hour: 6,    label: 'Dawn' },
  day:   { advance: false, hour: 12,   label: 'Day' },
  dusk:  { advance: false, hour: 18,   label: 'Dusk' },
  night: { advance: false, hour: 22,   label: 'Night' },
};
const DAY_TIME_KEYS = ['auto', 'dawn', 'day', 'dusk', 'night', 'off'];

// Pre-generated starfield in normalized coords. Shared across themes because
// stars twinkle above the canvas regardless of biome palette.
const STARS = (() => {
  const out = [];
  for (let i = 0; i < 50; i++) {
    out.push({
      x: Math.random(),
      y: Math.random() * 0.65,
      size: 0.6 + Math.random() * 1.6,
      phase: Math.random() * Math.PI * 2,
    });
  }
  return out;
})();

function updateDayNight(dt) {
  const mode = (state.settings && state.settings.dayNight) || 'auto';
  const preset = DAY_TIME_PRESETS[mode] || DAY_TIME_PRESETS.auto;
  if (preset.advance) {
    const speed = 24 / DAY_NIGHT_CYCLE_LENGTH;
    state.timeOfDay = (state.timeOfDay + dt * speed) % 24;
  } else if (preset.hour != null) {
    state.timeOfDay = preset.hour;
  }
}

// Returns an overlay color + star alpha for the current time of day. Uses
// short piecewise mixes between four anchors: darkNight, dawn, day, dusk.
function dayNightShade() {
  const mode = (state.settings && state.settings.dayNight) || 'auto';
  if (mode === 'off') return { col: { r: 0, g: 0, b: 0, a: 0 }, starsAlpha: 0 };
  const t = state.timeOfDay;
  const darkNight = { r: 20,  g: 30,  b: 80,  a: 0.52 };
  const dusk      = { r: 250, g: 120, b: 70,  a: 0.22 };
  const dawn      = { r: 255, g: 180, b: 140, a: 0.18 };
  const day       = { r: 0,   g: 0,   b: 0,   a: 0    };
  const mix = (a, b, k) => ({
    r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k, a: a.a + (b.a - a.a) * k,
  });
  let col;
  if      (t < 5)  col = darkNight;
  else if (t < 7)  col = mix(darkNight, dawn, (t - 5) / 2);
  else if (t < 9)  col = mix(dawn, day, (t - 7) / 2);
  else if (t < 16) col = day;
  else if (t < 18) col = mix(day, dusk, (t - 16) / 2);
  else if (t < 20) col = mix(dusk, darkNight, (t - 18) / 2);
  else             col = darkNight;
  // Stars: fade in 18->20, full 20->5, fade out 5->7.
  let starsAlpha = 0;
  if      (t >= 20 || t < 5) starsAlpha = 1;
  else if (t >= 18 && t < 20) starsAlpha = (t - 18) / 2;
  else if (t >= 5  && t < 7)  starsAlpha = 1 - (t - 5) / 2;
  return { col, starsAlpha };
}

function drawDayNightOverlay() {
  const mode = (state.settings && state.settings.dayNight) || 'auto';
  if (mode === 'off') return;
  const { col, starsAlpha } = dayNightShade();
  if (col.a > 0.002) {
    ctx.fillStyle = `rgba(${col.r|0},${col.g|0},${col.b|0},${col.a.toFixed(3)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (starsAlpha > 0.01) {
    const now = performance.now() / 1000;
    for (const s of STARS) {
      const tw = 0.55 + 0.45 * Math.sin(now * 2 + s.phase);
      ctx.fillStyle = `rgba(255,245,210,${(starsAlpha * tw).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x * canvas.width, s.y * canvas.height, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---------- Weather ----------
const WEATHER_TYPES = [
  { id: 'clear', name: 'Clear',  icon: '☀️', weight: 55, minDur: 80, maxDur: 180,
    growthMult: 1.0,  speedMult: 1.0, flowerMult: 1.0, beesFly: true  },
  { id: 'rain',  name: 'Rain',   icon: '🌧️', weight: 22, minDur: 60, maxDur: 120,
    growthMult: 1.50, speedMult: 1.0, flowerMult: 1.0, beesFly: false },
  { id: 'snow',  name: 'Snow',   icon: '❄️', weight: 10, minDur: 50, maxDur: 100,
    growthMult: 0.4,  speedMult: 0.7, flowerMult: 0.2, beesFly: false },
  { id: 'storm', name: 'Storm',  icon: '⛈️', weight: 6,  minDur: 30, maxDur: 70,
    growthMult: 1.6,  speedMult: 0.6, flowerMult: 0.5, beesFly: false },
  { id: 'fog',   name: 'Fog',    icon: '🌫️', weight: 7,  minDur: 60, maxDur: 140,
    growthMult: 1.05, speedMult: 0.9, flowerMult: 1.0, beesFly: true  },
];
const WEATHER_BY_ID = Object.fromEntries(WEATHER_TYPES.map(w => [w.id, w]));
const WEATHER_KEYS = ['auto', ...WEATHER_TYPES.map(w => w.id)];
// Synthetic "no overlay" mode: economy behaves like clear, but nothing renders.
const WEATHER_NONE = { id: 'none', name: 'No overlay', icon: '🚫',
  growthMult: 1.0, speedMult: 1.0, flowerMult: 1.0, beesFly: true };

function activeWeather() {
  const mode = (state.settings && state.settings.weather) || 'auto';
  if (mode === 'off') return WEATHER_NONE;
  if (mode !== 'auto' && WEATHER_BY_ID[mode]) return WEATHER_BY_ID[mode];
  return WEATHER_BY_ID[state.weather && state.weather.id] || WEATHER_TYPES[0];
}
function weatherGrowthMult() { return activeWeather().growthMult; }
function weatherSpeedMult()  { return activeWeather().speedMult; }
function weatherFlowerMult() { return activeWeather().flowerMult; }
function beesAreActive()     { return activeWeather().beesFly; }

function rollNextWeather() {
  const total = WEATHER_TYPES.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * total;
  for (const w of WEATHER_TYPES) { r -= w.weight; if (r <= 0) return w; }
  return WEATHER_TYPES[0];
}

function updateWeather(dt) {
  if (!state.weather) state.weather = { id: 'clear', intensity: 0, cycleTimer: 120 };
  // Lawn-pedia: track total seconds endured per weather id (incl. 'clear').
  if (state.pedia && state.pedia.weather) {
    const id = state.weather.id;
    state.pedia.weather[id] = (state.pedia.weather[id] || 0) + dt;
  }
  const mode = (state.settings && state.settings.weather) || 'auto';
  // "No overlay": fade any lingering effect to 0 and freeze the cycle.
  if (mode === 'off') {
    state.weather.intensity = Math.max(0, state.weather.intensity - dt * 0.6);
    state.weather.cycleTimer = 120;
    return;
  }
  // Manual override: lock to chosen weather and keep fading in.
  if (mode !== 'auto' && WEATHER_BY_ID[mode]) {
    if (state.weather.id !== mode) state.weather.intensity = 0;
    state.weather.id = mode;
    state.weather.intensity = Math.min(1, state.weather.intensity + dt * 0.6);
    state.weather.cycleTimer = 120;
    return;
  }
  // Auto cycle: fade in 4s, stay, fade out in last 4s, then pick next.
  const w = WEATHER_BY_ID[state.weather.id] || WEATHER_TYPES[0];
  const remaining = state.weather.cycleTimer;
  if (remaining > 4) {
    state.weather.intensity = Math.min(1, state.weather.intensity + dt * 0.35);
  } else {
    state.weather.intensity = Math.max(0, state.weather.intensity - dt * 0.35);
  }
  state.weather.cycleTimer -= dt;
  if (state.weather.cycleTimer <= 0) {
    const next = rollNextWeather();
    state.weather.id = next.id;
    state.weather.intensity = 0;
    state.weather.cycleTimer = next.minDur + Math.random() * (next.maxDur - next.minDur);
  }
}

// Weather particles. Arrays are allocated once and their length adjusted to
// match the desired count for the current weather + intensity.
const rainDrops = [];
const snowFlakes = [];
let lightningFlashTime = 0;

function drawWeather() {
  const mode = (state.settings && state.settings.weather) || 'auto';
  if (mode === 'off') { rainDrops.length = 0; snowFlakes.length = 0; return; }
  const w = activeWeather();
  const intensity = (state.weather && state.weather.intensity) || 0;
  const cw = canvas.width, ch = canvas.height;
  if (intensity < 0.02 || w.id === 'clear') {
    rainDrops.length = 0; snowFlakes.length = 0; return;
  }
  ctx.save();

  if (w.id === 'rain' || w.id === 'storm') {
    snowFlakes.length = 0;
    const target = Math.floor((w.id === 'storm' ? 240 : 140) * intensity);
    while (rainDrops.length < target) {
      rainDrops.push({
        x: Math.random() * cw,
        y: Math.random() * ch - ch,
        speed: 600 + Math.random() * 350,
        len:   7 + Math.random() * 9,
      });
    }
    while (rainDrops.length > target) rainDrops.pop();
    ctx.strokeStyle = `rgba(170,200,255,${(0.45 * intensity).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const dt = 1 / 60;
    for (const d of rainDrops) {
      d.y += d.speed * dt;
      d.x -= d.speed * dt * 0.25;
      if (d.y > ch) { d.y = -d.len; d.x = Math.random() * cw; }
      if (d.x < -20) d.x = cw + 20;
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.len * 0.25, d.y + d.len);
    }
    ctx.stroke();

    if (w.id === 'storm') {
      lightningFlashTime -= 1 / 60;
      if (lightningFlashTime <= 0 && Math.random() < 0.006) lightningFlashTime = 0.45;
      if (lightningFlashTime > 0) {
        const lf = Math.min(0.55, lightningFlashTime * 1.5);
        ctx.fillStyle = `rgba(255,255,255,${lf.toFixed(3)})`;
        ctx.fillRect(0, 0, cw, ch);
      }
    }
  } else if (w.id === 'snow') {
    rainDrops.length = 0;
    const target = Math.floor(100 * intensity);
    while (snowFlakes.length < target) {
      snowFlakes.push({
        x: Math.random() * cw,
        y: Math.random() * ch - ch,
        speed: 26 + Math.random() * 38,
        drift: (Math.random() - 0.5) * 22,
        size:  1.2 + Math.random() * 1.8,
        phase: Math.random() * Math.PI * 2,
      });
    }
    while (snowFlakes.length > target) snowFlakes.pop();
    const now = performance.now() / 1000;
    const dt = 1 / 60;
    ctx.fillStyle = `rgba(245,250,255,${(0.85 * intensity).toFixed(3)})`;
    for (const s of snowFlakes) {
      s.y += s.speed * dt;
      s.x += Math.sin(s.phase + now) * s.drift * dt;
      if (s.y > ch) { s.y = -8; s.x = Math.random() * cw; }
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (w.id === 'fog') {
    rainDrops.length = 0; snowFlakes.length = 0;
    // Two soft bands drifting across to suggest volumetric haze.
    const now = performance.now() / 1000;
    for (let i = 0; i < 2; i++) {
      const yy = ch * (0.25 + i * 0.4);
      const ox = (now * 10 + i * 200) % (cw + 200) - 100;
      const grad = ctx.createLinearGradient(0, yy - 40, 0, yy + 40);
      grad.addColorStop(0,   `rgba(210,218,228,0)`);
      grad.addColorStop(0.5, `rgba(220,228,236,${(0.25 * intensity).toFixed(3)})`);
      grad.addColorStop(1,   `rgba(210,218,228,0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(ox - 300, yy - 40, cw + 600, 80);
    }
  }

  ctx.restore();
}

// ---------- Robot rivalry ----------
// Every RIVALRY_PERIOD seconds, whichever robot earned the most coins in the
// period is flagged as the champion and gets a small speed bonus. The flag
// clears on robots that didn't win.
const RIVALRY_PERIOD = 30;

function trackRivalryEarnings(r, coins) {
  if (!r) return;
  r.coinsThisPeriod = (r.coinsThisPeriod || 0) + coins;
}

function updateRivalry(dt) {
  if (!robots || robots.length === 0) return;
  state.rivalryTimer = (state.rivalryTimer == null ? RIVALRY_PERIOD : state.rivalryTimer) - dt;
  if (state.rivalryTimer > 0) return;
  state.rivalryTimer = RIVALRY_PERIOD;
  if (state.settings && state.settings.rivalry === false) {
    robots.forEach(r => { r.isChampion = false; r.coinsThisPeriod = 0; });
    return;
  }
  // Identify the top earner this period. Ties go to the current champion,
  // then the robot with the highest index (arbitrary but stable).
  let winner = null; let best = 0;
  for (const r of robots) {
    const v = r.coinsThisPeriod || 0;
    if (v > best) { best = v; winner = r; }
  }
  for (const r of robots) {
    const wasChamp = !!r.isChampion;
    r.isChampion = r === winner && best > 0;
    r.coinsThisPeriod = 0;
    if (r.isChampion && !wasChamp) {
      addParticle(r.x, r.y - 8, { text: '👑 CHAMP!', color: '#ffd34e', size: 16 });
      beep(1320, 0.09, 'triangle', 0.05);
    }
  }
}

function rivalrySpeedBonus(r) {
  if (!r || !r.isChampion) return 1;
  if (state.settings && state.settings.rivalry === false) return 1;
  return 1.05;
}

// ---------- Photo mode ----------
// Downloads the current canvas as a PNG. Used from Zen Mode on the `P` key.
function takeZenPhoto() {
  try {
    const data = canvas.toDataURL('image/png');
    // Lawn-pedia: persist last 12 snapshots so the gallery survives reloads.
    if (state.pedia) {
      if (!Array.isArray(state.pedia.photos)) state.pedia.photos = [];
      state.pedia.photos.push({ ts: Date.now(), dataUrl: data });
      while (state.pedia.photos.length > 12) state.pedia.photos.shift();
    }
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `lawnbot-zen-${stamp}.png`;
    a.href = data;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (typeof toast === 'function') toast('📸 Snapshot saved', '#8ff09e');
    beep(880, 0.05, 'triangle', 0.05);
    setTimeout(() => beep(1320, 0.08, 'triangle', 0.05), 70);
  } catch (e) {
    console.warn('Photo capture failed', e);
    if (typeof toast === 'function') toast('📸 Snapshot failed', '#ffb4b4');
  }
}

// ===== AUTO-EXPORTS =====
export { DAY_TIME_KEYS, DAY_TIME_PRESETS, WEATHER_BY_ID, WEATHER_TYPES, activeWeather, beesAreActive, drawDayNightOverlay, drawWeather, rivalrySpeedBonus, takeZenPhoto, trackRivalryEarnings, updateDayNight, updateRivalry, updateWeather, weatherFlowerMult, weatherGrowthMult, weatherSpeedMult };
