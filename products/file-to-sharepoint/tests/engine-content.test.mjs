import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {access,cp,mkdir,mkdtemp,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import JSZip from 'jszip';
import {fixtures} from './engine-fixtures.mjs';

const product=fileURLToPath(new URL('..',import.meta.url));
const workspace=path.resolve(product,'../..');
const artifacts=path.join(workspace,'.artifacts/onlyoffice-eval');
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

test('strict offline MV3 converts real Word/PDF bytes into editable SharePoint content and validated interactive fields',{timeout:180000},async t=>{
  await mkdir(artifacts,{recursive:true});
  const dir=await mkdtemp(path.join(artifacts,'engine-content-')),extension=path.join(dir,'extension');
  await mkdir(extension);
  await cp(path.join(product,'src/engine'),path.join(extension,'src/engine'),{recursive:true});
  await cp(path.join(product,'vendor'),path.join(extension,'vendor'),{recursive:true});
  await build({stdin:{contents:"export {adaptDocument} from './src/content/index.js'; export {validateDefinition} from './sharepoint-form/src/runtime/definition.ts';",resolveDir:product,sourcefile:'engine-content-test.js'},outfile:path.join(extension,'content-runtime.js'),bundle:true,format:'esm',platform:'browser',target:'chrome120'});
  await writeFile(path.join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Real file-content integration',version:'1.0.0',background:{service_worker:'background.js'},sandbox:{pages:['src/engine/sandbox.html']},content_security_policy:{extension_pages:"script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",sandbox:"sandbox allow-scripts; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; object-src 'none'; connect-src 'self'"}}));
  await writeFile(path.join(extension,'background.js'),'void 0;');
  await writeFile(path.join(extension,'index.html'),'<!doctype html><html><body><main id="preview"></main><script type="module" src="test.js"></script></body></html>');
  await writeFile(path.join(extension,'test.js'),"import {convertDocument} from './src/engine/index.js'; import {adaptDocument,validateDefinition} from './content-runtime.js'; window.integration={convertDocument,adaptDocument,validateDefinition};");
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
    for(const name of ['sample-rich.docx','sample.pdf'])await t.test(name,async()=>{
      const output=await page.evaluate(async({name,base64})=>{
        const bytes=Uint8Array.from(atob(base64),character=>character.charCodeAt(0));
        const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),n=>n.toString(16).padStart(2,'0')).join('');
        const result=await integration.convertDocument({name,bytes});
        // This calls the production browser decoder; no injected size stub.
        const adapted=await integration.adaptDocument({name,bytes,result});
        const root=document.querySelector('#preview');root.innerHTML=adapted.model.blocks.map(block=>block.html).join('');
        const assets=[];
        for(const asset of adapted.model.assets){
          const blob=adapted.pictures.get(asset.id),image=await createImageBitmap(blob);
          assets.push({...asset,retainedHash:await sha(await blob.arrayBuffer()),decodedWidth:image.width,decodedHeight:image.height});image.close();
        }
        const media=[];for(const [name,bytes] of Object.entries(result.media))media.push({name,hash:await sha(bytes)});
        const form=adapted.formDefinition?integration.validateDefinition(adapted.formDefinition):null;
        return {docxBytes:Array.from(result.docxBytes),sourceHash:adapted.model.sourceFileHash,media,assets,form,warnings:adapted.model.warnings,drawings:adapted.preview.drawings,editableText:root.textContent,cells:Array.from(root.querySelectorAll('td'),cell=>cell.textContent),bold:Array.from(root.querySelectorAll('strong'),element=>element.textContent),tableCount:root.querySelectorAll('table').length,pictureSlots:root.querySelectorAll('.c2sPicture').length,border:root.querySelector('td')?getComputedStyle(root.querySelector('td')).borderTopStyle:null};
      },{name,base64:fixtures[name]});
      evidence.push({name,...output,docxBytes:undefined});
      assert.equal(output.sourceHash,hash(Buffer.from(fixtures[name],'base64')));
      assert.deepEqual(output.warnings.filter(warning=>warning.blocking),[],'A complete SDK result must have no blocking adaptation loss');
      assert.ok(output.assets.length>0);assert.ok(output.pictureSlots>0);
      for(const asset of output.assets){assert.equal(asset.id,asset.retainedHash);assert.equal(asset.width,asset.decodedWidth);assert.equal(asset.height,asset.decodedHeight)}
      // Prove original reconstructed raster bytes are retained by the adapter,
      // independently hashing the actual returned DOCX ZIP media entries.
      const zip=await JSZip.loadAsync(Uint8Array.from(output.docxBytes));
      for(const media of output.media){
        assert.equal(media.hash,hash(await zip.file(media.name).async('nodebuffer')));
        assert.ok(output.assets.some(asset=>asset.id===media.hash&&asset.retainedHash===media.hash));
      }
      if(name.endsWith('.docx')){
        const original=await JSZip.loadAsync(Buffer.from(fixtures[name],'base64'));
        for(const media of output.media)assert.equal(media.hash,hash(await original.file(media.name).async('nodebuffer')));
        assert.deepEqual(output.cells,['Left editable cell','Right editable cell','Second row','Last cell']);
        assert.ok(output.editableText.includes('Crème brûlée'));assert.ok(output.bold.includes('Editable office paragraph with bold text.'));
        assert.equal(output.border,'solid');assert.equal(output.tableCount,1);assert.equal(output.form,null);
      }else{
        for(const text of ['Left cell','Right cell','Name:','Alice','Approved:','Department:','Engineering'])assert.ok(output.editableText.includes(text),`Missing editable textbox: ${text}`);
        assert.equal(output.drawings.filter(drawing=>drawing.kind==='textbox').length,7);
        const vectors=output.drawings.filter(drawing=>drawing.kind==='vector');assert.equal(vectors.length,9);
        assert.ok(vectors.every(drawing=>drawing.decoration&&output.assets.some(asset=>asset.id===drawing.assetId)));
        assert.ok(!output.warnings.some(warning=>warning.code==='vector-adaptation-required'));
        assert.ok(output.tableCount>=7);
        assert.equal(output.form.fields.length,4);
        const fields=Object.fromEntries(output.form.fields.map(field=>[field.sourceName,field]));
        assert.equal(fields.person_name.value,'Alice');assert.equal(fields.approved.value,true);assert.equal(fields.approved.exportValue,'Yes');
        assert.deepEqual(fields.department.choices,[{value:'eng',label:'Engineering'},{value:'ops',label:'Operations'}]);
        assert.equal(fields.department.value,'eng');assert.equal(fields.shift.value,'day');assert.deepEqual(fields.shift.choices.map(choice=>choice.value),['day','night']);
      }
    });
    assert.deepEqual(requests.filter(url=>/^https?:/.test(url)),[]);assert.deepEqual(errors,[]);
  }finally{
    await writeFile(path.join(dir,'evidence.json'),JSON.stringify({evidence,requests,errors},null,2));
    await context.close();
  }
});
