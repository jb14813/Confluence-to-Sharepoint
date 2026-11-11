import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile}from'node:fs/promises';
import {createHash}from'node:crypto';
import vm from'node:vm';
import {readPdfDrawings,validatePdfDrawings}from'../src/engine/pdf-drawings.js';
import {bindPdfDrawings}from'../src/content/pdf-drawing-bindings.js';
import {composePdfDrawingFlow}from'../src/content/pdf-drawing-flow.js';
import {planPdfReadingOrder}from'../src/content/pdf-layout.js';

const root=new URL('fixtures/pdf-drawings/noncell-clip/',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const parser=vm.createContext({TextDecoder,TextEncoder});vm.runInContext(await readFile(new URL('../vendor/xmldom.js',import.meta.url),'utf8'),parser);
const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
test('six genuine native060 noncell clipped derived figures bind to actual SDK images and compose between intact editable text',async()=>{
 assert.equal(manifest.cases.length,6);
 for(const item of manifest.cases){
  for(const [name,hash]of Object.entries(item.files))assert.equal(sha(await readFile(new URL(name,root))),hash,name);
  const data=JSON.parse(await readFile(new URL(item.name+'.json',root),'utf8')),xml=await readFile(new URL(item.name+'.drawings.xml',root)),value=readPdfDrawings(new Uint8Array(xml),data.options,parser.EngineXml.DOMParser);
  assert.equal(sha(xml),data.privatePartSha256);assert.equal(validatePdfDrawings(structuredClone(value),data.options).version,2);
  assert.equal(data.options.nativeTables.tables.length,0);assert.equal(value.pages[0].drawings.length,1);
  const page=value.pages[0],drawing=page.drawings[0],source=page.sourcePaints[drawing.sourceIds[0]-1];
  assert.equal(drawing.kind,'derived-vector');assert.equal(drawing.role,'figure');assert.equal(source.role,'drawing');assert.deepEqual(source.cellOwners,[]);
  assert.equal(source.kind,'fill');assert.equal(source.fillRule,'evenodd');assert.equal(source.normalComposite,true);assert.equal(source.imageId,null);
  assert.equal(source.clipId,1);assert.equal(page.clips[0].nativeMode,item.clipNativeMode);assert.equal(source.solidFill.a,item.name.startsWith('alpha')?127:255);
  assert.deepEqual(drawing.gap,{beforeLine:0,afterLine:1});assert.deepEqual(page.lines.map(l=>l.text),['Before','After']);
  const before=JSON.stringify(data.document),bound=bindPdfDrawings(value,data.document,data.options).byDocPrId.get(drawing.docPrId);
  assert.equal(bound.node.graphic.type,'image');assert.equal(bound.node.graphic.blipFill.rasterImageId,'image1.png');assert.equal(bound.sources.length,1);
  const textPlan=planPdfReadingOrder(data.document,{...data.options,pdfLayout:{version:1,textAssociationType:2,flowGeometry:'native-plain-line-v1',nativeTables:data.options.nativeTables}});
  assert.equal(textPlan.ok,true,`${item.name}: ${textPlan.reason}`);
  const flow=composePdfDrawingFlow(data.document,{...data.options,pdfDrawings:value,textPlan});assert.equal(flow.ok,true,`${item.name}: ${flow.reason}`);
  assert.equal(flow.drawingProof[0].figures[0].docPrId,drawing.docPrId);assert.deepEqual(flow.drawingProof[0].cellFigures,[]);assert.equal(JSON.stringify(data.document),before);
  assert.equal(data.media.length,1);const media=data.media[0],bytes=Buffer.from(media.bytesBase64,'base64');assert.equal(sha(bytes),media.sha256);assert.equal(media.resourceName,drawing.representation.resourceName);
  assert.deepEqual(media.decoded,{width:drawing.representation.pixelWidth,height:drawing.representation.pixelHeight});
  for(const mutate of [s=>{s.bounds.leftPt-=0.000000001;},s=>{s.bounds.topPt-=0.000000001;},s=>{s.path[0].values[0]=70;},s=>{s.normalComposite=false;}]){
   const changed=structuredClone(value);mutate(changed.pages[0].sourcePaints[0]);assert.throws(()=>validatePdfDrawings(changed,data.options),{code:'PDF_DRAWINGS_UNVERIFIED'});
  }
 }
});
