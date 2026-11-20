// GitHub publishing for YSMTools (github.com/lspsemi/YSMTools) — see docs/maintenance/79-ysmtools-script.md
//
//   node tools/ysmtools.mjs <command> [args] [--yes]
//
//   status                         remote head, recent commits, releases, local dev card
//   select [ver] [--only 1,3|all|none]
//                                  choose which items of a card go to the site (others stay local only)
//   changelog ["msg"]              publish ONLY site/changelog.json (runs immediately); at a console it
//                                  first asks which dev-card items to publish (--no-select skips that)
//   site ["msg"]                   publish site/ + Pages workflow + site tools (runs immediately)
//   code ["msg"] --yes             upload the source (Codeberg rules: excluded paths, MioNext author)
//   release [<ver>] [--file <exe>] --yes
//                                  finalize the local card, set the site version, publish the site,
//                                  create GitHub release v<ver> with the installer, notes from the card.
//                                  Never builds. Installer: --file if given; else the one built for <ver>;
//                                  else the newest one in the bundle folder (version from its file name)
//   release-asset [<ver>] [--file <exe>] --yes
//                                  replace the installer of an existing release (same installer choice)
//   undo-changelog [--to <commit>] --yes
//                                  restore site/changelog.json to its previous published version
//                                  (online AND locally), as a new commit
//   undo-release <ver> [--reopen-card] --yes
//                                  delete release v<ver> and its tag; --reopen-card also marks the card
//                                  "in development" again and restores the site version
//   revert <commit> --yes          undo one commit on main as a new commit (no force push)
//
// Without --yes, code / release / undo-* / revert only print what they would do.
// Items with "publish": false are removed from every upload and from release notes.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_URL = 'https://github.com/lspsemi/YSMTools.git';
const GH_REPO = 'lspsemi/YSMTools';
const CHANGELOG = 'site/changelog.json';
const SITE_HTML = 'site/index.html';
const EXCLUDE = ['AGENTS.md', 'CLAUDE.md', 'docs', '.claude', 'output', '介绍视频', '打包软件.bat', '发布到GitHub.bat', 'public/__test__'];
const SITE_PATHS = ['site', '.github/workflows/pages.yml', 'tools/update-site-icons.mjs', 'tools/ysmtools.mjs', 'tools/publish-site-changelog.mjs'];
const INSTALLER_DIR = 'src-tauri/target/release/bundle/nsis';
const INDEX = '.git/index.ysmtools-script';
const AUTHOR = { GIT_AUTHOR_NAME: 'MioNext', GIT_AUTHOR_EMAIL: 'mionext@noreply.codeberg.org',
                 GIT_COMMITTER_NAME: 'MioNext', GIT_COMMITTER_EMAIL: 'mionext@noreply.codeberg.org' };
const root = fileURLToPath(new URL('..', import.meta.url));

/* ---------------- helpers ---------------- */
const run = (cmd, args, { env = {}, input, quiet } = {}) => execFileSync(cmd, args, {
  cwd: root, env: { ...process.env, ...env }, input, encoding: 'utf8', maxBuffer: 64 << 20,
  stdio: ['pipe', 'pipe', quiet ? 'pipe' : 'inherit']
}).trim();
const git = (args, opts) => run('git', args, opts);
const gh = (args, opts) => run('gh', args, opts);
const fail = msg => { throw new Error(msg); };
const short = sha => sha.slice(0, 7);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** Local card dates carry the time ("2026-11-20 14:05"); the published file keeps only the day. */
const nowMinute = () => { const d = new Date(); return `${today()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const DATE_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/;
const dayOnly = date => (date ? String(date).slice(0, 10) : date);
const VERSION_RE = /^\d+\.\d+\.\d+$/;

function fetchMain() { git(['fetch', '--quiet', REPO_URL, 'main']); return git(['rev-parse', 'FETCH_HEAD']); }
function withIndex(fn) {
  const env = { GIT_INDEX_FILE: INDEX };
  try { return fn(env); } finally { rmSync(join(root, INDEX), { force: true }); }
}
/** Shows the change from parent to tree; with yes, commits it on top of parent and pushes main. */
function commitAndPush(parent, tree, message, yes) {
  if (tree === git(['rev-parse', `${parent}^{tree}`])) { console.log('Nothing to change on YSMTools.'); return null; }
  console.log(`Changes on top of ${short(parent)}:\n` + git(['diff', '--stat', parent, tree]));
  if (!yes) { console.log('\nDry run: nothing was pushed. Add --yes to push.'); return null; }
  const commit = git(['commit-tree', tree, '-p', parent], { env: AUTHOR, input: message + '\n' });
  git(['update-ref', 'refs/ysmtools/main', commit]);
  git(['push', '--quiet', REPO_URL, 'refs/ysmtools/main:refs/heads/main']);
  console.log(`Pushed ${short(commit)} to ${GH_REPO} main. Pages redeploys if site/ changed.`);
  return commit;
}

/* ---------------- changelog file ---------------- */
function readChangelog(text = readFileSync(join(root, CHANGELOG), 'utf8')) {
  const data = JSON.parse(text);
  const e = data.entries;
  if (!Array.isArray(e)) fail(`${CHANGELOG}: "entries" must be an array`);
  if (e.some(x => !VERSION_RE.test(x.version || ''))) fail(`${CHANGELOG}: every entry needs a version like "1.1.14"`);
  if (new Set(e.map(x => x.version)).size !== e.length) fail(`${CHANGELOG}: duplicate versions`);
  const dev = e.filter(x => x.status === 'dev');
  if (dev.length > 1) fail(`${CHANGELOG}: ${dev.length} in-development entries; merge them into one`);
  if (dev.length && e[0] !== dev[0]) fail(`${CHANGELOG}: the in-development entry must be the first entry`);
  for (const x of e) if ('date' in x && !DATE_RE.test(x.date || '')) fail(`${CHANGELOG}: V${x.version} date must be "YYYY-MM-DD" or "YYYY-MM-DD HH:MM"`);
  for (const x of e) for (const i of x.items || []) {
    if (!['new', 'improve', 'fix'].includes(i.type)) fail(`${CHANGELOG}: V${x.version} has an item with type "${i.type}"`);
    if (!i.zh && !i.en) fail(`${CHANGELOG}: V${x.version} has an item without text`);
    if ('publish' in i && typeof i.publish !== 'boolean') fail(`${CHANGELOG}: "publish" must be true or false`);
  }
  return data;
}
const writeChangelog = data => writeFileSync(join(root, CHANGELOG), JSON.stringify(data, null, 2) + '\n');
/** Items marked "publish": false stay in the local file only; they never reach the site or release notes. */
const isPublic = i => i.publish !== false;
function publicChangelogText(data = readChangelog()) {
  const pub = { ...data, entries: data.entries
    .map(e => ({ ...e, ...('date' in e ? { date: dayOnly(e.date) } : {}), items: (e.items || []).filter(isPublic).map(({ publish, ...i }) => i) }))
    // Development cards are NEVER published: the site only shows versions that have been released.
    .filter(e => e.status !== 'dev') };
  return JSON.stringify(pub, null, 2) + '\n';
}
/** Puts the public changelog into the temporary index, replacing whatever `git add` took from the working tree. */
function putPublicChangelog(env) {
  const blob = git(['hash-object', '-w', '--stdin'], { input: publicChangelogText() });
  git(['update-index', '--add', '--cacheinfo', `100644,${blob},${CHANGELOG}`], { env });
}
function setSiteVersion(version) {
  const p = join(root, SITE_HTML), html = readFileSync(p, 'utf8');
  const next = html.replace(/(data-version(?:>|&gt;))V\d+\.\d+\.\d+/g, `$1V${version}`);
  if (next !== html) writeFileSync(p, next);
  return next !== html;
}

/* ---------------- trees ---------------- */
const changelogTree = parent => withIndex(env => {
  git(['read-tree', parent], { env });
  putPublicChangelog(env); // validates the file first
  return git(['write-tree'], { env });
});
const siteTree = parent => withIndex(env => {
  readChangelog();
  git(['read-tree', parent], { env });
  git(['rm', '-r', '-q', '-f', '--cached', '--ignore-unmatch', '--', 'site'], { env }); // temp index only; files on disk untouched
  git(['add', '-A', '--', ...SITE_PATHS.filter(p => existsSync(join(root, p)))], { env, quiet: true });
  putPublicChangelog(env);
  return git(['write-tree'], { env });
});
const codeTree = parent => withIndex(env => {
  readChangelog();
  git(['read-tree', parent], { env });
  git(['add', '-A', '--', '.', ...EXCLUDE.map(p => `:!${p}`)], { env, quiet: true });
  putPublicChangelog(env);
  return git(['write-tree'], { env });
});

/* ---------------- choosing which items go public ---------------- */
const TYPE_ZH = { new: '新功能', improve: '改进', fix: '修复' };
/**
 * Lets the user tick which items of a card are published. Saves "publish": false on unticked items.
 * `only` ("1,3" / "all" / "none") sets the choice without asking.
 */
async function selectItems(card, only) {
  const items = card.items || [];
  if (!items.length) { console.log(`V${card.version} 没有更新记录，无需选择。`); return; }
  const apply = set => items.forEach((it, n) => { if (set.has(n + 1)) delete it.publish; else it.publish = false; });
  const parse = text => {
    const t = text.trim().toLowerCase();
    if (t === 'all' || t === 'a') return new Set(items.map((_, n) => n + 1));
    if (t === 'none' || t === 'n') return new Set();
    const nums = t.split(/[\s,，]+/).filter(Boolean).map(Number);
    if (nums.some(x => !Number.isInteger(x) || x < 1 || x > items.length)) return null;
    return new Set(nums);
  };
  const show = () => {
    console.log(`\nV${card.version} 的更新记录（[√] = 同步到发布网页，[ ] = 只留在本地）：`);
    items.forEach((it, n) => console.log(`  ${String(n + 1).padStart(2)}. [${isPublic(it) ? '√' : ' '}] ${TYPE_ZH[it.type] || it.type}：${it.zh || it.en}`));
  };
  if (only !== undefined) {
    const set = parse(only);
    if (!set) fail(`--only: use item numbers 1-${items.length}, "all" or "none"`);
    apply(set);
  } else {
    // Read answers line by line (works for typing and for piped input; end of input = done).
    const { createInterface } = await import('node:readline');
    const rl = createInterface({ input: process.stdin, terminal: false });
    const lines = rl[Symbol.asyncIterator]();
    try {
      for (;;) {
        show();
        process.stdout.write('输入编号切换勾选（如 2 5），a = 全选，n = 全不选，直接回车 = 完成：');
        const { value: answer = '', done } = await lines.next();
        if (done || !answer.trim()) { process.stdout.write('\n'); break; }
        const t = answer.trim().toLowerCase();
        if (t === 'a' || t === 'all' || t === 'n' || t === 'none') { apply(parse(t)); continue; }
        const set = parse(answer);
        if (!set) { console.log(`请输入 1-${items.length} 之间的编号。`); continue; }
        for (const n of set) { const it = items[n - 1]; if (isPublic(it)) it.publish = false; else delete it.publish; }
      }
    } finally { rl.close(); }
  }
  show();
  const hidden = items.filter(i => !isPublic(i)).length;
  console.log(`共 ${items.length} 条：同步 ${items.length - hidden} 条，不同步 ${hidden} 条。选择已保存到 ${CHANGELOG}。\n`);
}
/** Ask interactively only when a person is at the console and did not opt out. */
const canAsk = flags => process.stdin.isTTY && !flags.has('--no-select');

/* ---------------- release helpers ---------------- */
/** Installers already built in the bundle folder, newest first. This script never builds anything. */
function builtInstallers() {
  const dir = join(root, INSTALLER_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map(name => ({ name, m: name.match(/^YSM模型工具_(\d+\.\d+\.\d+)_x64-setup\.exe$/) }))
    .filter(x => x.m)
    .map(x => { const path = join(dir, x.name); return { path, version: x.m[1], mtime: statSync(path).mtime }; })
    .sort((a, b) => b.mtime - a.mtime);
}
const versionInName = p => basename(p).match(/(\d+\.\d+\.\d+)/)?.[1];
const fmtTime = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
/**
 * Picks the installer to upload:
 *   --file <path>   the file you chose (any folder);
 *   <version>       the installer built for that version;
 *   neither         the newest installer in the bundle folder (its version comes from the file name).
 */
function resolveInstaller(version, file) {
  let src;
  if (file) {
    src = resolve(root, file);
    if (!existsSync(src) || !statSync(src).isFile()) fail(`Installer not found: ${src}`);
    if (!/\.exe$/i.test(src)) fail(`Not an .exe installer: ${src}`);
    const named = versionInName(src);
    if (version && named && named !== version) fail(`The file name says ${named}, but you asked for ${version}. Check the file.`);
    version ||= named;
    if (!version) fail('Cannot tell the version from the file name; give it too, e.g. release 1.1.14 --file <path>.');
  } else if (version) {
    src = join(root, INSTALLER_DIR, `YSM模型工具_${version}_x64-setup.exe`);
    if (!existsSync(src)) fail(`Installer not found: ${src}\nBuild it first, or choose a file with --file <path>.`);
  } else {
    const newest = builtInstallers()[0];
    if (!newest) fail(`No installer in ${join(root, INSTALLER_DIR)}. Build it first, or choose a file with --file <path>.`);
    ({ path: src, version } = newest);
    console.log(`No version given: using the newest built installer (V${version}).`);
  }
  const st = statSync(src);
  console.log(`Installer: ${src}\n  version ${version}, built ${fmtTime(st.mtime)}, ${st.size} bytes, sha256 ${sha256(src)}`);
  const newer = builtInstallers().find(x => x.mtime > st.mtime && x.path !== src);
  if (newer) console.log(`  Note: a newer installer exists: ${basename(newer.path)} (built ${fmtTime(newer.mtime)}).`);
  return { src, version };
}
const sha256 = p => createHash('sha256').update(readFileSync(p)).digest('hex');
function releaseExists(version) {
  try { gh(['release', 'view', `v${version}`, '-R', GH_REPO, '--json', 'tagName'], { quiet: true }); return true; }
  catch { return false; }
}
function releaseNotes(card) {
  const label = { new: ['新功能', 'New'], improve: ['改进', 'Improved'], fix: ['修复', 'Fixed'] };
  const items = (card.items || []).filter(isPublic);
  const zh = items.length ? items.map(i => `- ${label[i.type][0]}：${i.zh || i.en}`).join('\n') : '本版本暂无更新说明。';
  const en = items.length ? items.map(i => `- ${label[i.type][1]}: ${i.en || i.zh}`).join('\n') : 'No release notes for this version.';
  return `YSM模型工具 ${card.version}（Windows 10 / 11 x64）\n\n## 更新内容\n\n${zh}\n\n## What's new\n\n${en}\n\n`
    + `## 安装 / Install\n\n- 下载 \`YSMModelTool_${card.version}_x64-setup.exe\` 运行安装，按当前用户安装，无需管理员权限\n`
    + `- Run \`YSMModelTool_${card.version}_x64-setup.exe\`; installs per user, no administrator rights needed\n`
    + `- 需要 WebView2 运行时（Windows 10 / 11 已自带）/ Requires WebView2 (included in Windows 10 / 11)\n\n`
    + `以 GPL-3.0-or-later 许可证发布。/ Released under GPL-3.0-or-later.\n`;
}
/** Copies the installer to an ASCII file name (GitHub rewrites non-ASCII asset names). */
function stageInstaller(version, src) {
  const dir = mkdtempSync(join(tmpdir(), 'ysmtools-'));
  const dst = join(dir, `YSMModelTool_${version}_x64-setup.exe`);
  copyFileSync(src, dst);
  return { src, dst, dir, label: `YSM模型工具 ${version} 安装包 (x64)` };
}
function checkUploadedAsset(version, src) {
  const assets = JSON.parse(gh(['release', 'view', `v${version}`, '-R', GH_REPO, '--json', 'assets'], { quiet: true })).assets;
  const a = assets.find(x => x.name === `YSMModelTool_${version}_x64-setup.exe`);
  if (!a || a.size !== statSync(src).size) fail(`Uploaded installer size does not match the local file. Check the release page.`);
  console.log(`Installer on GitHub: ${a.name}, ${a.size} bytes (matches the local file).`);
}

/* ---------------- commands ---------------- */
const commands = {
  status() {
    const head = fetchMain();
    console.log(`YSMTools main: ${short(head)}\n` + git(['log', '--format=%h %ad %s', '--date=short', '-8', head]).split('\n').map(l => '  ' + l).join('\n'));
    console.log('\nReleases:\n' + gh(['release', 'list', '-R', GH_REPO, '--limit', '10'], { quiet: true }));
    const data = readChangelog(), dev = data.entries.find(e => e.status === 'dev');
    const hidden = dev ? (dev.items || []).filter(i => !isPublic(i)).length : 0;
    console.log(dev ? `\nLocal dev card: V${dev.version}, ${dev.items?.length || 0} item(s), ${hidden} kept local only` : '\nLocal changelog: no dev card');
    const remote = git(['show', `${head}:${CHANGELOG}`], { quiet: true });
    const norm = t => t.replace(/\r\n/g, '\n').trim();
    console.log(norm(remote) === norm(publicChangelogText(data))
      ? 'Changelog: published version matches the local file.' : 'Changelog: local file differs from the published one (run "changelog" to publish).');
  },

  async select({ args, flags, rest }) {
    const data = readChangelog();
    const card = args[0] ? data.entries.find(e => e.version === args[0]) : data.entries.find(e => e.status === 'dev') || data.entries[0];
    if (!card) fail(args[0] ? `No card for V${args[0]} in ${CHANGELOG}.` : `${CHANGELOG} has no cards.`);
    const i = rest.indexOf('--only');
    await selectItems(card, i >= 0 ? rest[i + 1] ?? '' : undefined);
    writeChangelog(data);
  },

  async changelog({ message, flags, yes }) {
    // Only the user publishes the changelog: from a console (the bat menu), or explicitly with --yes.
    if (!process.stdin.isTTY && !yes) fail('Publishing the changelog needs the user: run it from the console (发布到GitHub.bat → 2), or add --yes when the user asked for it.');
    const data = readChangelog(), dev = data.entries.find(e => e.status === 'dev');
    if (dev) console.log(`V${dev.version} 还在开发中，不会出现在网页上；发布版本（release）时才会公开。`);
    // Only released cards are public, so the choice here is about the latest released one.
    const latest = data.entries.find(e => e.status !== 'dev');
    if (canAsk(flags) && latest?.items?.length) { await selectItems(latest); writeChangelog(data); }
    const parent = fetchMain();
    commitAndPush(parent, changelogTree(parent), message || 'Update site changelog', true);
  },

  site({ message }) {
    const parent = fetchMain();
    commitAndPush(parent, siteTree(parent), message || 'Update distribution site', true);
  },

  code({ message, yes }) {
    const parent = fetchMain();
    commitAndPush(parent, codeTree(parent), message || 'Update source', yes);
  },

  async release({ args, yes, flags, file }) {
    if (args[0] && !VERSION_RE.test(args[0])) fail('Usage: release [<version>] [--file <installer.exe>] --yes   (e.g. release 1.1.14 --yes)');
    const { src, version } = resolveInstaller(args[0], file);
    if (releaseExists(version)) fail(`Release v${version} already exists. Use "release-asset ${version}" to replace the installer, or "undo-release ${version}" first.`);
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    if (pkg !== version) console.log(`Warning: package.json version is ${pkg}, not ${version}.`);
    const data = readChangelog();
    const card = data.entries.find(e => e.version === version);
    if (!card) fail(`No changelog card for V${version} in ${CHANGELOG}. Add one first (it may be the dev card).`);
    // Choose the public items in the preview run; the --yes run uses the saved choice.
    if (!yes && canAsk(flags)) { await selectItems(card); writeChangelog(data); }
    const finalize = card.status === 'dev';
    console.log(`\nRelease v${version} (installer above)`);
    console.log(finalize ? `  card V${version}: in development -> released, date ${nowMinute()}` : `  card V${version}: already released (${card.date || 'no date'})`);
    console.log('  site version label -> V' + version + '\n\nRelease notes:\n' + releaseNotes(card));
    console.log('Note: the release points at YSMTools main. Run "code --yes" first if the source there should match this version.');
    if (!yes) { console.log('\nDry run: nothing was changed. Add --yes to release.'); return; }
    if (finalize) { delete card.status; card.date = nowMinute(); writeChangelog(data); }
    setSiteVersion(version);
    const parent = fetchMain();
    commitAndPush(parent, siteTree(parent), `Release ${version}: changelog and site version`, true);
    const st = stageInstaller(version, src), notes = join(st.dir, 'notes.md');
    writeFileSync(notes, releaseNotes(card));
    try {
      gh(['release', 'create', `v${version}`, `${st.dst}#${st.label}`, '-R', GH_REPO, '--target', 'main',
          '--title', `YSM模型工具 ${version}`, '--notes-file', notes, '--latest'], { quiet: true });
    } finally { rmSync(st.dir, { recursive: true, force: true }); }
    checkUploadedAsset(version, src);
    console.log(`Released: https://github.com/${GH_REPO}/releases/tag/v${version}`);
  },

  'release-asset'({ args, yes, file }) {
    if (args[0] && !VERSION_RE.test(args[0])) fail('Usage: release-asset [<version>] [--file <installer.exe>] --yes');
    const { src, version } = resolveInstaller(args[0], file);
    if (!releaseExists(version)) fail(`Release v${version} does not exist.`);
    console.log(`\nReplace the installer of release v${version} with the file above.`);
    if (!yes) { console.log('\nDry run: nothing was changed. Add --yes to replace.'); return; }
    const st = stageInstaller(version, src);
    try { gh(['release', 'upload', `v${version}`, `${st.dst}#${st.label}`, '-R', GH_REPO, '--clobber'], { quiet: true }); }
    finally { rmSync(st.dir, { recursive: true, force: true }); }
    checkUploadedAsset(version, src);
  },

  'undo-changelog'({ yes, to }) {
    const head = fetchMain();
    const history = git(['log', '--format=%H', head, '--', CHANGELOG]).split('\n').filter(Boolean);
    const target = to ? git(['rev-parse', '--verify', `${to}^{commit}`]) : history[1];
    if (!target) fail('There is no earlier published changelog to go back to.');
    const text = git(['show', `${target}:${CHANGELOG}`], { quiet: true }) + '\n';
    console.log(`Restore ${CHANGELOG} to the version from ${short(target)} (${git(['log', '-1', '--format=%s', target])})`);
    console.log(git(['diff', head, target, '--', CHANGELOG]) || '(no difference)');
    if (!yes) { console.log('\nDry run: nothing was changed. Add --yes to restore it online and locally.'); return; }
    writeFileSync(join(root, CHANGELOG), text); // keep the local file in step, or the next publish re-uploads the mistake
    commitAndPush(head, changelogTree(head), `Revert site changelog to ${short(target)}`, true);
  },

  'undo-release'({ args, yes, flags }) {
    const version = args[0];
    if (!VERSION_RE.test(version || '')) fail('Usage: undo-release <version> [--reopen-card] --yes');
    if (!releaseExists(version)) fail(`Release v${version} does not exist.`);
    const info = JSON.parse(gh(['release', 'view', `v${version}`, '-R', GH_REPO, '--json', 'name,publishedAt,assets,url'], { quiet: true }));
    console.log(`Delete release "${info.name}" (${info.publishedAt}) and tag v${version}\n  ${info.url}\n  assets: ${info.assets.map(a => a.name).join(', ') || 'none'}`);
    console.log('  Download counts and the release page are lost; the release can be created again with "release".');
    const reopen = flags.has('--reopen-card');
    let data, card, previous;
    if (reopen) {
      data = readChangelog(); card = data.entries.find(e => e.version === version);
      if (!card) fail(`No card for V${version} in ${CHANGELOG}.`);
      if (data.entries.some(e => e.status === 'dev' && e !== card)) fail(`${CHANGELOG} already has another dev card; merge them first.`);
      previous = data.entries.find(e => e !== card && e.status !== 'dev')?.version;
      console.log(`  card V${version}: released -> in development; site version label -> V${previous ?? '(unchanged)'}`);
    }
    if (!yes) { console.log('\nDry run: nothing was changed. Add --yes to delete.'); return; }
    gh(['release', 'delete', `v${version}`, '-R', GH_REPO, '--cleanup-tag', '--yes'], { quiet: true });
    console.log(`Deleted release and tag v${version}.`);
    if (reopen) {
      card.status = 'dev';
      data.entries = [card, ...data.entries.filter(e => e !== card)];
      writeChangelog(data);
      if (previous) setSiteVersion(previous);
      const parent = fetchMain();
      commitAndPush(parent, siteTree(parent), `Reopen ${version}: undo release on the site`, true);
    }
  },

  revert({ args, yes, flags }) {
    const head = fetchMain();
    const c = git(['rev-parse', '--verify', `${args[0] || ''}^{commit}`]);
    try { git(['merge-base', '--is-ancestor', c, head], { quiet: true }); } catch { fail(`${short(c)} is not on YSMTools main.`); }
    const parents = git(['rev-list', '--parents', '-n', '1', c]).split(' ').slice(1);
    if (parents.length !== 1) fail('Only commits with exactly one parent can be reverted (not the first commit).');
    const base = parents[0];
    const paths = git(['diff-tree', '--no-commit-id', '-r', '--name-only', base, c]).split('\n').filter(Boolean);
    const later = git(['log', '--format=%h %s', `${c}..${head}`, '--', ...paths]);
    console.log(`Revert ${short(c)} "${git(['log', '-1', '--format=%s', c])}" (${paths.length} file(s)) on top of ${short(head)}`);
    if (later) {
      console.log(`These later commits changed the same files and would be undone too:\n${later}`);
      if (!flags.has('--force')) fail('Add --force to revert anyway, or revert the later commits first.');
    }
    const tree = withIndex(env => {
      git(['read-tree', head], { env });
      for (const p of paths) {
        const entry = git(['ls-tree', base, '--', p]);
        if (entry) { const [mode, , sha] = entry.split(/\s+/); git(['update-index', '--add', '--cacheinfo', `${mode},${sha},${p}`], { env }); }
        else git(['update-index', '--force-remove', '--', p], { env });
      }
      return git(['write-tree'], { env });
    });
    commitAndPush(head, tree, `Revert "${git(['log', '-1', '--format=%s', c])}"\n\nThis reverts commit ${c}.`, yes);
    if (yes) console.log('Note: only GitHub was changed. Fix the same files locally too, or the next upload puts the mistake back.');
  }
};

/* ---------------- main ---------------- */
const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter(a => a.startsWith('--')));
const toIdx = rest.indexOf('--to');
const to = toIdx >= 0 ? rest[toIdx + 1] : undefined;
const valueOf = new Set(['--to', '--only', '--file'].map(f => rest.indexOf(f)).filter(i => i >= 0).map(i => i + 1));
const args = rest.filter((a, i) => !a.startsWith('--') && !valueOf.has(i));
const fileIdx = rest.indexOf('--file');
const ctx = { args, flags, to, rest, file: fileIdx >= 0 ? rest[fileIdx + 1] : undefined, yes: flags.has('--yes'), message: ['changelog', 'site', 'code'].includes(cmd) ? args[0] : undefined };
if (!commands[cmd]) {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  console.log(src.slice(0, src.findIndex(l => !l.startsWith('//'))).map(l => l.slice(3)).join('\n'));
  process.exit(cmd ? 1 : 0);
}
try { await commands[cmd](ctx); }
catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
