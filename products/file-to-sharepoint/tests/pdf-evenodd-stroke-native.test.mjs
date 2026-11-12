import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
const vendor=path.resolve(process.env.C2S_ENGINE_VENDOR_DIR||fileURLToPath(new URL('../vendor/',import.meta.url)));
for(const [name,paintCount,fillCount]of [['fill-stroke.pdf',2,1],['readonly-multiline.pdf',5,2]]){
 test('native PDF conversion retains separate evenOdd fill/stroke paints: '+name,async()=>{
  const [code,wasm,input]=await Promise.all([readFile(path.join(vendor,'x2t.js'),'utf8'),readFile(path.join(vendor,'x2t.wasm')),readFile(new URL('./fixtures/pdf-evenodd-stroke/'+name,import.meta.url))]);
  const manifest=JSON.parse(await readFile(new URL('./fixtures/pdf-evenodd-stroke/manifest.json',import.meta.url),'utf8'));
  assert.equal(createHash('sha256').update(input).digest('hex'),manifest.files[name]);
  let ready,failed;const initialized=new Promise((resolve,reject)=>{ready=resolve;failed=reject;}),module={wasmBinary:wasm,onRuntimeInitialized:ready,onAbort:failed,print(){},printErr(){}};
  const context=vm.createContext({Module:module,console,process,require:createRequire(import.meta.url),__dirname:vendor,setTimeout,clearTimeout,TextDecoder,TextEncoder,WebAssembly,Buffer});vm.runInContext(code,context,{filename:path.join(vendor,'x2t.js')});await initialized;
  const fs=context.Module.FS;for(const directory of ['/working','/working/fonts','/working/themes'])fs.mkdir(directory);fs.writeFile('/working/input.pdf',input);
  fs.writeFile('/working/params.xml','<TaskQueueDataConvert><m_sFileFrom>/working/input.pdf</m_sFileFrom><m_sFileTo>/working/output.docx</m_sFileTo><m_sThemeDir>/working/themes</m_sThemeDir><m_sFontDir>/working/fonts</m_sFontDir><m_bIsNoBase64>false</m_bIsNoBase64><m_oTextParams><m_nTextAssociationType>2</m_nTextAssociationType></m_oTextParams></TaskQueueDataConvert>');
  let result=context.Module.ccall('main1','number',['string'],['/working/params.xml']);
  if(result!==0&&result!==55){if(fs.analyzePath('/working/output.docx').exists)fs.unlink('/working/output.docx');fs.writeFile('/working/params.xml',fs.readFile('/working/params.xml',{encoding:'utf8'}).replace('<m_nTextAssociationType>2</m_nTextAssociationType>','<m_nTextAssociationType>3</m_nTextAssociationType>'));result=context.Module.ccall('main1','number',['string'],['/working/params.xml']);}
  assert.equal(result,0,'A valid filled/stroked box must convert without disabling source verification');
  const archive=await JSZip.loadAsync(Buffer.from(fs.readFile('/working/output.docx'))),drawings=await archive.file('word/fts-pdf-drawings.xml').async('string');
  assert.match(drawings,/complete="true"/);assert.equal((drawings.match(/<sourcePaint\s/g)||[]).length,paintCount);assert.equal((drawings.match(/kind="fill"/g)||[]).length,fillCount);assert.equal((drawings.match(/fillRule="evenodd"/g)||[]).length,fillCount);assert.equal((drawings.match(/kind="stroke"/g)||[]).length,paintCount-fillCount);assert.doesNotMatch(drawings,/kind="stroke-fill"/);
  assert.match(await archive.file('word/document.xml').async('string'),/Read-only/);
 });
}
