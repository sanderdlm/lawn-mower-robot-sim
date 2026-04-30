// Static module verifier — uses eslint-scope for proper lexical scope analysis.
// Reports any identifier referenced but not declared/imported/global.
//
// Usage:  npm install acorn eslint-scope    (one-time, --no-save is fine)
//         node check_modules.mjs [files...]
import * as acorn from 'acorn';
import * as eslintScope from 'eslint-scope';
import fs from 'fs';

const FILES = process.argv.length > 2
  ? process.argv.slice(2)
  : ['config','state','themes','world','canvas','assets','atmosphere','ai','render','save','ui','events','main'].map(n => `js/${n}.js`);

const BROWSER_GLOBALS = new Set([
  'document','window','localStorage','performance','requestAnimationFrame','setInterval','setTimeout','clearTimeout','clearInterval',
  'Math','Date','Object','Array','JSON','console','Number','String','Boolean','Map','Set','WeakMap','WeakSet','Promise',
  'Float32Array','Uint8Array','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array',
  'atob','btoa','isFinite','isNaN','parseInt','parseFloat','confirm','alert','prompt',
  'AudioContext','webkitAudioContext','Image','Audio','HTMLAudioElement','HTMLImageElement','HTMLElement','HTMLCanvasElement',
  'fetch','URL','Blob','FileReader','globalThis','Symbol',
  'Error','TypeError','RangeError','RegExp','structuredClone','Intl',
  'undefined','NaN','Infinity','arguments','navigator','location',
  'Event','MouseEvent','KeyboardEvent','TouchEvent','CustomEvent','PointerEvent','WheelEvent','DragEvent',
  'CanvasRenderingContext2D','OffscreenCanvas','requestIdleCallback','cancelAnimationFrame',
  'Proxy','Reflect','Function','BigInt',
]);

let totalUnresolved = 0;
for (const file of FILES) {
  const src = fs.readFileSync(file, 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, ranges: true });
  const scopeManager = eslintScope.analyze(ast, { sourceType: 'module', ecmaVersion: 2022 });
  const moduleScope = scopeManager.globalScope.childScopes[0] || scopeManager.globalScope;

  // Walk all scopes and collect all unresolved references (refs that escape to module/global).
  const unresolved = new Map(); // name -> first line
  function visit(scope) {
    for (const ref of scope.through) {
      const name = ref.identifier.name;
      if (BROWSER_GLOBALS.has(name)) continue;
      if (!unresolved.has(name)) unresolved.set(name, ref.identifier.loc.start.line);
    }
    for (const child of scope.childScopes) visit(child);
  }
  // `through` on a scope contains references that couldn't be resolved within it,
  // which bubble up. The module/global scope's `through` is the final unresolved set.
  for (const ref of scopeManager.globalScope.through) {
    const name = ref.identifier.name;
    if (BROWSER_GLOBALS.has(name)) continue;
    if (!unresolved.has(name)) unresolved.set(name, ref.identifier.loc.start.line);
  }

  if (unresolved.size) {
    totalUnresolved += unresolved.size;
    const list = [...unresolved.entries()].sort((a, b) => a[1] - b[1])
      .map(([n, l]) => `${n}@${l}`).join(', ');
    console.log(`[${file}] UNRESOLVED: ${list}`);
  } else {
    console.log(`[${file}] ok`);
  }
}
process.exit(totalUnresolved ? 1 : 0);
