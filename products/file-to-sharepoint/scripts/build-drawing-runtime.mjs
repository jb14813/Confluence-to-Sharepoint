// Development/release build only; no installed-extension helper or network.
import {readFile,writeFile,mkdir,mkdtemp,rename,unlink,copyFile} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Readable,Transform} from 'node:stream';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {availableSourceArchive,sourceDirectories} from './source-archive.mjs';
const execute=promisify(execFile),vendor=new URL('../vendor/',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function matches(file,pin){try{const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(file)){bytes+=chunk.length;hash.update(chunk);}return bytes===pin.bytes&&hash.digest('hex')===pin.sha256;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
export async function buildDrawingRuntime({cacheDirectory=fileURLToPath(new URL('../../../.artifacts/file-import-source-build/',import.meta.url))}={}){
 const record=JSON.parse(await readFile(new URL('drawing-build-provenance.json',vendor),'utf8'));
 for(const input of record.build.inputs)if(sha(await readFile(new URL('../'+input.file,import.meta.url)))!==input.sha256)throw new Error(`Drawing build recipe hash mismatch: ${input.file}`);
 await mkdir(cacheDirectory,{recursive:true});
 const selected=new Map();
 for(const input of record.preferredSourceInputs){
  if(!/^[\w.+-]+$/.test(input.file)||input.file.startsWith('.'))throw new Error('Invalid drawing source input filename.');
  const preferred=await availableSourceArchive(input,{directories:sourceDirectories(cacheDirectory)});
  if(preferred){selected.set(input.file,preferred.file);continue;}
  const destination=path.join(cacheDirectory,input.file);selected.set(input.file,destination);if(await matches(destination,input))continue;
  const response=await fetch(input.url,{signal:AbortSignal.timeout(240000)});if(!response.ok||!response.body)throw new Error(`Drawing source acquisition HTTP ${response.status}: ${input.file}`);
  const temporary=destination+'.download',hash=createHash('sha256');let bytes=0;
  try{await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,encoding,callback){hash.update(chunk);bytes+=chunk.length;callback(null,chunk);}}),createWriteStream(temporary,{flags:'wx'}));if(bytes!==input.bytes||hash.digest('hex')!==input.sha256)throw new Error(`Drawing source pin mismatch: ${input.file}`);await rename(temporary,destination);}catch(error){await unlink(temporary).catch(()=>{});throw error;}
 }
 const output=await mkdtemp(path.join(cacheDirectory,'drawing-build-')),recipe=fileURLToPath(new URL('./drawing-runtime-inputs/rebuild.sh',import.meta.url));
 const inputDirectory=await mkdtemp(path.join(cacheDirectory,'drawing-inputs-'));for(const[file,source]of selected)await copyFile(source,path.join(inputDirectory,file));
 let result;
 if(process.platform==='win32'){
  const prefix=process.env.C2S_WSL_DISTRO?['-d',process.env.C2S_WSL_DISTRO,'--']:['--'];
  const linux=async file=>(await execute('wsl.exe',[...prefix,'wslpath','-a',path.resolve(file)],{windowsHide:true})).stdout.trim();
  result=await execute('wsl.exe',[...prefix,'bash',await linux(recipe),await linux(inputDirectory),await linux(output)],{maxBuffer:64*1024*1024,windowsHide:true});
 }else result=await execute('bash',[recipe,inputDirectory,output],{maxBuffer:64*1024*1024});
 await writeFile(path.join(output,'build.log'),result.stdout+result.stderr);
 const outputs=new Map();for(const expected of record.outputs){const file=path.join(output,expected.file),bytes=await readFile(file);if(bytes.length!==expected.bytes||sha(bytes)!==expected.sha256)throw new Error(`Rebuilt drawing output hash mismatch: ${expected.file}`);outputs.set(expected.file,bytes);}
 return outputs;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){for(const[file,bytes]of await buildDrawingRuntime())console.log(`${file}: ${bytes.length} bytes, SHA256 ${sha(bytes)}`);}
