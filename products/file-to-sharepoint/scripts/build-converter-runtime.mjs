// Development/release acquisition only. The installed extension is offline.
import {readFile,writeFile,mkdir,mkdtemp,rename,unlink} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Readable,Transform} from 'node:stream';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {availableSourceArchive,sourceDirectories} from './source-archive.mjs';
import {converterRecipeInputsComplete} from './converter-recipe-inputs.mjs';
const execute=promisify(execFile),vendor=new URL('../vendor/',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function run(command,args,log){
 await new Promise((resolve,reject)=>{const child=spawn(command,args,{windowsHide:true,env:process.env});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(`Converter source build exited ${code}; see build.log.`)));});
}
export async function buildConverterRuntime({cacheDirectory=fileURLToPath(new URL('../../../.artifacts/converter-source-build/',import.meta.url)),offline=false}={}){
 const record=JSON.parse(await readFile(new URL('converter-build-provenance.json',vendor),'utf8'));
 if(!converterRecipeInputsComplete(record.build?.inputs))throw new Error('Converter build recipe inputs missing or duplicated.');
 for(const input of record.build.inputs){
  if(!/^[\w.@/-]+$/.test(input.file)||input.file.split('/').some(part=>['..','.',''].includes(part)))throw new Error('Invalid converter build input path.');
  if(sha(await readFile(new URL('../'+input.file,import.meta.url)))!==input.sha256)throw new Error(`Converter build recipe hash mismatch: ${input.file}`);
 }
 await mkdir(cacheDirectory,{recursive:true});
 const selection=[];
 for(const input of record.preferredSourceInputs){
  if(!/^[\w.+-]+$/.test(input.file)||input.file.startsWith('.'))throw new Error('Invalid converter source input filename.');
  const selected=await availableSourceArchive(input,{directories:sourceDirectories(cacheDirectory)});
  if(selected){selection.push({input,selected:selected.pin,archive:selected.file});continue;}
  if(offline)throw new Error(`Missing offline converter source: ${input.file}`);
  const destination=path.join(cacheDirectory,input.file),temporary=destination+'.download';
  const response=await fetch(input.url,{signal:AbortSignal.timeout(240000)});if(!response.ok||!response.body)throw new Error(`Converter source HTTP ${response.status}: ${input.file}`);
  const hash=createHash('sha256');let bytes=0;
  try{await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,encoding,callback){hash.update(chunk);bytes+=chunk.length;callback(null,chunk);}}),createWriteStream(temporary,{flags:'wx'}));if(bytes!==input.bytes||hash.digest('hex')!==input.sha256)throw new Error(`Converter source pin mismatch: ${input.file}`);await rename(temporary,destination);}catch(error){await unlink(temporary).catch(()=>{});throw error;}
  selection.push({input,selected:input,archive:destination});
 }
 const output=await mkdtemp(path.join(cacheDirectory,'converter-build-'));
 const recipe=fileURLToPath(new URL('./converter-runtime-inputs/rebuild.sh',import.meta.url));
 const selectionFile=path.join(output,'selection.json'),log=createWriteStream(path.join(output,'driver.log'));
 try{
  if(process.platform==='win32'){
   const prefix=process.env.C2S_WSL_DISTRO?['-d',process.env.C2S_WSL_DISTRO,'--']:['--'];
   const linux=async file=>(await execute('wsl.exe',[...prefix,'wslpath','-a',path.resolve(file)],{windowsHide:true})).stdout.trim();
   for(const entry of selection)entry.archive=await linux(entry.archive);
   await writeFile(selectionFile,JSON.stringify(selection,null,2)+'\n');
   await run('wsl.exe',[...prefix,'bash',await linux(recipe),await linux(selectionFile),await linux(output)],log);
  }else{await writeFile(selectionFile,JSON.stringify(selection,null,2)+'\n');await run('bash',[recipe,selectionFile,output],log);}
 }finally{log.end();}
 const outputs=new Map();
 for(const expected of record.outputs){const file=path.join(output,expected.file),bytes=await readFile(file);if(bytes.length!==expected.bytes||sha(bytes)!==expected.sha256)throw new Error(`Rebuilt converter output hash mismatch: ${expected.file}`);outputs.set(expected.file,bytes);}
 if(!outputs.has('x2t.js')||!outputs.has('x2t.wasm'))throw new Error('Converter build record has no complete verified output pins.');
 return outputs;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){for(const[file,bytes]of await buildConverterRuntime({offline:process.argv.includes('--offline')}))console.log(`${file}: ${bytes.length} bytes, SHA256 ${sha(bytes)}`);}
