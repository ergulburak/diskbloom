'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { TYPES, typeOf } = require('../src/shared/filetypes');

const type = name => TYPES[typeOf(name)];

test('typeOf groups files by extension, in any letter case', () => {
  assert.strictEqual(type('Holiday.MP4'), 'video');
  assert.strictEqual(type('photo.jpeg'), 'image');
  assert.strictEqual(type('song.flac'), 'audio');
  assert.strictEqual(type('backup.tar.gz'), 'archive');
  assert.strictEqual(type('Win11.iso'), 'diskimage');
  assert.strictEqual(type('setup.exe'), 'program');
  assert.strictEqual(type('report.pdf'), 'document');
  assert.strictEqual(type('index.d.ts'), 'code');
});

test('names without a known extension are other', () => {
  assert.strictEqual(type('README'), 'other');
  assert.strictEqual(type('.gitignore'), 'other');
  assert.strictEqual(type('data.unknownext'), 'other');
  assert.strictEqual(type('trailingdot.'), 'other');
  assert.strictEqual(TYPES[TYPES.length - 1], 'other');
});
