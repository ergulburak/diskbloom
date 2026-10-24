# Diskbloom design notes

## Why

The owner's C: drive filled up and they wanted to find the big folders and remove them. Existing
tools (SpaceSniffer) show the right picture but look dated. Diskbloom is meant to be shared on
GitHub, so the presentation matters as much as the function: smooth animation and a soft,
macOS-like look are core requirements, not polish.

## Decisions made with the owner

- **Platform:** Windows desktop only. Technology was left to the builder.
- **Look:** dark frosted glass panels over slowly moving pastel light; tiles have rounded corners,
  pastel outlines and a light tint ("dark glass + pastel outline"). The selected tile fills with colour.
- **Layout:** three panels. Left: drives and quick clean. Centre: the treemap. Right: the cleanup basket.
- **Details:** a floating glass window follows the mouse like a tooltip. There is no fixed detail panel.
- **Drill-down:** a folder is never deleted blindly. Double-click opens a folder so single files and
  sub-folders inside it can be picked.
- **Delete:** move to the Recycle Bin, always after a confirmation dialog.

## Calls made by the builder (open to change)

- Electron + plain HTML/CSS/JS, so the approved browser mockups carry over one to one.
- A native C# scanner (compiled with the csc.exe that ships with Windows) instead of a Node walker:
  about 7x faster and it also reads sizes of locked files such as pagefile.sys.
- The scanned tree lives in an Electron utility process; the window asks for bounded snapshots.
- A cleanup basket collects items from anywhere, then one confirmation moves them all.
- Locked paths: Windows, Program Files, drive roots, a profile's top folders, page/hibernation files,
  the Temp and cache folders themselves (their contents are allowed).
- Quick clean adds the contents of known caches (Temp, browser caches, Windows Update downloads,
  crash dumps, npm, pip, Gradle, NuGet) when they exist.
- The free-space figure counts moved items as still used until the Recycle Bin is emptied.
- Turkish and English; Turkish when the Windows region or a preferred language is Turkish.
- `--demo` shows a made-up drive and never touches the disk, for screenshots and talks.
- A scan root can be a drive or a single folder on a drive letter. Network paths (`\\server\share`)
  are not offered, because the lock rules and the tree are written for drive paths.
- One window at a time. `--scan=<folder>` from a second start (the Explorer menu) goes to the open
  window. The demo and the e2e test do not take the lock.
- The Explorer menu entry is opt-in (a switch in the side panel) and lives under HKEY_CURRENT_USER,
  so it works for the portable .exe too and needs no administrator rights. It uses the classic
  `shell` verb, which Windows 11 shows under "Show more options"; the new Windows 11 menu would need
  a signed package with a COM handler.

- File types are shown by lighting up one type at a time, not by giving every type its own colour.
  Nine pastel colours on one map fail a colour-vision check (several pairs collapse for red-green
  colour blindness, and even yellow and orange are close for normal vision). One lit type needs no
  colour key, keeps the pastel folder colours, and reads the same for everyone. A folder tile is as
  bright as its share of the lit type. The list itself uses one colour for every bar.
- Nine type groups by extension (`src/shared/filetypes.js`); `.ts` counts as code, because
  node_modules hold far more TypeScript than transport-stream video.

- Hidden space = the drive's used space minus the scanned total, shown only after a complete
  drive scan and only from 256 MB (or 0.2% of the drive) up, so cluster slack does not make noise.
  The scanner counts logical sizes, so compressed or cloud-only files can hide part of the gap.
- Diskbloom does not delete restore points or system files itself; the tools dialog opens the
  Windows tool that owns them. Turning hibernation off is the one setting it changes, after a second
  click and a UAC prompt.

- The scanner sends each file's last write time. Find runs on the scan tree in the scan process
  (about 0.2 s for 1.3 million files) and returns only the largest 200 matches plus the count and total.
  A folder's age is the age of its newest file; a matching folder is listed once, not again for
  every folder inside it.
- Each complete scan keeps a snapshot of the folders of 10 MB and up (about 0.7 MB for a full system
  drive) and compares it with the previous snapshot of the same root. Only changes of 50 MB and up
  are listed, and a parent is left out when one listed folder inside it explains 80% of its change.
  A rescan is the only trigger; there is no scheduled scan.

## Not in this version

- Emptying the Recycle Bin from the app, permanent delete.
- Reading the NTFS MFT directly (WizTree-style), which would need administrator rights.
- Duplicate finding, scheduled scans, auto-update, code signing.
