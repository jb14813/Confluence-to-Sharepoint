import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptDocument} from '../src/content/index.js';
import {checkCanvasBlock} from '../../../src/sharepoint/canvas.js';

const p=(text,numbering)=>({type:'paragraph',content:[{type:'run',content:[text]}],...(numbering?{ftsNumbering:numbering}:{})});
const n=(level,value,format='decimal',extra={})=>({numId:'10',scopeId:'main',level,value,label:`${format==='lowerLetter'?['','a','b','c','d'][value]:format==='upperRoman'?['','I','II','III','IV'][value]:value}.`,definition:{numFmt:{val:format},lvlText:`%${level+1}.`},...extra});
const cell=(text,tcPr={})=>({type:'tblCell',tcPr,content:{type:'docContent',content:Array.isArray(text)?text:[p(text)]}});
const row=(content,trPr={})=>({type:'tblRow',trPr,content});
const table=(content,cols=2)=>({type:'table',tblGrid:Array.from({length:cols},()=>({type:'gridCol',w:1000})),content});
const run=content=>adaptDocument({name:'layout.docx',bytes:Uint8Array.of(1,2,3),result:{officeDocument:{type:'document',content},warnings:[]}});
const html=a=>a.model.blocks.map(b=>b.html).join('');
const blocking=a=>a.model.warnings.filter(w=>w.blocking);
const valid=a=>{for(const b of a.model.blocks)checkCanvasBlock(b);};

test('configured SharePoint font stacks use exact spaces and single quotes so native editing retains them',async()=>{
 const families=['Arial','Courier New','Times New Roman','Georgia','Lucida Sans Unicode','Tahoma','Trebuchet MS','Verdana','Calibri'];
 const a=await run(families.map(name=>({type:'paragraph',content:[{type:'run',rPr:{rFonts:{ascii:name}},content:[name]}]})));
 for(const family of ['Arial, Helvetica, sans-serif','&#39;Courier New&#39;, Courier, monospace','&#39;Times New Roman&#39;, Times, serif','Georgia, serif','&#39;Lucida Sans Unicode&#39;, &#39;Lucida Grande&#39;, sans-serif','Tahoma, Geneva, sans-serif','&#39;Trebuchet MS&#39;, Helvetica, sans-serif','Verdana, Geneva, sans-serif'])assert.ok(html(a).includes('font-family:'+family),family);
 assert.ok(html(a).includes('font-family:Calibri'));
 assert.equal(a.model.warnings.filter(w=>w.code==='native-editor-font-review').length,1);valid(a);
});

test('heading weights come from SDK inherited and explicit run bold values without changing body bold',async()=>{
  const officeDocument={type:'document',textPr:{b:false,sz:24,rFonts:{ascii:'Arial'}},styles:{heading:{name:'Heading 1',pPr:{outlineLvl:0},rPr:{b:true}}},content:[
    {type:'paragraph',content:[{type:'run',content:['Body normal']},{type:'run',rPr:{b:true},content:['Body bold']}]},
    {type:'paragraph',pPr:{pStyle:'heading'},content:[{type:'run',content:['Inherited bold']},{type:'run',rPr:{b:false},content:['Explicit nonbold']},{type:'run',rPr:{b:true},content:['Explicit bold']}]},
    {type:'paragraph',pPr:{outlineLvl:1},content:[{type:'run',content:['Document default nonbold heading']}]}
  ]};
  const a=await adaptDocument({name:'weights.docx',bytes:Uint8Array.of(1),result:{officeDocument,warnings:[]}}),value=html(a);
  assert.match(value,/<p id="file-heading-1"/);
  assert.match(value,/<p id="file-heading-2"/);
  assert.match(value,/<strong><span[^>]*font-weight:700[^>]*>Inherited bold<\/span><\/strong>/);assert.match(value,/<strong><span[^>]*font-weight:700[^>]*>Explicit bold<\/span><\/strong>/);
  assert.match(value,/<span[^>]*font-weight:400[^>]*>Explicit nonbold<\/span>/);
  assert.ok(!value.includes('<strong>Explicit nonbold</strong>'));assert.ok(!value.includes('<strong>Document default nonbold heading</strong>'));
  assert.match(value,/<p><span style="font-weight:400;font-size:12pt;font-family:Arial, Helvetica, sans-serif">Body normal<\/span><strong><span style="font-weight:700;font-size:12pt;font-family:Arial, Helvetica, sans-serif">Body bold<\/span><\/strong><\/p>/);
  assert.deepEqual(blocking(a),[]);valid(a);
});

test('explicit SDK run fonts override the document fontFamily fallback without changing half-point sizes',async()=>{
  const officeDocument={type:'document',textPr:{fontFamily:{name:'Times New Roman'},sz:22},styles:{pdfBody:{rPr:{rFonts:{ascii:'Nimbus Sans',hAnsi:'Nimbus Sans'},sz:22}}},content:[
    {type:'paragraph',pPr:{pStyle:'pdfBody'},content:[{type:'run',content:['Native style font']},{type:'run',rPr:{rFonts:{ascii:'Arial'}},content:['Direct run font']}]},
    {type:'paragraph',content:[{type:'run',rPr:{rFonts:{ascii:'',hAnsi:'Courier New'}},content:['High ANSI font']},{type:'run',content:['Default family']}]}
  ]};
  const a=await adaptDocument({name:'fonts.docx',bytes:Uint8Array.of(1),result:{officeDocument,warnings:[]}});
  assert.match(html(a),/<span style="font-size:11pt;font-family:Arial, Helvetica, sans-serif">Native style font<\/span>/);
  assert.match(html(a),/<span style="font-size:11pt;font-family:Arial, Helvetica, sans-serif">Direct run font<\/span>/);
  assert.match(html(a),/<span style="font-size:11pt;font-family:&#39;Courier New&#39;, Courier, monospace">High ANSI font<\/span>/);
  assert.match(html(a),/<span style="font-size:11pt;font-family:&#39;Times New Roman&#39;, Times, serif">Default family<\/span>/);valid(a);
});

test('verified Base14 families retain source provenance with native editable font stacks',async()=>{
  const officeDocument={type:'document',content:['Nimbus Sans','Nimbus Mono','Nimbus Roman','Arial','constructor'].map(name=>({type:'paragraph',content:[{type:'run',rPr:{rFonts:{ascii:name},sz:24,b:true,i:true},content:[name]}]}))};
  const a=await adaptDocument({name:'fonts.docx',bytes:Uint8Array.of(1),result:{officeDocument,warnings:[]}});
  for(const family of ['Arial, Helvetica, sans-serif','&#39;Courier New&#39;, Courier, monospace','&#39;Times New Roman&#39;, Times, serif','constructor'])assert.ok(html(a).includes(`font-size:12pt;font-family:${family}`));
  assert.deepEqual(a.preview.fontFallbacks,[{sourceFamily:'Nimbus Sans',fallbacks:['Arial','sans-serif']},{sourceFamily:'Nimbus Mono',fallbacks:['Courier New','monospace']},{sourceFamily:'Nimbus Roman',fallbacks:['Times New Roman','serif']}]);
  assert.equal(a.model.warnings.filter(w=>w.code==='font-display-fallback').length,1);assert.ok(!a.model.warnings.some(w=>w.blocking));valid(a);
});

test('Word SDK effective numbering groups adjacent items into native lists, including style inherited numbering',async()=>{
  const a=await run([p('First',n(0,7)),p('Second',n(0,8)),p('Interrupted'),p('Continued',n(0,9)),p('Restart',n(0,3,'decimal',{numId:'20'}))]);
  assert.match(html(a),/<ol start="7"[^>]*><li><p>First<\/p><\/li><li><p>Second<\/p><\/li><\/ol>/);
  assert.match(html(a),/<p>Interrupted<\/p><ol start="9"/);assert.match(html(a),/<ol start="3"/);
  assert.equal(a.model.stats.numbered,4);assert.deepEqual(blocking(a),[]);valid(a);
});

test('Word nesting, level restarts and format changes keep editable li children',async()=>{
  const a=await run([p('Parent',n(0,1)),p('Child c',n(1,3,'lowerLetter')),p('Child d',n(1,4,'lowerLetter')),p('Roman IV',n(2,4,'upperRoman')),p('Parent two',n(0,2)),p('Child restart',n(1,1,'lowerLetter')),p('Bullet',{...n(0,1,'bullet'),label:'\uf0b7',font:'Symbol',definition:{numFmt:{val:'bullet'},lvlText:'\uf0b7'}})]);
  assert.match(html(a),/<li><p>Parent<\/p><ol start="3" style="list-style-type:lower-latin">/);
  assert.match(html(a),/<ol start="4" style="list-style-type:upper-roman">/);
  assert.match(html(a),/<li><p>Parent two<\/p><ol start="1"/);
  assert.match(html(a),/<ul style="list-style-type:disc"><li><p>Bullet/);
  assert.equal(a.model.stats.numbered,6);assert.equal(a.model.stats.bullets,1);assert.deepEqual(blocking(a),[]);valid(a);
});

test('counter discontinuity opens a fresh native list without inventing intermediate items',async()=>{
  const a=await run([p('One',n(0,1)),p('Five',n(0,5)),p('Six',n(0,6))]);
  assert.match(html(a),/<\/ol><ol start="5"/);assert.equal((html(a).match(/<li>/g)||[]).length,3);assert.deepEqual(blocking(a),[]);
});

test('verified source item continuations retain paragraphs and native tables inside the same editable li',async()=>{
  const first=p('Third',n(0,3));first.ftsListItem={itemId:'source-item-a'};
  const detail=p('Image continuation');detail.ftsListContinuation={itemId:'source-item-a'};
  const nested=p('Child',n(1,1,'decimal',{numId:'child'}));nested.ftsListItem={itemId:'source-item-b'};
  const after=p('After child');after.ftsListContinuation={itemId:'source-item-a'};
  const t=table([row([cell('Inside item'),cell('Still inside')])]);t.ftsListContinuation={itemId:'source-item-a'};
  const second=p('Fourth',n(0,4));second.ftsListItem={itemId:'source-item-c'};
  const a=await run([first,detail,nested,after,t,second]);
  assert.match(html(a),/<ol start="3"[^>]*><li><p>Third<\/p><p>Image continuation<\/p><ol start="1"[^>]*><li><p>Child<\/p><\/li><\/ol><p>After child<\/p>[\s\S]*Inside item[\s\S]*<\/table>[\s\S]*<\/li><li><p>Fourth<\/p>/);
  assert.equal(a.model.stats.numbered,3);assert.deepEqual(blocking(a),[]);valid(a);
});

test('orphan, ambiguous or numbered source continuations cannot become sendable native lists',async()=>{
  for(const continuation of [
    {...p('Orphan'),ftsListContinuation:{itemId:'unknown-item'}},
    {...p('Numbered continuation',n(0,4)),ftsListContinuation:{itemId:'source-item-a'}},
    {...p('Malformed'),ftsListContinuation:{itemId:{unexpected:true}}},
  ]){
    const first={...p('Third',n(0,3)),ftsListItem:{itemId:'source-item-a'}};
    const a=await run([first,continuation]);assert.ok(blocking(a).some(w=>w.code==='list-continuation-unverified'));
  }
});

test('markerless source annotations require verified kind while explicit Word None lists remain marker-free',async()=>{
  const valid={...p('TOC entry',n(0,1,'none',{label:'',definition:{numFmt:{val:'none'},lvlText:''}})),ftsListItem:{itemId:'verified-toc',markerless:true,kind:'toc'}};
  assert.deepEqual(blocking(await run([valid])),[]);
  const plain=await run([p('Explicit None',n(0,1,'none',{label:'',definition:{numFmt:{val:'none'},lvlText:''}}))]);assert.deepEqual(blocking(plain),[]);assert.equal(html(plain),'<p>Explicit None</p>');
  for(const node of [{...valid,ftsListItem:{...valid.ftsListItem,kind:'unknown'}},{...valid,ftsNumbering:{...valid.ftsNumbering,label:'1.'}},{...p('Wrong native format',n(0,1)),ftsListItem:valid.ftsListItem}])assert.ok(blocking(await run([node])).some(w=>w.code==='unsupported-list-numbering'));
});

test('verified markerless entries use a stable supported native list and retain editable checkbox text',async()=>{
 const items=['☐ Open task','☑ Completed task'].map((text,index)=>({...p(text,n(0,index+1,'none',{label:'',definition:{numFmt:{val:'none'},lvlText:''}})),ftsListItem:{itemId:'task-'+index,markerless:true,kind:'task',taskState:index?'checked':'unchecked'}}));
 const a=await run(items);assert.deepEqual(blocking(a),[]);
 assert.match(html(a),/list-style-type:disc/);assert.doesNotMatch(html(a),/list-style-type:none/);
 assert.ok(html(a).includes('☐ Open task'));assert.ok(html(a).includes('☑ Completed task'));
 assert.ok(a.model.warnings.some(w=>w.code==='markerless-list-adapted'&&!w.blocking));
});

test('Word explicitly cancelled inherited numbering remains an ordinary sendable paragraph',async()=>{
  for(const numId of ['0',0]){
    const item=p('No list');item.pPr={numPr:{numId,ilvl:0}};
    const a=await run([item]);assert.equal(html(a),'<p>No list</p>');assert.deepEqual(blocking(a),[]);
  }
});

test('missing list ancestors adapt around real items with a preview note',async()=>{
  for(const content of [[p('Orphan nested',n(2,1))],[p('Parent',n(0,1)),p('Skipped',n(2,1)),p('Middle',n(1,1))]]){
    const a=await run(content);assert.deepEqual(blocking(a),[]);assert.ok(a.model.warnings.some(w=>w.code==='list-depth-review'&&!w.blocking));
    assert.equal((html(a).match(/<li>/g)||[]).length,content.length);valid(a);
  }
});

test('a verified Word marker differing from HTML remains literal editable text',async()=>{
  for(const numbering of [n(0,28,'lowerLetter',{label:'bb.'}),n(0,28,'upperLetter',{label:'BB.'}),n(0,4,'upperRoman',{label:'4.'}),n(0,1,'decimal',{label:'Chapter 1.'})]){
    const a=await run([p('Preserved',numbering)]);assert.deepEqual(blocking(a),[]);assert.equal(html(a),`<p>${numbering.label} Preserved</p>`);assert.ok(a.model.warnings.some(w=>w.code==='list-marker-adapted'&&!w.blocking));valid(a);
  }
});

test('symbolic and letter bullet markers require their verified conventional font',async()=>{
  const bullet=(mark,font)=>({...n(0,1,'bullet'),font,label:mark,definition:{numFmt:{val:'bullet'},lvlText:mark}});
  for(const [mark,font] of [['\uf0b7','Wingdings'],['\u00b7','Wingdings'],['\uf0a7','Wingdings 3'],['o','Wingdings'],['\uf0b7',undefined]]){
    const a=await run([p('Custom symbol',bullet(mark,font))]);assert.ok(blocking(a).some(w=>w.code==='unsupported-list-numbering'));
  }
  const literal=await run([p('Unicode middle dot',bullet('\u00b7',undefined))]);assert.deepEqual(blocking(literal),[]);assert.equal(html(literal),'<p>· Unicode middle dot</p>');
  for(const [mark,font,style] of [['\uf0b7','Symbol','disc'],['\u00b7','Symbol','disc'],['\uf0a7','Wingdings','square'],['o','Courier New','circle'],['•',undefined,'disc']]){
    const a=await run([p('Known bullet',bullet(mark,font))]);assert.deepEqual(blocking(a),[]);assert.ok(html(a).includes(`list-style-type:${style}`));
  }
});

test('unverified and malformed numbering remain blocking while verified alternate formats adapt',async()=>{
  for(const numbering of [n(10,1),n(0,-1),n(0,1,'decimal',{definition:{}}),n(0,1,'decimal',{label:''})]){
    const a=await run([p('Preserve text',numbering)]);assert.match(html(a),/Preserve text/);assert.ok(blocking(a).some(w=>w.code==='unsupported-list-numbering'));
  }
  for(const numbering of [n(0,1,'decimal',{label:'1.2.',definition:{numFmt:{val:'decimal'},lvlText:'%1.%2.'}}),n(0,1,'chicago',{label:'*'})]){
    const a=await run([p('Verified label',numbering)]);assert.deepEqual(blocking(a),[]);assert.equal(html(a),`<p>${numbering.label} Verified label</p>`);valid(a);
  }
  const item=p('Missing metadata');item.pPr={numPr:{numId:'10',ilvl:0}};
  assert.ok(blocking(await run([item])).some(w=>w.code==='list-numbering-unverified'));
});

test('vertical merges emit one native rowspan anchor and retain neighbors',async()=>{
  const a=await run([table([row([cell('Merged',{vMerge:'restart'}),cell('Right one')]),row([cell('',{vMerge:'continue'}),cell('Right two')])])]);
  assert.match(html(a),/<td rowspan="2" style="width:50%;vertical-align:top"><p>Merged<\/p><\/td>/);assert.equal((html(a).match(/<td\b/g)||[]).length,3);
  assert.match(html(a),/<tr><td style="width:50%;vertical-align:top"><p>Right two/);assert.deepEqual(blocking(a),[]);valid(a);
});

test('combined merges retain meaningful continuation content and nested native lists/tables once',async()=>{
  const nested=table([row([cell('Inner',{vMerge:'restart'}),cell('N1')]),row([cell('',{vMerge:'continue'}),cell('N2')])]);
  const a=await run([table([row([cell([p('Anchor'),p('List first',n(0,4)),p('List second',n(0,5)),nested],{vMerge:'restart',gridSpan:2}),cell('R1')]),row([cell('Continued text',{vMerge:'continue',gridSpan:2}),cell('R2')]),row([cell('',{vMerge:'continue',gridSpan:2}),cell('R3')])],3)]);
  assert.match(html(a),/<td colspan="2" rowspan="3" style="width:66.6666%;vertical-align:top">/);assert.match(html(a),/rowspan="2"/);
  assert.equal((html(a).match(/Continued text/g)||[]).length,1);assert.match(html(a),/<ol start="4"/);assert.deepEqual(blocking(a),[]);valid(a);
});

test('row grid offsets preserve logical columns around a vertical merge',async()=>{
  const a=await run([table([row([cell('Offset',{vMerge:'restart'})],{gridBefore:1,gridAfter:1}),row([cell('',{vMerge:'continue'})],{gridBefore:1,gridAfter:1})],3)]);
  assert.match(html(a),/<tr><td style="width:33.3333%;vertical-align:top"><p><br><\/p><\/td><td rowspan="2" style="width:33.3333%;vertical-align:top">/);assert.equal((html(a).match(/<td\b/g)||[]).length,5);assert.deepEqual(blocking(a),[]);
});

test('new restart or ordinary cells end a merge and lone restart stays valid',async()=>{
  const a=await run([table([row([cell('A',{vMerge:'restart'}),cell('B',{vMerge:'restart'})]),row([cell('C'),cell('D',{vMerge:'continue'})]),row([cell('E',{vMerge:'restart'}),cell('F')])])]);
  assert.equal((html(a).match(/rowspan="2"/g)||[]).length,1);assert.equal((html(a).match(/<td\b/g)||[]).length,5);assert.deepEqual(blocking(a),[]);
});

test('invalid table topology is rejected before an editable page is produced',async()=>{
  const invalid=[table([row([cell('Orphan',{vMerge:'continue'}),cell('B')])]),table([row([cell('A',{vMerge:'restart',gridSpan:2})]),row([cell('Mismatch',{vMerge:'continue'}),cell('B')])]),table([row([cell('A',{vMerge:true}),cell('B')])]),table([row([cell('A',{gridSpan:0}),cell('B')])]),table([row([cell('A'),cell('B')],{gridBefore:-1})]),table([row([cell('A',{gridSpan:3})])])];
  for(const t of invalid)await assert.rejects(run([t]),{code:'unsupported-content'});
});

test('merged bottom border comes from the tail and varying side borders adapt to a native stroke',async()=>{
  const border=c=>({value:'single',sz:8,color:{r:c,g:0,b:0}});
  const a=await run([table([row([cell('A',{vMerge:'restart',tcBorders:{bottom:border(1)}}),cell('B')]),row([cell('',{vMerge:'continue',tcBorders:{bottom:border(255)}}),cell('C')])])]);
  assert.match(html(a),/<td rowspan="2" style="width:50%;border-bottom:1pt solid #ff0000;vertical-align:top"/);assert.deepEqual(blocking(a),[]);
  const b=await run([table([row([cell('A',{vMerge:'restart',tcBorders:{start:border(1)}}),cell('B')]),row([cell('',{vMerge:'continue',tcBorders:{start:border(255)}}),cell('C')])])]);
  assert.deepEqual(blocking(b),[]);assert.ok(b.model.warnings.some(w=>w.code==='merged-cell-border-adapted'));
});
