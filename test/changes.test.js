'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Tree, LineParser } = require('../src/main/tree');

const MB = 2 ** 20;

function scan(lines) {
  const t = new Tree('D:\\');
  new LineParser(t).feed(lines.join('\n') + '\nX\n');
  return t;
}

const first = () => scan([
  'D\t1\t0\tGames', 'D\t2\t1\tOld Game', `F\t2\t${800 * MB}\tdata.pak`,
  'D\t3\t0\tVideos', `F\t3\t${300 * MB}\ta.mp4`,
  'D\t4\t0\tTiny', `F\t4\t${MB / 2}\tx.txt`,
]);

test('a first scan has a snapshot of the larger folders and nothing to compare', () => {
  const { snapshot, diff } = first().changes(null);
  assert.strictEqual(diff, null);
  assert.strictEqual(snapshot.size, 1100.5 * MB);
  assert.deepStrictEqual(Object.keys(snapshot.dirs).sort(), ['D:\\', 'D:\\Games', 'D:\\Games\\Old Game', 'D:\\Videos']);
});

test('changes name the folders where something happened', () => {
  const prev = first().changes(null).snapshot;
  const next = scan([
    'D\t1\t0\tGames', 'D\t5\t1\tNew Game', `F\t5\t${2000 * MB}\tdata.pak`,
    'D\t3\t0\tVideos', `F\t3\t${300 * MB}\ta.mp4`, `F\t3\t${100 * MB}\tb.mp4`,
    'D\t4\t0\tTiny', `F\t4\t${MB / 2}\tx.txt`,
  ]);
  const { diff, snapshot } = next.changes(prev);
  assert.strictEqual(diff.before, 1100.5 * MB);
  assert.strictEqual(diff.after, 2400.5 * MB);
  // Games grew by 1.2 GB; New Game (+2 GB) inside it explains that, so Games itself is not listed.
  assert.deepStrictEqual(diff.items.map(i => [i.path, i.delta / MB]), [
    ['D:\\Games\\New Game', 2000],
    ['D:\\Games\\Old Game', -800],
    ['D:\\Videos', 100],
  ]);
  assert.strictEqual(diff.items[1].kind, 'gone');
  assert.strictEqual(diff.items[2].before, 300 * MB);
  assert.strictEqual(diff.deltas['d:\\videos'], 100 * MB);
  assert.ok(snapshot.dirs['D:\\Games\\New Game']);
});

test('a parent explained by one folder inside it is left out', () => {
  const prev = first().changes(null).snapshot;
  const next = scan([
    'D\t1\t0\tGames', 'D\t2\t1\tOld Game', `F\t2\t${3000 * MB}\tdata.pak`,
    'D\t3\t0\tVideos', `F\t3\t${300 * MB}\ta.mp4`,
  ]);
  assert.deepStrictEqual(next.changes(prev).diff.items.map(i => i.path), ['D:\\Games\\Old Game']);
});
