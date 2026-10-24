// End-to-end smoke test. Starts the real app, scans the drive that holds the temp
// folder, and moves one test file (created here) to the Recycle Bin through the UI.
// Usage: node scripts/e2e.mjs [screenshotDir]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2];
const PORT = 9335;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = msg => { throw new Error(msg); };

const testDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'diskbloom-e2e-')));
fs.writeFileSync(path.join(testDir, 'big.bin'), Buffer.alloc(24 * 1024 * 1024, 1));
fs.mkdirSync(path.join(testDir, 'keep'));
fs.writeFileSync(path.join(testDir, 'keep', 'small.txt'), 'x'.repeat(4 * 1024 * 1024));
const drive = testDir.slice(0, 3);

const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const app = spawn(electron, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, env: { ...process.env, DISKBLOOM_E2E: '1' }, stdio: 'ignore' });

let c;
const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `);
  const out = await fn();
  console.log('ok' + (out !== undefined ? ` (${out})` : ''));
  if (shots) {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(shots, `e2e-${name.replace(/\W+/g, '-')}.png`), Buffer.from(r.result.data, 'base64'));
  }
};
const until = async (expr, ms = 120000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await c.evaluate(expr); if (v) return v; await sleep(250); }
  fail('timed out waiting for: ' + expr);
};
const fire = (p, type) => c.evaluate(`(() => {
  const e = document.querySelector('[data-path="' + CSS.escape(${JSON.stringify(p)}) + '"]');
  if (!e) return false;
  const r = e.getBoundingClientRect();
  e.dispatchEvent(new MouseEvent('${type}', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  return true;
})()`);

const errors = [];
try {
  c = await connect(PORT, t => t.url.includes('index.html'));
  c.on(d => {
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description);
  });
  await c.send('Runtime.enable');

  await step('start screen', () => until(`document.querySelectorAll('.dcard').length`, 15000));
  await step('scan drive', async () => {
    await c.evaluate(`document.querySelector('.dcard[data-root="${drive.replace(/\\/g, '\\\\\\\\')}"]').click()`);
    return until(`window.__e2e.state.progress && window.__e2e.state.progress.done && window.__e2e.state.progress.files`);
  });
  await step('open test folder', async () => {
    if (!await c.evaluate(`window.__e2e.open(${JSON.stringify(testDir)})`)) fail('folder not in tree');
    await sleep(700);
    return c.evaluate(`[...document.querySelectorAll('#tm [data-path]')].map(e => e.dataset.path.split('\\\\').pop()).join(',')`);
  });
  await step('tooltip follows mouse', async () => {
    await fire(path.join(testDir, 'keep'), 'mousemove');
    await sleep(300);
    const txt = await c.evaluate(`document.getElementById('tip').classList.contains('on') && document.getElementById('tip').innerText`);
    if (!txt || !txt.includes('keep')) fail('tooltip missing: ' + txt);
    return txt.split('\n')[0];
  });
  await step('add file to basket', async () => {
    await fire(path.join(testDir, 'big.bin'), 'contextmenu');
    return until(`window.__e2e.state.basket.size === 1 && document.getElementById('bTotal').textContent`, 3000);
  });
  await step('system file is refused', async () => {
    await c.evaluate(`window.__e2e.open(${JSON.stringify(drive)})`);
    await sleep(600);
    const sys = await c.evaluate(`[...document.querySelectorAll('#tm [data-path]')].map(e => e.dataset.path).find(p => /pagefile\\.sys$/i.test(p))`);
    if (!sys) return 'no pagefile tile drawn, skipped';
    await fire(sys, 'contextmenu');
    await sleep(200);
    if (await c.evaluate(`window.__e2e.state.basket.size`) !== 1) fail('locked file entered the basket');
    return c.evaluate(`document.getElementById('toast').innerText`);
  });
  await step('confirm dialog', async () => {
    await c.evaluate(`document.getElementById('trashBtn').click()`);
    await sleep(500);
    return until(`document.getElementById('modal').classList.contains('on') && document.getElementById('mList').innerText`, 3000);
  });
  await step('move to recycle bin', async () => {
    await c.evaluate(`document.getElementById('mYes').click()`);
    await until(`window.__e2e.state.basket.size === 0 && document.getElementById('toast').classList.contains('has-act')`, 20000);
    if (fs.existsSync(path.join(testDir, 'big.bin'))) fail('big.bin still on disk');
    if (!fs.existsSync(path.join(testDir, 'keep', 'small.txt'))) fail('keep/small.txt was touched');
    await sleep(600);
    return c.evaluate(`document.getElementById('toast').innerText.replace(/\\n/g, ' ')`);
  });
  if (errors.length) fail('page errors: ' + errors.join(' | '));
  console.log('\nE2E PASSED');
} catch (e) {
  console.error('\nE2E FAILED:', e.message);
  process.exitCode = 1;
} finally {
  try { await c?.send('Runtime.evaluate', { expression: 'window.close()' }); } catch { /* already gone */ }
  await sleep(500);
  c?.close();
  app.kill();
  fs.rmSync(testDir, { recursive: true, force: true });
}
