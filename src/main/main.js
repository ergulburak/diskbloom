'use strict';
const { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } = require('electron');
const { spawn, execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { lockReason } = require('../shared/protect');
const { DEMO_DRIVES, DEMO_QUICK } = require('./demo');
const { scanArg, resolveRoot } = require('./launch');
const explorerMenu = require('./explorer-menu');

// --demo shows a made-up drive and never touches the disk (for screenshots and talks).
const DEMO = process.argv.includes('--demo') || !!process.env.DISKBLOOM_DEMO;
// One window at a time: a second start (for example from Explorer) hands its folder to the
// first window. The demo and the e2e test run beside a normal copy, so they stay separate.
const SINGLE = !DEMO && !process.env.DISKBLOOM_E2E;

let win = null;
let host = null;
let reqSeq = 0;
const pending = new Map();
let scanningRoot = null; // set while a scan runs, to report a crashed scan host

function scannerPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'scanner.exe')
    : path.join(__dirname, '..', '..', 'native', 'scanner.exe');
}

function startHost() {
  host = utilityProcess.fork(path.join(__dirname, 'scan-host.js'), [], {
    serviceName: 'Diskbloom Scanner',
    env: { ...process.env, UV_THREADPOOL_SIZE: '16' },
  });
  host.on('message', m => {
    if (m.type === 'reply') {
      const resolve = pending.get(m.id);
      if (resolve) { pending.delete(m.id); resolve(m.result); }
    } else if (m.type === 'progress') {
      // Starting a new scan ends the old one with a done message; only the current root counts.
      if (m.done && scanningRoot && m.root.toLowerCase() === scanningRoot.toLowerCase()) scanningRoot = null;
      if (win && !win.isDestroyed()) win.webContents.send('scan:progress', m);
    }
  });
  host.on('exit', code => {
    console.error('scanner host exited:', code);
    host = null;
    if (scanningRoot && win && !win.isDestroyed()) {
      win.webContents.send('scan:progress', { root: scanningRoot, done: true, error: `scanner stopped (${code})`, files: 0, bytes: 0, elapsed: 0, errors: 0 });
    }
    scanningRoot = null;
    for (const resolve of pending.values()) resolve(null);
    pending.clear();
  });
}

function send(msg) {
  if (!host) startHost();
  host.postMessage(msg);
}

function ask(msg) {
  return new Promise(resolve => {
    const id = ++reqSeq;
    pending.set(id, resolve);
    send({ ...msg, id });
  });
}

async function listDrives() {
  if (DEMO) return DEMO_DRIVES;
  if (process.platform !== 'win32') {
    const s = await fs.promises.statfs('/');
    return [{ root: '/', letter: '/', total: s.blocks * s.bsize, free: s.bavail * s.bsize }];
  }
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZAB'.split('');
  const results = await Promise.allSettled(letters.map(l => fs.promises.statfs(`${l}:\\`)));
  return results.flatMap((r, i) => r.status === 'fulfilled' && r.value.blocks > 0
    ? [{ root: `${letters[i]}:\\`, letter: `${letters[i]}:`, total: r.value.blocks * r.value.bsize, free: r.value.bavail * r.value.bsize }]
    : []);
}

function quickTargets() {
  if (DEMO) return DEMO_QUICK;
  const L = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const H = os.homedir();
  const W = process.env.SystemRoot || 'C:\\Windows';
  let tmp = os.tmpdir();
  try { tmp = fs.realpathSync.native(tmp); } catch { /* keep the short form */ }
  const list = [
    // Only a folder that is really named Temp/Tmp: TEMP can point at a work folder.
    ...(/^te?mp$/i.test(path.basename(tmp)) ? [{ id: 'temp', path: tmp }] : []),
    { id: 'wintemp', path: path.join(W, 'Temp') },
    { id: 'update', path: path.join(W, 'SoftwareDistribution', 'Download') },
    { id: 'chrome', path: path.join(L, 'Google', 'Chrome', 'User Data', 'Default', 'Cache') },
    { id: 'edge', path: path.join(L, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache') },
    { id: 'crash', path: path.join(L, 'CrashDumps') },
    { id: 'npm', path: path.join(L, 'npm-cache') },
    { id: 'pip', path: path.join(L, 'pip', 'cache') },
    { id: 'gradle', path: path.join(H, '.gradle', 'caches') },
    { id: 'nuget', path: path.join(H, '.nuget', 'packages') },
  ];
  return list.filter(q => { try { return fs.statSync(q.path).isDirectory(); } catch { return false; } });
}

/**
 * Returns a reason when `p` must not be moved, otherwise null. The path must be a plain,
 * absolute drive path that Windows resolves to exactly itself: no '.' or '..' parts, no
 * names ending in a dot or a space; 8.3 short names fail the realpath check. Then the lock rules apply.
 */
async function refuseReason(p) {
  if (typeof p !== 'string' || !/^[a-zA-Z]:\\[^/]*$/.test(p)) return 'path';
  const parts = p.slice(3).split('\\');
  if (parts.some(s => !s || s === '.' || s === '..' || /[. ]$/.test(s))) return 'path';
  if (DEMO) return lockReason(p);
  let real;
  // Async, so a 50,000-file Temp does not freeze the window; it resolves like realpathSync.native.
  try { real = await fs.promises.realpath(p); } catch { return 'missing'; }
  if (real.toLowerCase() !== p.toLowerCase()) return 'path';
  return lockReason(real);
}

// Moves items to the Recycle Bin one by one. An item with `contents: true` keeps the
// folder itself (Temp, caches) and moves only the entries the scan found inside it,
// which are the ones the user saw in the dialog; entries in use are skipped.
async function trashItems(items) {
  const moved = [], failed = [];
  const targets = [];
  for (const item of items) {
    if (item.contents) targets.push(...((await ask({ type: 'children', path: item.path })) || []));
    else targets.push(item.path);
  }
  let done = 0;
  for (const p of targets) {
    const reason = await refuseReason(p);
    if (reason) failed.push({ path: p, error: reason });
    else if (DEMO) moved.push(p);
    else {
      try { await shell.trashItem(p); moved.push(p); } catch (e) { failed.push({ path: p, error: e.message }); }
    }
    if (++done % 20 === 0 && win && !win.isDestroyed()) win.webContents.send('trash:progress', { done, total: targets.length });
  }
  const sizes = moved.length ? await ask({ type: 'remove', paths: moved }) : [];
  const bytes = (sizes || []).reduce((a, b) => a + b, 0);
  return { moved, failed, bytes };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    show: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0e0d15',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('render-process-gone', (_e, d) => console.error('renderer gone:', d.reason, d.exitCode));
  win.on('maximize', () => win.webContents.send('win:state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('win:state', { maximized: false }));
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), process.env.DISKBLOOM_E2E ? { hash: 'e2e' } : {});
}

ipcMain.handle('win:control', (_e, action) => {
  if (!win) return;
  if (action === 'close') win.close();
  else if (action === 'minimize') win.minimize();
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.handle('drives:list', () => listDrives());
ipcMain.handle('quick:list', () => quickTargets());
ipcMain.handle('scan:start', (_e, root) => {
  // Only a root that resolves to itself is scanned, so the window and the tree agree on its spelling.
  const ok = DEMO ? DEMO_DRIVES.some(d => d.root === root) : resolveRoot(root) === root;
  if (!ok) return false;
  scanningRoot = root;
  send({ type: 'scan', root, scanner: scannerPath(), demo: DEMO });
  return true;
});
ipcMain.handle('dialog:folder', async () => {
  if (DEMO || !win) return null;
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'dontAddToRecent'] });
  if (r.canceled || !r.filePaths.length) return null;
  return { root: resolveRoot(r.filePaths[0]), raw: r.filePaths[0] };
});
ipcMain.handle('scan:cancel', () => { if (host) host.postMessage({ type: 'cancel' }); });
ipcMain.handle('tree:view', (_e, p, depth) => ask({ type: 'view', path: p, depth }));
ipcMain.handle('tree:search', (_e, p, filter) => ask({ type: 'search', path: p, filter }));

// After a complete scan: compare it with the snapshot of the previous scan of the same root,
// then keep this scan's snapshot for next time. Returns null for a first scan.
// A hash keeps the file name short for any root; the root itself is stored inside.
const snapshotFile = root => path.join(app.getPath('userData'), 'snapshots',
  crypto.createHash('sha1').update(root.toLowerCase()).digest('hex') + '.json');
ipcMain.handle('scan:changes', async (_e, root) => {
  if (DEMO || typeof root !== 'string') return null;
  const file = snapshotFile(root);
  let prev = null;
  try { prev = JSON.parse(await fs.promises.readFile(file, 'utf8')); } catch { /* first scan of this root */ }
  if (prev && String(prev.root).toLowerCase() !== root.toLowerCase()) prev = null;
  const r = await ask({ type: 'changes', root, prev });
  if (!r) return null;
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify({ root, time: Date.now(), ...r.snapshot }));
  } catch (e) {
    console.error('snapshot not saved:', e.message);
  }
  return r.diff && prev ? { since: prev.time, ...r.diff } : null;
});
ipcMain.handle('items:trash', (_e, items) => trashItems(items));
ipcMain.handle('shell:reveal', (_e, p) => { if (!DEMO) shell.showItemInFolder(p); });
ipcMain.handle('shell:recycleBin', () => {
  if (DEMO) return;
  spawn('explorer.exe', ['shell:RecycleBinFolder'], { detached: true, stdio: 'ignore' }).unref();
});
ipcMain.handle('app:info', async () => ({
  version: app.getVersion(),
  platform: process.platform,
  // A Turkish region or any Turkish preferred language opens the app in Turkish.
  locale: [app.getSystemLocale(), ...app.getPreferredSystemLanguages()].find(l => /^tr/i.test(l || ''))
    || app.getPreferredSystemLanguages()[0] || app.getLocale(),
  admin: await isAdmin(),
  autoScan: scanRequest(process.argv),
}));

const system32 = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
// hiberfil.sys is open by Windows, so stat() fails on it; a directory listing still has its size.
ipcMain.handle('tool:info', () => new Promise(resolve => {
  if (DEMO || process.platform !== 'win32') return resolve({ hibernate: 0 });
  const root = `${process.env.SystemDrive || 'C:'}\\`;
  execFile('powershell.exe', ['-NoProfile', '-Command', `(Get-ChildItem -LiteralPath '${root}' -Force -Filter hiberfil.sys).Length`],
    { windowsHide: true }, (err, out) => resolve({ hibernate: err ? 0 : Number(String(out).trim()) || 0 }));
}));
// Windows' own cleanup tools. openPath goes through the shell, so a tool that needs
// administrator rights gets its UAC prompt.
ipcMain.handle('tool:open', (_e, id) => {
  if (DEMO) return false;
  if (id === 'cleanmgr') shell.openPath(path.join(system32(), 'cleanmgr.exe'));
  else if (id === 'protection') shell.openPath(path.join(system32(), 'SystemPropertiesProtection.exe'));
  else if (id === 'storage') shell.openExternal('ms-settings:storagesense');
  else return false;
  return true;
});
// Turns hibernation (and with it Fast Startup) off, which deletes hiberfil.sys. powercfg needs
// administrator rights, so Windows asks with a UAC prompt. Resolves true when powercfg succeeded.
ipcMain.handle('tool:hibernateOff', () => new Promise(resolve => {
  if (DEMO) return resolve(false);
  const ps = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
    "$p = Start-Process -FilePath powercfg.exe -ArgumentList '/hibernate','off' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode"],
  { windowsHide: true });
  ps.on('exit', code => resolve(code === 0));
  ps.on('error', () => resolve(false));
}));

// Restarts the app elevated (UAC prompt) and scans `root` again, so folders that need
// administrator rights are counted too.
ipcMain.handle('app:elevate', (_e, root) => {
  if (DEMO) return;
  const { exe, appPath } = launchTarget();
  const args = (appPath ? [appPath] : []).concat(root ? [`--scan=${root.replace(/[\\/]+$/, '')}`] : []);
  const quote = s => `'${String(s).replace(/'/g, "''")}'`;
  const list = args.length ? ` -ArgumentList ${args.map(a => quote(`"${a}"`)).join(',')}` : '';
  // The elevated copy must get the single-instance lock, so this one lets it go first.
  if (SINGLE) app.releaseSingleInstanceLock();
  const ps = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', `Start-Process -FilePath ${quote(exe)}${list} -Verb RunAs`], { windowsHide: true });
  ps.on('exit', code => {
    if (code === 0) app.quit();
    else if (SINGLE) app.requestSingleInstanceLock(); // UAC was cancelled; stay the only window
  });
});

// What starts this app again: the portable .exe (not its temporary unpacked copy), the
// installed .exe, or electron.exe with the source folder during development.
function launchTarget() {
  return app.isPackaged
    ? { exe: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, appPath: null }
    : { exe: process.execPath, appPath: app.getAppPath() };
}

const menuSupported = () => process.platform === 'win32' && !DEMO;
ipcMain.handle('menu:get', async () => menuSupported() ? (await explorerMenu.status()).on : null);
ipcMain.handle('menu:set', async (_e, on, label) => {
  if (!menuSupported()) return null;
  if (on) {
    const { exe, appPath } = launchTarget();
    await explorerMenu.enable(exe, appPath, String(label || 'Diskbloom'));
  } else {
    await explorerMenu.disable();
  }
  return (await explorerMenu.status()).on;
});

// A portable .exe can be moved; point an existing menu entry at where this copy is now.
// Only a packaged app does this, so a development run never takes the entry over.
async function refreshMenu() {
  if (!menuSupported() || !app.isPackaged) return;
  const s = await explorerMenu.status();
  const { exe, appPath } = launchTarget();
  if (s.on && s.command !== explorerMenu.menuCommand(exe, appPath)) await explorerMenu.enable(exe, appPath, s.label || 'Diskbloom');
}

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_e, patch) => {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  return next;
});

// Elevated means the process token has the High (or System) integrity level. whoami shows it
// without needing any Windows service, and it runs async so the window never waits on it.
function isAdmin() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise(resolve => {
    execFile(path.join(system32(), 'whoami.exe'), ['/groups'], { windowsHide: true }, (err, out) => resolve(!err && /S-1-16-(12288|16384)\b/.test(out)));
  });
}

// A --scan request: the folder to scan, or only the raw text when it cannot be scanned.
function scanRequest(argv) {
  const raw = scanArg(argv);
  if (!raw || DEMO) return null;
  return { root: resolveRoot(raw), raw };
}

if (SINGLE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const req = scanRequest(argv);
    if (req) win.webContents.send('app:scan', req);
  });
  app.whenReady().then(() => {
    startHost();
    createWindow();
    refreshMenu();
  });
}
app.on('window-all-closed', () => {
  if (host) host.kill();
  app.quit();
});
