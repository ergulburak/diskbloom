'use strict';
// File type groups. The scan tree adds up the size of each group in every folder;
// the renderer names the groups and highlights them on the map.

const TYPES = ['video', 'image', 'audio', 'archive', 'diskimage', 'program', 'document', 'code', 'other'];

const EXTENSIONS = {
  video: 'mp4 mkv mov avi wmv webm m4v mts m2ts flv mpg mpeg 3gp vob',
  image: 'jpg jpeg png gif webp heic heif avif bmp tif tiff psd raw cr2 cr3 nef arw dng svg ico',
  audio: 'mp3 wav flac aac ogg opus m4a wma aiff',
  archive: 'zip rar 7z tar gz tgz bz2 xz zst cab',
  diskimage: 'iso img vhd vhdx vmdk vdi qcow2 wim esd',
  program: 'exe msi dll sys bin pak so dylib appx msix',
  document: 'pdf doc docx xls xlsx ppt pptx odt ods odp rtf txt md csv epub',
  // .ts is TypeScript here: node_modules hold far more of it than transport-stream video.
  code: 'js mjs cjs ts tsx jsx py cs cpp cc c h hpp java kt go rs rb php swift lua json xml yml yaml toml html css scss sql sh ps1 bat',
};

const OTHER = TYPES.length - 1;
const byExt = new Map();
for (const [type, list] of Object.entries(EXTENSIONS)) {
  for (const ext of list.split(' ')) byExt.set(ext, TYPES.indexOf(type));
}

/** Index in TYPES for a file name. Names without an extension (or dot files) are 'other'. */
function typeOf(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return OTHER;
  const t = byExt.get(name.slice(dot + 1).toLowerCase());
  return t === undefined ? OTHER : t;
}

module.exports = { TYPES, typeOf };
