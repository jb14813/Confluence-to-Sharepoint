import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {chromiumExecutable} from './chromium.mjs';
import * as api from '../src/content/image-viewport.js';

test('narrow native image padding retains source scale and bounded integer geometry',()=>{
 assert.equal(typeof api.planImagePadding,'function');
 assert.deepEqual(api.planImagePadding({sourceWidth:2,sourceHeight:607,displayWidth:1}),{width:24,height:607,displayWidth:12,paddingRight:22});
 assert.deepEqual(api.planImagePadding({sourceWidth:5,sourceHeight:9,displayWidth:3}),{width:20,height:9,displayWidth:12,paddingRight:15});
 assert.equal(api.planImagePadding({sourceWidth:20,sourceHeight:10,displayWidth:12}),null);
 for(const values of [{sourceWidth:0,sourceHeight:10,displayWidth:1},{sourceWidth:2,sourceHeight:607,displayWidth:0},{sourceWidth:2,sourceHeight:607,displayWidth:1.5}])assert.throws(()=>api.planImagePadding(values),{code:'image-padding-invalid'});
 assert.throws(()=>api.planImagePadding({sourceWidth:4096,sourceHeight:4096,displayWidth:1}),{code:'image-padding-limit'});
});

test('browser pads native narrow images without changing any decoded source pixel or flattening animation',{timeout:60000},async()=>{
 const bundle=await build({stdin:{contents:"import * as Image from './src/content/image-viewport.js';import {adaptDocument} from './src/content/index.js';window.Padding={...Image,adaptDocument};",resolveDir:fileURLToPath(new URL('..',import.meta.url)),sourcefile:'image-padding-test.js'},bundle:true,write:false,format:'esm',platform:'browser'});
 const animation=JSON.parse(await readFile(new URL('./fixtures/viewport-animation.json',import.meta.url),'utf8')).images.find(image=>image.animated);
 const browser=await chromium.launch({headless:true,executablePath:await chromiumExecutable()});
 try{
  const page=await browser.newPage(),external=[];await page.route('**/*',route=>route.request().url()==='https://padding.test/'?route.fulfill({contentType:'text/html',body:'<!doctype html>'}):(external.push(route.request().url()),route.abort()));await page.goto('https://padding.test/');await page.addScriptTag({type:'module',content:bundle.outputFiles[0].text});
  const result=await page.evaluate(async animation=>{
   const canvas=document.createElement('canvas');canvas.width=2;canvas.height=607;const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(2,607);for(let i=0;i<pixels.data.length;i+=4){pixels.data[i]=(i/4)%256;pixels.data[i+1]=71;pixels.data[i+2]=203;pixels.data[i+3]=4+(i/4)%21;}ctx.putImageData(pixels,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
   const decode=async blob=>{const bitmap=await createImageBitmap(blob),out=document.createElement('canvas');out.width=bitmap.width;out.height=bitmap.height;out.getContext('2d').drawImage(bitmap,0,0);bitmap.close();return out;};
   const source=await decode(blob),rendered=await Padding.renderImagePadding(blob,{sourceWidth:2,sourceHeight:607,displayWidth:1}),output=await decode(new Blob([rendered.bytes],{type:rendered.mime}));
   const original=source.getContext('2d').getImageData(0,0,2,607).data,retained=output.getContext('2d').getImageData(0,0,2,607).data,gutter=output.getContext('2d').getImageData(2,0,22,607).data;
   const bytes=new Uint8Array(await blob.arrayBuffer()),hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
   const drawing=width=>({type:'paraDrawing',extent:{cx:width*9525,cy:607/2*width*9525},graphic:{type:'image',blipFill:{rasterImageId:'source.png'}}});
   const officeDocument={type:'document',content:[{type:'paragraph',content:[drawing(1),drawing(1)]}]};
   const adapted=await Padding.adaptDocument({name:'thin.docx',bytes:Uint8Array.of(1,2,3),result:{media:{'word/media/source.png':bytes},officeDocument}});
   const ordinary=await Padding.adaptDocument({name:'ordinary.docx',bytes:Uint8Array.of(1,2,3),result:{media:{'word/media/source.png':bytes},officeDocument:{type:'document',content:[{type:'paragraph',content:[drawing(20)]}]}}});
   const animated=new Blob([Uint8Array.from(atob(animation.base64),c=>c.charCodeAt(0))],{type:animation.mime});
   const animationError=await Padding.renderImagePadding(animated,{sourceWidth:4,sourceHeight:2,displayWidth:1}).then(()=>null,error=>error.code);
   const controller=new AbortController();controller.abort();const abort=await Padding.renderImagePadding(blob,{sourceWidth:2,sourceHeight:607,displayWidth:1},{signal:controller.signal}).then(()=>null,error=>error.name);
   return {originalExact:original.every((n,i)=>n===retained[i]),gutterTransparent:gutter.every(n=>n===0),dimensions:[output.width,output.height],sourceHash:await hash(bytes),renderedHash:await hash(rendered.bytes),assets:adapted.model.assets,pictures:adapted.model.blocks[0].pictures,padding:adapted.preview.imagePadding,warnings:adapted.model.warnings,blobCount:adapted.pictures.size,ordinary:{assets:ordinary.model.assets,padding:ordinary.preview.imagePadding},animationError,abort};
  },animation);
  assert.equal(result.originalExact,true);assert.equal(result.gutterTransparent,true);assert.deepEqual(result.dimensions,[24,607]);
  assert.equal(result.assets.length,1);assert.equal(result.blobCount,1);assert.equal(result.assets[0].id,result.renderedHash);assert.equal(result.assets[0].width,24);assert.equal(result.assets[0].height,607);
  assert.ok(result.pictures.every(picture=>picture.displayWidth===12&&picture.assetId===result.renderedHash));assert.equal(result.padding.length,1);assert.equal(result.padding[0].sourceAssetId,result.sourceHash);assert.equal(result.padding[0].sourceDisplayWidth,1);assert.equal(result.padding[0].derivedAssetId,result.renderedHash);
  assert.equal(result.warnings.find(warning=>warning.code==='image-minimum-width-adapted')?.blocking,undefined);assert.equal(result.warnings.filter(warning=>warning.blocking).length,0);
  assert.equal(result.ordinary.assets[0].id,result.sourceHash);assert.equal(result.ordinary.padding,undefined);assert.equal(result.animationError,'image-viewport-animation');assert.equal(result.abort,'AbortError');assert.deepEqual(external,[]);
 }finally{await browser.close();}
});
