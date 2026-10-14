'use strict';
/*
 * parse.js — Streaming parser for the `tree -a /` dump.
 *
 * Input : a tree(1)-style dump (box-drawing glyphs, `⇒` for symlink targets).
 * Output: flat preorder arrays describing every node of the filesystem.
 *
 * Design notes
 * ------------
 * - depth is derived from the number of 4-char indentation units *before* the
 *   branch marker (`├── ` / `└── `), NOT from counting `│` characters. The last
 *   sibling in each directory omits the vertical bar, so `│`-counting would
 *   misclassify whole subtrees.
 * - The dump carries no metadata (no sizes, no permissions, no file/dir flag).
 *   A node is a directory iff a deeper line follows it in preorder.
 * - Symlinks are the only explicitly typed nodes (`name ⇒ target`).
 */

const fs = require('fs');
const readline = require('readline');

// U+2502 │   U+251C ├   U+2500 ─   U+2514 └   U+21D2 ⇒
const LINE_RE = /^((?:\u2502   |    )*)(?:\u251C\u2500\u2500 |\u2514\u2500\u2500 )(.*)$/u;
const ARROW = ' \u21D2 ';

/**
 * @param {string} filePath
 * @returns {Promise<{N:number, depth:Int8Array, type:Uint8Array, parent:Int32Array,
 *                    end:Int32Array, line:Int32Array, name:string[], target:(string|null)[],
 *                    unmatched:number[]}>}
 *   type: 0 = directorio, 1 = fichero, 2 = enlace simbólico
 */
async function parse(filePath) {
  const depth = [];
  const type = [];
  const name = [];
  const target = [];
  const line = [];
  const unmatched = [];
  let n = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const raw of rl) {
    const ln = n + 1;
    if (n === 0) {
      // Root line: `.`
      depth.push(-1);
      type.push(0);
      name.push('.');
      target.push(null);
      line.push(ln);
      n++;
      continue;
    }
    if (raw === '') continue;

    const m = LINE_RE.exec(raw);
    if (!m) {
      // Should never happen on a well-formed dump; record and keep going.
      unmatched.push(ln);
      depth.push(0);
      type.push(1);
      name.push(raw);
      target.push(null);
      line.push(ln);
      n++;
      continue;
    }

    const d = m[1].length / 4;
    let nm = m[2];
    let tg = null;
    const ai = nm.indexOf(ARROW);
    if (ai >= 0) {
      tg = nm.slice(ai + ARROW.length);
      nm = nm.slice(0, ai);
    }
    depth.push(d);
    type.push(tg !== null ? 2 : 1);
    name.push(nm);
    target.push(tg);
    line.push(ln);
    n++;
  }

  const N = n;
  const depthArr = new Int8Array(N);
  const typeArr = new Uint8Array(N);
  const parentArr = new Int32Array(N).fill(-1);
  const endArr = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    depthArr[i] = depth[i];
    typeArr[i] = type[i];
  }

  // Subtree bounds + parents via a monotonic stack (preorder).
  const stack = [];
  for (let i = 0; i < N; i++) {
    const di = depthArr[i];
    while (stack.length && depthArr[stack[stack.length - 1]] >= di) {
      endArr[stack.pop()] = i - 1;
    }
    parentArr[i] = stack.length ? stack[stack.length - 1] : -1;
    stack.push(i);
  }
  while (stack.length) endArr[stack.pop()] = N - 1;

  // Reclassify: any node with descendants is a directory (symlinks excepted).
  for (let i = 0; i < N; i++) {
    if (endArr[i] > i && typeArr[i] !== 2) typeArr[i] = 0;
  }

  return {
    N,
    depth: depthArr,
    type: typeArr,
    parent: parentArr,
    end: endArr,
    line: Int32Array.from(line),
    name,
    target,
    unmatched,
  };
}

module.exports = { parse, ARROW };
