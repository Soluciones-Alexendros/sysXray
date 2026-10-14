'use strict';
/*
 * tests/run.js — Self-contained invariant suite for desplantar-auditoria.
 *
 * Usage: node tests/run.js
 * Exit : 0 = all pass (skips allowed), 1 = any fail.
 *
 * Only Node built-ins (fs, path, assert). No test framework, no deps.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const TREE = path.join(DATA, 'tree');

let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
  try {
    fn();
    console.log('PASS  ' + name);
    passed++;
  } catch (e) {
    console.log('FAIL  ' + name);
    console.log('      ' + e.message);
    failed++;
  }
}

function skip(name, reason) {
  console.log('SKIP  ' + name + '  (' + reason + ')');
  skipped++;
}

function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ': expected ' + JSON.stringify(expected) + ', observed ' + JSON.stringify(actual));
  }
}

function truthy(cond, label) {
  if (!cond) throw new Error(label);
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readChunkLines(id) {
  const lines = fs.readFileSync(path.join(TREE, 'chunk-' + id + '.tsv'), 'utf8').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// ---------------------------------------------------------------- manifest --

const HAS_MANIFEST = fs.existsSync(path.join(DATA, 'manifest.json'));
const HAS_TREE = fs.existsSync(path.join(TREE, 'chunk-0.tsv'));
const HAS_SYMLINK = fs.existsSync(path.join(DATA, 'symlink-report.json'));
const manifest = HAS_MANIFEST ? readJSON(path.join(DATA, 'manifest.json')) : null;

if (!HAS_MANIFEST) {
  skip('manifest:*', 'data/manifest.json absent');
} else {
test('manifest: counts.entries === 3233219', () => eq(manifest.counts.entries, 3233219, 'entries'));
test('manifest: counts.symlinks === 114265', () => eq(manifest.counts.symlinks, 114265, 'symlinks'));
test('manifest: counts.directories === 305975', () => eq(manifest.counts.directories, 305975, 'directories'));
test('manifest: counts.files === 2812979', () => eq(manifest.counts.files, 2812979, 'files'));
test('manifest: counts.unmatched === 0', () => eq(manifest.counts.unmatched, 0, 'unmatched'));
test('manifest: counts.chunks === 306', () => eq(manifest.counts.chunks, 306, 'chunks'));
test('manifest: topLevel.length === 26', () => eq(manifest.topLevel.length, 26, 'topLevel.length'));
test('manifest: counts sum consistency', () => {
  const c = manifest.counts;
  eq(c.directories + c.files + c.symlinks, c.entries, 'dirs+files+symlinks');
});
test('manifest: chunks array matches counts.chunks', () => {
  eq(manifest.chunks.length, manifest.counts.chunks, 'chunks.length');
});
}

// ----------------------------------------------------------- chunk files ----

if (!HAS_TREE || !manifest) {
  skip('chunks:*', 'data/tree/ not published (local dump only)');
} else {
test('chunks: every chunk file header matches manifest.chunks[id]', () => {
  const problems = [];
  for (const c of manifest.chunks) {
    const lines = readChunkLines(c.id);
    const h = lines[0].split('\t');
    const okHeader =
      h[0] === '#' + c.id &&
      Number(h[1]) === c.start &&
      Number(h[2]) === c.end &&
      Number(h[3]) === c.baseDepth &&
      h[4] === c.parentPath;
    if (!okHeader) problems.push('chunk-' + c.id + ' header=' + JSON.stringify(h));
  }
  truthy(problems.length === 0, problems.slice(0, 10).join('; '));
});

test('chunks: record count === end-start+1 === manifest count', () => {
  const problems = [];
  for (const c of manifest.chunks) {
    const lines = readChunkLines(c.id);
    const recs = lines.length - 1;
    const span = c.end - c.start + 1;
    if (recs !== span || recs !== c.count) {
      problems.push('chunk-' + c.id + ' recs=' + recs + ' span=' + span + ' count=' + c.count);
    }
  }
  truthy(problems.length === 0, problems.slice(0, 10).join('; '));
});

test('chunks: first record depth === manifest baseDepth', () => {
  const problems = [];
  for (const c of manifest.chunks) {
    const lines = readChunkLines(c.id);
    const first = lines[1].split('\t');
    if (Number(first[0]) !== c.baseDepth) {
      problems.push('chunk-' + c.id + ' firstDepth=' + first[0] + ' baseDepth=' + c.baseDepth);
    }
  }
  truthy(problems.length === 0, problems.slice(0, 10).join('; '));
});

test('chunks: type char in {d,f,s} on every record', () => {
  let bad = null;
  let badCount = 0;
  for (const c of manifest.chunks) {
    const lines = readChunkLines(c.id);
    for (let i = 1; i < lines.length; i++) {
      const t = lines[i].split('\t')[1];
      if (t !== 'd' && t !== 'f' && t !== 's') {
        badCount++;
        if (bad === null) bad = 'chunk-' + c.id + ' line ' + (i + 1) + ' type=' + JSON.stringify(t);
      }
    }
  }
  truthy(badCount === 0, badCount + ' bad type chars; first: ' + bad);
});

test('chunks: symlinks (s) have non-empty target', () => {
  let bad = null;
  let badCount = 0;
  for (const c of manifest.chunks) {
    const lines = readChunkLines(c.id);
    for (let i = 1; i < lines.length; i++) {
      const f = lines[i].split('\t');
      if (f[1] === 's' && (f[3] === undefined || f[3] === '')) {
        badCount++;
        if (bad === null) bad = 'chunk-' + c.id + ' line ' + (i + 1) + ' name=' + f[2];
      }
    }
  }
  truthy(badCount === 0, badCount + ' symlinks without target; first: ' + bad);
});

test('chunks: non-symlinks (d/f) have empty target', () => {
  let bad = null;
  let badCount = 0;
  for (const c of manifest.chunks) {
    const lines = readChunkLines(c.id);
    for (let i = 1; i < lines.length; i++) {
      const f = lines[i].split('\t');
      if ((f[1] === 'd' || f[1] === 'f') && f[3] !== undefined && f[3] !== '') {
        badCount++;
        if (bad === null) bad = 'chunk-' + c.id + ' line ' + (i + 1) + ' name=' + f[2] + ' target=' + f[3];
      }
    }
  }
  truthy(badCount === 0, badCount + ' non-symlinks with target; first: ' + bad);
});
} // HAS_TREE

// ---------------------------------------------------------- symlink report --

if (!HAS_SYMLINK) {
  skip('symlink-report:*', 'data/symlink-report.json not published (home paths)');
} else {
const sym = readJSON(path.join(DATA, 'symlink-report.json'));

test('symlink-report: stats.total === 114265', () => eq(sym.stats.total, 114265, 'stats.total'));
test('symlink-report: ok+broken+brokenOculto+circular+pseudo === 114265', () => {
  const s = sym.stats;
  const sum = s.ok + s.broken + s.brokenOculto + s.circular + s.pseudo;
  eq(sum, 114265, 'status sum');
});
test('symlink-report: buckets present', () => {
  const required = ['broken', 'brokenOculto', 'circular', 'pseudo'];
  const missing = required.filter((k) => !Array.isArray(sym.buckets[k]));
  truthy(missing.length === 0, 'missing buckets: ' + missing.join(', '));
});
}

// ------------------------------------------------------------- unit tests ---

// Rebuild the LINE_RE/ARROW exactly as build/parse.js defines them.
const LINE_RE = /^((?:\u2502   |    )*)(?:\u251C\u2500\u2500 |\u2514\u2500\u2500 )(.*)$/u;
const ARROW = ' \u21D2 ';

test('parse: LINE_RE matches top-level branch (depth 0)', () => {
  const m = LINE_RE.exec('\u251C\u2500\u2500 etc');
  truthy(m !== null, 'no match for "├── etc"');
  eq(m[1].length / 4, 0, 'depth');
  eq(m[2], 'etc', 'rest');
});

test('parse: LINE_RE counts 4-char units from │ and spaces', () => {
  const a = LINE_RE.exec('\u2502   \u251C\u2500\u2500 foo'); // │   ├── foo
  truthy(a !== null, 'no match for "│   ├── foo"');
  eq(a[1].length / 4, 1, 'depth via │');
  eq(a[2], 'foo', 'name');
  const b = LINE_RE.exec('    \u2514\u2500\u2500 bar'); // "    └── bar"
  truthy(b !== null, 'no match for "    └── bar"');
  eq(b[1].length / 4, 1, 'depth via spaces');
  eq(b[2], 'bar', 'name');
});

test('parse: LINE_RE rejects the root line "."', () => {
  eq(LINE_RE.exec('.'), null, 'root line');
});

test('parse: ARROW splits name and target', () => {
  const rest = 'bin \u21D2 usr/bin';
  const ai = rest.indexOf(ARROW);
  truthy(ai >= 0, 'arrow not found');
  eq(rest.slice(0, ai), 'bin', 'name');
  eq(rest.slice(ai + ARROW.length), 'usr/bin', 'target');
});

test('parse: line without ARROW yields no target', () => {
  const rest = 'etc';
  eq(rest.indexOf(ARROW), -1, 'unexpected arrow');
});

const { norm } = require(path.join(ROOT, 'build', 'symlinks.js'));

test('symlinks.norm: norm("/a/./b/../c") === "/a/c"', () => {
  eq(norm('/a/./b/../c'), '/a/c', 'norm');
});
test('symlinks.norm: trailing .. collapses', () => {
  eq(norm('/a/b/..'), '/a', 'norm');
});
test('symlinks.norm: relative becomes rooted', () => {
  eq(norm('a/b'), '/a/b', 'norm');
});

// ------------------------------------------------------ annotation coverage --

function loadAnnotator() {
  const kbRules = path.join(ROOT, 'web', 'kb-rules.js');
  const kbNode = path.join(ROOT, 'build', 'knowledge-base.js');
  if (fs.existsSync(kbRules)) {
    const code = fs.readFileSync(kbRules, 'utf8');
    const win = {};
    // eslint-disable-next-line no-new-func
    new Function('window', 'globalThis', code)(win, win);
    return { origin: 'web/kb-rules.js', annotate: win.annotate };
  }
  if (fs.existsSync(kbNode)) {
    const mod = require(kbNode);
    return { origin: 'build/knowledge-base.js', annotate: mod.annotate };
  }
  return null;
}

const ANNOT_PATHS = [
  '/',
  '/etc/passwd',
  '/usr/bin/ls',
  '/var/log/syslog',
  '/bin',
  '/swap.img',
  '/snap/core24',
  '/proc/self',
  '/boot/vmlinuz',
  '/tmp/x',
];

const annotator = loadAnnotator();
if (annotator === null) {
  skip('annotate: non-null hashtag for 10 canonical paths', 'web/kb-rules.js and build/knowledge-base.js absent');
} else if (typeof annotator.annotate !== 'function') {
  test('annotate: non-null hashtag for 10 canonical paths', () => {
    throw new Error(annotator.origin + ' did not expose an annotate() function');
  });
} else {
  test('annotate: non-null hashtag for 10 canonical paths (' + annotator.origin + ')', () => {
    const bad = [];
    for (const p of ANNOT_PATHS) {
      const r = annotator.annotate(p);
      if (!r || !r.hashtag) bad.push(p + ' -> ' + JSON.stringify(r));
    }
    truthy(bad.length === 0, 'paths without hashtag: ' + bad.join('; '));
  });
}

// -------------------------------------------------------- LinkML envelope --

const sobre = require('./schema-sobre.js');
sobre.runSobreTests({ test, eq, truthy });

// ------------------------------------------------------- enriched annotate --

if (annotator !== null && typeof annotator.annotate === 'function') {
  test('annotate: registro enriquecido (rol/detalle/caracteristicas/fuentes)', () => {
    const r = annotator.annotate('/usr/bin/ls', 'f', null);
    truthy(r && typeof r === 'object', 'sin registro');
    truthy(typeof r.rol === 'string' && r.rol.length > 0, 'falta rol');
    truthy(typeof r.detalle === 'string' && r.detalle.length > 0, 'falta detalle');
    truthy(Array.isArray(r.caracteristicas) && r.caracteristicas.length >= 1, 'caracteristicas vacias');
    truthy(
      r.caracteristicas.every((c) => c && typeof c.clave === 'string' && typeof c.valor === 'string'),
      'caracteristica malformada'
    );
    truthy(Array.isArray(r.fuentes) && r.fuentes.length >= 1, 'fuentes vacias');
    truthy(
      r.fuentes.every((f) => f && typeof f.url === 'string' && typeof f.texto === 'string' && typeof f.tipo === 'string'),
      'fuente malformada'
    );
  });

  test('annotate: merge de capas incluye Formato o Estandar', () => {
    const r = annotator.annotate('/etc/passwd', 'f', null);
    const claves = (r.caracteristicas || []).map((c) => String(c.clave).toLowerCase());
    truthy(
      claves.some((k) => k.indexOf('est') !== -1 || k.indexOf('formato') !== -1),
      'sin clave tecnica: ' + claves.join(',')
    );
  });
}

// ------------------------------------------------------------------ summary --

console.log('');
console.log('--- ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped ---');
process.exit(failed > 0 ? 1 : 0);
