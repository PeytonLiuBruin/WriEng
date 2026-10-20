import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(project, process.argv[2] || 'dist');
if (output !== join(project, 'dist') && output !== join(project, '.build-next')) throw new Error('Offline output must remain in a known project build directory.');

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return files.flat();
}

const paths = (await listFiles(output))
  .filter((path) => !['sw.js', 'sw-manifest.json'].includes(relative(output, path)))
  // Runtime core entries are already bundled in JavaScript. Keep this complete
  // audit export online without downloading/caching the same dictionary twice.
  .filter((path) => relative(output, path).split(sep).join('/') !== 'data/core-lexicon.json')
  .filter((path) => !path.endsWith('.map'))
  .sort();
const names = paths.map((path) => relative(output, path).split(sep).join('/'));
for (const required of ['index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png']) {
  if (!names.includes(required)) throw new Error(`Offline build is missing ${required}`);
}
if (!names.some((name) => /^assets\/.+\.js$/.test(name))) throw new Error('No production JavaScript assets found. Run Vite build first.');

const template = await readFile(join(project, 'public', 'sw.js'), 'utf8');
const digest = createHash('sha256').update(template).update('\0');
const manifest = [];
for (let i = 0; i < paths.length; i += 1) {
  const bytes = await readFile(paths[i]);
  digest.update(names[i]).update('\0').update(bytes).update('\0');
  manifest.push({ url: names[i], bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const version = digest.digest('hex').slice(0, 20);
if (!template.includes('__WRIENG_CACHE_VERSION__') || !template.includes('/* __WRIENG_PRECACHE_FILES__ */ []')) {
  throw new Error('Service worker template markers are missing.');
}
const worker = template.replace('__WRIENG_CACHE_VERSION__', version)
  .replace('/* __WRIENG_PRECACHE_FILES__ */ []', JSON.stringify(names, null, 2));
await writeFile(join(output, 'sw.js'), worker);
await writeFile(join(output, 'sw-manifest.json'), `${JSON.stringify({ version, files: manifest, onlineOnly: ['data/core-lexicon.json'] }, null, 2)}\n`);
console.log(`WriEng offline cache ${version}: ${names.length} files, ${manifest.reduce((sum, file) => sum + file.bytes, 0)} bytes.`);
