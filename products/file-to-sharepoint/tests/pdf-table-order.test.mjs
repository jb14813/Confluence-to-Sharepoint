import test from 'node:test';import assert from 'node:assert/strict';
import {planPdfTableOrder} from '../src/content/pdf-table-order.js';
import {planPdfReadingOrder} from '../src/content/pdf-layout.js';

const para=text=>({type:'paragraph',content:[{type:'run',content:[text]}]});
const cell=text=>({type:'tblCell',content:[para(text)]});
const fixture=()=>{
 const node={type:'table',tblGrid:[{w:100},{w:100}],content:[{type:'tblRow',content:[cell('A'),cell('B')]},{type:'tblRow',content:[cell('C'),cell('D')]}]},document={type:'document',content:[node]};
 const pages=[{W:100,H:100,Dpi:72}],source={pageIndex:0,rotation:0,widthPt:100,heightPt:100,unicodeScalars:Array.from('XACBDY',c=>c.codePointAt(0)),scalarBoxesPt:[[1,1,2,2],[12,12,14,14],[12,22,14,24],[22,12,24,14],[22,22,24,24],[1,40,2,42]]};
 const nativeTables={version:1,complete:true,coordinateSpace:'displayed-crop-top-left-pt',sourcePageCount:1,tables:[{ordinal:0,pageIndex:0,rows:2,columns:2,cells:[
  {row:0,column:0,rowSpan:1,columnSpan:1,leftPt:10,topPt:10,rightPt:20,bottomPt:20},
  {row:0,column:1,rowSpan:1,columnSpan:1,leftPt:20,topPt:10,rightPt:30,bottomPt:20},
  {row:1,column:0,rowSpan:1,columnSpan:1,leftPt:10,topPt:20,rightPt:20,bottomPt:30},
  {row:1,column:1,rowSpan:1,columnSpan:1,leftPt:20,topPt:20,rightPt:30,bottomPt:30}]}]};
 return {document,node,options:{nativeTables,pages,sources:[source],pageAssociation:new Map([[node,0]])}};
};
const text=source=>source.unicodeScalars.map(c=>String.fromCodePoint(c)).join('');

test('production reading-order planner retains the intact table between verified surrounding paragraphs',()=>{
 const f=fixture(),before=para('X'),after=para('Y');f.document.sectPr={pgSz:{w:2000,h:2000}};f.document.content=[before,f.node,after];f.options.pageAssociation.set(before,0);f.options.pageAssociation.set(after,0);
 const result=planPdfReadingOrder(f.document,{pages:f.options.pages,pdfText:{order:{version:1,coordinateSpace:'displayed-crop-top-left-pt',pages:f.options.sources}},pdfLayout:{version:1,textAssociationType:2,flowGeometry:'native-plain-line-v1',nativeTables:f.options.nativeTables}});
 assert.equal(result.ok,true);assert.deepEqual(result.pages[0].nodes,[before,f.node,after]);assert.deepEqual(result.tableProof[0].sourceIndices,[1,3,2,4]);
});

test('native closed grid verifies each editable SDK cell before row-major interval permutation',()=>{
 const {document,node,options}=fixture(),original=options.sources[0],result=planPdfTableOrder(document,options);
 assert.equal(result.ok,true);assert.equal(text(result.sources[0]),'XABCDY');assert.equal(text(original),'XACBDY');
 assert.deepEqual(result.proof[0].sourceIndices,[1,3,2,4]);assert.equal(result.tables.get(node).ordinal,0);
 assert.equal(result.sources[0].scalarBoxesPt[2],original.scalarBoxesPt[3]);
});

test('extra/missing SDK tables, wrong topology and wrong per-cell text remain blocked',()=>{
 for(const change of [f=>f.document.content=[],f=>f.node.content.pop(),f=>f.node.content[0].content[0]=cell('Z'),f=>delete f.options.nativeTables]){
  const f=fixture();change(f);assert.equal(planPdfTableOrder(f.document,f.options).ok,false);
 }
});

test('partially contained glyphs and ambiguous zero-width boundary glyphs are rejected',()=>{
 for(const box of [[19,12,21,14],[20,12,20,14]]){const f=fixture();f.options.sources[0].scalarBoxesPt[1]=box;assert.equal(planPdfTableOrder(f.document,f.options).ok,false);}
});

test('outside text cannot be swallowed to make a noncontiguous table interval',()=>{
 const f=fixture();f.options.sources[0].scalarBoxesPt[2]=[1,2,2,4];assert.equal(planPdfTableOrder(f.document,f.options).code,'noncontiguous-table-source');
});

test('source Unicode remains exact, and budgets/page association fail closed',()=>{
 const f=fixture();f.node.content[0].content[0]=cell('a');assert.equal(planPdfTableOrder(f.document,f.options).code,'native-table-cell-text-mismatch');
 const g=fixture();assert.equal(planPdfTableOrder(g.document,{...g.options,maxChecks:1}).code,'coverage-limit');
 g.options.pageAssociation.set(g.node,1);assert.equal(planPdfTableOrder(g.document,g.options).code,'native-table-page-mismatch');
});

test('table cell coverage preserves ligatures, symbols, case and joiners exactly',()=>{
 const f=fixture(),value='ﬁ²ℝAa\u200d\u200c',source=f.options.sources[0];
 f.node.content[0].content[0]=cell(value);
 source.unicodeScalars.splice(1,1,...Array.from(value,c=>c.codePointAt(0)));
 source.scalarBoxesPt.splice(1,1,...Array.from(value,()=>[12,12,14,14]));
 const result=planPdfTableOrder(f.document,f.options);assert.equal(result.ok,true);assert.equal(text(result.sources[0]),'X'+value+'BCDY');
});

test('vertical merge anchors bind once and continuation text cannot be hidden',()=>{
 const f=fixture(),native=f.options.nativeTables.tables[0];
 f.node.content[0].content[0]={...cell('AC'),tcPr:{vMerge:'restart'}};
 f.node.content[1].content[0]={...cell(''),tcPr:{vMerge:'continue'}};
 native.cells[0]={...native.cells[0],rowSpan:2,bottomPt:30};native.cells.splice(2,1);
 assert.equal(planPdfTableOrder(f.document,f.options).ok,true);
 f.node.content[1].content[0].content=[para('hidden')];assert.equal(planPdfTableOrder(f.document,f.options).code,'native-table-topology-mismatch');
});

test('all-empty source grid remains pending a verified source gap anchor',()=>{
 const f=fixture();for(const row of f.node.content)for(const c of row.content)c.content=[para('')];
 f.options.sources[0].unicodeScalars=[88,89];f.options.sources[0].scalarBoxesPt=[[1,1,2,2],[1,40,2,42]];
 assert.equal(planPdfTableOrder(f.document,f.options).code,'unanchored-empty-table');
});
