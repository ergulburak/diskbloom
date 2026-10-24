'use strict';
// Decides which paths Diskbloom refuses to move to the Recycle Bin.
// The renderer shows the reason; the main process enforces it again before any trash call.

const SYSTEM_FILES = new Set([
  'pagefile.sys', 'hiberfil.sys', 'swapfile.sys', 'dumpstack.log', 'dumpstack.log.tmp',
  'bootmgr', 'bootnxt', 'system volume information', '$recycle.bin', 'recovery', 'boot',
  '$winreagent', '$windows.~bt', '$windows.~ws', 'config.msi', 'msocache',
]);

// Sub-folders of locked areas that are safe to clean.
const ALLOWED = [
  'windows\\softwaredistribution\\download',
  'windows\\temp',
];

function split(p) {
  const norm = String(p).replace(/\//g, '\\').replace(/\\+$/, '');
  const m = /^([a-zA-Z]:)(?:\\(.*))?$/.exec(norm);
  if (!m) return null;
  return { drive: m[1].toUpperCase(), rest: (m[2] || '').toLowerCase() };
}

/**
 * Returns null when the path may be moved to the Recycle Bin, otherwise a reason code:
 *   'root'     a drive root or a top-level user profile folder
 *   'system'   Windows itself or a file Windows needs to boot or page
 *   'program'  an installed program (uninstall it from Settings instead)
 */
function lockReason(p) {
  const s = split(p);
  if (!s) return 'root';
  const { rest } = s;
  if (!rest) return 'root';
  const parts = rest.split('\\');
  const top = parts[0];

  // Only what is inside these folders may go; the folders themselves stay.
  for (const a of ALLOWED) {
    if (rest === a) return 'root';
    if (rest.startsWith(a + '\\')) return null;
  }

  if (parts.length === 1 && SYSTEM_FILES.has(top)) return 'system';
  if (top === '$recycle.bin' || top === 'system volume information') return 'system';
  if (top === 'windows') return 'system';
  if (top === 'program files' || top === 'program files (x86)') return 'program';
  // ProgramData and the app folders directly in it hold settings that programs need.
  if (top === 'programdata' && parts.length <= 2) return 'system';
  if (top === 'users') {
    if (parts.length <= 2) return 'root';
    // The profile's own top folders (Desktop, Documents, AppData...) stay; their contents may go.
    if (parts.length === 3) return 'root';
    if (parts[2] === 'appdata' && parts.length === 4) return 'root';
    if (parts[2] === 'appdata' && parts.length === 5 && parts[3] === 'local' && parts[4] === 'temp') return 'root';
  }
  return null;
}

module.exports = { lockReason };
