// Build-time selection of source-only delivery archives; never used at runtime.
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
export function sourceDirectories(cacheDirectory){return [cacheDirectory,...(process.env.C2S_SOURCE_DELIVERY_DIR??'').split(path.delimiter),...(process.env.C2S_SOURCE_DIR??'').split(path.delimiter),path.join(root,'.artifacts/preferred-source-delivery'),path.resolve(root,'../upstream-sources')].filter(Boolean);}
export async function availableSourceArchive(input,options={}){
 const preferred=await preferredSourceArchive(input,options);if(preferred)return preferred;
 if(!/^[\w.+-]+$/.test(input.file)||input.file.startsWith('.'))throw new Error('Invalid source archive filename.');
 for(const directory of options.directories??[]){const file=path.resolve(directory,input.file);let info;try{info=await stat(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}
  const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
  if(info.size!==input.bytes||hash.digest('hex')!==input.sha256)throw new Error('Source archive hash/size mismatch.');return {file,pin:input};
 }return null;
}
export async function preferredSourceArchive(input,{directories=[],deliveryFile=new URL('../vendor/provenance/source-delivery.json',import.meta.url)}={}){
 let record;try{record=JSON.parse(await readFile(deliveryFile,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(record.status!=='verified-preferred-source-delivery')throw new Error('Preferred source delivery is not verified.');
 const entry=record.archives.find(entry=>entry.upstream.file===input.file);if(!entry)return null;
 if(['file','bytes','sha256'].some(key=>entry.upstream[key]!==input[key]))throw new Error('Preferred source origin pin differs.');
 const pin=entry.published;if(!/^[\w.+-]+$/.test(pin.file)||pin.file.startsWith('.')||!/^[a-f0-9]{64}$/.test(pin.sha256)||!Number.isSafeInteger(pin.bytes))throw new Error('Invalid preferred source archive pin.');
 for(const directory of directories){const file=path.resolve(directory,pin.file);let info;try{info=await stat(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}
  const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
  if(info.size!==pin.bytes||hash.digest('hex')!==pin.sha256)throw new Error('Preferred source archive hash/size mismatch.');
  return {file,pin};
 }
 return null;
}
