// Squarified treemap layout (Bruls, Huizing, van Wijk). Pure functions, no DOM.

function worst(row, side) {
  let s = 0, max = 0, min = Infinity;
  for (const r of row) { s += r.a; if (r.a > max) max = r.a; if (r.a < min) min = r.a; }
  return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
}

/**
 * Lays out `items` (each with a numeric `value`) inside the rectangle x, y, w, h.
 * Items should be sorted by value, largest first. Returns new objects with
 * x, y, w, h added; items with value <= 0 are dropped.
 */
export function squarify(items, x, y, w, h) {
  const list = items.filter(i => i.value > 0);
  const total = list.reduce((a, i) => a + i.value, 0);
  if (!total || w <= 0 || h <= 0) return [];
  const k = (w * h) / total;
  const rest = list.map(i => ({ item: i, a: i.value * k }));
  const out = [];
  let row = [];

  const place = () => {
    const s = row.reduce((a, r) => a + r.a, 0);
    if (w >= h) {
      const cw = s / h;
      let cy = y;
      for (const r of row) { const rh = r.a / cw; out.push({ ...r.item, x, y: cy, w: cw, h: rh }); cy += rh; }
      x += cw; w -= cw;
    } else {
      const rh = s / w;
      let cx = x;
      for (const r of row) { const rw = r.a / rh; out.push({ ...r.item, x: cx, y, w: rw, h: rh }); cx += rw; }
      y += rh; h -= rh;
    }
    row = [];
  };

  let i = 0;
  while (i < rest.length) {
    const side = Math.min(w, h);
    if (!row.length || worst(row.concat(rest[i]), side) <= worst(row, side)) row.push(rest[i++]);
    else place();
  }
  if (row.length) place();
  return out;
}
