import {build} from 'esbuild';
import {mkdir,copyFile,cp,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';import path from 'node:path';import {execFileSync} from 'node:child_process';
const product=fileURLToPath(new URL('../',import.meta.url)),root=path.resolve(product,'../..');
const out=path.resolve(process.env.FTS_BUILD_DIR??path.join(product,'dist/file-to-sharepoint'));
// Verify pinned inputs before any independently installable package is built.
execFileSync(process.execPath,[path.join(product,'scripts/vendor-engine.mjs')],{cwd:product,stdio:'pipe'});
// Build the locally packaged preview runtime from its pinned source each time;
// the independent SPFx clean/build must not leave us copying stale/missing JS.
execFileSync(process.execPath,[path.join(product,'sharepoint-form/scripts/build-portable.mjs')],{cwd:path.join(product,'sharepoint-form'),stdio:'pipe'});
await mkdir(path.join(out,'src/app'),{recursive:true});
const common={bundle:true,platform:'browser',target:'chrome127',minify:false,legalComments:'eof',metafile:true,absWorkingDir:root};
const app=await build({...common,entryPoints:[path.join(product,'src/app/workspace.js')],outfile:path.join(out,'src/app/workspace.js'),format:'esm',external:['../engine/index.js','../../form/portable-form.js']});
const rest=await build({...common,entryPoints:{destination:path.join(product,'src/destination/index.js'),background:path.join(product,'src/app/background.js'),memory:path.join(root,'src/sharepoint/memory.js')},outdir:out,format:'iife'});
await cp(path.join(product,'src/engine'),path.join(out,'src/engine'),{recursive:true});
await cp(path.join(product,'vendor'),path.join(out,'vendor'),{recursive:true});
await cp(path.join(product,'assets/icons'),path.join(out,'icons'),{recursive:true});
await mkdir(path.join(out,'form'),{recursive:true});
for(const file of ['portable-form.js','portable-form.css','portable-form.js.LEGAL.txt'])await copyFile(path.join(product,'sharepoint-form/dist',file),path.join(out,'form',file));
for(const file of ['manifest.json','workspace.html'])await copyFile(path.join(product,'extension',file),path.join(out,file));
await copyFile(path.join(product,'src/app/workspace.css'),path.join(out,'workspace.css'));
await copyFile(path.join(product,'vendor/ONLYOFFICE-AGPL-3.0.txt'),path.join(out,'LICENSE.txt'));
const notices=[await readFile(path.join(product,'vendor/NOTICE.md'),'utf8'),await readFile(path.join(product,'assets/README.md'),'utf8'),'Shared SharePoint engine: MIT license, original project attribution:\n'+await readFile(path.join(root,'LICENSE'),'utf8'),'SurveyJS Form Library and bundled form runtime notices:\n'+await readFile(path.join(product,'sharepoint-form/dist/portable-form.js.LEGAL.txt'),'utf8')];
await writeFile(path.join(out,'THIRD-PARTY-NOTICES.txt'),notices.join('\n\n'));
const inputs=[...new Set([...Object.keys(app.metafile.inputs),...Object.keys(rest.metafile.inputs)])].sort();
if(inputs.some(input=>/(?:src\/confluence\/|src\/background\/(?:account|links|bulk-updates|jobs)\.js)/.test(input)))throw Error('A source-specific module entered the File extension.');
await writeFile(path.join(out,'build-inputs.json'),JSON.stringify({version:1,inputs},null,2)+'\n');
console.log(`Load unpacked File to SharePoint: ${out}`);
