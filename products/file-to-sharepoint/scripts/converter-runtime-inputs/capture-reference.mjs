// Test-only observer build driver; never included in the extension runtime.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
const [runtime,fixtures,output,...flags]=process.argv.slice(2);
if(!runtime||!fixtures||!output)throw new Error('Usage: capture-reference.mjs runtime-directory fixtures.json output-directory [--baseline]');
await mkdir(output,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const code=await readFile(path.join(runtime,'x2t.js'),'utf8'),wasm=await readFile(path.join(runtime,'x2t.wasm'));
const cases=[];
for(const fixture of JSON.parse(await readFile(fixtures,'utf8'))){
 let initialized,failed;const ready=new Promise((resolve,reject)=>{initialized=resolve;failed=reject;});
 const module={wasmBinary:wasm,onRuntimeInitialized:initialized,onAbort:failed,print(){},printErr(){}};
 const context=vm.createContext({Module:module,console,process,require:createRequire(import.meta.url),__dirname:path.resolve(runtime),setTimeout,clearTimeout,TextDecoder,TextEncoder,WebAssembly,Buffer});
 vm.runInContext(code,context,{filename:path.join(runtime,'x2t.js')});await ready;
 const fs=context.Module.FS;
 for(const dir of ['/working','/working/fonts','/working/themes'])fs.mkdir(dir);
 if(!flags.includes('--baseline'))fs.writeFile('/capture-pixels',new Uint8Array());
 const pdf=Buffer.from(fixture.pdf,'base64');fs.writeFile('/working/input.pdf',pdf);
 fs.writeFile('/working/params.xml','<TaskQueueDataConvert><m_sFileFrom>/working/input.pdf</m_sFileFrom><m_sFileTo>/working/output.docx</m_sFileTo><m_sThemeDir>/working/themes</m_sThemeDir><m_sFontDir>/working/fonts</m_sFontDir><m_bIsNoBase64>false</m_bIsNoBase64></TaskQueueDataConvert>');
 const result=context.Module.ccall('main1','number',['string'],['/working/params.xml']);
 const captures=[];
 for(const name of fs.readdir('/').filter(name=>/^captured-image-\d+\.(?:bgra|json)$/.test(name))){const bytes=fs.readFile('/'+name);await writeFile(path.join(output,fixture.name+'.'+name),bytes);captures.push({file:fixture.name+'.'+name,bytes:bytes.length,sha256:hash(bytes)});}
 try{await writeFile(path.join(output,fixture.name+'.docx'),fs.readFile('/working/output.docx'));}catch{}
 cases.push({name:fixture.name,pdfSha256:hash(pdf),result,captures});
 console.log(fixture.name,result,captures.length);
}
await writeFile(path.join(output,'capture-evidence.json'),JSON.stringify({runtime:{jsSha256:hash(Buffer.from(code)),wasmSha256:hash(wasm)},cases},null,2)+'\n');
