import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,cp,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import JSZip from 'jszip';
import {chromiumExecutable} from './chromium.mjs';
import {readPdfDrawings} from '../src/engine/pdf-drawings.js';

const product=fileURLToPath(new URL('..',import.meta.url));
const fixtureRoot=new URL('./fixtures/pdf-drawings/native056-v2/',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const names=['alpha-gap','filled-curve-gap','nested-opposite-evenodd','nested-same-evenodd','star-evenodd','wide-1334-evenodd','wide-2134-evenodd-alpha'];

async function inventory(root,prefix=''){
  const rows=[];
  for(const entry of await readdir(path.join(root,prefix),{withFileTypes:true})){
    const name=prefix+entry.name;
    if(entry.isDirectory())rows.push(...await inventory(root,name+'/'));
    else {assert.ok(entry.isFile(),'Staged runtime contains only files and directories');const bytes=await readFile(path.join(root,name));rows.push({name,bytes:bytes.length,sha256:sha(bytes)});}
  }
  return rows.sort((a,b)=>a.name.localeCompare(b.name));
}

// Native056 fixtures are noninterlaced 8-bit RGBA PNGs. Read straight alpha
// directly: browser canvas readback can premultiply and round these channels.
function rgbaHash(png){
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(png.toString('ascii',12,16),'IHDR');
  assert.deepEqual([...png.subarray(24,29)],[8,6,0,0,0]);
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20),chunks=[];
  for(let offset=8;offset<png.length;){
    const length=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8);
    assert.ok(offset+length+12<=png.length);
    if(type==='IDAT')chunks.push(png.subarray(offset+8,offset+8+length));
    offset+=length+12;
    if(type==='IEND'){assert.equal(offset,png.length);break;}
  }
  const stride=width*4,raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:height*(stride+1)}),rgba=Buffer.alloc(width*height*4);
  assert.equal(raw.length,height*(stride+1));
  const paeth=(a,b,c)=>{const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);return da<=db&&da<=dc?a:db<=dc?b:c;};
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)];assert.ok(filter<=4);
    for(let x=0;x<stride;x++){
      const i=y*stride+x,a=x>=4?rgba[i-4]:0,b=y?rgba[i-stride]:0,c=y&&x>=4?rgba[i-stride-4]:0;
      const predictor=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];
      rgba[i]=(raw[y*(stride+1)+1+x]+predictor)&255;
    }
  }
  return {width,height,sha256:sha(rgba)};
}

function sdkPicture(document){
  const pictures=[],stack=[document];
  while(stack.length){
    const node=stack.pop();if(!node||typeof node!=='object')continue;
    if(node.type==='paraDrawing')pictures.push(node);
    else stack.push(...Object.values(node));
  }
  assert.equal(pictures.length,1);assert.equal(pictures[0].docPr.id,1);assert.equal(pictures[0].graphic.type,'image');
  assert.equal(pictures[0].graphic.blipFill.rasterImageId,'image1.png');return pictures[0];
}

const harness=String.raw`
import {convertDocument} from './src/engine/index.js';
import {adaptDocument} from './adapter.js';
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const encode=value=>{let out='';for(let i=0;i<value.length;i+=32768)out+=String.fromCharCode(...value.subarray(i,i+32768));return btoa(out);};
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),n=>n.toString(16).padStart(2,'0')).join('');
const messages=[];
window.addEventListener('message',event=>{if(event.data?.channel==='fts-office-model')messages.push({origin:event.origin,type:event.data.type});});
async function decodeImage(bytes){let image;try{image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));return {width:image.width,height:image.height};}finally{image?.close();}}
window.run=async({name,input})=>{
  const offset=messages.length;
  try{
    const source=decode(input),result=await convertDocument({name,bytes:source}),before=JSON.stringify(result.officeDocument);
    const adapted=await adaptDocument({name,bytes:source,result}),media=[],images=[];
    for(const [resourceName,bytes] of Object.entries(result.media))media.push({resourceName,sha256:await hash(bytes),bytesBase64:encode(bytes),decoded:await decodeImage(bytes)});
    for(const asset of adapted.model.assets){const bytes=new Uint8Array(await adapted.pictures.get(asset.id).arrayBuffer());images.push({asset,sha256:await hash(bytes),bytesBase64:encode(bytes),decoded:await decodeImage(bytes)});}
    const tables=[];
    for(const block of adapted.model.blocks){
      const root=new DOMParser().parseFromString(block.html,'text/html');
      for(const table of root.querySelectorAll('table'))tables.push([...table.rows].map(row=>[...row.cells].map(cell=>{
        const order=[],walk=node=>{if(node.nodeType===Node.TEXT_NODE){const text=node.textContent.trim();if(text)order.push(text);}else if(node.nodeType===Node.ELEMENT_NODE&&node.matches('.c2sPicture'))order.push('picture');else for(const child of node.childNodes)walk(child);};walk(cell);return {text:cell.textContent.trim(),order,pictures:cell.querySelectorAll('.c2sPicture').length};
      })));
    }
    return {model:adapted.model,preview:adapted.preview,tables,media,images,officeDocument:result.officeDocument,documentUnchanged:before===JSON.stringify(result.officeDocument),
      nativeDrawings:result.pdfLayout.nativeDrawings,nativeTables:result.pdfLayout.nativeTables,pdfText:result.pdfText,pdfDerivedImages:result.pdfDerivedImages,
      docxBase64:encode(result.docxBytes),docxHash:await hash(result.docxBytes),sourceHash:await hash(source),sdkMessages:messages.slice(offset),remainingFrames:document.querySelectorAll('iframe').length};
  }catch(error){return {error:{code:error.code,name:error.name,message:error.message,stack:error.stack},sdkMessages:messages.slice(offset),remainingFrames:document.querySelectorAll('iframe').length};}
};`;

test('real strict MV3 PDF to DOCX to BIN to SDK preserves seven derived vector PNGs inside editable cells',{timeout:240000},async t=>{
  const manifest=JSON.parse(await readFile(new URL('manifest.json',fixtureRoot),'utf8')),fixtures=[];
  assert.deepEqual(manifest.cases.map(item=>item.name),names);
  const parser=vm.createContext({TextDecoder,TextEncoder});
  vm.runInContext(await readFile(path.join(product,'vendor/xmldom.js'),'utf8'),parser);
  for(const item of manifest.cases){
    for(const [file,hash] of Object.entries(item.files))assert.equal(sha(await readFile(new URL(file,fixtureRoot))),hash,file);
    const data=JSON.parse(await readFile(new URL(item.name+'.json',fixtureRoot),'utf8'));
    const source=await readFile(new URL(item.name+'.source.pdf',fixtureRoot)),xml=await readFile(new URL(item.name+'.drawings.xml',fixtureRoot));
    assert.equal(sha(source),data.sourcePdfSha256);assert.equal(sha(xml),data.privatePartSha256);
    assert.equal(data.media.length,1);assert.equal(sha(Buffer.from(data.media[0].bytesBase64,'base64')),data.media[0].pngSha256);
    fixtures.push({name:item.name,data,source,drawings:readPdfDrawings(new Uint8Array(xml),data.options,parser.EngineXml.DOMParser)});
  }
  const vendor=path.resolve(process.env.C2S_ENGINE_VENDOR_DIR||path.join(product,'vendor'));
  // Converter pins in the fixture manifest document its native056 origin.
  // New supplied converters must retain these exact outputs and semantics;
  // their actual hashes are recorded in the frozen runtime proof below.
  for(const [file,hash] of Object.entries(manifest.readerRuntime))assert.equal(sha(await readFile(path.join(vendor,file))),hash,`Pinned Reader context required: ${file}`);
  assert.equal(sha(await readFile(path.join(vendor,'office/sdkjs/word/sdk-all.js'))),manifest.sdkAllJsSha256);

  // Keep the physical extension path short: long Windows SDK interface paths
  // produce missing local assets even when CSP and sandboxing are correct.
  const artifacts=path.resolve(product,'../../.artifacts/pdb');await mkdir(artifacts,{recursive:true});
  const run=await mkdtemp(path.join(artifacts,'r-')),extension=path.join(run,'e');await mkdir(extension);
  await cp(path.join(product,'src/engine'),path.join(extension,'src/engine'),{recursive:true});
  await cp(vendor,path.join(extension,'vendor'),{recursive:true});
  for(const [entry,format,globalName] of [['html-resources.js','esm',undefined],['sandbox-svg.js','iife','FtsSvg']])await build({entryPoints:[path.join(product,'src/engine',entry)],outfile:path.join(extension,'src/engine',entry),bundle:true,format,globalName,platform:'browser',target:'chrome127'});
  await build({entryPoints:[path.join(product,'src/content/index.js')],outfile:path.join(extension,'adapter.js'),bundle:true,format:'esm',platform:'browser',target:'chrome127'});
  const shipping=JSON.parse(await readFile(path.join(product,'extension/manifest.json'),'utf8'));
  const qaManifest={manifest_version:3,name:'Derived PDF image regression',version:'1.0.0',background:{service_worker:'background.js'},sandbox:shipping.sandbox,content_security_policy:shipping.content_security_policy};
  assert.equal(qaManifest.content_security_policy.sandbox,shipping.content_security_policy.sandbox);
  assert.equal(qaManifest.web_accessible_resources,undefined);
  await writeFile(path.join(extension,'manifest.json'),JSON.stringify(qaManifest));
  await writeFile(path.join(extension,'background.js'),'void 0;');
  await writeFile(path.join(extension,'index.html'),'<!doctype html><script type="module" src="harness.js"></script>');
  await writeFile(path.join(extension,'harness.js'),harness);
  const runtime=await inventory(extension),runtimeHash=sha(JSON.stringify(runtime));
  await writeFile(path.join(run,'runtime.json'),JSON.stringify({aggregate:runtimeHash,files:runtime},null,2));
  const allowNativeQaDiagnostics=process.env.C2S_ALLOW_NATIVE_QA_DIAGNOSTICS==='1';
  const converterRuntime=Object.fromEntries(Object.keys(manifest.converterRuntime).map(name=>[name,runtime.find(file=>file.name==='vendor/'+name).sha256]));
  const proof={scope:'Real offline strict MV3 supplied runtime against genuine native056 fixtures, seven clip0 cases only; publication/source adoption/SharePoint acceptance HELD',passed:false,allowNativeQaDiagnostics,vendor,fixtureConverterRuntime:manifest.converterRuntime,converterRuntime,readerRuntime:manifest.readerRuntime,sdkAllJsSha256:manifest.sdkAllJsSha256,fixtureManifestSha256:sha(await readFile(new URL('manifest.json',fixtureRoot))),runtimeHash,rows:[],external:[],pageErrors:[],consoleErrors:[],rawConsoleErrors:[],nativeDiagnostics:[],failedRequests:[],workers:[],cleanup:{}};
  t.diagnostic(`Private proof: ${path.join(run,'results.json')}`);
  const context=await chromium.launchPersistentContext(path.join(run,'p'),{headless:true,executablePath:await chromiumExecutable(),ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-background-networking','--disable-component-update','--no-first-run']});
  let page;
  await context.route(/^https?:/,route=>{proof.external.push(route.request().url());return route.abort('blockedbyclient');});
  context.on('requestfailed',request=>proof.failedRequests.push({url:request.url(),error:request.failure()?.errorText}));
  try{
    const background=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');page=await context.newPage();
    page.on('pageerror',error=>proof.pageErrors.push(String(error)));
    page.on('console',message=>{
      if(message.type()!=='error')return;
      const text=message.text();proof.rawConsoleErrors.push(text);
      // This native fprintf(stderr) trace is emitted for successful precise
      // cell discovery. Retain its raw text and validate its complete payload;
      // all other console errors remain failures, including CSP/load failures.
      const prefix='FTS_NATIVE_GRAPHICAL_CELLS_PRECISE ';
      if(text.startsWith(prefix)){
        try{
          const value=JSON.parse(text.slice(prefix.length));
          if(Object.keys(value).sort().join(',')==='cells,complete,heightMm,widthMm'&&value.complete===true&&Number.isFinite(value.widthMm)&&Number.isFinite(value.heightMm)&&value.cells?.length===2&&value.cells.every(cell=>cell.length===4&&cell.every(Number.isFinite))){proof.nativeDiagnostics.push(value);return;}
        }catch{}
      }
      proof.consoleErrors.push(text);
    });
    page.on('worker',worker=>{const row={url:worker.url(),closed:false};proof.workers.push(row);worker.on('close',()=>{row.closed=true;});});
    await page.goto('chrome-extension://'+new URL(background.url()).hostname+'/index.html');await page.waitForFunction(()=>typeof window.run==='function');
    for(const {name,data,source,drawings} of fixtures){
      const result=await page.evaluate(value=>window.run(value),{name:name+'.pdf',input:source.toString('base64')});
      const row={name,sourcePdfSha256:sha(source),result,remainingWorkers:page.workers().length};proof.rows.push(row);
      await writeFile(path.join(run,'results.json'),JSON.stringify(proof,null,2));
      assert.equal(result.error,undefined,`${name}: ${JSON.stringify(result.error)}`);
      assert.equal(result.sourceHash,data.sourcePdfSha256);assert.equal(result.model.sourceFileHash,data.sourcePdfSha256);
      assert.equal(result.documentUnchanged,true);assert.deepEqual(result.nativeDrawings,drawings);
      assert.equal(result.nativeDrawings.version,2);
      const [drawing]=result.nativeDrawings.pages[0].drawings,original=result.nativeDrawings.pages[0].sourcePaints.filter(paint=>drawing.sourceIds.includes(paint.id));
      assert.equal(drawing.kind,'derived-vector');assert.equal(drawing.imageId,1);assert.equal(original.length,1);
      assert.equal(original[0].kind,'fill');assert.equal(original[0].imageId,null);assert.equal(original[0].fillRule,'evenodd');assert.equal(original[0].normalComposite,true);
      assert.ok(original[0].solidFill);assert.equal(original[0].clipId,0);assert.deepEqual(original[0].cellOwners,[{tableOrdinal:0,row:0,column:0}]);
      const expected=data.media[0],expectedBytes=Buffer.from(expected.bytesBase64,'base64');
      assert.deepEqual(drawing.representation,{format:'png',resourceName:expected.resourceName,pixelWidth:expected.width,pixelHeight:expected.height,dpi:192});
      assert.deepEqual(result.pdfDerivedImages,[{resourceName:expected.resourceName,sha256:expected.pngSha256,bytes:expectedBytes.length,pixelWidth:expected.width,pixelHeight:expected.height,dpi:192,imageId:1}]);
      assert.deepEqual(result.preview.pdfDerivedImages,result.pdfDerivedImages);
      assert.equal(result.media.length,1);assert.equal(result.media[0].resourceName,expected.resourceName);
      assert.equal(result.images.length,1);assert.equal(result.images[0].asset.mime,'image/png');assert.equal(result.images[0].asset.id,expected.pngSha256);
      const zip=await JSZip.loadAsync(Buffer.from(result.docxBase64,'base64'));
      assert.equal(sha(Buffer.from(result.docxBase64,'base64')),result.docxHash);
      assert.equal(sha(await zip.file('word/fts-pdf-drawings.xml').async('nodebuffer')),data.privatePartSha256);
      const docxPng=await zip.file(expected.resourceName).async('nodebuffer');assert.deepEqual(docxPng,expectedBytes);
      for(const image of [...result.media,...result.images]){
        const actual=Buffer.from(image.bytesBase64,'base64');assert.deepEqual(actual,expectedBytes);assert.equal(image.sha256,expected.pngSha256);
        assert.deepEqual(image.decoded,{width:expected.width,height:expected.height});
        assert.deepEqual(rgbaHash(actual),{width:expected.width,height:expected.height,sha256:expected.rgbaSha256});
      }
      assert.equal(result.model.stats.images,1);assert.equal(result.model.stats.tables,1);assert.equal(result.model.stats.editableTextCharacters,16);
      assert.deepEqual(result.model.warnings.filter(warning=>warning.blocking),[]);
      assert.deepEqual(result.tables,[[[{text:'BeforeAfter',order:['Before','picture','After'],pictures:1},{text:'Right',order:['Right'],pictures:0}]]]);
      assert.equal(result.model.blocks.length,1);assert.equal(result.model.blocks[0].type,'text');assert.equal(result.model.blocks[0].pictures.length,1);
      assert.deepEqual(result.preview.drawingFlow[0].cellFigures,[1]);assert.equal(result.preview.readingOrder,'verified-native-word-order');
      // Reader physical paint order is Before/Right/After; verified editable
      // cell order is Before/picture/After, then Right (asserted above).
      assert.deepEqual(result.preview.textCoverage,{sourceCharacters:16,modelCharacters:16,missingCharacters:0,extraCharacters:0,physicalSequenceMatches:false});
      assert.equal(result.pdfText.pages[0].meaningfulScalars,16);assert.equal(result.preview.imageViewports,undefined);
      const geometry=result.preview.drawings[0].geometry,expectedNode=sdkPicture(data.document),actualNode=sdkPicture(result.officeDocument);
      // Compare exact pinned native/SDK extents, including the directional
      // integer codec's floor-minus-one case. Asset pixels remain independent.
      assert.deepEqual(actualNode.extent,expectedNode.extent);assert.deepEqual(actualNode.graphic.spPr.xfrm.ext,expectedNode.graphic.spPr.xfrm.ext);
      assert.equal(geometry.width,expectedNode.extent.cx/9525);assert.equal(geometry.height,expectedNode.extent.cy/9525);
      assert.equal(result.images[0].asset.width,expected.width);assert.equal(result.images[0].asset.height,expected.height);
      assert.equal(result.model.blocks[0].pictures[0].displayWidth,Math.round(geometry.width));
      assert.ok(result.sdkMessages.some(message=>message.type==='ready'));assert.ok(result.sdkMessages.every(message=>message.origin==='null'),'SDK messages cross an opaque sandbox origin');
      assert.equal(result.remainingFrames,0);assert.equal(row.remainingWorkers,0);
    }
    assert.deepEqual(proof.external,[]);assert.deepEqual(proof.pageErrors,[]);assert.deepEqual(proof.consoleErrors,[]);assert.deepEqual(proof.failedRequests,[]);
    if(allowNativeQaDiagnostics){assert.ok(proof.nativeDiagnostics.length===0||proof.nativeDiagnostics.length===7);assert.equal(proof.rawConsoleErrors.length,proof.nativeDiagnostics.length);}
    else assert.deepEqual(proof.rawConsoleErrors,[],'Shipping verification requires zero native QA debug prints as well as zero unexpected console errors');
    assert.equal(proof.workers.length,7);assert.ok(proof.workers.every(worker=>worker.closed));
    assert.deepEqual(await inventory(extension),runtime,'Every staged runtime file remains frozen');proof.passed=true;
  }finally{
    proof.cleanup.remainingFrames=page?await page.locator('iframe').count().catch(()=>null):null;
    proof.cleanup.remainingWorkers=page?.workers().length??null;
    proof.cleanup.runtimeUnchanged=JSON.stringify(await inventory(extension))===JSON.stringify(runtime);
    await context.close();proof.cleanup.contextClosed=true;
    await writeFile(path.join(run,'results.json'),JSON.stringify(proof,null,2));
  }
});
