// Vite dev-server middleware that mirrors the desktop library commands in
// src-tauri/src/library.rs, so the model library can be developed and tested
// in a plain browser (`npm run dev`) without packaging the desktop app.
// Keep the behaviour of the two implementations in step.
//
// Requests: POST /__library/<command>, JSON body in and JSON out, except
// `upload` and `save_thumbnail` (raw body, parameters in headers) and the
// `read_*` commands (raw bytes out). The library lives in <repo>/library.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { explorerCommands, explorerRawCommands, isYsm, hashFile, hasCover, store as storeExplorerCover } from './explorer-thumbnails-dev.js';

const ROOT = path.resolve('library');
const STAGING = path.join(ROOT, '.staging');
let queue = Promise.resolve();
// Serialise commands like the Rust side's mutex.
const locked = task => (queue = queue.then(task, task));

// Libraries written before multiple game folders kept one `gameDir` and one
// `link` per model; they become the first game folder (id "g0").
function migrate(library) {
  const gameDirs = Array.isArray(library.gameDirs) ? library.gameDirs : library.gameDir ? [{ id: 'g0', path: library.gameDir }] : [];
  const models = (library.models || []).map(({ link, links, ...record }) => ({ ...record, links: links || (link ? [{ dir: gameDirs[0]?.id ?? 'g0', ...link }] : []) }));
  return { gameDirs, models };
}
const load = () => { try { return migrate(JSON.parse(fs.readFileSync(path.join(ROOT, 'library.json'), 'utf8'))); } catch { return { gameDirs: [], models: [] }; } };
function save(library) {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'library.json.tmp'), JSON.stringify(library, null, 2));
  fs.renameSync(path.join(ROOT, 'library.json.tmp'), path.join(ROOT, 'library.json'));
}
const newId = () => Date.now().toString(16) + Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
const modelPath = record => path.join(ROOT, 'models', record.id, record.fileName);
const lstat = file => { try { return fs.lstatSync(file); } catch { return null; } };
const stat = file => { try { return fs.statSync(file); } catch { return null; } };
const isDir = file => stat(file)?.isDirectory() ?? false;
const isFile = file => stat(file)?.isFile() ?? false;

function customDir(gameDir) {
  const name = file => path.basename(file).toLowerCase();
  if (name(gameDir) === 'custom' && name(path.dirname(gameDir)) === 'yes_steve_model') return gameDir;
  if (name(gameDir) === 'yes_steve_model') return path.join(gameDir, 'custom');
  if (name(gameDir) === 'config') return path.join(gameDir, 'yes_steve_model', 'custom');
  if (isDir(path.join(gameDir, 'config')) || isDir(path.join(gameDir, 'mods'))) return path.join(gameDir, 'config', 'yes_steve_model', 'custom');
  return null;
}

function isOurLink(link, target) {
  const meta = lstat(link?.path);
  if (!meta) return false;
  if (link.kind === 'symlink' || link.kind === 'junction') return meta.isSymbolicLink();
  if (link.kind === 'hardlink') { const original = stat(target); return Boolean(original) && original.size === meta.size && original.mtimeMs === meta.mtimeMs; }
  return false;
}

// Each game folder with its custom folder and the (lower-case) names already
// in it, read once per call so conflicts need no lookup per model.
const listNames = dir => { try { return new Set(fs.readdirSync(dir).map(name => name.toLowerCase())); } catch { return new Set(); } };
const resolveDirs = library => library.gameDirs.map(dir => { const custom = customDir(dir.path); return { id: dir.id, path: dir.path, custom, names: custom ? listNames(custom) : new Set() }; });

function view(record, dirs) {
  const target = modelPath(record);
  const mounts = record.links.filter(link => dirs.some(dir => dir.id === link.dir) && isOurLink(link, target)).map(link => ({ dir: link.dir, kind: link.kind }));
  const conflicts = dirs.filter(dir => !mounts.some(mount => mount.dir === dir.id) && dir.names.has(record.fileName.toLowerCase())).map(dir => dir.id);
  const { links, ...rest } = record;
  return { ...rest, mounts, conflicts };
}
function state(library) {
  const dirs = resolveDirs(library);
  return { root: ROOT, gameDirs: dirs.map(dir => ({ id: dir.id, path: dir.path, customDir: dir.custom })), models: library.models.map(record => view(record, dirs)) };
}

const isModelFolder = dir => isFile(path.join(dir, 'ysm.json')) || isFile(path.join(dir, 'models', 'main.json')) || isFile(path.join(dir, 'main.json'));
const isPackFile = file => isFile(file) && /\.(zip|ysm)$/i.test(file);
function collectPacks(file, depth, found) {
  if (isPackFile(file) || (isDir(file) && isModelFolder(file))) { found.push(file); return; }
  if (!depth || !isDir(file)) return;
  for (const child of fs.readdirSync(file).sort()) collectPacks(path.join(file, child), depth - 1, found);
}
const dirSize = dir => fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? dirSize(path.join(dir, entry.name)) : fs.statSync(path.join(dir, entry.name)).size), 0);
function find(library, id) {
  const record = library.models.find(model => model.id === id);
  if (!record) throw new Error('模型库中没有这个模型');
  return record;
}
function removeLink(link) {
  try { if (link.kind === 'hardlink' || !isDir(link.path)) fs.unlinkSync(link.path); else fs.rmdirSync(link.path); }
  catch (error) { throw new Error(`无法移除链接：${error.message}`); }
}
function createLink(target, link, dir) {
  if (dir) {
    try { fs.symlinkSync(target, link, 'dir'); return 'symlink'; } catch {}
    // Directory junctions need no Developer Mode or administrator rights.
    fs.symlinkSync(target, link, 'junction'); return 'junction';
  }
  try { fs.symlinkSync(target, link, 'file'); return 'symlink'; } catch {}
  try { fs.linkSync(target, link); return 'hardlink'; }
  catch { throw new Error('无法创建符号链接：请在 Windows 设置 → 系统 → 开发者选项中开启“开发人员模式”，或把游戏和本程序放在同一个磁盘分区'); }
}

function importPaths(paths) {
  const library = load(), dirs = resolveDirs(library), packs = [], added = [], skipped = [];
  for (const file of paths) collectPacks(file, 3, packs);
  packs.forEach((pack, index) => {
    const fileName = path.basename(pack), dir = isDir(pack), size = dir ? dirSize(pack) : fs.statSync(pack).size;
    if (library.models.some(record => record.fileName === fileName && record.size === size)) { skipped.push({ path: pack, reason: '已在模型库中' }); return; }
    const id = Date.now().toString(16) + (index % 256).toString(16).padStart(2, '0');
    const record = { id, name: fileName.replace(/\.[^.]+$/, ''), fileName, isDir: dir, size, importedAt: Date.now(), hasThumbnail: false, links: [] };
    try { fs.mkdirSync(path.dirname(modelPath(record)), { recursive: true }); fs.cpSync(pack, modelPath(record), { recursive: true }); }
    catch (error) { fs.rmSync(path.join(ROOT, 'models', id), { recursive: true, force: true }); skipped.push({ path: pack, reason: `复制失败：${error.message}` }); return; }
    library.models.push(record); added.push(view(record, dirs));
  });
  save(library);
  return { added, skipped };
}

// For a .ysm pack: its hash (kept in record.sha256) and the files Explorer
// shows it as (the library copy and the game links), section 70.
function explorerCover(record) {
  if (record.isDir || !isYsm(record.fileName)) return null;
  const file = modelPath(record);
  if (!record.sha256) { try { record.sha256 = hashFile(file); } catch { return null; } }
  return { hash: record.sha256, paths: [file, ...record.links.filter(link => isOurLink(link, file)).map(link => link.path)] };
}

const commands = {
  ...explorerCommands,
  // Copies covers of library .ysm packs into the Explorer thumbnail cache
  // when missing there; resolves to the number added.
  explorer_sync: () => {
    const library = load();
    let added = 0;
    for (const record of library.models) {
      if (!record.hasThumbnail) continue;
      const explorer = explorerCover(record);
      if (!explorer || hasCover(explorer.hash)) continue;
      try { storeExplorerCover(explorer.hash, fs.readFileSync(path.join(ROOT, 'thumbnails', `${record.id}.png`)), explorer.paths); added++; } catch {}
    }
    save(library);
    return added;
  },
  state: () => state(load()),
  // `import_staged` is the desktop command's name for the same thing.
  import_staged: ({ batch }) => commands.import({ batch }),
  import: ({ batch }) => {
    const dir = path.join(STAGING, String(batch).replace(/[^\w-]/g, ''));
    try { return importPaths(fs.existsSync(dir) ? fs.readdirSync(dir).map(name => path.join(dir, name)) : []); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  },
  import_paths: ({ paths }) => importPaths(paths),
  add_game_dir: ({ path: dir }) => {
    const library = load(), custom = dir ? customDir(dir) : null;
    if (!custom) throw new Error('这里没有找到 config 或 mods 文件夹。请选择游戏目录（开启版本隔离时为 versions/<版本名>），或直接选择 config/yes_steve_model/custom 文件夹');
    if (library.gameDirs.some(other => customDir(other.path)?.toLowerCase() === custom.toLowerCase())) throw new Error('这个游戏目录已经添加过了');
    fs.mkdirSync(custom, { recursive: true });
    library.gameDirs.push({ id: newId(), path: dir }); save(library); return state(library);
  },
  // Removes the links the library made in that folder, then forgets it.
  remove_game_dir: ({ id }) => {
    const library = load();
    for (const record of library.models) {
      for (const link of record.links) if (link.dir === id && isOurLink(link, modelPath(record))) removeLink(link);
      record.links = record.links.filter(link => link.dir !== id);
    }
    library.gameDirs = library.gameDirs.filter(dir => dir.id !== id); save(library); return state(library);
  },
  // Mounts or unmounts several models in several game folders. Unmounting
  // with no folders given removes every link of the models. Failures are
  // reported per model and folder; everything else still goes through.
  set_mounted: ({ ids, dirs: dirIds = [], mounted }) => {
    const library = load(), all = resolveDirs(library), errors = [], changed = [];
    const targets = dirIds.length ? all.filter(dir => dirIds.includes(dir.id)) : mounted ? [] : null;
    if (mounted && !targets.length) throw new Error('请先添加游戏目录');
    for (const id of ids) {
      const record = library.models.find(model => model.id === id);
      if (!record) { errors.push({ id, dir: null, message: '模型库中没有这个模型' }); continue; }
      const target = modelPath(record);
      if (mounted) {
        for (const dir of targets) {
          const existing = record.links.find(link => link.dir === dir.id);
          if (existing && isOurLink(existing, target)) continue;
          try {
            if (!dir.custom) throw new Error('游戏目录无效');
            const link = path.join(dir.custom, record.fileName);
            if (lstat(link)) throw new Error(`已有同名的 ${record.fileName}，请先移走它`);
            fs.mkdirSync(dir.custom, { recursive: true });
            const kind = createLink(target, link, record.isDir);
            record.links = record.links.filter(item => item.dir !== dir.id).concat({ dir: dir.id, path: link, kind });
          } catch (error) { errors.push({ id, dir: dir.id, message: error.message }); }
        }
      } else {
        record.links = record.links.filter(link => {
          if (targets && !targets.some(dir => dir.id === link.dir)) return true;
          try { if (isOurLink(link, target)) removeLink(link); return false; }
          catch (error) { errors.push({ id, dir: link.dir, message: error.message }); return true; }
        });
      }
      changed.push(record);
    }
    save(library);
    const fresh = resolveDirs(library);
    return { models: changed.map(record => view(record, fresh)), errors };
  },
  delete: ({ ids }) => {
    const library = load(), deleted = [], errors = [];
    for (const id of ids) {
      const record = library.models.find(model => model.id === id);
      if (!record) { errors.push({ id, dir: null, message: '模型库中没有这个模型' }); continue; }
      try {
        for (const link of record.links) if (isOurLink(link, modelPath(record))) removeLink(link);
        fs.rmSync(path.join(ROOT, 'models', record.id), { recursive: true, force: true });
        fs.rmSync(path.join(ROOT, 'thumbnails', `${record.id}.png`), { force: true });
        deleted.push(id);
      } catch (error) { errors.push({ id, dir: null, message: error.message }); }
    }
    library.models = library.models.filter(model => !deleted.includes(model.id)); save(library);
    return { deleted, errors };
  },
  rename: ({ id, name }) => { const library = load(); find(library, id).name = name; save(library); return null; },
  set_info: ({ id, info }) => { const library = load(); find(library, id).info = info; save(library); return null; },
  reveal: ({ path: file }) => { execFile('explorer', [`/select,${file}`]); return null; },
  read_model: ({ id }) => {
    const record = find(load(), id), file = modelPath(record);
    if (!record.isDir) return fs.readFileSync(file);
    const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.relative(file, path.join(dir, entry.name)).replaceAll('\\', '/')]);
    return Buffer.from(JSON.stringify(walk(file)));
  },
  read_model_file: ({ id, path: file }) => {
    if (file.split(/[\\/]/).some(part => part === '..' || part.includes(':'))) throw new Error('无效的路径');
    return fs.readFileSync(path.join(modelPath(find(load(), id)), file));
  },
  read_thumbnail: ({ id }) => { if (/[\\/.]/.test(id)) throw new Error('无效的模型'); return fs.readFileSync(path.join(ROOT, 'thumbnails', `${id}.png`)); },
};
const rawCommands = {
  upload: (body, headers) => {
    const batch = String(headers['x-batch']).replace(/[^\w-]/g, ''), relative = decodeURIComponent(headers['x-path'] || '');
    if (!batch || !relative || relative.split(/[\\/]/).some(part => part === '..' || part.includes(':'))) throw new Error('无效的路径');
    const file = path.join(STAGING, batch, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); return null;
  },
  save_thumbnail: (body, headers) => {
    const id = String(headers['x-id']), library = load(), record = find(library, id);
    fs.mkdirSync(path.join(ROOT, 'thumbnails'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'thumbnails', `${id}.png`), body);
    record.hasThumbnail = true;
    const explorer = explorerCover(record);
    save(library);
    // The Explorer thumbnail is extra; a failure does not fail the cover.
    if (explorer) try { storeExplorerCover(explorer.hash, body, explorer.paths); } catch (error) { console.error('explorer thumbnail:', error); }
    return null;
  },
  ...explorerRawCommands,
};

const readBody = request => new Promise((resolve, reject) => { const chunks = []; request.on('data', chunk => chunks.push(chunk)); request.on('end', () => resolve(Buffer.concat(chunks))); request.on('error', reject); });

export function libraryDevApi() {
  return {
    name: 'ysm-library-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__library', async (request, response) => {
        const name = request.url.replace(/^\//, '').split('?')[0];
        try {
          const body = await readBody(request);
          const result = await locked(() => rawCommands[name] ? rawCommands[name](body, request.headers)
            : commands[name] ? commands[name](body.length ? JSON.parse(body) : {})
            : Promise.reject(new Error(`未知命令 ${name}`)));
          if (Buffer.isBuffer(result)) { response.setHeader('content-type', 'application/octet-stream'); response.end(result); }
          else { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(result)); }
        } catch (error) {
          response.statusCode = 500; response.setHeader('content-type', 'text/plain; charset=utf-8'); response.end(error.message || String(error));
        }
      });
    },
  };
}
