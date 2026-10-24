# Changelog

## 0.2.0

### New

- **Scan one folder.** *Pick a folder…* in the side panel or on the start screen scans a single folder instead of a whole drive.
- **Explorer menu.** Turn on *Explorer menu* in the side panel, then right-click any folder or drive and pick **Scan with Diskbloom**. On Windows 11 it is under *Show more options*. The open window takes the folder; a second window does not open.
- **File types.** The side panel lists video, images, audio, archives, disk images, programs, documents, code and other for the open folder. Click a type and only its tiles stay bright on the map.
- **Hidden space.** After a drive scan, space that Windows counts as used but no file explains (restore points, unreadable folders, file system records) gets its own hatched tile.
- **Windows tools.** One dialog opens Disk Cleanup, Storage Sense and System Protection, and can turn off hibernation to delete `hiberfil.sys` (after a second click and a UAC prompt).
- **Find and largest files.** <kbd>Ctrl</kbd>+<kbd>F</kbd> lists the largest files in the open folder. Filter by name or a pattern such as `*.iso`, type, size and age, or list folders where nothing changed for years.
- **What changed since the last scan.** Rescan a drive or folder and Diskbloom lists the folders that grew or shrank, with the total change.
- Tooltips show when a file last changed, the main types of a folder and its change since the last scan.

### Fixed

- Stop now also stops the slower fallback scan that runs when `scanner.exe` is missing.
- A crash of the scan process during a second scan is reported instead of leaving "Scanning" on screen.
- Subst and mapped network drives in the drive list can be scanned.
- An empty FAT32 or exFAT drive is no longer reported as an unreadable folder.
- OneDrive files that are only in the cloud count as 0 bytes, because they use no space on the disk.
- Moving thousands of files to the Recycle Bin no longer freezes the window.
- The administrator check works when the Windows Server service is off, and it no longer blocks startup.
- The e2e test exits when it is done.

### Notes

- The scanner protocol has a new last-write-time field on file lines. Build `scanner.exe` again with `npm run build:scanner` after you update from source.
- Scan snapshots for the comparison are stored in `%APPDATA%\Diskbloom\snapshots` (about 3 MB for a full system drive).

## 0.1.0

First release: treemap of a drive, native multi-threaded scanner, zoom, floating details, cleanup basket that moves items to the Recycle Bin, locked system paths, quick clean, administrator rescan, Turkish and English.
