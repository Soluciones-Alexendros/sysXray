'use strict';
/*
 * Structural + fixture checks for the LinkML observation envelope.
 * No npm deps. Invoked from tests/run.js via require + runSobreTests(helpers).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCHEMA_YAML = path.join(ROOT, 'schema', 'sysxray.yaml');
const DOCS = path.join(ROOT, 'docs');
const FIX = path.join(__dirname, 'fixtures', 'plates');

const FICHAS = [
  'fhs-3.0.json',
  'hier-7.json',
  'uapi-file-hierarchy.json',
  'xdg.json',
  'gnu.json',
  'redhat.json',
  'secure-boot-lockdown.json',
  'grub-ordenes.json'
];

const FORBIDDEN_SLOTS = ['parent', 'children', 'exists', 'target_exists', 'compliant'];

const ENUMS = {
  Role: ['capture', 'fixture'],
  Instrument: ['tree', 'grub_ls', 'grub_cat', 'grub_hexdump', 'sh_ls'],
  Regime: ['live', 'frozen'],
  HorizonKind: [
    'no_dotfiles', 'no_metadata', 'leaf_ambiguity', 'grub_lockdown',
    'kernel_lockdown_integrity', 'unknown_filesystem', 'full_dentries'
  ],
  Relation: ['lists', 'contains', 'links_to', 'mounts', 'denies', 'reads'],
  Support: ['asserted', 'refused', 'not_in_plate'],
  Verdict: ['acuerdo', 'desacuerdo', 'inobservable', 'extra_documentado'],
  ContrastVerdict: ['acuerdo', 'desacuerdo', 'url_rota', 'bloqueado_bot', 'parcial']
};

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function validatePlate(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return ['not an object'];
  for (const k of ['id', 'role', 'instrument', 'regime', 'captured_at', 'body_uri']) {
    if (obj[k] == null || obj[k] === '') errors.push('missing ' + k);
  }
  if (!Array.isArray(obj.horizons) || obj.horizons.length < 1) {
    errors.push('horizons required (non-empty)');
  }
  if (obj.role && ENUMS.Role.indexOf(obj.role) === -1) errors.push('bad role');
  if (obj.instrument && ENUMS.Instrument.indexOf(obj.instrument) === -1) {
    errors.push('bad instrument');
  }
  if (obj.regime && ENUMS.Regime.indexOf(obj.regime) === -1) errors.push('bad regime');
  if (Array.isArray(obj.statements)) {
    obj.statements.forEach(function (s, i) {
      if (!s.relation) errors.push('statement[' + i + '] missing relation');
      if (!s.support) errors.push('statement[' + i + '] missing support');
      if (s.relation && ENUMS.Relation.indexOf(s.relation) === -1) {
        errors.push('statement[' + i + '] bad relation');
      }
      if (s.support && ENUMS.Support.indexOf(s.support) === -1) {
        errors.push('statement[' + i + '] bad support');
      }
      if (s.parent !== undefined || s.children !== undefined) {
        errors.push('statement[' + i + '] has parent/children');
      }
    });
  }
  for (const bad of FORBIDDEN_SLOTS) {
    if (Object.prototype.hasOwnProperty.call(obj, bad)) {
      errors.push('forbidden slot on plate: ' + bad);
    }
  }
  return errors;
}

function validateCanonFicha(obj) {
  const errors = [];
  for (const k of ['id', 'title', 'source_url', 'version_label', 'judges_what', 'observed_here', 'explanation']) {
    if (obj[k] == null || String(obj[k]).length < 1) errors.push('missing ' + k);
  }
  if (obj.contrast_verdict != null &&
      ENUMS.ContrastVerdict.indexOf(obj.contrast_verdict) === -1) {
    errors.push('bad contrast_verdict');
  }
  return errors;
}

function validateJudgment(obj) {
  const errors = [];
  if (!obj.authority) errors.push('missing authority');
  if (!obj.verdict) errors.push('missing verdict');
  if (obj.verdict && ENUMS.Verdict.indexOf(obj.verdict) === -1) errors.push('bad verdict');
  return errors;
}

function runSobreTests(helpers) {
  const test = helpers.test;
  const eq = helpers.eq;
  const truthy = helpers.truthy;

  test('sobre: schema/sysxray.yaml exists', () => {
    truthy(fs.existsSync(SCHEMA_YAML), 'missing schema/sysxray.yaml');
  });

  test('sobre: YAML declares five classes and Plate tree_root', () => {
    const y = fs.readFileSync(SCHEMA_YAML, 'utf8');
    for (const c of ['Plate:', 'Horizon:', 'Statement:', 'Judgment:', 'Authority:', 'CanonFicha:']) {
      truthy(y.indexOf(c) !== -1, 'missing class ' + c);
    }
    truthy(/Plate:[\s\S]*?tree_root:\s*true/.test(y), 'Plate not tree_root');
    truthy(y.indexOf('is_a: Authority') !== -1, 'CanonFicha not is_a Authority');
  });

  test('sobre: forbidden slots absent from YAML', () => {
    const y = fs.readFileSync(SCHEMA_YAML, 'utf8');
    // slot names as YAML keys (leading spaces + name + colon)
    for (const s of FORBIDDEN_SLOTS) {
      const re = new RegExp('(^|\\n)\\s+' + s + ':', 'm');
      truthy(!re.test(y), 'forbidden slot present: ' + s);
    }
    truthy(!/Statement:[\s\S]*?range:\s*Statement/.test(y.split('Judgment:')[0] || ''),
      'Statement self-nesting range');
  });

  test('sobre: SPECLinkML-sysXray.txt and LinkML.html exist', () => {
    truthy(fs.existsSync(path.join(ROOT, 'SPECLinkML-sysXray.txt')), 'missing SPEC');
    truthy(fs.existsSync(path.join(ROOT, 'LinkML', 'LinkML.html')), 'missing dossier');
  });

  test('sobre: eight CanonFicha JSON cards', () => {
    for (const name of FICHAS) {
      const p = path.join(DOCS, name);
      truthy(fs.existsSync(p), 'missing ficha ' + name);
      const obj = readJSON(p);
      const errs = validateCanonFicha(obj);
      truthy(errs.length === 0, name + ': ' + errs.join('; '));
      eq(obj['@type'], 'CanonFicha', name + ' @type');
    }
  });

  test('sobre: secure-boot ficha explains the switch', () => {
    const sb = readJSON(path.join(DOCS, 'secure-boot-lockdown.json'));
    truthy(typeof sb.switch_on === 'string' && sb.switch_on.length > 40, 'switch_on short');
    truthy(typeof sb.switch_off === 'string' && sb.switch_off.length > 40, 'switch_off short');
    truthy(Array.isArray(sb.activates_when_on) && sb.activates_when_on.length >= 3, 'activates');
    truthy(Array.isArray(sb.deactivates_when_on) && sb.deactivates_when_on.length >= 3, 'deactivates');
    truthy(/UEFI|firma|firmware/i.test(sb.explanation), 'explanation missing UEFI/firma');
    truthy(/SecureBoot enabled|integrity/i.test(sb.observed_here), 'observed_here missing measure');
  });

  test('sobre: valid plate fixtures', () => {
    for (const name of ['tree-bin-link.json', 'sh-bin-dir.json', 'broken-oculto.json']) {
      const errs = validatePlate(readJSON(path.join(FIX, name)));
      truthy(errs.length === 0, name + ': ' + errs.join('; '));
    }
  });

  test('sobre: two contradictory plates both validate', () => {
    const a = validatePlate(readJSON(path.join(FIX, 'tree-bin-link.json')));
    const b = validatePlate(readJSON(path.join(FIX, 'sh-bin-dir.json')));
    truthy(a.length === 0 && b.length === 0, 'contradiction should still validate');
  });

  test('sobre: invalid fixtures rejected', () => {
    truthy(validatePlate(readJSON(path.join(FIX, 'invalid-no-horizons.json'))).length > 0,
      'empty horizons should fail');
    truthy(validatePlate(readJSON(path.join(FIX, 'invalid-no-support.json'))).length > 0,
      'missing support should fail');
    truthy(validateJudgment(readJSON(path.join(FIX, 'invalid-judgment-no-authority.json'))).length > 0,
      'judgment without authority should fail');
  });

  test('sobre: JSON Schema file present if generated', () => {
    const js = path.join(ROOT, 'schema', 'sysxray.schema.json');
    truthy(fs.existsSync(js), 'missing schema/sysxray.schema.json — generate or commit hand schema');
    const y = fs.readFileSync(SCHEMA_YAML, 'utf8');
    truthy(y.indexOf('ContrastVerdict:') !== -1, 'missing ContrastVerdict enum');
    truthy(y.indexOf('source_checked_at:') !== -1, 'missing source_checked_at');
    truthy(y.indexOf('local_witness:') !== -1, 'missing local_witness');
  });

  test('sobre: contraste-fuentes.json covers eight fichas', () => {
    const report = readJSON(path.join(DOCS, 'contraste-fuentes.json'));
    truthy(Array.isArray(report.entries) && report.entries.length === 8, 'need 8 entries');
    const ids = report.entries.map(function (e) { return e.ficha_id; }).sort();
    const expected = FICHAS.map(function (n) {
      return readJSON(path.join(DOCS, n)).id;
    }).sort();
    eq(JSON.stringify(ids), JSON.stringify(expected), 'ficha ids mismatch');
    report.entries.forEach(function (e) {
      truthy(ENUMS.ContrastVerdict.indexOf(e.contrast_verdict) !== -1,
        e.ficha_id + ' bad verdict');
      truthy(e.source_url && e.http_status, e.ficha_id + ' missing url/status');
    });
  });

  test('sobre: redhat URL is not the dead assembly', () => {
    const rh = readJSON(path.join(DOCS, 'redhat.json'));
    truthy(rh.source_url.indexOf('assembly_managing-file-system-hierarchy') === -1,
      'redhat still points at 404 assembly');
    truthy(rh.source_url.indexOf('managing_file_systems') !== -1, 'expected managing_file_systems');
  });

  test('sobre: CanonFicha without source_url rejected', () => {
    const bad = {
      id: 'x', title: 't', version_label: 'v',
      judges_what: 'j', observed_here: 'o', explanation: 'e'
    };
    truthy(validateCanonFicha(bad).indexOf('missing source_url') !== -1, 'must require source_url');
  });

  test('sobre: judgments seed /bin present', () => {
    const idx = readJSON(path.join(ROOT, 'data', 'judgments', 'index.json'));
    truthy(idx.judgments && idx.judgments.length >= 2, 'need bin judgments');
    const hier = readJSON(path.join(ROOT, 'data', 'judgments', 'judgment-bin-hier.json'));
    const uapi = readJSON(path.join(ROOT, 'data', 'judgments', 'judgment-bin-uapi.json'));
    eq(hier.statement, '/bin', 'hier statement');
    eq(hier.verdict, 'desacuerdo', 'hier verdict');
    eq(uapi.verdict, 'acuerdo', 'uapi verdict');
  });

  test('sobre: plate-ingest detects dots and validates fixture plate', () => {
    const ingest = require(path.join(ROOT, 'build', 'plate-ingest.js'));
    const sample = fs.readFileSync(path.join(FIX, 'ingest-sample.txt'), 'utf8');
    truthy(ingest.hasDotNames(sample) === true, 'sample should have dots');
    truthy(ingest.hasDotNames('bin ⇒ usr/bin\n') === false, 'bin-only should not force dots');
    const plate = readJSON(path.join(ROOT, 'data', 'plates', 'fixture-bin-link.json'));
    const errs = validatePlate(plate);
    truthy(errs.length === 0, 'fixture plate: ' + errs.join('; '));
  });
}

module.exports = { runSobreTests, validatePlate, validateCanonFicha, FORBIDDEN_SLOTS };
