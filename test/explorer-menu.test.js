'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { menuCommand, defaultValue } = require('../src/main/explorer-menu');
const { scanArg } = require('../src/main/launch');

test('menuCommand quotes the program and passes the clicked folder', () => {
  assert.strictEqual(menuCommand('C:\\Apps\\Diskbloom.exe'), '"C:\\Apps\\Diskbloom.exe" --scan="%V"');
  assert.strictEqual(menuCommand('C:\\dev\\electron.exe', 'C:\\dev\\app'), '"C:\\dev\\electron.exe" "C:\\dev\\app" --scan="%V"');
});

test('defaultValue reads reg query output in any language', () => {
  const en = '\r\nHKEY_CURRENT_USER\\Software\\Classes\\Drive\\shell\\Diskbloom\r\n    (Default)    REG_SZ    Scan with Diskbloom\r\n\r\n';
  const tr = '\r\nHKEY_CURRENT_USER\\Software\\Classes\\Drive\\shell\\Diskbloom\r\n    (Varsayılan)    REG_SZ    "C:\\A B\\Diskbloom.exe" --scan="%V"\r\n\r\n';
  assert.strictEqual(defaultValue(en), 'Scan with Diskbloom');
  assert.strictEqual(defaultValue(tr), '"C:\\A B\\Diskbloom.exe" --scan="%V"');
  assert.strictEqual(defaultValue(null), null);
});

test('what Explorer sends for a drive still reads as that drive', () => {
  // Explorer fills %V with C:\ ; the backslash then escapes the closing quote.
  assert.strictEqual(scanArg(['Diskbloom.exe', '--scan=C:"']), 'C:');
  assert.strictEqual(scanArg(['Diskbloom.exe', '--scan=D:\\Games']), 'D:\\Games');
});
