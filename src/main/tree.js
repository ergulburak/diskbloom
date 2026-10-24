'use strict';
// In-memory directory tree built from scanner events.
// Directories are objects; files live in two parallel arrays on their parent to keep
// a million-file scan small. Sizes and file counts are rolled up to every ancestor
// as entries arrive, so a view taken mid-scan is already consistent. The size of each
// file type group (see shared/filetypes.js) is rolled up the same way.

const { lockReason } = require('../shared/protect');
const { TYPES, typeOf } = require('../shared/filetypes');

class Tree {
  constructor(rootPath) {
    this.rootPath = rootPath.replace(/[\\/]+$/, '') + '\\';
    // How the root appears in views: a drive keeps its backslash ('C:\'), a folder has none
    // ('C:\Users\me'), the same as every other path the renderer works with.
    this.rootView = /^[a-z]:\\$/i.test(this.rootPath) ? this.rootPath : this.rootPath.slice(0, -1);
    this.root = makeDir(0, this.rootPath.slice(0, -1), null);
    this.dirs = [this.root];
    this.fileCount = 0;
    this.dirCount = 0;
    this.errorCount = 0;
  }

  addDir(id, parentId, name) {
    const parent = this.dirs[parentId];
    const dir = makeDir(id, name, parent);
    this.dirs[id] = dir;
    if (!parent || parent.dead) { dir.dead = true; dir.parent = null; return; }
    parent.subdirs.push(dir);
    parent.map = null;
    this.dirCount++;
  }

  addFile(parentId, size, name, mtime = 0) {
    const dir = this.dirs[parentId];
    if (!dir || dir.dead) return;
    dir.fileNames.push(name);
    dir.fileSizes.push(size);
    dir.fileTimes.push(mtime);
    this.fileCount++;
    const type = typeOf(name);
    for (let d = dir; d; d = d.parent) {
      d.size += size; d.files++; d.types[type] += size;
      if (mtime > d.newest) d.newest = mtime;
    }
  }

  markError(id) {
    const dir = this.dirs[id];
    if (dir && dir.dead) return;
    if (dir) dir.error = true;
    this.errorCount++;
  }

  get totalSize() { return this.root.size; }

  pathOf(dir) {
    const names = [];
    for (let d = dir; d && d.parent; d = d.parent) names.unshift(d.name);
    return this.rootPath + names.join('\\');
  }

  /** Finds a path. Returns { dir } for a directory, { dir, index } for a file, or null. */
  find(p) {
    const norm = String(p).replace(/\//g, '\\');
    const rootNoSlash = this.rootPath.slice(0, -1).toLowerCase();
    const lower = norm.toLowerCase().replace(/\\+$/, '');
    if (lower === rootNoSlash) return { dir: this.root };
    if (!lower.startsWith(rootNoSlash + '\\')) return null;
    const parts = norm.slice(this.rootPath.length).replace(/\\+$/, '').split('\\');
    let dir = this.root;
    for (let i = 0; i < parts.length; i++) {
      const key = parts[i].toLowerCase();
      if (!dir.map) {
        dir.map = new Map();
        for (const s of dir.subdirs) dir.map.set(s.name.toLowerCase(), s);
      }
      const next = dir.map.get(key);
      if (next) { dir = next; continue; }
      if (i === parts.length - 1) {
        const index = dir.fileNames.findIndex(n => n.toLowerCase() === key);
        if (index >= 0) return { dir, index };
      }
      return null;
    }
    return { dir };
  }

  /**
   * Serializable snapshot of a path and its children down to `depth` levels.
   * Small children are folded into one 'rest' entry so the renderer never gets
   * more tiles than it can show.
   */
  view(p, depth = 3, limits = [200, 120, 60, 40], minFraction = 0.0006) {
    const hit = this.find(p);
    if (!hit) return null;
    if (hit.index !== undefined) return this.fileNode(hit.dir, hit.index);
    return this.dirNode(hit.dir, depth, limits, 0, hit.dir.size * minFraction);
  }

  fileNode(dir, i) {
    const path = this.pathOf(dir) + (dir.parent ? '\\' : '') + dir.fileNames[i];
    return {
      kind: 'file', name: dir.fileNames[i], path, size: dir.fileSizes[i], files: 1, lock: lockReason(path),
      type: TYPES[typeOf(dir.fileNames[i])], mtime: dir.fileTimes[i] || undefined,
    };
  }

  dirNode(dir, depth, limits, level, minAbs) {
    const path = dir.parent ? this.pathOf(dir) : this.rootView;
    const node = {
      kind: 'dir', name: dir.parent ? dir.name : this.rootPath.slice(0, -1).split('\\').pop(), path,
      size: dir.size, files: dir.files, items: dir.subdirs.length + dir.fileNames.length,
      error: dir.error || undefined, lock: lockReason(path), types: typeSizes(dir.types), newest: dir.newest || undefined,
    };
    if (depth <= 0) return node;
    const entries = [];
    for (const s of dir.subdirs) entries.push({ d: s, size: s.size });
    for (let i = 0; i < dir.fileNames.length; i++) entries.push({ f: i, size: dir.fileSizes[i] });
    entries.sort((a, b) => b.size - a.size);
    const max = limits[Math.min(level, limits.length - 1)];
    const minSize = Math.max(minAbs, dir.size * 0.001);
    const children = [];
    let restSize = 0, restCount = 0;
    for (let k = 0; k < entries.length; k++) {
      const e = entries[k];
      if (k < max && e.size >= minSize && e.size > 0) {
        children.push(e.d ? this.dirNode(e.d, depth - 1, limits, level + 1, minAbs) : this.fileNode(dir, e.f));
      } else { restSize += e.size; restCount++; }
    }
    if (restCount) children.push({ kind: 'rest', name: '', path: path + '\u0000rest', size: restSize, files: restCount });
    node.children = children;
    return node;
  }

  /**
   * The largest files or folders under `p` that match a filter, biggest first, plus the number
   * and total size of all matches.
   *   text     part of the name, or a pattern with * and ? that must match the whole name
   *   type     a file type group ('video'...); a folder matches when half of it is that type
   *   minSize  in bytes
   *   before   Unix seconds: files last written before it, or folders whose newest file is older
   *   kind     'files' or 'dirs'; a matching folder is listed once, not again for each folder in it
   */
  search(p, { text = '', type = null, minSize = 0, before = 0, kind = 'files', limit = 200 } = {}) {
    const hit = this.find(p);
    if (!hit || hit.index !== undefined) return { items: [], count: 0, size: 0 };
    const match = nameMatcher(text);
    const typeIndex = TYPES.indexOf(type);
    let found = [], count = 0, size = 0;
    const keep = entry => {
      count++;
      size += entry.size;
      found.push(entry);
      if (found.length > limit * 4) { found.sort((a, b) => b.size - a.size); found.length = limit; }
    };
    const stack = [hit.dir];
    while (stack.length) {
      const dir = stack.pop();
      if (kind === 'dirs') {
        for (const d of dir.subdirs) {
          const ok = d.size >= minSize && (!match || match(d.name))
            && (!before || (d.newest > 0 && d.newest < before))
            && (typeIndex < 0 || d.types[typeIndex] * 2 >= d.size);
          if (ok && d.size > 0) keep({ d, size: d.size }); else stack.push(d);
        }
        continue;
      }
      for (let i = 0; i < dir.fileNames.length; i++) {
        const s = dir.fileSizes[i];
        if (s < minSize) continue;
        if (before && !(dir.fileTimes[i] > 0 && dir.fileTimes[i] < before)) continue;
        if (typeIndex >= 0 && typeOf(dir.fileNames[i]) !== typeIndex) continue;
        if (match && !match(dir.fileNames[i])) continue;
        keep({ dir, i, size: s });
      }
      for (const d of dir.subdirs) stack.push(d);
    }
    found.sort((a, b) => b.size - a.size);
    const items = found.slice(0, limit).map(e => e.d ? this.dirNode(e.d, 0) : this.fileNode(e.dir, e.i));
    return { items, count, size };
  }

  /**
   * Compares this scan with an earlier snapshot ({ size, dirs: { path: size } }) and returns a
   * new snapshot. A snapshot keeps the folders of at least `minSize`, so a folder missing from
   * the earlier one was smaller than that (or did not exist). A change is listed from
   * `minChange` up, and a folder whose change is mostly (80%) one listed folder inside it is
   * left out, so the list names the folders where something really happened. `deltas` has the
   * change of every compared folder by lower-case path.
   */
  changes(prev, { minSize = 2 ** 20, minChange = 50 * 2 ** 20, limit = 100 } = {}) {
    const dirs = {};
    const walk = (dir, path) => {
      if (dir.size < minSize) return;
      dirs[path] = dir.size;
      for (const s of dir.subdirs) walk(s, (dir.parent ? path + '\\' : this.rootPath) + s.name);
    };
    walk(this.root, this.rootView);
    const snapshot = { size: this.root.size, dirs };
    if (!prev || !prev.dirs) return { snapshot, diff: null };

    const before = new Map(Object.entries(prev.dirs).map(([p, s]) => [p.toLowerCase(), { p, s }]));
    const now = new Map(Object.entries(dirs).map(([p, s]) => [p.toLowerCase(), { p, s }]));
    const sizeNow = key => {
      if (now.has(key)) return now.get(key).s;
      const hit = this.find(key);
      return hit && hit.index === undefined ? hit.dir.size : 0;
    };
    const deltas = {};
    for (const key of new Set([...before.keys(), ...now.keys()])) {
      const delta = sizeNow(key) - (before.get(key)?.s || 0);
      if (delta) deltas[key] = delta;
    }
    // The root's own change is the summary (after - before), so it is not a list item.
    const rootKey = this.rootView.toLowerCase();
    const big = Object.keys(deltas).filter(k => k !== rootKey && Math.abs(deltas[k]) >= minChange);
    const kept = big.filter(a => !big.some(d => d !== a && d.startsWith(a.replace(/\\$/, '') + '\\')
      && Math.sign(deltas[d]) === Math.sign(deltas[a]) && Math.abs(deltas[d]) >= 0.8 * Math.abs(deltas[a])));
    kept.sort((a, b) => Math.abs(deltas[b]) - Math.abs(deltas[a]));
    const items = kept.slice(0, limit).map(key => {
      const hit = this.find(key);
      const path = (now.get(key) || before.get(key)).p;
      const node = hit && hit.index === undefined ? this.dirNode(hit.dir, 0) : { kind: 'gone', name: path.split('\\').pop(), path, size: 0 };
      return { ...node, before: before.get(key)?.s || 0, delta: deltas[key] };
    });
    return { snapshot, diff: { before: prev.size, after: this.root.size, items, deltas } };
  }

  /** Full paths of everything directly inside a folder. */
  childPaths(p) {
    const hit = this.find(p);
    if (!hit || hit.index !== undefined) return [];
    const base = hit.dir.parent ? this.pathOf(hit.dir) + '\\' : this.rootPath;
    return hit.dir.subdirs.map(s => base + s.name).concat(hit.dir.fileNames.map(n => base + n));
  }

  /**
   * Removes paths after they went to the Recycle Bin and returns the size removed for each
   * (0 when not found). Their sizes move to the root's $Recycle.Bin folder (when present) so
   * the drive total stays honest: the space is only freed once the bin is emptied.
   * Files of one folder are removed in a single pass, so emptying a 50,000-file Temp is fast.
   */
  removeMany(paths) {
    const sizes = new Array(paths.length).fill(0);
    const groups = new Map(); // dir -> Map(lower-case file name -> index in paths)
    paths.forEach((p, i) => {
      const norm = String(p).replace(/\//g, '\\').replace(/\\+$/, '');
      const cut = norm.lastIndexOf('\\');
      if (cut < 0) return;
      const parentHit = this.find(norm.slice(0, cut) || norm);
      if (!parentHit || parentHit.index !== undefined) return;
      const dir = parentHit.dir;
      const key = norm.slice(cut + 1).toLowerCase();
      if (!dir.map) {
        dir.map = new Map();
        for (const s of dir.subdirs) dir.map.set(s.name.toLowerCase(), s);
      }
      const sub = dir.map.get(key);
      if (sub) { sizes[i] = this.removeDir(sub); return; }
      let g = groups.get(dir);
      if (!g) groups.set(dir, g = new Map());
      g.set(key, i);
    });
    for (const [dir, names] of groups) {
      if (dir.dead) continue;
      const keepNames = [], keepSizes = [], keepTimes = [];
      const types = new Float64Array(TYPES.length), one = new Float64Array(TYPES.length);
      let size = 0, files = 0;
      for (let k = 0; k < dir.fileNames.length; k++) {
        const i = names.get(dir.fileNames[k].toLowerCase());
        if (i !== undefined && !sizes[i]) {
          sizes[i] = dir.fileSizes[k];
          size += dir.fileSizes[k];
          files++;
          const type = typeOf(dir.fileNames[k]);
          types[type] += dir.fileSizes[k];
          one.fill(0);
          one[type] = dir.fileSizes[k];
          this.toBin(dir.fileNames[k], dir.fileSizes[k], 1, one, dir.fileTimes[k]);
        } else {
          keepNames.push(dir.fileNames[k]);
          keepSizes.push(dir.fileSizes[k]);
          keepTimes.push(dir.fileTimes[k]);
        }
      }
      dir.fileNames = keepNames;
      dir.fileSizes = keepSizes;
      dir.fileTimes = keepTimes;
      for (let d = dir; d; d = d.parent) { d.size -= size; d.files -= files; addTypes(d.types, types, -1); }
    }
    return sizes;
  }

  remove(p) { return this.removeMany([p])[0]; }

  removeDir(dir) {
    const parent = dir.parent;
    if (!parent) return 0;
    parent.subdirs.splice(parent.subdirs.indexOf(dir), 1);
    if (parent.map) parent.map.delete(dir.name.toLowerCase());
    for (let d = parent; d; d = d.parent) { d.size -= dir.size; d.files -= dir.files; addTypes(d.types, dir.types, -1); }
    dir.parent = null;
    // Everything below is dead too, so late scanner lines for it are not counted anywhere.
    const stack = [dir];
    while (stack.length) { const d = stack.pop(); d.dead = true; stack.push(...d.subdirs); }
    this.toBin(dir.name, dir.size, dir.files, dir.types, dir.newest);
    return dir.size;
  }

  toBin(name, size, files, types, mtime) {
    const bin = this.root.subdirs.find(s => s.name.toLowerCase() === '$recycle.bin');
    if (!bin) return;
    bin.fileNames.push(name);
    bin.fileSizes.push(size);
    bin.fileTimes.push(mtime || 0);
    for (let d = bin; d; d = d.parent) { d.size += size; d.files += files; addTypes(d.types, types, 1); }
  }
}

function makeDir(id, name, parent) {
  return {
    id, name, parent, size: 0, files: 0, types: new Float64Array(TYPES.length),
    newest: 0, // last write time of the newest file inside, in Unix seconds
    subdirs: [], fileNames: [], fileSizes: [], fileTimes: [], map: null, error: false, dead: false,
  };
}

/** A name test for search text: a * and ? pattern matches the whole name, other text any part of it. */
function nameMatcher(text) {
  const q = String(text || '').trim().toLowerCase();
  if (!q) return null;
  if (!/[*?]/.test(q)) return name => name.toLowerCase().includes(q);
  const re = new RegExp('^' + q.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  return name => re.test(name.toLowerCase());
}

function addTypes(into, from, sign) {
  for (let t = 0; t < into.length; t++) into[t] += sign * from[t];
}

/** The non-empty type groups of a folder, by name: { video: 1200, other: 30 }. */
function typeSizes(types) {
  const out = {};
  for (let t = 0; t < types.length; t++) if (types[t] > 0) out[TYPES[t]] = types[t];
  return out;
}

/** Incremental parser for the scanner's line protocol. Feed it chunks of text. */
class LineParser {
  constructor(tree) { this.tree = tree; this.buf = ''; this.done = false; }

  feed(chunk) {
    const text = this.buf + chunk;
    let start = 0;
    for (;;) {
      const nl = text.indexOf('\n', start);
      if (nl < 0) break;
      this.line(text.slice(start, nl));
      start = nl + 1;
    }
    this.buf = text.slice(start);
  }

  line(l) {
    if (l.endsWith('\r')) l = l.slice(0, -1);
    const t = l.charCodeAt(0);
    if (t === 70) { // F parent size name [mtime]; a file name never holds a tab
      const a = l.indexOf('\t', 2), b = l.indexOf('\t', a + 1), c = l.indexOf('\t', b + 1);
      if (c < 0) this.tree.addFile(+l.slice(2, a), +l.slice(a + 1, b), l.slice(b + 1));
      else this.tree.addFile(+l.slice(2, a), +l.slice(a + 1, b), l.slice(b + 1, c), +l.slice(c + 1));
    } else if (t === 68) { // D id parent name
      const a = l.indexOf('\t', 2), b = l.indexOf('\t', a + 1);
      this.tree.addDir(+l.slice(2, a), +l.slice(a + 1, b), l.slice(b + 1));
    } else if (t === 69) {
      this.tree.markError(+l.slice(2));
    } else if (t === 88) {
      this.done = true;
    }
  }
}

module.exports = { Tree, LineParser };
