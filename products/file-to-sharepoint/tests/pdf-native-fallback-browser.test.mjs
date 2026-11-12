import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {chromiumExecutable} from './chromium.mjs';
import {fixtures} from './engine-fixtures.mjs';

const product=fileURLToPath(new URL('..',import.meta.url));
const fixtureRoot=new URL('./fixtures/pdf-native-fallback/',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

// Observe the real native API in the disposable test copy. Calls, parameters,
// return values, filesystem and results are never substituted or rewritten.
const observeNative=String.raw`
  const originalCall=Module.ccall.bind(Module);
  Module.ccall=(...args)=>{
    const xml=Module.FS.readFile('/working/params.xml',{encoding:'utf8'});
    const request=Number(xml.match(/<m_nTextAssociationType>(\d+)</)?.[1])||null;
    const output=xml.match(/<m_sFileTo>([^<]+)</)?.[1];
    const state=()=>Module.FS.analyzePath(output).exists;
    self.postMessage({nativeProbe:{phase:'begin',request,output,outputExists:state()}});
    const code=originalCall(...args);
    self.postMessage({nativeProbe:{phase:'end',request,output,code,outputExists:state()}});
    return code;
  };
  return Module;`;

const harness=String.raw`
import {convertDocument} from './src/engine/index.js';
import {adaptDocument} from './adapter.js';
const NativeWorker=window.Worker;
let active=null;
window.Worker=class extends NativeWorker{
  constructor(...args){super(...args);this.owner=active;this.owner.workers++;}
  terminate(){if(!this.stopped){this.stopped=true;this.owner.terminated++;}return super.terminate();}
  set onmessage(receive){super.onmessage=event=>{
    if(event.data?.nativeProbe){const probe=event.data.nativeProbe;this.owner.calls.push(probe);if(this.owner.abortAt!==null&&probe.phase==='begin'&&probe.request===this.owner.abortAt)this.owner.controller.abort();return;}
    receive(event);
  };}
};
window.run=async({name,base64,abortAt=null,timeoutMs=30000})=>{
  const state={calls:[],workers:0,terminated:0,abortAt,controller:new AbortController()};active=state;
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  try{
    const result=await convertDocument({name,bytes},{signal:state.controller.signal,timeoutMs});
    const unchanged=JSON.stringify(result.officeDocument);
    const adapted=await adaptDocument({name,bytes,result});
    const root=new DOMParser().parseFromString(adapted.model.blocks.map(block=>block.html).join(''),'text/html');
    const assets=[];for(const asset of adapted.model.assets){const blob=adapted.pictures.get(asset.id),image=await createImageBitmap(blob);try{
      const canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
      const rgba=ctx.getImageData(0,0,image.width,image.height).data;let visible=0;for(let i=3;i<rgba.length;i+=4)if(rgba[i])visible++;
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
      assets.push({id:asset.id,hash,size:blob.size,width:image.width,height:image.height,visible});
    }finally{image.close();}}
    return {calls:state.calls,workers:state.workers,terminated:state.terminated,frames:document.querySelectorAll('iframe').length,
      profile:result.pdfLayout,nativeText:result.pdfText.pages.map(page=>page.text).join('\n'),editableText:root.body.textContent,
      readingOrder:adapted.preview.readingOrder,drawings:adapted.preview.drawings,sourceHash:adapted.model.sourceFileHash,
      blocking:adapted.model.warnings.filter(w=>w.blocking),warnings:adapted.model.warnings.map(w=>w.code),
      assets,pictureSlots:root.querySelectorAll('.c2sPicture').length,officeUnchanged:unchanged===JSON.stringify(result.officeDocument),formDefinition:adapted.formDefinition};
  }catch(error){return {error:{code:error.code,name:error.name,message:error.message,stack:error.stack},calls:state.calls,workers:state.workers,terminated:state.terminated,frames:document.querySelectorAll('iframe').length};}
  finally{active=null;}
};`;

test('real strict MV3 native2 refusal retries native4 with editable content, bounded drawings and isolated recovery',{timeout:180000},async t=>{
  const manifest=JSON.parse(await readFile(new URL('manifest.json',fixtureRoot),'utf8'));
  const crossing=await readFile(new URL('crossing-cell.pdf',fixtureRoot)),unsafe=await readFile(new URL('unsupported-blend.pdf',fixtureRoot));
  for(const [name,bytes]of [['crossing-cell.pdf',crossing],['unsupported-blend.pdf',unsafe]])assert.equal(sha(bytes),manifest.files[name]);
  const vendor=path.resolve(process.env.C2S_ENGINE_VENDOR_DIR||path.join(product,'vendor'));
  const runtime=Object.fromEntries(await Promise.all(['x2t.js','x2t.wasm','drawingfile.js','drawingfile.wasm','office/sdkjs/word/sdk-all.js'].map(async name=>[name,sha(await readFile(path.join(vendor,name)))])));
  t.diagnostic('Actual supplied runtime SHA256: '+JSON.stringify(runtime));
  const root=path.resolve(product,'../../.artifacts/pnf');await mkdir(root,{recursive:true});
  const run=await mkdtemp(path.join(root,'r-')),extension=path.join(run,'e');await mkdir(extension);
  await cp(path.join(product,'src/engine'),path.join(extension,'src/engine'),{recursive:true});
  await cp(vendor,path.join(extension,'vendor'),{recursive:true});
  const workerPath=path.join(extension,'src/engine/worker.js'),worker=await readFile(workerPath,'utf8');
  assert.equal(worker.split('return Module;').length,2,'Observe initialized native API exactly once, including PDF→DOCX and DOCX→BIN');
  await writeFile(workerPath,worker.replace('return Module;',observeNative));
  for(const [entry,format,globalName]of [['html-resources.js','esm',undefined],['sandbox-svg.js','iife','FtsSvg']])await build({entryPoints:[path.join(product,'src/engine',entry)],outfile:path.join(extension,'src/engine',entry),bundle:true,format,globalName,platform:'browser',target:'chrome127'});
  await build({entryPoints:[path.join(product,'src/content/index.js')],outfile:path.join(extension,'adapter.js'),bundle:true,format:'esm',platform:'browser',target:'chrome127'});
  const shipping=JSON.parse(await readFile(path.join(product,'extension/manifest.json'),'utf8'));
  await writeFile(path.join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Native PDF fallback regression',version:'1.0.0',background:{service_worker:'background.js'},sandbox:shipping.sandbox,content_security_policy:shipping.content_security_policy}));
  await writeFile(path.join(extension,'background.js'),'void 0;');
  await writeFile(path.join(extension,'index.html'),'<!doctype html><script type="module" src="harness.js"></script>');
  await writeFile(path.join(extension,'harness.js'),harness);
  const context=await chromium.launchPersistentContext(path.join(run,'p'),{headless:true,executablePath:await chromiumExecutable(),ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-background-networking','--disable-component-update','--no-first-run']});
  const external=[],pageErrors=[],evidence=[];
  await context.route(/^https?:/,route=>{external.push(route.request().url());return route.abort('blockedbyclient');});
  try{
    const background=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),page=await context.newPage();
    page.on('pageerror',error=>pageErrors.push(String(error)));
    await page.goto('chrome-extension://'+new URL(background.url()).hostname+'/index.html');await page.waitForFunction(()=>typeof window.run==='function');
    const invoke=async(name,bytes,options={})=>{
      const result=await page.evaluate(value=>window.run(value),{name,base64:Buffer.from(bytes).toString('base64'),...options});
      evidence.push({name,...result});assert.equal(result.frames,0,'Every success/refusal/cancel releases its SDK frame');
      assert.equal(result.workers,result.terminated,'Every request releases its dedicated converter');return result;
    };
    const ends=result=>result.calls.filter(call=>call.phase==='end');
    const success=await invoke('crossing.pdf',crossing);
    assert.equal(success.error,undefined,JSON.stringify(success.error));
    assert.deepEqual(ends(success).map(call=>call.request),[2,3,null]);
    assert.notEqual(ends(success)[0].code,0);assert.notEqual(ends(success)[0].code,55);assert.equal(ends(success)[0].outputExists,false);
    assert.deepEqual(ends(success).slice(1).map(call=>call.code),[0,0]);
    assert.ok(success.calls.filter(call=>call.phase==='begin').every(call=>call.outputExists===false),'Retry and DOCX→BIN must not reuse an existing output');
    assert.equal(success.profile.textAssociationType,4);assert.equal(success.profile.flowGeometry,'native-plain-paragraph-v1');
    assert.equal(success.profile.nativeTables.textAssociationType,4);assert.deepEqual(success.profile.nativeTables.tables,[]);
    assert.equal(success.sourceHash,sha(crossing));assert.equal(success.officeUnchanged,true);assert.deepEqual(success.blocking,[]);
    for(const text of manifest.editableText){assert.ok(success.nativeText.includes(text));assert.ok(success.editableText.includes(text),text);}
    assert.equal(success.readingOrder,'native-sharepoint-reflow');assert.ok(success.warnings.includes('pdf-native-layout-adapted'));
    const sourceDrawings=success.profile.nativeDrawings.pages[0].drawings;
    assert.equal(success.profile.nativeDrawings.sourcePaintCount,2,'Both authored rectangle strokes remain in the native source ledger');
    assert.deepEqual([...new Set(sourceDrawings.flatMap(drawing=>drawing.sourceIds))].sort(),[1,2]);
    assert.ok(sourceDrawings.length>0);assert.equal(success.drawings.length,sourceDrawings.length);assert.ok(success.drawings.every(drawing=>drawing.pageIndex===0));
    assert.equal(success.pictureSlots,sourceDrawings.length);assert.ok(success.assets.length>0);assert.ok(success.assets.every(asset=>asset.id===asset.hash&&asset.size>8&&asset.width>0&&asset.height>0&&asset.visible>100));

    const refused=await invoke('unsupported.pdf',unsafe);
    assert.equal(refused.error?.code,'CONVERSION_FAILED');assert.deepEqual(ends(refused).map(call=>call.request),[2,3]);
    assert.ok(ends(refused).every(call=>call.code!==0&&call.outputExists===false));assert.equal(refused.profile,undefined);
    const encrypted=await invoke('encrypted.pdf',Buffer.from(fixtures['encrypted.pdf'],'base64'));
    assert.equal(encrypted.error?.code,'ENCRYPTED_DOCUMENT');assert.deepEqual(encrypted.calls,[],'Reader password refusal must never attempt fallback');
    const aborted=await invoke('cancel-fallback.pdf',crossing,{abortAt:3});
    assert.equal(aborted.error?.name,'AbortError');assert.ok(aborted.calls.some(call=>call.phase==='begin'&&call.request===3));
    assert.equal(aborted.profile,undefined);
    const timeout=await invoke('timeout.pdf',crossing,{timeoutMs:1});assert.equal(timeout.error?.code,'ENGINE_TIMEOUT');
    const recovery=await invoke('recovery.pdf',Buffer.from(fixtures['sample.pdf'],'base64'));
    assert.equal(recovery.error,undefined,JSON.stringify(recovery.error));assert.deepEqual(ends(recovery).map(call=>call.request),[2,null]);
    assert.ok(ends(recovery).every(call=>call.code===0));assert.equal(recovery.profile.textAssociationType,2);assert.equal(recovery.profile.nativeTables.textAssociationType,undefined);
    assert.deepEqual(recovery.blocking,[]);assert.equal(recovery.officeUnchanged,true);
    const boxed=await invoke('readonly-multiline.pdf',await readFile(new URL('./fixtures/pdf-evenodd-stroke/readonly-multiline.pdf',import.meta.url)));
    assert.equal(boxed.error,undefined,JSON.stringify(boxed.error));assert.deepEqual(boxed.blocking,[]);assert.equal(boxed.officeUnchanged,true);
    assert.equal(boxed.profile.nativeDrawings.sourcePaintCount,5,'Outer box plus two separately verified fill/stroke pairs');
    assert.ok(boxed.editableText.includes('Read-only and multiline validation'));assert.ok(boxed.editableText.includes('Reference (read-only)'));assert.ok(boxed.editableText.includes('Notes (required)'));
    assert.equal(boxed.formDefinition.fields.length,2);assert.ok(boxed.formDefinition.fields.some(field=>field.readOnly));assert.ok(boxed.formDefinition.fields.some(field=>field.required&&field.multiline));
    assert.deepEqual(external,[]);assert.deepEqual(pageErrors,[]);
  }finally{
    await context.close();
    await writeFile(path.join(run,'results.json'),JSON.stringify({runtime,fixtureManifest:manifest,evidence,external,pageErrors},null,2));
    t.diagnostic('Native fallback evidence: '+path.join(run,'results.json'));
  }
});
