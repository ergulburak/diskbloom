import test from 'node:test';
import assert from 'node:assert';
import { squarify } from '../src/renderer/treemap.js';

const area = r => r.w * r.h;

test('areas are proportional to values and fill the rectangle', () => {
  const items = [6, 6, 4, 3, 2, 2, 1].map((value, i) => ({ id: i, value }));
  const out = squarify(items, 0, 0, 600, 400);
  assert.strictEqual(out.length, 7);
  const total = out.reduce((a, r) => a + area(r), 0);
  assert.ok(Math.abs(total - 240000) < 1e-6);
  for (const r of out) assert.ok(Math.abs(area(r) - r.value * 10000) < 1e-6);
});

test('rectangles stay inside the bounds and do not overlap', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ value: 1000 / (i + 1) }));
  const out = squarify(items, 10, 20, 300, 500);
  for (const r of out) {
    assert.ok(r.x >= 10 - 1e-9 && r.y >= 20 - 1e-9);
    assert.ok(r.x + r.w <= 310 + 1e-6 && r.y + r.h <= 520 + 1e-6);
  }
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
    const a = out[i], b = out[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    assert.ok(ox <= 1e-6 || oy <= 1e-6, `overlap ${i} ${j}`);
  }
});

test('empty and zero inputs give no rectangles', () => {
  assert.deepStrictEqual(squarify([], 0, 0, 100, 100), []);
  assert.deepStrictEqual(squarify([{ value: 0 }], 0, 0, 100, 100), []);
  assert.deepStrictEqual(squarify([{ value: 5 }], 0, 0, 0, 100), []);
});
