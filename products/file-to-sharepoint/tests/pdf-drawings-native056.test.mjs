import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {readPdfDrawings,validatePdfDrawings} from '../src/engine/pdf-drawings.js';
import {bindPdfDrawings} from '../src/content/pdf-drawing-bindings.js';
import {composePdfDrawingFlow} from '../src/content/pdf-drawing-flow.js';
import {planPdfReadingOrder} from '../src/content/pdf-layout.js';
const parser=vm.createContext({TextDecoder,TextEncoder});vm.runInContext(await readFile(new URL('../vendor/xmldom.js',import.meta.url),'utf8'),parser);
const names=['alpha-gap','filled-curve-gap','nested-opposite-evenodd','nested-same-evenodd','star-evenodd','wide-1334-evenodd','wide-2134-evenodd-alpha'];
const fixture=async name=>{const root=new URL(`fixtures/pdf-drawings/native056-v2/${name}`,import.meta.url),data=JSON.parse(await readFile(new URL(root+'.json'),'utf8')),xml=new Uint8Array(await readFile(new URL(root+'.drawings.xml')));return {data,xml,value:readPdfDrawings(xml,data.options,parser.EngineXml.DOMParser)};};

test('seven genuine native056 V2 exports bind actual SDK images to original vector paint and exact cell ownership',async()=>{
 for(const name of names){
  const {data,xml,value}=await fixture(name);assert.equal(createHash('sha256').update(xml).digest('hex'),data.privatePartSha256);
  const result=bindPdfDrawings(value,data.document,data.options),entry=result.byDocPrId.get(1);
  assert.equal(entry.drawing.kind,'derived-vector');assert.equal(entry.node.graphic.type,'image');assert.equal(entry.node.graphic.blipFill.rasterImageId,'image1.png');assert.equal(entry.sources.length,1);assert.equal(entry.sources[0].imageId,null);assert.equal(entry.sources[0].fillRule,'evenodd');assert.equal(entry.drawing.role,'cell-figure');assert.deepEqual(entry.cellOwner,{tableOrdinal:0,row:0,column:0});
  for(const mutate of [
   node=>{node.graphic.type='shape';},node=>{node.graphic.blipFill.rasterImageId='image2.png';},node=>{node.graphic.blipFill.rasterImageId='elsewhere/image1.png';},
   node=>{node.graphic.spPr.xfrm.ext.cx+=3;},node=>{node.extent.cy+=3;},node=>{node.graphic.spPr.xfrm.rot=1;},node=>{node.graphic.spPr.xfrm.flipH=true;},
   node=>{node.graphic.spPr.xfrm.ext.cx+=2;node.extent.cx+=2;},node=>{node.graphic.spPr.xfrm.ext.cy-=2;node.extent.cy-=2;},
   node=>{node.graphic.blipFill.srcRect.l=1;},node=>{node.drawingType='anchor';},
  ]){
   const document=structuredClone(data.document),entry=bindPdfDrawings(value,document,data.options).byDocPrId.get(1);mutate(entry.node);
   assert.throws(()=>bindPdfDrawings(value,document,data.options),error=>error.code==='PDF_DRAWINGS_UNVERIFIED');
  }
  for(const mutate of [
   s=>{s.normalComposite=false;},s=>{s.kind='stroke';s.fillRule=null;s.solidFill=null;},s=>{s.path=[];},s=>{s.bounds.rightPt=10000;},s=>{s.cellOwners[0].column=1;},
  ]){const changed=structuredClone(value);mutate(changed.pages[0].sourcePaints.find(s=>s.role==='cell-figure'));assert.throws(()=>validatePdfDrawings(changed,data.options),error=>error.code==='PDF_DRAWINGS_UNVERIFIED');}
  for(const mutate of [
   d=>{d.bounds.rightPt+=2/12700;},d=>{d.bounds.rightPt-=72/d.representation.dpi;},
   d=>{d.bounds.leftPt-=0.001;d.bounds.rightPt-=0.001;},d=>{d.bounds.topPt-=0.001;d.bounds.bottomPt-=0.001;},
  ]){const changed=structuredClone(value);mutate(changed.pages[0].drawings[0]);assert.throws(()=>validatePdfDrawings(changed,data.options),error=>error.code==='PDF_DRAWINGS_UNVERIFIED');}
  // Consumed semantic paint also requires original normal-composite provenance.
  const bad=structuredClone(value);bad.pages[0].sourcePaints[0].normalComposite=false;assert.throws(()=>validatePdfDrawings(bad,data.options),error=>error.code==='PDF_DRAWINGS_UNVERIFIED');
 }
});
test('derived serialized codec permits only the downward integer bucket and exact floor alternate',async()=>{
 const {data,value}=await fixture('wide-2134-evenodd-alpha'),node=bindPdfDrawings(value,data.document,data.options).byDocPrId.get(1).node;
 assert.equal(node.extent.cx,10163174);assert.equal(value.pages[0].drawings[0].representation.pixelWidth*914400/192,10163175);
 node.extent.cx++;node.graphic.spPr.xfrm.ext.cx++;assert.equal(bindPdfDrawings(value,data.document,data.options).byDocPrId.size,1);
 node.extent.cx++;node.graphic.spPr.xfrm.ext.cx++;assert.throws(()=>bindPdfDrawings(value,data.document,data.options),error=>error.code==='PDF_DRAWINGS_UNVERIFIED');
});
test('seven genuine native056 cell figures remain inside their editable tables through complete source-verified flow',async()=>{
 for(const name of names){
  const {data,value}=await fixture(name),document=data.document,before=JSON.stringify(document),textPlan=planPdfReadingOrder(document,{...data.options,pdfLayout:{version:1,textAssociationType:2,flowGeometry:'native-plain-line-v1',nativeTables:data.options.nativeTables}});
  assert.equal(textPlan.ok,true,`${name}: text plan ${textPlan.reason}`);
  const flow=composePdfDrawingFlow(document,{...data.options,pdfDrawings:value,textPlan});assert.equal(flow.ok,true,`${name}: flow ${flow.reason}`);assert.deepEqual(flow.drawingProof[0].cellFigures,[1]);assert.deepEqual(flow.pages[0].nodes,[document.content.find(node=>node.type==='table')]);assert.equal(JSON.stringify(document),before);
 }
});
