import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdir,mkdtemp,readdir,access} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import path from 'node:path';import os from 'node:os';import {fixtures} from './engine-fixtures.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
async function executable(){
 const exists=async p=>{try{await access(p);return true}catch{return false}};
 for(const candidate of [process.env.EXTENSION_CHROME_PATH,chromium.executablePath()])if(candidate&&await exists(candidate))return candidate;
 const cache=process.env.PLAYWRIGHT_BROWSERS_PATH||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.cache'),'ms-playwright');
 for(const revision of (await readdir(cache)).filter(n=>/^chromium-\d+$/.test(n)).sort((a,b)=>Number(b.slice(9))-Number(a.slice(9))))for(const suffix of ['chrome-win64/chrome.exe','chrome-linux64/chrome','chrome-linux/chrome']){const candidate=path.join(cache,revision,suffix);if(await exists(candidate))return candidate;}
 throw Error('Set EXTENSION_CHROME_PATH to an extension-capable Chromium.');
}
test('packaged workspace imports, reviews and restores real Word/PDF documents entirely offline',{timeout:180000},async()=>{
 const artifacts=path.join(root,'.artifacts/file-workspace');await mkdir(artifacts,{recursive:true});const dir=await mkdtemp(path.join(artifacts,'run-')),extension=path.join(dir,'extension');
 await promisify(execFile)(process.execPath,['products/file-to-sharepoint/scripts/build.mjs'],{cwd:root,env:{...process.env,FTS_BUILD_DIR:extension}});
 const context=await chromium.launchPersistentContext(path.join(dir,'profile'),{headless:true,executablePath:await executable(),ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-background-networking','--disable-component-update','--no-first-run'],viewport:{width:1440,height:1000}});
 const errors=[],requests=[];context.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});await context.route(/^https?:/,r=>r.abort('blockedbyclient'));
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('ERR_ABORTED'))errors.push(m.text());});
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/workspace.html`);await page.waitForFunction(()=>document.querySelector('#file')&&!document.querySelector('#file').disabled);
  assert.equal(await page.title(),'File to SharePoint');assert.equal(await page.locator('#send').isDisabled(),true);
  await page.locator('#file').setInputFiles({name:'sample-rich.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from(fixtures['sample-rich.docx'],'base64')});
  await page.waitForFunction(()=>!document.querySelector('#document').hidden&&!document.querySelector('#new-file').disabled,{},{timeout:90000});
  assert.match(await page.locator('#paper').innerText(),/Left editable cell/);assert.match(await page.locator('#paper').innerText(),/Right editable cell/);assert.ok(await page.locator('#paper img').count()>0);
  await page.locator('#site').fill('https://demo.sharepoint.com/sites/Files');await page.locator('#reviewed').check();assert.equal(await page.locator('#send').isEnabled(),true);
  await page.screenshot({path:path.join(artifacts,'word-preview.png'),fullPage:true});
  await page.reload();await page.waitForFunction(()=>!document.querySelector('#document').hidden&&!document.querySelector('#new-file').disabled);assert.match(await page.locator('#paper').innerText(),/Left editable cell/);assert.equal(await page.locator('#reviewed').isChecked(),false);
  await page.locator('#new-file').click();await page.waitForFunction(()=>!document.querySelector('#picker').hidden);
  await page.locator('#file').setInputFiles({name:'sample.pdf',mimeType:'application/pdf',buffer:Buffer.from(fixtures['sample.pdf'],'base64')});
  await page.waitForFunction(()=>!document.querySelector('#form-section').hidden&&!document.querySelector('#new-file').disabled,{},{timeout:90000});
  const text=await page.locator('#paper').innerText();for(const value of ['Name','Alice','Approved','Department','Engineering'])assert.ok(text.includes(value),value);
  assert.equal(await page.locator('#form-preview .file-import-form-submit').isVisible(),false);assert.ok(await page.locator('#form-preview input').count()>1);assert.equal(await page.locator('#form-notice').isVisible(),true);
  await page.screenshot({path:path.join(artifacts,'pdf-form-preview.png'),fullPage:true});
  // Restore a confirmed destination result containing the retained engine's
  // recovery notes. The UI must show image omissions instead of hiding them
  // behind the verified-draft status.
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('file-to-sharepoint-v1',2);request.onerror=()=>reject(request.error);request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('capture','readwrite'),store=tx.objectStore('capture'),read=store.get('current');
      read.onsuccess=()=>{const record=read.result;record.attempt={sourceHash:record.model.sourceHash,attemptId:crypto.randomUUID(),siteUrl:'https://demo.sharepoint.com/sites/Files',tabId:9,status:'complete',result:{verified:true,publication:'unpublished',pageUrl:'https://demo.sharepoint.com/sites/Files/SitePages/file.aspx',notes:['Some pictures could not be placed because the library refused them.']}};store.put(record,'current');};
      tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
    };
  }));
  await page.reload();await page.waitForFunction(()=>document.querySelector('#notes').textContent.includes('Some pictures could not be placed'));
  assert.equal(await page.locator('#send').isDisabled(),true);assert.match(await page.locator('#status').innerText(),/Draft created and verified/);
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
