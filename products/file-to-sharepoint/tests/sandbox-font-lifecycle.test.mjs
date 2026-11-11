import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {readFile,writeFile,mkdir,mkdtemp,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {chromiumExecutable} from './chromium.mjs';
import {fixtures} from './engine-fixtures.mjs';

const product=fileURLToPath(new URL('..',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

// This observer preserves SDK callbacks and the real font loader. Only the
// server's response to the actual fonts.wasm request is held by the test.
const observer=`window.qa={events:[],polls:new Set()};
const interval=window.setInterval,clear=window.clearInterval;
window.setInterval=function(callback,delay,...args){const id=interval.call(this,callback,delay,...args);if(new Error().stack.includes('/src/engine/sandbox.js'))qa.polls.add(id);return id;};
window.clearInterval=function(id){qa.polls.delete(id);return clear.call(this,id);};
const open=Asc.asc_docs_api.prototype.asc_nativeOpenFile;
Asc.asc_docs_api.prototype.asc_nativeOpenFile=function(...args){qa.events.push({type:'native-open',fontReady:AscFonts.isEngineReady,at:performance.now()});return open.apply(this,args);};
addEventListener('pagehide',()=>{qa.events.push({type:'pagehide',fontReady:AscFonts.isEngineReady,at:performance.now()});});`;

test('actual SDK font bootstrap bounds sandbox readiness, disposal and caller recovery',{timeout:180000},async t=>{
  const artifacts=path.resolve('.artifacts/sandbox-font-lifecycle');await mkdir(artifacts,{recursive:true});
  const run=await mkdtemp(path.join(artifacts,'run-')),stage=path.join(run,'runtime');
  await cp(path.join(product,'src/engine'),path.join(stage,'src/engine'),{recursive:true});
  await build({entryPoints:[path.join(product,'src/engine/sandbox-svg.js')],outfile:path.join(stage,'src/engine/sandbox-svg.js'),bundle:true,format:'iife',globalName:'FtsSvg',platform:'browser',target:'chrome127'});
  let html=await readFile(path.join(stage,'src/engine/sandbox.html'),'utf8');
  html=html.replace('<script src="/src/engine/sandbox.js">','<script src="/observer.js"></script><script src="/src/engine/sandbox.js">');
  await writeFile(path.join(stage,'src/engine/sandbox.html'),html);
  const vendor=path.resolve(process.env.C2S_ENGINE_VENDOR_DIR||path.join(product,'vendor'));
  const pins=new Map(),rows=[];let hold=null;
  const server=http.createServer(async(req,res)=>{
    try{
      const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if(name==='/')return res.writeHead(200,{'content-type':'text/html'}).end('<!doctype html><title>Font lifecycle regression</title>');
      if(name==='/observer.js')return res.writeHead(200,{'content-type':'text/javascript'}).end(observer);
      const base=name.startsWith('/vendor/')?vendor:stage;
      const relative=name.startsWith('/vendor/')?name.slice(8):name.slice(1),file=path.resolve(base,relative);
      if(!file.startsWith(base+path.sep))return res.writeHead(403).end();
      const bytes=await readFile(file);pins.set(file,sha(bytes));
      if(name.endsWith('/fonts.wasm')&&hold){const waiting=hold;hold=null;waiting.entered();await waiting.released;}
      if(res.destroyed)return;
      res.writeHead(200,{'content-type':{'.js':'text/javascript','.wasm':'application/wasm','.html':'text/html','.json':'application/json'}[path.extname(file)]||'application/octet-stream','cache-control':'no-store'}).end(bytes);
    }catch(error){if(!res.destroyed)res.writeHead(500).end(String(error));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,executablePath:await chromiumExecutable(),args:['--disable-background-networking','--disable-component-update','--no-first-run']});
  const persist=()=>writeFile(path.join(run,'results.json'),JSON.stringify({rows,pins:Object.fromEntries(pins)},null,2));
  async function scenario(name,action){
    const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),failedRequests=[],errors=[],external=[];
    context.on('requestfailed',request=>failedRequests.push({url:request.url(),failure:request.failure()}));
    page.on('pageerror',error=>errors.push(String(error)));
    page.on('request',request=>{if(!request.url().startsWith(origin+'/')&&!/^(?:blob|data):/.test(request.url()))external.push(request.url());});
    let release,entered;const released=new Promise(resolve=>release=resolve),requested=new Promise(resolve=>entered=resolve);
    hold={released,entered};
    const row={name,failedRequests,errors,external};rows.push(row);
    try{
      await page.goto(origin);
      await page.evaluate(async input=>{
        const {convertDocument}=await import('/src/engine/index.js');window.controller=new AbortController();window.events=[];
        addEventListener('message',event=>{if(event.data?.channel==='fts-office-model')events.push({type:event.data.type,fontReady:event.source.AscFonts?.isEngineReady??false,sdkEvents:structuredClone(event.source.qa?.events),polls:event.source.qa?.polls.size,at:performance.now()});});
        window.start=(timeoutMs=30000)=>{window.outcome=null;window.pending=convertDocument({name:'simple.docx',bytes:Uint8Array.from(atob(input),c=>c.charCodeAt(0))},{signal:controller.signal,timeoutMs}).then(result=>window.outcome={ok:true,model:result.officeDocument,warnings:result.warnings},error=>window.outcome={ok:false,name:error.name,code:error.code});};
      },fixtures['sample.docx']);
      await action({page,requested,release,row});
      row.events=await page.evaluate(()=>events);row.outcome=await page.evaluate(()=>outcome);row.remainingFrames=await page.locator('iframe').count();
      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    }finally{
      release();hold=null;await persist();await context.close();await persist();
    }
  }
  async function waiting(page,requested){
    await requested;
    await page.waitForFunction(()=>{const frame=document.querySelector('iframe');return frame?.contentWindow.qa?.polls.size>0;});
    const frame=page.frames().find(frame=>frame.url().includes('/sandbox.html#'));
    assert.equal(await frame.evaluate(()=>AscFonts.isEngineReady),false);
    await page.waitForFunction(()=>events.length>0||(()=>{const api=document.querySelector('iframe')?.contentWindow.Asc?.editor;return api?.isLoadFullApi&&api.WordControl;})());
    return frame;
  }
  try{
    await t.test('held real font WASM sends no ready, open or result until SDK completion',async()=>scenario('release',async({page,requested,release,row})=>{
      await page.evaluate(()=>start());const frame=await waiting(page,requested);
      await page.waitForTimeout(100);
      row.protocolBeforeRelease=await page.evaluate(()=>events);
      assert.deepEqual(row.protocolBeforeRelease,[],'No protocol response may precede real font bootstrap completion');
      row.beforeRelease=await frame.evaluate(()=>({fontReady:AscFonts.isEngineReady,polls:qa.polls.size,events:qa.events}));
      assert.deepEqual(row.beforeRelease.events,[],'The SDK must not open before its font engine is ready');
      release();await page.evaluate(()=>pending);
      assert.equal(await page.evaluate(()=>outcome.ok),true);
      assert.ok((await page.evaluate(()=>JSON.stringify(outcome.model))).includes('Editable paragraph alpha beta 123.'));
      assert.deepEqual(await page.evaluate(()=>events.map(event=>event.type)),['ready','result']);
      assert.ok((await page.evaluate(()=>events)).every(event=>event.fontReady));
      assert.deepEqual(await page.evaluate(()=>events.find(event=>event.type==='result').sdkEvents.map(event=>[event.type,event.fontReady])),[['native-open',true]]);
      assert.deepEqual(row.failedRequests,[]);
    }));
    await t.test('pagehide stops readiness polling and prevents late ready or native open',async()=>scenario('pagehide',async({page,requested,release,row})=>{
      await page.evaluate(()=>start());const frame=await waiting(page,requested);
      await frame.evaluate(()=>dispatchEvent(new Event('pagehide')));
      row.disposed=await frame.evaluate(()=>({polls:qa.polls.size,events:qa.events}));
      assert.equal(row.disposed.polls,0,'pagehide must clear the sandbox readiness interval');
      release();await frame.waitForFunction(()=>AscFonts.isEngineReady===true);await page.waitForTimeout(50);
      // Even a correctly authenticated delayed open must be ignored after disposal.
      await page.evaluate(()=>{const frame=document.querySelector('iframe');frame.contentWindow.postMessage({channel:'fts-office-model',nonce:new URL(frame.src).hash.slice(1),type:'open',officeBin:new Uint8Array([68,79,67,89])},'*');});
      await page.waitForTimeout(50);
      row.afterRelease=await frame.evaluate(()=>({polls:qa.polls.size,events:qa.events}));
      assert.deepEqual(await page.evaluate(()=>events),[]);assert.equal(row.afterRelease.events.filter(event=>event.type==='native-open').length,0);
      await page.evaluate(()=>controller.abort());await page.evaluate(()=>pending);
      assert.equal(await page.evaluate(()=>outcome.name),'AbortError');assert.deepEqual(row.failedRequests,[]);
    }));
    for(const mode of ['abort','timeout'])await t.test(mode+' during real font bootstrap removes the frame and permits a healthy next conversion',async()=>scenario(mode,async({page,requested,release,row})=>{
      if(mode==='timeout')await page.clock.install({time:Date.now()});
      await page.evaluate(()=>start());await waiting(page,requested);
      if(mode==='abort')await page.evaluate(()=>controller.abort());
      if(mode==='timeout')await page.clock.fastForward(30001);
      await page.evaluate(()=>pending);row.cancelled=await page.evaluate(()=>({outcome,events,frames:document.querySelectorAll('iframe').length}));
      assert.equal(row.cancelled.outcome.ok,false);assert.equal(row.cancelled.outcome[mode==='abort'?'name':'code'],mode==='abort'?'AbortError':'ENGINE_TIMEOUT');
      assert.deepEqual(row.cancelled.events,[]);assert.equal(row.cancelled.frames,0);
      release();
      // Cancellation really aborts the in-flight resource: retain, identify,
      // and assert that failure instead of suppressing it or claiming zero.
      await page.waitForTimeout(100);row.cancelledRequests=[...row.failedRequests];
      assert.ok(row.cancelledRequests.some(request=>request.url.endsWith('/fonts.wasm')));
      assert.ok(row.cancelledRequests.every(request=>request.url.startsWith(origin+'/vendor/office/')&&request.failure.errorText==='net::ERR_ABORTED'));
      await page.evaluate(()=>{controller=new AbortController();events=[];start();});await page.evaluate(()=>pending);
      assert.equal(await page.evaluate(()=>outcome.ok),true);assert.equal(row.failedRequests.length,row.cancelledRequests.length,'Healthy recovery must add no request failures');
      assert.deepEqual(await page.evaluate(()=>events.map(event=>event.type)),['ready','result']);
      assert.ok((await page.evaluate(()=>events)).every(event=>event.fontReady));
    }));
    for(const[file,hash]of pins)assert.equal(sha(await readFile(file)),hash,'Served runtime remains unchanged: '+file);
  }finally{hold=null;await persist();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
