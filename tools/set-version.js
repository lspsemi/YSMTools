// Version bump for 打包软件.bat (see docs/maintenance/10-release.md).
//   node tools/set-version.js          prints the current version
//   node tools/set-version.js --next   prints the current version with the last part + 1
//   node tools/set-version.js 1.2.3    writes 1.2.3 to every version field; it must be
//                                      x.y.z and higher than the current version
// The version lives in package.json, package-lock.json, src-tauri/tauri.conf.json,
// src-tauri/Cargo.toml and src-tauri/Cargo.lock; all five are kept in step.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = name => join(root, name);
const current = JSON.parse(readFileSync(file('package.json'), 'utf8')).version;
const parse = value => /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const arg = (process.argv[2] || '').trim();
if (!arg) { console.log(current); process.exit(0); }
if (arg === '--next') { const [x, y, z] = parse(current); console.log(`${x}.${y}.${z + 1}`); process.exit(0); }

const next = parse(arg);
if (!next) { console.error(`版本号格式不对：${arg}（应为 主.次.修订，例如 1.0.15）`); process.exit(2); }
if (compare(next, parse(current)) <= 0) { console.error(`新版本号 ${arg} 必须大于当前版本 ${current}`); process.exit(2); }

// Replace exactly one occurrence per pattern, keeping each file's formatting and line endings.
function update(name, patterns) {
  let text = readFileSync(file(name), 'utf8');
  for (const pattern of patterns) {
    let hits = 0;
    text = text.replace(pattern, (match, head) => { hits++; return `${head}${arg}"`; });
    if (hits !== 1) { console.error(`${name}：没有找到唯一的版本字段（${pattern}），没有修改任何文件，请手动检查。`); process.exit(3); }
  }
  return [name, text];
}
const v = current.replace(/\./g, '\\.');
const updates = [
  update('package.json', [new RegExp(`^(  "version": ")${v}"`, 'm')]),
  // The lockfile repeats the version at the top and under packages[""].
  update('package-lock.json', [new RegExp(`^(  "version": ")${v}"`, 'm'), new RegExp(`(\\n    "": \\{\\r?\\n      "name": "ysm-preview",\\r?\\n      "version": ")${v}"`)]),
  update('src-tauri/tauri.conf.json', [new RegExp(`^(  "version": ")${v}"`, 'm')]),
  update('src-tauri/Cargo.toml', [new RegExp(`^(\\[package\\]\\r?\\nname = "ysm-preview"\\r?\\nversion = ")${v}"`, 'm')]),
  update('src-tauri/Cargo.lock', [new RegExp(`(\\nname = "ysm-preview"\\r?\\nversion = ")${v}"`)]),
];
// Every file is checked before any is written, so a failure leaves all five untouched.
for (const [name, text] of updates) writeFileSync(file(name), text);
console.log(`版本号已更新：${current} → ${arg}`);
