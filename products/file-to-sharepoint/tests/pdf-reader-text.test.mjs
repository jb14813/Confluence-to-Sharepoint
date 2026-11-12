import test from 'node:test';
import assert from 'node:assert/strict';
const implementation=await import('../src/content/pdf-reader-text.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return{};throw error;});
import {verifyPdfNativeReflowDrawings} from '../src/content/pdf-drawing-flow.js';
const p=(text,extra={})=>({type:'paragraph',content:[{type:'run',content:[text]}],...extra});
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?.type==='paraDrawing'?text(node.graphic.content):text(node?.content??'');
function fixture(){
 const title=p('Report',{pPr:{pStyle:'Heading1'}}),body=[title,p('2'),p('O and x.'),p('Plain text H'),p('2'),p('22, 2026'),p('Sep 22, 2026 - Sep ')];
 const shape={type:'paraDrawing',docPr:{id:2},graphic:{id:'text-wrapper',type:'shape',content:{type:'docContent',content:body}}};
 const image={type:'paraDrawing',docPr:{id:1},graphic:{id:'figure',type:'image',blipFill:{rasterImageId:'image1.png'}}};
 const imageRoot={type:'paragraph',content:[{type:'run',content:[image]}]},textRoot={type:'paragraph',content:[{type:'run',content:[shape]}]};
 return{title,body,nodes:[imageRoot,textRoot],sourceText:'Report\n\nPlain text H2O and x2.\n\nSep 22, 2026 - Sep 22, 2026',drawings:[{graphicId:'figure',node:image,root:imageRoot,drawing:{role:'figure'}},{graphicId:'text-wrapper',node:shape,root:textRoot,drawing:{role:'editable-text-wrapper'}}]};
}
function plan(input){assert.equal(typeof implementation.planReaderTextPage,'function');return implementation.planReaderTextPage(input);}
test('scrambled native fragments reuse the existing reader paragraphs with correct word boundaries',()=>{
 const f=fixture(),original=JSON.stringify(f.nodes),result=plan(f);assert.ok(result);assert.deepEqual(result.nodes.slice(1).map(text),['Report','Plain text H2O and x2.','Sep 22, 2026 - Sep 22, 2026']);assert.equal(JSON.stringify(f.nodes),original);
});
test('intact unambiguous native paragraph styles and every nontext drawing remain original objects',()=>{
 const f=fixture(),result=plan(f);assert.equal(result.nodes[1],f.title);assert.equal(result.nodes[0].content[0].content[0],f.drawings[0].node);assert.deepEqual(result.replacedTextWrappers,['text-wrapper']);assert.equal(result.retainedStyledParagraphs,1);
});
test('reader text cannot hide missing or extra converted characters',()=>{
 const f=fixture();assert.equal(plan({...f,sourceText:f.sourceText+' missing'}),null);f.body.push(p('extra'));assert.equal(plan(f),null);
});
test('native tables, unsupported nodes and unretained hyperlinks preserve the original protected path',()=>{
 const f=fixture();assert.equal(plan({...f,nodes:[...f.nodes,{type:'table',content:[]}]}),null);
 f.body[1]={type:'unknown',content:['2']};assert.equal(plan(f),null);
 const g=fixture();g.body[2]={type:'paragraph',content:[{type:'hyperlink',value:'https://example.com/',content:[{type:'run',content:['O and x.']}]}]};assert.equal(plan(g),null);
});
test('already ordered native paragraphs keep their existing formatting path',()=>{
 const nodes=[p('Correct words.'),p('Second paragraph.')];assert.equal(plan({nodes,sourceText:'Correct words.\n\nSecond paragraph.',drawings:[]}),null);
});
test('reader-text recovery cannot waive invalid transform metadata',()=>{
 for(const xfrm of [{rot:NaN},{flipH:1},{flipV:'yes'}]){const f=fixture();f.drawings[1].node.graphic.spPr={xfrm};assert.equal(plan(f),null);}
});
test('an intact linked paragraph retains its original native hyperlink while other text is repaired',()=>{
 const f=fixture(),link={type:'hyperlink',value:'https://example.com/source',content:[{type:'run',content:['Open source']}]},linked={type:'paragraph',content:[link]};f.body.push(linked);f.sourceText+='\n\nOpen source';const result=plan(f);assert.ok(result);assert.equal(result.nodes.at(-1),linked);assert.equal(result.nodes.at(-1).content[0],link);
});
test('new reader paragraph strings retain literal characters and line breaks for the shared safe renderer',()=>{
 const nodes=[p('tail'),p('continued'),p('& code'),p('<literal> ')],result=plan({nodes,sourceText:'<literal> & code\ncontinued\n\ntail',drawings:[]});assert.ok(result);assert.deepEqual(result.nodes.map(text),['<literal> & code\ncontinued','tail']);
});
test('flattened text-wrapper accounting cannot excuse a missing graphic or a forged exclusion',()=>{
 const drawings=new Map([['text',{drawing:{role:'editable-text-wrapper'},pageIndex:0}],['figure',{drawing:{role:'figure'},pageIndex:0}]]),rendered=[{sourceId:'figure',pageIndex:0,assetId:'a'.repeat(64)}];
 const input={drawings,textReflow:[{pageIndex:0,replacedTextWrappers:['text']}]};assert.equal(verifyPdfNativeReflowDrawings(input,rendered),true);
 assert.throws(()=>verifyPdfNativeReflowDrawings(input,[]),{code:'PDF_DRAWINGS_UNVERIFIED'});
 for(const replacedTextWrappers of [['figure'],['text','text'],['unknown']])assert.throws(()=>verifyPdfNativeReflowDrawings({...input,textReflow:[{pageIndex:0,replacedTextWrappers}]},rendered),{code:'PDF_DRAWINGS_UNVERIFIED'});
});
