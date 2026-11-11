import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {chromiumExecutable} from './chromium.mjs';

test('derived PDF resources require actual decodable PNG dimensions, canonical names and bounded unique bytes',{timeout:30000},async()=>{
 const source=await readFile(new URL('../src/engine/pdf-drawing-resources.js',import.meta.url),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
 assert.ok(source,'The derived PDF resource verifier must exist');
 const bundled=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'PdfResources',write:false,platform:'browser'});
 const browser=await chromium.launch({headless:true,executablePath:await chromiumExecutable()});
 try{
  const page=await browser.newPage();await page.route('http://localhost/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('http://localhost/pdf-resources');await page.addScriptTag({content:bundled.outputFiles[0].text});
  const png=await readFile(new URL('fixtures/native-media/quadrants-reference.png',import.meta.url));
  const result=await page.evaluate(async encoded=>{
   const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),name='word/media/image1.png';
   // Authored metadata unit object; full provenance is checked separately.
   const rep={format:'png',resourceName:name,pixelWidth:80,pixelHeight:40,dpi:192};
   const ledger={version:2,pages:[{drawings:[{kind:'derived-vector',imageId:1,representation:rep}]}]};
   const verify=(value=ledger,media={[name]:bytes})=>PdfResources.verifyPdfDrawingResources(value,media);
   const good=await verify(),failures=[];
   const controller=new AbortController();controller.abort();let aborted=false;
   try{await PdfResources.verifyPdfDrawingResources(ledger,{[name]:bytes},{signal:controller.signal});}catch(error){aborted=error.name==='AbortError';}
   const midDecode=new AbortController(),decode=globalThis.createImageBitmap;let closed=0,lateAbort=false;
   globalThis.createImageBitmap=async(...args)=>{const bitmap=await decode(...args),close=bitmap.close.bind(bitmap);bitmap.close=()=>{closed++;close();};midDecode.abort();return bitmap;};
   try{await PdfResources.verifyPdfDrawingResources(ledger,{[name]:bytes},{signal:midDecode.signal});}catch(error){lateAbort=error.name==='AbortError';}finally{globalThis.createImageBitmap=decode;}
   const bad=async(value,media)=>{try{await verify(value,media);failures.push('accepted');}catch(error){failures.push(error.code);}};
   await bad(ledger,{});await bad(ledger,{['wrong/'+name]:bytes});
   await bad(ledger,{[name]:bytes,'elsewhere/image1.png':bytes});
   const wrong=structuredClone(ledger);wrong.pages[0].drawings[0].representation.pixelWidth=79;await bad(wrong);
   const forged=bytes.slice();new DataView(forged.buffer).setUint32(16,79);await bad(wrong,{[name]:forged});
   await bad(ledger,{[name]:bytes.slice(0,24)});
   const alias=structuredClone(ledger);alias.pages[0].drawings[0].representation.resourceName='word/media/../image1.png';await bad(alias);
   const excessive=structuredClone(ledger);excessive.pages[0].drawings[0].representation.pixelWidth=4097;await bad(excessive);
   const big=new Uint8Array(32*1024*1024+1);big.set(bytes);await bad(ledger,{[name]:big});
   return {good,failures,aborted,lateAbort,closed};
  },png.toString('base64'));
  assert.equal(result.good.length,1);assert.equal(result.good[0].resourceName,'word/media/image1.png');assert.equal(result.good[0].pixelWidth,80);assert.equal(result.good[0].pixelHeight,40);
  assert.deepEqual(result.failures,Array(9).fill('PDF_DRAWINGS_UNVERIFIED'));
  assert.equal(result.aborted,true);
  assert.equal(result.lateAbort,true);assert.equal(result.closed,1);
  for(const name of ['alpha-gap','filled-curve-gap','nested-opposite-evenodd','nested-same-evenodd','star-evenodd','wide-1334-evenodd','wide-2134-evenodd-alpha']){
   const fixture=JSON.parse(await readFile(new URL(`fixtures/pdf-drawings/native056-v2/${name}.json`,import.meta.url),'utf8')),resource=fixture.media[0];
   const actual=await page.evaluate(async resource=>{
    const bytes=Uint8Array.from(atob(resource.bytesBase64),c=>c.charCodeAt(0)),rep={format:'png',resourceName:resource.resourceName,pixelWidth:resource.width,pixelHeight:resource.height,dpi:192};
    const receipts=await PdfResources.verifyPdfDrawingResources({version:2,pages:[{drawings:[{kind:'derived-vector',imageId:1,representation:rep}]}]},{[resource.resourceName]:bytes});
    return receipts;
   },resource);
   assert.equal(actual[0].sha256,resource.pngSha256,name);assert.deepEqual([actual[0].pixelWidth,actual[0].pixelHeight],[resource.width,resource.height],name);
  }
 }finally{await browser.close();}
});
