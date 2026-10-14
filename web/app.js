'use strict';
(function () {
  let DATA = '../data/';
  let TREE = DATA + 'tree/';
  let WINDOW_ROWS = 500;
  let CAP_RESULTS = 5000;
  let SHOW_RESULTS = 500;

  let FALLBACK_TAXONOMY = [
    { tag: '#fhs', label_es: 'FHS', color: '#3b82f6' },
    { tag: '#config', label_es: 'Configuración', color: '#8b5cf6' },
    { tag: '#daemon', label_es: 'Daemon', color: '#14b8a6' },
    { tag: '#binario', label_es: 'Binario', color: '#22c55e' },
    { tag: '#biblioteca', label_es: 'Biblioteca', color: '#0ea5e9' },
    { tag: '#kernel', label_es: 'Kernel', color: '#f59e0b' },
    { tag: '#dispositivo', label_es: 'Dispositivo', color: '#a855f7' },
    { tag: '#datos-proceso', label_es: 'Datos de proceso', color: '#10b981' },
    { tag: '#cache', label_es: 'Caché', color: '#eab308' },
    { tag: '#log', label_es: 'Log', color: '#f97316' },
    { tag: '#datos-usuario', label_es: 'Datos de usuario', color: '#06b6d4' },
    { tag: '#snap', label_es: 'Snap', color: '#ec4899' },
    { tag: '#anomalia-top', label_es: 'Anomalía top-level', color: '#ef4444' },
    { tag: '#anomalia-symlink-roto', label_es: 'Symlink roto', color: '#dc2626' },
    { tag: '#anomalia-symlink-circular', label_es: 'Symlink circular', color: '#b91c1c' },
    { tag: '#anomalia-ubicacion', label_es: 'Anomalía de ubicación', color: '#f43f5e' },
    { tag: '#anomalia-contenido', label_es: 'Anomalía de contenido', color: '#e11d48' },
    { tag: '#anomalia-candidato', label_es: 'Candidato', color: '#fb7185' }
  ];

  let CHAR_CODE = { f: 0, d: 1, s: 2 };
  let TYPE_CHAR = ['f', 'd', 's'];
  let TYPE_NAME = { f: 'fichero (o dir vacío)', d: 'directorio', s: 'enlace simbólico' };

  function taxonomy() {
    return (Array.isArray(window.KB_TAXONOMY) && window.KB_TAXONOMY.length) ? window.KB_TAXONOMY : FALLBACK_TAXONOMY;
  }
  function colorFor(tag) {
    let t = taxonomy();
    for (let i = 0; i < t.length; i++) if (t[i].tag === tag) return t[i].color || '#64748b';
    return '#64748b';
  }
  function labelFor(tag) {
    let t = taxonomy();
    for (let i = 0; i < t.length; i++) if (t[i].tag === tag) return t[i].label_es || t[i].tag;
    return tag || 'FHS';
  }
  function stubAnnotate(path, type) {
    let top = '/' + String(path || '').split('/').filter(Boolean)[0];
    return {
      hashtag: '#fhs',
      categoria: 'FHS (reglas KB no disponibles)',
      descripcion_corta_ES: 'kb-rules.js no está presente; se muestra la anotación mínima. Ruta raíz: ' + top + '.',
      enlaces: []
    };
  }
  function annotate(path, type, target) {
    if (typeof window.annotate === 'function') {
      try { return window.annotate(path, type, target); } catch (e) { return stubAnnotate(path, type); }
    }
    return stubAnnotate(path, type);
  }
  function getAnno(node) {
    if (node._anno == null) {
      try { node._anno = annotate(node.path, node.type, node.target) || null; }
      catch (e) { node._anno = null; }
    }
    return node._anno;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function contrast(hex) {
    let h = String(hex || '#64748b').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    let r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    let lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? '#0b0f14' : '#ffffff';
  }
  function badge(tag) {
    if (!tag) return '';
    let c = colorFor(tag);
    return '<span class="badge" style="background:' + c + ';color:' + contrast(c) + '">' + esc(labelFor(tag)) + '</span>';
  }
  function nextTick() { return new Promise(function (r) { setTimeout(r, 0); }); }

  function fetchText(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' en ' + url);
      return r.text();
    });
  }
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' en ' + url);
      return r.json();
    });
  }

  let $ = function (id) { return document.getElementById(id); };
  let vp, spacer, rowsLayer, detailEl, countersEl, dashEl, progressEl, progressFill, progressLabel, resultsEl, resultsList, resultsHead, searchHint;

  let manifest = null;
  let chunkById = new Map();
  let ROOT = null;
  let topLevelNodes = [];
  let nodeByIndex = new Map();
  let chunkCache = new Map();
  let rows = [];
  let selectedRow = -1;
  let ROW_H = 22;
  let rafPending = false;
  let currentNode = null;
  let audit = null;
  let symlinkReport = null;
  let symlinkPromise = null;
  let S = { index: null };

  function chunkStart(id) {
    let c = chunkById.get(id);
    return c ? c.start : Number.MAX_SAFE_INTEGER;
  }

  function createTopLevel(t) {
    let node = {
      index: t.index, name: t.name, type: t.type, target: t.target || '',
      depth: 0, path: '/' + t.name, parentPath: '/', parent: ROOT,
      children: null, loaded: false, expanded: false,
      lazy: !!t.lazy, childCount: t.childCount || 0, chunkIds: null, chunk: t.chunk,
      loading: false, _anno: null
    };
    nodeByIndex.set(node.index, node);
    return node;
  }

  function parseChunk(cid, txt) {
    let lines = txt.split('\n');
    let h = lines[0].split('\t');
    let start = parseInt(h[1], 10), end = parseInt(h[2], 10), bd = parseInt(h[3], 10), pp = h[4];
    let stack = [];
    let baseNodes = [];
    let byIndex = new Map();
    let off = 0;
    for (let i = 1; i < lines.length; i++) {
      let L = lines[i];
      if (L === '') continue;
      let f = L.split('\t');
      let depth = parseInt(f[0], 10);
      let type = f[1], name = f[2], target = f[3] || '';
      let isLazy = f.length >= 6;
      let chunkIds = isLazy ? f[4] : null;
      let childCount = isLazy ? parseInt(f[5], 10) || 0 : 0;
      let g = start + off; off++;
      let parentPath = (depth === bd) ? pp : (stack[depth - 1] ? stack[depth - 1].path : pp);
      let path = parentPath === '/' ? ('/' + name) : (parentPath + '/' + name);
      let node = nodeByIndex.get(g);
      if (!node) {
        node = {
          index: g, name: name, type: type, target: target, depth: depth,
          path: path, parentPath: parentPath, parent: null, children: null,
          loaded: false, expanded: false, lazy: isLazy, childCount: childCount,
          chunkIds: chunkIds, chunk: cid, loading: false, _anno: null
        };
        nodeByIndex.set(g, node);
      } else {
        node.name = name; node.type = type; node.target = target; node.depth = depth;
        node.path = path; node.parentPath = parentPath; node.chunk = cid;
        if (isLazy) { node.lazy = true; if (chunkIds) node.chunkIds = chunkIds; node.childCount = childCount; }
      }
      stack[depth] = node;
      byIndex.set(g, node);
      if (depth === bd) {
        baseNodes.push(node);
      } else {
        let par = stack[depth - 1];
        if (par) {
          if (!par.children) par.children = [];
          par.children.push(node);
          node.parent = par;
        }
      }
    }
    byIndex.forEach(function (node) {
      if (!node.lazy) { node.loaded = true; if (!node.children) node.children = []; }
    });
    return { id: cid, start: start, end: end, bd: bd, pp: pp, baseNodes: baseNodes, byIndex: byIndex };
  }

  function loadChunk(cid) {
    if (chunkCache.has(cid)) return chunkCache.get(cid);
    let p = fetchText(TREE + 'chunk-' + cid + '.tsv').then(function (txt) {
      return parseChunk(cid, txt);
    });
    chunkCache.set(cid, p);
    p.catch(function () { chunkCache.delete(cid); });
    return p;
  }

  function doEnsure(node) {
    if (node === ROOT) {
      node.children = topLevelNodes;
      node.loaded = true;
      return Promise.resolve(node.children);
    }
    if (node.type !== 'd') {
      node.loaded = true;
      if (!node.children) node.children = [];
      return Promise.resolve(node.children);
    }
    if (node.lazy) {
      let pre = node.chunkIds ? Promise.resolve(null) : loadChunk(node.chunk);
      return pre.then(function () {
        let ids = String(node.chunkIds || '').split(',').map(function (s) { return parseInt(s, 10); })
          .filter(function (n) { return !isNaN(n); });
        ids.sort(function (a, b) { return chunkStart(a) - chunkStart(b); });
        let kids = node.children || [];
        let chain = Promise.resolve();
        ids.forEach(function (cid) {
          chain = chain.then(function () {
            return loadChunk(cid).then(function (res) {
              for (let k = 0; k < res.baseNodes.length; k++) {
                let bn = res.baseNodes[k];
                if (bn.parent !== node) bn.parent = node;
                if (!bn.parentPath) bn.parentPath = node.path;
                kids.push(bn);
              }
            });
          });
        });
        return chain.then(function () { node.children = kids; node.loaded = true; return kids; });
      });
    }
    return loadChunk(node.chunk).then(function () {
      node.loaded = true;
      if (!node.children) node.children = [];
      return node.children;
    });
  }

  function ensureChildren(node) {
    if (node.loaded) return Promise.resolve(node.children || []);
    if (node._loadP) return node._loadP;
    node._loadP = doEnsure(node).then(function (kids) {
      node._loadP = null;
      node.loaded = true;
      if (!node.children) node.children = [];
      return node.children;
    }, function (e) {
      node._loadP = null;
      throw e;
    });
    return node._loadP;
  }

  function flatten() {
    rows = [];
    let walk = function (node, depth) {
      let kids = node.children || [];
      for (let i = 0; i < kids.length; i++) {
        let c = kids[i];
        rows.push({ node: c, depth: depth });
        if (c.expanded && c.children && c.children.length) walk(c, depth + 1);
      }
    };
    walk(ROOT, 0);
  }

  function rowHtml(entry, i) {
    let n = entry.node, d = entry.depth;
    let canHaveKids = (n.type === 'd') && (n.lazy || (n.children && n.children.length) || !n.loaded || n.childCount > 0);
    let twisty = canHaveKids
      ? '<span class="twisty" data-toggle="' + n.index + '">' + (n.expanded ? '\u25be' : '\u25b8') + '</span>'
      : '<span class="twisty leaf">\u00b7</span>';
    let icon = '<span class="ticon ' + n.type + '">' + n.type + '</span>';
    let link = (n.type === 's' && n.target) ? '<span class="rlink"> \u2192 ' + esc(n.target) + '</span>' : '';
    let extra = '';
    if (n.loading) extra = '<span class="loading">cargando\u2026</span>';
    else if (n.lazy && !n.loaded) extra = '<span class="lazytag">lazy' + (n.childCount ? ' ' + n.childCount : '') + '</span>';
    let b = badge(getAnno(n) ? getAnno(n).hashtag : '');
    let pad = 6 + d * 14;
    let sel = (i === selectedRow) ? ' selected' : '';
    let exp = canHaveKids ? ' aria-expanded="' + (n.expanded ? 'true' : 'false') + '"' : '';
    return '<div class="row' + sel + '" id="row-' + n.index + '" role="treeitem" aria-level="' + (d + 1) + '"' +
      exp + ' aria-selected="' + (i === selectedRow ? 'true' : 'false') + '" data-row="' + i + '" data-g="' + n.index +
      '" style="padding-left:' + pad + 'px" title="' + esc(n.path) + '">' + twisty + icon +
      '<span class="rname' + (n.type === 's' ? ' islink' : '') + '">' + esc(n.name) + '</span>' + link + extra +
      '<span style="flex:0 0 auto;margin-left:8px">' + b + '</span></div>';
  }

  function render() {
    let total = rows.length * ROW_H;
    spacer.style.height = total + 'px';
    let h = vp.clientHeight || 400;
    let scrollTop = vp.scrollTop;
    let above = Math.max(0, Math.floor((WINDOW_ROWS - Math.ceil(h / ROW_H)) / 2));
    let first = Math.max(0, Math.floor(scrollTop / ROW_H) - above);
    let count = Math.min(WINDOW_ROWS, rows.length - first);
    if (count < 0) count = 0;
    rowsLayer.style.transform = 'translateY(' + (first * ROW_H) + 'px)';
    let parts = [];
    for (let i = first; i < first + count; i++) parts.push(rowHtml(rows[i], i));
    rowsLayer.innerHTML = parts.join('');
    if (selectedRow >= first && selectedRow < first + count && rows[selectedRow]) {
      vp.setAttribute('aria-activedescendant', 'row-' + rows[selectedRow].node.index);
    } else {
      vp.setAttribute('aria-activedescendant', '');
    }
  }

  function scheduleRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; render(); });
  }

  function scrollRowIntoView(i) {
    if (i < 0 || i >= rows.length) return;
    let h = vp.clientHeight;
    let top = i * ROW_H, bot = top + ROW_H;
    if (top < vp.scrollTop) vp.scrollTop = top;
    else if (bot > vp.scrollTop + h) vp.scrollTop = bot - h;
    render();
  }

  function selectRow(i) {
    if (i < 0 || i >= rows.length) return;
    selectedRow = i;
    render();
  }

  function toggleNode(node) {
    if (node.expanded) {
      node.expanded = false;
      flatten(); render();
      return;
    }
    if (!node.loaded) {
      node.loading = true;
      scheduleRender();
      ensureChildren(node).then(function () {
        node.loading = false;
        node.expanded = true;
        flatten(); render();
      }).catch(function (e) {
        node.loading = false;
        flatten(); render();
        window.alert('Error cargando el subárbol: ' + e.message);
      });
      return;
    }
    node.expanded = true;
    flatten(); render();
  }

  function revealPath(path) {
    searchHint.textContent = 'Revelando ' + path + '\u2026';
    let segs = String(path).split('/').filter(Boolean);
    let node = ROOT;
    let chain = Promise.resolve();
    let failed = false;
    segs.forEach(function (seg, idx) {
      chain = chain.then(function () {
        if (failed) return null;
        return ensureChildren(node).then(function () {
          let kids = node.children || [];
          let child = null;
          for (let k = 0; k < kids.length; k++) if (kids[k].name === seg) { child = kids[k]; break; }
          if (!child) { failed = true; return null; }
          node = child;
          if (idx < segs.length - 1) node.expanded = true;
        });
      });
    });
    return chain.then(function () {
      if (failed) { searchHint.textContent = 'No se pudo revelar ' + path; return null; }
      flatten(); render();
      let at = -1;
      for (let i = 0; i < rows.length; i++) if (rows[i].node === node) { at = i; break; }
      if (at >= 0) { selectRow(at); scrollRowIntoView(at); showDetail(node); }
      let pane = vp.closest('.panel');
      if (pane && pane.scrollIntoView) pane.scrollIntoView({ block: 'nearest' });
      searchHint.textContent = path;
      return node;
    });
  }

  function symlinkStatus(node) {
    return loadSymlinkReport().then(function (sr) {
      if (!sr) return { status: 'no verificado (sin symlink-report.json)', cls: 'muted' };
      if (sr.circular.has(node.path)) return { status: 'circular (roto)', cls: 'bad' };
      if (sr.broken.has(node.path)) return { status: 'roto', cls: 'bad' };
      if (sr.brokenOculto.has(node.path)) return { status: 'probablemente resoluble \u2014 destino oculto excluido del dump', cls: 'muted' };
      if (sr.pseudo && sr.pseudo.has(node.path)) return { status: 'resuelto (fs pseudo del kernel)', cls: 'ok' };
      return { status: 'resuelto', cls: 'ok' };
    }, function () { return { status: 'no verificado', cls: 'muted' }; });
  }

  function showDetail(node) {
    currentNode = node;
    if (!node) { detailEl.innerHTML = '<p class="detail-empty">\u2014</p>'; return; }
    let a = getAnno(node);
    let t = node.type;
    let an = (audit && audit.anomalyByPath) ? audit.anomalyByPath.get(node.path) : null;
    let html = '';
    html += '<div class="detail">';

    // 1. Cabecera: nombre + insignias (hashtag, tipo, severidad de auditoria)
    html += '<h3>' + esc(node.name) + '</h3>';
    html += '<div class="badges">';
    html += (a ? badge(a.hashtag) : '<span class="badge" style="background:#64748b;color:#fff">sin reglas</span>');
    html += '<span class="chip tipo">' + esc(TYPE_NAME[t] || t) + '</span>';
    if (an) html += '<span class="chip sev ' + esc(an.severity || 'info') + '">auditoría: ' + esc(an.severity || 'info') + '</span>';
    html += '</div>';

    // 2. Descripcion: resumen + detalle y ambito (rol)
    if (a && (a.descripcion_corta_ES || a.detalle)) {
      html += '<section class="sec"><h4>Descripción</h4>';
      if (a.rol) html += '<p class="rol"><span class="k">Ámbito</span> ' + esc(a.rol) + (a.categoria ? ' · ' + esc(a.categoria) : '') + '</p>';
      if (a.descripcion_corta_ES) html += '<p>' + esc(a.descripcion_corta_ES) + '</p>';
      if (a.detalle) html += '<p class="detalle">' + esc(a.detalle) + '</p>';
      html += '</section>';
    }

    // 3. Caracteristicas tecnicas (tabla clave -> valor inferida por la KB)
    let chars = (a && a.caracteristicas) ? a.caracteristicas.slice() : [];
    if (a) {
      if (a.formato) chars.unshift({ clave: 'Formato', valor: a.formato });
      if (a.estandar) chars.push({ clave: 'Estándar', valor: a.estandar });
    }
    if (chars.length) {
      html += '<section class="sec"><h4>Características técnicas</h4><table class="kv">';
      for (let i = 0; i < chars.length; i++) {
        html += '<tr><th>' + esc(chars[i].clave) + '</th><td>' + esc(chars[i].valor) + '</td></tr>';
      }
      html += '</table></section>';
    }

    // 4. Ubicacion y estructura del nodo
    let nivel = node.path === '/' ? 0 : node.path.split('/').length - 1;
    html += '<section class="sec"><h4>Ubicación y estructura</h4><table class="kv">';
    html += '<tr><th>Ruta</th><td class="path">' + esc(node.path) + '</td></tr>';
    if (a && a.estandar) html += '<tr><th>Nivel FHS</th><td>' + esc(a.estandar) + '</td></tr>';
    html += '<tr><th>Profundidad</th><td>' + nivel + '</td></tr>';
    html += '<tr><th>Línea aprox.</th><td class="mono">' + (node.index + 1) + '</td></tr>';
    if (t === 'd') {
      let kidsTxt = node.loaded ? String((node.children || []).length) : (node.lazy ? ('lazy \u00b7 ' + (node.childCount || '?')) : String(node.childCount || 0));
      html += '<tr><th>Hijos</th><td>' + kidsTxt + '</td></tr>';
    }
    html += '</table></section>';

    // 5. Enlace simbolico (solo para symlinks)
    if (t === 's') {
      let abs = node.target && node.target.charAt(0) === '/';
      html += '<section class="sec"><h4>Enlace simbólico</h4><table class="kv">';
      html += '<tr><th>Destino</th><td class="path">' + esc(node.target || '(vacío)') + '</td></tr>';
      html += '<tr><th>Tipo destino</th><td>' + (abs ? 'absoluto' : 'relativo') + '</td></tr>';
      html += '<tr><th>Estado</th><td id="sym-status" class="muted">comprobando\u2026</td></tr>';
      html += '</table></section>';
    }

    // 6. Fuentes de referencia tipadas (fallback a enlaces clasicos)
    let fuentes = (a && a.fuentes && a.fuentes.length) ? a.fuentes
      : ((a && a.enlaces) ? a.enlaces.map(function (l) { return { texto: l.texto, url: l.url, tipo: '' }; }) : []);
    if (fuentes.length) {
      html += '<section class="sec"><h4>Fuentes de referencia</h4><ul class="links">';
      for (let i = 0; i < fuentes.length; i++) {
        let l = fuentes[i];
        html += '<li>' + (l.tipo ? '<span class="ftipo">' + esc(l.tipo) + '</span> ' : '') +
          '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.texto || l.url) + '</a></li>';
      }
      html += '</ul></section>';
    }

    // 7. Auditoria (anomalia detectada para este nodo)
    if (an) {
      html += '<section class="sec"><h4>Auditoría</h4><div class="anom ' + esc(an.severity || 'info') + '">' +
        '<div><span class="sev">' + esc(an.severity || 'info') + '</span> \u00b7 ' + esc(an.class || '') + '</div>' +
        '<div>' + esc(an.message || '') + '</div>' +
        (an.link ? '<div><a href="' + esc(an.link) + '" target="_blank" rel="noopener">más información</a></div>' : '') +
        '</div></section>';
    }

    html += '</div>';
    detailEl.innerHTML = html;
    if (audit === null) {
      loadAudit().then(function () { if (currentNode === node) showDetail(node); });
    }
    if (t === 's') {
      symlinkStatus(node).then(function (st) {
        let el = $('sym-status');
        if (el) { el.textContent = st.status; el.className = st.cls; }
      });
    }
  }

  function loadAudit() {
    if (audit !== null) return Promise.resolve(audit);
    return fetchJSON(DATA + 'audit-report.json').then(function (j) {
      let m = new Map();
      (j.anomalies || []).forEach(function (an) { if (an && an.path) m.set(an.path, an); });
      audit = { raw: j, anomalyByPath: m };
      return audit;
    }).catch(function () { audit = false; return false; });
  }

  function loadSymlinkReport() {
    if (symlinkReport) return Promise.resolve(symlinkReport);
    if (symlinkPromise) return symlinkPromise;
    symlinkPromise = fetchJSON(DATA + 'symlink-report.json').then(function (j) {
      let b = j.buckets || {};
      let mk = function (arr) { let s = new Set(); (arr || []).forEach(function (x) { if (x && x.path) s.add(x.path); }); return s; };
      let okSet = new Set();
      (b.mergedUsr || []).forEach(function (x) { if (x && x.path) okSet.add(x.path); });
      (b.systemdEnable || []).forEach(function (x) { if (x && x.path) okSet.add(x.path); });
      (j.linkCount && typeof j.linkCount === 'object' ? Object.keys(j.linkCount) : []).forEach(function (p) { okSet.add(p); });
      symlinkReport = {
        broken: mk(b.broken), brokenOculto: mk(b.brokenOculto), circular: mk(b.circular), pseudo: mk(b.pseudo), ok: okSet, stats: j.stats || {}
      };
      return symlinkReport;
    }).catch(function () { symlinkReport = { broken: new Set(), brokenOculto: new Set(), circular: new Set(), pseudo: new Set(), ok: new Set(), stats: {} }; return symlinkReport; });
    return symlinkPromise;
  }

  function setProgress(frac, label) {
    if (progressFill) progressFill.style.width = Math.round(frac * 100) + '%';
    if (label && progressLabel) progressLabel.textContent = label;
  }
  function showProgress(label) {
    if (label && progressLabel) progressLabel.textContent = label;
    if (progressEl) progressEl.classList.add('on');
    if (progressFill) progressFill.style.width = '0%';
  }
  function hideProgress() {
    if (progressEl) progressEl.classList.remove('on');
  }

  function buildIndex() {
    if (S.index) return Promise.resolve(S.index);
    let n = manifest.counts.entries + 1;
    let paths = new Array(n);
    let types = new Uint8Array(n);
    let map = new Map();
    let chunks = manifest.chunks;
    showProgress('Construyendo índice de búsqueda\u2026');
    let i = 0;
    let step = function () {
      if (i >= chunks.length) {
        S.index = { paths: paths, types: types, map: map, size: n };
        searchHint.textContent = 'Índice listo: ' + manifest.counts.entries.toLocaleString('es') + ' nodos.';
        hideProgress();
        return S.index;
      }
      let c = chunks[i];
      return fetchText(TREE + 'chunk-' + c.id + '.tsv').then(function (txt) {
        let lines = txt.split('\n');
        let h = lines[0].split('\t');
        let start = parseInt(h[1], 10), bd = parseInt(h[3], 10), pp = h[4];
        let stack = []; stack[bd - 1] = pp;
        let off = 0;
        for (let li = 1; li < lines.length; li++) {
          let L = lines[li];
          if (L === '') continue;
          let f = L.split('\t');
          let depth = parseInt(f[0], 10), type = f[1], name = f[2];
          let parent = depth === bd ? pp : stack[depth - 1];
          let path = parent === '/' ? ('/' + name) : (parent + '/' + name);
          stack[depth] = path;
          let g = start + off; off++;
          paths[g] = path;
          types[g] = CHAR_CODE[type] != null ? CHAR_CODE[type] : 0;
          let key = name.toLowerCase();
          let arr = map.get(key);
          if (arr === undefined) { arr = []; map.set(key, arr); }
          arr.push(g);
        }
        i++;
        if (i % 6 === 0 || i === chunks.length) {
          setProgress(i / chunks.length, 'Indexando ' + i + '/' + chunks.length + ' chunks\u2026');
          return nextTick().then(step);
        }
        return step();
      });
    };
    return Promise.resolve().then(step);
  }

  function runSearch() {
    let btn = $('btn-search');
    btn.disabled = true;
    let pre = S.index ? Promise.resolve() : Promise.resolve().then(buildIndex);
    return pre.then(function () {
      return loadAudit();
    }).then(function () {
      let q = $('f-name').value.trim().toLowerCase();
      let tf = $('f-type').value;
      let tag = $('f-tag').value;
      let anom = $('f-anom').checked;
      let idx = S.index;
      let found = [];
      let capped = false;
      let consider = function (g) {
        let t = TYPE_CHAR[idx.types[g]];
        if (tf && t !== tf) return;
        let p = idx.paths[g];
        if (tag) {
          let a = null;
          try { a = annotate(p, t, ''); } catch (e) { a = null; }
          if (!a || a.hashtag !== tag) return;
        }
        if (anom) { if (!audit || !audit.anomalyByPath.has(p)) return; }
        if (found.length >= CAP_RESULTS) { capped = true; return; }
        found.push(g);
      };
      if (q) {
        idx.map.forEach(function (arr, k) {
          if (capped) return;
          if (k.indexOf(q) !== -1) {
            for (let j = 0; j < arr.length; j++) { consider(arr[j]); if (capped) break; }
          }
        });
      } else {
        for (let g = 1; g < idx.size; g++) { consider(g); if (capped) break; }
      }
      renderResults(found, q, tf, tag, anom, capped, idx);
    }).catch(function (e) {
      window.alert('Error en la búsqueda: ' + e.message);
    }).then(function () {
      btn.disabled = false;
      hideProgress();
    });
  }

  function renderResults(found, q, tf, tag, anom, capped, idx) {
    let bits = [];
    if (q) bits.push('nombre~"' + q + '"');
    if (tf) bits.push('tipo=' + tf);
    if (tag) bits.push(tag);
    if (anom) bits.push('solo anomalías');
    resultsEl.hidden = false;
    resultsHead.textContent = found.length.toLocaleString('es') + (capped ? '+' : '') +
      ' resultado(s)' + (bits.length ? ' \u00b7 filtros: ' + bits.join(', ') : '');
    if (found.length === 0) {
      resultsList.innerHTML = '<div style="padding:10px" class="muted">Sin coincidencias.</div>';
      return;
    }
    let max = Math.min(found.length, SHOW_RESULTS);
    let parts = [];
    for (let i = 0; i < max; i++) {
      let g = found[i];
      let p = idx.paths[g];
      let t = TYPE_CHAR[idx.types[g]];
      parts.push('<button class="result" role="option" type="button" data-path="' + esc(p) + '" data-g="' + g + '">' +
        '<span class="rtype">' + t + '</span><span class="rpath">' + esc(p) + '</span></button>');
    }
    if (found.length > max) parts.push('<div style="padding:8px 10px" class="muted">\u2026 y ' + (found.length - max).toLocaleString('es') + ' más (muestre ' + SHOW_RESULTS + '). Afine la búsqueda.</div>');
    resultsList.innerHTML = parts.join('');
  }

  function renderCounters() {
    let c = manifest.counts;
    let items = [
      ['entradas', c.entries], ['symlinks', c.symlinks], ['directorios', c.directories],
      ['ficheros', c.files], ['chunks', c.chunks], ['lazy', c.lazyNodes], ['sin match', c.unmatched]
    ];
    countersEl.innerHTML = items.map(function (it) {
      return '<li class="chip">' + esc(it[0]) + ' <b>' + Number(it[1]).toLocaleString('es') + '</b></li>';
    }).join('');
  }

  function renderDashboard() {
    let parts = manifest.topLevel.map(function (t) {
      let path = '/' + t.name;
      let a = annotate(path, t.type, t.target);
      let tt = t.lazy ? ('lazy \u00b7 ' + (t.childCount || '?')) : ((t.childCount || 0) + ' hijos');
      return '<button class="card" type="button" data-path="' + esc(path) + '">' +
        '<span class="name"><span class="ticon ' + t.type + '">' + t.type + '</span>' + esc(t.name) + '</span>' +
        '<span>' + badge(a ? a.hashtag : '') + '</span>' +
        '<span class="meta"><span class="ttype">' + t.type + '</span><span>' + tt + '</span>' +
        (t.target ? '<span>\u2192 ' + esc(t.target) + '</span>' : '') + '</span></button>';
    });
    dashEl.innerHTML = parts.join('');
  }

  function renderTagOptions() {
    let sel = $('f-tag');
    let t = taxonomy();
    let parts = ['<option value="">cualquiera</option>'];
    t.forEach(function (x) { parts.push('<option value="' + esc(x.tag) + '">' + esc(x.tag + ' \u00b7 ' + (x.label_es || '')) + '</option>'); });
    sel.innerHTML = parts.join('');
  }

  function wireEvents() {
    vp.addEventListener('scroll', scheduleRender, { passive: true });
    window.addEventListener('resize', scheduleRender);

    rowsLayer.addEventListener('click', function (e) {
      let row = e.target.closest('.row');
      if (!row) return;
      let i = parseInt(row.getAttribute('data-row'), 10);
      let entry = rows[i];
      if (!entry) return;
      let tw = e.target.closest('.twisty');
      if (tw) { e.stopPropagation(); toggleNode(entry.node); return; }
      selectRow(i);
      showDetail(entry.node);
    });

    vp.addEventListener('keydown', function (e) {
      if (!rows.length) return;
      if (selectedRow < 0) selectedRow = 0;
      let entry = rows[selectedRow];
      let node = entry.node;
      if (e.key === 'ArrowDown') { e.preventDefault(); selectRow(Math.min(rows.length - 1, selectedRow + 1)); scrollRowIntoView(selectedRow); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); selectRow(Math.max(0, selectedRow - 1)); scrollRowIntoView(selectedRow); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (node.type === 'd' && !node.expanded) toggleNode(node); else selectRow(Math.min(rows.length - 1, selectedRow + 1)); }
      else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (node.expanded) toggleNode(node);
        else {
          let d = entry.depth;
          for (let k = selectedRow - 1; k >= 0; k--) if (rows[k].depth < d) { selectRow(k); scrollRowIntoView(k); break; }
        }
      }
      else if (e.key === 'Home') { e.preventDefault(); selectRow(0); scrollRowIntoView(0); }
      else if (e.key === 'End') { e.preventDefault(); selectRow(rows.length - 1); scrollRowIntoView(rows.length - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (node.type === 'd') toggleNode(node); showDetail(node); }
    });

    dashEl.addEventListener('click', function (e) {
      let card = e.target.closest('.card');
      if (!card) return;
      revealPath(card.getAttribute('data-path'));
    });

    resultsList.addEventListener('click', function (e) {
      let b = e.target.closest('.result');
      if (!b) return;
      revealPath(b.getAttribute('data-path'));
    });

    $('btn-search').addEventListener('click', runSearch);
    $('f-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
    $('btn-clear').addEventListener('click', function () {
      $('f-name').value = ''; $('f-type').value = ''; $('f-tag').value = ''; $('f-anom').checked = false;
      resultsEl.hidden = true; searchHint.textContent = '';
    });
  }

  function init() {
    vp = $('tree-viewport');
    spacer = $('tree-spacer');
    rowsLayer = $('tree-rows');
    detailEl = $('detail');
    countersEl = $('counters');
    dashEl = $('dashboard');
    progressEl = $('progress');
    progressFill = $('progress-fill');
    progressLabel = $('progress-label');
    resultsEl = $('results');
    resultsList = $('results-list');
    resultsHead = $('results-head');
    searchHint = $('search-hint');

    let rh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h'));
    if (rh) ROW_H = rh;

    loadAudit();
    loadSymlinkReport();

    fetchJSON(DATA + 'manifest.json').then(function (m) {
      manifest = m;
      chunkById = new Map(manifest.chunks.map(function (c) { return [c.id, c]; }));
      ROOT = {
        index: 0, name: '/', type: 'd', target: '', depth: -1, path: '/', parentPath: null,
        parent: null, children: null, loaded: false, expanded: true, lazy: false,
        childCount: manifest.topLevel.length, chunkIds: null, chunk: null, loading: false, _anno: null
      };
      nodeByIndex.set(0, ROOT);
      topLevelNodes = manifest.topLevel.map(createTopLevel);

      renderCounters();
      renderDashboard();
      renderTagOptions();
      wireEvents();

      return ensureChildren(ROOT).then(function () {
        flatten();
        render();
      });
    }).catch(function (e) {
      let banner = document.createElement('p');
      banner.style.cssText = 'margin:18px;padding:12px;border:1px solid #6e2320;background:#2a1211;border-radius:8px;color:#ffb4ae';
      banner.textContent = 'No se pudo cargar data/manifest.json (' + e.message + '). Sirve el proyecto por HTTP con ./web/launch.sh (no abras el fichero con file://).';
      document.body.insertBefore(banner, document.body.firstChild);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
