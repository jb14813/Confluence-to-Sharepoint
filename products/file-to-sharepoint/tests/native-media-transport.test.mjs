import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {chromiumExecutable} from './chromium.mjs';

test('new native SVG outputs pass the static resource guard before any SDK frame is created',{timeout:30000},async()=>{
  const bundle=await build({stdin:{contents:"import{convertDocument}from'./src/engine/index.js';window.convertOffice=convertDocument;",resolveDir:fileURLToPath(new URL('..',import.meta.url)),sourcefile:'native-media-transport.js'},bundle:true,write:false,format:'esm',platform:'browser'});
  const browser=await chromium.launch({headless:true,executablePath:await chromiumExecutable()});
  try{
    const page=await browser.newPage(),network=[];
    await page.route('**/*',route=>{if(route.request().url()==='https://native-media-guard.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'});network.push(route.request().url());return route.abort();});
    await page.goto('https://native-media-guard.test/');await page.addScriptTag({type:'module',content:bundle.outputFiles[0].text});await page.waitForFunction(()=>typeof window.convertOffice==='function');
    const rows=await page.evaluate(async()=>{
      const encode=value=>new TextEncoder().encode(value),hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
      const wrap=body=>'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10">'+body+'</svg>',valid=wrap('<rect width="20" height="10" fill="red"/>'),script=wrap('<script>window.executed=true</script>');
      const cases=[['script.svg',script,{}],['wrong.png',script,{}],['external.svg',wrap('<image href="https://never-fetch.invalid/a.png"/>'),{}],['original.svg',valid,{'word/media/original.svg':encode(script)}],['valid.svg',valid,{}]],rows=[];
      for(const[name,source,media]of cases){
        const saved={Worker:window.Worker,create:document.createElement,append:document.body.append,add:window.addEventListener,remove:window.removeEventListener},controller=new AbortController(),listeners=new Map(),observed={name,frames:0,removed:0,terminated:0};
        const docxBytes=encode('DOCX'),bytes=encode(source),result={docxBytes,officeBin:encode('DOCY'),media,warnings:[],nativeMedia:{version:1,sourceDocxHash:await hash(docxBytes),files:[{name:'word/media/'+name,bytes,sha256:await hash(bytes)}]}};
        window.Worker=class{terminate(){observed.terminated++;}postMessage(){queueMicrotask(()=>this.onmessage({data:{result}}));}};
        window.addEventListener=function(type,receive,...args){if(type==='message')listeners.set(type,receive);else return saved.add.call(this,type,receive,...args);};
        window.removeEventListener=function(type,receive,...args){if(type==='message')listeners.delete(type);else return saved.remove.call(this,type,receive,...args);};
        document.createElement=function(tag,...args){if(tag!=='iframe')return saved.create.call(this,tag,...args);observed.frames++;return{qaFrame:true,style:{},setAttribute(){},remove(){observed.removed++;},contentWindow:{postMessage(){queueMicrotask(()=>controller.abort());}}};};
        document.body.append=function(frame,...rest){if(!frame?.qaFrame)return saved.append.call(this,frame,...rest);queueMicrotask(()=>listeners.get('message')?.({source:frame.contentWindow,data:{channel:'fts-office-model',nonce:new URL(frame.src).hash.slice(1),type:'ready'}}));};
        try{await convertOffice({name:'source.docx',bytes:encode('source')},{signal:controller.signal,timeoutMs:1000});observed.accepted=true;}catch(error){observed.code=error.code;observed.errorName=error.name;}
        finally{controller.abort();window.Worker=saved.Worker;document.createElement=saved.create;document.body.append=saved.append;window.addEventListener=saved.add;window.removeEventListener=saved.remove;}
        observed.listeners=listeners.size;rows.push(observed);
      }
      return rows;
    });
    for(const row of rows.slice(0,4)){assert.equal(row.code,'HTML_RESOURCE_BLOCKED',row.name);assert.equal(row.frames,0,row.name);assert.ok(row.terminated>0);assert.equal(row.listeners,0);}
    assert.equal(rows[4].errorName,'AbortError');assert.equal(rows[4].frames,1);assert.equal(rows[4].removed,1);assert.equal(rows[4].listeners,0);assert.equal(await page.evaluate(()=>window.executed),undefined);assert.deepEqual(network,[]);
  }finally{await browser.close();}
});
