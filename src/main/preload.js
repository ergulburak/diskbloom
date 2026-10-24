'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('diskbloom', {
  window: action => ipcRenderer.invoke('win:control', action),
  drives: () => ipcRenderer.invoke('drives:list'),
  quickTargets: () => ipcRenderer.invoke('quick:list'),
  scan: root => ipcRenderer.invoke('scan:start', root),
  cancelScan: () => ipcRenderer.invoke('scan:cancel'),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  toolInfo: () => ipcRenderer.invoke('tool:info'),
  openTool: id => ipcRenderer.invoke('tool:open', id),
  hibernateOff: () => ipcRenderer.invoke('tool:hibernateOff'),
  explorerMenu: () => ipcRenderer.invoke('menu:get'),
  setExplorerMenu: (on, label) => ipcRenderer.invoke('menu:set', on, label),
  view: (path, depth) => ipcRenderer.invoke('tree:view', path, depth),
  search: (path, filter) => ipcRenderer.invoke('tree:search', path, filter),
  trash: items => ipcRenderer.invoke('items:trash', items),
  reveal: path => ipcRenderer.invoke('shell:reveal', path),
  openRecycleBin: () => ipcRenderer.invoke('shell:recycleBin'),
  info: () => ipcRenderer.invoke('app:info'),
  elevate: root => ipcRenderer.invoke('app:elevate', root),
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: patch => ipcRenderer.invoke('settings:set', patch),
  onProgress: fn => ipcRenderer.on('scan:progress', (_e, m) => fn(m)),
  onTrashProgress: fn => ipcRenderer.on('trash:progress', (_e, m) => fn(m)),
  onWindowState: fn => ipcRenderer.on('win:state', (_e, m) => fn(m)),
  onScanRequest: fn => ipcRenderer.on('app:scan', (_e, m) => fn(m)),
});
