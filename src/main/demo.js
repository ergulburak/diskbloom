'use strict';
// A made-up C: drive for demos and screenshots (run with --demo). It produces the same
// line protocol as scanner.exe, so the rest of the app cannot tell the difference.

const GB = 1024 ** 3;

// Deterministic random numbers, so every demo looks the same.
function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// many(n, gb, name) makes n files that add up to about gb, with uneven sizes.
const many = (n, gb, name) => ({ many: true, n, gb, name });
const pad = (i, w = 4) => String(i).padStart(w, '0');

const SPEC = {
  'Users': {
    'alex': {
      'Downloads': {
        'Windows11_24H2.iso': 6.2, 'ubuntu-24.04-desktop.iso': 5.9, 'Old backups.zip': 12.5, 'Blender-4.2.msi': 0.4,
        'Setup files': many(60, 9.5, i => `setup_${pad(i, 2)}.exe`),
        'Phone backup': { 'DCIM': many(1800, 8.1, i => `IMG_2025${pad(i)}.jpg`), 'WhatsApp': many(2600, 3.4, i => `VID-2025-${pad(i)}.mp4`) },
        'Misc': many(900, 2.2, i => `file_${pad(i)}.pdf`),
      },
      'Videos': {
        'Holiday 2025': many(42, 21.5, i => `GX01${pad(i)}.MP4`),
        'Screen recordings': many(36, 9.2, i => `Recording ${pad(i, 2)}.mkv`),
        'Movies': { 'Interstellar.mkv': 4.1, 'Dune Part Two.mkv': 3.8, 'Inception.mkv': 2.9, 'Arrival.mkv': 2.4 },
        'Birthday.mov': 1.8,
      },
      'Pictures': {
        'Camera Roll': many(2400, 13.8, i => `IMG_${pad(i)}.HEIC`),
        'Screenshots': many(900, 1.3, i => `Screenshot ${pad(i)}.png`),
        'Wallpapers': many(120, 0.6, i => `wall_${pad(i, 3)}.jpg`),
      },
      'Documents': many(640, 3.1, i => `document_${pad(i)}.docx`),
      'Desktop': { 'Thesis final.pdf': 0.2, 'Design assets': many(220, 4.4, i => `asset_${pad(i, 3)}.psd`) },
      'Projects': {
        'game-prototype': { 'Library': many(6000, 8.6, i => `cache_${pad(i, 5)}.bin`), 'Assets': many(1400, 6.2, i => `texture_${pad(i)}.png`) },
        'web-app': { 'node_modules': many(30000, 1.4, i => `module_${pad(i, 5)}.js`), 'dist': many(80, 0.1, i => `chunk_${pad(i, 2)}.js`) },
      },
      'AppData': {
        'Local': {
          'Temp': many(3200, 4.6, i => `tmp${pad(i, 5)}.tmp`),
          'Google': { 'Chrome': { 'User Data': { 'Default': { 'Cache': many(4000, 2.8, i => `f_${pad(i, 6)}`) } } } },
          'npm-cache': many(9000, 1.9, i => `pkg_${pad(i, 5)}.tgz`),
          'Unity': many(1200, 7.4, i => `asset_cache_${pad(i)}`),
          'CrashDumps': many(14, 0.7, i => `app.exe.${pad(i, 5)}.dmp`),
        },
        'Roaming': { 'Spotify': { 'Storage': many(1600, 6.1, i => `${pad(i, 6)}.file`) }, 'discord': many(400, 0.9, i => `cache_${pad(i)}`) },
      },
    },
    'Public': many(40, 0.3, i => `shared_${pad(i, 2)}.dat`),
  },
  'Games': {
    'Cyberpunk 2077': many(120, 71, i => `archive_${pad(i, 3)}.archive`),
    'Forza Horizon 5': many(260, 103, i => `media_${pad(i, 3)}.zip`),
    'VALORANT': many(90, 34, i => `pak_${pad(i, 3)}.pak`),
  },
  'Program Files': {
    'Adobe': many(9000, 12.4, i => `adobe_${pad(i)}.dll`),
    'Microsoft Office': many(5000, 4.1, i => `office_${pad(i)}.dll`),
    'NVIDIA Corporation': many(1400, 2.5, i => `nv_${pad(i)}.dll`),
    'Unity': { 'Hub': many(400, 0.4, i => `hub_${pad(i)}.dll`), 'Editor 2022.3': many(22000, 9.2, i => `editor_${pad(i, 5)}.dll`) },
  },
  'Program Files (x86)': { 'Steam': many(3000, 3.2, i => `steam_${pad(i)}.dll`), 'Microsoft': many(2600, 2.1, i => `ms_${pad(i)}.dll`) },
  'ProgramData': many(4000, 6.3, i => `data_${pad(i)}.dat`),
  'Windows': {
    'System32': many(18000, 9.8, i => `sys_${pad(i, 5)}.dll`),
    'WinSxS': many(40000, 14.1, i => `wsx_${pad(i, 5)}.dll`),
    'SoftwareDistribution': { 'Download': many(300, 3.4, i => `update_${pad(i, 3)}.cab`) },
    'Installer': many(400, 5.2, i => `inst_${pad(i, 3)}.msi`),
    'Temp': many(200, 0.4, i => `wtmp_${pad(i, 3)}.log`),
  },
  'pagefile.sys': 16, 'hiberfil.sys': 6.4, '$Recycle.Bin': {},
};

/** Returns the demo drive as an array of protocol lines (without the final X). */
function demoLines() {
  const rand = rng(42);
  const lines = [];
  let nextId = 0;
  const walk = (obj, parentId) => {
    for (const [name, v] of Object.entries(obj)) {
      if (typeof v === 'number') {
        lines.push(`F\t${parentId}\t${Math.round(v * GB)}\t${name}`);
      } else if (v.many) {
        const id = ++nextId;
        lines.push(`D\t${id}\t${parentId}\t${name}`);
        const weights = Array.from({ length: v.n }, () => Math.exp(rand() * 3));
        const sum = weights.reduce((a, b) => a + b, 0);
        weights.forEach((w, i) => lines.push(`F\t${id}\t${Math.round(w / sum * v.gb * GB)}\t${v.name(i + 1)}`));
      } else {
        const id = ++nextId;
        lines.push(`D\t${id}\t${parentId}\t${name}`);
        walk(v, id);
      }
    }
  };
  walk(SPEC, 0);
  // Shuffle in blocks so the demo "scan" fills the map from many places at once, like a real one.
  const head = lines.filter(l => l[0] === 'D');
  const files = lines.filter(l => l[0] === 'F');
  for (let i = files.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [files[i], files[j]] = [files[j], files[i]]; }
  return head.concat(files);
}

const DEMO_DRIVES = [
  { root: 'C:\\', letter: 'C:', total: 476 * GB, free: 29 * GB },
  { root: 'D:\\', letter: 'D:', total: 931 * GB, free: 412 * GB },
];

const DEMO_QUICK = [
  { id: 'temp', path: 'C:\\Users\\alex\\AppData\\Local\\Temp' },
  { id: 'wintemp', path: 'C:\\Windows\\Temp' },
  { id: 'update', path: 'C:\\Windows\\SoftwareDistribution\\Download' },
  { id: 'chrome', path: 'C:\\Users\\alex\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache' },
  { id: 'crash', path: 'C:\\Users\\alex\\AppData\\Local\\CrashDumps' },
  { id: 'npm', path: 'C:\\Users\\alex\\AppData\\Local\\npm-cache' },
];

module.exports = { demoLines, DEMO_DRIVES, DEMO_QUICK };
