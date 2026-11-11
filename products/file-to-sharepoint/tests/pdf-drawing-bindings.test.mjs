import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {readPdfDrawings} from '../src/engine/pdf-drawings.js';

const api=await import('../src/content/pdf-drawing-bindings.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const pages=[{W:100,H:100,Dpi:72},{W:200,H:100,Dpi:72}],bounds={leftPt:10,topPt:10,rightPt:20,bottomPt:20};
const nativeTables={version:1,complete:true,coordinateSpace:'displayed-crop-top-left-pt',sourcePageCount:2,tables:[]};
const pdfText={version:1,pages:pages.map((_,pageIndex)=>({pageIndex,text:''})),order:{version:1,coordinateSpace:'displayed-crop-top-left-pt',pages:pages.map((page,pageIndex)=>({pageIndex,widthPt:page.W,heightPt:page.H,unicodeScalars:[]}))}};
const options={pages,nativeTables,pdfText};
const drawing=(docPrId=7,kind='vector',role='figure')=>({docPrId,nativeOrder:1,kind,role,bounds,rotation:0,flipH:false,flipV:false,imageId:kind==='image'?1:null,representation:null,sourceIds:[1],lineOverlaps:[],gap:null});
const source=(docPrId=7,kind='fill',role='drawing')=>({id:1,paintOrdinal:1,nativeOrder:1,clipId:0,kind,role,bounds,ctm:{a:1,b:0,c:0,d:1,e:0,f:0},imageId:kind==='image'?1:null,imageBasis:kind==='image'?{a:10,b:0,c:0,d:10,e:10,f:10}:null,fillRule:kind==='fill'?'nonzero':null,normalComposite:true,solidFill:null,path:[],outputDocPrId:docPrId,textOwners:[],cellOwners:[]});
const ledger=()=>({version:2,complete:true,coordinateSpace:'displayed-crop-top-left-pt',ordinalSpace:'native-renderer-paint-calls',sourcePageCount:2,sourcePaintCount:1,outputDrawingCount:1,formedLineCount:0,pages:pages.map((page,pageIndex)=>({pageIndex,widthPt:page.W,heightPt:page.H,clips:[],sourcePaints:pageIndex?[]:[source()],lines:[],drawings:pageIndex?[]:[drawing()]}))});
const paraDrawing=(id=7,graphicId='runtime-99',type='shape')=>({type:'paraDrawing',docPr:{id,name:'Source name'},drawingType:'anchor',graphic:{id:graphicId,type,content:null}});
const paragraph=content=>({type:'paragraph',content:[{type:'run',content}]});
const document=()=>({type:'document',content:[paragraph([paraDrawing()]),{...paragraph([]),pPr:{sectPr:{type:'nextPage',pgSz:{w:2000,h:2000}}}},paragraph([])],sectPr:{pgSz:{w:4000,h:2000}}});
const bind=(value=ledger(),model=document(),settings=options)=>api.bindPdfDrawings(value,model,settings);
const refused=(value,model,settings)=>assert.throws(()=>bind(value,model,settings),error=>error.code==='PDF_DRAWINGS_UNVERIFIED');

test('exact docPr identity binds a different runtime graphic ID and native source page without geometry matching',()=>{
  assert.equal(typeof api.bindPdfDrawings,'function');
  const model=document(),value=ledger(),result=bind(value,model);
  const entry=result.byDocPrId.get(7);
  assert.equal(entry.graphicId,'runtime-99');assert.equal(entry.pageIndex,0);
  assert.equal(entry.drawing,value.pages[0].drawings[0]);assert.equal(entry.node,model.content[0].content[0].content[0]);
  assert.equal(result.byGraphicId.get('runtime-99'),entry);assert.equal(result.pages[0].drawings[0],entry);
  assert.equal(entry.cellOwner,null);
});

test('missing, duplicate, extra or wrong-page SDK identities cannot reuse source IDs or source coordinates',()=>{
  assert.equal(typeof api.bindPdfDrawings,'function');
  for(const mutate of [
    model=>{model.content[0].content[0].content[0].docPr.id=8;},
    model=>{model.content[0].content[0].content.push(paraDrawing());},
    model=>{model.content[0].content[0].content.push(paraDrawing(8,'runtime-100'));},
    model=>{model.content[2].content[0].content.push(model.content[0].content[0].content.pop());},
    model=>{model.content[0].content[0].content[0].docPr.id='7';},
    model=>{model.content[0].content[0].content[0].graphic.id='';},
    model=>{model.content[0].content[0].content[0].graphic.type='image';},
    model=>{model.sectPr.pgSz.w=2000;},
  ]){const model=document();mutate(model);refused(ledger(),model);}
  const value=ledger();value.pages[1].sourcePaints=[{...source(8),id:1}];value.pages[1].drawings=[drawing(8)];value.sourcePaintCount++;value.outputDrawingCount++;
  const model=document();model.content[2].content[0].content.push(paraDrawing(8));refused(value,model); // duplicate runtime ID
});

test('inline cell images bind only to exact native root-table ordinal and verified merged-cell topology',()=>{
  assert.equal(typeof api.bindPdfDrawings,'function');
  const value=ledger(),s=source(7,'image','cell-image');s.cellOwners=[{tableOrdinal:0,row:0,column:0}];value.pages[0].sourcePaints=[s];value.pages[0].drawings=[drawing(7,'image','cell-image')];
  const image={...paraDrawing(7,'runtime-99','image'),drawingType:'inline'};
  const table={type:'table',tblGrid:[100,100],content:[{type:'tblRow',content:[{type:'tblCell',tcPr:{gridSpan:2,vMerge:'restart'},content:[paragraph([image])]}]},{type:'tblRow',content:[{type:'tblCell',tcPr:{gridSpan:2,vMerge:'continue'},content:[paragraph([])]}]}]};
  const model=document();model.content[0]=table;
  const settings={...options,nativeTables:{...nativeTables,tables:[{ordinal:0,pageIndex:0,rows:2,columns:2,cells:[{row:0,column:0,rowSpan:2,columnSpan:2,leftPt:0,topPt:0,rightPt:40,bottomPt:40}]}]}};
  assert.deepEqual(bind(value,model,settings).byDocPrId.get(7).cellOwner,{tableOrdinal:0,row:0,column:0});
  for(const mutate of [
    model=>{model.content[0].content[0].content[0].tcPr.gridSpan=1;},
    model=>{model.content[0].content[1].content[0].content[0].content[0].content.push('hidden continuation');},
    model=>{model.content[0].content[0].content[0].content[0].content[0].content[0].drawingType='anchor';},
    model=>{model.content[0].content[0].content[0].content.push(structuredClone(table));},
  ]){const changed=structuredClone(model);mutate(changed);refused(value,changed,settings);}
  const outside=document();outside.content[0].content[0].content=[image];outside.content.splice(1,0,{...table,content:table.content.map(row=>({...row,content:row.content.map(cell=>({...cell,content:[paragraph([])]}))}))});refused(value,outside,settings);
});

test('binding repeats Reader/source validation and rejects unknown drawings in nested editable content',()=>{
  assert.equal(typeof api.bindPdfDrawings,'function');
  refused(ledger(),document(),{...options,pdfText:null});
  const value=ledger();value.pages[0].sourcePaints[0].outputDocPrId=8;refused(value,document());
  const model=document();model.content[0].content[0].content[0].graphic.content={type:'docContent',content:[paragraph([paraDrawing(8,'nested')])]};refused(ledger(),model);
  const wrapper=ledger();wrapper.sourcePaintCount=0;wrapper.pages[0].sourcePaints=[];wrapper.pages[0].drawings[0]={...drawing(7,'text','editable-text-wrapper'),sourceIds:[]};
  for(const content of ['untyped text',{type:'unverified',content:[]}]){
    const changed=document();changed.content[0].content[0].content[0].graphic.content=content;refused(wrapper,changed);
  }
  const unknown=document();unknown.content[0].type='unverified';refused(ledger(),unknown);
});

test('historical native028 and native039 SDK snapshots cannot bypass V2 provenance',async()=>{
  const context=vm.createContext({TextDecoder,TextEncoder});vm.runInContext(await readFile(new URL('../vendor/xmldom.js',import.meta.url),'utf8'),context);
  for(const name of ['core','list-cell','zero','reflected-image','paint-before','paint-between','paint-after','cell-figure-triangle-gap','cell-figure-alpha-gap','cell-figure-filled-curve-gap']){
    const xml=await readFile(new URL(`fixtures/pdf-drawings/${name}.xml`,import.meta.url)),fixture=JSON.parse(await readFile(new URL(`fixtures/pdf-drawings/${name}.json`,import.meta.url),'utf8'));
    assert.equal(createHash('sha256').update(xml).digest('hex'),fixture.privatePartSha256);
    assert.throws(()=>readPdfDrawings(new Uint8Array(xml),fixture.options,context.EngineXml.DOMParser),error=>error.code==='PDF_DRAWINGS_UNVERIFIED');
  }
});
