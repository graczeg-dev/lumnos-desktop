'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, session, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { startUrl } = require('./config');
const files = require('./files');

const ORIGIN = startUrl();
// Google sign-in runs inside the window; everything else that is not Lumnos opens in the user's browser.
const IN_APP_ORIGINS = new Set([ORIGIN, 'https://accounts.google.com']);
const isLumnos = (url) => { try { return new URL(url).origin === ORIGIN; } catch { return false; } };
const allowedInApp = (url) => { try { return IN_APP_ORIGINS.has(new URL(url).origin); } catch { return false; } };
const openExternal = (url) => { try { const u = new URL(url); if (u.protocol === 'https:' || u.protocol === 'mailto:') void shell.openExternal(u.toString()); } catch { /* ignore */ } };

// One instance only.
if (!app.requestSingleInstanceLock()) app.quit();
app.enableSandbox();

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 720, minHeight: 500, title: 'Lumnos', backgroundColor: '#f4f5f7', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInSubFrames: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, spellcheck: true, safeDialogs: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  // Navigation: stay on Lumnos (and Google sign-in); send everything else to the browser.
  win.webContents.on('will-navigate', (e, url) => { if (!allowedInApp(url)) { e.preventDefault(); openExternal(url); } });
  win.webContents.on('will-redirect', (e, url) => { if (!allowedInApp(url)) { e.preventDefault(); openExternal(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  void win.loadURL(ORIGIN);
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
});

/** Only the Lumnos page's main frame may use the bridge (never artifact previews or other frames). */
function trusted(event) {
  const frame = event.senderFrame;
  return !!frame && frame === event.sender.mainFrame && isLumnos(frame.url);
}
const guard = (handler) => async (event, ...args) => { if (!trusted(event)) throw new Error('Not allowed'); return handler(event, ...args); };

ipcMain.handle('lumnos:pick-files', guard(async (_e, opts) => {
  const folder = !!(opts && opts.folder);
  const r = await dialog.showOpenDialog(win, { title: folder ? 'Attach a folder' : 'Attach files', properties: folder ? ['openDirectory'] : ['openFile', 'multiSelections'] });
  if (r.canceled || !r.filePaths.length) return [];
  return files.readPicked(r.filePaths);
}));
ipcMain.handle('lumnos:pick-save-folder', guard(async (_e, suggestedName) => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose where to save', buttonLabel: 'Save here', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const real = await fs.realpath(r.filePaths[0]);
  return { id: files.grantFolder(real), name: path.basename(real), suggestedName: typeof suggestedName === 'string' ? suggestedName.slice(0, 80) : '' };
}));
ipcMain.handle('lumnos:save-files', guard(async (_e, folderId, list) => files.writeFiles(folderId, list)));
ipcMain.handle('lumnos:reveal-folder', guard(async (_e, folderId) => { await shell.openPath(files.folderFor(folderId)); return true; }));

app.whenReady().then(() => {
  // Google sign-in rejects embedded browsers that announce themselves as Electron; present a standard Chrome user agent.
  app.userAgentFallback = app.userAgentFallback.replace(/\s?(Electron|lumnos-desktop|Lumnos)\/[^\s]+/g, '');
  // Permissions: only what Lumnos uses. Everything else (camera, mic, location, USB, MIDI...) is denied.
  const allowed = new Set(['clipboard-sanitized-write', 'notifications', 'fullscreen', 'display-capture', 'media']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    const okOrigin = isLumnos(details.requestingUrl || wc.getURL());
    if (permission === 'media') return cb(okOrigin && (details.mediaTypes || []).every((t) => t === 'video') && !(details.mediaTypes || []).includes('audio'));
    cb(okOrigin && allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => isLumnos(origin) && allowed.has(permission));
  // Screen recording (Record 15 s): capture this window only.
  session.defaultSession.setDisplayMediaRequestHandler((request, cb) => {
    if (!isLumnos(request.frame?.url || '') || !win) return cb({});
    cb({ video: win.webContents.mainFrame });
  });
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
