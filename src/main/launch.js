'use strict';
// Turns a path from the command line, the folder dialog or Explorer into a scan root.

const fs = require('node:fs');
const path = require('node:path');

/** The raw value of --scan=<path> in a command line, or null. */
function scanArg(argv) {
  const a = argv.find(x => x.startsWith('--scan='));
  if (!a) return null;
  // Explorer sends a drive as "C:\" and the closing quote then arrives escaped (C:"), so quotes go.
  return a.slice(7).replace(/"/g, '').trim() || null;
}

/**
 * Returns the real path of a drive or folder that can be scanned ('C:\' or 'C:\Users\me'),
 * or null when it is not an existing folder on a drive letter.
 */
function resolveRoot(p) {
  if (typeof p !== 'string' || !p.trim()) return null;
  let full = p.trim();
  if (/^[a-z]:$/i.test(full)) full += '\\';
  if (!/^[a-z]:[\\/]/i.test(full)) return null;
  // A drive root stays as it is: realpath turns a subst or mapped network drive into its
  // target, but the drive list shows it by its letter and the scan works on the letter.
  if (/^[a-z]:[\\/]$/i.test(full)) {
    try { return fs.statSync(full).isDirectory() ? full.slice(0, 2).toUpperCase() + '\\' : null; } catch { return null; }
  }
  try {
    full = fs.realpathSync.native(path.resolve(full));
    if (!fs.statSync(full).isDirectory()) return null;
  } catch {
    return null;
  }
  if (!/^[a-z]:\\/i.test(full)) return null;
  return /^[a-z]:\\$/i.test(full) ? full.toUpperCase() : full.replace(/\\+$/, '');
}

module.exports = { scanArg, resolveRoot };
