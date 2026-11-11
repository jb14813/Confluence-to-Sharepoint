import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtures} from './engine-fixtures.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));

test('missing local pictures block review while preserving an existing send identity',{timeout:120000},async()=>{
  const artifacts=path.resolve(process.env.FTS_TEST_ARTIFACTS_DIR||path.join(root,'.artifacts'),'preview-recovery');await mkdir(artifacts,{recursive:true});
  const directory=await mkdtemp(path.join(artifacts,'run-')),extension=path.join(directory,'extension');
  await promisify(execFile)(process.execPath,['products/file-to-sharepoint/scripts/build.mjs'],{cwd:root,env:{...process.env,FTS_BUILD_DIR:extension}});
  const context=await chromium.launchPersistentContext(path.join(directory,'profile'),{headless:true,executablePath:await chromiumExecutable(),ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-background-networking','--disable-component-update','--no-first-run']});
  const requests=[],errors=[];await context.route(/^https?:/,route=>{requests.push(route.request().url());return route.abort();});
  try{
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    const address=`chrome-extension://${new URL(worker.url()).hostname}/workspace.html`;
    await page.goto(address);await page.waitForFunction(()=>!document.querySelector('#file').disabled);
    await page.locator('#file').setInputFiles({name:'sample-rich.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from(fixtures['sample-rich.docx'],'base64')});
    await page.waitForFunction(()=>!document.querySelector('#document').hidden&&!document.querySelector('#new-file').disabled,{},{timeout:90000});
    assert.ok(await page.locator('#paper img').count()>0);
    const original=await page.evaluate(()=>new Promise((resolve,reject)=>{
      const request=indexedDB.open('file-to-sharepoint-v1',2);request.onerror=()=>reject(request.error);request.onsuccess=()=>{
        const db=request.result,transaction=db.transaction('capture'),get=transaction.objectStore('capture').get('current');
        transaction.oncomplete=()=>{resolve(get.result);db.close();};transaction.onerror=()=>reject(transaction.error);
      };
    }));
    const mutate=async(record,flight=null)=>page.evaluate(async({record,flight})=>{
      await chrome.storage.local.remove('file-send-in-flight-v1');if(flight)await chrome.storage.local.set({'file-send-in-flight-v1':flight});
      await new Promise((resolve,reject)=>{
        const request=indexedDB.open('file-to-sharepoint-v1',2);request.onerror=()=>reject(request.error);request.onsuccess=()=>{
          const db=request.result,transaction=db.transaction(['capture','pictures'],'readwrite');transaction.objectStore('capture').put(record,'current');transaction.objectStore('pictures').clear();
          transaction.oncomplete=()=>{db.close();resolve();};transaction.onerror=()=>reject(transaction.error);
        };
      });
    },{record,flight});
    await mutate(original);await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('preview image is missing'));
    await page.locator('#site').fill('https://demo.sharepoint.com/sites/Files');
    assert.equal(await page.locator('#reviewed').isDisabled(),true,'Changing destination cannot make an incomplete preview reviewable');
    assert.equal(await page.locator('#send').isDisabled(),true);assert.equal(await page.locator('#new-file').isEnabled(),true);
    const attempt={sourceHash:original.model.sourceHash,attemptId:'6c79bc29-00c6-4b83-bffb-e5fb531d7853',status:'started',siteUrl:'https://demo.sharepoint.com/sites/Files',tabId:9};
    await mutate({...original,attempt},attempt);await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('preview image is missing'));
    assert.equal(await page.locator('#check').isVisible(),true,'A missing preview must not hide uncertain-send recovery');
    assert.equal(await page.locator('#review-link').getAttribute('href'),attempt.siteUrl);assert.equal(await page.locator('#send').isDisabled(),true);assert.equal(await page.locator('#new-file').isDisabled(),true);
    const retained=await page.evaluate(async()=>chrome.storage.local.get('file-send-in-flight-v1'));assert.deepEqual(retained['file-send-in-flight-v1'],attempt);
    await mutate(original,attempt);await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('preview image is missing'));
    assert.equal(await page.locator('#reset').isVisible(),true,'Durable interrupted-send recovery must remain available when the local attempt is absent');
    assert.equal(await page.locator('#review-link').getAttribute('href'),attempt.siteUrl);assert.equal(await page.locator('#check').isVisible(),false);assert.equal(await page.locator('#new-file').isDisabled(),true);assert.equal(await page.locator('#send').isDisabled(),true);
    const standalone={...original,model:{...original.model,blocks:[{id:'standalone-image',type:'image',assetId:original.model.assets[0].id,alt:'Retained source picture'}]}};
    await mutate(standalone);await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('preview image is missing'));
    await page.locator('#site').fill('https://demo.sharepoint.com/sites/Files');assert.equal(await page.locator('#reviewed').isDisabled(),true);assert.equal(await page.locator('#send').isDisabled(),true);assert.equal(await page.locator('#paper img').count(),0);
    await page.locator('#new-file').click();await page.waitForFunction(()=>!document.querySelector('#picker').hidden&&!document.querySelector('#file').disabled);
    await page.locator('#file').setInputFiles({name:'sample-rich.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from(fixtures['sample-rich.docx'],'base64')});
    await page.waitForFunction(()=>!document.querySelector('#document').hidden&&!document.querySelector('#new-file').disabled,{},{timeout:90000});
    await page.locator('#site').fill('https://demo.sharepoint.com/sites/Files');await page.locator('#reviewed').check();assert.equal(await page.locator('#send').isEnabled(),true);
    assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  }finally{
    try{const pages=await Promise.all(context.pages().map(async page=>({url:page.url(),status:await page.evaluate(()=>document.querySelector('#status')?.textContent).catch(()=>null)})));await writeFile(path.join(directory,'browser-state.json'),JSON.stringify({errors,requests,pages},null,2));}
    finally{await context.close();}
  }
});
import {chromiumExecutable} from './chromium.mjs';
