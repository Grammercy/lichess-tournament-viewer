import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

const outdir='dist/pages';
await rm(outdir,{recursive:true,force:true});
await mkdir(outdir,{recursive:true});
await cp('public',outdir,{recursive:true});
await build({
  entryPoints:['src/app.js'],bundle:true,format:'esm',platform:'browser',
  target:'es2022',outfile:`${outdir}/app.js`,minify:true,
  define:{LICHESS_API_BASE:JSON.stringify('https://lichess.org')},
});
await writeFile(`${outdir}/.nojekyll`,'');
console.log(`Built GitHub Pages site in ${outdir}.`);
