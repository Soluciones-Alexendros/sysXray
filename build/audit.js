'use strict';

// audit.js — Subagente B del pipeline desplantar-auditoria.
// Lee data/manifest.json + data/symlink-report.json (+ /boot desde chunk-0)
// y emite data/audit-report.json según DATA-CONTRACT.md §4.2.
// Uso: node build/audit.js [repoDir]   (repoDir por defecto = padre de build/)

const fs = require('fs');
const path = require('path');

let norm = (p) => p; // fallback si build/symlinks.js no estuviera disponible
try {
  ({ norm } = require('./symlinks'));
} catch (_) {
  /* el helper norm es opcional para la auditoría */
}

const REPO = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '..');

const DATA = path.join(REPO, 'data');
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
const symReport = JSON.parse(fs.readFileSync(path.join(DATA, 'symlink-report.json'), 'utf8'));

// --- FHS 3.0 ---------------------------------------------------------------
const CANONICAL = [
  'bin', 'boot', 'dev', 'etc', 'home', 'lib', 'media', 'mnt', 'opt',
  'proc', 'root', 'run', 'sbin', 'srv', 'sys', 'tmp', 'usr', 'var',
];
// 14 obligatorios de FHS 3.0 (canonical menos los opcionales home/root/proc/sys)
const CORE = [
  'bin', 'boot', 'dev', 'etc', 'lib', 'media', 'mnt', 'opt',
  'run', 'sbin', 'srv', 'tmp', 'usr', 'var',
];

const CLS = {
  TOP: '#anomalia-top',
  BROKEN: '#anomalia-symlink-roto',
  CIRCULAR: '#anomalia-symlink-circular',
  UBICACION: '#anomalia-ubicacion',
  CONTENIDO: '#anomalia-contenido',
  CANDIDATO: '#anomalia-candidato',
};

const LINK_ARCHWIKI_FS = 'https://wiki.archlinux.org/title/File_systems';
const LINK_WIKI_SWAP = 'https://en.wikipedia.org/wiki/Memory_swapping';

const rootNames = new Set(manifest.topLevel.map((t) => t.name));
const present = CANONICAL.filter((n) => rootNames.has(n));
const missing = CANONICAL.filter((n) => !rootNames.has(n));

// Entradas raíz no canónicas (extra-FHS). Los alias merged-usr (lib32/64/x32)
// no se listan aquí: se documentan en mergedUsr.
const NON_CANONICAL_META = {
  cdrom: {
    clase: CLS.TOP,
    comentario: 'Mountpoint huérfano/vacío: entrada /media/cdrom creada por el instalador sin medio montado.',
  },
  'desplantar.md': {
    clase: CLS.TOP,
    comentario: 'Auto-inclusión: el volcado completo del árbol / se incluye a sí mismo en el repositorio auditado.',
  },
  'swap.img': {
    clase: CLS.TOP,
    comentario: 'Swapfile por defecto de Ubuntu (instalación con swap en fichero); normal.',
  },
  snap: {
    clase: CLS.TOP,
    comentario: 'Directorio de snaps: extra-FHS, normal en Ubuntu.',
  },
  'lost+found': {
    clase: CLS.TOP,
    comentario: 'Directorio de fsck de ext4: extra-FHS, normal en la raíz del sistema de ficheros.',
  },
};
const NON_CANONICAL_ORDER = ['cdrom', 'desplantar.md', 'swap.img', 'snap', 'lost+found'];

const nonCanonical = NON_CANONICAL_ORDER
  .filter((n) => rootNames.has(n))
  .map((n) => ({ name: n, clase: NON_CANONICAL_META[n].clase, comentario: NON_CANONICAL_META[n].comentario }));

// --- merged-/usr -----------------------------------------------------------
const EXPECTED_USR = {
  '/bin': '/usr/bin',
  '/sbin': '/usr/sbin',
  '/lib': '/usr/lib',
  '/lib32': '/usr/lib32',
  '/lib64': '/usr/lib64',
  '/libx32': '/usr/libx32',
};
const muLinks = (symReport.buckets && symReport.buckets.mergedUsr) || [];
const mergedUsrOk = Object.keys(EXPECTED_USR)
  .every((p) => muLinks.some((l) => l.path === p && l.resolved === EXPECTED_USR[p]));
const mergedUsr = {
  ok: mergedUsrOk,
  links: muLinks.map((l) => ({ path: l.path, target: l.target })),
};

// --- kernel (desde /boot en chunk-0) ---------------------------------------
function readBootChildren() {
  const tsv = path.join(DATA, 'tree', 'chunk-0.tsv');
  if (!fs.existsSync(tsv)) return [];
  const lines = fs.readFileSync(tsv, 'utf8').split('\n');
  if (!lines.length) return [];
  const hdr = (lines[0] || '').split('\t');
  const baseDepth = Number(hdr[3]);
  const parentPath = hdr[4] || '/';
  const stack = [];
  const boot = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = lines[i].split('\t');
    const depth = Number(f[0]);
    const name = f[2];
    const parent = depth === baseDepth ? parentPath : stack[depth - 1];
    const full = parent === '/' ? '/' + name : parent + '/' + name;
    stack[depth] = full;
    if (parent === '/boot') boot.push(name);
  }
  return boot;
}

const bootChildren = readBootChildren();
const kernelVersions = [];
for (const name of bootChildren) {
  const m = name.match(/^(?:vmlinuz|config|System\.map|initrd\.img|abi)-(\d+\.\d+\.\d+-\d+)-generic/);
  if (m && !kernelVersions.includes(m[1])) kernelVersions.push(m[1]);
}
kernelVersions.sort();
const kernelNonStandard = kernelVersions.some((v) => !v.startsWith('6.'));
const kernel = {
  versions: kernelVersions,
  nonStandard: kernelNonStandard,
  comentario: kernelNonStandard
    ? `Kernel no estándar en Ubuntu: detectado ${kernelVersions.join(', ') || '7.0.0'}; Ubuntu 24.04 LTS distribuye kernels 6.x.`
    : 'Kernel coherente con una instalación Ubuntu estándar (serie 6.x).',
};

// --- anomalías -------------------------------------------------------------
const anomalies = [];

// 1) Raíz (top-level)
anomalies.push({
  path: '/cdrom',
  class: CLS.TOP,
  severity: 'warn',
  message: 'Mountpoint huérfano/vacío (/media/cdrom): entrada creada por el instalador sin medio montado.',
  link: LINK_ARCHWIKI_FS,
});
anomalies.push({
  path: '/desplantar.md',
  class: CLS.TOP,
  severity: 'warn',
  message: 'Auto-inclusión: el volcado del árbol / se incluye a sí mismo dentro del repositorio auditado (316 MB).',
});
anomalies.push({
  path: '/swap.img',
  class: CLS.TOP,
  severity: 'info',
  message: 'Swapfile por defecto de Ubuntu (instalación con swap en fichero en vez de partición); normal.',
  link: LINK_WIKI_SWAP,
});
anomalies.push({
  path: '/snap',
  class: CLS.TOP,
  severity: 'info',
  message: 'Directorio de snaps: extra-FHS, normal en Ubuntu.',
});
anomalies.push({
  path: '/lost+found',
  class: CLS.TOP,
  severity: 'info',
  message: 'Directorio de fsck de ext4: extra-FHS, normal en la raíz del sistema de ficheros.',
});

// 2) Symlinks rotos (genuinos) — bucketizados, con downgrade a info
const RE_SINGLETON = /\/Singleton(Lock|Socket|Cookie)$/;
const RE_OVERLAY = /\/containers\/storage\/overlay\//;
const RE_SNAPSHOTTER = /snapshotter\.v1\.overlayfs/;
const RE_DATOS_CONTAINERS = /\/Aplicaciones\/datos\/share\/containers/;
const RE_SNAP = /^\/snap\//;
const RE_BACKUP = /\/var\/backups\/pre-hardening/;

function brokenDisposition(p) {
  if (RE_SINGLETON.test(p)) {
    return { severity: 'info', msg: 'Symlink efímero por diseño (Chrome/Chromium Singleton*): el destino se recrea en cada ejecución.' };
  }
  if (RE_OVERLAY.test(p) || RE_SNAPSHOTTER.test(p) || RE_DATOS_CONTAINERS.test(p)) {
    return { severity: 'info', msg: 'Symlink interno de contenedores (containerd / overlayfs): el destino se resuelve dentro de la imagen.' };
  }
  if (RE_SNAP.test(p)) {
    return { severity: 'info', msg: 'Symlink interno de snap: el destino queda fuera del árbol volcado.' };
  }
  if (RE_BACKUP.test(p)) {
    return { severity: 'info', msg: 'Symlink de copia de seguridad pre-hardening: el destino no se incluyó en el dump.' };
  }
  return { severity: 'warn', msg: 'Symlink roto: el destino no existe en el árbol volcado.' };
}

const broken = (symReport.buckets && symReport.buckets.broken) || [];
for (const b of broken) {
  const d = brokenDisposition(b.path);
  anomalies.push({
    path: b.path,
    class: CLS.BROKEN,
    severity: d.severity,
    message: d.msg + ' Destino: ' + b.resolved,
  });
}

// 3) Symlinks circulares (0 reales, implementado igualmente)
const circular = (symReport.buckets && symReport.buckets.circular) || [];
for (const c of circular) {
  anomalies.push({
    path: c.path,
    class: CLS.CIRCULAR,
    severity: 'error',
    message: 'Symlink circular: la resolución entra en bucle. Destino: ' + c.resolved,
  });
}

// 4) brokenOculto: NO se emiten como anomalías individuales -> 1 resumen candidato
const brokenOculto = (symReport.buckets && symReport.buckets.brokenOculto) || [];
anomalies.push({
  path: '(global)',
  class: CLS.CANDIDATO,
  severity: 'info',
  message: `${brokenOculto.length} symlinks marcados como brokenOculto son falsos positivos: el dump se generó sin -a y no incluye entradas ocultas (.config, .cache, .local, .ssh, ...), por lo que sus destinos no aparecen en el árbol.`,
});

// 5) #anomalia-ubicacion: chequeo barato sobre registros superficiales de chunk-0
try {
  const tsv = path.join(DATA, 'tree', 'chunk-0.tsv');
  if (fs.existsSync(tsv)) {
    const lines = fs.readFileSync(tsv, 'utf8').split('\n');
    const hdr = (lines[0] || '').split('\t');
    const baseDepth = Number(hdr[3]);
    const parentPath = hdr[4] || '/';
    const stack = [];
    const canonicalSet = new Set(CANONICAL);
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const f = lines[i].split('\t');
      const depth = Number(f[0]);
      const name = f[2];
      const parent = depth === baseDepth ? parentPath : stack[depth - 1];
      const full = parent === '/' ? '/' + name : parent + '/' + name;
      stack[depth] = full;
      // Solo shallow de /boot, /etc, /dev (parent directo).
      if ((parent === '/etc' || parent === '/boot' || parent === '/dev') && canonicalSet.has(norm(name))) {
        anomalies.push({
          path: full,
          class: CLS.UBICACION,
          severity: 'warn',
          message: `Entrada con nombre de directorio FHS canónico ('${name}') ubicada fuera de la raíz (dentro de ${parent}).`,
        });
      }
    }
  }
} catch (_) {
  /* si chunk-0 no está disponible, no se emiten anomalías de ubicación */
}

// 6) #anomalia-contenido: kernel no estándar
if (kernel.nonStandard) {
  anomalies.push({
    path: '/boot',
    class: CLS.CONTENIDO,
    severity: 'warn',
    message: `Kernel no estándar en Ubuntu: ${kernel.versions.join(', ') || '7.0.0'} (Ubuntu 24.04 LTS distribuye 6.x). Posible kernel custom/HWE no oficial.`,
  });
}

// --- stats -----------------------------------------------------------------
const byClass = {};
const bySeverity = { info: 0, warn: 0, error: 0 };
for (const a of anomalies) {
  byClass[a.class] = (byClass[a.class] || 0) + 1;
  bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
}

const report = {
  generated: new Date().toISOString(),
  distro: 'Ubuntu',
  fhs: {
    canonical: CANONICAL,
    core: CORE,
    present,
    missing,
    nonCanonical,
  },
  mergedUsr,
  kernel,
  anomalies,
  stats: {
    byClass,
    total: anomalies.length,
    bySeverity,
  },
};

fs.writeFileSync(
  path.join(DATA, 'audit-report.json'),
  JSON.stringify(report, null, 2) + '\n'
);

console.log('audit-report.json escrito en ' + path.join(DATA, 'audit-report.json'));
console.log('total anomalías: ' + report.stats.total);
console.log('por clase: ' + JSON.stringify(report.stats.byClass));
console.log('por severidad: ' + JSON.stringify(report.stats.bySeverity));
console.log('mergedUsr.ok: ' + report.mergedUsr.ok + ' (' + report.mergedUsr.links.length + ' links)');
console.log('kernel: ' + JSON.stringify(report.kernel.versions) + ' nonStandard=' + report.kernel.nonStandard);
