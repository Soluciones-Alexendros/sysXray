'use strict';
/*
 * emit.js — Chunker + TSV writer for the parsed filesystem tree.
 *
 * Splits the flat preorder array into contiguous "sibling group" chunks so the
 * browser never has to load 3.2M records. A chunk is a contiguous range of the
 * preorder array covering a whole set of consecutive siblings (each with its
 * full subtree). Any subtree larger than LIMIT is emitted as a 1-record "lazy"
 * chunk that carries the IDs of the chunks holding its children.
 *
 * Chunk file (data/tree/chunk-<id>.tsv):
 *   #<id>\t<start>\t<end>\t<baseDepth>\t<parentPath>
 *   <depth>\t<d|f|s>\t<name>\t<target>          (one per record)
 *   ...a lazy chunk's single record appends: \t<childrenCSV>\t<childCount>
 */

const fs = require('fs');
const path = require('path');

const LIMIT = 40000;

function typeChar(t) {
  return t === 2 ? 's' : t === 0 ? 'd' : 'f';
}

/**
 * @param {object} P result of parse()
 * @param {string} outDir directory where chunk-*.tsv are written
 * @returns {{chunks:object[], topLevel:object[], lazyCount:number}}
 */
function emit(P, outDir) {
  const { N, depth, type, parent, end, name, target } = P;
  fs.mkdirSync(outDir, { recursive: true });

  // child / sibling adjacency (skip root at index 0)
  const firstChild = new Int32Array(N).fill(-1);
  const nextSibling = new Int32Array(N).fill(-1);
  let lastChild = new Int32Array(N).fill(-1);
  for (let i = 1; i < N; i++) {
    const p = parent[i];
    if (p < 0) continue;
    if (firstChild[p] === -1) firstChild[p] = i;
    else nextSibling[lastChild[p]] = i;
    lastChild[p] = i;
  }

  const pathCache = new Map();
  function getPath(i) {
    if (pathCache.has(i)) return pathCache.get(i);
    const nm = name[i];
    const p = parent[i];
    let full;
    if (p < 0) full = '/';
    else {
      const base = getPath(p);
      full = base === '/' ? '/' + nm : base + '/' + nm;
    }
    pathCache.set(i, full);
    return full;
  }

  function countChildren(p) {
    let c = 0;
    for (let i = firstChild[p]; i !== -1; i = nextSibling[i]) c++;
    return c;
  }

  const chunks = [];
  let chunkId = 0;
  let lazyCount = 0;

  function writeChunk(start, endIdx, baseDepth, parentPath, lazy) {
    const id = chunkId++;
    const parts = ['#' + id + '\t' + start + '\t' + endIdx + '\t' + baseDepth + '\t' + String(parentPath).replace(/\t/g, ' ')];
    for (let i = start; i <= endIdx; i++) {
      let rec = depth[i] + '\t' + typeChar(type[i]) + '\t' + name[i] + '\t' + (target[i] || '');
      if (lazy && i === start) rec += '\t' + lazy.children.join(',') + '\t' + lazy.childCount;
      parts.push(rec);
    }
    fs.writeFileSync(path.join(outDir, 'chunk-' + id + '.tsv'), parts.join('\n') + '\n');
    chunks.push({ id, start, end: endIdx, baseDepth, parentPath, count: endIdx - start + 1 });
    return id;
  }

  function processChildren(p, parentPath) {
    const produced = [];
    let accStart = -1;
    let accEnd = -1;
    let accCount = 0;
    const flush = () => {
      if (accCount > 0) {
        produced.push(writeChunk(accStart, accEnd, depth[accStart], parentPath, null));
        accStart = -1;
        accEnd = -1;
        accCount = 0;
      }
    };
    for (let c = firstChild[p]; c !== -1; c = nextSibling[c]) {
      const size = end[c] - c + 1;
      if (size > LIMIT) {
        flush();
        const childPath = getPath(c);
        const grandIds = processChildren(c, childPath);
        const childCount = countChildren(c);
        lazyCount++;
        const id = writeChunk(c, c, depth[c], parentPath, { children: grandIds, childCount });
        produced.push(id);
      } else {
        if (accCount > 0 && accCount + size > LIMIT) flush();
        if (accStart === -1) accStart = c;
        accEnd = end[c];
        accCount += size;
      }
    }
    flush();
    return produced;
  }

  processChildren(0, '/');

  const topLevel = [];
  for (let c = firstChild[0]; c !== -1; c = nextSibling[c]) {
    topLevel.push({
      name: name[c],
      type: typeChar(type[c]),
      target: target[c] || null,
      index: c,
      lazy: end[c] - c + 1 > LIMIT,
      childCount: countChildren(c),
      chunks: null,
    });
  }

  return { chunks, topLevel, lazyCount };
}

module.exports = { emit, LIMIT };
