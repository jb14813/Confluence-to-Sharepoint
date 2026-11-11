import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import JSZip from 'jszip';
import {fixtures} from './engine-fixtures.mjs';
const zip=await JSZip.loadAsync(Buffer.from(fixtures['sample-rich.docx'],'base64')),png=await zip.file('word/media/image1.png').async('base64');
const source=await readFile(new URL('../src/engine/sandbox-decorations.js',import.meta.url),'utf8');
function run(budget){
  const context=vm.createContext({window:{},Uint8Array,atob,Map,document:{createElement:()=>({width:0,height:0,getContext:()=>({}),toDataURL:()=> 'data:image/png;base64,'+png})},AscCommon:{g_dKoef_mm_to_pix:96/25.4,IsShapeToImageConverter:false,CGraphics:class{m_oCoordTransform={};init(){}transform(){}},ShapeToImageConverter:()=>({ImageNative:{width:100,height:50},ImageUrl:'data:image/png;base64,'+png})},AscFormat:{CSlideBoundsChecker:class{Bounds={min_x:0,min_y:0,max_x:99,max_y:49};init(){}transform(){}CheckLineWidth(){}CorrectBounds2(){}}}});
  vm.runInContext(source,context);
  const shapes=Array.from({length:600},(_,i)=>({type:'shape',id:'shape-'+i,content:null,spPr:{fill:{fill:{type:'solid'}}}})),api={GetAllDrawingObjects:()=>shapes.map(shape=>({Drawing:{Get_Id:()=>shape.id,pageIndex:999,recalculate(){},draw(){}}}))};
  return context.window.ftsExportDecorations(api,{content:shapes},budget);
}
test('ordinary documents retain 512 drawings while verified PDF page quotas preserve all 600 eligible drawings',()=>{
  const ordinary=run();assert.equal(Object.keys(ordinary.decorations).length,512);assert.equal(ordinary.warnings.length,88);
  const pageForId=new Map(Array.from({length:600},(_,i)=>['shape-'+i,i<300?0:1]));
  const pdf=run({maxTotal:1024,pageForId,perPage:512});assert.equal(Object.keys(pdf.decorations).length,600);assert.equal(pdf.warnings.length,0);
});

function vectorHarness({pdf=true,fill='solid',bounds,draw,encode,liveText=false,modelText=false,type='shape'}={}){
 const calls={legacy:0,graphics:[],canvases:[]};
 class Checker{
  init(width,height){const density=width>1000?2:1;this.Bounds=bounds??{min_x:0,min_y:0,max_x:100*density-1,max_y:50*density-1};}
  transform(){} CheckLineWidth(){} CorrectBounds2(){}
 }
 class Graphics{
  m_oCoordTransform={};
  init(ctx,...frame){calls.graphics.push({frame,transform:this.m_oCoordTransform});}
  transform(){}
 }
 const context=vm.createContext({window:{},Uint8Array,atob,Map,document:{createElement:()=>{
  const canvas={width:0,height:0,getContext:()=>({}),toDataURL:()=>encode?encode():'data:image/png;base64,'+png};calls.canvases.push(canvas);return canvas;
 }},AscCommon:{g_dKoef_mm_to_pix:96/25.4,IsShapeToImageConverter:'previous',CGraphics:Graphics,ShapeToImageConverter:()=>{calls.legacy++;const canvas={width:100,height:50};calls.canvases.push(canvas);return{ImageNative:canvas,ImageUrl:'data:image/png;base64,'+png};}},AscFormat:{CSlideBoundsChecker:Checker}});
 vm.runInContext(source,context);
 const shape={type,id:'vector',content:modelText?{content:['Editable text']}:null,spPr:{fill:{fill:{type:fill}}}},drawing={Get_Id:()=>shape.id,recalculate(){},...(liveText?{textBoxContent:{}}:{}),draw(graphics){draw?.(graphics instanceof Graphics);}};
 const budget=pdf?{maxTotal:512,pageForId:new Map([[shape.id,0]]),perPage:512}:undefined;
 return {context,calls,invoke:()=>context.window.ftsExportDecorations({GetAllDrawingObjects:()=>[{Drawing:drawing}]},{content:[shape]},budget)};
}

test('verified PDF vectors use the existing SDK rasterizer at twice CSS pixel density',()=>{
 const h=vectorHarness(),output=h.invoke(),image=output.decorations.vector;
 assert.equal(h.calls.legacy,0);assert.equal(h.calls.graphics.length,1);
 assert.deepEqual(h.calls.graphics[0].frame,[1587,2245,210,297]);
 assert.equal(image.width,200);assert.equal(image.height,100);assert.equal(output.warnings.length,0);
 assert.equal(h.context.AscCommon.IsShapeToImageConverter,'previous');
 assert.ok(h.calls.canvases.every(c=>c.width===0&&c.height===0));
});

test('ordinary Word decorations keep their original SDK path and exact bytes',()=>{
 const h=vectorHarness({pdf:false,fill:'blipFill'}),output=h.invoke();
 assert.equal(h.calls.legacy,1);assert.equal(h.calls.graphics.length,0);
 assert.deepEqual(Buffer.from(output.decorations.vector.bytes),Buffer.from(png,'base64'));
 assert.equal(output.decorations.vector.width,100);assert.equal(output.decorations.vector.height,50);
 assert.ok(h.calls.canvases.every(c=>c.width===0&&c.height===0));
});

test('PDF raster-filled or unknown drawing density is explicit and original image nodes stay on their byte path',()=>{
 for(const fill of ['blipFill','unknown']){
  const h=vectorHarness({fill}),output=h.invoke();assert.equal(Object.keys(output.decorations).length,0);
  assert.equal(output.warnings[0].code,'DECORATION_UNAVAILABLE');assert.match(output.warnings[0].message,/resolution/i);
  assert.equal(h.calls.canvases.length,0);assert.equal(h.calls.legacy,0);
 }
 const image=vectorHarness({type:'image'}),output=image.invoke();
 assert.equal(Object.keys(output.decorations).length,0);assert.equal(output.warnings.length,0);assert.equal(image.calls.canvases.length,0);
});

test('text exclusion and oversize density bounds allocate no PDF canvas',()=>{
 for(const options of [{liveText:true},{modelText:true},{bounds:{min_x:0,min_y:0,max_x:4096,max_y:10}},{bounds:{min_x:0,min_y:0,max_x:2999,max_y:2999}}]){
  const h=vectorHarness(options),output=h.invoke();assert.equal(Object.keys(output.decorations).length,0);assert.equal(h.calls.canvases.length,0);
  assert.equal(h.context.AscCommon.IsShapeToImageConverter,'previous');
 }
});

test('fractional SDK pixel origins remain exact and encoding failures release the raster',()=>{
 const h=vectorHarness({bounds:{min_x:12.375,min_y:-3.125,max_x:111.125,max_y:45.875}}),output=h.invoke();
 assert.equal(output.decorations.vector.width,99);assert.equal(output.decorations.vector.height,50);
 assert.equal(h.calls.graphics[0].transform.tx,-12.375);assert.equal(h.calls.graphics[0].transform.ty,3.125);
 const failed=vectorHarness({encode(){throw new Error('Encode failure');}}),result=failed.invoke();
 assert.equal(result.warnings.length,1);assert.equal(Object.keys(result.decorations).length,0);
 assert.ok(failed.calls.canvases.every(c=>c.width===0&&c.height===0));assert.equal(failed.context.AscCommon.IsShapeToImageConverter,'previous');
});

test('an aborted SDK draw stops export and releases its canvas and converter flag',()=>{
 const h=vectorHarness({draw(graphics){if(graphics)throw Object.assign(new Error('Cancelled'),{name:'AbortError'});}});
 assert.throws(h.invoke,{name:'AbortError'});assert.equal(h.calls.canvases.length,1);
 assert.ok(h.calls.canvases.every(c=>c.width===0&&c.height===0));assert.equal(h.context.AscCommon.IsShapeToImageConverter,'previous');
});
test('PDF quotas use verified source associations and still reject a 513th drawing on one page',()=>{
  const pageForId=new Map(Array.from({length:600},(_,i)=>['shape-'+i,i<513?0:1]));
  const output=run({maxTotal:1024,pageForId,perPage:512});assert.equal(Object.keys(output.decorations).length,599);assert.equal(output.warnings.length,1);assert.equal(output.warnings[0].sourceId,'shape-512');
});
