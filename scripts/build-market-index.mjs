/**
 * Regenerate the DSH plugin-market index (format 1) for this repository.
 *
 * The index is a static JSON document anyone can add under
 * Plugins → Discover → "Add index source". It pins the current commit, so the
 * entry installs exactly the code this repository has.
 *
 * Run from the package root:
 *
 *   node scripts/build-market-index.mjs
 *
 * Outputs:
 *   docs/market/index.json
 *   docs/market/icons/<package>.svg
 *
 * No subprocess is spawned: the commit is read from .git directly, which also
 * works inside sandboxes that refuse to spawn `git`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'market');
const ICON_DIR = path.join(OUT_DIR, 'icons');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const metaZh = JSON.parse(fs.readFileSync(path.join(ROOT, 'locale', 'zh.json'), 'utf8')).meta;
const metaEn = JSON.parse(fs.readFileSync(path.join(ROOT, 'locale', 'en.json'), 'utf8')).meta;

/**
 * Read the current commit without spawning git.
 * @returns the 40-character commit id.
 */
function currentCommit() {
  const gitDir = path.join(ROOT, '.git');
  let head = '';
  try {
    head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
  } catch (error) {
    throw new Error('not a git checkout: ' + error.message);
  }
  if (!head.startsWith('ref: ')) return head;
  const ref = head.slice(5).trim();
  try {
    return fs.readFileSync(path.join(gitDir, ref), 'utf8').trim();
  } catch (error) {
    /* packed refs below */
  }
  const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
  for (const line of packed.split('\n')) {
    const match = /^([0-9a-f]{40}) (.+)$/.exec(line.trim());
    if (match !== null && match[2] === ref) return match[1];
  }
  throw new Error('cannot resolve ' + ref + ' in ' + gitDir);
}

const commit = currentCommit();
const homepage = pkg.homepage || 'https://github.com/Guozifan7/dsh-a-stock-ticker#readme';
const repositoryUrl = String(pkg.repository && pkg.repository.url ? pkg.repository.url : '')
  .replace(/^git\+/, '')
  .replace(/\.git$/, '');

/* Keep the publish time of an already-listed version, so re-running the script
   only changes what actually changed. */
let publishTimestamp = Math.floor(Date.now() / 1000);
try {
  const previous = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'index.json'), 'utf8'));
  const plugin = (previous.plugins || []).find((entry) => entry.name === pkg.name);
  const version = plugin && (plugin.versions || []).find((entry) => entry.version === pkg.version);
  if (version && typeof version.publishTimestamp === 'number') publishTimestamp = version.publishTimestamp;
} catch (error) {
  /* first run */
}

const version = {
  version: pkg.version,
  publishTimestamp: publishTimestamp,
  source: { type: 'git', url: repositoryUrl, commit: commit }
};
if (pkg.engines && typeof pkg.engines.dsh === 'string') version.engines = { dsh: pkg.engines.dsh };

const index = {
  format: 1,
  title: { en: 'Guozifan7 DSH plugins', zh: 'Guozifan7 的 DSH 插件' },
  description: {
    en: 'Plugins maintained by Guozifan7 for DeepSeek Harness.',
    zh: 'Guozifan7 维护的 DeepSeek Harness 插件。'
  },
  plugins: [
    {
      name: pkg.name,
      title: { en: metaEn.title, zh: metaZh.title },
      description: { en: metaEn.description, zh: metaZh.description },
      icon: 'icons/' + pkg.name + '.svg',
      author: pkg.author || 'Guozifan7',
      homepage: homepage,
      repository: { url: repositoryUrl },
      versions: [version]
    }
  ]
};

fs.mkdirSync(ICON_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
fs.copyFileSync(path.join(ROOT, 'icon.svg'), path.join(ICON_DIR, pkg.name + '.svg'));

console.log('wrote docs/market/index.json');
console.log('  package : ' + pkg.name + '@' + pkg.version);
console.log('  commit  : ' + commit);
console.log('  engines : ' + (version.engines ? 'engines.dsh ' + version.engines.dsh : 'peer fallback'));
console.log('Serve docs/market from any https static host, then add index.json under Plugins → Discover.');
