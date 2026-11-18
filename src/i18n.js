// Interface language (第 47 节). Chinese is built in: every UI string in the
// source is the Chinese text itself, wrapped in tr(). Other languages are
// external `.lang` files (JSON, see lang/README.md) that map that Chinese
// text to a translation. They live in `lang/` next to the executable on the
// desktop and in the repository's `lang/` folder on the dev server.
//
// tr(text, ...args): `{0}`, `{1}`… in the (translated) text are replaced by
// args. A missing or empty translation falls back to the Chinese text.
//
// This module uses top-level await, so every module that imports tr() waits
// until the chosen language has been loaded; strings built at module level
// (item names, effect names…) are therefore already translated.
import { readConfig, writeConfig } from './app-config.js';

export const BUILTIN_LANGUAGE = { code: 'zh-CN', name: '简体中文', nativeName: '简体中文', builtin: true };
const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let table = null;
let languageFiles = null;

// Saved in Config/settings.json (app-config.js, 第 51 节).
function readSetting() { return readConfig('language', null); }
function writeSetting(code) { writeConfig('language', code); }

// [{file, text}] from the desktop `lang/` folder or the dev server / web build.
async function readLanguageFiles() {
  if (isDesktop) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('language_files');
  }
  const index = await fetch('./lang/index.json', { cache: 'no-cache' }).then(response => response.ok ? response.json() : []);
  return Promise.all(index.map(async file => ({ file, text: await fetch(`./lang/${encodeURIComponent(file)}`, { cache: 'no-cache' }).then(response => response.text()) })));
}

function flatten(node, out) {
  for (const [key, value] of Object.entries(node || {})) {
    if (typeof value === 'string') { if (value) out.set(key, value); }
    else if (value && typeof value === 'object') flatten(value, out);
  }
  return out;
}

// Parses one .lang file. Throws with a readable message when it is invalid.
export function parseLanguageFile(text, file = '') {
  const data = JSON.parse(String(text).replace(/^﻿/, ''));
  const info = data?.language;
  if (!info || typeof info.code !== 'string' || !info.code) throw new Error(`${file}: missing language.code`);
  const strings = flatten(data.strings, new Map());
  return { code: info.code, name: info.name || info.code, nativeName: info.nativeName || info.name || info.code, author: info.author || '', file, strings };
}

// All usable languages: the built-in Chinese first, then valid external files.
export async function listLanguages() {
  if (!languageFiles) {
    let files = [];
    try { files = await readLanguageFiles(); } catch (error) { console.warn('Could not read language files:', error); }
    languageFiles = [];
    for (const { file, text } of files) {
      try {
        const language = parseLanguageFile(text, file);
        if (language.code !== BUILTIN_LANGUAGE.code && !languageFiles.some(other => other.code === language.code)) languageFiles.push(language);
      } catch (error) { console.warn(`Invalid language file ${file}:`, error); }
    }
  }
  return [BUILTIN_LANGUAGE, ...languageFiles];
}

function pickLanguage(saved) {
  if (saved) return saved;
  const preferred = (typeof navigator !== 'undefined' && navigator.languages) || [];
  return preferred.length && !/^zh\b/i.test(preferred[0]) ? preferred[0] : BUILTIN_LANGUAGE.code;
}

let current = BUILTIN_LANGUAGE;
async function init() {
  const wanted = pickLanguage(readSetting());
  if (wanted === BUILTIN_LANGUAGE.code) return;
  const languages = await listLanguages();
  const base = wanted.split('-')[0].toLowerCase();
  const match = languages.find(language => language.code.toLowerCase() === wanted.toLowerCase()) || languages.find(language => language.code.split('-')[0].toLowerCase() === base);
  if (!match || match.builtin) return;
  current = match;
  table = match.strings;
}
await init();
if (typeof document !== 'undefined') document.documentElement.lang = current.code;

export function currentLanguage() { return current; }

export function tr(text, ...args) {
  let result = table?.get(text) ?? text;
  if (args.length) result = result.replace(/\{(\d+)\}/g, (match, index) => index < args.length ? String(args[index]) : match);
  return result;
}

// Saves the choice; the caller reloads the page so every string is rebuilt.
export function saveLanguage(code) { writeSetting(code); }
