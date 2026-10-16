#!/usr/bin/env node
'use strict';
/*
 * Ingest a pasted instrument transcript into a Plate JSON.
 * Usage:
 *   node build/plate-ingest.js --instrument sh_ls --regime live /tmp/home-ls.txt
 *   node build/plate-ingest.js --instrument grub_ls --regime frozen --id my-grub capture.txt
 *
 * No npm deps. Validates with tests/schema-sobre.js validatePlate.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { validatePlate } = require(path.join(ROOT, 'tests', 'schema-sobre.js'));

const INSTRUMENTS = ['tree', 'grub_ls', 'grub_cat', 'grub_hexdump', 'sh_ls'];
const REGIMES = ['live', 'frozen'];

function usage(code) {
  console.error('Usage: node build/plate-ingest.js --instrument <sh_ls|grub_ls|grub_cat|grub_hexdump|tree> --regime <live|frozen> [--id <id>] [--role capture|fixture] <body.txt>');
  process.exit(code);
}

function parseArgs(argv) {
  const out = { instrument: null, regime: null, id: null, role: 'capture', file: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--instrument') out.instrument = argv[++i];
    else if (a === '--regime') out.regime = argv[++i];
    else if (a === '--id') out.id = argv[++i];
    else if (a === '--role') out.role = argv[++i];
    else if (a === '-h' || a === '--help') usage(0);
    else if (a.startsWith('-')) {
      console.error('Unknown flag: ' + a);
      usage(1);
    } else out.file = a;
  }
  return out;
}

function hasDotNames(body) {
  // Lines that look like ls -la or grub ls with a .name token
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t === '.' || t === '..') continue;
    // ls -la: last field is name
    const parts = t.split(/\s+/);
    const name = parts[parts.length - 1];
    if (name && name !== '.' && name !== '..' && name.charAt(0) === '.') return true;
    // bare name lines
    if (/^\.[A-Za-z0-9_.-]+$/.test(t)) return true;
  }
  return false;
}

function slugId(instrument, when) {
  const d = when.toISOString().replace(/[:.]/g, '-');
  return 'plate-' + instrument + '-' + d;
}

function updateIndex(platesDir, entry) {
  const indexPath = path.join(platesDir, 'index.json');
  let index = { plates: [] };
  if (fs.existsSync(indexPath)) {
    try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch (_) { /* reset */ }
  }
  if (!Array.isArray(index.plates)) index.plates = [];
  index.plates = index.plates.filter(function (p) { return p.id !== entry.id; });
  index.plates.push(entry);
  index.updated = new Date().toISOString();
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.file || !args.instrument || !args.regime) usage(1);
  if (INSTRUMENTS.indexOf(args.instrument) === -1) {
    console.error('Bad instrument');
    usage(1);
  }
  if (REGIMES.indexOf(args.regime) === -1) {
    console.error('Bad regime');
    usage(1);
  }
  if (args.role !== 'capture' && args.role !== 'fixture') {
    console.error('Bad role');
    usage(1);
  }

  const abs = path.resolve(args.file);
  if (!fs.existsSync(abs)) {
    console.error('File not found: ' + abs);
    process.exit(1);
  }
  const body = fs.readFileSync(abs, 'utf8');
  const now = new Date();
  const id = args.id || slugId(args.instrument, now);
  const kind = hasDotNames(body) ? 'full_dentries' : 'no_dotfiles';

  const plate = {
    id: id,
    role: args.role,
    instrument: args.instrument,
    regime: args.regime,
    captured_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    horizons: [{ id: 'h-' + kind, kind: kind }],
    body_uri: 'file://data/plates/' + id + '.json',
    body: body,
    statements: []
  };

  // Light heuristic: /bin -> usr/bin lines from tree-style or "bin -> usr/bin"
  const binLink = body.match(/(?:^|\s)bin\s*(?:⇒|->|=>)\s*usr\/bin/m);
  if (binLink) {
    plate.statements.push({
      id: 's-bin',
      subject: '/bin',
      relation: 'links_to',
      object_text: 'usr/bin',
      support: 'asserted'
    });
  }

  const errs = validatePlate(plate);
  if (errs.length) {
    console.error('Plate invalid: ' + errs.join('; '));
    process.exit(1);
  }

  const platesDir = path.join(ROOT, 'data', 'plates');
  fs.mkdirSync(platesDir, { recursive: true });
  const outName = id + '.json';
  const outPath = path.join(platesDir, outName);
  fs.writeFileSync(outPath, JSON.stringify(plate, null, 2) + '\n');
  updateIndex(platesDir, { id: id, file: outName, instrument: args.instrument, role: args.role });

  console.log('Wrote ' + path.relative(ROOT, outPath));
  console.log('horizon=' + kind + ' statements=' + plate.statements.length);
}

if (require.main === module) main();

module.exports = { hasDotNames, parseArgs };
