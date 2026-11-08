// Collect exact corresponding-source inputs for the distributed engine. This
// operates only at release/build time, never in the installed extension.
import {readFile,mkdir,copyFile,rename,unlink,writeFile,stat} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const args = process.argv.slice(2), options = {};
for (let index=0;index<args.length;index+=2) {
  if (!['--output','--reuse-dir'].includes(args[index]) || !args[index+1]) throw new Error('Usage: collect-engine-source.mjs --output DIR [--reuse-dir CACHE]');
  options[args[index]] = path.resolve(args[index+1]);
}
if (!options['--output']) throw new Error('An explicit --output source directory is required.');
const output = options['--output'];
const vendor = new URL('../vendor/',import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json',vendor),'utf8'));
const inputs = new Map();
for (const file of manifest.provenanceFiles) {
  const record = JSON.parse(await readFile(new URL(file,vendor),'utf8'));
  const list = record.preferredSourceInputs || (record.source?.archiveUrl ? [{name:'ONLYOFFICE Word SDK source',file:record.source.archiveFile,url:record.source.archiveUrl,bytes:record.source.archiveBytes,sha256:record.source.archiveSha256}] : []);
  for (const input of list) {
    if (!/^[\w.+-]+$/.test(input.file) || !/^[a-f0-9]{64}$/.test(input.sha256) || !Number.isSafeInteger(input.bytes)) throw new Error('Invalid corresponding-source input record.');
    if (inputs.has(input.file) && inputs.get(input.file).sha256 !== input.sha256) throw new Error('Conflicting corresponding-source filenames.');
    inputs.set(input.file,input);
  }
}
async function verify(file,input) {
  const info = await stat(file);
  if (info.size !== input.bytes) return false;
  const sha256 = createHash('sha256'), sha512 = input.sha512 ? createHash('sha512') : null;
  for await (const chunk of createReadStream(file)) {sha256.update(chunk);sha512?.update(chunk);}
  return sha256.digest('hex') === input.sha256 && (!sha512 || sha512.digest('hex') === input.sha512);
}
await mkdir(output,{recursive:true});
let completed = 0;
for (const input of inputs.values()) {
  const destination = path.join(output,input.file);
  try {
    if (!await verify(destination,input)) throw new Error(`Existing source file does not match its pin: ${input.file}`);
    completed++;continue;
  } catch (error) {if (error.code !== 'ENOENT') throw error;}
  let reused = false;
  if (options['--reuse-dir']) for (const subdir of ['','dependency-sources','dependency-sources/boost-modules']) {
    const candidate = path.join(options['--reuse-dir'],subdir,input.file);
    try {if (await verify(candidate,input)) {await copyFile(candidate,destination);reused=true;break;}} catch(error) {if(error.code!=='ENOENT')throw error;}
  }
  if (!reused) {
    const response = await fetch(input.url,{headers:input.headers,signal:AbortSignal.timeout(240000)});
    if (!response.ok || !response.body) throw new Error(`Source download failed: ${input.file} HTTP ${response.status}`);
    const temporary = path.join(output,`.source-${randomUUID()}.download`);
    try {
      // Stream large source archives instead of retaining hundreds of MB in RAM.
      const hasher=createHash('sha256');let size=0;
      const observe=new Transform({transform(chunk,encoding,callback){hasher.update(chunk);size+=chunk.length;callback(null,chunk);}});
      await pipeline(Readable.fromWeb(response.body),observe,createWriteStream(temporary,{flags:'wx'}));
      if(size!==input.bytes||hasher.digest('hex')!==input.sha256||!await verify(temporary,input))throw new Error(`Source archive verification failed: ${input.file}`);
      await rename(temporary,destination);
    } catch(error) {await unlink(temporary).catch(()=>{});throw error;}
  }
  if (++completed%20===0) console.log(`Verified ${completed}/${inputs.size} corresponding-source archives.`);
}
await writeFile(path.join(output,'corresponding-source-manifest.json'),JSON.stringify({schemaVersion:1,archives:[...inputs.values()],provenanceFiles:manifest.provenanceFiles,buildRecipes:['products/file-to-sharepoint/scripts/build-word-sdk.mjs','products/file-to-sharepoint/scripts/word-sdk-inputs/rebuild-sdk.ps1','products/file-to-sharepoint/vendor/provenance/converter/Dockerfile']},null,2)+'\n');
console.log(`Verified ${completed} corresponding-source archives (${[...inputs.values()].reduce((sum,item)=>sum+item.bytes,0)} bytes).`);
