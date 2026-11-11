import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,cp,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import JSZip from 'jszip';
import {chromiumExecutable} from './chromium.mjs';
import {readPdfDrawings} from '../src/engine/pdf-drawings.js';

const product=fileURLToPath(new URL('..',import.meta.url));
const fixtureRoot=new URL('./fixtures/pdf-drawings/noncell-rect-clip/',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const names=['hole','star','alpha','curve'].flatMap(shape=>['crossing','touching'].flatMap(relation=>[0,1].map(mode=>`${shape}-${relation}-mode${mode}`)));

async function inventory(root,prefix=''){
  const rows=[];
  for(const entry of await readdir(path.join(root,prefix),{withFileTypes:true})){
    const name=prefix+entry.name;
    if(entry.isDirectory())rows.push(...await inventory(root,name+'/'));
    else {assert.ok(entry.isFile(),'Staged runtime contains only files and directories');const bytes=await readFile(path.join(root,name));rows.push({name,bytes:bytes.length,sha256:sha(bytes)});}
  }
  return rows.sort((a,b)=>a.name.localeCompare(b.name));
}

// Native060 fixtures are noninterlaced 8-bit RGBA PNGs. Read straight alpha
// directly: browser canvas readback can premultiply and round these channels.
function rgbaHash(png){
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(png.toString('ascii',12,16),'IHDR');
  assert.deepEqual([...png.subarray(24,29)],[8,6,0,0,0]);
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20),chunks=[];
  for(let offset=8;offset<png.length;){
    const length=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8);
    assert.ok(offset+length+12<=png.length);
    if(type==='IDAT')chunks.push(png.subarray(offset+8,offset+8+length));
    offset+=length+12;
    if(type==='IEND'){assert.equal(offset,png.length);break;}
  }
  const stride=width*4,raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:height*(stride+1)}),rgba=Buffer.alloc(width*height*4);
  assert.equal(raw.length,height*(stride+1));
  const paeth=(a,b,c)=>{const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);return da<=db&&da<=dc?a:db<=dc?b:c;};
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)];assert.ok(filter<=4);
    for(let x=0;x<stride;x++){
      const i=y*stride+x,a=x>=4?rgba[i-4]:0,b=y?rgba[i-stride]:0,c=y&&x>=4?rgba[i-stride-4]:0;
      const predictor=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];
      rgba[i]=(raw[y*(stride+1)+1+x]+predictor)&255;
    }
  }
  return {width,height,sha256:sha(rgba)};
}

function sdkPicture(document){
  const pictures=[],stack=[document];
  while(stack.length){
    const node=stack.pop();if(!node||typeof node!=='object')continue;
    if(node.type==='paraDrawing')pictures.push(node);
    else stack.push(...Object.values(node));
  }
  assert.equal(pictures.length,1);assert.equal(pictures[0].docPr.id,1);assert.equal(pictures[0].graphic.type,'image');
  assert.equal(pictures[0].graphic.blipFill.rasterImageId,'image1.png');return pictures[0];
}

const harness=String.raw`
import {convertDocument} from './src/engine/index.js';
import {adaptDocument} from './adapter.js';
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const encode=value=>{let out='';for(let i=0;i<value.length;i+=32768)out+=String.fromCharCode(...value.subarray(i,i+32768));return btoa(out);};
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),n=>n.toString(16).padStart(2,'0')).join('');
const messages=[];
window.addEventListener('message',event=>{if(event.data?.channel==='fts-office-model')messages.push({origin:event.origin,type:event.data.type});});
async function decodeImage(bytes){let image;try{image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));return {width:image.width,height:image.height};}finally{image?.close();}}
window.run=async({name,input})=>{
  const offset=messages.length;
  try{
    const source=decode(input),result=await convertDocument({name,bytes:source}),before=JSON.stringify(result.officeDocument);
    const adapted=await adaptDocument({name,bytes:source,result}),media=[],images=[];
    for(const [resourceName,bytes] of Object.entries(result.media))media.push({resourceName,sha256:await hash(bytes),bytesBase64:encode(bytes),decoded:await decodeImage(bytes)});
    for(const asset of adapted.model.assets){const bytes=new Uint8Array(await adapted.pictures.get(asset.id).arrayBuffer());images.push({asset,sha256:await hash(bytes),bytesBase64:encode(bytes),decoded:await decodeImage(bytes)});}
    const tables=[];
    for(const block of adapted.model.blocks){
      const root=new DOMParser().parseFromString(block.html,'text/html');
      for(const table of root.querySelectorAll('table'))tables.push([...table.rows].map(row=>[...row.cells].map(cell=>{
        const order=[],walk=node=>{if(node.nodeType===Node.TEXT_NODE){const text=node.textContent.trim();if(text)order.push(text);}else if(node.nodeType===Node.ELEMENT_NODE&&node.matches('.c2sPicture'))order.push('picture');else for(const child of node.childNodes)walk(child);};walk(cell);return {text:cell.textContent.trim(),order,pictures:cell.querySelectorAll('.c2sPicture').length};
      })));
    }
    return {model:adapted.model,preview:adapted.preview,tables,media,images,officeDocument:result.officeDocument,documentUnchanged:before===JSON.stringify(result.officeDocument),
      nativeDrawings:result.pdfLayout.nativeDrawings,nativeTables:result.pdfLayout.nativeTables,pdfText:result.pdfText,pdfDerivedImages:result.pdfDerivedImages,
      docxBase64:encode(result.docxBytes),docxHash:await hash(result.docxBytes),sourceHash:await hash(source),sdkMessages:messages.slice(offset),remainingFrames:document.querySelectorAll('iframe').length};
  }catch(error){return {error:{code:error.code,name:error.name,message:error.message,stack:error.stack},sdkMessages:messages.slice(offset),remainingFrames:document.querySelectorAll('iframe').length};}
};`;


test('strict MV3 actual noncell crossing and touching W/W* clips retain full PNG RGBA and editable Before/image/After',{timeout:240000},async t=>{
 const manifest=JSON.parse(await readFile(new URL('manifest.json',fixtureRoot),'utf8')),pixels=JSON.parse(await readFile(new URL('pixel-proof.json',fixtureRoot),'utf8'));
 assert.deepEqual(manifest.cases.map(item=>item.name),names);assert.equal(sha(await readFile(new URL('pixel-proof.json',fixtureRoot))),manifest.pixelProofSha256);
 const parser=vm.createContext({TextDecoder,TextEncoder});vm.runInContext(await readFile(path.join(product,'vendor/xmldom.js'),'utf8'),parser);
 const vendor=path.resolve(process.env.C2S_ENGINE_VENDOR_DIR||path.join(product,'vendor'));
 for(const [name,hash]of Object.entries(manifest.readerRuntime))assert.equal(sha(await readFile(path.join(vendor,name))),hash);
 assert.equal(sha(await readFile(path.join(vendor,'office/sdkjs/word/sdk-all.js'))),manifest.sdkAllJsSha256);
 // Record supplied converter hashes without changing its adoption or source state.
 const artifacts=path.resolve(product,'../../.artifacts/prc');await mkdir(artifacts,{recursive:true});const run=await mkdtemp(path.join(artifacts,'r-')),extension=path.join(run,'e');await mkdir(extension);
 await cp(path.join(product,'src/engine'),path.join(extension,'src/engine'),{recursive:true});await cp(vendor,path.join(extension,'vendor'),{recursive:true});
 for(const [entry,format,globalName]of[['html-resources.js','esm',undefined],['sandbox-svg.js','iife','FtsSvg']])await build({entryPoints:[path.join(product,'src/engine',entry)],outfile:path.join(extension,'src/engine',entry),bundle:true,format,globalName,platform:'browser',target:'chrome127'});
 await build({entryPoints:[path.join(product,'src/content/index.js')],outfile:path.join(extension,'adapter.js'),bundle:true,format:'esm',platform:'browser',target:'chrome127'});
 const shipping=JSON.parse(await readFile(path.join(product,'extension/manifest.json'),'utf8'));
 const qaManifest={manifest_version:3,name:'Noncell rectangular clip regression',version:'1.0.0',background:{service_worker:'background.js'},sandbox:shipping.sandbox,content_security_policy:shipping.content_security_policy};assert.equal(qaManifest.web_accessible_resources,undefined);
 await writeFile(path.join(extension,'manifest.json'),JSON.stringify(qaManifest));await writeFile(path.join(extension,'background.js'),'void 0;');await writeFile(path.join(extension,'index.html'),'<!doctype html><script type="module" src="harness.js"></script>');await writeFile(path.join(extension,'harness.js'),harness);
 const runtime=await inventory(extension),proof={scope:'Own16 actual noncell crossing/touching clips; adoption/publication/SharePoint acceptance HELD',passed:false,runtimeHash:sha(JSON.stringify(runtime)),converterRuntime:Object.fromEntries(['x2t.js','x2t.wasm'].map(n=>[n,runtime.find(f=>f.name==='vendor/'+n).sha256])),rows:[],external:[],pageErrors:[],consoleErrors:[],failedRequests:[],workers:[]};
 await writeFile(path.join(run,'runtime.json'),JSON.stringify(runtime,null,2));t.diagnostic('Private proof: '+path.join(run,'results.json'));
 const context=await chromium.launchPersistentContext(path.join(run,'p'),{headless:true,executablePath:await chromiumExecutable(),ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-background-networking','--disable-component-update','--no-first-run']});let page;
 await context.route(/^https?:/,route=>{proof.external.push(route.request().url());return route.abort('blockedbyclient');});context.on('requestfailed',r=>proof.failedRequests.push({url:r.url(),error:r.failure()?.errorText}));
 try{
  const background=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');page=await context.newPage();page.on('pageerror',e=>proof.pageErrors.push(String(e)));page.on('console',m=>{if(m.type()==='error')proof.consoleErrors.push(m.text());});page.on('worker',w=>{const row={url:w.url(),closed:false};proof.workers.push(row);w.on('close',()=>row.closed=true);});
  await page.goto('chrome-extension://'+new URL(background.url()).hostname+'/index.html');await page.waitForFunction(()=>typeof window.run==='function');
  for(const item of manifest.cases){
   for(const [name,hash]of Object.entries(item.files))assert.equal(sha(await readFile(new URL(name,fixtureRoot))),hash,name);
   const data=JSON.parse(await readFile(new URL(item.name+'.json',fixtureRoot),'utf8')),source=await readFile(new URL(item.name+'.source.pdf',fixtureRoot)),xml=await readFile(new URL(item.name+'.drawings.xml',fixtureRoot)),drawings=readPdfDrawings(new Uint8Array(xml),data.options,parser.EngineXml.DOMParser);
   const result=await page.evaluate(v=>window.run(v),{name:item.name+'.pdf',input:source.toString('base64')});proof.rows.push({name:item.name,result,remainingWorkers:page.workers().length});await writeFile(path.join(run,'results.json'),JSON.stringify(proof,null,2));assert.equal(result.error,undefined,item.name+': '+JSON.stringify(result.error));
   assert.match(source.toString('latin1'),item.reportlabClipFillMode===0?/\bW\*\s+n\b/:/\bW\s+n\b/);assert.equal(result.sourceHash,item.sourcePdfSha256);assert.equal(result.model.sourceFileHash,item.sourcePdfSha256);assert.equal(result.documentUnchanged,true);assert.deepEqual(result.nativeTables.tables,[]);assert.deepEqual(result.nativeDrawings,drawings);
   const native=result.nativeDrawings.pages[0],drawing=native.drawings[0],original=native.sourcePaints[drawing.sourceIds[0]-1];assert.equal(native.drawings.length,1);assert.equal(drawing.kind,'derived-vector');assert.equal(drawing.role,'figure');assert.equal(original.role,'drawing');assert.equal(original.kind,'fill');assert.equal(original.fillRule,'evenodd');assert.equal(original.normalComposite,true);assert.equal(original.solidFill.a,item.shape==='alpha'?127:255);assert.equal(original.clipId,1);assert.deepEqual(original.cellOwners,[]);assert.equal(native.clips[0].nativeMode,item.clipNativeMode);
   const clipLeft=Math.min(...native.clips[0].path.flatMap(p=>p.values.filter((_,i)=>i%2===0)));if(item.relation==='touching')assert.equal(clipLeft,drawing.bounds.leftPt);else {assert.ok(clipLeft>drawing.bounds.leftPt);assert.ok(clipLeft<original.bounds.rightPt);}
   if(item.shape==='curve'){assert.ok(original.path.some(p=>p.command==='curve'));assert.ok(original.bounds.leftPt>drawing.bounds.leftPt);assert.ok(original.bounds.topPt>drawing.bounds.topPt);}
   assert.equal(drawing.bounds.leftPt,Math.min(...original.path.flatMap(p=>p.values.filter((_,i)=>i%2===0))));assert.equal(drawing.bounds.topPt,Math.min(...original.path.flatMap(p=>p.values.filter((_,i)=>i%2===1))));assert.deepEqual(drawing.gap,{beforeLine:0,afterLine:1});
   const zip=await JSZip.loadAsync(Buffer.from(result.docxBase64,'base64'));assert.equal(sha(await zip.file('word/fts-pdf-drawings.xml').async('nodebuffer')),data.privatePartSha256);
   const expected=data.media[0],expectedBytes=Buffer.from(expected.bytesBase64,'base64'),pixel=pixels.rows.find(p=>p.name===item.name);assert.deepEqual(expectedBytes,await readFile(new URL(item.name+'.native.png',fixtureRoot)));assert.equal(sha(expectedBytes),pixel.nativePngSha256);
   assert.equal(result.media.length,1);assert.equal(result.images.length,1);assert.deepEqual(await zip.file(expected.resourceName).async('nodebuffer'),expectedBytes);
   for(const image of [...result.media,...result.images]){const bytes=Buffer.from(image.bytesBase64,'base64');assert.deepEqual(bytes,expectedBytes);assert.equal(image.sha256,expected.sha256);assert.deepEqual(image.decoded,expected.decoded);assert.deepEqual(rgbaHash(bytes),{width:expected.decoded.width,height:expected.decoded.height,sha256:pixel.nativeRgbaSha256});}
   assert.equal(result.images[0].asset.id,expected.sha256);assert.equal(result.pdfDerivedImages[0].sha256,expected.sha256);assert.deepEqual(result.preview.pdfDerivedImages,result.pdfDerivedImages);
   assert.equal(pixel.mismatchedUniformSamples,0);assert.ok(pixel.paintedSamples>20);assert.ok(pixel.transparentSamples>20);if(item.relation==='crossing')assert.ok(pixel.clipMaskedSamples>20);else assert.equal(pixel.clipMaskedSamples,0);
   assert.equal(result.model.stats.tables,0);assert.equal(result.model.stats.images,1);assert.equal(result.model.stats.editableTextCharacters,11);assert.deepEqual(result.model.warnings.filter(w=>w.blocking),[]);
   assert.equal(result.model.blocks.length,3);assert.match(result.model.blocks[0].html,/>Before</);assert.match(result.model.blocks[1].html,/class="c2sPicture"/);assert.match(result.model.blocks[2].html,/>After</);assert.equal(result.preview.drawingFlow[0].figures[0].docPrId,drawing.docPrId);assert.deepEqual(result.preview.drawingFlow[0].cellFigures,[]);
   assert.deepEqual(result.preview.textCoverage,{sourceCharacters:11,modelCharacters:11,missingCharacters:0,extraCharacters:0,physicalSequenceMatches:true});assert.equal(result.preview.imageViewports,undefined);
   const expectedNode=sdkPicture(data.document),actualNode=sdkPicture(result.officeDocument),geometry=result.preview.drawings[0].geometry;assert.deepEqual(actualNode.graphic.blipFill.srcRect,{l:0,t:0,r:100,b:100});assert.deepEqual(actualNode.extent,expectedNode.extent);assert.deepEqual(actualNode.graphic.spPr.xfrm.ext,expectedNode.graphic.spPr.xfrm.ext);assert.equal(geometry.width,expectedNode.extent.cx/9525);assert.equal(geometry.height,expectedNode.extent.cy/9525);
   assert.ok(result.sdkMessages.some(m=>m.type==='ready'));assert.ok(result.sdkMessages.every(m=>m.origin==='null'));assert.equal(result.remainingFrames,0);assert.equal(page.workers().length,0);
  }
  assert.deepEqual(proof.external,[]);assert.deepEqual(proof.pageErrors,[]);assert.deepEqual(proof.consoleErrors,[]);assert.deepEqual(proof.failedRequests,[]);assert.equal(proof.workers.length,16);assert.ok(proof.workers.every(w=>w.closed));assert.deepEqual(await inventory(extension),runtime);proof.passed=true;
 }finally{proof.cleanup={remainingFrames:page?await page.locator('iframe').count():null,remainingWorkers:page?.workers().length,runtimeUnchanged:JSON.stringify(await inventory(extension))===JSON.stringify(runtime)};await context.close();proof.cleanup.contextClosed=true;await writeFile(path.join(run,'results.json'),JSON.stringify(proof,null,2));}
});

test('newly eligible crossing source retains canonical resource, complete PNG decode, dimension and byte-budget guards',{timeout:30000},async()=>{
 const data=JSON.parse(await readFile(new URL('alpha-crossing-mode0.json',fixtureRoot),'utf8')),xml=await readFile(new URL('alpha-crossing-mode0.drawings.xml',fixtureRoot),'utf8');
 const bundled=await build({stdin:{contents:"import{verifyPdfDrawingResources}from'./src/engine/pdf-drawing-resources.js';import{readPdfDrawings}from'./src/engine/pdf-drawings.js';window.RectResources={verifyPdfDrawingResources,readPdfDrawings};",resolveDir:product},bundle:true,format:'esm',write:false,platform:'browser'});
 const browser=await chromium.launch({headless:true,executablePath:await chromiumExecutable()});
 try{
  const page=await browser.newPage(),external=[];await page.route('**/*',route=>{if(route.request().url()==='http://localhost/rect-resources')return route.fulfill({contentType:'text/html',body:'<!doctype html>'});external.push(route.request().url());return route.abort();});await page.goto('http://localhost/rect-resources');await page.addScriptTag({type:'module',content:bundled.outputFiles[0].text});await page.waitForFunction(()=>window.RectResources);
  const result=await page.evaluate(async({data,xml})=>{
   const ledger=RectResources.readPdfDrawings(new TextEncoder().encode(xml),data.options,DOMParser),resource=data.media[0],bytes=Uint8Array.from(atob(resource.bytesBase64),c=>c.charCodeAt(0)),name=resource.resourceName,verify=(v=ledger,m={[name]:bytes},o)=>RectResources.verifyPdfDrawingResources(v,m,o);
   const good=await verify(),failures=[];const bad=async(mode,v=ledger,m={[name]:bytes})=>{try{await verify(v,m);failures.push({mode,accepted:true});}catch(e){failures.push({mode,code:e.code});}};
   await bad('missing',ledger,{});await bad('wrong-directory',ledger,{['wrong/'+name]:bytes});await bad('basename-alias',ledger,{[name]:bytes,'elsewhere/image1.png':bytes});await bad('truncated-header',ledger,{[name]:bytes.slice(0,24)});await bad('complete-header-no-IDAT',ledger,{[name]:bytes.slice(0,33)});
   for(const [mode,mutate]of [['width',r=>r.pixelWidth--],['height',r=>r.pixelHeight--],['noncanonical-name',r=>r.resourceName='word/media/../image1.png'],['dimension-cap',r=>r.pixelWidth=4097],['pixel-budget',r=>{r.pixelWidth=4096;r.pixelHeight=4096;}],['dpi',r=>r.dpi=191]]){const v=structuredClone(ledger);mutate(v.pages[0].drawings[0].representation);await bad(mode,v);}
   const forged=bytes.slice(),wrong=structuredClone(ledger),width=wrong.pages[0].drawings[0].representation.pixelWidth-1;wrong.pages[0].drawings[0].representation.pixelWidth=width;new DataView(forged.buffer).setUint32(16,width);await bad('forged-header-decoder-mismatch',wrong,{[name]:forged});
   const big=new Uint8Array(32*1024*1024+1);big.set(bytes);await bad('derived-byte-budget',ledger,{[name]:big});
   const duplicate=structuredClone(ledger);duplicate.pages[0].drawings.push(structuredClone(duplicate.pages[0].drawings[0]));duplicate.pages[0].drawings[1].representation.pixelWidth--;await bad('conflicting-shared-resource',duplicate);
   const controller=new AbortController();controller.abort();let aborted=false;try{await verify(ledger,{[name]:bytes},{signal:controller.signal});}catch(e){aborted=e.name==='AbortError';}
   const late=new AbortController(),decode=createImageBitmap;let closed=0,lateAborted=false;globalThis.createImageBitmap=async(...args)=>{const bitmap=await decode(...args),close=bitmap.close.bind(bitmap);bitmap.close=()=>{closed++;close();};late.abort();return bitmap;};try{await verify(ledger,{[name]:bytes},{signal:late.signal});}catch(e){lateAborted=e.name==='AbortError';}finally{globalThis.createImageBitmap=decode;}
   return {good,failures,aborted,lateAborted,closed};
  },{data,xml});
  assert.equal(result.good[0].sha256,data.media[0].sha256);assert.equal(result.failures.length,14);for(const row of result.failures)assert.equal(row.code,'PDF_DRAWINGS_UNVERIFIED',row.mode);assert.equal(result.aborted,true);assert.equal(result.lateAborted,true);assert.equal(result.closed,1);assert.deepEqual(external,[]);
 }finally{await browser.close();}
});

test('newly eligible real crossing clip still refuses missing truncated and replaced PNGs before SDK initialization',{timeout:30000},async()=>{
 const fixture=JSON.parse(await readFile(new URL('./fixtures/pdf-drawings/noncell-rect-clip/alpha-crossing-mode0.json',import.meta.url),'utf8'));
 const xml=await readFile(new URL('./fixtures/pdf-drawings/noncell-rect-clip/alpha-crossing-mode0.drawings.xml',import.meta.url),'utf8');
 // Parent transport requires the original CRC-valid ZIP media, even though
 // this inert harness does not perform native conversion or load the SDK.
 const zip=new JSZip();zip.file(fixture.media[0].resourceName,Buffer.from(fixture.media[0].bytesBase64,'base64'));const docxBase64=await zip.generateAsync({type:'base64'});
 const zipScript=await readFile(new URL('../vendor/jszip.min.js',import.meta.url),'utf8');
 const bundle=await build({stdin:{contents:"import{convertDocument}from'./src/engine/index.js';import{readPdfDrawings}from'./src/engine/pdf-drawings.js';window.convertOffice=convertDocument;window.readDrawingSources=readPdfDrawings;",resolveDir:fileURLToPath(new URL('..',import.meta.url)),sourcefile:'pdf-derived-transport.js'},bundle:true,write:false,format:'esm',platform:'browser'});
 const browser=await chromium.launch({headless:true,executablePath:await chromiumExecutable()});
 try{
  const page=await browser.newPage(),network=[];
  await page.route('**/*',route=>{if(route.request().url()==='https://pdf-derived-guard.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'});if(route.request().url()==='https://pdf-derived-guard.test/vendor/jszip.min.js')return route.fulfill({contentType:'text/javascript',body:zipScript});network.push(route.request().url());return route.abort();});
  await page.goto('https://pdf-derived-guard.test/');await page.addScriptTag({type:'module',content:bundle.outputFiles[0].text});await page.waitForFunction(()=>typeof window.convertOffice==='function');
  const rows=await page.evaluate(async({fixture,xml,docxBase64})=>{
   // Initialize JSZip's browser scheduler before the inert SDK message shim.
   await import('https://pdf-derived-guard.test/vendor/jszip.min.js');
   const encode=value=>new TextEncoder().encode(value),decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
   const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),n=>n.toString(16).padStart(2,'0')).join('');
   const nativeDrawings=readDrawingSources(encode(xml),fixture.options,DOMParser),original=fixture.media[0];
   const canvas=document.createElement('canvas');canvas.width=original.decoded.width;canvas.height=original.decoded.height;const ctx=canvas.getContext('2d');ctx.fillStyle='magenta';ctx.fillRect(0,0,canvas.width,canvas.height);
   const changed=new Uint8Array(await (await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))).arrayBuffer());canvas.width=canvas.height=1;
   const rows=[];
   for(const mode of ['valid','missing','truncated','native-replacement']){
    const saved={Worker:window.Worker,create:document.createElement,append:document.body.append,add:window.addEventListener,remove:window.removeEventListener},listeners=new Map(),controller=new AbortController(),observed={mode,frames:0,removed:0,terminated:0};
    const docxBytes=decode(docxBase64),media=mode==='missing'?{}:{[original.resourceName]:mode==='truncated'?decode(original.bytesBase64).subarray(0,33):decode(original.bytesBase64)};
    const result={docxBytes,officeBin:encode('DOCY'),media,warnings:[],pdfForms:{pages:fixture.options.pages},pdfText:fixture.options.pdfText,pdfLayout:{version:1,textAssociationType:2,flowGeometry:'native-plain-line-v1',nativeTables:fixture.options.nativeTables,nativeDrawings}};
    if(mode==='native-replacement')result.nativeMedia={version:1,sourceDocxHash:await hash(docxBytes),files:[{name:original.resourceName,bytes:changed,sha256:await hash(changed)}]};
    window.Worker=class{terminate(){observed.terminated++;}postMessage(){queueMicrotask(()=>this.onmessage({data:{result}}));}};
    window.addEventListener=function(type,receive,...args){if(type==='message')listeners.set(type,receive);else return saved.add.call(this,type,receive,...args);};
    window.removeEventListener=function(type,receive,...args){if(type==='message')listeners.delete(type);else return saved.remove.call(this,type,receive,...args);};
    document.createElement=function(tag,...args){if(tag!=='iframe')return saved.create.call(this,tag,...args);observed.frames++;return{qaFrame:true,style:{},setAttribute(){},remove(){observed.removed++;},contentWindow:{postMessage(){queueMicrotask(()=>controller.abort());}}};};
    document.body.append=function(frame,...rest){if(!frame?.qaFrame)return saved.append.call(this,frame,...rest);queueMicrotask(()=>listeners.get('message')?.({source:frame.contentWindow,data:{channel:'fts-office-model',nonce:new URL(frame.src).hash.slice(1),type:'ready'}}));};
    try{await convertOffice({name:'source.pdf',bytes:encode('%PDF-1.7 synthetic transport')},{signal:controller.signal,timeoutMs:2000});observed.accepted=true;}catch(error){observed.code=error.code;observed.errorName=error.name;observed.message=error.message;}
    finally{controller.abort();window.Worker=saved.Worker;document.createElement=saved.create;document.body.append=saved.append;window.addEventListener=saved.add;window.removeEventListener=saved.remove;}
    observed.listeners=listeners.size;rows.push(observed);
   }
   return rows;
  },{fixture,xml,docxBase64});
  assert.equal(rows[0].errorName,'AbortError',JSON.stringify({rows,network}));assert.equal(rows[0].frames,1);assert.equal(rows[0].removed,1);
  for(const row of rows.slice(1)){assert.equal(row.code,'PDF_DRAWINGS_UNVERIFIED',row.mode);assert.equal(row.frames,0,row.mode);assert.ok(row.terminated>0);}
  assert.ok(rows.every(row=>row.listeners===0));assert.deepEqual(network,[]);
 }finally{await browser.close();}
});
