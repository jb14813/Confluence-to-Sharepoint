import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptDocument} from '../src/content/index.js';
import {checkCanvasBlock} from '../../../src/sharepoint/canvas.js';

const paragraph=text=>({type:'paragraph',content:[{type:'run',content:[text]}]});
const cell=(text,tcPr={})=>({type:'tblCell',tcPr,content:{type:'docContent',content:[paragraph(text)]}});
const row=(content,trPr={})=>({type:'tblRow',trPr,content});
const table=content=>({type:'table',tblGrid:[{w:1000},{w:1000}],content});
const border=(value='single',red=0)=>({value,sz:8,color:{r:red,g:0,b:0}});
const fill=(type,color)=>({transparent:255,fill:{type,...(color?{color:{color:{type:'srgb',rgba:{r:color[0],g:color[1],b:color[2],a:255}},mods:[]}}:{})}});
const textbox=spPr=>({type:'paraDrawing',graphic:{type:'shape',id:'source-box',spPr,content:{type:'docContent',content:[paragraph('Preserve editable box content')]}}});
const run=content=>adaptDocument({name:'native-formatting.docx',bytes:Uint8Array.of(1,2,3),result:{officeDocument:{type:'document',content},warnings:[]}});
const html=result=>result.model.blocks.map(block=>block.html).join('');
function valid(result){assert.deepEqual(result.model.warnings.filter(w=>w.blocking),[]);for(const block of result.model.blocks)checkCanvasBlock(block);}

test('decorative textbox styles adapt instead of refusing verified editable text',async()=>{
  const cases=[
    {fill:fill('grad'),ln:{fill:fill('noFill')}},
    {fill:fill('noFill'),ln:{fill:fill('solid',[18,52,86]),w:25400,prstDash:'dashDot'}},
    {fill:fill('noFill'),ln:{fill:fill('solid',[18,52,86]),w:25400,cmpd:'tri'}},
    {fill:fill('noFill'),ln:{fill:fill('solid',[18,52,86]),w:1270000}},
    {fill:fill('noFill'),ln:{fill:fill('solid',[18,52,86]),w:null}},
  ];
  for(const spPr of cases){
    const result=await run([paragraph('Before'),textbox(spPr),paragraph('After')]);
    valid(result);assert.match(html(result),/Before[\s\S]*Preserve editable box content[\s\S]*After/);
    assert.ok(result.model.warnings.some(w=>w.code==='textbox-style-adapted'));
    assert.equal(result.preview.drawings[0].sourceId,'source-box');
    assert.deepEqual(result.preview.drawings[0].shape,spPr);
    if(spPr.ln?.prstDash==='dashDot')assert.match(html(result),/border:2pt dashed #123456/);
    if(spPr.ln?.cmpd==='tri')assert.match(html(result),/border:2pt double #123456/);
    if(spPr.ln?.w===1270000)assert.match(html(result),/border:12pt solid #123456/);
  }
});

test('unsupported minimum table height uses automatic sizing without changing any cell text',async()=>{
  const result=await run([table([row([cell('Tall source'),cell('Right')],{trHeight:{hRule:'exact',val:100000}})])]);
  valid(result);assert.doesNotMatch(html(result),/height:/);assert.match(html(result),/Tall source[\s\S]*Right/);
  assert.ok(result.model.warnings.some(w=>w.code==='table-cell-height-adapted'));
  assert.equal(result.model.stats.tables,1);
});

test('varying merged-side borders use a visible native representative while retaining all merged content',async()=>{
  const result=await run([table([
    row([cell('Anchor',{vMerge:'restart',tcBorders:{start:{value:'nil'}}}),cell('R1')]),
    row([cell('Continuation',{vMerge:'continue',tcBorders:{start:border('single',255),bottom:border('single',128)}}),cell('R2')]),
  ])]);
  valid(result);assert.match(html(result),/<td rowspan="2"[^>]*border-left:1pt solid #ff0000[^>]*>[\s\S]*Anchor[\s\S]*Continuation/);
  assert.match(html(result),/border-bottom:1pt solid #800000/);
  assert.equal((html(result).match(/Continuation/g)||[]).length,1);
  assert.ok(result.model.warnings.some(w=>w.code==='merged-cell-border-adapted'));
});

test('unsupported table border decoration maps to a supported native stroke with a preview note',async()=>{
  const result=await run([table([row([cell('Wavy border',{tcBorders:{top:border('wave',42)}}),cell('Untouched')])])]);
  valid(result);assert.match(html(result),/border-top:1pt solid #2a0000/);
  assert.ok(result.model.warnings.some(w=>w.code==='table-border-adapted'));
});

test('known content-control wrappers retain editable child content and links with an adaptation note',async()=>{
  const result=await run([{type:'blockLvlSdt',sdtContent:{type:'docContent',content:[paragraph('Wrapped heading'),{type:'inlineLvlSdt',content:[{type:'hyperlink',value:'https://example.org/resource',content:['Linked value & text']}]}]}}]);
  valid(result);assert.match(html(result),/Wrapped heading/);assert.match(html(result),/href="https:\/\/example.org\/resource"[^>]*>Linked value &amp; text/);
  assert.ok(result.model.warnings.some(w=>w.code==='content-wrapper-adapted'));
});

test('unrecovered unknown leaves, numbering identity and malformed table topology still block',async()=>{
  const leaf=await run([{type:'unknownEmbeddedObject',resource:'unrecovered-source-data'},paragraph('Known body')]);
  assert.ok(leaf.model.warnings.some(w=>w.code==='unsupported-content'&&w.blocking));
  const numbered=paragraph('Unknown marker');numbered.pPr={numPr:{numId:'12',ilvl:0}};
  assert.ok((await run([numbered])).model.warnings.some(w=>w.code==='list-numbering-unverified'&&w.blocking));
  await assert.rejects(run([table([row([cell('Orphan',{vMerge:'continue'}),cell('R')])])]),{code:'unsupported-content'});
});
