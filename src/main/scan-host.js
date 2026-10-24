'use strict';
// Runs in an Electron utility process. Owns the scanned tree so a million-entry
// scan never blocks the main process or the window. The main process sends
// { type: 'scan' | 'cancel' | 'view' | 'remove' } and gets 'progress' and 'reply' messages.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Tree, LineParser } = require('./tree');
const { demoLines } = require('./demo');

const port = process.parentPort;
let tree = null;
let current = null; // { id, root, started, proc, timer, done, error }
let seq = 0;

port.on('message', e => {
  const m = e.data;
  switch (m.type) {
    case 'scan': start(m.root, m.scanner, m.demo); break;
    case 'cancel': cancel(); break;
    case 'view': reply(m.id, tree ? tree.view(m.path, m.depth) : null); break;
    case 'remove': reply(m.id, tree ? tree.removeMany(m.paths) : []); break;
    case 'children': reply(m.id, tree ? tree.childPaths(m.path) : []); break;
  }
});

function reply(id, result) { port.postMessage({ type: 'reply', id, result }); }

function progress() {
  if (!current) return;
  port.postMessage({
    type: 'progress',
    root: current.root,
    files: tree.fileCount,
    dirs: tree.dirCount,
    errors: tree.errorCount,
    bytes: tree.totalSize,
    elapsed: Date.now() - current.started,
    done: current.done,
    cancelled: !!current.cancelled,
    error: current.error || null,
  });
}

function finish(scan, error) {
  if (scan !== current || scan.done) return;
  scan.done = true;
  scan.error = error;
  clearInterval(scan.timer);
  progress();
}

function cancel() {
  if (!current || current.done) return;
  current.cancelled = true;
  if (current.proc) current.proc.kill();
  finish(current, null);
}

function start(root, scannerPath, demo) {
  cancel();
  tree = new Tree(root);
  const scan = current = { id: ++seq, root: tree.rootPath, started: Date.now(), done: false };
  scan.timer = setInterval(progress, 200);

  if (demo) {
    // Feed the made-up drive in slices so the map grows the way it does on a real scan.
    const parser = new LineParser(tree);
    const lines = demoLines();
    let i = 0;
    const tick = () => {
      if (current !== scan || scan.done) return;
      parser.feed(lines.slice(i, i + 3500).join('\n') + '\n');
      i += 3500;
      if (i < lines.length) setTimeout(tick, 50);
      else finish(scan, null);
    };
    setTimeout(tick, 300);
  } else if (scannerPath && fs.existsSync(scannerPath)) {
    const parser = new LineParser(tree);
    const proc = scan.proc = spawn(scannerPath, [tree.rootPath], { windowsHide: true });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', chunk => { if (current === scan) parser.feed(chunk); });
    proc.on('error', err => finish(scan, err.message));
    proc.on('close', code => finish(scan, parser.done || scan.cancelled ? null : `scanner exited with ${code}`));
  } else {
    nodeScan(scan, tree).then(() => finish(scan, null), err => finish(scan, err.message));
  }
}

// Fallback when scanner.exe is missing: slower, but it works anywhere Node does.
async function nodeScan(scan, t) {
  let nextId = 0, active = 0;
  const queue = [{ id: 0, dir: t.rootPath }];
  await new Promise(resolve => {
    const pump = () => {
      if (current !== scan) return resolve();
      while (active < 32 && queue.length) {
        const job = queue.pop();
        active++;
        fs.promises.readdir(job.dir, { withFileTypes: true })
          .then(async entries => {
            const stats = [];
            for (const e of entries) {
              if (e.isSymbolicLink()) continue;
              const full = path.join(job.dir, e.name);
              if (e.isDirectory()) {
                const id = ++nextId;
                t.addDir(id, job.id, e.name);
                queue.push({ id, dir: full });
              } else if (e.isFile()) {
                stats.push(fs.promises.lstat(full).then(s => t.addFile(job.id, s.size, e.name), () => t.addFile(job.id, 0, e.name)));
              }
            }
            await Promise.all(stats);
          }, () => t.markError(job.id))
          .finally(() => {
            active--;
            if (!active && !queue.length) resolve(); else pump();
          });
      }
    };
    pump();
  });
}
