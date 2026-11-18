// Keeps lang/*.lang in step with the source (第 47 节). Run: npm run lang
//
// 1. Collects every tr('中文') key from src/**/*.js, grouped by source file.
// 2. Rewrites each lang/*.lang: keeps existing translations, adds new keys
//    with an empty value (= not translated yet, shown in Chinese), and moves
//    keys that are no longer used into "obsolete" so no translation is lost.
// 3. Lists Chinese string literals that are not wrapped in tr() (they would
//    stay Chinese in every language).
import fs from 'node:fs';
import path from 'node:path';
import { parseAst } from 'rollup/parseAst';

const root = path.resolve(import.meta.dirname, '..');
const SRC = path.join(root, 'src'), LANG = path.join(root, 'lang');
const CJK = /[一-鿿]/;

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : entry.name.endsWith('.js') ? [full] : [];
  }).sort();
}

const sections = new Map(), seen = new Set(), untranslated = [], dynamic = [];
for (const file of sourceFiles(SRC)) {
  const name = path.relative(SRC, file).replace(/\\/g, '/').replace(/\.js$/, '');
  if (name === 'i18n') continue;
  const source = fs.readFileSync(file, 'utf8');
  const line = pos => source.slice(0, pos).split('\n').length;
  const keys = [];
  const visit = (node, parent, insideTr) => {
    if (!node || typeof node.type !== 'string') return;
    const isTr = node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'tr';
    if (isTr) {
      const first = node.arguments[0];
      if (first?.type === 'Literal' && typeof first.value === 'string') { if (!seen.has(first.value)) { seen.add(first.value); keys.push(first.value); } }
      else dynamic.push(`${name}.js:${line(node.start)}`);
    }
    const consoleCall = node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.name === 'console';
    if (!insideTr && !consoleCall && !(parent?.type === 'Property' && parent.key === node)) {
      const text = node.type === 'Literal' && typeof node.value === 'string' ? node.value : node.type === 'TemplateElement' ? node.value.cooked : null;
      if (text && CJK.test(text)) untranslated.push(`${name}.js:${line(node.start)}  ${text.slice(0, 60)}`);
    }
    for (const key of Object.keys(node)) {
      const value = node[key];
      const next = insideTr || (isTr && key === 'arguments') || consoleCall;
      if (Array.isArray(value)) value.forEach(child => visit(child, node, next));
      else if (value && typeof value.type === 'string') visit(value, node, next);
    }
  };
  visit(parseAst(source), null, false);
  if (keys.length) sections.set(name, keys);
}

const files = fs.existsSync(LANG) ? fs.readdirSync(LANG).filter(file => file.endsWith('.lang')) : [];
const flatten = (node, out) => { for (const [key, value] of Object.entries(node || {})) { if (typeof value === 'string') { if (value || !out.has(key)) out.set(key, value); } else if (value && typeof value === 'object') flatten(value, out); } return out; };
for (const file of files) {
  const full = path.join(LANG, file);
  const data = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^﻿/, ''));
  const old = flatten(data.strings, new Map());
  const strings = {}; let missing = 0;
  for (const [section, keys] of sections) {
    strings[section] = {};
    for (const key of keys) { const value = old.get(key) ?? ''; strings[section][key] = value; if (!value) missing++; old.delete(key); }
  }
  const obsolete = Object.fromEntries([...old].filter(([, value]) => value));
  if (Object.keys(obsolete).length) strings.obsolete = obsolete;
  fs.writeFileSync(full, JSON.stringify({ language: data.language, strings }, null, 2) + '\n');
  console.log(`${file}: ${seen.size - missing}/${seen.size} translated, ${missing} missing, ${Object.keys(obsolete).length} obsolete`);
}
console.log(`${seen.size} keys in ${sections.size} source files.`);
if (dynamic.length) console.log(`tr() with a non-literal first argument (not extracted):\n  ${dynamic.join('\n  ')}`);
if (untranslated.length) console.log(`Chinese text outside tr():\n  ${untranslated.join('\n  ')}`);
if (process.argv.includes('--missing')) {
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(LANG, file), 'utf8'));
    const list = Object.values(data.strings).flatMap(section => Object.entries(section).filter(([, value]) => !value).map(([key]) => key));
    if (list.length) console.log(`\n${file} missing:\n  ${list.join('\n  ')}`);
  }
}
