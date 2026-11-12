import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {access,cp,mkdir,mkdtemp,readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import JSZip from 'jszip';
import {fixtures} from './engine-fixtures.mjs';

const product=fileURLToPath(new URL('..',import.meta.url));
const workspace=path.resolve(product,'../..');
const artifacts=path.join(workspace,'.artifacts/onlyoffice-eval');
const vendorPath=path.resolve(process.env.C2S_ENGINE_VENDOR_DIR||path.join(product,'vendor'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=async file=>{try{await access(file);return true}catch{return false}};
async function browserPath(){
  for(const file of [process.env.EXTENSION_CHROME_PATH,process.env.CHROME_PATH,chromium.executablePath()])if(file&&await exists(file))return file;
  const cache=process.env.PLAYWRIGHT_BROWSERS_PATH||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.cache'),'ms-playwright');
  const revisions=(await readdir(cache).catch(()=>[])).filter(name=>/^chromium-\d+$/.test(name)).sort((a,b)=>Number(b.slice(9))-Number(a.slice(9)));
  for(const revision of revisions)for(const layout of ['chrome-win64/chrome.exe','chrome-win/chrome.exe','chrome-linux/chrome','chrome-linux64/chrome']){
    const file=path.join(cache,revision,layout);if(await exists(file))return file;
  }
  throw new Error('Set EXTENSION_CHROME_PATH to an extension-capable Chromium executable.');
}

test('strict offline MV3 converts real Word/PDF bytes into editable SharePoint content and static native form values',{timeout:180000},async t=>{
  await mkdir(artifacts,{recursive:true});
  const dir=await mkdtemp(path.join(artifacts,'engine-content-')),extension=path.join(dir,'extension');
  await mkdir(extension);
  await cp(path.join(product,'src/engine'),path.join(extension,'src/engine'),{recursive:true});
  await build({entryPoints:[path.join(product,'src/engine/html-resources.js')],outfile:path.join(extension,'src/engine/html-resources.js'),bundle:true,format:'esm',platform:'browser',target:'chrome127'});
  await build({entryPoints:[path.join(product,'src/engine/sandbox-svg.js')],outfile:path.join(extension,'src/engine/sandbox-svg.js'),bundle:true,format:'iife',globalName:'FtsSvg',platform:'browser',target:'chrome127'});
  await cp(vendorPath,path.join(extension,'vendor'),{recursive:true});
  await build({stdin:{contents:"export {adaptDocument} from './src/content/index.js';",resolveDir:product,sourcefile:'engine-content-test.js'},outfile:path.join(extension,'content-runtime.js'),bundle:true,format:'esm',platform:'browser',target:'chrome120'});
  await writeFile(path.join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Real file-content integration',version:'1.0.0',background:{service_worker:'background.js'},sandbox:{pages:['src/engine/sandbox.html']},content_security_policy:{extension_pages:"script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",sandbox:"sandbox allow-scripts; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; object-src 'none'; connect-src 'self'"}}));
  await writeFile(path.join(extension,'background.js'),'void 0;');
  await writeFile(path.join(extension,'index.html'),'<!doctype html><html><body><main id="preview"></main><script type="module" src="test.js"></script></body></html>');
  await writeFile(path.join(extension,'test.js'),"import {convertDocument} from './src/engine/index.js'; import {adaptDocument} from './content-runtime.js'; window.integration={convertDocument,adaptDocument};");
  const context=await chromium.launchPersistentContext(path.join(dir,'profile'),{headless:true,executablePath:await browserPath(),ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-background-networking','--disable-component-update','--no-first-run']});
  const requests=[],errors=[],evidence=[];
  context.on('request',request=>requests.push(request.url()));
  await context.route(/^https?:/,route=>route.abort('blockedbyclient'));
  try{
    const service=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(String(error)));
    page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('ERR_ABORTED'))errors.push(message.text())});
    await page.goto(`chrome-extension://${new URL(service.url()).hostname}/index.html`);
    await page.waitForFunction(()=>window.integration);
    const imageFixtures=JSON.parse(await readFile(new URL('./fixtures/pdf-images.json',import.meta.url),'utf8'));
    const sourceWord=await JSZip.loadAsync(Buffer.from(fixtures['sample-rich.docx'],'base64'));
    const sourcePicture=await Object.values(sourceWord.files).find(file=>!file.dir&&/^word\/media\/.+\.png$/.test(file.name)).async('nodebuffer');
    const exportHtml='<html><body><h1>Editable Word export 😀</h1><ol start="3"><li><p>First exported item</p><p><img src="file:///C:/pictures/source.png"></p><p>Image continuation</p></li><li>Second exported item</li></ol><ol start="6"><li>Restarted exported item</li></ol><table><tr><td rowspan="2">Merged source cell</td><td>Neighbor one</td></tr><tr><td>Neighbor two</td></tr></table></body></html>';
    const archive='MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="word-export"\r\n\r\n--word-export\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\nContent-Location: file:///C:/exported.html\r\n\r\n'+exportHtml+'\r\n--word-export\r\nContent-Type: image/png\r\nContent-Transfer-Encoding: base64\r\nContent-Location: file:///C:/pictures/source.png\r\n\r\n'+sourcePicture.toString('base64')+'\r\n--word-export--\r\n';
    const blankManifest=JSON.parse(await readFile(new URL('./fixtures/native-static-forms/manifest.json',import.meta.url),'utf8'));
    const staticFixtures=await Promise.all([['blank-defaults.pdf','./fixtures/native-static-forms/blank-defaults.pdf']].map(async([name,file])=>({name,pdf:(await readFile(new URL(file,import.meta.url))).toString('base64')})));
    assert.equal(hash(Buffer.from(staticFixtures[0].pdf,'base64')),blankManifest['blank-defaults.pdf'].sha256);
    const cases=[...staticFixtures,...['sample-rich.docx','sample.pdf'].map(name=>({name,pdf:fixtures[name]})),{name:'sample-export.doc',pdf:Buffer.from(archive).toString('base64')},...imageFixtures];
    for(const {name,pdf} of cases)await t.test(name,async()=>{
      const output=await page.evaluate(async({name,base64,reference})=>{
        const bytes=Uint8Array.from(atob(base64),character=>character.charCodeAt(0));
        const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),n=>n.toString(16).padStart(2,'0')).join('');
        const result=await integration.convertDocument({name,bytes});
        // This calls the production browser decoder; no injected size stub.
        const adapted=await integration.adaptDocument({name,bytes,result});
        const root=document.querySelector('#preview');root.innerHTML=adapted.model.blocks.map(block=>block.html).join('');
        const pixels=async blob=>{const image=await createImageBitmap(blob),canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d');try{ctx.drawImage(image,0,0);return{width:image.width,height:image.height,rgbaHash:await sha(ctx.getImageData(0,0,image.width,image.height).data)};}finally{image.close();}};
        const assets=[];
        for(const asset of adapted.model.assets){
          const blob=adapted.pictures.get(asset.id),image=await createImageBitmap(blob);
          assets.push({...asset,retainedHash:await sha(await blob.arrayBuffer()),decodedWidth:image.width,decodedHeight:image.height,rgbaHash:(await pixels(blob)).rgbaHash});image.close();
        }
        const media=[],sourceBlobs=new Map();for(const [name,bytes] of Object.entries(result.media)){const hash=await sha(bytes),blob=new Blob([bytes]);sourceBlobs.set(hash,blob);media.push({name,hash,...await pixels(blob)});}
        const viewports=[];for(const viewport of adapted.preview.imageViewports??[]){
          const source=sourceBlobs.get(viewport.sourceAssetId);if(!source)throw Error('Missing original native viewport image');
          const image=await createImageBitmap(source),canvas=new OffscreenCanvas(viewport.width,viewport.height);try{canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);viewports.push({...viewport,reference:await pixels(await canvas.convertToBlob({type:'image/png'}))});}finally{image.close();}
        }
        const sourceReference=reference?await pixels(new Blob([Uint8Array.from(atob(reference),c=>c.charCodeAt(0))])):null;
        const form=adapted.formDefinition;
        return {pdfForms:result.pdfForms,pdfText:result.pdfText,viewports,sourceReference,docxBytes:Array.from(result.docxBytes),sourceHash:adapted.model.sourceFileHash,media,assets,form,formFields:adapted.model.stats.formFields,warnings:adapted.model.warnings,drawings:adapted.preview.drawings,editableText:root.textContent,cells:Array.from(root.querySelectorAll('td'),cell=>cell.textContent),lists:Array.from(root.querySelectorAll('ol'),list=>({start:list.start,items:Array.from(list.children,item=>({text:item.textContent,images:item.querySelectorAll('.c2sPicture').length}))})),rowSpans:Array.from(root.querySelectorAll('td[rowspan]'),cell=>cell.rowSpan),bold:Array.from(root.querySelectorAll('strong'),element=>element.textContent),tableCount:root.querySelectorAll('table').length,pictureSlots:root.querySelectorAll('.c2sPicture').length,border:root.querySelector('td')?getComputedStyle(root.querySelector('td')).borderTopStyle:null};
      },{name,base64:pdf,reference:imageFixtures.find(fixture=>fixture.name===name)?.original});
      evidence.push({name,...output,docxBytes:undefined});
      assert.equal(output.sourceHash,hash(Buffer.from(pdf,'base64')));
      assert.deepEqual(output.warnings.filter(warning=>warning.blocking),[],'A complete SDK result must have no blocking adaptation loss');
      if(name!=='blank-defaults.pdf'){assert.ok(output.assets.length>0);assert.ok(output.pictureSlots>0);}
      for(const asset of output.assets){assert.equal(asset.id,asset.retainedHash);assert.equal(asset.width,asset.decodedWidth);assert.equal(asset.height,asset.decodedHeight)}
      // Native source bytes stay exact in the returned DOCX. Nonuniform image
      // placements require a separately verified viewport for SharePoint.
      const zip=await JSZip.loadAsync(Uint8Array.from(output.docxBytes));
      for(const media of output.media){
        if(name==='sample-export.doc')assert.equal(media.hash,hash(sourcePicture));
        else assert.equal(media.hash,hash(await zip.file(media.name).async('nodebuffer')));
        const viewport=output.viewports.find(viewport=>viewport.sourceAssetId===media.hash);
        if(viewport){
          const actual=output.assets.find(asset=>asset.id===viewport.derivedAssetId);assert.ok(actual,'The authored image viewport must be included in sendable assets');
          assert.equal(actual.rgbaHash,viewport.reference.rgbaHash,'Every derived pixel must match an independent full-source viewport render');
          assert.equal(actual.width,viewport.width);assert.equal(actual.height,viewport.height);
          assert.equal(viewport.sourceWidth,media.width);assert.equal(viewport.sourceHeight,media.height);
          assert.ok(actual.width>=media.width&&actual.height>=media.height,'An uncapped viewport must preserve both native source dimensions');
          assert.ok(viewport.density>=2);assert.equal(viewport.densityLimited,false);
          assert.ok(Math.abs(viewport.displayWidth*actual.height/actual.width-viewport.displayHeight)<=1,'Viewport aspect must preserve the authored display geometry within one CSS pixel');
        }else assert.ok(output.assets.some(asset=>asset.id===media.hash&&asset.retainedHash===media.hash));
      }
      if(output.sourceReference)assert.ok(output.media.some(media=>media.width===output.sourceReference.width&&media.height===output.sourceReference.height&&media.rgbaHash===output.sourceReference.rgbaHash),'Native PDF media must retain every source fixture pixel and both original dimensions');
      if(name.endsWith('.docx')){
        const original=await JSZip.loadAsync(Buffer.from(fixtures[name],'base64'));
        for(const media of output.media)assert.equal(media.hash,hash(await original.file(media.name).async('nodebuffer')));
        assert.deepEqual(output.cells,['Left editable cell','Right editable cell','Second row','Last cell']);
        assert.ok(output.editableText.includes('Crème brûlée'));assert.ok(output.bold.includes('Editable office paragraph with bold text.'));
        assert.equal(output.border,'solid');assert.equal(output.tableCount,1);assert.equal(output.form,null);
      }else if(name==='sample-export.doc'){
        assert.match(output.editableText,/Editable Word export 😀/);
        assert.deepEqual(output.lists,[{start:3,items:[{text:'First exported itemImage continuation',images:1},{text:'Second exported item',images:0}]},{start:6,items:[{text:'Restarted exported item',images:0}]}]);
        assert.deepEqual(output.rowSpans,[2]);assert.deepEqual(output.cells,['Merged source cell','Neighbor one','Neighbor two']);
        assert.equal(output.form,null);assert.equal(output.assets.length,1);
      }else if(name==='blank-defaults.pdf'){
        assert.equal(output.form,null);assert.equal(output.formFields,4);
        assert.match(output.editableText,/Blank native form verification/);
        assert.doesNotMatch(output.editableText,/DEFAULT MUST STAY BLANK|Engineering|◉|☑/);
        assert.deepEqual(output.cells,['','☐','','○ day','○ night']);
        const fields=output.pdfForms.Fields;assert.equal(fields.find(field=>field.name==='blank_name').value,undefined);
        assert.equal(fields.find(field=>field.name==='blank_name').defaultValue,'DEFAULT MUST STAY BLANK');
        assert.equal(fields.find(field=>field.name==='blank_department').value,undefined,'The reader omits an explicitly empty current choice value');
        assert.equal(fields.find(field=>field.name==='blank_department').defaultValue,'eng');
        assert.equal(output.pdfForms.Parents.find(field=>field.name==='blank_shift').value,'Off');
      }else if(name==='sample.pdf'){
        for(const text of ['ONLYOFFICE Import Evidence','Editable paragraph alpha beta 123.','Left cell','Right cell','Name:','Approved:','Department:'])assert.ok(output.editableText.includes(text),`Missing editable PDF body text: ${text}`);
        for(const text of ['Alice','Engineering']){assert.ok(!output.pdfText.pages.some(page=>page.text.includes(text)));assert.ok(output.editableText.includes(text),'Verified form values must be native editable page content');}
        assert.equal(output.drawings.filter(drawing=>drawing.kind==='textbox').length,3);
        const vectors=output.drawings.filter(drawing=>drawing.kind==='vector');assert.equal(vectors.length,0);
        assert.ok(vectors.every(drawing=>drawing.decoration&&output.assets.some(asset=>asset.id===drawing.assetId)));
        assert.ok(!output.warnings.some(warning=>warning.code==='vector-adaptation-required'));
        assert.equal(output.tableCount,2);assert.deepEqual(output.cells,['Left cell','Right cell','','','Alice','☑','Engineering','◉ day','○ night']);assert.equal(output.border,'solid');
        assert.equal(output.form,null);assert.equal(output.formFields,4);
      }else{
        assert.equal(output.form,null,'A PDF without fields must adapt without requesting the form companion');
        assert.deepEqual(output.pdfForms.Fields,[]);assert.deepEqual(output.pdfForms.Parents,[]);
        assert.equal(output.pdfForms.pages.length,1);
        assert.ok(output.editableText.includes('Editable'),'Image fixture text must remain editable');
      }
    });
    const wordLayouts=JSON.parse(await readFile(new URL('./fixtures/word-layout.json',import.meta.url),'utf8'));
    for(const fixture of wordLayouts)await t.test(`Word layout: ${fixture.name}`,async()=>{
      const output=await page.evaluate(async({name,docx})=>{
        const bytes=Uint8Array.from(atob(docx),c=>c.charCodeAt(0)),result=await integration.convertDocument({name,bytes});
        const adapted=await integration.adaptDocument({name,bytes,result});
        const root=document.querySelector('#preview');root.innerHTML=adapted.model.blocks.map(b=>b.html).join('');
        const numbering=[];const scan=v=>{if(!v||typeof v!=='object')return;if(v.ftsNumbering)numbering.push(v.ftsNumbering);for(const child of Object.values(v))scan(child);};scan(result.officeDocument);
        return {warnings:adapted.model.warnings,stats:adapted.model.stats,numbering,html:root.innerHTML,text:root.textContent,lists:Array.from(root.querySelectorAll('ol,ul'),el=>({tag:el.tagName,start:el.start,style:el.style.listStyleType,items:Array.from(el.children,li=>li.textContent)})),spans:Array.from(root.querySelectorAll('td[rowspan],th[rowspan]'),c=>({rows:c.rowSpan,cols:c.colSpan,text:c.textContent})),images:adapted.model.assets,tableCount:root.querySelectorAll('table').length};
      },fixture);
      evidence.push({name:fixture.name,...output});
      if(fixture.kind==='unsupported-numbering'){
        assert.deepEqual(output.warnings.filter(w=>w.blocking),[]);
        assert.ok(output.warnings.some(w=>w.code==='list-marker-adapted'&&!w.blocking));
        for(const text of ['2.a) nested alpha first','2.b) nested alpha second','2.b.i) nested roman first','3.a) nested alpha restarted','C) upper letter starts C','D) upper letter D'])assert.ok(output.text.includes(text),`Missing verified literal marker: ${text}`);
        assert.ok(output.lists.some(list=>list.style==='decimal'&&list.start===7),'Exact native counters remain native lists');
        return;
      }
      if(fixture.kind==='unsupported-symbol'){
        assert.ok(output.warnings.some(w=>w.code==='unsupported-list-numbering'&&w.blocking));
        assert.ok(output.numbering.some(n=>n.definition.numFmt.val==='bullet'&&n.font==='Wingdings'&&n.label==='\uf0b7'));
        return;
      }
      assert.deepEqual(output.warnings.filter(w=>w.blocking),[]);
      if(fixture.kind==='numbering'){
        assert.equal(output.numbering.length,26);assert.equal(output.stats.numbered,23);assert.equal(output.stats.bullets,3);
        assert.ok(output.lists.some(l=>l.style==='lower-latin'&&l.items.length===2));assert.ok(output.lists.some(l=>l.style==='upper-roman'&&l.start===4));assert.ok(output.lists.some(l=>l.style==='upper-latin'&&l.start===3));assert.ok(output.lists.some(l=>l.start===7));
        assert.ok(output.numbering.some(n=>n.value===14));assert.equal(new Set(output.numbering.map(n=>n.scopeId)).size,2);
      }else if(fixture.kind==='inherited'){assert.equal(output.stats.bullets,2);assert.equal(output.lists.filter(l=>l.tag==='UL').length,1);assert.equal(output.images.length,3);}
      else if(fixture.kind==='combined'){assert.ok(output.spans.some(s=>s.rows===3&&s.cols===2));assert.ok(output.spans.some(s=>s.rows===2&&s.cols===1));assert.equal(output.tableCount,2);assert.equal(output.images.length,1);assert.equal(output.stats.numbered,2);}
      else if(fixture.kind==='continuation'){assert.equal(output.spans[0].rows,2);assert.match(output.spans[0].text,/Continuation text retained/);assert.equal(output.images.length,1);}
      else if(fixture.kind==='offset'){assert.equal(output.spans[0].rows,3);assert.match(output.spans[0].text,/Offset R0C1/);}
    });
    const capabilityFixtures=JSON.parse(await readFile(new URL('./fixtures/pdf-capabilities.json',import.meta.url),'utf8'));
    for(const fixture of capabilityFixtures)await t.test(`PDF capability safety: ${fixture.name}`,async()=>{
      const output=await page.evaluate(async({name,pdf})=>{
        try{
          const bytes=Uint8Array.from(atob(pdf),c=>c.charCodeAt(0));
          const result=await integration.convertDocument({name,bytes});
          const adapted=await integration.adaptDocument({name,bytes,result});
          return {form:adapted.formDefinition,blocking:adapted.model.warnings.filter(w=>w.blocking),text:adapted.model.blocks.map(b=>b.html).join('')};
        }catch(error){return {error:error.message,code:error.code};}
      },fixture);
      if(fixture.expectedError)assert.equal(output.code,fixture.expectedError,`Unsupported or unreadable form metadata must not become sendable content: ${JSON.stringify(output)}`);
      else{assert.equal(output.error,undefined);assert.equal(output.form,null);assert.deepEqual(output.blocking,[]);assert.match(output.text,/Editable PDF capability check/);}
    });
    assert.deepEqual(requests.filter(url=>/^https?:/.test(url)),[]);assert.deepEqual(errors,[]);
  }finally{
    await writeFile(path.join(dir,'evidence.json'),JSON.stringify({evidence,requests,errors},null,2));
    await context.close();
    t.diagnostic('Real content evidence: '+path.join(dir,'evidence.json'));
  }
});
