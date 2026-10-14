'use strict';
/*
 * build.js — Orchestrator. Stage 1: parse + emit chunks + manifest.
 * Later stages (symlinks, audit, knowledge base) are added incrementally.
 *
 * Usage: node build/build.js <dump.md> <outDir>
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parse } = require('./parse');
const { emit } = require('./emit');
const { analyzeSymlinks } = require('./symlinks');

async function main() {
  const dump = process.argv[2] || '/home/alexendros/Documentos/desplantar.md';
  const outDir = process.argv[3] || path.join(__dirname, '..');

  const t0 = Date.now();
  process.stderr.write('[parse] reading ' + dump + '\n');
  const P = await parse(dump);
  const tParse = Date.now();
  process.stderr.write('[parse] ' + P.N + ' entries in ' + ((tParse - t0) / 1000).toFixed(1) + 's\n');

  const symlinks = [];
  const dirs = { d: 0, f: 0, s: 0 };
  for (let i = 0; i < P.N; i++) {
    const t = P.type[i];
    if (t === 0) dirs.d++;
    else if (t === 1) dirs.f++;
    else { dirs.s++; symlinks.push(i); }
  }

  const treeDir = path.join(outDir, 'data', 'tree');
  const t1 = Date.now();
  process.stderr.write('[emit] chunking...\n');
  const { chunks, topLevel, lazyCount } = emit(P, treeDir);
  const t2 = Date.now();
  process.stderr.write('[emit] ' + chunks.length + ' chunks, ' + lazyCount + ' lazy nodes in ' + ((t2 - t1) / 1000).toFixed(1) + 's\n');

  // attach owning chunk id to each top-level entry
  for (const e of topLevel) {
    const owner = chunks.find((c) => e.index >= c.start && e.index <= c.end);
    e.chunk = owner ? owner.id : null;
  }

  const manifest = {
    source: dump,
    generated: new Date().toISOString(),
    counts: {
      entries: P.N,
      symlinks: dirs.s,
      directories: dirs.d,
      files: dirs.f,
      unmatched: P.unmatched.length,
      chunks: chunks.length,
      lazyNodes: lazyCount,
    },
    topLevel,
    chunks,
  };

  fs.mkdirSync(path.join(outDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'data', 'manifest.json'), JSON.stringify(manifest, null, 2));

  const t3 = Date.now();
  process.stderr.write('[symlinks] resolving...\n');
  const sym = analyzeSymlinks(P);
  const t4 = Date.now();
  fs.writeFileSync(path.join(outDir, 'data', 'symlink-report.json'), JSON.stringify(sym, null, 2));
  process.stderr.write('[symlinks] ' + sym.stats.total + ' links in ' + ((t4 - t3) / 1000).toFixed(1) + 's ' + JSON.stringify(sym.stats) + '\n');

  const t5 = Date.now();
  process.stderr.write('[kb] generating knowledge base...\n');
  execFileSync('node', [path.join(__dirname, 'knowledge-base.js'), outDir], { cwd: outDir, stdio: 'inherit' });
  process.stderr.write('[audit] running audit engine...\n');
  execFileSync('node', [path.join(__dirname, 'audit.js'), outDir], { cwd: outDir, stdio: 'inherit' });
  process.stderr.write('[kb+audit] done in ' + ((Date.now() - t5) / 1000).toFixed(1) + 's\n');

  process.stderr.write('\n=== COUNTS ===\n');
  process.stderr.write('entries : ' + P.N + ' (expected 3233218)\n');
  process.stderr.write('symlinks: ' + dirs.s + ' (expected 114265)\n');
  process.stderr.write('dirs    : ' + dirs.d + '\n');
  process.stderr.write('files   : ' + dirs.f + '\n');
  process.stderr.write('topLevel: ' + topLevel.length + ' (expected 26)\n');
  process.stderr.write('unmatched lines: ' + P.unmatched.length + '\n');
  process.stderr.write('chunks  : ' + chunks.length + '\n');
  process.stderr.write('symlinks: ' + JSON.stringify(sym.stats) + '\n');
  process.stderr.write('total time: ' + ((Date.now() - t0) / 1000).toFixed(1) + 's\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
