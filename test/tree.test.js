'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Tree, LineParser } = require('../src/main/tree');

function sample() {
  const t = new Tree('C:\\');
  const p = new LineParser(t);
  p.feed('D\t1\t0\tUsers\nD\t2\t1\tburak\nD\t3\t2\tVideos\nF\t3\t800\ta.mp4\nF\t3\t200\tb');
  p.feed('.mkv\nF\t2\t50\tnote.txt\nD\t4\t0\t$Recycle.Bin\nE\t4\nF\t0\t1000\tpagefile.sys\nX\n');
  return { t, p };
}

test('parser rolls sizes and counts up to every ancestor', () => {
  const { t, p } = sample();
  assert.strictEqual(p.done, true);
  assert.strictEqual(t.totalSize, 2050);
  assert.strictEqual(t.root.files, 4);
  assert.strictEqual(t.find('C:\\Users').dir.size, 1050);
  assert.strictEqual(t.find('c:\\users\\BURAK\\videos').dir.size, 1000);
  assert.strictEqual(t.errorCount, 1);
});

test('chunk boundaries inside a line are handled', () => {
  const { t } = sample();
  const hit = t.find('C:\\Users\\burak\\Videos\\b.mkv');
  assert.ok(hit && hit.index === 1);
});

test('view sorts children by size and folds small ones into rest', () => {
  const { t } = sample();
  const v = t.view('C:\\', 4, [2, 2]);
  assert.strictEqual(v.path, 'C:\\');
  assert.deepStrictEqual(v.children.map(c => c.name), ['Users', 'pagefile.sys', '']);
  assert.strictEqual(v.children[2].kind, 'rest');
  assert.strictEqual(v.children[1].lock, 'system');
  const videos = v.children[0].children[0].children[0];
  assert.strictEqual(videos.path, 'C:\\Users\\burak\\Videos');
  assert.deepStrictEqual(videos.children.map(c => c.path), ['C:\\Users\\burak\\Videos\\a.mp4', 'C:\\Users\\burak\\Videos\\b.mkv']);
});

test('remove moves the size into $Recycle.Bin and keeps the total', () => {
  const { t } = sample();
  assert.strictEqual(t.remove('C:\\Users\\burak\\Videos'), 1000);
  assert.strictEqual(t.find('C:\\Users').dir.size, 50);
  assert.strictEqual(t.find('C:\\Users\\burak\\Videos'), null);
  assert.strictEqual(t.find('C:\\$Recycle.Bin').dir.size, 1000);
  assert.strictEqual(t.totalSize, 2050);
  assert.strictEqual(t.remove('C:\\Users\\burak\\note.txt'), 50);
  assert.strictEqual(t.find('C:\\Users').dir.files, 0);
});

test('removeMany handles many files of one folder and mixed folders', () => {
  const t = new Tree('C:\\');
  const p = new LineParser(t);
  let text = 'D\t1\t0\tTemp\nD\t2\t1\tsub\nF\t2\t7\tdeep.bin\n';
  for (let i = 0; i < 20000; i++) text += `F\t1\t1\tf${i}.tmp\n`;
  p.feed(text);
  const paths = ['C:\\Temp\\sub', 'C:\\Temp\\missing.txt'];
  for (let i = 0; i < 20000; i += 2) paths.push(`C:\\Temp\\F${i}.TMP`);
  const t0 = Date.now();
  const sizes = t.removeMany(paths);
  assert.ok(Date.now() - t0 < 1000, 'too slow');
  assert.strictEqual(sizes[0], 7);
  assert.strictEqual(sizes[1], 0);
  assert.strictEqual(sizes.slice(2).reduce((a, b) => a + b, 0), 10000);
  assert.strictEqual(t.find('C:\\Temp').dir.size, 10000);
  assert.strictEqual(t.find('C:\\Temp').dir.fileNames.length, 10000);
});

test('entries that arrive for a removed folder are ignored', () => {
  const t = new Tree('D:\\');
  const p = new LineParser(t);
  p.feed('D\t1\t0\tbig\nD\t2\t1\tinner\nF\t1\t10\tx\n');
  t.remove('D:\\big');
  p.feed('F\t2\t500\tlate.bin\nD\t3\t2\tdeeper\nF\t3\t5\ty\nE\t2\n');
  assert.strictEqual(t.totalSize, 0);
  assert.strictEqual(t.fileCount, 1);
  assert.strictEqual(t.errorCount, 0);
});
