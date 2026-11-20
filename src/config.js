'use strict';
// The only web origins the app will ever load. LUMNOS_URL may point to a local dev server (http://localhost only).
const DEFAULT_URL = 'https://lumnos.ai';
function startUrl(env = process.env) {
  const raw = env.LUMNOS_URL || DEFAULT_URL;
  const u = new URL(raw);
  const dev = u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  if (u.protocol !== 'https:' && !dev) throw new Error('LUMNOS_URL must be https (or http://localhost for development)');
  return u.origin;
}
module.exports = { DEFAULT_URL, startUrl };
