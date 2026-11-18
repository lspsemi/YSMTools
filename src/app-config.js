// Remembered software options (第 51 节): Config/settings.json in the program
// directory (next to the executable, like library/ and lang/). The dev server
// serves the repository's Config/ folder (tools/config-dev-api.js); a plain web
// build has no file access and only uses localStorage.
//
// The file holds one JSON object, one entry per option group:
//   settings     → main.js appSettings (设置 tab)
//   theme        → 'light' | 'dark'
//   language     → interface language code (i18n.js)
//   libraryView  → model library sort/filter/page (library/*)
// Every value is also mirrored to its old localStorage key, so a missing or
// unwritable Config folder still keeps the options, and options saved by
// older versions (localStorage only) are moved into the file on first start.
//
// This module uses top-level await: importers get the loaded options.
const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const DEV_URL = '/__config/settings.json';
const LEGACY_KEYS = { settings: 'ysm-preview-settings', theme: 'ysm-theme', language: 'ysm-preview-language', libraryView: 'ysm-library-view' };
const JSON_ENTRIES = new Set(['settings', 'libraryView']);

let fileBackend = null; // {read(): Promise<string|null>, write(text): Promise}
let config = {};

function readLegacy(name) {
  try {
    const text = localStorage.getItem(LEGACY_KEYS[name]);
    if (text == null) return undefined;
    return JSON_ENTRIES.has(name) ? JSON.parse(text) : text;
  } catch { return undefined; }
}
function writeLegacy(name, value) {
  try { localStorage.setItem(LEGACY_KEYS[name], JSON_ENTRIES.has(name) ? JSON.stringify(value) : String(value)); } catch {}
}

async function desktopBackend() {
  const { invoke } = await import('@tauri-apps/api/core');
  return { read: () => invoke('config_read'), write: text => invoke('config_write', { text }) };
}
async function devBackend() {
  if (!import.meta.env?.DEV) return null;
  const response = await fetch(DEV_URL, { cache: 'no-cache' }).catch(() => null);
  if (!response || (response.status !== 200 && response.status !== 204)) return null;
  const first = response.status === 200 ? await response.text() : null;
  let used = false;
  return {
    read: async () => { if (!used) { used = true; return first; } const again = await fetch(DEV_URL, { cache: 'no-cache' }); return again.status === 200 ? again.text() : null; },
    write: text => fetch(DEV_URL, { method: 'PUT', body: text, keepalive: text.length < 60000 }).then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); })
  };
}

async function load() {
  try { fileBackend = isDesktop ? await desktopBackend() : await devBackend(); } catch { fileBackend = null; }
  let text = null;
  try { text = fileBackend ? await fileBackend.read() : null; } catch { text = null; }
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    config = parsed;
    return;
  }
  // No file yet (or unreadable): start from the localStorage options.
  for (const name of Object.keys(LEGACY_KEYS)) {
    const value = readLegacy(name);
    if (value !== undefined) config[name] = value;
  }
  if (fileBackend && Object.keys(config).length) flush();
}

let timer = 0, writing = Promise.resolve();
function flush() {
  clearTimeout(timer); timer = 0;
  if (!fileBackend) return;
  const text = JSON.stringify(config, null, 2);
  writing = writing.then(() => fileBackend.write(text)).catch(error => console.warn('无法保存 Config/settings.json', error));
}
function scheduleFlush() { if (!fileBackend) return; clearTimeout(timer); timer = setTimeout(flush, 150); }

/** The remembered value of an option group, or `fallback` when none. */
export function readConfig(name, fallback = undefined) {
  const value = config[name];
  if (value === undefined) return fallback;
  return value && typeof value === 'object' ? structuredClone(value) : value;
}
/** Remembers an option group (written to Config/settings.json shortly after). */
export function writeConfig(name, value) {
  config[name] = value && typeof value === 'object' ? structuredClone(value) : value;
  writeLegacy(name, value);
  scheduleFlush();
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (timer) flush(); });

await load();
