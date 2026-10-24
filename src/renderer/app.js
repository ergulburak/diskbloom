import { squarify } from './treemap.js';
import { t, getLang, setLang, locale } from './i18n.js';

const api = window.diskbloom;
const PALETTE = ['#ffb3d0', '#cdb6ff', '#addaff', '#a9f0bf', '#ffd0a6', '#f5ec9e', '#97c5ff'];
const $ = id => document.getElementById(id);
const tm = $('tm');
const tip = $('tip');

const state = {
  drives: [],
  quick: [],
  quickSizes: new Map(),
  root: null,          // scanned drive ('C:\') or folder ('C:\Users\me')
  path: null,          // folder shown in the treemap
  view: null,          // snapshot from the scanner for `path`
  nodes: new Map(),    // drawn path -> { node, parent }
  sel: null,
  basket: new Map(),   // lower-case path -> { path, name, size, kind, contents }
  progress: null,
  busy: false,
};

// ---------- helpers ----------
const lower = p => p.toLowerCase();
const isUnder = (child, parent) => lower(child).startsWith(lower(parent).replace(/\\$/, '') + '\\');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = n => Number(n || 0).toLocaleString(locale());

function fmtBytes(b) {
  if (!b || b < 1) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(4, Math.floor(Math.log(b) / Math.log(1024)));
  const v = b / 1024 ** i;
  const s = i === 0 || v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return Number(s).toLocaleString(locale(), { maximumFractionDigits: 2 }) + ' ' + units[i];
}
const secs = ms => (ms / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 }) + ' ' + t('seconds');

const EXT = [
  [/\.(mp4|mkv|mov|avi|wmv|webm|m4v|ts)$/i, '🎬'],
  [/\.(jpe?g|png|gif|webp|heic|raw|cr2|nef|arw|psd|bmp|tiff?)$/i, '🖼️'],
  [/\.(mp3|wav|flac|aac|ogg|m4a)$/i, '🎵'],
  [/\.(zip|rar|7z|tar|gz|bz2|xz)$/i, '🗜️'],
  [/\.(iso|img|vhdx?|vmdk|qcow2|wim)$/i, '💿'],
  [/\.(exe|msi|dll|sys|bin|pak)$/i, '⚙️'],
];
function icon(n) {
  if (n.kind === 'rest') return '';
  if (n.kind === 'dir') return '📁';
  for (const [re, ic] of EXT) if (re.test(n.name)) return ic;
  return '📄';
}
const label = n => n.kind === 'rest' ? t('restLabel', { n: num(n.files) }) : n.name;
const pct = v => t('pct', { p: Math.round(v) });

function parentPath(p) {
  const i = p.replace(/\\$/, '').lastIndexOf('\\');
  if (i < 0) return p;
  const par = p.slice(0, i);
  return /^[a-z]:$/i.test(par) ? par + '\\' : par;
}
const isDrive = p => /^[a-z]:\\$/i.test(p);
const baseName = p => p.replace(/\\$/, '').split('\\').pop();
// The drive that holds the scanned root, also when the root is a folder.
function currentDrive() { return state.drives.find(d => state.root && lower(d.root) === lower(state.root.slice(0, 2) + '\\')); }
function inBasket(p) { return state.basket.has(lower(p)); }
function ancestorInBasket(p) {
  for (const item of state.basket.values()) if (isUnder(p, item.path)) return item;
  return null;
}

// ---------- i18n ----------
function applyI18n() {
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = t(el.dataset.i18n); });
  document.querySelectorAll('#lang button').forEach(b => b.classList.toggle('on', b.dataset.lang === getLang()));
  $('keys').innerHTML = t('keys');
}

// ---------- drives ----------
async function loadDrives() {
  state.drives = await api.drives();
  renderDrives();
  renderDriveCards();
}

function renderDrives() {
  $('drives').innerHTML = state.drives.map(d => {
    const used = d.total - d.free, usedPct = used / d.total * 100;
    return `<div class="drive${state.root && lower(state.root) === lower(d.root) ? ' on' : ''}" data-root="${esc(d.root)}">
      <div class="row"><b>💾 ${esc(d.letter)}</b><span class="muted small">${pct(usedPct)}</span></div>
      <div class="meter${usedPct > 90 ? ' hot' : ''}"><div style="width:${usedPct}%"></div></div>
      <div class="muted small" style="margin-top:5px">${fmtBytes(used)} / ${fmtBytes(d.total)}</div></div>`;
  }).join('') + (state.root && !isDrive(state.root)
    ? `<div class="drive on" data-root="${esc(state.root)}" title="${esc(state.root)}">
      <div class="row"><b>📁 ${esc(baseName(state.root))}</b></div><div class="muted small fpath">${esc(state.root)}</div></div>`
    : '');
}

function renderDriveCards() {
  const R = 40, C = 2 * Math.PI * R;
  $('driveCards').innerHTML = state.drives.map((d, i) => {
    const usedPct = (d.total - d.free) / d.total * 100;
    return `<div class="dcard" data-root="${esc(d.root)}" style="animation-delay:${i * 90}ms">
      <div class="ring"><svg viewBox="0 0 96 96">
        <defs><linearGradient id="rg${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9ab8ff"/><stop offset="1" stop-color="${usedPct > 90 ? '#ff8fb0' : '#ff9ec4'}"/></linearGradient></defs>
        <circle class="track" cx="48" cy="48" r="${R}"/>
        <circle class="val" cx="48" cy="48" r="${R}" stroke="url(#rg${i})" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-off="${C * (1 - usedPct / 100)}"/>
      </svg><div class="lbl2"><div>${esc(d.letter)}<small>${pct(usedPct)} ${t('used')}</small></div></div></div>
      <div class="muted small">${fmtBytes(d.free)} ${t('free')} · ${fmtBytes(d.total)}</div>
      <button class="btn pri">${t('scan')}</button></div>`;
  }).join('');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll('.ring .val').forEach(c => { c.style.strokeDashoffset = c.dataset.off; });
  }));
}

// ---------- quick clean ----------
function quickOnDrive() {
  return state.root ? state.quick.filter(q => lower(q.path) === lower(state.root) || isUnder(q.path, state.root)) : [];
}

function renderQuick() {
  const list = quickOnDrive();
  if (!state.root || !list.length) { $('quick').innerHTML = `<div class="qempty">${t(state.root ? 'quickNone' : 'quickEmpty')}</div>`; return; }
  $('quick').innerHTML = list.map(q => {
    const size = state.quickSizes.get(q.id);
    return `<div class="qitem${inBasket(q.path) ? ' in' : ''}${size === 0 ? ' zero' : ''}" data-q="${esc(q.id)}"><span>${t('q_' + q.id)}</span>
      <span class="q-size">${size === undefined ? '…' : fmtBytes(size)}</span></div>`;
  }).join('');
}

async function refreshQuickSizes() {
  for (const q of quickOnDrive()) {
    const v = await api.view(q.path, 0);
    state.quickSizes.set(q.id, v ? v.size : 0);
  }
  renderQuick();
}

// ---------- scanning ----------
async function startScan(root) {
  // The folder may be gone since it was picked; the main process checks it again.
  if (!(await api.scan(root))) { toast('⚠ ' + t('folderBad', { path: esc(root) })); return; }
  Object.assign(state, { root, path: root, view: null, sel: null, progress: { files: 0, bytes: 0, done: false, elapsed: 0, errors: 0 } });
  state.basket.clear();
  state.quickSizes.clear();
  document.body.classList.add('scanned');
  tm.innerHTML = '';
  renderDrives(); renderBasket(); renderQuick(); renderStatus(); renderCrumbs();
  scheduleRefresh(true);
}

// A folder from the dialog, the command line or Explorer: { root } when it can be scanned, else { raw }.
function requestScan(req) {
  if (!req || state.busy) return;
  if (req.root) startScan(req.root);
  else toast('⚠ ' + t('folderBad', { path: esc(req.raw) }));
}

let refreshTimer = null;
let refreshing = false;
let refreshAgain = null;

function scheduleRefresh(soon) {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => { refreshTimer = null; refresh(state.view ? 'flip' : 'pop'); }, soon ? 120 : 900);
}

async function refresh(mode) {
  if (refreshing) { refreshAgain = mode; return; }
  refreshing = true;
  try {
    const wanted = state.path, root = state.root;
    let path = wanted;
    let v = await api.view(path, 3);
    // The folder may be gone (moved to the bin); fall back to the nearest parent.
    while (!v && path !== root && parentPath(path) !== path) { path = parentPath(path); v = await api.view(path, 3); }
    if (v && state.path === wanted && state.root === root) {
      state.path = path;
      state.view = v;
      render(mode);
    }
  } finally {
    refreshing = false;
    if (refreshAgain) { const m = refreshAgain; refreshAgain = null; refresh(m); }
  }
}

function renderStatus() {
  const p = state.progress;
  if (!p) { $('status').innerHTML = ''; return; }
  if (!p.done) {
    $('status').innerHTML = `<div class="chip"><span class="spinner"></span>${t('scanning')} · ${num(p.files)} ${t('files')} · ${fmtBytes(p.bytes)}</div>
      <button class="btn soft sm" data-act="stop">${t('stop')}</button>`;
  } else {
    $('status').innerHTML = `<div class="chip"><span class="ok-dot"></span>${p.cancelled ? t('stopped') : t('done')} · ${secs(p.elapsed)} · ${num(p.files)} ${t('files')}${p.errors ? ` · <span class="muted">${t('unreadable', { n: num(p.errors) })}</span>${state.admin ? '' : ` · <span class="link" data-act="elevate">${t('elevate')}</span>`}` : ''}</div>
      <button class="btn soft sm" data-act="rescan">↻ ${t('rescan')}</button>`;
  }
}

// ---------- treemap ----------
let counter = 0;

function render(mode) {
  const old = new Map();
  if (mode === 'flip') for (const e of tm.children) old.set(e.dataset.path, e.getBoundingClientRect());
  tm.innerHTML = '';
  state.nodes.clear();
  counter = 0;
  tm.classList.remove('play');
  const v = state.view;
  if (v) {
    state.nodes.set(v.path, { node: v, parent: null });
    if (v.kind === 'dir' && v.children) draw(v, 0, 0, tm.clientWidth, tm.clientHeight, 0, null);
  }
  marks();
  if (mode === 'pop') { void tm.offsetWidth; tm.classList.add('play'); }
  if (mode === 'flip') flip(old);
  renderCrumbs();
}

function draw(node, x, y, w, h, depth, color) {
  const kids = node.children.map(c => ({ node: c, value: c.size })).sort((a, b) => b.value - a.value);
  squarify(kids, x, y, w, h).forEach((r, idx) => {
    const c = r.node;
    const col = color || PALETTE[idx % PALETTE.length];
    const rx = r.x + 2, ry = r.y + 2, rw = r.w - 4, rh = r.h - 4;
    if (rw < 3 || rh < 3) return;
    state.nodes.set(c.path, { node: c, parent: node });
    const el = document.createElement('div');
    el.dataset.path = c.path;
    el.style.cssText = `left:${rx}px;top:${ry}px;width:${rw}px;height:${rh}px;--i:${counter++}` + (c.kind === 'rest' ? '' : `;--c:${col}`);
    if (c.lock) el.classList.add('locked');
    if (c.kind === 'dir' && c.children && c.children.length && depth < 2 && rw > 130 && rh > 80) {
      el.classList.add('grp');
      el.innerHTML = `<div class="h"><span class="n">${esc(c.name)}</span><span class="s">${fmtBytes(c.size)}<b class="add">+</b></span></div>`;
      tm.appendChild(el);
      draw(c, rx + 4, ry + 24, rw - 8, rh - 28, depth + 1, col);
    } else {
      el.classList.add('t');
      if (c.kind === 'rest') el.classList.add('rest');
      if (rw < 22 || rh < 22) el.classList.add('tiny');
      if (rw > 56 && rh > 34) {
        el.innerHTML = `<span class="n">${icon(c)} ${esc(label(c))}</span><span class="s">${fmtBytes(c.size)}</span>${c.kind === 'rest' ? '' : '<b class="add">+</b>'}`;
      } else if (rw > 24 && rh > 24 && c.kind !== 'rest') {
        el.innerHTML = '<b class="add">+</b>';
      }
      tm.appendChild(el);
    }
  });
}

function flip(old) {
  for (const e of tm.children) {
    const o = old.get(e.dataset.path);
    const n = e.getBoundingClientRect();
    if (o && n.width && n.height) {
      if (Math.abs(o.left - n.left) < 0.5 && Math.abs(o.top - n.top) < 0.5 && Math.abs(o.width - n.width) < 0.5 && Math.abs(o.height - n.height) < 0.5) continue;
      e.animate([
        { transformOrigin: '0 0', transform: `translate(${o.left - n.left}px,${o.top - n.top}px) scale(${o.width / n.width},${o.height / n.height})` },
        { transformOrigin: '0 0', transform: 'none' },
      ], { duration: 520, easing: 'cubic-bezier(.2,.9,.25,1)' });
    } else {
      e.animate([{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'ease-out' });
    }
  }
}

function marks() {
  for (const e of tm.children) {
    const p = e.dataset.path;
    const own = inBasket(p);
    e.classList.toggle('mark', own);
    e.classList.toggle('mark-in', !own && !!ancestorInBasket(p));
    e.classList.toggle('sel', state.sel === p);
  }
}

function renderCrumbs() {
  if (!state.path) { $('crumbs').innerHTML = ''; return; }
  const chain = [];
  for (let p = state.path; ; p = parentPath(p)) { chain.unshift(p); if (p === state.root || parentPath(p) === p) break; }
  // Long paths keep the drive and the last four folders; the middle collapses into one pill.
  const shown = chain.length > 6 ? [chain[0], null, ...chain.slice(-4)] : chain;
  const hidden = chain.length > 6 ? chain[chain.length - 5] : null;
  $('crumbs').innerHTML = shown.map((p, i) => (i ? '<span class="sep">›</span>' : '') + (p === null
    ? `<button class="pill" data-nav="${esc(hidden)}" title="${esc(hidden)}">…</button>`
    : `<button class="pill${p === state.path ? ' on' : ''}" data-nav="${esc(p)}">${i ? esc(p.slice(p.lastIndexOf('\\') + 1)) : isDrive(p) ? '💾 ' + esc(p.replace(/\\$/, '')) : '📁 ' + esc(baseName(p))}</button>`)).join('');
}

const elFor = p => tm.querySelector(`[data-path="${CSS.escape(p)}"]`);

async function zoomIn(node) {
  if (!node || node.kind !== 'dir') return;
  const el = elFor(node.path);
  const tr = tm.getBoundingClientRect(), r = el && el.getBoundingClientRect();
  const root = state.root;
  const v = await api.view(node.path, 3);
  if (!v || state.root !== root) return;
  Object.assign(state, { path: node.path, view: v, sel: null });
  hideTip();
  render();
  if (r) tm.animate([
    { transformOrigin: '0 0', transform: `translate(${r.left - tr.left}px,${r.top - tr.top}px) scale(${r.width / tr.width},${r.height / tr.height})`, opacity: .3 },
    { transformOrigin: '0 0', transform: 'none', opacity: 1 },
  ], { duration: 460, easing: 'cubic-bezier(.2,.9,.25,1)' });
}

async function zoomOut(target) {
  if (!target || lower(target) === lower(state.path)) return;
  const prev = lower(state.path), root = state.root;
  const v = await api.view(target, 3);
  if (!v || state.root !== root) return;
  Object.assign(state, { path: target, view: v, sel: null });
  hideTip();
  render();
  let anchor = null;
  for (const e of tm.children) {
    const p = lower(e.dataset.path);
    if ((prev === p || prev.startsWith(p + '\\')) && (!anchor || p.length < anchor.dataset.path.length)) anchor = e;
  }
  if (!anchor) return;
  state.sel = anchor.dataset.path;
  marks();
  const tr = tm.getBoundingClientRect(), r = anchor.getBoundingClientRect();
  tm.animate([
    { transformOrigin: '0 0', transform: `scale(${tr.width / r.width},${tr.height / r.height}) translate(${tr.left - r.left}px,${tr.top - r.top}px)`, opacity: .3 },
    { transformOrigin: '0 0', transform: 'none', opacity: 1 },
  ], { duration: 460, easing: 'cubic-bezier(.2,.9,.25,1)' });
}

// ---------- tooltip ----------
function hideTip() { tip.classList.remove('on'); tip.dataset.for = ''; }

function tipHtml(n, parent) {
  if (n.kind === 'rest') {
    return `<div class="tt">${esc(label(n))}</div><div class="kv" style="margin-top:6px"><span>${t('size')}</span><span>${fmtBytes(n.size)}</span></div><div class="hint">${t('hintRest')}</div>`;
  }
  const total = currentDrive()?.total || state.view?.size || 1;
  const share = n.size / total * 100;
  let h = `<div class="tt">${icon(n)} ${esc(n.name)}</div><div class="tp">${esc(n.path)}</div>
    <div class="kv"><span>${t('size')}</span><span>${fmtBytes(n.size)}</span></div>`;
  if (n.kind === 'dir') h += `<div class="kv"><span>${t('content')}</span><span>${num(n.items)} ${t('items')} · ${num(n.files)} ${t('files')}</span></div>`;
  if (parent && parent.size) h += `<div class="kv"><span>${t('inParent')}</span><span>${pct(n.size / parent.size * 100)}</span></div>`;
  h += `<div class="bar2"><div style="width:${Math.min(100, Math.max(2, share * 3))}%"></div></div>
    <div class="muted small" style="margin-top:4px">${t('ofDisk', { p: share < 0.1 ? '<' + (0.1).toLocaleString(locale()) : share.toLocaleString(locale(), { maximumFractionDigits: 1 }) })}</div>`;
  if (n.lock) h += `<div class="warn">🔒 ${t('lock_' + n.lock)}</div>`;
  else if (n.error) h += `<div class="warn">⚠ ${t('unreadableDir')}</div>`;
  if (!n.lock) h += `<div class="hint">${inBasket(n.path) ? t('hintInBasket') : n.kind === 'dir' ? t('hintDir') : t('hintFile')}</div>`;
  return h;
}

tm.addEventListener('mousemove', e => {
  const el = e.target.closest('[data-path]');
  const entry = el && state.nodes.get(el.dataset.path);
  if (!entry) return hideTip();
  let x = e.clientX + 18, y = e.clientY + 18;
  if (x + 250 > innerWidth) x = e.clientX - 258;
  if (y + 210 > innerHeight) y = e.clientY - 214;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
  if (tip.dataset.for !== el.dataset.path) {
    tip.dataset.for = el.dataset.path;
    tip.innerHTML = tipHtml(entry.node, entry.parent);
  }
  tip.classList.add('on');
});
tm.addEventListener('mouseleave', hideTip);

// ---------- basket ----------
function shake(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

function toggle(node) {
  if (!node || node.kind === 'rest') return;
  const el = elFor(node.path);
  if (node.lock) { shake(el); toast('🔒 ' + t('lock_' + node.lock)); return; }
  const key = lower(node.path);
  if (state.basket.has(key)) state.basket.delete(key);
  else {
    const anc = ancestorInBasket(node.path);
    if (anc) { shake(el); toast(t('alreadyInBasket', { name: anc.name })); return; }
    for (const item of [...state.basket.values()]) if (isUnder(item.path, node.path)) state.basket.delete(lower(item.path));
    state.basket.set(key, { path: node.path, name: node.name, size: node.size, kind: node.kind });
  }
  tip.dataset.for = '';
  marks(); renderBasket(); renderQuick();
}

function renderBasket() {
  const items = [...state.basket.values()];
  const total = items.reduce((a, i) => a + i.size, 0);
  $('bCount').textContent = items.length ? `${items.length} ${t(items.length === 1 ? 'item' : 'items')}` : '';
  $('bTotal').textContent = fmtBytes(total);
  const d = currentDrive();
  if (d) {
    const used = d.total - d.free;
    $('nowMeter').style.width = (used / d.total * 100) + '%';
    $('afterMeter').style.width = (Math.max(0, used - total) / d.total * 100) + '%';
    $('afterText').textContent = t('afterEmpty', { free: fmtBytes(d.free + total) });
  } else {
    $('nowMeter').style.width = $('afterMeter').style.width = '0%';
    $('afterText').textContent = '';
  }
  $('trashBtn').disabled = !items.length || state.busy;
  const list = $('blist');
  const before = new Set([...list.querySelectorAll('[data-b]')].map(e => e.dataset.b));
  list.innerHTML = items.length ? items.map(i => `<div class="bitem" data-b="${esc(i.path)}"${before.has(i.path) ? ' style="animation:none"' : ''}>
      <span class="ico">${i.contents ? '🧹' : icon(i)}</span>
      <div class="main"><div class="nm">${esc(i.name)}${i.contents ? ` <span class="muted">(${t('contentsOnly')})</span>` : ''}</div><div class="p">${esc(i.contents ? i.path : parentPath(i.path))}</div></div>
      <span class="sz">${fmtBytes(i.size)}</span>
      <span class="act" data-reveal title="${esc(t('reveal'))}">📂</span><span class="act" data-x title="${esc(t('remove'))}">✕</span></div>`).join('')
    : `<div class="empty">${t('basketEmpty')}</div>`;
}

// ---------- toast & modal ----------
let toastTimer;
function toast(html, action) {
  const el = $('toast');
  el.innerHTML = `<span>${html}</span>` + (action ? `<button class="btn pri sm" id="toastAct">${esc(action.label)}</button>` : '');
  el.classList.toggle('has-act', !!action);
  el.classList.add('on');
  if (action) $('toastAct').onclick = () => { action.fn(); el.classList.remove('on'); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), action ? 7000 : 2600);
}

async function openModal() {
  const items = [...state.basket.values()];
  if (!items.length || state.busy) return;
  // Sizes may have grown since the click if the scan was still running.
  for (const i of items) {
    const v = await api.view(i.path, 0);
    if (v) i.size = v.size;
  }
  renderBasket();
  const total = items.reduce((a, i) => a + i.size, 0);
  $('mSub').textContent = t('confirmSub', { n: items.length, size: fmtBytes(total) });
  $('mList').innerHTML = items.map(i => `<li><span>${i.contents ? '🧹' : icon(i)} ${esc(i.path)}${i.contents ? '\\*' : ''}</span><span>${fmtBytes(i.size)}</span></li>`).join('');
  $('mYes').textContent = t('move');
  $('mYes').disabled = false;
  $('modal').classList.add('on');
  setTimeout(() => $('mYes').focus(), 50);
}
function closeModal() { $('modal').classList.remove('on'); }

async function confirmTrash() {
  if (state.busy) return;
  state.busy = true;
  $('mYes').textContent = t('moving');
  $('mYes').disabled = true;
  const items = [...state.basket.values()];
  let res;
  try {
    res = await api.trash(items.map(i => ({ path: i.path, contents: !!i.contents })));
  } catch (e) {
    res = null;
  }
  closeModal();
  if (!res) {
    state.busy = false;
    renderBasket();
    toast('⚠ ' + t('moveFailed'));
    return;
  }
  const moved = res.moved.map(lower);
  const dying = [...tm.children].filter(e => { const p = lower(e.dataset.path); return moved.some(m => p === m || p.startsWith(m + '\\')); });
  dying.forEach(e => e.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.6)', filter: 'blur(6px)' }], { duration: 320, easing: 'ease-in', fill: 'forwards' }));
  document.querySelectorAll('.bitem').forEach(e => e.classList.add('out'));
  await sleep(320);
  const failed = new Set(res.failed.map(f => lower(f.path)));
  for (const i of items) if (i.contents || !failed.has(lower(i.path))) state.basket.delete(lower(i.path));
  state.busy = false;
  await loadDrives();
  await refresh('flip');
  renderBasket();
  refreshQuickSizes();
  const skipped = res.failed.length ? ' · ' + t('skipped', { n: num(res.failed.length) }) : '';
  toast(t('movedToast', { size: fmtBytes(res.bytes) }) + skipped, { label: t('openBin'), fn: () => api.openRecycleBin() });
}

// ---------- events ----------
document.querySelectorAll('[data-win]').forEach(b => b.addEventListener('click', () => api.window(b.dataset.win)));
document.querySelector('.brand').addEventListener('dblclick', () => api.window('maximize'));

$('drives').addEventListener('click', e => {
  const d = e.target.closest('[data-root]');
  if (!d) return;
  if (state.root && lower(d.dataset.root) === lower(state.root)) { if (state.path !== state.root) zoomOut(state.root); return; }
  startScan(d.dataset.root);
});
$('driveCards').addEventListener('click', e => { const d = e.target.closest('[data-root]'); if (d) startScan(d.dataset.root); });

$('status').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'stop') api.cancelScan();
  if (b.dataset.act === 'rescan' && state.root) startScan(state.root);
  if (b.dataset.act === 'elevate') api.elevate(state.root);
});

$('crumbs').addEventListener('click', e => { const p = e.target.closest('[data-nav]'); if (p) zoomOut(p.dataset.nav); });

tm.addEventListener('click', e => {
  const el = e.target.closest('[data-path]');
  if (!el) { state.sel = null; marks(); return; }
  const entry = state.nodes.get(el.dataset.path);
  if (!entry) return;
  if (e.target.closest('.add')) { toggle(entry.node); return; }
  if (entry.node.kind === 'rest') return;
  state.sel = el.dataset.path;
  marks();
});
tm.addEventListener('dblclick', e => {
  const el = e.target.closest('[data-path]');
  if (!el || e.target.closest('.add')) return;
  const entry = state.nodes.get(el.dataset.path);
  // The "+N small items" tile opens the folder it belongs to, where those items get room.
  if (entry) zoomIn(entry.node.kind === 'rest' ? entry.parent : entry.node);
});
tm.addEventListener('contextmenu', e => {
  const el = e.target.closest('[data-path]');
  if (!el) return;
  e.preventDefault();
  const entry = state.nodes.get(el.dataset.path);
  if (entry) toggle(entry.node);
});

$('quick').addEventListener('click', e => {
  const it = e.target.closest('[data-q]');
  if (!it) return;
  const q = state.quick.find(x => x.id === it.dataset.q);
  const size = state.quickSizes.get(q.id);
  if (inBasket(q.path)) { state.basket.delete(lower(q.path)); renderBasket(); renderQuick(); marks(); return; }
  if (!size) return;
  const anc = ancestorInBasket(q.path);
  if (anc) { toast(t('alreadyInBasket', { name: anc.name })); return; }
  for (const item of [...state.basket.values()]) if (isUnder(item.path, q.path)) state.basket.delete(lower(item.path));
  state.basket.set(lower(q.path), { path: q.path, name: t('q_' + q.id), size, kind: 'dir', contents: true });
  renderBasket(); renderQuick(); marks();
  toast(t('addedQuick', { name: t('q_' + q.id), size: fmtBytes(size) }));
});

$('blist').addEventListener('click', async e => {
  const row = e.target.closest('[data-b]');
  if (!row) return;
  const p = row.dataset.b;
  if (e.target.closest('[data-x]')) { state.basket.delete(lower(p)); marks(); renderBasket(); renderQuick(); return; }
  if (e.target.closest('[data-reveal]')) { api.reveal(p); return; }
  const item = state.basket.get(lower(p));
  const target = item && item.contents ? p : parentPath(p);
  const root = state.root;
  const v = await api.view(target, 3);
  if (!v || state.root !== root) return;
  Object.assign(state, { path: target, view: v, sel: item && item.contents ? null : p });
  render('pop');
});

$('trashBtn').addEventListener('click', openModal);
$('mNo').addEventListener('click', closeModal);
$('mYes').addEventListener('click', confirmTrash);
$('modal').addEventListener('click', e => { if (e.target === $('modal') && !state.busy) closeModal(); });

$('lang').addEventListener('click', e => {
  const b = e.target.closest('[data-lang]');
  if (!b) return;
  setLang(b.dataset.lang);
  api.saveSettings({ lang: getLang() });
  rerenderAll();
});

document.addEventListener('keydown', e => {
  if ($('modal').classList.contains('on')) {
    if (e.key === 'Escape' && !state.busy) closeModal();
    return;
  }
  if (!state.view) return;
  const sel = state.sel && state.nodes.get(state.sel);
  if ((e.key === ' ' || e.key === 'Delete') && sel) { e.preventDefault(); toggle(sel.node); }
  else if ((e.key === 'Escape' || e.key === 'Backspace') && state.path !== state.root) { e.preventDefault(); zoomOut(parentPath(state.path)); }
  else if (e.key === 'Enter' && sel) { e.preventDefault(); zoomIn(sel.node); }
  else if ((e.key === 'e' || e.key === 'E') && sel && sel.node.kind !== 'rest') api.reveal(sel.node.path);
});

let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => state.view && render(), 120); });

document.querySelectorAll('[data-act="pick"]').forEach(b => b.addEventListener('click', async () => requestScan(await api.pickFolder())));
api.onScanRequest(requestScan);

api.onTrashProgress(m => {
  if (state.busy) $('mYes').textContent = `${t('moving')} ${num(m.done)} / ${num(m.total)}`;
});

api.onProgress(m => {
  if (!state.root || lower(m.root) !== lower(state.root)) return;
  const wasDone = state.progress && state.progress.done;
  state.progress = m;
  renderStatus();
  if (m.done && !wasDone) {
    clearTimeout(refreshTimer); refreshTimer = null;
    refresh('flip');
    refreshQuickSizes();
    if (!m.cancelled && !m.error) toast(`✓ ${t('done')} · ${secs(m.elapsed)} · ${num(m.files)} ${t('files')}`);
    if (m.error) toast('⚠ ' + esc(m.error));
  } else if (!m.done) {
    scheduleRefresh();
  }
});

// ---------- start ----------
applyI18n();
renderBasket();
renderQuick();
loadDrives();
api.quickTargets().then(q => { state.quick = q; renderQuick(); });
Promise.all([api.info(), api.settings()]).then(([i, settings]) => {
  $('ver').textContent = 'v' + i.version;
  state.admin = i.admin;
  setLang(settings.lang || (/^tr/i.test(i.locale || '') ? 'tr' : 'en'));
  rerenderAll();
  requestScan(i.autoScan);
});

function rerenderAll() {
  applyI18n();
  renderDrives(); renderDriveCards(); renderQuick(); renderBasket(); renderStatus();
  if (state.view) render();
}

// Test hook for the e2e smoke test; only present when the window is opened with #e2e.
if (location.hash === '#e2e') {
  window.__e2e = {
    state,
    async open(p) {
      const v = await api.view(p, 3);
      if (!v) return false;
      Object.assign(state, { path: p, view: v, sel: null });
      render('pop');
      return true;
    },
  };
}
