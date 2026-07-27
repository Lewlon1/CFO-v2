#!/usr/bin/env node
// docs/atlas/build.mjs — regenerate docs/codebase-atlas.html from the current
// working tree. No dependencies; node 18+.
//
//   node docs/atlas/build.mjs
//
// Reads: git-tracked files (line counts), '@/…' imports under cfos-office/src
// (module dependency edges), package.json (version), git (commit count, branch),
// plus template.html / analyses.json / synthesis.json in this directory.
// Writes: docs/codebase-atlas.html (self-contained, opens in any browser).
//
// The subsystem dossiers (analyses.json) and the flows/overview (synthesis.json)
// are editorial content — refresh them by re-running the subsystem analysis when
// the architecture shifts, or edit the JSON by hand.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = execSync('git rev-parse --show-toplevel', { cwd: here }).toString().trim();
const sh = cmd => execSync(cmd, { cwd: repo, maxBuffer: 64 * 1024 * 1024 }).toString();

/* ---------- 1. File inventory with line counts ---------- */
const SKIP = /\.(png|jpg|jpeg|gif|ico|svg|woff2?|pdf)$|(^|\/)\.DS_Store$|package-lock\.json$|^docs\/(atlas\/|codebase-atlas\.html$)/;
const files = sh('git ls-files').trim().split('\n').filter(f => f && !SKIP.test(f));
const inventory = files.map(p => {
  let loc = 0;
  try {
    const buf = fs.readFileSync(path.join(repo, p));
    for (let i = 0; i < buf.length; i++) if (buf[i] === 10) loc++;
    if (buf.length && buf[buf.length - 1] !== 10) loc++;
  } catch { /* deleted or unreadable — keep at 0 */ }
  return { path: p, loc };
});

/* ---------- 2. Hierarchical tree ---------- */
const root = { name: 'CFO-v2', children: new Map() };
for (const f of inventory) {
  const parts = f.path.split('/');
  let node = root;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (i === parts.length - 1) {
      node.children.set(p, { name: p, loc: f.loc, path: f.path });
    } else {
      if (!node.children.has(p)) node.children.set(p, { name: p, children: new Map(), path: parts.slice(0, i + 1).join('/') });
      node = node.children.get(p);
    }
  }
}
function finalize(node) {
  if (!node.children) return node;
  const children = [...node.children.values()].map(finalize);
  const total = children.reduce((s, c) => s + (c.loc ?? c.total ?? 0), 0);
  return { name: node.name, path: node.path, total, children: children.sort((a, b) => (b.loc ?? b.total) - (a.loc ?? a.total)) };
}
const tree = finalize(root);

/* ---------- 3. Module-level import edges ---------- */
function mod(p) {
  const a = p.split('/');
  if (a[0] === 'app') {
    if (a[1] === 'api' && a.length >= 3) return 'app/api';
    if (a.length >= 2) return 'app/' + a[1];
    return 'app';
  }
  return a.length >= 2 ? a[0] + '/' + a[1] : a[0];
}
const srcRoot = path.join(repo, 'cfos-office/src');
const edgeCounts = new Map();
const IMPORT_RE = /from\s+['"]@\/([^'"]+)['"]/g;
for (const f of inventory) {
  if (!f.path.startsWith('cfos-office/src/') || !/\.(ts|tsx)$/.test(f.path)) continue;
  const rel = f.path.slice('cfos-office/src/'.length);
  const src = mod(rel);
  const text = fs.readFileSync(path.join(repo, f.path), 'utf8');
  for (const m of text.matchAll(IMPORT_RE)) {
    const dst = mod(m[1]);
    if (src === dst) continue;
    const key = src + '\t' + dst;
    edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
  }
}
const edges = [...edgeCounts.entries()]
  .map(([k, count]) => { const [from, to] = k.split('\t'); return { count, from, to }; })
  .sort((a, b) => b.count - a.count);

/* ---------- 4. Snapshot metadata ---------- */
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'cfos-office/package.json'), 'utf8'));
const meta = {
  version: pkg.version,
  routes: files.filter(f => /^cfos-office\/src\/app\/api\/.*route\.ts$/.test(f)).length,
  migrations: files.filter(f => /^cfos-office\/supabase\/migrations\//.test(f)).length,
  tests: files.filter(f => /\.test\.(ts|tsx)$/.test(f)).length,
  commits: parseInt(sh('git rev-list --count HEAD').trim(), 10),
  date: new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
  branch: sh('git branch --show-current').trim() || 'detached',
};

/* ---------- 5. Splice into template, wrap, write ---------- */
const totals = { files: inventory.length, lines: inventory.reduce((s, f) => s + f.loc, 0) };
let body = fs.readFileSync(path.join(here, 'template.html'), 'utf8');
const splice = (marker, json) => { body = body.replace(marker, () => json); };
splice('/*__DATA__*/null', JSON.stringify({ tree, edges, totals }));
splice('/*__ANALYSES__*/[]', fs.readFileSync(path.join(here, 'analyses.json'), 'utf8').trim());
splice('/*__SYNTHESIS__*/null', fs.readFileSync(path.join(here, 'synthesis.json'), 'utf8').trim());
splice('/*__META__*/null', JSON.stringify(meta));

const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${body}</body></html>`;
const out = path.join(repo, 'docs/codebase-atlas.html');
fs.writeFileSync(out, page);
console.log(`docs/codebase-atlas.html — ${totals.files} files, ${totals.lines.toLocaleString()} lines, ${edges.length} edges, v${meta.version} @ ${meta.branch}`);
