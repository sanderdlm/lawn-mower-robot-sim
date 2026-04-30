// ===== AUTO-IMPORTS =====
import { clearTileCache } from './render.js';
import { state } from './state.js';
// ===== END AUTO-IMPORTS =====

/* ============================================================
   Theme / texture packs
   ============================================================
   Each theme swaps the lawn palette and stage background. They are
   pure data; render.js and canvas CSS read activeTheme() / swapThemeDom()
   to redraw.

   Future extension: a theme may reference image assets via the Assets
   registry (set `images: { grass: 'themeX_grass', ... }`). The render
   code should null-check Assets.image(...) and fall back to the
   procedural colors below. This lets us drop in downloaded tilesets
   (e.g. Kenney, OpenGameArt CC0 packs) without rewriting the renderer.
*/

const THEMES = [
  {
    id: 'classic',
    name: 'Classic Garden',
    desc: 'The original lush green lawn.',
    grass: {
      base:      [30,  70,  28],   // rgb at grass height 0
      delta:     [24, 110,  44],   // +rgb added at grass height 1
      bladeTop:  [170, 220, 120],  // highlight color of a blade tip
      bladeRoot: [20,  60,  25],   // shadow color near blade root
    },
    stageBg: 'radial-gradient(ellipse at 30% 20%, #1f6a34 0%, #113d1d 60%, #0a2612 100%)',
    overlayTint: null,
  },
  {
    id: 'autumn',
    name: 'Autumn Harvest',
    desc: 'Crunchy browns and fiery oranges.',
    grass: {
      base:      [70,  45,  22],
      delta:     [80,  55,  15],
      bladeTop:  [210, 160, 80],
      bladeRoot: [45,  25,  10],
    },
    stageBg: 'radial-gradient(ellipse at 30% 20%, #8a5a2f 0%, #4a2e14 60%, #1a1005 100%)',
    overlayTint: 'rgba(80,40,10,0.08)',
  },
  {
    id: 'moonlit',
    name: 'Moonlit Meadow',
    desc: 'Cool blue moonlight on grass.',
    grass: {
      base:      [15,  38,  55],
      delta:     [24,  70,  90],
      bladeTop:  [140, 190, 220],
      bladeRoot: [10,  20,  35],
    },
    stageBg: 'radial-gradient(ellipse at 30% 20%, #1a2c5c 0%, #0a1233 60%, #05081e 100%)',
    overlayTint: 'rgba(40,60,120,0.12)',
  },
  {
    id: 'pixel',
    name: 'Retro Pixel',
    desc: 'Chunky arcade greens.',
    grass: {
      base:      [30, 104, 40],
      delta:     [30, 140, 50],
      bladeTop:  [180, 240, 120],
      bladeRoot: [10,  50,  15],
    },
    stageBg: 'radial-gradient(ellipse at 30% 20%, #2f9c4a 0%, #196a2c 60%, #0a3517 100%)',
    overlayTint: null,
  },
  {
    id: 'zen',
    name: 'Zen Sand',
    desc: 'Raked sand garden with moss.',
    grass: {
      base:      [120, 100, 70],
      delta:     [40,  50,  30],
      bladeTop:  [160, 155, 100],
      bladeRoot: [60,  45,  25],
    },
    stageBg: 'radial-gradient(ellipse at 30% 20%, #d8c2a0 0%, #ad8a5c 60%, #5e4320 100%)',
    overlayTint: 'rgba(120,90,40,0.08)',
  },
];
const THEME_BY_ID = Object.fromEntries(THEMES.map(t => [t.id, t]));

function activeTheme() {
  const id = (state && state.settings && state.settings.theme) || 'classic';
  return THEME_BY_ID[id] || THEMES[0];
}

// Apply theme's CSS-side bits (stage background, data-theme attribute) and
// clear the grass tile cache so the next frame redraws with the new palette.
function applyThemeDom() {
  const t = activeTheme();
  document.body.setAttribute('data-theme', t.id);
  const stage = document.querySelector('main.stage');
  if (stage) stage.style.background = t.stageBg;
  if (typeof clearTileCache === 'function') clearTileCache();
}

// ===== AUTO-EXPORTS =====
export { THEMES, activeTheme, applyThemeDom };
