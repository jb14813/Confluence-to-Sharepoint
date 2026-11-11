import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {chromiumExecutable} from './chromium.mjs';

test('parent verifies original derived PDF PNGs and refuses native replacements before SDK initialization',{timeout:30000},async()=>{
 const fixture=JSON.parse(await readFile(new URL('./fixtures/pdf-drawings/native056-v2/alpha-gap.json',import.meta.url),'utf8'));
 const xml=await readFile(new URL('./fixtures/pdf-drawings/native056-v2/alpha-gap.drawings.xml',import.meta.url),'utf8');
 const bundle=await build({stdin:{contents:"import{convertDocument}from'./src/engine/index.js';import{readPdfDrawings}from'./src/engine/pdf-drawings.js';window.convertOffice=convertDocument;window.readDrawingSources=readPdfDrawings;",resolveDir:fileURLToPath(new URL('..',import.meta.url)),sourcefile:'pdf-derived-transport.js'},bundle:true,write:false,format:'esm',platform:'browser'});
 const browser=await chromium.launch({headless:true,executablePath:await chromiumExecutable()});
 try{
  const page=await browser.newPage(),network=[];
  await page.route('**/*',route=>{if(route.request().url()==='https://pdf-derived-guard.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'});network.push(route.request().url());return route.abort();});
  await page.goto('https://pdf-derived-guard.test/');await page.addScriptTag({content:await readFile(new URL('../vendor/jszip.min.js',import.meta.url),'utf8')});await page.addScriptTag({type:'module',content:bundle.outputFiles[0].text});await page.waitForFunction(()=>typeof window.convertOffice==='function');
  const rows=await page.evaluate(async({fixture,xml})=>{
   const encode=value=>new TextEncoder().encode(value),decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
   const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),n=>n.toString(16).padStart(2,'0')).join('');
   const nativeDrawings=readDrawingSources(encode(xml),fixture.options,DOMParser),original=fixture.media[0];
   const canvas=document.createElement('canvas');canvas.width=original.width;canvas.height=original.height;const ctx=canvas.getContext('2d');ctx.fillStyle='magenta';ctx.fillRect(0,0,canvas.width,canvas.height);
   const changed=new Uint8Array(await (await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))).arrayBuffer());canvas.width=canvas.height=1;
   const zip=new JSZip();zip.file(original.resourceName,decode(original.bytesBase64));zip.file('word/document.xml','<document/>');const sourceDocx=await zip.generateAsync({type:'uint8array'});
   const rows=[];
   for(const mode of ['valid','missing','truncated','native-replacement']){
    const saved={Worker:window.Worker,create:document.createElement,append:document.body.append,add:window.addEventListener,remove:window.removeEventListener},listeners=new Map(),controller=new AbortController(),observed={mode,frames:0,removed:0,terminated:0};
    const docxBytes=sourceDocx,media=mode==='missing'?{}:{[original.resourceName]:mode==='truncated'?decode(original.bytesBase64).subarray(0,33):decode(original.bytesBase64)};
    const result={docxBytes,officeBin:encode('DOCY'),media,warnings:[],pdfForms:{pages:fixture.options.pages},pdfText:fixture.options.pdfText,pdfLayout:{version:1,textAssociationType:2,flowGeometry:'native-plain-line-v1',nativeTables:fixture.options.nativeTables,nativeDrawings}};
    if(mode==='native-replacement')result.nativeMedia={version:1,sourceDocxHash:await hash(docxBytes),files:[{name:original.resourceName,bytes:changed,sha256:await hash(changed)}]};
    window.Worker=class{terminate(){observed.terminated++;}postMessage(){queueMicrotask(()=>this.onmessage({data:{result}}));}};
    window.addEventListener=function(type,receive,...args){if(type==='message')listeners.set(type,receive);else return saved.add.call(this,type,receive,...args);};
    window.removeEventListener=function(type,receive,...args){if(type==='message')listeners.delete(type);else return saved.remove.call(this,type,receive,...args);};
    document.createElement=function(tag,...args){if(tag!=='iframe')return saved.create.call(this,tag,...args);observed.frames++;return{qaFrame:true,style:{},setAttribute(){},remove(){observed.removed++;},contentWindow:{postMessage(){queueMicrotask(()=>controller.abort());}}};};
    document.body.append=function(frame,...rest){if(!frame?.qaFrame)return saved.append.call(this,frame,...rest);queueMicrotask(()=>listeners.get('message')?.({source:frame.contentWindow,data:{channel:'fts-office-model',nonce:new URL(frame.src).hash.slice(1),type:'ready'}}));};
    try{await convertOffice({name:'source.pdf',bytes:encode('%PDF-1.7 synthetic transport')},{signal:controller.signal,timeoutMs:2000});observed.accepted=true;}catch(error){observed.code=error.code;observed.errorName=error.name;}
    finally{controller.abort();window.Worker=saved.Worker;document.createElement=saved.create;document.body.append=saved.append;window.addEventListener=saved.add;window.removeEventListener=saved.remove;}
    observed.listeners=listeners.size;rows.push(observed);
   }
   return rows;
  },{fixture,xml});
  assert.equal(rows[0].errorName,'AbortError');assert.equal(rows[0].frames,1);assert.equal(rows[0].removed,1);
  for(const row of rows.slice(1)){assert.equal(row.code,'PDF_DRAWINGS_UNVERIFIED',row.mode);assert.equal(row.frames,0,row.mode);assert.ok(row.terminated>0);}
  assert.ok(rows.every(row=>row.listeners===0));assert.deepEqual(network,[]);
 }finally{await browser.close();}
});
