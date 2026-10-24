'use strict';
// The "Scan with Diskbloom" entry in the Explorer right-click menu, for folders, the empty
// space inside a folder and drives. It lives under HKEY_CURRENT_USER, so no administrator
// rights are needed. Windows 11 shows it under "Show more options".

const { execFile } = require('node:child_process');

const KEYS = ['Directory', 'Directory\\Background', 'Drive'].map(k => `HKCU\\Software\\Classes\\${k}\\shell\\Diskbloom`);

/** Runs reg.exe and resolves to its output, or null when it fails. */
function reg(args) {
  return new Promise(resolve => {
    execFile('reg.exe', args, { windowsHide: true }, (err, stdout) => resolve(err ? null : stdout));
  });
}

/** The command Explorer runs. %V is the folder or drive that was clicked. */
function menuCommand(exe, appPath) {
  return `"${exe}"${appPath ? ` "${appPath}"` : ''} --scan="%V"`;
}

/** The default value from `reg query ... /ve` output; the "(Default)" name is localized, so it is skipped. */
function defaultValue(out) {
  const m = out && /REG_SZ\s+(.*?)\s*$/m.exec(out);
  return m ? m[1] : null;
}

async function status() {
  const command = defaultValue(await reg(['query', `${KEYS[0]}\\command`, '/ve']));
  const label = defaultValue(await reg(['query', KEYS[0], '/ve']));
  return { on: !!command, command, label };
}

async function enable(exe, appPath, label) {
  const command = menuCommand(exe, appPath);
  for (const key of KEYS) {
    const ok = await reg(['add', key, '/ve', '/d', label, '/f'])
      && await reg(['add', key, '/v', 'Icon', '/d', `${exe},0`, '/f'])
      && await reg(['add', `${key}\\command`, '/ve', '/d', command, '/f']);
    if (!ok) { await disable(); return false; }
  }
  return true;
}

async function disable() {
  for (const key of KEYS) await reg(['delete', key, '/f']);
}

module.exports = { KEYS, menuCommand, defaultValue, status, enable, disable };
