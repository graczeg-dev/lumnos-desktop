'use strict';
// The only things the Lumnos page can ask the desktop app to do. No Node, no paths, no generic IPC.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lumnosDesktop', Object.freeze({
  version: 1,
  /** Opens the system file picker; returns [{ name, type, data: Uint8Array }] for what the user picked. */
  pickFiles: (opts) => ipcRenderer.invoke('lumnos:pick-files', { folder: !!(opts && opts.folder) }),
  /** Asks the user for a folder to save into; returns an opaque { id, name } or null. */
  pickSaveFolder: (suggestedName) => ipcRenderer.invoke('lumnos:pick-save-folder', String(suggestedName ?? '')),
  /** Writes files (relative paths only) into a folder the user picked. */
  saveFiles: (folderId, list) => ipcRenderer.invoke('lumnos:save-files', String(folderId), list),
  revealFolder: (folderId) => ipcRenderer.invoke('lumnos:reveal-folder', String(folderId)),
}));
