// ===== AUTO-IMPORTS =====
import { state } from './state.js';
// ===== END AUTO-IMPORTS =====

/* ============================================================
   Asset registry — preload and retrieve complex assets
   ============================================================
   Usage:
     Assets.register('mower_x1', { type: 'image', src: 'assets/mower_x1.png' });
     Assets.register('sprites',  { type: 'json',  src: 'assets/sprites.json' });
     Assets.preloadAll().then(startGame);
     const img = Assets.image('mower_x1');   // HTMLImageElement or null
     const data = Assets.json('sprites');    // parsed object or null

   Everything is optional: if a file is missing or fails to load we log a
   warning and serve null so render code can fall back to vector drawing.
   A loaded image is ready as soon as Assets.image(key) is non-null — render
   code should null-check before using it.
*/

const Assets = (() => {
  const entries = new Map();   // key -> { type, src, data, loaded, error }
  let loadingPromise = null;

  function register(key, { type, src }) {
    if (entries.has(key)) return;
    entries.set(key, { type, src, data: null, loaded: false, error: null });
  }

  function loadOne(key) {
    const e = entries.get(key);
    if (!e || e.loaded) return Promise.resolve(e && e.data);
    if (e.type === 'image') {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload  = () => { e.data = img; e.loaded = true; resolve(img); };
        img.onerror = () => { e.error = 'load failed'; e.loaded = true; console.warn('[Assets] image failed:', key, e.src); resolve(null); };
        img.src = e.src;
      });
    }
    if (e.type === 'json') {
      return fetch(e.src)
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(j => { e.data = j; e.loaded = true; return j; })
        .catch(err => { e.error = String(err); e.loaded = true; console.warn('[Assets] json failed:', key, e.src, err); return null; });
    }
    if (e.type === 'audio') {
      return new Promise((resolve) => {
        const a = new Audio();
        a.oncanplaythrough = () => { e.data = a; e.loaded = true; resolve(a); };
        a.onerror = () => { e.error = 'load failed'; e.loaded = true; console.warn('[Assets] audio failed:', key, e.src); resolve(null); };
        a.src = e.src;
      });
    }
    console.warn('[Assets] unknown type for', key, e.type);
    e.loaded = true;
    return Promise.resolve(null);
  }

  function preloadAll() {
    if (loadingPromise) return loadingPromise;
    const jobs = [];
    for (const key of entries.keys()) jobs.push(loadOne(key));
    loadingPromise = Promise.all(jobs).then(() => undefined);
    return loadingPromise;
  }

  function get(key) {
    const e = entries.get(key);
    return e && e.loaded ? e.data : null;
  }

  // Draw an image with fallback — returns true if drawn, false if the asset
  // wasn't available and caller should render its vector fallback.
  function drawImage(ctx, key, x, y, w, h) {
    const img = get(key);
    if (!img || !(img instanceof HTMLImageElement)) return false;
    ctx.drawImage(img, x, y, w, h);
    return true;
  }

  return {
    register,
    preloadAll,
    image: (k) => { const v = get(k); return v instanceof HTMLImageElement ? v : null; },
    json:  (k) => { const v = get(k); return v && !(v instanceof HTMLImageElement || v instanceof HTMLAudioElement) ? v : null; },
    audio: (k) => { const v = get(k); return v instanceof HTMLAudioElement ? v : null; },
    drawImage,
    has: (k) => entries.has(k),
    keys: () => [...entries.keys()],
  };
})();

// Register known assets here. All are optional — drop files into /assets and
// uncomment or add entries. Render code must null-check before using.
// Example:
//   Assets.register('mower_pro', { type: 'image', src: 'assets/mower_pro.png' });
//   Assets.register('gnome_giggle', { type: 'audio', src: 'assets/gnome_giggle.mp3' });

// ------------------------------------------------------------
// Sprite pack — generated via scripts/gen_sheets.py + slice_sheets.py.
// See assets/sprites/ for the sliced PNGs. Rendering honours the
// `useSprites` setting so the procedural (vector) fallbacks in render.js
// remain the default. Missing files degrade silently.
// ------------------------------------------------------------
const SPRITE_MANIFEST = {
  // key => 'assets/sprites/<sheet>/<name>.png'
  'tree':            'features/tree',
  'rock':            'features/rock',
  'pond':            'features/pond',
  'flower_cluster':  'features/flower_cluster',
  'beehive':         'features/beehive',
  'fountain':        'features/fountain',
  'shed':            'features/shed',
  'gnome_friendly':  'features/gnome_friendly',
  'gnome_evil':      'features/gnome_evil',
  'mole_mound':      'features/mole_mound',

  // Robots (generic visual variants, picked by tier/skin hash in render.js)
  'robot_basic':     'robots/basic_red',
  'robot_blue':      'robots/upgraded_blue',
  'robot_gold':      'robots/gold_premium',
  'robot_rusty':     'robots/rusty',
  'robot_neon':      'robots/neon',
  'robot_evil':      'robots/evil',

  // Characters
  'bee':             'characters/bee',
  'mole':            'characters/mole',
  'neighbor_granny': 'characters/neighbor_granny',
  'neighbor_chad':   'characters/neighbor_chad',
  'mayor':           'characters/mayor',
  'player_mower':    'characters/player_mower',

  // Flowers (6 palette variants — indexed to FLOWER_PALETTE)
  'flower_pink':     'flowers/pink',
  'flower_orange':   'flowers/orange',
  'flower_purple':   'flowers/purple',
  'flower_red':      'flowers/red',
  'flower_white':    'flowers/white',
  'flower_yellow':   'flowers/yellow',

  // Currency / items
  'coin':            'items/coin',
  'coin_stack':      'items/coin_stack',
  'gem':             'items/gem',
  'ruby':            'items/ruby',
  'chest_closed':    'items/chest_closed',
  'chest_open':      'items/chest_open',
  'fuel_can':        'items/fuel_can',
  'energy_crystal':  'items/energy_crystal',

  // UI icons — inline sprites for shop/HUD text (see EMOJI_TO_SPRITE + iconize).
  // Kept separate from `items/` variants so we can pick whichever reads best at small sizes.
  'ui_coin':         'ui_icons/coin',
  'ui_gem':          'ui_icons/gem',
  'ui_ruby':         'ui_icons/ruby',
  'ui_robot':        'ui_icons/robot_head',
  'ui_grass':        'ui_icons/grass_blade',
  'ui_flower':       'ui_icons/flower',
  'ui_bee':          'ui_icons/bee',
  'ui_gear':         'ui_icons/gear',
  'ui_wrench':       'ui_icons/wrench',
  'ui_trophy':       'ui_icons/trophy',
  'ui_star':         'ui_icons/star',
  'ui_check':        'ui_icons/check',
  'ui_cross':        'ui_icons/cross',
  'ui_lock':         'ui_icons/lock',
  'ui_gnome':        'ui_icons/gnome',
  'ui_cart':         'ui_icons/cart',
};

for (const [key, rel] of Object.entries(SPRITE_MANIFEST)) {
  Assets.register('sprite_' + key, { type: 'image', src: 'assets/sprites/' + rel + '.png' });
}

// Convenience façade so render code can do `Sprites.get('tree')` without
// caring about the 'sprite_' prefix or whether the global flag is on.
const Sprites = {
  // Master switch — reflects state.settings.useSprites. Returns false if
  // state hasn't loaded yet (first frame), forcing vector fallback.
  enabled() {
    return !!(typeof state !== 'undefined' && state && state.settings && state.settings.useSprites);
  },
  // Return HTMLImageElement or null if sprite not loaded / flag off.
  get(key) {
    if (!this.enabled()) return null;
    return Assets.image('sprite_' + key);
  },
  // Draw centred at (cx, cy) with target width w (height preserves aspect).
  // Returns true if drawn (caller should skip vector fallback).
  drawCentered(ctx, key, cx, cy, w) {
    const img = this.get(key);
    if (!img) return false;
    const h = w * (img.naturalHeight / img.naturalWidth);
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    return true;
  },
  // Draw so the sprite's bottom sits on cy (feet on ground), centred horizontally.
  drawGrounded(ctx, key, cx, cy, w) {
    const img = this.get(key);
    if (!img) return false;
    const h = w * (img.naturalHeight / img.naturalWidth);
    ctx.drawImage(img, cx - w / 2, cy - h, w, h);
    return true;
  },
};

// ------------------------------------------------------------
// Inline UI icon swap — translates shop/HUD emojis into sprite <img>
// tags when `state.settings.useSprites` is on. `iconize(html)` is meant
// to wrap template-literal HTML strings before assigning them to
// innerHTML. When the flag is off (or a sprite is missing) it returns
// the original emoji untouched, so every call site stays safe.
// ------------------------------------------------------------
const EMOJI_TO_SPRITE = {
  '💰': 'ui_coin',
  '💎': 'ui_gem',
  '♦️': 'ui_ruby',
  '🤖': 'ui_robot',
  '🌱': 'ui_grass',
  '🌸': 'ui_flower',
  '🐝': 'ui_bee',
  '⚙️': 'ui_gear',
  '🔧': 'ui_wrench',
  '🏆': 'ui_trophy',
  '⭐': 'ui_star',
  '✅': 'ui_check',
  '❌': 'ui_cross',
  '🔒': 'ui_lock',
  '🧙': 'ui_gnome',
  '🛒': 'ui_cart',
};

// Build a single regex that matches any of the mapped emojis. Done once
// at module-load so iconize() is just a String.replace in the hot path.
// Longer strings (♦️ is 2 code points) are matched first so they win over
// shorter prefixes.
const _EMOJI_KEYS_DESC = Object.keys(EMOJI_TO_SPRITE).sort((a, b) => b.length - a.length);
const _EMOJI_ESCAPE_RX = /[.*+?^${}()|[\]\\]/g;
const _EMOJI_RX = new RegExp(_EMOJI_KEYS_DESC.map(e => e.replace(_EMOJI_ESCAPE_RX, '\\$&')).join('|'), 'g');

// Wrap an HTML string: when sprites are on and the ui_icons PNG has
// loaded, substitute <img> tags for the mapped emojis. Otherwise return
// the string unchanged. Fallback is per-emoji — missing assets leave the
// original glyph in place.
function iconize(html) {
  if (typeof html !== 'string' || !Sprites.enabled()) return html;
  return html.replace(_EMOJI_RX, (match) => {
    const key = EMOJI_TO_SPRITE[match];
    if (!key) return match;
    const img = Assets.image('sprite_' + key);
    if (!img) return match;
    return `<img class="ui-ico" src="${img.src}" alt="${match}" draggable="false">`;
  });
}

// ===== AUTO-EXPORTS =====
export { Assets, Sprites, iconize };
