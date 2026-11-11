import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {readPdfDrawings} from '../src/engine/pdf-drawings.js';
import {planPdfReadingOrder} from '../src/content/pdf-layout.js';

const api=await import('../src/content/pdf-drawing-flow.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const box=(top=0,bottom=5,left=0,right=10)=>({leftPt:left,topPt:top,rightPt:right,bottomPt:bottom});
const para=content=>({type:'paragraph',content:[{type:'run',content}]});
function fixture({text='AB',lines=[{text:'A',bounds:box(0,5)},{text:'B',bounds:box(20,25)}],scalarBoxes=[[0,0,10,5],[0,20,10,25]],bounds=box(10,15),gap={beforeLine:0,afterLine:1},role='figure'}={}){
  const pages=[{W:100,H:100,Dpi:72}],nativeTables={version:1,complete:true,coordinateSpace:'displayed-crop-top-left-pt',sourcePageCount:1,tables:[]};
  const pdfText={version:1,pages:[{pageIndex:0,text}],order:{version:1,coordinateSpace:'displayed-crop-top-left-pt',pages:[{pageIndex:0,widthPt:100,heightPt:100,rotation:0,unicodeScalars:Array.from(text,c=>c.codePointAt(0)),scalarBoxesPt:scalarBoxes}]}};
  const source={id:1,paintOrdinal:1,nativeOrder:1,clipId:0,kind:'fill',role:'drawing',bounds,ctm:{a:1,b:0,c:0,d:1,e:0,f:0},imageId:null,imageBasis:null,fillRule:'nonzero',normalComposite:true,solidFill:null,path:[],outputDocPrId:7,textOwners:[],cellOwners:[]};
  const drawing={docPrId:7,nativeOrder:1,kind:'vector',role,bounds,rotation:0,flipH:false,flipV:false,imageId:null,representation:null,sourceIds:[1],lineOverlaps:role==='under-text'?lines.map((_,i)=>i):[],gap};
  const pdfDrawings={version:2,complete:true,coordinateSpace:'displayed-crop-top-left-pt',ordinalSpace:'native-renderer-paint-calls',sourcePageCount:1,sourcePaintCount:1,outputDrawingCount:1,formedLineCount:lines.length,pages:[{pageIndex:0,widthPt:100,heightPt:100,clips:[],sourcePaints:[source],lines:lines.map((line,ordinal)=>({ordinal,nativeOrder:ordinal+2,firstPaintOrdinal:ordinal+2,...line})),drawings:[drawing]}]};
  const image={type:'paraDrawing',docPr:{id:7},drawingType:'anchor',graphic:{id:'runtime-7',type:'shape',content:null}},wrapper=para([image]),nodes=Array.from(text,char=>para([char]));
  const document={type:'document',content:[wrapper,...nodes],sectPr:{pgSz:{w:2000,h:2000}}};
  const nodeMetadata=new WeakMap([[wrapper,{pageIndex:0}]]);nodes.forEach((node,start)=>nodeMetadata.set(node,{pageIndex:0,start,end:start+1}));
  const textPlan={ok:true,pages:[{pageIndex:0,nodes:[wrapper,...nodes]}],assignments:nodes.map((_,start)=>({id:'unit-'+start,pageIndex:0,start,end:start+1})),nodeMetadata,tableProof:[]};
  return {document,options:{pages,pdfText,nativeTables,pdfDrawings,textPlan}};
}
const run=data=>api.planPdfDrawingFlow(data.document,data.options);

test('native SharePoint reflow retains source-bound graphics and editable nodes without requiring an overlay editor',()=>{
 const data=fixture({bounds:box(0,25),gap:null,role:'under-text'}),before=JSON.stringify(data.document);
 assert.equal(typeof api.planPdfNativeReflow,'function');
 const plan=api.planPdfNativeReflow(data.document,data.options);
 assert.equal(plan.ok,true);assert.equal(plan.pages.length,1);
 assert.deepEqual(plan.pages[0].nodes,data.document.content);
 assert.equal(api.verifyPdfNativeReflowDrawings(plan,[{sourceId:'runtime-7',pageIndex:0,assetId:'a'.repeat(64)}]),true);
 assert.equal(JSON.stringify(data.document),before);
 assert.equal(api.composePdfDrawingFlow(data.document,data.options).code,'PDF_DRAWING_SURFACE_REQUIRED');
});
test('native reflow refuses missing, duplicate, extra and wrong-page graphics instead of hiding content loss',()=>{
 assert.equal(typeof api.planPdfNativeReflow,'function');
 const data=fixture(),plan=api.planPdfNativeReflow(data.document,data.options);
 for(const rendered of [[],[{sourceId:'runtime-7',pageIndex:0}],[{sourceId:'runtime-7',pageIndex:0,assetId:'a'.repeat(64)},{sourceId:'runtime-7',pageIndex:0,assetId:'a'.repeat(64)}],[{sourceId:'unknown',pageIndex:0,assetId:'a'.repeat(64)}],[{sourceId:'runtime-7',pageIndex:1,assetId:'a'.repeat(64)}]])
  assert.throws(()=>api.verifyPdfNativeReflowDrawings(plan,rendered),{code:'PDF_DRAWINGS_UNVERIFIED'});
 data.document.content[0].content[0].content[0].docPr.id=999;
 assert.throws(()=>api.planPdfNativeReflow(data.document,data.options),{code:'PDF_DRAWINGS_UNVERIFIED'});
});
const refused=(data,reason)=>{const result=run(data);assert.equal(result.ok,false);assert.equal(result.code,'PDF_DRAWING_FLOW_UNVERIFIED');if(reason)assert.equal(result.reason,reason);assert.equal(Object.hasOwn(result,'pages'),false);return result;};

test('a verified figure gap chooses an intact following-unit boundary without changing text or source objects',()=>{
  assert.equal(typeof api.planPdfDrawingFlow,'function');
  const data=fixture(),before=JSON.stringify({document:data.document,ledger:data.options.pdfDrawings}),result=run(data),placement=result.pages[0].placements[0];
  assert.equal(result.ok,true);assert.equal(result.requiresSurfaceComposition,false);assert.equal(result.placementComplete,true);
  assert.equal(placement.docPrId,7);assert.equal(placement.graphicId,'runtime-7');assert.equal(placement.beforeUnitId,'unit-1');assert.equal(placement.boundary,1);
  assert.deepEqual(placement.sourceInterval,{start:1,end:1});assert.deepEqual(placement.canonicalInterval,{start:1,end:1});assert.equal(placement.rule,'before-following-unit');
  assert.equal(placement.node,data.document.content[0].content[0].content[0]);assert.equal(JSON.stringify({document:data.document,ledger:data.options.pdfDrawings}),before);
});

test('forward intervals may retain intervening canonical text and choose the following intact unit',()=>{
  assert.equal(typeof api.planPdfDrawingFlow,'function');
  const data=fixture({text:'AXB',lines:[{text:'A',bounds:box(0,5)},{text:'B',bounds:box(30,35)},{text:'X',bounds:box(7,9)}],scalarBoxes:[[0,0,10,5],[0,7,10,9],[0,30,10,35]],bounds:box(12,15)}),result=run(data);
  assert.equal(result.ok,true);const placement=result.pages[0].placements[0];
  assert.deepEqual(placement.sourceInterval,{start:1,end:2});assert.equal(placement.boundary,2);assert.equal(placement.beforeUnitId,'unit-2');
});

test('reversed, intersecting, absent or inside-unit constraints refuse without a usable partial plan',()=>{
  assert.equal(typeof api.planPdfDrawingFlow,'function');
  const reversed=fixture({text:'BA',scalarBoxes:[[0,20,10,25],[0,0,10,5]]});refused(reversed,'reversed-figure-constraints');
  const overlap=fixture({text:'AXB',lines:[{text:'A',bounds:box(0,5)},{text:'B',bounds:box(30,35)},{text:'X',bounds:box(7,9)}],scalarBoxes:[[0,0,10,5],[0,12,10,14],[0,30,10,35]],bounds:box(12,15)});refused(overlap,'figure-intersects-source-text');
  refused(fixture({gap:null}),'unproved-figure-interval');
  const inside=fixture(),node=para(['A\nB']);inside.document.content.splice(1,2,node);inside.options.textPlan.pages[0].nodes.splice(1,2,node);inside.options.textPlan.nodeMetadata.set(node,{pageIndex:0,start:0,end:2});inside.options.textPlan.assignments=[{id:'whole-paragraph',pageIndex:0,start:0,end:2}];refused(inside,'inside-text-unit');
  const partial=fixture();partial.options.textPlan.assignments.pop();refused(partial,'invalid-text-plan');
  const missing=fixture();missing.options.textPlan.ok=false;refused(missing,'invalid-text-plan');
});

test('complete page bounds can prove before-all, after-all and text-free placement without a nearest-line guess',()=>{
  assert.equal(typeof api.planPdfDrawingFlow,'function');
  const above=fixture({lines:[{text:'A',bounds:box(10,15)},{text:'B',bounds:box(30,35)}],scalarBoxes:[[0,10,10,15],[0,30,10,35]],bounds:box(1,5),gap:null}),top=run(above).pages[0].placements[0];
  assert.equal(top.rule,'before-all-text');assert.equal(top.boundary,0);assert.equal(top.beforeUnitId,'unit-0');
  const bottom=run(fixture({bounds:box(50,55),gap:null})).pages[0].placements[0];assert.equal(bottom.rule,'after-all-text');assert.equal(bottom.boundary,2);assert.equal(bottom.beforeUnitId,null);
  const empty=run(fixture({text:'',lines:[],scalarBoxes:[],gap:null})).pages[0].placements[0];assert.equal(empty.rule,'text-free-page');assert.equal(empty.boundary,0);assert.equal(empty.beforeUnitId,null);
});

test('under-text drawings remain separate surface requirements and never become a ready scene prefix',()=>{
  assert.equal(typeof api.planPdfDrawingFlow,'function');
  const result=run(fixture({bounds:box(0,25),gap:null,role:'under-text'}));assert.equal(result.ok,true);assert.equal(result.placementComplete,false);assert.equal(result.requiresSurfaceComposition,true);
  assert.deepEqual(result.pages[0].placements,[]);assert.equal(result.pages[0].surfaceRequirements.length,1);assert.equal(result.pages[0].surfaceRequirements[0].docPrId,7);
  assert.deepEqual(result.pages[0].surfaceRequirements[0].lineOrdinals,[0,1]);
});

function tableFixture(){
  const data=fixture({text:'BA',lines:[{text:'A',bounds:box(0,5,0,10)},{text:'B',bounds:box(0,5,50,60)}],scalarBoxes:[[50,0,60,5],[0,0,10,5]],gap:null}),p=data.options.pdfDrawings.pages[0],source=p.sourcePaints[0],drawing=p.drawings[0];
  source.kind='image';source.fillRule=null;source.role='cell-image';source.imageId=1;source.imageBasis={a:10,b:0,c:0,d:5,e:10,f:10};source.cellOwners=[{tableOrdinal:0,row:0,column:0}];drawing.kind='image';drawing.imageId=1;drawing.role='cell-image';
  const image=data.document.content[0].content[0].content[0];image.drawingType='inline';image.graphic.type='image';
  const table={type:'table',tblGrid:[100,100],content:[{type:'tblRow',content:[{type:'tblCell',content:[para(['A',image])]},{type:'tblCell',content:[para(['B'])]}]}]};
  data.document.content=[table];data.options.nativeTables.tables=[{ordinal:0,pageIndex:0,rows:1,columns:2,cells:[{row:0,column:0,rowSpan:1,columnSpan:1,leftPt:0,topPt:0,rightPt:50,bottomPt:50},{row:0,column:1,rowSpan:1,columnSpan:1,leftPt:50,topPt:0,rightPt:100,bottomPt:50}]}];
  data.options.textPlan={ok:true,pages:[{pageIndex:0,nodes:[table]}],assignments:[{id:'whole-table',pageIndex:0,start:0,end:2}],nodeMetadata:new WeakMap([[table,{pageIndex:0,start:0,end:2,tableOrdinal:0}]]),tableProof:[{ordinal:0,pageIndex:0,start:0,end:2,sourceIndices:[1,0],cells:[{row:0,column:0,sourceIndices:[1]},{row:0,column:1,sourceIndices:[0]}]}]};return data;
}

test('verified table permutations keep explicit original/canonical bijections and consume native cell images separately',()=>{
  assert.equal(typeof api.planPdfDrawingFlow,'function');
  const result=run(tableFixture());assert.equal(result.ok,true);const page=result.pages[0];assert.deepEqual(page.indices.canonicalToOriginal,[1,0]);assert.deepEqual(page.indices.originalToCanonical,[1,0]);assert.deepEqual(page.placements,[]);assert.equal(page.cellImages.length,1);assert.deepEqual(page.cellImages[0].cellOwner,{tableOrdinal:0,row:0,column:0});
  const tampered=tableFixture();tampered.options.textPlan.tableProof[0].sourceIndices=[0,0];refused(tampered,'invalid-text-plan');
  const crossing=tableFixture(),p=crossing.options.pdfDrawings.pages[0],source=p.sourcePaints[0],drawing=p.drawings[0],table=crossing.document.content[0],image=table.content[0].content[0].content[0].content[0].content.pop();
  source.kind='fill';source.fillRule='nonzero';source.role='drawing';source.imageId=null;source.imageBasis=null;source.cellOwners=[];drawing.kind='vector';drawing.role='figure';drawing.imageId=null;image.drawingType='anchor';image.graphic.type='shape';const wrapper=para([image]);crossing.document.content.unshift(wrapper);crossing.options.textPlan.pages[0].nodes.unshift(wrapper);crossing.options.textPlan.nodeMetadata.set(wrapper,{pageIndex:0});refused(crossing,'unproved-cell-owner');
});

test('coincident figure placements retain ledger order rather than sorting graphic IDs or coordinates',()=>{
  assert.equal(typeof api.planPdfDrawingFlow,'function');
  const data=fixture(),page=data.options.pdfDrawings.pages[0],second=structuredClone(page.sourcePaints[0]);second.id=2;second.paintOrdinal=2;second.nativeOrder=2;second.outputDocPrId=9;page.sourcePaints.push(second);
  const other={...structuredClone(page.drawings[0]),docPrId:9,nativeOrder:2,sourceIds:[2]};page.drawings.unshift(other);data.options.pdfDrawings.sourcePaintCount=2;data.options.pdfDrawings.outputDrawingCount=2;const image=structuredClone(data.document.content[0].content[0].content[0]);image.docPr.id=9;image.graphic.id='runtime-9';data.document.content[0].content[0].content.push(image);
  const result=run(data);assert.equal(result.ok,true);assert.deepEqual(result.pages[0].placements.map(entry=>entry.docPrId),[9,7]);assert.deepEqual(result.pages[0].placements.map(entry=>entry.boundary),[1,1]);
});

test('verified flow composes a figure at its proven boundary instead of prefixing the page scene',()=>{
  assert.equal(typeof api.composePdfDrawingFlow,'function');
  const data=fixture(),before=JSON.stringify(data.document),result=api.composePdfDrawingFlow(data.document,data.options);
  assert.equal(result.ok,true);
  const nodes=result.pages[0].nodes;
  assert.equal(nodes.length,3);assert.equal(nodes[0],data.document.content[1]);assert.equal(nodes[2],data.document.content[2]);
  assert.equal(nodes[1].content[0].content[0],data.document.content[0].content[0].content[0]);
  assert.deepEqual(result.nodeMetadata.get(nodes[1]),{pageIndex:0,drawingDocPrId:7,sourceBoundary:1});
  assert.deepEqual(result.assignments,data.options.textPlan.assignments);
  assert.equal(JSON.stringify(data.document),before);
});

test('composition preserves cell images and refuses under-text surfaces or unproved figure constraints without partial pages',()=>{
  assert.equal(typeof api.composePdfDrawingFlow,'function');
  const table=tableFixture(),result=api.composePdfDrawingFlow(table.document,table.options);
  assert.equal(result.ok,true);assert.deepEqual(result.pages[0].nodes,[table.document.content[0]]);
  for(const data of [fixture({role:'under-text',bounds:box(0,25),gap:null}),fixture({gap:null})]){
    const refused=api.composePdfDrawingFlow(data.document,data.options);
    assert.equal(refused.ok,false);assert.equal(Object.hasOwn(refused,'pages'),false);
  }
});
