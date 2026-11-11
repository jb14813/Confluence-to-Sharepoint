import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,cp,readdir}from'node:fs/promises';
import {createHash}from'node:crypto';
import path from'node:path';
import {fileURLToPath}from'node:url';
import {build}from'esbuild';
import {chromium}from'playwright';
import JSZip from'jszip';
import {chromiumExecutable}from'./chromium.mjs';

const product=fileURLToPath(new URL('..',import.meta.url)),root=new URL('fixtures/pdf-drawings/derived-origin/',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
async function inventory(dir,prefix=''){
 const rows=[];for(const entry of await readdir(path.join(dir,prefix),{withFileTypes:true})){
  const name=prefix+entry.name;if(entry.isDirectory())rows.push(...await inventory(dir,name+'/'));
  else {const bytes=await readFile(path.join(dir,name));rows.push({name,bytes:bytes.length,sha256:sha(bytes)});}
 }return rows.sort((a,b)=>a.name.localeCompare(b.name));
}
const harness=String.raw`
import {convertDocument}from'./src/engine/index.js';import {adaptDocument}from'./adapter.js';
const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)),encode=b=>{let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s);};
const messages=[];window.addEventListener('message',e=>{if(e.data?.channel==='fts-office-model')messages.push({origin:e.origin,type:e.data.type});});
window.run=async({name,input})=>{const offset=messages.length;try{
 const bytes=decode(input),result=await convertDocument({name,bytes}),before=JSON.stringify(result.officeDocument),adapted=await adaptDocument({name,bytes,result}),pictures=[];
 for(const asset of adapted.model.assets)pictures.push({asset,bytesBase64:encode(new Uint8Array(await adapted.pictures.get(asset.id).arrayBuffer()))});
 return {model:adapted.model,preview:adapted.preview,pictures,media:Object.fromEntries(Object.entries(result.media).map(([n,b])=>[n,encode(b)])),nativeDrawings:result.pdfLayout.nativeDrawings,nativeTables:result.pdfLayout.nativeTables,pdfDerivedImages:result.pdfDerivedImages,documentUnchanged:before===JSON.stringify(result.officeDocument),docxBase64:encode(result.docxBytes),sdkMessages:messages.slice(offset),remainingFrames:document.querySelectorAll('iframe').length};
}catch(e){return {error:{code:e.code,message:e.message},remainingFrames:document.querySelectorAll('iframe').length};}};`;

test('strict MV3 curved control-origin figure preserves full PNG through DOCX BIN SDK and editable Before/image/After flow',{timeout:180000},async t=>{
 const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8')),vendor=path.resolve(process.env.C2S_ENGINE_VENDOR_DIR||path.join(product,'vendor'));
 for(const [name,hash]of Object.entries(manifest.readerRuntime))assert.equal(sha(await readFile(path.join(vendor,name))),hash);
 assert.equal(sha(await readFile(path.join(vendor,'office/sdkjs/word/sdk-all.js'))),manifest.sdkAllJsSha256);
 const artifacts=path.resolve(product,'../../.artifacts/pdo');await mkdir(artifacts,{recursive:true});const run=await mkdtemp(path.join(artifacts,'r-')),extension=path.join(run,'e');await mkdir(extension);
 await cp(path.join(product,'src/engine'),path.join(extension,'src/engine'),{recursive:true});await cp(vendor,path.join(extension,'vendor'),{recursive:true});
 for(const [entry,format,globalName]of[['html-resources.js','esm',undefined],['sandbox-svg.js','iife','FtsSvg']])await build({entryPoints:[path.join(product,'src/engine',entry)],outfile:path.join(extension,'src/engine',entry),bundle:true,format,globalName,platform:'browser',target:'chrome127'});
 await build({entryPoints:[path.join(product,'src/content/index.js')],outfile:path.join(extension,'adapter.js'),bundle:true,format:'esm',platform:'browser',target:'chrome127'});
 const shipping=JSON.parse(await readFile(path.join(product,'extension/manifest.json'),'utf8'));
 await writeFile(path.join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Derived origin regression',version:'1.0.0',background:{service_worker:'background.js'},sandbox:shipping.sandbox,content_security_policy:shipping.content_security_policy}));
 await writeFile(path.join(extension,'background.js'),'void 0;');await writeFile(path.join(extension,'index.html'),'<!doctype html><script type="module" src="harness.js"></script>');await writeFile(path.join(extension,'harness.js'),harness);
 const runtime=await inventory(extension),proof={scope:'Own cubic control-origin PDF; source/publication adoption HELD',passed:false,runtimeHash:sha(JSON.stringify(runtime)),converterRuntime:Object.fromEntries(['x2t.js','x2t.wasm'].map(n=>[n,runtime.find(f=>f.name==='vendor/'+n).sha256])),rows:[],external:[],pageErrors:[],consoleErrors:[],failedRequests:[],workers:[]};
 await writeFile(path.join(run,'runtime.json'),JSON.stringify(runtime,null,2));t.diagnostic('Private proof: '+path.join(run,'results.json'));
 const context=await chromium.launchPersistentContext(path.join(run,'p'),{headless:true,executablePath:await chromiumExecutable(),ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-background-networking','--disable-component-update','--no-first-run']});let page;
 await context.route(/^https?:/,route=>{proof.external.push(route.request().url());return route.abort('blockedbyclient');});context.on('requestfailed',r=>proof.failedRequests.push({url:r.url(),error:r.failure()?.errorText}));
 try{
  const background=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');page=await context.newPage();page.on('pageerror',e=>proof.pageErrors.push(String(e)));page.on('console',m=>{if(m.type()==='error')proof.consoleErrors.push(m.text());});page.on('worker',w=>{const row={url:w.url(),closed:false};proof.workers.push(row);w.on('close',()=>row.closed=true);});
  await page.goto('chrome-extension://'+new URL(background.url()).hostname+'/index.html');await page.waitForFunction(()=>typeof window.run==='function');
  for(const item of manifest.cases){
   for(const [name,hash]of Object.entries(item.files))assert.equal(sha(await readFile(new URL(name,root))),hash,name);
   const data=JSON.parse(await readFile(new URL(item.name+'.json',root),'utf8')),source=await readFile(new URL(item.name+'.source.pdf',root)),result=await page.evaluate(v=>window.run(v),{name:item.name+'.pdf',input:source.toString('base64')});
   proof.rows.push({name:item.name,result,remainingWorkers:page.workers().length});await writeFile(path.join(run,'results.json'),JSON.stringify(proof,null,2));assert.equal(result.error,undefined,item.name+': '+JSON.stringify(result.error));
   assert.equal(result.model.sourceFileHash,item.sourcePdfSha256);assert.equal(result.documentUnchanged,true);assert.deepEqual(result.nativeTables.tables,[]);
   const native=result.nativeDrawings.pages[0],drawing=native.drawings[0],original=native.sourcePaints[drawing.sourceIds[0]-1];assert.equal(native.drawings.length,1);assert.equal(drawing.kind,'derived-vector');assert.equal(drawing.role,'figure');assert.equal(original.role,'drawing');assert.equal(original.clipId,0);assert.ok(original.bounds.leftPt>drawing.bounds.leftPt);assert.ok(original.bounds.topPt>drawing.bounds.topPt);assert.deepEqual(original.cellOwners,[]);assert.deepEqual(native.clips,[]);
   const zip=await JSZip.loadAsync(Buffer.from(result.docxBase64,'base64'));assert.equal(sha(await zip.file('word/fts-pdf-drawings.xml').async('nodebuffer')),data.privatePartSha256);
   const expected=Buffer.from(data.media[0].bytesBase64,'base64');assert.equal(result.pictures.length,1);assert.deepEqual(Buffer.from(result.pictures[0].bytesBase64,'base64'),expected);assert.deepEqual(Buffer.from(result.media[drawing.representation.resourceName],'base64'),expected);assert.deepEqual(await zip.file(drawing.representation.resourceName).async('nodebuffer'),expected);
   assert.equal(result.pictures[0].asset.id,data.media[0].sha256);assert.equal(result.pdfDerivedImages[0].sha256,data.media[0].sha256);
   assert.equal(result.model.stats.tables,0);assert.equal(result.model.stats.images,1);assert.equal(result.model.stats.editableTextCharacters,11);assert.deepEqual(result.model.warnings.filter(w=>w.blocking),[]);
   assert.equal(result.model.blocks.length,3);assert.match(result.model.blocks[0].html,/>Before</);assert.match(result.model.blocks[1].html,/class="c2sPicture"/);assert.match(result.model.blocks[2].html,/>After</);assert.equal(result.preview.drawingFlow[0].figures[0].docPrId,drawing.docPrId);assert.deepEqual(result.preview.drawingFlow[0].cellFigures,[]);
   assert.deepEqual(result.preview.textCoverage,{sourceCharacters:11,modelCharacters:11,missingCharacters:0,extraCharacters:0,physicalSequenceMatches:true});assert.ok(result.sdkMessages.some(m=>m.type==='ready'));assert.ok(result.sdkMessages.every(m=>m.origin==='null'));assert.equal(result.remainingFrames,0);assert.equal(page.workers().length,0);
  }
  assert.deepEqual(proof.external,[]);assert.deepEqual(proof.pageErrors,[]);assert.deepEqual(proof.consoleErrors,[]);assert.deepEqual(proof.failedRequests,[]);assert.equal(proof.workers.length,1);assert.ok(proof.workers.every(w=>w.closed));assert.deepEqual(await inventory(extension),runtime);proof.passed=true;
 }finally{proof.cleanup={remainingFrames:page?await page.locator('iframe').count():null,remainingWorkers:page?.workers().length,runtimeUnchanged:JSON.stringify(await inventory(extension))===JSON.stringify(runtime)};await context.close();proof.cleanup.contextClosed=true;await writeFile(path.join(run,'results.json'),JSON.stringify(proof,null,2));}
});
