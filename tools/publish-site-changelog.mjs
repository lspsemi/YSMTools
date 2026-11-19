// Publishes ONLY site/changelog.json to github.com/lspsemi/YSMTools (main), on top of
// what is already there, so unreleased source code is never uploaded with it.
// Pages redeploys automatically (site/** changed).
//   node tools/publish-site-changelog.mjs ["commit message"]
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/lspsemi/YSMTools.git';
const FILE = 'site/changelog.json';
const root = fileURLToPath(new URL('..', import.meta.url));
const author = { GIT_AUTHOR_NAME: 'MioNext', GIT_AUTHOR_EMAIL: 'mionext@noreply.codeberg.org',
                 GIT_COMMITTER_NAME: 'MioNext', GIT_COMMITTER_EMAIL: 'mionext@noreply.codeberg.org' };
const index = '.git/index.changelog';
const git = (args, env = {}, input) => execFileSync('git', args, { cwd: root, env: { ...process.env, ...env }, input, encoding: 'utf8' }).trim();

const data = JSON.parse(readFileSync(root + FILE, 'utf8')); // refuse to publish broken JSON
if (!Array.isArray(data.entries)) throw new Error(`${FILE}: "entries" must be an array`);
// Every card is named after its version. All unreleased changes belong to ONE in-development
// entry (status "dev") that comes first, so a batch of features made before a release stays together.
const bad = data.entries.filter(e => !/^\d+\.\d+\.\d+$/.test(e.version || ''));
if (bad.length) throw new Error(`${FILE}: every entry needs a version like "1.1.14"`);
const versions = data.entries.map(e => e.version);
if (new Set(versions).size !== versions.length) throw new Error(`${FILE}: duplicate versions`);
const dev = data.entries.filter(e => e.status === 'dev');
if (dev.length > 1) throw new Error(`${FILE}: ${dev.length} in-development entries; merge them into one`);
if (dev.length && data.entries[0] !== dev[0]) throw new Error(`${FILE}: the in-development entry must be the first entry`);

git(['fetch', '--quiet', REPO, 'main']);
const parent = git(['rev-parse', 'FETCH_HEAD']);
const blob = git(['hash-object', '-w', FILE]);
const env = { GIT_INDEX_FILE: index };
try {
  git(['read-tree', parent], env);
  git(['update-index', '--add', '--cacheinfo', `100644,${blob},${FILE}`], env);
  const tree = git(['write-tree'], env);
  if (tree === git(['rev-parse', `${parent}^{tree}`])) console.log('Changelog already up to date on YSMTools.');
  else publish(tree);
} finally {
  rmSync(`${root}${index}`, { force: true });
}

function publish(tree) {
  const message = process.argv[2] || 'Update site changelog';
  const commit = git(['commit-tree', tree, '-p', parent], author, message + '\n');
  git(['update-ref', 'refs/ysmtools/main', commit]);
  git(['push', '--quiet', REPO, 'refs/ysmtools/main:refs/heads/main']);
  console.log(`Published ${FILE}: ${commit.slice(0, 7)} (parent ${parent.slice(0, 7)})`);
}
