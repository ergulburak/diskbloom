'use strict';
// Compiles native/scanner.cs with the C# compiler that ships with Windows (.NET Framework 4.x),
// so no SDK install is needed.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const windir = process.env.WINDIR || 'C:\\Windows';
const csc = ['Framework64', 'Framework']
  .map(f => path.join(windir, 'Microsoft.NET', f, 'v4.0.30319', 'csc.exe'))
  .find(p => fs.existsSync(p));

if (!csc) {
  console.error('csc.exe not found. Install .NET Framework 4.x or build native/scanner.cs another way.');
  process.exit(1);
}

execFileSync(csc, [
  '-nologo', '-optimize+', '-platform:x64',
  '-out:' + path.join(root, 'native', 'scanner.exe'),
  path.join(root, 'native', 'scanner.cs'),
], { stdio: 'inherit' });
console.log('built native/scanner.exe');
