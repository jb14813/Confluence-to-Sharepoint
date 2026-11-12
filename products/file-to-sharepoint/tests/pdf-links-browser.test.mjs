import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium} from 'playwright';
import {chromiumExecutable} from './chromium.mjs';

test('the actual packaged reader preserves PDF URI and page annotations without activating unsafe actions',{timeout:120000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),artifacts=path.join(root,'.artifacts/pdf-links-browser');await mkdir(artifacts,{recursive:true});const run=await mkdtemp(path.join(artifacts,'run-')),extension=path.join(run,'extension');
 const input=await readFile(new URL('./fixtures/pdf-reader-links/reader-links.pdf',import.meta.url)),hash=createHash('sha256').update(input).digest('hex');assert.equal(hash,'53e01fe1cc9e3fed69c9902a83bb1476fed25bdee68f132a392536e74b8746ce');
 await promisify(execFile)(process.execPath,['products/file-to-sharepoint/scripts/build.mjs'],{cwd:root,env:{...process.env,FTS_BUILD_DIR:extension}});
 const context=await chromium.launchPersistentContext(path.join(run,'profile'),{headless:true,executablePath:await chromiumExecutable(),ignoreDefaultArgs:['--disable-extensions'],args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--disable-background-networking','--disable-component-update','--no-first-run']});
 const requests=[],errors=[];await context.route(/^https?:/,route=>{requests.push(route.request().url());return route.abort();});
 try{
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));
  await page.goto('chrome-extension://'+new URL(worker.url()).hostname+'/workspace.html');await page.waitForFunction(()=>!document.querySelector('#file').disabled);
  await page.locator('#file').setInputFiles({name:'reader-links.pdf',mimeType:'application/pdf',buffer:input});await page.waitForFunction(()=>!document.querySelector('#document').hidden&&!document.querySelector('#new-file').disabled,{},{timeout:90000});
  const readModel=()=>page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('file-to-sharepoint-v1',2);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction('capture'),get=t.objectStore('capture').get('current');t.oncomplete=()=>{resolve(get.result.model);db.close();};};}));
  const model=await readModel();
  const hrefs=await page.locator('#paper a[href]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href'))),text=await page.locator('#paper').innerText();
  assert.equal(model.sourceFileHash,hash);assert.ok(!model.warnings.some(w=>w.blocking));assert.ok(text.includes('First page: editable PDF text.'));assert.ok(text.includes('Second page target remains editable.'));
  assert.ok(hrefs.includes('https://example.com/docs?one=1&two=2'));assert.ok(hrefs.includes('#file-pdf-page-2'));assert.ok(hrefs.every(href=>!href.startsWith('javascript:')));assert.equal(await page.locator('#paper #file-pdf-page-2').count(),1);
  assert.equal(model.fileReview.preview.pdfLinks.sourceLinks,3);assert.equal(model.fileReview.preview.pdfLinks.addedLinks,2);assert.equal(model.fileReview.preview.pdfLinks.unsupported,1);assert.equal(model.fileReview.preview.textCoverage.missingCharacters,0);assert.equal(model.fileReview.preview.textCoverage.extraCharacters,0);assert.ok(model.warnings.some(w=>w.code==='pdf-links-unsupported'));
  await page.locator('#new-file').click();await page.waitForFunction(()=>!document.querySelector('#picker').hidden&&!document.querySelector('#file').disabled);
  const imageOnly=await readFile(new URL('./fixtures/pdf-reader-links/image-only-link.pdf',import.meta.url));assert.equal(createHash('sha256').update(imageOnly).digest('hex'),'1d00fbf965e08dfa413f5a697e456aa2b939f5fdb4b3bcd4e38e8be9accaf5e0');
  await page.locator('#file').setInputFiles({name:'image-only-link.pdf',mimeType:'application/pdf',buffer:imageOnly});await page.waitForFunction(()=>!document.querySelector('#document').hidden&&!document.querySelector('#new-file').disabled,{},{timeout:90000});
  const scanned=await readModel();assert.equal(scanned.stats.editableTextCharacters,0);assert.ok(scanned.stats.images>0);assert.equal(scanned.fileReview.preview.pdfLinks.addedLinks,1);assert.ok((await page.locator('#paper').innerText()).includes('https://example.com/image-source'));assert.ok(scanned.warnings.some(w=>w.code==='pdf-ocr-unavailable'&&w.blocking));assert.equal(await page.locator('#reviewed').isDisabled(),true);assert.equal(await page.locator('#send').isDisabled(),true);
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);await writeFile(path.join(run,'proof.json'),JSON.stringify({hash,hrefs,preview:model.fileReview.preview,warnings:model.warnings,linksCannotDisguiseMissingEditableBody:true,noRequests:true},null,2));
 }finally{await context.close();}
});
