'use strict';

const PSEUDO = ['/proc', '/sys', '/dev', '/run'];
const ROOT_LINK_MAP = { '/bin': '/usr/bin', '/sbin': '/usr/sbin', '/lib': '/usr/lib', '/lib32': '/usr/lib32', '/lib64': '/usr/lib64', '/libx32': '/usr/libx32' };

function norm(p) {
  const out = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { out.pop(); continue; }
    out.push(part);
  }
  return '/' + out.join('/');
}

function dirname(p) {
  if (p === '/') return '/';
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

function under(p, base) {
  return p === base || p.startsWith(base + '/');
}

function buildPaths(P) {
  const { N, name, parent } = P;
  const pathOf = new Array(N);
  const set = new Set();
  pathOf[0] = '/';
  for (let i = 1; i < N; i++) {
    const p = parent[i];
    const full = p === 0 ? '/' + name[i] : pathOf[p] + '/' + name[i];
    pathOf[i] = full;
    set.add(full);
  }
  return { pathOf, set };
}

// Component-wise symlink resolver: resolves each path segment that is a
// symlink, so targets reached through merged-/usr links (e.g. /bin -> /usr/bin)
// are followed correctly. Returns {resolved, circular}.
function makeResolver(targetByPath) {
  const memo = new Map();
  function resolve(p, stack, depth) {
    if (memo.has(p)) return memo.get(p);
    if (depth > 64) return { resolved: p, circular: true };
    const comps = p.split('/').filter(Boolean);
    let acc = '';
    let circular = false;
    for (let k = 0; k < comps.length; k++) {
      acc += '/' + comps[k];
      const tg = targetByPath.get(acc);
      if (tg !== undefined) {
        if (stack.has(acc)) { circular = true; break; }
        const abs = tg.startsWith('/') ? tg : norm(dirname(acc) + '/' + tg);
        const st = new Set(stack); st.add(acc);
        const r = resolve(norm(abs), st, depth + 1);
        acc = r.resolved;
        if (r.circular) circular = true;
        const rest = comps.slice(k + 1);
        if (rest.length) {
          const r2 = resolve(acc + '/' + rest.join('/'), st, depth + 1);
          acc = r2.resolved;
          if (r2.circular) circular = true;
        }
        const out = { resolved: acc === '' ? '/' : acc, circular };
        memo.set(p, out);
        return out;
      }
    }
    const out = { resolved: acc === '' ? '/' : acc, circular };
    memo.set(p, out);
    return out;
  }
  return (p) => resolve(p, new Set(), 0);
}

function analyzeSymlinks(P) {
  const { N, type, target, parent, name } = P;
  const { pathOf, set } = buildPaths(P);

  const targetByPath = new Map();
  const links = [];
  for (let i = 1; i < N; i++) {
    if (type[i] !== 2) continue;
    links.push(i);
    targetByPath.set(pathOf[i], target[i]);
  }

  const resolveFull = makeResolver(targetByPath);

  const stats = { total: links.length, ok: 0, broken: 0, brokenOculto: 0, circular: 0, pseudo: 0 };
  const tagCount = {};
  const buckets = { broken: [], brokenOculto: [], circular: [], pseudo: [], candidates: [], mergedUsr: [], systemdEnable: [] };
  const hiddenComp = (p) => p.split('/').some((c) => c.length > 1 && c[0] === '.');

  for (const i of links) {
    const p = pathOf[i];
    const raw = target[i];
    const nt = norm(raw.startsWith('/') ? raw : dirname(p) + '/' + raw);
    const tags = [];

    const isPseudo = PSEUDO.some((b) => under(p, b)) || PSEUDO.some((b) => under(nt, b));
    if (isPseudo) tags.push('pseudo-fs');
    if (/^\/(bin|sbin|lib|lib32|lib64|libx32)$/.test(p) && nt === ROOT_LINK_MAP[p]) tags.push('merged-usr');
    if (under(p, '/etc/systemd/system') && (under(nt, '/usr/lib/systemd') || under(nt, '/lib/systemd'))) tags.push('systemd-enable');
    if (/^\/vmlinuz/.test(p) || /^\/initrd\.img/.test(p)) tags.push('bootloader');

    let status, resolved = nt;
    if (isPseudo) {
      status = 'pseudo';
    } else {
      const r = resolveFull(nt);
      resolved = r.resolved;
      if (r.circular) status = 'circular';
      else if (set.has(resolved)) status = 'ok';
      else if (hiddenComp(resolved)) status = 'brokenOculto';
      else status = 'broken';
    }

    if (/\/Singleton(Lock|Socket|Cookie)$/.test(p)) tags.push('efimero');

    stats[status]++;
    for (const tg of tags) tagCount[tg] = (tagCount[tg] || 0) + 1;

    const rec = { path: p, target: raw, resolved, status };
    if (status === 'broken') buckets.broken.push({ path: p, target: raw, resolved });
    else if (status === 'brokenOculto') buckets.brokenOculto.push({ path: p, target: raw, resolved });
    else if (status === 'circular') buckets.circular.push({ path: p, target: raw, resolved });
    else if (status === 'pseudo') buckets.pseudo.push({ path: p, target: raw });
    if (tags.includes('merged-usr')) buckets.mergedUsr.push({ path: p, target: raw, resolved });
    if (tags.includes('systemd-enable')) buckets.systemdEnable.push({ path: p, target: raw, resolved });
    if (/^\/var\/(mail|spool\/mail)$/.test(p)) buckets.candidates.push(rec);
  }

  return { stats, tagCount, buckets, linkCount: links.length };
}

module.exports = { analyzeSymlinks, norm };
