import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {readPdfDrawings,validatePdfDrawings} from '../src/engine/pdf-drawings.js';
import {bindPdfDrawings} from '../src/content/pdf-drawing-bindings.js';
import {composePdfDrawingFlow} from '../src/content/pdf-drawing-flow.js';
import {planPdfReadingOrder} from '../src/content/pdf-layout.js';

// Authored protocol units; the independently authored native PDF is separate.
function curved(){
 const source={id:1,paintOrdinal:1,nativeOrder:1,clipId:0,kind:'fill',role:'drawing',bounds:{leftPt:11,topPt:11,rightPt:20,bottomPt:20},ctm:{a:200,b:5,c:-3,d:70,e:400,f:500},imageId:null,imageBasis:null,fillRule:'evenodd',normalComposite:true,solidFill:{r:25,g:102,b:229,a:255},path:[{command:'move',values:[12,12]},{command:'curve',values:[10,10,16,10,18,12]},{command:'line',values:[20,20]},{command:'close',values:[]}],outputDocPrId:1,textOwners:[],cellOwners:[]};
 const drawing={docPrId:1,nativeOrder:1,kind:'derived-vector',role:'figure',bounds:{leftPt:10,topPt:10,rightPt:20.125,bottomPt:20.125},rotation:0,flipH:false,flipV:false,imageId:1,representation:{format:'png',resourceName:'word/media/image1.png',pixelWidth:27,pixelHeight:27,dpi:192},sourceIds:[1],lineOverlaps:[],gap:null};
 const value={version:2,complete:true,coordinateSpace:'displayed-crop-top-left-pt',ordinalSpace:'native-renderer-paint-calls',sourcePageCount:1,sourcePaintCount:1,outputDrawingCount:1,formedLineCount:0,pages:[{pageIndex:0,widthPt:100,heightPt:100,clips:[],sourcePaints:[source],lines:[],drawings:[drawing]}]};
 const options={pages:[{W:100,H:100,Dpi:72}],nativeTables:{version:1,complete:true,coordinateSpace:'displayed-crop-top-left-pt',sourcePageCount:1,tables:[]},pdfText:{version:1,pages:[{pageIndex:0,text:''}],order:{version:1,coordinateSpace:'displayed-crop-top-left-pt',pages:[{pageIndex:0,widthPt:100,heightPt:100,unicodeScalars:[],scalarBoxesPt:[]}]}}};
 return {source,drawing,value,options};
}
const refused=f=>assert.throws(()=>validatePdfDrawings(f.value,f.options),{code:'PDF_DRAWINGS_UNVERIFIED'});

test('anchor and picture extents independently retain the native directional truncation boundary',async()=>{
 const root=new URL('fixtures/pdf-drawings/native056-v2/',import.meta.url),data=JSON.parse(await readFile(new URL('alpha-gap.json',root),'utf8'));
 const parser=vm.createContext({TextDecoder,TextEncoder});vm.runInContext(await readFile(new URL('../vendor/xmldom.js',import.meta.url),'utf8'),parser);
 const value=readPdfDrawings(new Uint8Array(await readFile(new URL('alpha-gap.drawings.xml',root))),data.options,parser.EngineXml.DOMParser);
 const original=structuredClone(data.document),id=value.pages[0].drawings[0].docPrId;
 for(const [anchor,picture]of [[638175,638174],[638174,638175]]){
  const model=structuredClone(original),node=bindPdfDrawings(value,model,data.options).byDocPrId.get(id).node;
  node.extent.cx=anchor;node.graphic.spPr.xfrm.ext.cx=picture;
  assert.equal(bindPdfDrawings(value,model,data.options).byDocPrId.get(id).node,node);
 }
 for(const target of ['anchor','picture'])for(const [key,values]of [['cx',[638173,638176]],['cy',[319086,319088]]])for(const amount of values){
  const model=structuredClone(original),node=bindPdfDrawings(value,model,data.options).byDocPrId.get(id).node;
  (target==='anchor'?node.extent:node.graphic.spPr.xfrm.ext)[key]=amount;
  assert.throws(()=>bindPdfDrawings(value,model,data.options),{code:'PDF_DRAWINGS_UNVERIFIED'});
 }
});

test('derived frame origin is the exact original control minimum, independently of sampled source bounds and CTM',()=>{
 const f=curved();assert.notEqual(f.source.bounds.leftPt,f.drawing.bounds.leftPt);assert.notEqual(f.source.bounds.topPt,f.drawing.bounds.topPt);
 assert.equal(validatePdfDrawings(f.value,f.options),f.value);
});

test('derived origin checks every original move, line and cubic coordinate pair',()=>{
 for(const command of ['move','line','curve'])for(const pair of command==='curve'?[0,2,4]:[0])for(const axis of [0,1]){
  const f=curved(),point=f.source.path.find(p=>p.command===command);point.values[pair+axis]=9;
  f.drawing.bounds[axis?'topPt':'leftPt']=9;f.drawing.bounds[axis?'bottomPt':'rightPt']=20.25;
  f.drawing.representation[axis?'pixelHeight':'pixelWidth']=30;
  assert.equal(validatePdfDrawings(f.value,f.options),f.value,command+' '+axis);
 }
});

test('derived origin refuses forged frame shifts, changed minimum controls and truncated viewports exactly',()=>{
 for(const axis of [0,1])for(const delta of [0.001,-0.001,1e-9,-1e-9]){
  const f=curved();f.drawing.bounds[axis?'topPt':'leftPt']+=delta;f.drawing.bounds[axis?'bottomPt':'rightPt']+=delta;refused(f);
 }
 for(const mutate of [f=>{f.source.path[1].values[0]-=0.001;},f=>{f.source.path[1].values[1]-=0.001;},f=>{f.drawing.bounds.rightPt-=0.375;},f=>{f.drawing.bounds.bottomPt-=0.375;},f=>{f.source.bounds.leftPt=9.999;},f=>{f.source.bounds.topPt=9.999;},f=>{f.source.bounds.rightPt=20.126;},f=>{f.source.bounds.bottomPt=20.126;}]){const f=curved();mutate(f);refused(f);}
});

test('genuine native060 cubic uses its control frame, full PNG and actual SDK picture between editable Before and After',async()=>{
 const root=new URL('fixtures/pdf-drawings/derived-origin/',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
 const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
 for(const [name,hash] of Object.entries(manifest.cases[0].files))assert.equal(sha(await readFile(new URL(name,root))),hash,name);
 const data=JSON.parse(await readFile(new URL('curve-control-min.json',root),'utf8')),xml=await readFile(new URL('curve-control-min.drawings.xml',root));
 const parser=vm.createContext({TextDecoder,TextEncoder});vm.runInContext(await readFile(new URL('../vendor/xmldom.js',import.meta.url),'utf8'),parser);
 const value=readPdfDrawings(new Uint8Array(xml),data.options,parser.EngineXml.DOMParser),page=value.pages[0],drawing=page.drawings[0],source=page.sourcePaints[0];
 assert.deepEqual(data.options.nativeTables.tables,[]);assert.deepEqual(page.lines.map(l=>l.text),['Before','After']);assert.deepEqual(drawing.gap,{beforeLine:0,afterLine:1});
 assert.ok(source.path.some(p=>p.command==='curve'));assert.ok(source.bounds.leftPt>drawing.bounds.leftPt);assert.ok(source.bounds.topPt>drawing.bounds.topPt);
 assert.equal(drawing.bounds.leftPt,Math.min(...source.path.flatMap(p=>p.values.filter((_,i)=>i%2===0))));
 assert.equal(drawing.bounds.topPt,Math.min(...source.path.flatMap(p=>p.values.filter((_,i)=>i%2===1))));
 const document=structuredClone(data.document),before=JSON.stringify(document),bound=bindPdfDrawings(value,document,data.options).byDocPrId.get(drawing.docPrId);
 assert.equal(bound.node.graphic.type,'image');assert.equal(bound.node.graphic.blipFill.rasterImageId,'image1.png');
 assert.deepEqual(bound.node.graphic.blipFill.srcRect,{l:0,t:0,r:100,b:100});
 const textPlan=planPdfReadingOrder(document,{...data.options,pdfLayout:{version:1,textAssociationType:2,flowGeometry:'native-plain-line-v1',nativeTables:data.options.nativeTables}});
 assert.equal(textPlan.ok,true);const flow=composePdfDrawingFlow(document,{...data.options,pdfDrawings:value,textPlan});assert.equal(flow.ok,true,flow.reason);assert.deepEqual(flow.drawingProof[0].cellFigures,[]);assert.equal(JSON.stringify(document),before);
 assert.deepEqual(Buffer.from(data.media[0].bytesBase64,'base64'),await readFile(new URL('curve-control-min.native.png',root)));
 for(const mutate of [node=>{node.graphic.blipFill.srcRect.l=1;},node=>{node.graphic.spPr.xfrm.ext.cx+=2;node.extent.cx+=2;},node=>{node.graphic.blipFill.rasterImageId='image2.png';}]){
  const changed=structuredClone(document);mutate(bindPdfDrawings(value,changed,data.options).byDocPrId.get(drawing.docPrId).node);assert.throws(()=>bindPdfDrawings(value,changed,data.options),{code:'PDF_DRAWINGS_UNVERIFIED'});
 }
});
