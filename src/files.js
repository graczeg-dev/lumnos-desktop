'use strict';
// Local file access, limited to files and folders the user picked in the system dialog in this session.
// The web page never sees real paths: it gets opaque grant ids, and every request is checked against them.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_READ = 25 * 1024 * 1024;      // per file
const MAX_TOTAL = 100 * 1024 * 1024;    // per pick
const MAX_FILES = 200;                  // per pick
const MAX_WRITE = 50 * 1024 * 1024;     // per save
const SKIP_DIRS = new Set(['.git', 'node_modules', '.DS_Store', '__pycache__', '.venv', 'dist', 'build']);
const MIME = { '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.pdf':'application/pdf',
  '.txt':'text/plain','.md':'text/markdown','.csv':'text/csv','.json':'application/json','.html':'text/html','.css':'text/css','.js':'text/javascript','.ts':'text/plain','.tsx':'text/plain','.py':'text/x-python',
  '.mp3':'audio/mpeg','.wav':'audio/wav','.mp4':'video/mp4','.webm':'video/webm','.zip':'application/zip','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation' };

/** Folders granted for saving: id -> real absolute path. Lives only in memory for this app session. */
const grants = new Map();
function grantFolder(realDir) { const id = crypto.randomBytes(16).toString('hex'); grants.set(id, realDir); return id; }
function folderFor(id) { if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) throw new Error('Unknown folder'); const d = grants.get(id); if (!d) throw new Error('Unknown folder'); return d; }

/** Resolve a relative path inside root, refusing anything that escapes it (.., absolute paths, drive letters, symlinks). */
async function safeJoin(root, rel) {
  if (typeof rel !== 'string' || !rel.length || rel.length > 400) throw new Error('Invalid file name');
  if (rel.includes('\0') || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) throw new Error('Invalid file name');
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (!parts.length || parts.some((p) => p === '..' || p === '.' || /[<>:"|?*\x00-\x1f]/.test(p))) throw new Error('Invalid file name');
  const target = path.resolve(root, ...parts);
  const rootReal = await fs.realpath(root);
  if (target !== rootReal && !target.startsWith(rootReal + path.sep)) throw new Error('Invalid file name');
  // Every existing ancestor must resolve (through symlinks) to somewhere inside the root.
  let probe = path.dirname(target);
  while (probe.length >= rootReal.length) {
    try { const real = await fs.realpath(probe); if (real !== rootReal && !real.startsWith(rootReal + path.sep)) throw new Error('Invalid file name'); break; }
    catch (e) { if (e.code === 'ENOENT') { probe = path.dirname(probe); continue; } throw e; }
  }
  try { const st = await fs.lstat(target); if (st.isSymbolicLink()) throw new Error('Will not overwrite a link'); if (st.isDirectory()) throw new Error('A folder has that name'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return target;
}

async function readPicked(filePaths) {
  const out = []; let total = 0;
  const add = async (abs, rel) => {
    if (out.length >= MAX_FILES) throw new Error(`Pick at most ${MAX_FILES} files at once`);
    const st = await fs.lstat(abs); if (!st.isFile()) return;
    if (st.size > MAX_READ) throw new Error(`${rel} is larger than 25 MB`);
    total += st.size; if (total > MAX_TOTAL) throw new Error('Picked files are larger than 100 MB in total');
    const data = await fs.readFile(abs);
    out.push({ name: rel, type: MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', data: new Uint8Array(data) });
  };
  for (const p of filePaths) {
    const st = await fs.lstat(p);
    if (st.isDirectory()) {
      const base = path.basename(p);
      const walk = async (dir, prefix, depth) => {
        if (depth > 6) return;
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.') || SKIP_DIRS.has(e.name) || e.isSymbolicLink()) continue;
          const abs = path.join(dir, e.name), rel = `${prefix}/${e.name}`;
          if (e.isDirectory()) await walk(abs, rel, depth + 1); else if (e.isFile()) await add(abs, rel);
        }
      };
      await walk(p, base, 0);
    } else if (st.isFile()) await add(p, path.basename(p));
  }
  return out;
}

async function writeFiles(folderId, files) {
  const root = folderFor(folderId);
  if (!Array.isArray(files) || !files.length || files.length > 500) throw new Error('Nothing to save');
  let total = 0; const written = [];
  for (const f of files) {
    if (!f || typeof f.path !== 'string') throw new Error('Invalid file');
    const data = typeof f.text === 'string' ? Buffer.from(f.text, 'utf8') : f.data instanceof Uint8Array ? Buffer.from(f.data) : null;
    if (!data) throw new Error('Invalid file');
    total += data.length; if (total > MAX_WRITE) throw new Error('Too much data to save at once (50 MB)');
    const target = await safeJoin(root, f.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data, { flag: 'w' });
    written.push(path.relative(root, target));
  }
  return { saved: written.length, folderName: path.basename(root) };
}

module.exports = { grantFolder, folderFor, safeJoin, readPicked, writeFiles, grants, limits: { MAX_READ, MAX_TOTAL, MAX_FILES, MAX_WRITE } };
