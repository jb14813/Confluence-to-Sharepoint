import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {access,mkdir,mkdtemp,readdir,readFile,writeFile,cp} from 'node:fs/promises';
import {chromium} from 'playwright';
import JSZip from 'jszip';
import {fixtures} from './engine-fixtures.mjs';

const product=fileURLToPath(new URL('..',import.meta.url));
const workspace=path.resolve(product,'../..');
const artifacts=path.join(workspace,'.artifacts/onlyoffice-eval');
const exists=async p=>{try{await access(p);return true}catch{return false}};
async function browserPath(){
 for(const p of [process.env.EXTENSION_CHROME_PATH,process.env.CHROME_PATH,chromium.executablePath()])if(p&&await exists(p))return p;
 const cache=process.env.PLAYWRIGHT_BROWSERS_PATH||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.cache'),'ms-playwright');
 const revisions=(await readdir(cache).catch(()=>[])).filter(n=>/^chromium-\d+$/.test(n)).sort((a,b)=>Number(b.slice(9))-Number(a.slice(9)));
 for(const r of revisions)for(const layout of ['chrome-win64/chrome.exe','chrome-win/chrome.exe','chrome-linux/chrome','chrome-linux64/chrome']){const p=path.join(cache,r,layout);if(await exists(p))return p}
 throw new Error('Set EXTENSION_CHROME_PATH to an extension-capable Chromium executable.');
}

test('real engine adapter converts locally in strict MV3 and rejects unsafe/failed inputs',{timeout:180000},async t=>{
 await mkdir(artifacts,{recursive:true});
 const dir=await mkdtemp(path.join(artifacts,'adapter-test-')),ext=path.join(dir,'extension');await mkdir(ext);
 if(await exists(path.join(product,'src/engine')))await cp(path.join(product,'src/engine'),path.join(ext,'src/engine'),{recursive:true});
 if(await exists(path.join(product,'vendor')))await cp(path.join(product,'vendor'),path.join(ext,'vendor'),{recursive:true});
 const workerFile=path.join(ext,'src/engine/worker.js');
 if(await exists(workerFile))await writeFile(workerFile,`// Test-only worker request observation; shipped adapter is unchanged.\nconst observedRequests=[];const originalFetch=self.fetch.bind(self);self.fetch=(input,options)=>{observedRequests.push(String(input?.url||input));return originalFetch(input,options)};const originalScripts=self.importScripts.bind(self);self.importScripts=(...urls)=>{observedRequests.push(...urls.map(String));return originalScripts(...urls)};const originalPost=self.postMessage.bind(self);self.postMessage=(data,transfer)=>{if(data.result)data.result.engineRequests=observedRequests;return originalPost(data,transfer)};\n`+await readFile(workerFile,'utf8'));
 await writeFile(path.join(ext,'manifest.json'),JSON.stringify({manifest_version:3,name:'Engine adapter test',version:'1.0.0',background:{service_worker:'background.js'},sandbox:{pages:['src/engine/sandbox.html']},content_security_policy:{extension_pages:"script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",sandbox:"sandbox allow-scripts; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; object-src 'none'; connect-src 'self'"}}));
 await writeFile(path.join(ext,'background.js'),'void 0;');
 await writeFile(path.join(ext,'index.html'),'<html><body><script type="module" src="test.js"></script></body></html>');
 await writeFile(path.join(ext,'test.js'),"try { window.engine = await import('./src/engine/index.js'); window.ready = {ok:true}; } catch(e) {window.ready={ok:false,error:String(e)}}");
 const context=await chromium.launchPersistentContext(path.join(dir,'profile'),{headless:true,executablePath:await browserPath(),ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,'--disable-background-networking','--disable-component-update','--no-first-run']});
 const events=[],requests=[];context.on('request',r=>requests.push(r.url()));
 await context.route(/^https?:/,route=>route.abort('blockedbyclient'));
 try{
  let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker');
  const page=await context.newPage();page.on('pageerror',e=>events.push(String(e)));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('ERR_ABORTED'))events.push(message.text())});
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);await page.waitForFunction(()=>window.ready);
  const ready=await page.evaluate(()=>window.ready);assert.equal(ready.ok,true,ready.error);
  const invoke=async(name,base64,options={})=>page.evaluate(async({name,base64,options})=>{
   const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
   try{const result=await window.engine.convertDocument({name,bytes},options);return {...result,docxBytes:Array.from(result.docxBytes),media:Object.fromEntries(Object.entries(result.media||{}).map(([name,bytes])=>[name,Array.from(bytes)])),decorations:Object.fromEntries(Object.entries(result.decorations||{}).map(([id,value])=>[id,{...value,bytes:Array.from(value.bytes)}]))}}catch(e){return {error:e.message,code:e.code,name:e.name}}
  },{name,base64,options});
  for(const name of ['sample.docx','sample-rich.docx','sample.doc','sample.odt','sample.rtf','sample.txt','sample.pdf'])await t.test(name,async()=>{
   const result=await invoke(name,fixtures[name]);assert.equal(result.error,undefined,JSON.stringify(result));
   assert.ok(result.engineRequests.length);assert.ok(result.engineRequests.every(u=>u.startsWith('chrome-extension://')&&u.includes('/vendor/')),JSON.stringify(result.engineRequests));
   assert.equal(result.officeDocument?.type,'document');assert.ok(Array.isArray(result.officeDocument.content));
   const model=JSON.stringify(result.officeDocument);
   if(name==='sample-rich.docx'){
    assert.ok(model.includes('Crème brûlée'));
    for(const text of ['Left editable cell','Right editable cell','Second row','Last cell'])assert.ok(model.includes(text));
    assert.match(model,/"type":"table"/);assert.match(model,/"type":"image"/);assert.ok(Object.keys(result.media).some(n=>n.endsWith('image1.png')));
   }
   const zip=await JSZip.loadAsync(Uint8Array.from(result.docxBytes));const xml=await zip.file('word/document.xml').async('string');assert.match(xml,name.endsWith('.doc')?/This is a simple file/:/editable|Editable/);
   for(const [name,bytes] of Object.entries(result.media))assert.deepEqual(Buffer.from(bytes),await zip.file(name).async('nodebuffer'),'Media bytes must match the source document');
   if(name.endsWith('.txt'))assert.match(xml,/Crème brûlée, élève/);
   if(name.endsWith('.pdf')){
    for(const text of ['Left cell','Right cell','Name:','Alice','Approved:','Department:','Engineering'])assert.ok(model.includes(text),`Missing textbox: ${text}`);
    assert.match(model,/"drawingType":"anchor"/);assert.match(model,/"positionH"/);assert.match(model,/"custGeom"/);assert.ok(Object.keys(result.media).some(n=>n.endsWith('.jpg')));
    const shapes=[],drawings=[];const walk=value=>{if(!value||typeof value!=='object')return;if(value.type==='shape')shapes.push(value);if(value.type==='paraDrawing')drawings.push(value);for(const child of Object.values(value))walk(child)};walk(result.officeDocument);
    const nontext=shapes.filter(shape=>!shape.content);assert.equal(nontext.length,9);
    assert.deepEqual(Object.keys(result.decorations).sort(),nontext.map(shape=>shape.id).sort());
    for(const shape of shapes.filter(shape=>shape.content))assert.equal(result.decorations[shape.id],undefined,'Editable textbox must never become a decoration');
    for(const value of Object.values(result.decorations)){
     assert.equal(value.mime,'image/png');assert.deepEqual(value.bytes.slice(0,8),[137,80,78,71,13,10,26,10]);assert.ok(value.width>0&&value.height>0);
    }
    const nonempty=await page.evaluate(async values=>{const results=[];for(const value of values){const image=await createImageBitmap(new Blob([new Uint8Array(value.bytes)],{type:value.mime})),canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const rgba=ctx.getImageData(0,0,image.width,image.height).data;let visible=false;for(let i=3;i<rgba.length;i+=4)if(rgba[i]){visible=true;break}results.push(visible);image.close()}return results;},Object.values(result.decorations));
    assert.ok(nonempty.every(Boolean),'Every exported table line, box and control outline must contain visible pixels');
    const table=drawings.find(d=>d.extent?.cx===5207000&&d.extent?.cy===762000),tablePng=result.decorations[table.graphic.id];
    const pixels=await page.evaluate(async value=>{const image=await createImageBitmap(new Blob([new Uint8Array(value.bytes)],{type:value.mime}));const canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,image.width,image.height).data;let opaque=0;for(let i=3;i<data.length;i+=4)if(data[i])opaque++;return {width:image.width,height:image.height,opaque,pixels:image.width*image.height};},tablePng);
    assert.equal(pixels.width,tablePng.width);assert.equal(pixels.height,tablePng.height);assert.ok(pixels.opaque>100&&pixels.opaque<pixels.pixels/2,'Native table-line raster must retain lines and transparent interior');
    assert.match(xml,/txbxContent/);assert.ok(Object.keys(zip.files).some(n=>n.startsWith('word/media/')));
    const {Fields,Parents,pages}=result.pdfForms;assert.equal(pages.length,1);
    assert.equal(Fields.find(f=>f.name==='person_name').value,'Alice');assert.ok(Fields.every(f=>f.rect&&Number.isInteger(f.page)));
    assert.equal(Fields.find(f=>f.name==='approved').ExportValue,'Yes');
    assert.deepEqual(Fields.find(f=>f.name==='department').opt,[['Engineering','eng'],['Operations','ops']]);
    const parent=Parents.find(p=>p.name==='shift');assert.deepEqual(Fields.filter(f=>f.Parent===parent.i).map(f=>f.ExportValue),['day','night']);
    assert.ok(result.warnings.some(w=>w.code==='PDF_RECONSTRUCTION_REVIEW'));
   }else assert.equal(result.pdfForms,null);
  });
  await t.test('rejects unsupported, corrupt and spoofed documents',async()=>{
   for(const [name,data] of [['bad.exe',fixtures['sample.txt']],['../bad.pdf',fixtures['sample.pdf']],['bad.docx',fixtures['sample.txt']],['bad.pdf',fixtures['sample.txt']],['bad.odt',fixtures['sample.txt']]]){
    const result=await invoke(name,data);assert.ok(result.error,`${name} must fail`);assert.equal(result.docxBytes,undefined);
   }
   const z=new JSZip();z.file('unrelated.txt','hello');const result=await invoke('fake.docx',await z.generateAsync({type:'base64'}));assert.ok(result.error);
   const spoof=await JSZip.loadAsync(Buffer.from(fixtures['sample.docx'],'base64'));spoof.file('word/document.xml','not XML: document http://schemas.openxmlformats.org/wordprocessingml/2006/main');
   assert.ok((await invoke('spoof.docx',await spoof.generateAsync({type:'base64'}))).error,'Malformed main XML must fail');
  });
  await t.test('rejects encrypted, truncated and oversized input without success',async()=>{
   assert.equal((await invoke('encrypted.pdf',fixtures['encrypted.pdf'])).code,'ENCRYPTED_DOCUMENT');
   for(const name of ['sample.pdf','sample.docx','sample.doc','sample.odt']){
    const result=await invoke(name,Buffer.from(fixtures[name],'base64').subarray(0,60).toString('base64'));assert.ok(result.error,`Truncated ${name} must fail`);
   }
   const result=await page.evaluate(async()=>{try{await window.engine.convertDocument({name:'large.txt',bytes:new Uint8Array(window.engine.MAX_DOCUMENT_BYTES+1)});return 'success'}catch(e){return e.code}});
   assert.equal(result,'DOCUMENT_TOO_LARGE');
  });
  await t.test('abort and timeout terminate work, allowing the next conversion',async()=>{
   const result=await page.evaluate(async base64=>{
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),controller=new AbortController();
    const promise=window.engine.convertDocument({name:'cancel.pdf',bytes},{signal:controller.signal});controller.abort();
    try{await promise;return 'unexpected success'}catch(e){return e.name}
   },fixtures['sample.pdf']);assert.equal(result,'AbortError');
   assert.equal((await invoke('timeout.pdf',fixtures['sample.pdf'],{timeoutMs:1})).code,'ENGINE_TIMEOUT');
   assert.equal((await invoke('retry.docx',fixtures['sample.docx'])).error,undefined);
  });
  await t.test('sandbox has no extension API; abort disposes it and forged messages are ignored',async()=>{
   const state=await page.evaluate(async base64=>{
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),controller=new AbortController();
    const result=window.engine.convertDocument({name:'sandbox.pdf',bytes},{signal:controller.signal}).then(()=>({success:true}),e=>({name:e.name}));
    while(!document.querySelector('iframe'))await new Promise(r=>setTimeout(r,1));
    const frame=document.querySelector('iframe'),nonce=new URL(frame.src).hash.slice(1);
    window.postMessage({channel:'fts-office-model',nonce,type:'result',json:'{"type":"document","content":[]}'},'*');
    controller.abort();return {result:await result,frames:document.querySelectorAll('iframe').length};
   },fixtures['sample.pdf']);assert.equal(state.result.name,'AbortError');assert.equal(state.frames,0);
   // Hold an independent real sandbox frame open to inspect its privileges;
   // a successful conversion deliberately disposes its frame immediately.
   await page.evaluate(()=>{const frame=document.createElement('iframe');frame.src=new URL('./src/engine/sandbox.html',location.href).href+'#'+crypto.randomUUID();document.body.append(frame);});
   await page.waitForSelector('iframe',{state:'attached'});
   const frame=await (await page.$('iframe')).contentFrame();
   await frame.waitForURL(/sandbox\.html/);
   assert.equal(await frame.evaluate(()=>Boolean(globalThis.chrome?.runtime)),false);
   await page.evaluate(base64=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));window.pendingConversion=window.engine.convertDocument({name:'isolation.docx',bytes});},fixtures['sample.docx']);
   await frame.evaluate(()=>parent.postMessage({channel:'fts-office-model',nonce:'wrong',type:'error',message:'forged'},'*'));
   const result=await page.evaluate(async()=>{const result=await window.pendingConversion;document.querySelector('iframe').remove();return {type:result.officeDocument.type,frames:document.querySelectorAll('iframe').length}});
   assert.equal(result.type,'document');assert.equal(result.frames,0);
  });
  assert.deepEqual(requests.filter(u=>/^https?:/.test(u)),[]);assert.deepEqual(events,[]);
 }finally{await writeFile(path.join(dir,'evidence.json'),JSON.stringify({events,requests},null,2));await context.close()}
});
