import JSZip from 'jszip';import path from 'node:path';import {fileURLToPath} from 'node:url';import {readdir,readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import './build.mjs';
const product=fileURLToPath(new URL('../',import.meta.url)),folder=path.resolve(process.env.FTS_BUILD_DIR??path.join(product,'dist/file-to-sharepoint'));
const metadata=JSON.parse(await readFile(path.join(product,'package.json'),'utf8')),zip=new JSZip();
async function add(directory,prefix=''){
 for(const item of await readdir(directory,{withFileTypes:true})){
   if(item.isSymbolicLink())throw Error('Package inputs must not contain filesystem links.');
   const name=prefix+item.name;
   if(item.isDirectory())await add(path.join(directory,item.name),name+'/');
   else zip.file(name,await readFile(path.join(directory,item.name)),{date:new Date('2026-11-07T00:00:00Z')});
 }
}
await add(folder);
const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});
const file=path.join(product,`dist/file-to-sharepoint-${metadata.version}-development.zip`);await writeFile(file,bytes);
await writeFile(file+'.sha256',createHash('sha256').update(bytes).digest('hex')+'  '+path.basename(file)+'\n');
console.log(`Development review archive: ${file}\nPublic distribution requires corresponding-source verification recorded in vendor/NOTICE.md.`);
