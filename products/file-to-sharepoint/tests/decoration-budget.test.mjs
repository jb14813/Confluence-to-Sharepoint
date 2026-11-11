import test from 'node:test';
import assert from 'node:assert/strict';
import {planDecorationBudget} from '../src/engine/decoration-budget.js';

const page={W:612,H:792,Dpi:72};
const section={type:'nextPage',pgSz:{w:12240,h:15840}};
const layout={version:1,textAssociationType:2,flowGeometry:'native-plain-line-v1'};
const shape=id=>({type:'shape',id,content:null});
const paragraph=content=>({type:'paragraph',content});
function fixture(counts){
 const content=[];
 for(const [pageIndex,count]of counts.entries()){
  content.push(paragraph(Array.from({length:count},(_,i)=>shape(`${pageIndex}-${i}`))));
  if(pageIndex<counts.length-1)content.push({...paragraph([]),pPr:{sectPr:structuredClone(section)}});
 }
 return {document:{type:'document',content,sectPr:structuredClone(section)},context:{pages:counts.map(()=>({...page})),pdfLayout:{...layout}}};
}
const refused=fn=>assert.throws(fn,{code:'DECORATION_PAGE_UNVERIFIED'});

test('ordinary documents retain their existing total decoration budget',()=>{
 const {document}=fixture([600]);
 assert.deepEqual(planDecorationBudget(document),{maxTotal:512,pageForId:null,perPage:512});
});

test('verified native PDF sections give every nontext source ID its original page and a bounded total',()=>{
 const counts=[38,72,58,57,63,56,104,127,119,122,116,126,44,1];
 const {document,context}=fixture(counts),budget=planDecorationBudget(document,context);
 assert.equal(budget.maxTotal,4096);assert.equal(budget.perPage,512);
 assert.equal(budget.pageForId.size,1103);
 assert.deepEqual(counts.map((count,pageIndex)=>Array.from({length:count},(_,i)=>budget.pageForId.get(`${pageIndex}-${i}`)).every(actual=>actual===pageIndex)),counts.map(()=>true));
 const two=fixture([1,2]);assert.equal(planDecorationBudget(two.document,two.context).maxTotal,1024);
});

test('unverified PDF context, missing or continuous sections and mismatched geometry cannot expand the budget',()=>{
 const {document,context}=fixture([2,2]);
 for(const bad of [null,{}, {...context,pdfLayout:{...layout,textAssociationType:3}},{...context,pages:[page]}])refused(()=>planDecorationBudget(document,bad));
 const continuous=structuredClone(document);continuous.content[1].pPr.sectPr.type='continuous';refused(()=>planDecorationBudget(continuous,context));
 const mismatch=structuredClone(context);mismatch.pages[1].W=800;refused(()=>planDecorationBudget(document,mismatch));
});

test('duplicate, invalid and non-body drawing IDs cannot acquire a guessed source page',()=>{
 const {document,context}=fixture([2]);
 const duplicate=structuredClone(document);duplicate.content[0].content.push(shape('0-0'));refused(()=>planDecorationBudget(duplicate,context));
 const invalid=structuredClone(document);invalid.content[0].content.push(shape(''));refused(()=>planDecorationBudget(invalid,context));
 const outside=structuredClone(document);outside.styles={unexpected:shape('outside')};refused(()=>planDecorationBudget(outside,context));
 // Text-bearing shapes remain editable and never become raster candidates.
 document.content[0].content.push({...shape('text'),content:{content:[paragraph(['Words'])]}});
 assert.equal(planDecorationBudget(document,context).pageForId.has('text'),false);
});

test('transformed bitmap views share verified PDF page ownership while ordinary images retain their byte path',()=>{
 const {document,context}=fixture([1,1]);
 const image=(id,xfrm)=>({type:'paraDrawing',graphic:{type:'image',id,spPr:{xfrm},blipFill:{rasterImageId:'image1.png'}}});
 document.content[2].content.push(image('rotated',{rot:Math.PI/2}),image('natural',{}));
 const budget=planDecorationBudget(document,context);
 assert.equal(budget.pageForId.get('rotated'),1);assert.equal(budget.pageForId.has('natural'),false);
 const duplicate=structuredClone(document);duplicate.content[0].content.push(image('rotated',{flipH:true}));
 refused(()=>planDecorationBudget(duplicate,context));
});
