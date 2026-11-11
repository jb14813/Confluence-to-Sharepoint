import test from 'node:test';
import assert from 'node:assert/strict';
import {build}from'esbuild';
import {readFile}from'node:fs/promises';
import {fileURLToPath}from'node:url';
import {chromium}from'playwright';
import {chromiumExecutable}from'./chromium.mjs';
const api=await import('../src/engine/pdf-drawing-aliases.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return{};throw error;});
test('derived aliases require actual DOCX PNG bytes and authentic per-docPr proofs',{timeout:30000},async()=>{
 assert.equal(typeof api.preparePdfDrawingAliases,'function');
 const bundle=await build({stdin:{contents:"import * as A from './src/engine/pdf-drawing-aliases.js';window.A=A;window.Zip=globalThis.JSZip;",resolveDir:fileURLToPath(new URL('..',import.meta.url)),sourcefile:'pdf-alias-test.js'},bundle:true,write:false,format:'esm',platform:'browser'});
 const browser=await chromium.launch({headless:true,executablePath:await chromiumExecutable()});
 try{const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('https://alias.test/');await page.addScriptTag({content:await readFile(new URL('../vendor/jszip.min.js',import.meta.url),'utf8')});await page.addScriptTag({type:'module',content:bundle.outputFiles[0].text});await page.waitForFunction(()=>!!window.A);
 const result=await page.evaluate(async()=>{
  const png=async color=>{const c=document.createElement('canvas');c.width=c.height=20;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,20,20);return new Uint8Array(await(await new Promise(r=>c.toBlob(r,'image/png'))).arrayBuffer());};
  const a=await png('red'),b=await png('blue'),changed=await png('green'),media={'word/media/image1.png':a,'word/media/image2.png':b};
  const zip=new Zip();for(const[n,bytes]of Object.entries(media))zip.file(n,bytes);zip.file('word/document.xml','<document/>');const docx=await zip.generateAsync({type:'uint8array'});
  const rep=id=>({format:'png',resourceName:`word/media/image${id}.png`,pixelWidth:20,pixelHeight:20,dpi:192});
  const ledger={version:2,pages:[{drawings:[{kind:'derived-vector',docPrId:11,imageId:1,representation:rep(1)},{kind:'derived-vector',docPrId:22,imageId:2,representation:rep(2)}]}]};
  const model=names=>({type:'document',content:names.map((name,i)=>({type:'paragraph',content:[{type:'paraDrawing',docPr:{id:i?22:11},graphic:{type:'image',blipFill:{rasterImageId:name}}}]}))});
  const context=await A.preparePdfDrawingAliases(ledger,docx,{originalMedia:media}),identity=model(['image1.png','image2.png']),identityProof=await A.verifyPdfDrawingAliases(context,identity,media);
  const renamed=model(['image2.png','image1.png']),runtime={'word/media/image1.png':b,'word/media/image2.png':a},proof=await A.verifyPdfDrawingAliases(context,renamed,runtime);
  const good=A.pdfDrawingAliasName(proof,ledger,renamed,11),before=JSON.stringify(renamed),failures=[];
  const bad=async fn=>{try{await fn();failures.push('ACCEPTED');}catch(e){failures.push(e.code);}};
  await bad(()=>A.preparePdfDrawingAliases(ledger,new TextEncoder().encode('not zip'),{originalMedia:media}));
  await bad(()=>A.preparePdfDrawingAliases(ledger,docx,{originalMedia:{...media,'word/media/image1.png':changed}}));
  await bad(()=>A.verifyPdfDrawingAliases(context,renamed,{'word/media/image1.png':b}));
  await bad(()=>A.verifyPdfDrawingAliases(context,renamed,{...runtime,'word/media/image2.png':changed}));
  // Add a valid ancillary metadata chunk before IEND; independently decode
  // both full images so this is a same-pixel/different-byte negative.
  const text=new TextEncoder().encode('alias-proof\0same-pixels'),chunk=new Uint8Array(text.length+12),view=new DataView(chunk.buffer);view.setUint32(0,text.length);chunk.set([116,69,88,116],4);chunk.set(text,8);
  let crc=0xffffffff;for(const n of chunk.subarray(4,-4)){crc^=n;for(let i=0;i<8;i++)crc=crc>>>1^(crc&1?0xedb88320:0);}view.setUint32(chunk.length-4,(crc^0xffffffff)>>>0);
  const reencoded=new Uint8Array(a.length+chunk.length);reencoded.set(a.subarray(0,-12));reencoded.set(chunk,a.length-12);reencoded.set(a.subarray(-12),a.length-12+chunk.length);
  const pixels=async bytes=>{const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));try{const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const x=c.getContext('2d');x.drawImage(bitmap,0,0);return{width:bitmap.width,height:bitmap.height,rgba:Array.from(x.getImageData(0,0,c.width,c.height).data)};}finally{bitmap.close();}};
  const reencodedSamePixels=JSON.stringify(await pixels(a))===JSON.stringify(await pixels(reencoded))&&reencoded.length!==a.length;
  await bad(()=>A.verifyPdfDrawingAliases(context,renamed,{...runtime,'word/media/image2.png':reencoded}));
  await bad(()=>A.verifyPdfDrawingAliases(context,identity,runtime));
  const duplicate=model(['image2.png','image1.png']);duplicate.content[1].content[0].docPr.id=11;await bad(()=>A.verifyPdfDrawingAliases(context,duplicate,runtime));
  const missing=model(['image2.png']);await bad(()=>A.verifyPdfDrawingAliases(context,missing,runtime));
  const unknown=model(['elsewhere/image2.png','image1.png']);await bad(()=>A.verifyPdfDrawingAliases(context,unknown,runtime));
  await bad(()=>A.pdfDrawingAliasName(structuredClone(proof),ledger,renamed,11));
  await bad(()=>A.pdfDrawingAliasName(proof,structuredClone(ledger),renamed,11));
  for(const mutate of [r=>{r[0].docPrId=22;},r=>{r.push({...r[0],docPrId:99});},r=>{r.push({...r[0]});},r=>{r[0].sourceDocxHash='0'.repeat(64);},r=>{r[0].sha256='0'.repeat(64);}]){const receipts=structuredClone(proof.receipts);mutate(receipts);await bad(()=>A.verifyPdfDrawingAliases(context,renamed,runtime,{expectedAliases:receipts}));}
  const missingZip=new Zip();missingZip.file('word/media/image2.png',b);await bad(()=>missingZip.generateAsync({type:'uint8array'}).then(bytes=>A.preparePdfDrawingAliases(ledger,bytes,{originalMedia:media})));
  const bomb=docx.slice(),bombView=new DataView(bomb.buffer,bomb.byteOffset,bomb.byteLength);for(let i=0;i+28<bomb.length;i++)if(bombView.getUint32(i,true)===0x02014b50){bombView.setUint32(i+24,150*1024*1024+1,true);break;}await bad(()=>A.preparePdfDrawingAliases(ledger,bomb,{originalMedia:media}));
  const many=new Zip();for(let i=0;i<10000;i++)many.file('empty-'+i,'');many.file('word/media/image1.png',a);many.file('word/media/image2.png',b);await bad(()=>many.generateAsync({type:'uint8array'}).then(bytes=>A.preparePdfDrawingAliases(ledger,bytes,{originalMedia:media})));
  const duringZip=new AbortController(),load=Zip.loadAsync;let zipAbort=false;Zip.loadAsync=async(...args)=>{const parsed=await load.apply(Zip,args);duringZip.abort();return parsed;};try{await A.preparePdfDrawingAliases(ledger,docx,{originalMedia:media,signal:duringZip.signal});}catch(e){zipAbort=e.name==='AbortError';}finally{Zip.loadAsync=load;}
  const c=new AbortController();c.abort();let aborted=false;try{await A.preparePdfDrawingAliases(ledger,docx,{originalMedia:media,signal:c.signal});}catch(e){aborted=e.name==='AbortError';}
  return {good,identityName:A.pdfDrawingAliasName(identityProof,ledger,identity,11),receipts:proof.receipts,canonical:context.receipts,failures,aborted,modelUnchanged:before===JSON.stringify(renamed),reencodedSamePixels,zipAbort};
 });
 assert.equal(result.good,'image2.png');assert.equal(result.identityName,'image1.png');assert.equal(result.receipts.length,2);assert.equal(result.canonical[0].resourceName,'word/media/image1.png');assert.deepEqual(result.failures,Array(19).fill('PDF_DRAWINGS_UNVERIFIED'));assert.equal(result.aborted,true);assert.equal(result.modelUnchanged,true);assert.equal(result.reencodedSamePixels,true);assert.equal(result.zipAbort,true);
 }finally{await browser.close();}
});
