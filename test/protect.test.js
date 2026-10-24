'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { lockReason } = require('../src/shared/protect');

test('drive roots and profile folders are locked', () => {
  assert.strictEqual(lockReason('C:\\'), 'root');
  assert.strictEqual(lockReason('D:'), 'root');
  assert.strictEqual(lockReason('C:\\Users'), 'root');
  assert.strictEqual(lockReason('C:\\Users\\burak'), 'root');
  assert.strictEqual(lockReason('C:\\Users\\burak\\Downloads'), 'root');
  assert.strictEqual(lockReason('C:\\Users\\burak\\AppData\\Local'), 'root');
  assert.strictEqual(lockReason('C:\\Users\\burak\\AppData\\Local\\Temp'), 'root');
  assert.strictEqual(lockReason('C:\\Windows\\Temp'), 'root');
  assert.strictEqual(lockReason('C:\\Windows\\SoftwareDistribution\\Download'), 'root');
});

test('system and program areas are locked', () => {
  assert.strictEqual(lockReason('C:\\Windows'), 'system');
  assert.strictEqual(lockReason('C:\\Windows\\System32\\drivers'), 'system');
  assert.strictEqual(lockReason('C:\\pagefile.sys'), 'system');
  assert.strictEqual(lockReason('C:\\$Recycle.Bin\\S-1-5'), 'system');
  assert.strictEqual(lockReason('C:\\Program Files\\Adobe'), 'program');
  assert.strictEqual(lockReason('C:\\Program Files (x86)\\Steam'), 'program');
  assert.strictEqual(lockReason('C:\\ProgramData'), 'system');
  assert.strictEqual(lockReason('C:\\ProgramData\\Microsoft'), 'system');
  assert.strictEqual(lockReason('C:\\ProgramData\\SomeApp\\logs'), null);
});

test('user content and safe caches are allowed', () => {
  assert.strictEqual(lockReason('C:\\Users\\burak\\Downloads\\old.iso'), null);
  assert.strictEqual(lockReason('C:\\Users\\burak\\AppData\\Local\\Temp\\x.tmp'), null);
  assert.strictEqual(lockReason('C:\\Windows\\SoftwareDistribution\\Download\\abc'), null);
  assert.strictEqual(lockReason('C:\\Windows\\Temp\\x.log'), null);
  assert.strictEqual(lockReason('C:\\Games\\Cyberpunk 2077'), null);
  assert.strictEqual(lockReason('D:\\Movies'), null);
  assert.strictEqual(lockReason('C:\\pagefile.sys.bak\\x'), null);
});
