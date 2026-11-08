import test from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import JSZip from 'jszip';
import {fixtures} from './engine-fixtures.mjs';

const exists=async p=>{try{await access(p);return true;}catch{return false;}};
async function browserPath(){
  for(const p of [process.env.EXTENSION_CHROME_PATH,process.env.CHROME_PATH,chromium.executablePath()])if(p&&await exists(p))return p;
  const base=path.join(process.env.LOCALAPPDATA,'ms-playwright');
  for(const revision of (await readdir(base)).filter(n=>/^chromium-\d+$/.test(n)).sort().reverse())for(const layout of ['chrome-win64/chrome.exe','chrome-win/chrome.exe']){
    const p=path.join(base,revision,layout);if(await exists(p))return p;
  }
  throw Error('An extension-capable Chromium executable is required.');
}

test('browser adapter decodes exact original media and native editable table/formatting without network access',{timeout:30000},async()=>{
  const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/content/index.js',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'FileContent',platform:'browser'});
  const zip=await JSZip.loadAsync(Buffer.from(fixtures['sample-rich.docx'],'base64'));
  const entry=Object.keys(zip.files).find(n=>n.startsWith('word/media/')&&n.endsWith('.png'));
  assert.ok(entry);
  const image=Array.from(await zip.file(entry).async('uint8array'));
  const officeDocument=JSON.parse(await readFile(new URL('fixtures/content-word.json',import.meta.url)));
  const browser=await chromium.launch({headless:true,executablePath:await browserPath()});
  try{
    const page=await browser.newPage(),requests=[];
    await page.route('**/*',route=>{
      if(route.request().url()==='https://file-import.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><main id="preview"></main></body></html>'});
      requests.push(route.request().url());return route.abort();
    });
    await page.goto('https://file-import.test/');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const output=await page.evaluate(async({officeDocument,image})=>{
      const {model,pictures}=await FileContent.adaptDocument({name:'Sample.docx',bytes:new TextEncoder().encode('source'),result:{officeDocument,media:{'word/media/image1.png':Uint8Array.from(image)},pdfForms:null,warnings:[]}});
      document.querySelector('#preview').innerHTML=model.blocks.map(b=>b.html).join('');
      const asset=model.assets[0],retained=Array.from(new Uint8Array(await pictures.get(asset.id).arrayBuffer()));
      return {asset,retained,cells:[...document.querySelectorAll('td')].map(n=>n.textContent),bold:[...document.querySelectorAll('strong')].map(n=>n.textContent),border:getComputedStyle(document.querySelector('td')).borderTopStyle,slots:document.querySelectorAll('.c2sPicture').length,warnings:model.warnings};
    },{officeDocument,image});
    assert.equal(output.asset.width,100);assert.equal(output.asset.height,50);
    assert.deepEqual(output.retained,image);
    assert.deepEqual(output.cells,['Left editable cell','Right editable cell','Second row','Last cell']);
    assert.ok(output.bold.includes('Editable office paragraph with bold text.'));
    assert.equal(output.border,'solid');assert.equal(output.slots,1);
    assert.deepEqual(requests,[]);
  }finally{await browser.close();}
});
