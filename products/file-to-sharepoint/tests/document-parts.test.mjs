import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptDocument} from '../src/content/index.js';
import {checkCanvasBlock} from '../../../src/sharepoint/canvas.js';
const p=(...content)=>({type:'paragraph',content:[{type:'run',content}]});
const part=(type,id,...content)=>({type,ftsSourceId:id,content:{type:'docContent',content}});
const note=(id,...content)=>({id,number:7,content});
const ref=(kind,id,number=7)=>({type:kind+'Ref',footnote:id,number,numFormat:0});
const run=officeDocument=>adaptDocument({name:'document-parts.docx',bytes:Uint8Array.of(1,2,3),result:{officeDocument,warnings:[]}});
const html=x=>x.model.blocks.map(b=>b.html).join('');
const valid=x=>{assert.deepEqual(x.model.warnings.filter(w=>w.blocking),[]);for(const block of x.model.blocks)checkCanvasBlock(block);};

test('headers and footers become editable sections, retaining variants and deduplicating exact source identities',async()=>{
  const header=part('hdr','source-header',p('Source header'));
  const body=p('Body content');body.pPr={sectPr:{headerReference:{default:structuredClone(header),even:structuredClone(header)}}};
  const result=await run({type:'document',sectPr:{headerReference:{default:header},footerReference:{first:part('ftr','source-footer',p('Source footer'))}},content:[body]});
  valid(result);assert.match(html(result),/Source header[\s\S]*Body content[\s\S]*Source footer/);
  assert.equal((html(result).match(/Source header/g)||[]).length,1);
  assert.equal((html(result).match(/Source footer/g)||[]).length,1);
  assert.ok(result.model.warnings.some(w=>w.code==='header-footer-adapted'));
  assert.equal(result.preview.documentParts.filter(p=>p.kind==='header').length,1);
  assert.deepEqual(result.preview.documentParts.find(p=>p.kind==='header').variants,['default','even']);
});

test('footnote and endnote references retain their source position and link to complete editable note sections',async()=>{
  const first=p('Before ',ref('footnote','source-foot'),' after.');
  first.content[0].footnotes=[note('source-foot',p({type:'footnoteNum',footnote:'source-foot',number:7},' Footnote body ',{type:'hyperlink',value:'https://example.org/note',content:['source link']}))];
  const second=p('End ',ref('endnote','source-end',2),' tail.');second.content[0].endnotes=[{...note('source-end',p('Endnote body')),number:2}];
  const result=await run({type:'document',content:[first,second]});
  valid(result);
  assert.match(html(result),/Before [\s\S]*href="#file-footnote-1"[^>]*>1<\/a>[\s\S]* after\./);
  assert.match(html(result),/id="file-footnote-1"/);assert.match(html(result),/Footnote body/);assert.match(html(result),/href="https:\/\/example.org\/note"/);
  assert.match(html(result),/href="#file-endnote-1"[^>]*>1<\/a>/);assert.match(html(result),/id="file-endnote-1"[\s\S]*Endnote body/);
  assert.ok(result.model.warnings.some(w=>w.code==='notes-adapted'));
});

test('multiple references share one verified definition without dropping either reference',async()=>{
  const definition=note('repeat',p('Unique note text'));
  const a=p('A',ref('footnote','repeat')),b=p('B',ref('footnote','repeat'));
  a.content[0].footnotes=[definition];b.content[0].footnotes=[structuredClone(definition)];
  const result=await run({type:'document',content:[a,b]});valid(result);
  assert.equal((html(result).match(/Unique note text/g)||[]).length,1);
  assert.equal((html(result).match(/href="#file-footnote-1"/g)||[]).length,2);
});

test('missing or conflicting referenced parts remain blocking rather than silently dropping content',async()=>{
  const missing=await run({type:'document',content:[p('Before',ref('footnote','missing'),'After')]});
  assert.ok(missing.model.warnings.some(w=>w.code==='document-parts-unverified'&&w.blocking));
  const a=p(ref('footnote','conflict')),b=p(ref('footnote','conflict'));
  a.content[0].footnotes=[note('conflict',p('First definition'))];b.content[0].footnotes=[note('conflict',p('Different definition'))];
  const conflict=await run({type:'document',content:[a,b]});
  assert.ok(conflict.model.warnings.some(w=>w.code==='document-parts-unverified'&&w.blocking));
  const absent=await run({type:'document',sectPr:{headerReference:{default:{type:'hdr',ftsSourceId:'missing-header'}}},content:[p('Body')]});
  assert.ok(absent.model.warnings.some(w=>w.code==='document-parts-unverified'&&w.blocking));
});

test('distinct notes get unique consecutive native labels even when the SDK leaves every calculated number at one',async()=>{
  const body=p('First',ref('footnote','one',1),' Second',ref('footnote','two',1));
  body.content[0].footnotes=[{...note('one',p('First note')),number:1},{...note('two',p('Second note')),number:1}];
  const result=await run({type:'document',content:[body]});valid(result);
  assert.match(html(result),/href="#file-footnote-1"[^>]*>1<\/a>/);assert.match(html(result),/href="#file-footnote-2"[^>]*>2<\/a>/);
  assert.match(html(result),/id="file-footnote-2"><strong>Footnote 2<\/strong>/);
});

test('custom note marks link their existing source text instead of adding a second visible mark',async()=>{
  for(const customMark of ['*',true]){
    const body=p('Before',{...ref('footnote','custom',1),customMark},'*After');
    body.content[0].footnotes=[{...note('custom',p({...ref('footnote','custom',1),type:'footnoteNum',customMark},'*Note body')),number:1}];
    const result=await run({type:'document',content:[body]});valid(result);
    const bodyHtml=result.model.blocks[0].html;
    assert.match(bodyHtml,/Before<a[^>]*href="#file-footnote-1"[^>]*>\*<\/a>After/);
    assert.equal(bodyHtml.replace(/<[^>]+>/g,''),'Before*After');
    assert.equal((html(result).match(/\*Note body/g)||[]).length,1);
  }
});

test('well-formed complex fields retain their cached editable result and notes as static content',async()=>{
  const body=p('Lead',{type:'fldChar',fldCharType:'begin'},{type:'instrText',instr:'QUOTE "visible"'},{type:'fldChar',fldCharType:'separate'},'visible',ref('footnote','field-note',1),'tail',{type:'fldChar',fldCharType:'end'},'Final');
  body.content[0].footnotes=[{...note('field-note',p('Retained note')),number:1}];
  const result=await run({type:'document',content:[body]});valid(result);
  assert.match(html(result),/Leadvisible[\s\S]*tailFinal/);assert.doesNotMatch(html(result),/QUOTE|fldChar|instrText/);
  assert.ok(result.model.warnings.some(w=>w.code==='static-field-adapted'));
  for(const content of [[{type:'instrText',instr:'orphan'}],[{type:'fldChar',fldCharType:'begin'},'Incomplete'],[{type:'fldChar',fldCharType:'end'}]]){
    const broken=await run({type:'document',content:[p('Body',...content)]});
    assert.ok(broken.model.warnings.some(w=>w.code==='field-content-unverified'&&w.blocking));
  }
});

test('nested cached fields span paragraphs without exposing instructions or leaking between document parts',async()=>{
  const begin={type:'fldChar',fldCharType:'begin'},separate={type:'fldChar',fldCharType:'separate'},end={type:'fldChar',fldCharType:'end'};
  const result=await run({type:'document',sectPr:{headerReference:{default:part('hdr','header',p(begin,{type:'instrText',instr:'PAGE'},separate,'Header cached value',end))}},content:[
    p('Before',begin,{type:'instrText',instr:'IF'},begin,{type:'instrText',instr:'QUOTE'},separate,'Hidden instruction value',end,separate,'Visible result'),
    p('Second paragraph',begin,{type:'instrText',instr:'DATE'},separate,'Cached date',end,end,'After'),
  ]});
  valid(result);assert.doesNotMatch(html(result),/Hidden instruction|IF|QUOTE|DATE|PAGE/);
  assert.match(html(result),/Header cached value[\s\S]*BeforeVisible result[\s\S]*Second paragraphCached dateAfter/);
  assert.equal(result.preview.staticFields.count,4);
});

test('actual SDK block content-control schema retains its child notes and editable body',async()=>{
  const body=p('Controlled body ',ref('footnote','controlled-note',1));body.content[0].footnotes=[note('controlled-note',p('Controlled note text'))];
  const result=await run({type:'document',content:[{type:'blockLvlSdt',sdtPr:{alias:'Source control'},sdtContent:{type:'docContent',content:[body]}}]});
  valid(result);assert.match(html(result),/Controlled body[\s\S]*href="#file-footnote-1"/);
  assert.match(html(result),/Controlled note text/);assert.ok(result.model.warnings.some(w=>w.code==='content-wrapper-adapted'));
});
