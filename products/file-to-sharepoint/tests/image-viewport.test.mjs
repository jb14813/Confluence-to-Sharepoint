import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {planImageViewport} from '../src/content/image-viewport.js';

test('derived image dimensions retain source resolution and requested density within fixed bounds',()=>{
  assert.deepEqual(planImageViewport({sourceWidth:160,sourceHeight:40,displayWidth:40,displayHeight:30}),{width:160,height:120,density:4,requestedDensity:4,densityLimited:false});
  const fractional=planImageViewport({sourceWidth:10,sourceHeight:10,displayWidth:40.2,displayHeight:40.2});assert.ok(fractional.density>=2);assert.equal(fractional.densityLimited,false);
  const capped=planImageViewport({sourceWidth:4096,sourceHeight:2048,displayWidth:100,displayHeight:100});
  assert.equal(capped.densityLimited,true);assert.ok(capped.width<=4096&&capped.height<=4096&&capped.width*capped.height<=8*1024*1024);assert.equal(capped.width,capped.height);
  const large=planImageViewport({sourceWidth:100,sourceHeight:100,displayWidth:4000,displayHeight:100});assert.equal(large.densityLimited,true);assert.ok(large.width<=4096&&large.width*large.height<=8*1024*1024);
  const tall=planImageViewport({sourceWidth:100,sourceHeight:100,displayWidth:100,displayHeight:4000});assert.ok(Math.abs(100*tall.height/tall.width-4000)<=1);assert.equal(tall.densityLimited,true);
  assert.throws(()=>planImageViewport({sourceWidth:1,sourceHeight:1,displayWidth:1,displayHeight:100000}),error=>error.code==='image-viewport-limit');
  for(const input of [{sourceWidth:0,sourceHeight:40,displayWidth:40,displayHeight:30},{sourceWidth:160,sourceHeight:40,displayWidth:Infinity,displayHeight:30},{sourceWidth:160,sourceHeight:40,displayWidth:40,displayHeight:-1}])assert.throws(()=>planImageViewport(input),error=>error.code==='image-viewport-invalid');
});

test('native browser viewport PNG preserves the complete source image and binds adapter provenance',{timeout:30000},async()=>{
  const bundle=await build({stdin:{contents:"export * from './src/content/image-viewport.js'; export {adaptDocument} from './src/content/index.js';",resolveDir:fileURLToPath(new URL('..',import.meta.url)),sourcefile:'image-viewport-test.js'},bundle:true,write:false,format:'iife',globalName:'Viewport',platform:'browser'});
  const browser=await chromium.launch({headless:true,executablePath:await chromiumExecutable()});
  try{
    const page=await browser.newPage(),requests=[];await page.route('**/*',route=>route.request().url()==='https://viewport.test/'?route.fulfill({contentType:'text/html',body:'<!doctype html><body>'}):(requests.push(route.request().url()),route.abort()));await page.goto('https://viewport.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});
    const animationFixtures=JSON.parse(await readFile(new URL('./fixtures/viewport-animation.json',import.meta.url),'utf8')).images;
    const result=await page.evaluate(async animationFixtures=>{
      const canvas=document.createElement('canvas');canvas.width=160;canvas.height=40;const ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,80,40);ctx.fillStyle='blue';ctx.fillRect(80,0,80,40);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),bytes=new Uint8Array(await blob.arrayBuffer()),sourceHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
      const rendered=await Viewport.renderImageViewport(blob,{sourceWidth:160,sourceHeight:40,displayWidth:40,displayHeight:30}),bitmap=await createImageBitmap(new Blob([rendered.bytes],{type:rendered.mime})),out=document.createElement('canvas');out.width=bitmap.width;out.height=bitmap.height;const paint=out.getContext('2d');paint.drawImage(bitmap,0,0);bitmap.close();
      const drawing=(width,height)=>({type:'paraDrawing',extent:{cx:width*9525,cy:height*9525},graphic:{type:'image',blipFill:{rasterImageId:'word/media/source.png'}}}),documentFor=content=>({type:'document',content:[{type:'paragraph',content}]}),sourceBytes=new Uint8Array([1,2,3]);
      const natural=await Viewport.adaptDocument({name:'natural.doc',bytes:sourceBytes,result:{sourceContainer:'mhtml',media:{'word/media/source.png':bytes},officeDocument:documentFor([drawing(40,10)])}});
      const adapted=await Viewport.adaptDocument({name:'distorted.doc',bytes:sourceBytes,result:{sourceContainer:'mhtml',media:{'word/media/source.png':bytes},officeDocument:documentFor([drawing(40,30),drawing(40,30)])}});
      const both=await Viewport.adaptDocument({name:'mixed.doc',bytes:sourceBytes,result:{sourceContainer:'mhtml',media:{'word/media/source.png':bytes},officeDocument:documentFor([drawing(40,10),drawing(40,30)])}});
      const nativeRounded=await Viewport.adaptDocument({name:'rounded.docx',bytes:sourceBytes,result:{media:{'word/media/source.png':bytes},officeDocument:documentFor([drawing(40,10.00005)])}});
      const htmlRounded=await Viewport.adaptDocument({name:'rounded.doc',bytes:sourceBytes,result:{sourceContainer:'mhtml',media:{'word/media/source.png':bytes},officeDocument:documentFor([drawing(40,10.7)])}});
      const animation=[];
      for(const fixture of animationFixtures){
        const source=new Blob([Uint8Array.from(atob(fixture.base64),c=>c.charCodeAt(0))],{type:fixture.mime}),supported=await ImageDecoder.isTypeSupported(fixture.mime),decoder=new ImageDecoder({data:await source.arrayBuffer(),type:fixture.mime});await decoder.tracks.ready;await decoder.completed;
        const track=decoder.tracks.selectedTrack,metadata={mime:fixture.mime,expectedAnimated:fixture.animated,supported,frameCount:track.frameCount,animated:track.animated};decoder.close();
        const error=await Viewport.renderImageViewport(source,{sourceWidth:4,sourceHeight:2,displayWidth:4,displayHeight:4}).then(()=>null,error=>error.code);animation.push({...metadata,error});
      }
      const error=await Viewport.renderImageViewport(new Blob([new Uint8Array([1,2,3])],{type:'image/png'}),{sourceWidth:160,sourceHeight:40,displayWidth:40,displayHeight:30}).then(()=>null,error=>error.code);
      return{sourceHash,output:{...rendered,bytes:[...rendered.bytes.slice(0,8)]},pixels:[[...paint.getImageData(20,60,1,1).data],[...paint.getImageData(140,60,1,1).data]],natural:{assets:natural.model.assets,pictures:natural.model.blocks[0].pictures,preview:natural.preview,warnings:natural.model.warnings},adapted:{assets:adapted.model.assets,pictures:adapted.model.blocks[0].pictures,preview:adapted.preview,warnings:adapted.model.warnings,blobCount:adapted.pictures.size},mixed:{assets:both.model.assets,blobCount:both.pictures.size},nearRounded:[nativeRounded,htmlRounded].map(a=>({id:a.model.assets[0].id,viewports:a.preview.imageViewports})),animation,error};
    },animationFixtures);
    assert.equal(result.output.width,160);assert.equal(result.output.height,120);assert.deepEqual(result.output.bytes,[137,80,78,71,13,10,26,10]);assert.deepEqual(result.pixels,[[255,0,0,255],[0,0,255,255]]);assert.equal(result.error,'image-viewport-render');
    assert.equal(result.natural.assets.length,1);assert.equal(result.natural.assets[0].id,result.sourceHash);assert.equal(result.natural.preview.imageViewports,undefined);assert.deepEqual(result.natural.warnings,[]);
    assert.equal(result.adapted.assets.length,1,'Unreferenced original bytes must not become an upload');assert.equal(result.adapted.blobCount,1);assert.notEqual(result.adapted.assets[0].id,result.sourceHash);assert.equal(result.adapted.assets[0].width,160);assert.equal(result.adapted.assets[0].height,120);assert.equal(new Set(result.adapted.pictures.map(p=>p.assetId)).size,1);assert.ok(result.adapted.pictures.every(p=>p.displayHeight===undefined));
    assert.equal(result.adapted.preview.imageViewports.length,1,'Repeated source/viewport pairs share one derived render');assert.equal(result.adapted.preview.imageViewports[0].sourceAssetId,result.sourceHash);assert.equal(result.adapted.preview.imageViewports[0].derivedAssetId,result.adapted.assets[0].id);assert.equal(result.adapted.warnings[0].code,'image-viewport-adapted');assert.equal(result.adapted.warnings[0].blocking,undefined);
    for(const rounded of result.nearRounded){assert.equal(rounded.id,result.sourceHash);assert.equal(rounded.viewports,undefined);}
    for(const fixture of result.animation){assert.equal(fixture.supported,true);if(fixture.expectedAnimated)assert.equal(fixture.animated,true);assert.equal(fixture.frameCount,fixture.expectedAnimated?2:1);assert.equal(fixture.error,fixture.expectedAnimated?'image-viewport-animation':null);}
    assert.equal(result.mixed.assets.length,2);assert.equal(result.mixed.blobCount,2);assert.deepEqual(requests,[]);
  }finally{await browser.close();}
});
import {chromiumExecutable} from './chromium.mjs';
