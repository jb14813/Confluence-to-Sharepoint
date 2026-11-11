import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,cp,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import JSZip from 'jszip';
import {fixtures} from './engine-fixtures.mjs';
import {chromiumExecutable} from './chromium.mjs';

const product=fileURLToPath(new URL('..',import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const controls=[['quadrants-24.bmp','quadrants-reference.png',80,40],['quadrants-32.bmp','quadrants-reference.png',80,40],['wide-2101x33.bmp','wide-reference.png',2101,33],['wide-rgb.tiff','wide-rgb-reference.png',2101,33],['wide-alpha.tiff','wide-alpha-reference.png',2101,33],['quadrants.emf','quadrants-reference.png',96,48,'emf'],['quadrants.wmf','quadrants-reference.png',96,48,'emf']];
const pinned={
 'quadrants-24.bmp':'f67d6bb41ab2491dae09a13bdba43e2355bee8e41314b3be0b3003c06cc9e4e2',
 'quadrants-32.bmp':'11df9c8142139e9fb299981a4faa2852f164d07b67c3ee55a0398bcb8a265b79',
 'quadrants-reference.png':'9dbf19922305c9d8fee974a14d57f1d66e176e5644c11e85b0abe0d55051ed98',
 'wide-2101x33.bmp':'9236a1c1ada8dcf714a89fb4e1a41235ae4a25f4a8a11926c1f858a35dda0647',
 'wide-reference.png':'0f0d3bcc440872fa0afdf54ea10c18d13b08cad6252a708607b27093c9377271',
 'wide-rgb.tiff':'90fd902e6774f80a2f88904e3a73e165fc52b5e91448a2af02364aca7dae18c7',
 'wide-alpha.tiff':'28983d37dcf7c1bb50d9d0b01985d22f233dfbba524925f890f969e5dc795513',
 'wide-rgb-reference.png':'fc87e51b2effe9d4102f8ffb4281fd230e6e1b1bd80d9d8967420fcd2ac7f7c7',
 'wide-alpha-reference.png':'063579462108dad0be98f8f1e24a7463ee9c2e72f9e2ccaed671558a7841ed35',
 'quadrants.emf':'80044f3aca2a475c11d7144cf49ec81ea8416f484fca1d294e12a0aab71b08bc',
 'quadrants.wmf':'6507f1869e5bbde38f06dd3fae395fa33e836af7843ace150c8c9f253227ae0c'
};
async function inventory(root,prefix=''){
 const rows=[];for(const entry of await readdir(path.join(root,prefix),{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())rows.push(...await inventory(root,name+'/'));else if(entry.isFile())rows.push({name,sha256:sha(await readFile(path.join(root,name)))});else throw Error('Unexpected staged input');}return rows.sort((a,b)=>a.name.localeCompare(b.name));
}

test('real packaged bitmap and metafile imports retain source bindings, lossless pixels and verified vector views',{timeout:180000},async()=>{
 const artifacts=path.resolve('.artifacts/native-media-pipeline');await mkdir(artifacts,{recursive:true});const run=await mkdtemp(path.join(artifacts,'run-')),extension=path.join(run,'e');await mkdir(extension);
 await cp(path.join(product,'src/engine'),path.join(extension,'src/engine'),{recursive:true});await cp(path.resolve(process.env.C2S_ENGINE_VENDOR_DIR||path.join(product,'vendor')),path.join(extension,'vendor'),{recursive:true});
 for(const[entry,format,globalName]of[['html-resources.js','esm',undefined],['sandbox-svg.js','iife','FtsSvg']])await build({entryPoints:[path.join(product,'src/engine',entry)],outfile:path.join(extension,'src/engine',entry),bundle:true,format,globalName,platform:'browser',target:'chrome127'});
 await build({entryPoints:[path.join(product,'src/content/index.js')],outfile:path.join(extension,'adapter.js'),bundle:true,format:'esm',platform:'browser',target:'chrome127'});
 const shipping=JSON.parse(await readFile(path.join(product,'extension/manifest.json'),'utf8'));
 await writeFile(path.join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Native embedded image regression',version:'1.0.0',background:{service_worker:'background.js'},sandbox:{pages:['src/engine/sandbox.html']},content_security_policy:shipping.content_security_policy}));await writeFile(path.join(extension,'background.js'),'void 0;');await writeFile(path.join(extension,'index.html'),'<!doctype html><script type="module" src="harness.js"></script>');
 await writeFile(path.join(extension,'harness.js'),`import{convertDocument}from'./src/engine/index.js';import{adaptDocument}from'./adapter.js';const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),n=>n.toString(16).padStart(2,'0')).join('');async function pixels(blob){let bitmap,canvas;try{bitmap=await createImageBitmap(blob);canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);const rgba=context.getImageData(0,0,canvas.width,canvas.height).data;return{width:canvas.width,height:canvas.height,sha256:await hash(rgba)};}finally{bitmap?.close();if(canvas)canvas.width=canvas.height=1;}}window.run=async({name,input,reference})=>{try{const source=bytes(input),result=await convertDocument({name,bytes:source}),adapted=await adaptDocument({name,bytes:source,result});const images=[];for(const asset of adapted.model.assets)images.push({asset,pixels:await pixels(adapted.pictures.get(asset.id))});return{model:adapted.model,preview:adapted.preview,nativeImages:result.nativeImages,mediaNames:Object.keys(result.media),docxHash:await hash(result.docxBytes),images,reference:await pixels(new Blob([bytes(reference)],{type:'image/png'})),remainingFrames:document.querySelectorAll('iframe').length};}catch(error){return{error:{code:error.code,message:error.message}};}};`);
 const runtime=await inventory(extension);await writeFile(path.join(run,'runtime.json'),JSON.stringify({aggregate:sha(JSON.stringify(runtime)),files:runtime},null,2));
 const context=await chromium.launchPersistentContext(path.join(run,'profile'),{headless:true,executablePath:await chromiumExecutable(),ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-background-networking','--disable-component-update','--no-first-run']});const external=[],errors=[],failedRequests=[],rows=[];context.on('requestfailed',request=>failedRequests.push({url:request.url(),failure:request.failure()}));await context.route(/^https?:/,route=>{external.push(route.request().url());return route.abort('blockedbyclient');});
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));await page.goto('chrome-extension://'+new URL(worker.url()).hostname+'/index.html');await page.waitForFunction(()=>window.run);
  for(const[file,reference,width,height,mode]of controls){
   const source=await readFile(new URL('./fixtures/native-media/'+file,import.meta.url)),png=await readFile(new URL('./fixtures/native-media/'+reference,import.meta.url));assert.equal(sha(source),pinned[file]);assert.equal(sha(png),pinned[reference]);
   const extension=file.split('.').at(-1),zip=await JSZip.loadAsync(Buffer.from(fixtures['sample-rich.docx'],'base64')),date=new Date('2020-01-01T00:00:00Z');zip.remove('word/media/image1.png');zip.file('word/media/image1.'+extension,source,{date});
   const main=await zip.file('word/document.xml').async('string');assert.ok(main.includes('914400')&&main.includes('457200'));zip.file('word/document.xml',main.replaceAll('914400',String(width*9525)).replaceAll('457200',String(height*9525)),{date});
   const rel='word/_rels/document.xml.rels';zip.file(rel,(await zip.file(rel).async('string')).replaceAll('media/image1.png','media/image1.'+extension),{date});zip.file('[Content_Types].xml',(await zip.file('[Content_Types].xml').async('string')).replace('</Types>','<Default Extension="'+extension+'" ContentType="image/'+extension+'"/></Types>'),{date});
   const input=await zip.generateAsync({type:'nodebuffer'}),name=file+'.docx';await writeFile(path.join(run,name),input);
   const parameters={name,input:input.toString('base64'),reference:png.toString('base64')};
   const result=mode==='emf'?await page.evaluate(async({name,input,reference})=>{
     const {convertDocument}=await import('./src/engine/index.js'),{adaptDocument}=await import('./adapter.js');
     const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0)),hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),n=>n.toString(16).padStart(2,'0')).join('');
     async function pixels(blob){let bitmap,canvas;try{bitmap=await createImageBitmap(blob);canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;return{width:canvas.width,height:canvas.height,rgba,sha256:await hash(rgba)};}finally{bitmap?.close();if(canvas)canvas.width=canvas.height=1;}}
     try{
       const source=decode(input),native=await convertDocument({name,bytes:source}),adapted=await adaptDocument({name,bytes:source,result:native}),images=[];
       const expected=await pixels(new Blob([decode(reference)],{type:'image/png'}));let uniformComparison;
       for(const asset of adapted.model.assets){
         const actual=await pixels(adapted.pictures.get(asset.id));let checked=0,mismatches=0;const colors=new Map();
         // Compare all target pixels whose independent Windows source has a
         // uniform 5x5 neighborhood. Different GDI/SVG antialiasing at seams
         // is excluded explicitly; there is no whole-image error tolerance.
         for(let y=0;y<actual.height;y++)for(let x=0;x<actual.width;x++){
           const rx=Math.floor((x+.5)*expected.width/actual.width),ry=Math.floor((y+.5)*expected.height/actual.height);
           if(rx<2||ry<2||rx>=expected.width-2||ry>=expected.height-2)continue;
           const offset=(ry*expected.width+rx)*4,color=Array.from(expected.rgba.subarray(offset,offset+4));let uniform=true;
           for(let yy=ry-2;yy<=ry+2;yy++)for(let xx=rx-2;xx<=rx+2;xx++)for(let channel=0;channel<4;channel++)if(expected.rgba[(yy*expected.width+xx)*4+channel]!==color[channel])uniform=false;
           if(!uniform)continue;checked++;const key=color.join(',');colors.set(key,(colors.get(key)||0)+1);
           if(color.some((value,channel)=>actual.rgba[(y*actual.width+x)*4+channel]!==value))mismatches++;
         }
         uniformComparison={checked,mismatches,colors:[...colors]};images.push({asset,pixels:{width:actual.width,height:actual.height,sha256:actual.sha256}});
       }
       const originalEmfHashes=[];for(const[path,bytes]of Object.entries(native.media))if(/\.(?:emf|wmf)$/i.test(path))originalEmfHashes.push(await hash(bytes));
       return{model:adapted.model,preview:adapted.preview,nativeImages:native.nativeImages,mediaNames:Object.keys(native.media),docxHash:await hash(native.docxBytes),images,reference:{width:expected.width,height:expected.height,sha256:expected.sha256},uniformComparison,originalEmfHashes,remainingFrames:document.querySelectorAll('iframe').length};
     }catch(error){return{error:{code:error.code,message:error.message}};}
   },parameters):await page.evaluate(value=>run(value),parameters);
   rows.push({name,inputHash:sha(input),sourceHash:sha(source),referenceHash:sha(png),result});await writeFile(path.join(run,'results.json'),JSON.stringify({rows,external,errors,failedRequests},null,2));
   assert.equal(result.error,undefined,JSON.stringify(result.error));assert.equal(result.docxHash,sha(input));assert.equal(result.model.stats.images,1);assert.equal(result.images.length,1);assert.equal(result.images[0].asset.mime,'image/png');
   if(mode==='emf'){
     assert.deepEqual([result.images[0].asset.width,result.images[0].asset.height],[width*2,height*2]);assert.ok(result.originalEmfHashes.includes(pinned[file]));
     assert.equal(result.preview.svgImages.length,1);const svg=result.preview.svgImages[0];assert.equal(svg.derivedHash,result.images[0].asset.id);
     assert.ok(result.nativeImages.some(receipt=>receipt.resourceName===svg.resourceName&&receipt.derivedHash===svg.sourceHash));
     assert.equal(result.uniformComparison.mismatches,0);assert.equal(result.uniformComparison.colors.length,4);assert.ok(result.uniformComparison.checked>width*height*4*.6);
   }else{
     assert.deepEqual(result.images[0].pixels,result.reference);assert.deepEqual([result.reference.width,result.reference.height],[width,height]);
     assert.ok(result.mediaNames.includes('word/media/image1.png'));assert.equal(result.nativeImages.length,1);assert.equal(result.nativeImages[0].derivedHash,result.images[0].asset.id);
   }
   assert.ok(result.nativeImages.every(receipt=>receipt.sourceDocxHash===sha(input)));assert.deepEqual(result.preview.nativeImages,result.nativeImages);assert.equal(result.preview.imageViewports,undefined);assert.equal(result.remainingFrames,0);assert.deepEqual(result.model.warnings.filter(w=>w.blocking),[]);
  }
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(await inventory(extension),runtime,'Staged runtime remains frozen');
 }finally{await context.close();await writeFile(path.join(run,'results.json'),JSON.stringify({rows,external,errors,failedRequests},null,2));}
 assert.deepEqual(failedRequests,[]);
});
