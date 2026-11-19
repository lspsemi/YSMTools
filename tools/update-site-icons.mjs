// Downloads the latest Material Symbols Outlined from Google Fonts, subset to the
// icons used in site/index.html, into site/assets/fonts/material-symbols-outlined.woff2.
// Run after adding or changing an icon on the site:  node tools/update-site-icons.mjs
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../site/', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
// Icons in the markup, plus icons the page script renders with icon('name').
const names = [...new Set([
  ...[...html.matchAll(/<span class="icon[^"]*"[^>]*>([a-z0-9_]+)<\/span>/g)].map(m => m[1]),
  ...[...html.matchAll(/\bicon\('([a-z0-9_]+)'\)/g)].map(m => m[1])
])].sort();

// FILL 0..1 and wght 400..500 are the only axis values the page uses (opsz 24, GRAD 0).
const css = await (await fetch(
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400..500,0..1,0'
  + `&icon_names=${names.join(',')}&display=block`,
  { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' } }
)).text();
const url = css.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)\s*format\('woff2'\)/)?.[1];
if (!url) throw new Error('No woff2 URL in Google Fonts response:\n' + css);

const font = Buffer.from(await (await fetch(url)).arrayBuffer());
if (font.subarray(0, 4).toString() !== 'wOF2') throw new Error('Downloaded file is not WOFF2');
await writeFile(new URL('assets/fonts/material-symbols-outlined.woff2', root), font);
console.log(`${names.length} icons, ${font.length} bytes, ${url.match(/v=(v\d+)/)?.[1] ?? 'unknown version'}`);
