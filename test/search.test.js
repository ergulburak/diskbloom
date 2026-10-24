'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Tree, LineParser } = require('../src/main/tree');

const DAY = 86400, NOW = 1790000000;

function fixture() {
  const t = new Tree('C:\\');
  new LineParser(t).feed([
    'D\t1\t0\tMedia',
    'D\t2\t1\tOld',
    `F\t2\t5000\tholiday.mp4\t${NOW - 900 * DAY}`,
    `F\t2\t300\tnotes.txt\t${NOW - 800 * DAY}`,
    'D\t3\t1\tNew',
    `F\t3\t4000\tclip.MKV\t${NOW - 2 * DAY}`,
    `F\t3\t100\tclip.srt\t${NOW - 2 * DAY}`,
    'D\t4\t0\tWork',
    `F\t4\t700\treport.pdf\t${NOW - 10 * DAY}`,
    'F\t4\t50\tno-time.txt',
    'X',
  ].join('\n') + '\n');
  return t;
}

const names = r => r.items.map(i => i.name);

test('search with no filter lists the largest files first', () => {
  const r = fixture().search('C:\\');
  assert.deepStrictEqual(names(r), ['holiday.mp4', 'clip.MKV', 'report.pdf', 'notes.txt', 'clip.srt', 'no-time.txt']);
  assert.strictEqual(r.count, 6);
  assert.strictEqual(r.size, 10150);
  assert.strictEqual(r.items[0].path, 'C:\\Media\\Old\\holiday.mp4');
  assert.strictEqual(r.items[0].mtime, NOW - 900 * DAY);
});

test('search filters by text, pattern, type, size and age', () => {
  const t = fixture();
  assert.deepStrictEqual(names(t.search('C:\\', { text: 'CLIP' })), ['clip.MKV', 'clip.srt']);
  assert.deepStrictEqual(names(t.search('C:\\', { text: '*.mkv' })), ['clip.MKV']);
  assert.deepStrictEqual(names(t.search('C:\\', { text: 'c?ip.*' })), ['clip.MKV', 'clip.srt']);
  assert.deepStrictEqual(names(t.search('C:\\', { type: 'video' })), ['holiday.mp4', 'clip.MKV']);
  assert.deepStrictEqual(names(t.search('C:\\', { minSize: 1000 })), ['holiday.mp4', 'clip.MKV']);
  // A file without a known time never counts as old.
  assert.deepStrictEqual(names(t.search('C:\\', { before: NOW - 365 * DAY })), ['holiday.mp4', 'notes.txt']);
  assert.deepStrictEqual(names(t.search('C:\\Media\\New')), ['clip.MKV', 'clip.srt']);
  assert.deepStrictEqual(names(t.search('C:\\', { limit: 2 })), ['holiday.mp4', 'clip.MKV']);
});

test('folder search lists a matching folder once and uses its newest file for age', () => {
  const t = fixture();
  assert.deepStrictEqual(names(t.search('C:\\', { kind: 'dirs', before: NOW - 365 * DAY })), ['Old']);
  assert.deepStrictEqual(names(t.search('C:\\', { kind: 'dirs', text: 'e' })), ['Media']);
  assert.deepStrictEqual(names(t.search('C:\\', { kind: 'dirs', type: 'document' })), ['Work']);
  assert.strictEqual(t.search('C:\\', { kind: 'dirs', text: 'old' }).items[0].newest, NOW - 800 * DAY);
});

test('search of a missing path or a file is empty', () => {
  const t = fixture();
  assert.deepStrictEqual(t.search('C:\\nope'), { items: [], count: 0, size: 0 });
  assert.deepStrictEqual(t.search('C:\\Work\\report.pdf'), { items: [], count: 0, size: 0 });
});
