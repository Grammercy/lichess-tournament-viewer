import { build } from 'esbuild';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await writeFile('dist/.openai/hosting.json', await readFile('.openai/hosting.json','utf8'));
await build({ entryPoints:['src/app.js'], bundle:true, format:'esm', platform:'browser', target:'es2022', outfile:'dist/app.js', minify:true });
const assets = {};
async function collect(dir, prefix = '') {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isDirectory()) await collect(path.join(dir,item.name), `${prefix}/${item.name}`);
    else assets[`${prefix}/${item.name}`] = await readFile(path.join(dir,item.name),'utf8');
  }
}
await collect('public');
assets['/app.js'] = await readFile('dist/app.js','utf8');
const worker = await readFile('worker/index.js','utf8');
await writeFile('dist/server/index.js', `const ASSETS = ${JSON.stringify(assets)};\n${worker}`);
console.log(`Built Tournament View: ${Object.keys(assets).length} assets, Worker entrypoint ready.`);
