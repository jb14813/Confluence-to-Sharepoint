import test from 'node:test';import assert from 'node:assert/strict';
import {planPdfReadingOrder} from '../src/content/pdf-layout.js';

const layout={version:1,textAssociationType:2,flowGeometry:'native-plain-line-v1'};
const section={pgSz:{w:2000,h:2000}};
const text=(value,before=114)=>({type:'paragraph',pPr:{spacing:{before,line:200,lineRule:'exact'}},content:[{type:'run',content:[value]}]});
const anchor=value=>({type:'paraDrawing',drawingType:'anchor',positionH:{relativeFrom:'page',posOffset:0},positionV:{relativeFrom:'page',posOffset:40*12700},extent:{cx:20*12700,cy:10*12700},graphic:{type:'shape',id:'textbox',spPr:{xfrm:{ext:{cx:20*12700,cy:10*12700}}},content:{type:'docContent',content:[text(value)]}}});
const wrapper=drawing=>({type:'paragraph',pPr:{spacing:{line:1,lineRule:'exact'}},content:[{type:'run',content:[drawing]}]});
const source=(value,boxes)=>({version:1,coordinateSpace:'displayed-crop-top-left-pt',pages:[{pageIndex:0,widthPt:100,heightPt:100,rotation:0,unicodeScalars:Array.from(value,c=>c.codePointAt(0)),scalarBoxesPt:boxes??Array.from(value,(_,i)=>[i,10,i+1,20]),wordStarts:[0]}]});
const run=(doc,order,contract=layout)=>planPdfReadingOrder(doc,{pages:[{W:100,H:100,Dpi:72}],pdfText:{order},pdfLayout:contract});

test('exact native source intervals put the title before anchored body while keeping original editable nodes',()=>{
 const body=anchor('Body'),title=text('Title'),doc={type:'document',sectPr:section,content:[wrapper(body),title]};
 const order=source('TitleBody',[...Array.from('Title',(_,i)=>[i,10,i+1,20]),...Array.from('Body',(_,i)=>[i,40,i+1,50])]);
 const result=run(doc,order);assert.equal(result.ok,true);assert.equal(result.pages[0].nodes[0],title);
 assert.equal(result.pages[0].nodes[1].content[0].content[0],body);assert.equal(doc.content[0].content[0].content[0],body);
 assert.deepEqual(result.assignments.map(a=>[a.start,a.end]),[[5,9],[0,5]]);
});

test('missing native mode, ambiguous repeated text, missing scalars and noncontiguous units remain blocked',()=>{
 const doc={type:'document',sectPr:section,content:[text('AB')]};
 assert.equal(run(doc,source('AB'),null).ok,false);
 assert.equal(run(doc,source('AXB')).ok,false);
 assert.equal(run(doc,source('ABC')).ok,false);
 const repeated={type:'document',sectPr:section,content:[{type:'paragraph',content:['Same']},{type:'paragraph',content:['Same']}]};
 assert.equal(run(repeated,source('SameSame')).code,'ambiguous-coverage');
});

test('source normalization, unverified page coordinates and paragraph mode cannot supply an order proof',()=>{
 const doc={type:'document',sectPr:section,content:[text('e\u0301')]};
 assert.equal(run(doc,source('é')).ok,false);
 const rotated=source('e\u0301');rotated.pages[0].rotation=90;assert.equal(run(doc,rotated).ok,false);
 assert.equal(run(doc,source('e\u0301'),{...layout,textAssociationType:3}).ok,false);
});

test('the pinned SDK one-EMU extent quantization is accepted, while a two-EMU difference remains blocked',()=>{
 for(const nativeExtent of [1201879,1488320,966788]){
  const drawing=anchor('Body');drawing.extent.cx=nativeExtent;
  drawing.graphic.spPr.xfrm.ext.cx=(nativeExtent/36000*36000)>>0;
  assert.equal(nativeExtent-drawing.graphic.spPr.xfrm.ext.cx,1);
  const doc={type:'document',sectPr:section,content:[wrapper(drawing)]};
  const order=source('Body',Array.from('Body',(_,i)=>[i,40,i+1,50]));
  assert.equal(run(doc,order).ok,true);
  drawing.graphic.spPr.xfrm.ext.cx=nativeExtent-2;
  assert.equal(run(doc,order).code,'unproved-anchor-coordinates');
  drawing.graphic.spPr.xfrm.ext.cx=nativeExtent-.5;
  assert.equal(run(doc,order).code,'unproved-anchor-coordinates');
 }
});
