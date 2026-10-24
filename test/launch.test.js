'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanArg, resolveRoot } = require('../src/main/launch');

test('scanArg reads --scan and drops quotes', () => {
  assert.strictEqual(scanArg(['app.exe', '--scan=C:\\Users\\me']), 'C:\\Users\\me');
  assert.strictEqual(scanArg(['app.exe', '--scan="D:\\My Games"']), 'D:\\My Games');
  assert.strictEqual(scanArg(['app.exe', '--scan=C:"']), 'C:');
  assert.strictEqual(scanArg(['app.exe', '--scan=']), null);
  assert.strictEqual(scanArg(['app.exe', '.']), null);
});

test('resolveRoot accepts drives and existing folders only', { skip: process.platform !== 'win32' }, () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'diskbloom-launch-')));
  const file = path.join(dir, 'a.txt');
  fs.writeFileSync(file, 'x');
  try {
    const drive = dir.slice(0, 2).toUpperCase();
    assert.strictEqual(resolveRoot(drive), drive + '\\');
    assert.strictEqual(resolveRoot(drive.toLowerCase() + '\\'), drive + '\\');
    assert.strictEqual(resolveRoot(dir + '\\'), dir);
    assert.strictEqual(resolveRoot(dir + '\\.'), dir);
    assert.strictEqual(resolveRoot(file), null);
    assert.strictEqual(resolveRoot(path.join(dir, 'missing')), null);
    assert.strictEqual(resolveRoot('relative\\folder'), null);
    assert.strictEqual(resolveRoot('\\\\server\\share'), null);
    assert.strictEqual(resolveRoot(''), null);
    assert.strictEqual(resolveRoot(null), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
