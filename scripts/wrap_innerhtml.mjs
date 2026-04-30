// Rewrite `foo.innerHTML = <expr>` → `foo.innerHTML = iconize(<expr>)`
// in the given file, using a proper JS parser to handle multi-line
// template literals, nested expressions, etc. Idempotent: already-
// iconized assignments are skipped.
//
// Usage:  node scripts/wrap_innerhtml.mjs js/ui.js

import { readFileSync, writeFileSync } from 'fs';
import { parse } from 'acorn';

const [, , file] = process.argv;
if (!file) { console.error('usage: node scripts/wrap_innerhtml.mjs <file.js>'); process.exit(1); }

const src = readFileSync(file, 'utf8');
const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: false });

// Collect {assignStart, rhsStart, rhsEnd} for every `X.innerHTML = <expr>` AssignmentExpression.
const edits = [];
function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(walk); return; }
  if (node.type === 'AssignmentExpression' && node.operator === '=' &&
      node.left && node.left.type === 'MemberExpression' &&
      node.left.property && node.left.property.name === 'innerHTML') {
    // Skip if RHS is already an `iconize(...)` call.
    const rhs = node.right;
    if (rhs.type === 'CallExpression' && rhs.callee.type === 'Identifier' &&
        rhs.callee.name === 'iconize') return;
    // Skip if RHS is a plain empty-string literal ('' or "") — no emojis possible.
    if (rhs.type === 'Literal' && typeof rhs.value === 'string' && rhs.value === '') return;
    edits.push({ start: rhs.start, end: rhs.end });
  }
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    walk(node[key]);
  }
}
walk(ast);

// Apply edits back-to-front so offsets stay valid.
edits.sort((a, b) => b.start - a.start);
let out = src;
for (const { start, end } of edits) {
  const before = out.slice(0, start);
  const middle = out.slice(start, end);
  const after = out.slice(end);
  out = `${before}iconize(${middle})${after}`;
}

writeFileSync(file, out);
console.log(`wrapped ${edits.length} innerHTML assignments in ${file}`);
