// Dev-server mirror of src-tauri/src/explorer_thumbnails.rs (docs/maintenance
// section 70): covers for the Windows Explorer thumbnail provider in
// thumbnail-provider/. Used by tools/library-dev-api.js; keep in step.
//
// It writes to the same %LOCALAPPDATA%\com.ysm.preview\explorer-thumbnails
// folder as the desktop app, so a provider registered with
// tools/explorer-thumbnail-register.ps1 shows covers made in the browser.
// Refreshing Explorer's cache needs COM; the dev server runs the provider's
// probe tool (cargo build --release --example probe) when it has been built.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

const CACHE = path.join(process.env.LOCALAPPDATA || '', 'com.ysm.preview', 'explorer-thumbnails');
const CLSID = '{F6A5A6A3-58D9-4762-82C8-B325D784819C}';
const PROBE = path.resolve('thumbnail-provider/target/release/examples/probe.exe');
const SCAN_DEPTH = 3;
const granted = new Set();

export const isYsm = file => /\.ysm$/i.test(file);
export const hashFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const coverPath = hash => path.join(CACHE, `${hash}.png`);
export const hasCover = hash => fs.existsSync(coverPath(hash));

// Re-extracts the thumbnails Explorer cached for these files (see refresh()
// in explorer_thumbnails.rs). Without the probe build, Explorer shows new
// covers only for files it had not cached yet.
export function refresh(paths) {
  if (paths.length && fs.existsSync(PROBE)) execFile(PROBE, ['--refresh', '256', ...paths], () => {});
}

export function store(hash, png, paths) {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(`${coverPath(hash)}.tmp`, png);
  fs.renameSync(`${coverPath(hash)}.tmp`, coverPath(hash));
  refresh(paths);
}

// `reg query` prints in the console code page (GBK here), which garbles
// non-ASCII DLL paths; PowerShell is told to write UTF-8 instead.
const regValue = key => new Promise(resolve => execFile('powershell', ['-NoProfile', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-Item -LiteralPath 'HKCU:\\${key}' -ErrorAction SilentlyContinue).GetValue('')`], { windowsHide: true, encoding: 'utf8' }, (error, stdout) => resolve(error ? null : stdout.trim() || null)));
async function providerRegistered() {
  const handler = await regValue('Software\\Classes\\.ysm\\ShellEx\\{e357fccd-a995-4576-b01f-234630154e96}');
  const dll = await regValue(`Software\\Classes\\CLSID\\${CLSID}\\InprocServer32`);
  return handler?.toUpperCase() === CLSID && Boolean(dll) && fs.existsSync(dll);
}

function collect(dir, depth, found) {
  let names;
  try { names = fs.readdirSync(dir).sort(); } catch { return; }
  for (const name of names) {
    const file = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    if (stat.isDirectory()) { if (depth > 0) collect(file, depth - 1, found); }
    else if (isYsm(file) && stat.isFile()) found.push(file);
  }
}
const checkGranted = file => { if (!granted.has(path.resolve(String(file)))) throw new Error('这个文件不在扫描结果中'); return path.resolve(String(file)); };

export const explorerCommands = {
  explorer_status: async () => ({ registered: await providerRegistered(), cacheDir: CACHE }),
  explorer_scan: ({ dir }) => {
    const root = path.resolve(String(dir || ''));
    if (!dir || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('找不到这个文件夹');
    const found = [];
    collect(root, SCAN_DEPTH, found);
    return found.flatMap(file => {
      try {
        const hash = hashFile(file);
        granted.add(file);
        return [{ path: file, name: path.basename(file), size: fs.statSync(file).size, hasCover: hasCover(hash) }];
      } catch { return []; }
    });
  },
  explorer_read: ({ path: file }) => fs.readFileSync(checkGranted(file)),
};
export const explorerRawCommands = {
  explorer_save: (body, headers) => {
    const file = checkGranted(decodeURIComponent(headers['x-path'] || ''));
    store(hashFile(file), body, [file]);
    return null;
  },
};
