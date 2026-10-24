// Records README media: screenshots and a short screencast of a scan and a zoom.
// Usage: node scripts/capture.mjs <outDir>   (needs ffmpeg on PATH or FFMPEG env for the GIF)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'docs', 'media'));
const frames = path.join(out, 'frames');
fs.mkdirSync(frames, { recursive: true });
const PORT = 9336;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const app = spawn(path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--demo', `--remote-debugging-port=${PORT}`],
  { cwd: root, env: { ...process.env, DISKBLOOM_E2E: '1' }, stdio: 'ignore' });
const c = await connect(PORT, t => t.url.includes('index.html'));
const shot = async name => {
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(r.result.data, 'base64'));
};
const until = async expr => { for (;;) { if (await c.evaluate(expr)) return; await sleep(200); } };

await until(`document.querySelectorAll('.dcard').length && document.getElementById('ver').textContent`);
const saved = await c.evaluate(`window.diskbloom.settings()`);
await c.evaluate(`document.querySelector('#lang [data-lang="en"]').click()`);
await sleep(1200);
await shot('start');

let n = 0;
let firstFrame = 0, lastFrame = 0;
c.on(async d => {
  if (d.method !== 'Page.screencastFrame') return;
  lastFrame = d.params.metadata.timestamp;
  if (!firstFrame) firstFrame = lastFrame;
  fs.writeFileSync(path.join(frames, `f${String(n++).padStart(4, '0')}.jpg`), Buffer.from(d.params.data, 'base64'));
  c.send('Page.screencastFrameAck', { sessionId: d.params.sessionId });
});
await c.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 });
await sleep(600);
await c.evaluate(`document.querySelector('.dcard').click()`);
await until(`window.__e2e.state.progress && window.__e2e.state.progress.done`);
await sleep(1500);
// Zoom into the biggest folder, hover, add something to the basket, zoom back out.
const big = await c.evaluate(`(() => { const g = [...document.querySelectorAll('#tm .grp')].sort((a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight)[0]; return g && g.dataset.path; })()`);
const fire = (p, type) => c.evaluate(`(() => { const e = document.querySelector('[data-path="' + CSS.escape(${JSON.stringify(p)}) + '"]'); if (!e) return; const r = e.getBoundingClientRect(); e.dispatchEvent(new MouseEvent('${type}', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 3 })); })()`);
if (big) {
  await fire(big, 'dblclick');
  await sleep(1400);
  const tiles = await c.evaluate(`[...document.querySelectorAll('#tm .t:not(.rest)')].filter(e => !e.classList.contains('locked')).slice(0, 3).map(e => e.dataset.path)`);
  for (const p of tiles) { await fire(p, 'mousemove'); await sleep(700); }
  if (tiles[1]) { await fire(tiles[1], 'contextmenu'); await sleep(900); }
  await shot('basket');
  await c.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(1400);
}
await c.send('Page.stopScreencast');
await shot('overview');

// Put the user's own language choice back (or none, if there was none).
await c.evaluate(`window.diskbloom.saveSettings({ lang: ${JSON.stringify(saved.lang ?? null)} ?? undefined })`);
await c.evaluate(`window.close()`).catch(() => {});
await sleep(400);
app.kill();

const ffmpeg = process.env.FFMPEG || 'ffmpeg';
try {
  // Frames arrive only when the page repaints; spread them evenly over the real duration.
  const rate = Math.max(1, n / Math.max(1, lastFrame - firstFrame)).toFixed(3);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', rate, '-i', path.join(frames, 'f%04d.jpg'),
    '-vf', 'fps=14,scale=820:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    path.join(out, 'demo.gif')], { stdio: 'inherit' });
  fs.rmSync(frames, { recursive: true, force: true });
  console.log('wrote', path.join(out, 'demo.gif'));
} catch (e) {
  console.log('ffmpeg not available; frames kept in', frames);
}
process.exit(0);
