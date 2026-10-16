'use strict';

(function () {
  var DATA = '../data/';
  var DOCS = '../docs/';

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fichaFile(authorityId) {
    var map = {
      'authority-fhs-3.0': 'fhs-3.0.json',
      'authority-hier-7': 'hier-7.json',
      'authority-uapi-file-hierarchy': 'uapi-file-hierarchy.json',
      'authority-xdg': 'xdg.json',
      'authority-gnu': 'gnu.json',
      'authority-redhat': 'redhat.json',
      'authority-secure-boot-lockdown': 'secure-boot-lockdown.json',
      'authority-grub-ordenes': 'grub-ordenes.json'
    };
    return map[authorityId] || null;
  }

  function renderJudgmentCard(j, ficha) {
    var cls = (j.verdict === 'desacuerdo') ? 'desacuerdo' : (j.verdict === 'acuerdo' ? 'acuerdo' : '');
    var title = ficha ? ficha.title : j.authority;
    var contrast = ficha && ficha.contrast_verdict
      ? '<p>Contraste de fuente: <code>' + esc(ficha.contrast_verdict) + '</code></p>'
      : '';
    var url = ficha && ficha.source_url
      ? '<p><a href="' + esc(ficha.source_url) + '" rel="noopener">fuente</a></p>'
      : '';
    return (
      '<article class="card ' + cls + '">' +
        '<h3>' + esc(title) + '</h3>' +
        '<p class="verdict">Veredicto: ' + esc(j.verdict) + '</p>' +
        '<p>Sobre: <code>' + esc(j.statement) + '</code></p>' +
        contrast + url +
      '</article>'
    );
  }

  function loadFicha(authorityId) {
    var file = fichaFile(authorityId);
    if (!file) return Promise.resolve(null);
    return fetchJSON(DOCS + file).catch(function () { return null; });
  }

  function showBinCase(judgments) {
    var bin = judgments.filter(function (j) {
      return j.statement === '/bin' || j.id.indexOf('bin') !== -1;
    });
    var host = document.getElementById('bin-judgments');
    if (!bin.length) {
      host.innerHTML = '<p class="empty">Sin juicios semilla de /bin.</p>';
      return Promise.resolve();
    }
    return Promise.all(bin.map(function (j) {
      return loadFicha(j.authority).then(function (f) {
        return renderJudgmentCard(j, f);
      });
    })).then(function (htmls) {
      host.innerHTML = htmls.join('');
    });
  }

  function showPlates(index) {
    var host = document.getElementById('plates-list');
    if (!index || !index.plates || !index.plates.length) {
      host.innerHTML = '<p class="empty">No hay placas publicadas. Ingiere una en local con <code>node build/plate-ingest.js</code>.</p>';
      return;
    }
    Promise.all(index.plates.map(function (entry) {
      return fetchJSON(DATA + 'plates/' + entry.file).then(function (p) {
        var stmts = (p.statements || []).map(function (s) {
          return esc(s.subject) + ' ' + esc(s.relation) +
            (s.object_text ? ' → ' + esc(s.object_text) : '') +
            ' [' + esc(s.support) + ']';
        }).join('<br>');
        return (
          '<article class="card">' +
            '<h3><code>' + esc(p.id) + '</code></h3>' +
            '<p>' + esc(p.instrument) + ' · ' + esc(p.regime) + ' · ' + esc(p.role) + '</p>' +
            '<p>Horizontes: ' + esc((p.horizons || []).map(function (h) { return h.kind; }).join(', ')) + '</p>' +
            '<p>' + (stmts || '<em>sin afirmaciones tipadas</em>') + '</p>' +
            (p.body ? '<pre class="body">' + esc(p.body.slice(0, 4000)) + '</pre>' : '') +
          '</article>'
        );
      }).catch(function () {
        return '<article class="card"><h3>' + esc(entry.id || entry.file) + '</h3><p class="empty">No legible</p></article>';
      });
    })).then(function (htmls) {
      host.innerHTML = htmls.join('');
    });
  }

  function showAllJudgments(judgments) {
    var host = document.getElementById('judgments-list');
    Promise.all(judgments.map(function (j) {
      return loadFicha(j.authority).then(function (f) {
        return renderJudgmentCard(j, f);
      });
    })).then(function (htmls) {
      host.innerHTML = htmls.length ? htmls.join('') : '<p class="empty">Sin juicios.</p>';
    });
  }

  Promise.all([
    fetchJSON(DATA + 'judgments/index.json').catch(function () { return { judgments: [] }; }),
    fetchJSON(DATA + 'plates/index.json').catch(function () { return { plates: [] }; })
  ]).then(function (pair) {
    var jIndex = pair[0];
    var pIndex = pair[1];
    var files = (jIndex.judgments || []).map(function (e) {
      return fetchJSON(DATA + 'judgments/' + e.file);
    });
    return Promise.all(files).then(function (judgments) {
      return showBinCase(judgments).then(function () {
        showAllJudgments(judgments);
        showPlates(pIndex);
      });
    });
  }).catch(function (e) {
    document.getElementById('plates-list').innerHTML =
      '<p class="empty">Error: ' + esc(e.message) + '</p>';
  });
})();
