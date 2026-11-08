import {build} from 'esbuild';import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {ENGINE_FILES,FORM_FILES,FILE_ICON_FILES,VENDOR_FILES,VENDOR_METADATA_FILES} from './file-import-assets.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),product=path.join(root,'products/file-to-sharepoint');
export async function buildCombinedFileImport(out){
 execFileSync(process.execPath,[path.join(product,'scripts/vendor-engine.mjs')],{cwd:product,stdio:'pipe'});
 execFileSync(process.execPath,[path.join(product,'sharepoint-form/scripts/build-portable.mjs')],{cwd:path.join(product,'sharepoint-form'),stdio:'pipe'});
 const common={bundle:true,platform:'browser',target:'chrome127',minify:false,legalComments:'eof',absWorkingDir:root};
 await build({...common,entryPoints:[path.join(product,'src/app/workspace.js')],outfile:path.join(out,'src/app/workspace.js'),format:'esm',external:['../engine/index.js','../../form/portable-form.js']});
 await build({...common,entryPoints:[path.join(product,'src/destination/index.js')],outfile:path.join(out,'file-destination.js'),format:'iife'});
 async function copy(source,destination){await mkdir(path.dirname(destination),{recursive:true});await copyFile(source,destination);}
 for(const file of ENGINE_FILES)await copy(path.join(product,file),path.join(out,file));
 for(const file of VENDOR_FILES)await copy(path.join(product,file==='vendor/engine-assets.json'?'vendor/manifest.json':file),path.join(out,file));
 const provenanceFiles=VENDOR_METADATA_FILES.filter(name=>name.endsWith('.json')&&name!=='vendor/engine-assets.json');
 const records=await Promise.all(provenanceFiles.map(async file=>({file:path.basename(file),record:JSON.parse(await readFile(path.join(product,file),'utf8'))})));
 await writeFile(path.join(out,'vendor/provenance.json'),JSON.stringify({schemaVersion:1,records},null,2)+'\n');
 for(const file of FORM_FILES)await copy(path.join(product,'sharepoint-form/dist',path.basename(file)),path.join(out,file));
 for(const file of FILE_ICON_FILES)await copy(path.join(product,'assets/icons',path.basename(file)),path.join(out,file));
 await copy(path.join(product,'extension/workspace.html'),path.join(out,'file-workspace.html'));
 await copy(path.join(product,'src/app/workspace.css'),path.join(out,'workspace.css'));
 await writeFile(path.join(out,'file-product.json'),JSON.stringify({productName:'Confluence to SharePoint',isCombined:true,homePath:'dashboard.html',brandIcon:'icons/logo.svg',featureIcon:'file-icons/icon32.png',licensesPath:'licenses.html',destinationScript:'file-destination.js'},null,2)+'\n');
}
