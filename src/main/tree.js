'use strict';
// In-memory directory tree built from scanner events.
// Directories are objects; files live in two parallel arrays on their parent to keep
// a million-file scan small. Sizes and file counts are rolled up to every ancestor
// as entries arrive, so a view taken mid-scan is already consistent.

const { lockReason } = require('../shared/protect');

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

  addFile(parentId, size, name) {
    const dir = this.dirs[parentId];
    if (!dir || dir.dead) return;
    dir.fileNames.push(name);
    dir.fileSizes.push(size);
    this.fileCount++;
    for (let d = dir; d; d = d.parent) { d.size += size; d.files++; }
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
    return { kind: 'file', name: dir.fileNames[i], path, size: dir.fileSizes[i], files: 1, lock: lockReason(path) };
  }

  dirNode(dir, depth, limits, level, minAbs) {
    const path = dir.parent ? this.pathOf(dir) : this.rootView;
    const node = {
      kind: 'dir', name: dir.parent ? dir.name : this.rootPath.slice(0, -1).split('\\').pop(), path,
      size: dir.size, files: dir.files, items: dir.subdirs.length + dir.fileNames.length,
      error: dir.error || undefined, lock: lockReason(path),
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
      const keepNames = [], keepSizes = [];
      let size = 0, files = 0;
      for (let k = 0; k < dir.fileNames.length; k++) {
        const i = names.get(dir.fileNames[k].toLowerCase());
        if (i !== undefined && !sizes[i]) {
          sizes[i] = dir.fileSizes[k];
          size += dir.fileSizes[k];
          files++;
          this.toBin(dir.fileNames[k], dir.fileSizes[k], 1);
        } else {
          keepNames.push(dir.fileNames[k]);
          keepSizes.push(dir.fileSizes[k]);
        }
      }
      dir.fileNames = keepNames;
      dir.fileSizes = keepSizes;
      for (let d = dir; d; d = d.parent) { d.size -= size; d.files -= files; }
    }
    return sizes;
  }

  remove(p) { return this.removeMany([p])[0]; }

  removeDir(dir) {
    const parent = dir.parent;
    if (!parent) return 0;
    parent.subdirs.splice(parent.subdirs.indexOf(dir), 1);
    if (parent.map) parent.map.delete(dir.name.toLowerCase());
    for (let d = parent; d; d = d.parent) { d.size -= dir.size; d.files -= dir.files; }
    dir.parent = null;
    // Everything below is dead too, so late scanner lines for it are not counted anywhere.
    const stack = [dir];
    while (stack.length) { const d = stack.pop(); d.dead = true; stack.push(...d.subdirs); }
    this.toBin(dir.name, dir.size, dir.files);
    return dir.size;
  }

  toBin(name, size, files) {
    const bin = this.root.subdirs.find(s => s.name.toLowerCase() === '$recycle.bin');
    if (!bin) return;
    bin.fileNames.push(name);
    bin.fileSizes.push(size);
    for (let d = bin; d; d = d.parent) { d.size += size; d.files += files; }
  }
}

function makeDir(id, name, parent) {
  return { id, name, parent, size: 0, files: 0, subdirs: [], fileNames: [], fileSizes: [], map: null, error: false, dead: false };
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
    if (t === 70) { // F parent size name
      const a = l.indexOf('\t', 2), b = l.indexOf('\t', a + 1);
      this.tree.addFile(+l.slice(2, a), +l.slice(a + 1, b), l.slice(b + 1));
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
