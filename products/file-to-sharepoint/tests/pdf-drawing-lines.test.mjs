import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePdfDrawings} from '../src/engine/pdf-drawings.js';

const api=await import('../src/content/pdf-drawing-bindings.js');
const bounds=(y=0)=>({leftPt:0,topPt:y,rightPt:100,bottomPt:y+5});
function fixture(text,lines,boxes){
  const scalars=Array.from(text,char=>char.codePointAt(0)),pages=[{W:100,H:100,Dpi:72}];
  const options={pages,nativeTables:{version:1,complete:true,coordinateSpace:'displayed-crop-top-left-pt',sourcePageCount:1,tables:[]},pdfText:{version:1,pages:[{pageIndex:0,text}],order:{version:1,coordinateSpace:'displayed-crop-top-left-pt',pages:[{pageIndex:0,widthPt:100,heightPt:100,rotation:0,unicodeScalars:scalars,scalarBoxesPt:boxes??scalars.map((_,index)=>[index,0,index+1,5])}]}}};
  const value={version:2,complete:true,coordinateSpace:'displayed-crop-top-left-pt',ordinalSpace:'native-renderer-paint-calls',sourcePageCount:1,sourcePaintCount:0,outputDrawingCount:0,formedLineCount:lines.length,pages:[{pageIndex:0,widthPt:100,heightPt:100,clips:[],sourcePaints:[],lines:lines.map((line,ordinal)=>({ordinal,nativeOrder:lines.length+100-ordinal,firstPaintOrdinal:ordinal+2,bounds:bounds(line.y),text:line.text})),drawings:[]}]};
  return {value,options};
}
const bind=({value,options})=>api.bindPdfDrawingLines(value,options);
const refused=fixture=>assert.throws(()=>bind(fixture),error=>error.code==='PDF_DRAWINGS_UNVERIFIED');

test('native line ordinals bind exact original Reader scalar occurrences without treating native order as flow',()=>{
  assert.equal(typeof api.bindPdfDrawingLines,'function');
  const data=fixture('A😀é',[{text:'é'},{text:' A😀 '}]),before=structuredClone(data),result=bind(data),page=result.pages[0];
  assert.deepEqual(page.orderedOrdinals,[1,0]);
  assert.deepEqual(page.byOrdinal.get(0).sourceIndices,[2,3]);
  assert.deepEqual(page.byOrdinal.get(1).sourceIndices,[0,1]);
  assert.equal(page.byOrdinal.get(1).line,data.value.pages[0].lines[1]);
  assert.equal(page.byOrdinal.get(0).start,2);assert.equal(page.byOrdinal.get(0).end,4);
  assert.deepEqual(data,before);
});

test('repeated exact Unicode requires a unique source occurrence and geometry can resolve only repetition',()=>{
  assert.equal(typeof api.bindPdfDrawingLines,'function');
  const repeated=fixture('ABAB',[{text:'AB',y:10},{text:'AB',y:0}],[[0,0,1,5],[1,0,2,5],[0,10,1,15],[1,10,2,15]]),page=bind(repeated).pages[0];
  assert.deepEqual(page.byOrdinal.get(0).sourceIndices,[2,3]);assert.deepEqual(page.byOrdinal.get(1).sourceIndices,[0,1]);
  const ambiguous=structuredClone(repeated);ambiguous.value.pages[0].lines[0].bounds=ambiguous.value.pages[0].lines[1].bounds={leftPt:0,topPt:0,rightPt:100,bottomPt:100};refused(ambiguous);
  const different=structuredClone(repeated);different.value.pages[0].lines[0].text='AC';refused(different);
  const missingBoxes=structuredClone(repeated);delete missingBoxes.options.pdfText.order.pages[0].scalarBoxesPt;refused(missingBoxes);
});

test('zero-scalar native lines stay unanchored and cannot borrow a neighbouring occurrence',()=>{
  assert.equal(typeof api.bindPdfDrawingLines,'function');
  const page=bind(fixture('A',[{text:' \t'},{text:'A'}])).pages[0];
  assert.deepEqual(page.byOrdinal.get(0),{line:page.byOrdinal.get(0).line,start:null,end:null,sourceIndices:[]});
  assert.deepEqual(page.orderedOrdinals,[1]);assert.deepEqual(page.byOrdinal.get(1).sourceIndices,[0]);
  const empty=bind(fixture('',[])).pages[0];assert.deepEqual(empty.orderedOrdinals,[]);assert.equal(empty.byOrdinal.size,0);
});

test('normalization, overlapping coverage and pathological repeated matching do not invent scalar identities',()=>{
  assert.equal(typeof api.bindPdfDrawingLines,'function');
  refused(fixture('é',[{text:'é'}]));
  refused(fixture('AB',[{text:'AB'},{text:'A'}]));
  const noncontiguous=fixture('ACBD',[{text:'AB'},{text:'CD'}]);refused(noncontiguous);
  const repeated=fixture('A'.repeat(300),Array.from({length:300},()=>({text:'A'})),Array.from({length:300},()=>[0,0,1,5]));
  assert.equal(validatePdfDrawings(repeated.value,repeated.options),repeated.value);refused(repeated);
  const joiners=bind(fixture('A\u200c\u200dB',[{text:'A\u200c\u200dB'}])).pages[0];assert.deepEqual(joiners.byOrdinal.get(0).sourceIndices,[0,1,2,3]);
});
