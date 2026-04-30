// ===== AUTO-IMPORTS =====
import { CFG } from './config.js';
import { bees, robots, treasures, visitorGnomes } from './world.js';
import { state } from './state.js';
// ===== END AUTO-IMPORTS =====

/* ============================================================
   Canvas, particles, coin flash, sound
   ============================================================ */

const canvas = document.getElementById('lawn');
const ctx = canvas.getContext('2d');
let tileSize = 16;

function getTileSize() { return tileSize; }

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const wPx = rect.width * dpr;
  const hPx = rect.height * dpr;
  const tileW = wPx / CFG.gridW;
  const tileH = hPx / CFG.gridH;
  tileSize = Math.max(1, Math.floor(Math.min(tileW, tileH)));
  canvas.width = CFG.gridW * tileSize;
  canvas.height = CFG.gridH * tileSize;
}

window.addEventListener('resize', () => {
  const oldTile = tileSize;
  resizeCanvas();
  if (oldTile && oldTile !== tileSize) {
    const scale = tileSize / oldTile;
    robots.forEach(r => { r.x *= scale; r.y *= scale; });
    bees.forEach(b => { b.x *= scale; b.y *= scale; if (b.target) { b.target.x *= scale; b.target.y *= scale; } });
    if (typeof visitorGnomes !== 'undefined') {
      visitorGnomes.forEach(g => {
        g.x *= scale; g.y *= scale;
        g.targetX *= scale; g.targetY *= scale;
        g.exitX *= scale; g.exitY *= scale;
      });
    }
    if (typeof treasures !== 'undefined') {
      treasures.forEach(t => {
        t.x = (t.tileX + 0.5) * tileSize;
        t.y = (t.tileY + 0.5) * tileSize;
      });
    }
    // Render caches (tile pixmaps + entity gradients) are size-bound; drop
    // them so nothing rebuilds against stale dimensions. Lazy import to avoid
    // a circular top-level dependency (render.js already imports this file).
    import('./render.js').then(m => m.clearTileCache && m.clearTileCache()).catch(() => {});
  }
});

// ---------- Particles ----------
const particles = [];
function addParticle(x, y, opts = {}) {
  if (particles.length > CFG.maxParticles) particles.shift();
  particles.push({
    x, y,
    vx: (Math.random() - 0.5) * 40,
    vy: -Math.random() * 60 - 20,
    life: 1.0,
    text: opts.text || '',
    color: opts.color || '#ffd34e',
    size: opts.size || 12,
    gravity: opts.gravity ?? 120,
  });
}

// ---------- Coin floaters (UI pop) ----------
let lastCoinFlash = 0;
function flashCoin() {
  const box = document.getElementById('coinBox');
  const now = performance.now();
  if (now - lastCoinFlash > 120) {
    box.classList.remove('pulse'); void box.offsetWidth; box.classList.add('pulse');
    lastCoinFlash = now;
  }
}

// ---------- Sound (tiny synth) ----------
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { audioCtx = null; }
  }
  return audioCtx;
}
function beep(freq = 440, dur = 0.06, type = 'square', vol = 0.05) {
  if (state.muted) return;
  const ac = ensureAudio(); if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type; osc.frequency.value = freq;
  gain.gain.value = vol;
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(); osc.stop(ac.currentTime + dur);
}

// Mischievous up-down arpeggio followed by a quick "hee-hee" — the sound a
// gnome makes when he's just hidden something for you to find.
function playGnomeGiggle() {
  if (state.muted) return;
  const ac = ensureAudio(); if (!ac) return;
  // Bouncy arpeggio C5-E5-G5-E5
  const notes = [523, 659, 784, 659];
  notes.forEach((f, i) => {
    setTimeout(() => beep(f, 0.07, 'triangle', 0.05), i * 70);
  });
  // "hee-hee" — two short chirps with vibrato-ish pitch wiggle
  setTimeout(() => {
    beep(880, 0.05, 'sine', 0.045);
    beep(990, 0.05, 'square', 0.02);
  }, 340);
  setTimeout(() => {
    beep(820, 0.05, 'sine', 0.045);
    beep(940, 0.05, 'square', 0.02);
  }, 430);
  // Cheeky low "hmph"
  setTimeout(() => beep(260, 0.12, 'triangle', 0.05), 560);
}

// ===== AUTO-EXPORTS =====
export { addParticle, beep, canvas, ctx, flashCoin, getTileSize, particles, playGnomeGiggle, resizeCanvas, tileSize };
