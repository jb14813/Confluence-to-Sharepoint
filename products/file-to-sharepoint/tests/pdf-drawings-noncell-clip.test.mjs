import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePdfDrawings} from '../src/engine/pdf-drawings.js';

// Authored protocol unit records, not native renderer fixtures.
const bounds={leftPt:10,topPt:10,rightPt:20,bottomPt:20};
const command=(command,...values)=>({command,values});
function authored({underText=false,nativeMode=0,returnLine=false}={}){
 const source={id:1,paintOrdinal:1,nativeOrder:1,clipId:1,kind:'fill',role:'drawing',bounds:{...bounds},ctm:{a:1,b:0,c:0,d:1,e:0,f:0},imageId:null,imageBasis:null,fillRule:'evenodd',normalComposite:true,solidFill:{r:25,g:102,b:229,a:127},path:[command('move',10,10),command('curve',12,11,18,12,20,10),command('line',10,20),command('close')],outputDocPrId:1,textOwners:[],cellOwners:[]};
 const clip={id:1,nativeMode,path:[command('move',9,9),command('line',21,9),command('line',21,21),command('line',9,21),...(returnLine?[command('line',9,9)]:[]),command('close')]};
 const drawing={docPrId:1,nativeOrder:1,kind:'derived-vector',role:underText?'under-text':'figure',bounds:{leftPt:10,topPt:10,rightPt:20.125,bottomPt:20.125},rotation:0,flipH:false,flipV:false,imageId:1,representation:{format:'png',resourceName:'word/media/image1.png',pixelWidth:27,pixelHeight:27,dpi:192},sourceIds:[1],lineOverlaps:underText?[0]:[],gap:null};
 const lines=underText?[{ordinal:0,nativeOrder:2,firstPaintOrdinal:2,bounds:{leftPt:12,topPt:12,rightPt:18,bottomPt:18},text:'A'}]:[];
 const value={version:2,complete:true,coordinateSpace:'displayed-crop-top-left-pt',ordinalSpace:'native-renderer-paint-calls',sourcePageCount:1,sourcePaintCount:1,outputDrawingCount:1,formedLineCount:lines.length,pages:[{pageIndex:0,widthPt:100,heightPt:100,clips:[clip],sourcePaints:[source],lines,drawings:[drawing]}]};
 const options={pages:[{W:100,H:100,Dpi:72}],nativeTables:{version:1,complete:true,coordinateSpace:'displayed-crop-top-left-pt',sourcePageCount:1,tables:[]},pdfText:{version:1,pages:[{pageIndex:0,text:underText?'A':''}],order:{version:1,coordinateSpace:'displayed-crop-top-left-pt',pages:[{pageIndex:0,widthPt:100,heightPt:100,unicodeScalars:underText?[65]:[],scalarBoxesPt:underText?[[12,12,18,18]]:[]}]}}};
 return {value,options,source,clip,drawing};
}
const refused=({value,options})=>assert.throws(()=>validatePdfDrawings(value,options),{code:'PDF_DRAWINGS_UNVERIFIED'});

test('noncell derived PNGs retain crossing and touching rectangular clips',()=>{
 for(const underText of [false,true])for(const nativeMode of [0,1])for(const returnLine of [false,true])for(const left of [10,12]){
  const f=authored({underText,nativeMode,returnLine});
  for(const p of f.clip.path)if(p.values[0]===9)p.values[0]=left;
  const original=structuredClone(f.value);
  assert.equal(validatePdfDrawings(f.value,f.options),f.value);
  assert.deepEqual(f.value,original);
 }
});

test('noncell derived figures and underlays accept only the existing harmless rectangle proof in either native clip mode',()=>{
 for(const underText of [false,true])for(const nativeMode of [0,1])for(const returnLine of [false,true]){
  const fixture=authored({underText,nativeMode,returnLine});
  assert.equal(validatePdfDrawings(fixture.value,fixture.options),fixture.value);
  assert.equal(fixture.source.role,'drawing');assert.deepEqual(fixture.source.cellOwners,[]);
  // CTM is provenance: displayed clip/path coordinates are not transformed again.
  fixture.source.ctm={a:200,b:5,c:-3,d:70,e:400,f:500};
  assert.equal(validatePdfDrawings(fixture.value,fixture.options),fixture.value);
 }
});
test('noncell derived clips still refuse malformed, disjoint, skewed, multiple and holed clips',()=>{
 for(const nativeMode of [0,1])for(const mutate of [
  f=>{f.clip.path[0].values=[10,9];},
  f=>{for(const p of f.clip.path)if(p.values.length)p.values[0]+=50;},
  f=>{f.clip.path[2].values=[9,9];},
  f=>{f.clip.path.pop();},
  f=>{f.clip.path[1]=command('curve',21,9,21,9,21,9);},
  f=>{f.clip.path[1].values=[22,10];},
  f=>{[f.clip.path[1],f.clip.path[2]]=[f.clip.path[2],f.clip.path[1]];},
  f=>{f.clip.path.splice(-1,0,command('line',9,10));},
  f=>{f.clip.path.push(command('move',11,11),command('line',19,11),command('line',19,19),command('line',11,19),command('close'));},
  f=>{f.clip.path.push(command('move',30,30),command('close'));},
 ]){const f=authored({nativeMode});mutate(f);refused(f);}
});
test('newly eligible crossing clips cannot waive source, origin, representation, ownership or line-order guards',()=>{
 for(const mutate of [
  f=>{f.source.fillRule='nonzero';},f=>{f.source.solidFill=null;},f=>{f.source.normalComposite=false;},f=>{f.source.path=[];},
  f=>{f.drawing.bounds.leftPt+=0.000000001;f.drawing.bounds.rightPt+=0.000000001;},f=>{f.drawing.bounds.topPt+=0.000000001;f.drawing.bounds.bottomPt+=0.000000001;},f=>{f.source.bounds.rightPt=21;},
  f=>{f.drawing.representation.dpi=191;},f=>{f.drawing.representation.pixelWidth=28;},f=>{f.drawing.rotation=1;},
  f=>{f.source.cellOwners=[{tableOrdinal:0,row:0,column:0}];},f=>{f.source.role='cell-figure';},
  f=>{f.drawing.role='under-text';},f=>{f.drawing.lineOverlaps=[0];},
 ]){const f=authored();for(const p of f.clip.path)if(p.values[0]===9)p.values[0]=12;mutate(f);refused(f);}
 for(const mutate of [f=>{f.value.pages[0].lines[0].firstPaintOrdinal=1;},f=>{f.drawing.lineOverlaps=[];},f=>{f.drawing.role='figure';f.drawing.lineOverlaps=[];}]){
  const f=authored({underText:true});for(const p of f.clip.path)if(p.values[0]===9)p.values[0]=12;assert.equal(validatePdfDrawings(f.value,f.options),f.value);mutate(f);refused(f);
 }
 // Plain vectors receive no new clip eligibility through the derived-vector branch.
 const f=authored();f.drawing.kind='vector';f.drawing.imageId=null;f.drawing.representation=null;refused(f);
});
import {readFile}from'node:fs/promises';
import vm from'node:vm';
import {readPdfDrawings}from'../src/engine/pdf-drawings.js';
import {bindPdfDrawings}from'../src/content/pdf-drawing-bindings.js';

const rectFixtures=new URL('fixtures/pdf-drawings/noncell-rect-clip/',import.meta.url);
const xmlParser=vm.createContext({TextDecoder,TextEncoder});vm.runInContext(await readFile(new URL('../vendor/xmldom.js',import.meta.url),'utf8'),xmlParser);
async function nativeFixture(name,root=rectFixtures){const data=JSON.parse(await readFile(new URL(name+'.json',root),'utf8')),xml=await readFile(new URL(name+'.drawings.xml',root));return {data,value:readPdfDrawings(new Uint8Array(xml),data.options,xmlParser.EngineXml.DOMParser)};}

test('genuine newly eligible noncell clips keep source, exact-origin, viewport and SDK binding refusals',async()=>{
 for(const relation of ['crossing','touching'])for(const mode of [0,1]){
  const {data,value}=await nativeFixture(`curve-${relation}-mode${mode}`);
  assert.equal(validatePdfDrawings(value,data.options),value);const page=value.pages[0],drawing=page.drawings[0],source=page.sourcePaints[0];
  assert.ok(source.bounds.leftPt>drawing.bounds.leftPt);assert.ok(source.bounds.topPt>drawing.bounds.topPt);
  for(const mutate of [
   s=>{s.fillRule='nonzero';},s=>{s.solidFill=null;},s=>{s.normalComposite=false;},s=>{s.path=[];},s=>{s.kind='stroke';s.fillRule=null;s.solidFill=null;},
   s=>{s.bounds.leftPt=drawing.bounds.leftPt-1e-9;},s=>{s.bounds.topPt=drawing.bounds.topPt-1e-9;},s=>{s.bounds.rightPt=drawing.bounds.rightPt+1e-9;},s=>{s.bounds.bottomPt=drawing.bounds.bottomPt+1e-9;},
   s=>{s.path.find(p=>p.command==='curve').values[0]-=1e-9;},s=>{s.path.find(p=>p.command==='curve').values[3]-=1e-9;},
   s=>{s.outputDocPrId=2;},s=>{s.imageId=1;},s=>{s.textOwners=[{nativeOrder:1,bounds:{...s.bounds},text:'Before'}];},s=>{s.cellOwners=[{tableOrdinal:0,row:0,column:0}];},
  ]){const changed=structuredClone(value);mutate(changed.pages[0].sourcePaints[0]);assert.throws(()=>validatePdfDrawings(changed,data.options),{code:'PDF_DRAWINGS_UNVERIFIED'});}
  for(const mutate of [
   d=>{d.bounds.leftPt+=1e-9;d.bounds.rightPt+=1e-9;},d=>{d.bounds.topPt+=1e-9;d.bounds.bottomPt+=1e-9;},
   d=>{d.bounds.rightPt-=.375;},d=>{d.bounds.bottomPt-=.375;},d=>{d.representation.dpi=191;},d=>{d.representation.pixelWidth++;},d=>{d.representation.pixelHeight++;},d=>{d.representation.pixelWidth=4097;},d=>{d.representation.pixelWidth=4096;d.representation.pixelHeight=4096;},
   d=>{d.representation.resourceName='word/media/image2.png';},d=>{d.representation.format='jpeg';},d=>{d.rotation=1;},d=>{d.flipH=true;},d=>{d.flipV=true;},d=>{d.sourceIds=[1,1];},d=>{d.role='under-text';},
  ]){const changed=structuredClone(value);mutate(changed.pages[0].drawings[0]);assert.throws(()=>validatePdfDrawings(changed,data.options),{code:'PDF_DRAWINGS_UNVERIFIED'});}
  assert.throws(()=>validatePdfDrawings(value,{...data.options,pdfText:null}),{code:'PDF_DRAWINGS_UNVERIFIED'});
  const bound=bindPdfDrawings(value,data.document,data.options).byDocPrId.get(drawing.docPrId);assert.equal(bound.node.graphic.type,'image');assert.deepEqual(bound.node.graphic.blipFill.srcRect,{l:0,t:0,r:100,b:100});
  for(const mutate of [
   n=>{n.graphic.blipFill.srcRect.l=1;},n=>{n.graphic.blipFill.srcRect.t=1;},n=>{n.graphic.blipFill.srcRect.r=99;},n=>{n.graphic.blipFill.srcRect.b=99;},
   n=>{n.extent.cx+=2;n.graphic.spPr.xfrm.ext.cx+=2;},n=>{n.extent.cy+=2;n.graphic.spPr.xfrm.ext.cy+=2;},n=>{n.graphic.blipFill.rasterImageId='image2.png';},n=>{n.docPr.id=2;},n=>{n.graphic.type='shape';},
  ]){const document=structuredClone(data.document),node=bindPdfDrawings(value,document,data.options).byDocPrId.get(drawing.docPrId).node;mutate(node);assert.throws(()=>bindPdfDrawings(value,document,data.options),{code:'PDF_DRAWINGS_UNVERIFIED'});}
 }
});

test('genuine newly eligible figures refuse every malformed or nonintersecting rectangle exactly',async()=>{
 for(const mode of [0,1]){
  const {data,value}=await nativeFixture(`hole-crossing-mode${mode}`),original=value.pages[0].clips[0].path,points=original.filter(c=>c.command!=='close').slice(0,4).map(c=>c.values),[a,b,c,d]=points;
  const path=p=>[...p.map((v,i)=>command(i?'line':'move',...v)),command('close')];
  const clips=[
   path([a,b,c,c]), // duplicate corner
   path([a,c,b,d]), // bowtie
   path([a,[a[0],b[1]],[a[0],c[1]],[a[0],d[1]]]), // zero-width
   path([a,[b[0]+1,b[1]+1],c,d]), // skew
   path(points).slice(0,-1), // open
   [command('move',...a),command('curve',...b,...b,...b),...path(points).slice(2)],
   [...path(points),...path(points)], // duplicate subpath
   [...path(points),...path([[105,100],[110,100],[110,105],[105,105]])], // hole
   path(points.map(([x,y])=>[x+100,y])), // disjoint
   path(points.map(([x,y])=>[x+30,y])), // zero-area contact with source right=130
   [...path(points).slice(0,-1),command('line',a[0]+1,a[1]),command('close')], // extra vertex
  ];
  for(const clip of clips){const changed=structuredClone(value);changed.pages[0].clips[0].path=clip;assert.throws(()=>validatePdfDrawings(changed,data.options),{code:'PDF_DRAWINGS_UNVERIFIED'});}
 }
});

test('cell derived figures still refuse touching and crossing clips in both modes while harmless and clip0 remain valid',async()=>{
 const root=new URL('fixtures/pdf-drawings/native056-v2/',import.meta.url),{data,value}=await nativeFixture('alpha-gap',root);
 assert.equal(validatePdfDrawings(value,data.options),value);
 const source=value.pages[0].sourcePaints.find(s=>s.role==='cell-figure'),xs=source.path.flatMap(p=>p.values.filter((_,i)=>i%2===0)),ys=source.path.flatMap(p=>p.values.filter((_,i)=>i%2===1)),left=Math.min(...xs),top=Math.min(...ys),right=Math.max(...xs),bottom=Math.max(...ys);
 for(const nativeMode of [0,1])for(const relation of ['harmless','touching','crossing']){
  const changed=structuredClone(value),page=changed.pages[0],s=page.sourcePaints.find(p=>p.role==='cell-figure'),x=relation==='harmless'?left-1:relation==='touching'?left:(left+right)/2;
  s.clipId=1;page.clips=[{id:1,nativeMode,path:[command('move',x,top-1),command('line',right+1,top-1),command('line',right+1,bottom+1),command('line',x,bottom+1),command('close')]}];
  if(relation==='harmless')assert.equal(validatePdfDrawings(changed,data.options),changed);else assert.throws(()=>validatePdfDrawings(changed,data.options),{code:'PDF_DRAWINGS_UNVERIFIED'});
 }
});


test('existing native vector eligibility remains independent of noncell derived PNG clip eligibility',()=>{
 for(const nativeMode of [0,1])for(const left of [10,12]){
  const f=authored({nativeMode});for(const p of f.clip.path)if(p.values[0]===9)p.values[0]=left;
  f.drawing.kind='vector';f.drawing.imageId=null;f.drawing.representation=null;f.source.fillRule='nonzero';
  assert.equal(validatePdfDrawings(f.value,f.options),f.value);
  f.source.fillRule='evenodd';refused(f);
 }
});
