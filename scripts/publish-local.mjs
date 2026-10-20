// Replace the local preview shell only after its new, content-addressed assets exist.
// Old assets are retained so a currently open, cached client can finish its session.
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = resolve(project, '.build-next');
const destination = resolve(project, 'dist');
const manifest = JSON.parse(await readFile(resolve(stage, 'sw-manifest.json'), 'utf8'));
if (!Array.isArray(manifest.files) || !manifest.files.some(file => file.url === 'index.html')) throw new Error('A complete staged build is required.');
const files = [];
for (const item of manifest.files) {
  const path = resolve(stage, item.url);
  if (!path.startsWith(stage + sep)) throw new Error('Invalid staged asset path.');
  const bytes = await readFile(path);
  if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error(`Staged asset changed: ${item.url}`);
  files.push({name:item.url, bytes});
}
// Online audit downloads are deliberately not service-worker resources, but
// still belong to the published site and must survive the staged copy.
if (manifest.onlineOnly !== undefined && (!Array.isArray(manifest.onlineOnly) || manifest.onlineOnly.some(name => typeof name !== 'string'))) throw new Error('Invalid online-only asset list.');
for (const name of manifest.onlineOnly || []) {
  const path = resolve(stage, name);
  if (!path.startsWith(stage + sep)) throw new Error('Invalid online-only asset path.');
  files.push({name, bytes:await readFile(path)});
}
files.push({name:'sw-manifest.json', bytes:await readFile(resolve(stage, 'sw-manifest.json'))});
files.push({name:'sw.js', bytes:await readFile(resolve(stage, 'sw.js'))});
files.sort((a,b) => Number(['index.html','sw.js'].includes(a.name)) - Number(['index.html','sw.js'].includes(b.name)) || Number(a.name === 'sw.js') - Number(b.name === 'sw.js'));
for (const {name,bytes} of files) {
  const final = resolve(destination, name);
  if (!final.startsWith(destination + sep)) throw new Error('Invalid preview asset path.');
  await mkdir(dirname(final), {recursive:true});
  const temporary = `${final}.wrieng-${process.pid}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, final);
}
console.log(`Updated the local preview to ${manifest.version}; existing clients retain their previous asset files.`);
