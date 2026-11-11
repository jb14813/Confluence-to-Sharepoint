import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptDocument} from '../src/content/index.js';

const page={W:612,H:792,Dpi:72};
const section={type:'nextPage',pgSz:{w:12240,h:15840}};
const text=value=>({type:'paragraph',content:[{type:'run',content:[value]}]});
const drawing=id=>({type:'paragraph',content:[{type:'run',content:[{type:'paraDrawing',drawingType:'anchor',positionH:{relativeFrom:'page',posOffset:95250},positionV:{relativeFrom:'page',posOffset:190500},extent:{cx:952500,cy:476250},graphic:{id,type:'shape',spPr:{fill:{fill:{type:'noFill'}},ln:{fill:{fill:{type:'noFill'}}}},content:{type:'docContent',content:[text('Native textbox '+id)]}}}]}]});
const breakPage=()=>({type:'paragraph',pPr:{sectPr:structuredClone(section)},content:[]});
const document=content=>({type:'document',sectPr:structuredClone(section),content});
const run=(doc,pages=[page,page],name='pages.pdf')=>adaptDocument({name,bytes:Uint8Array.of(1),result:{officeDocument:doc,pdfForms:{Fields:[],Parents:[],pages},warnings:[]}});

test('complete native PDF page sections associate identical drawing coordinates with distinct source pages',async()=>{
  const doc=document([text('First source page'),drawing('first'),breakPage(),text('Second source page'),drawing('second')]);
  const result=await run(doc);
  assert.equal(result.preview.pageAssociation,'native-sections');
  assert.deepEqual(result.preview.drawings.map(d=>[d.sourceId,d.pageIndex]),[['first',0],['second',1]]);
  assert.equal(result.preview.readingOrder,'engine-serialization');
  assert.deepEqual(result.preview.blocks.filter(b=>['file-block-1','file-block-4'].includes(b.blockId)).map(b=>b.pageIndex),[0,1]);
  assert.deepEqual(result.model.warnings.filter(w=>w.code==='pdf-page-association-unverified'),[]);
});

test('missing, continuous, extra and mismatched native sections cannot assign a guessed PDF source page',async()=>{
  const cases=[document([drawing('first')]),document([drawing('first'),{...breakPage(),pPr:{sectPr:{...section,type:'continuous'}}},drawing('second')]),document([drawing('first'),breakPage(),breakPage(),drawing('second')]),document([drawing('first'),{...breakPage(),pPr:{sectPr:{...section,pgSz:{w:100,h:100}}}},drawing('second')])];
  for(const doc of cases){
    const result=await run(doc);
    assert.equal(result.preview.pageAssociation,'unverified');
    assert.ok(result.preview.drawings.every(d=>d.pageIndex===undefined));
    assert.ok(result.model.warnings.some(w=>w.code==='pdf-page-association-unverified'&&w.blocking));
  }
});

test('one native source PDF page needs no intervening section and ordinary Word does not acquire PDF page claims',async()=>{
  const doc=document([drawing('single')]);
  const pdf=await run(doc,[page]);
  assert.equal(pdf.preview.drawings[0].pageIndex,0);
  assert.equal(pdf.preview.pageAssociation,'native-sections');
  const word=await run(doc,[page],'ordinary.docx');
  assert.equal(word.preview.drawings[0].pageIndex,undefined);
  assert.equal(word.preview.pageAssociation,undefined);
});
