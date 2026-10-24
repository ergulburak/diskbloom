'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { demoLines } = require('../src/main/demo');
const { Tree, LineParser } = require('../src/main/tree');

function demoTree() {
  const t = new Tree('C:\\');
  new LineParser(t).feed(demoLines().join('\n') + '\n');
  return t;
}

test('demo drive is deterministic and large enough to look real', () => {
  assert.deepStrictEqual(demoLines().slice(0, 50), demoLines().slice(0, 50));
  const t = demoTree();
  assert.ok(t.fileCount > 150000, `files: ${t.fileCount}`);
  const gb = t.totalSize / 1024 ** 3;
  assert.ok(gb > 400 && gb < 470, `size: ${gb}`);
});

test('childPaths lists folders and files of a folder', () => {
  const t = demoTree();
  const kids = t.childPaths('C:\\Users\\alex\\Videos');
  assert.ok(kids.includes('C:\\Users\\alex\\Videos\\Movies'));
  assert.ok(kids.includes('C:\\Users\\alex\\Videos\\Birthday.mov'));
  assert.ok(t.childPaths('C:\\').includes('C:\\Windows'));
  assert.deepStrictEqual(t.childPaths('C:\\nope'), []);
});
