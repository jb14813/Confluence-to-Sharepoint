import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptDocument} from '../src/content/index.js';
import {checkCanvasBlock} from '../../../src/sharepoint/canvas.js';

const paragraph=(text,ftsNumbering,extra={})=>({type:'paragraph',content:[{type:'run',content:[text]}],...(ftsNumbering?{ftsNumbering}:{}),...extra});
const numbering=(label,extra={})=>({numId:'10',scopeId:'main',level:0,value:1,label,definition:{numFmt:{val:'decimal'},lvlText:'%1.'},...extra});
const adapt=(content,extra={})=>adaptDocument({name:'lists.docx',bytes:Uint8Array.of(1),result:{officeDocument:{type:'document',content},warnings:[],...extra}},{measureImage:async()=>({width:1,height:1})});
const output=a=>a.model.blocks.map(block=>block.html).join('');
const blockers=a=>a.model.warnings.filter(warning=>warning.blocking);
const valid=a=>a.model.blocks.forEach(checkCanvasBlock);

test('verified custom and compound labels remain escaped editable text with source targets and inline formatting',async()=>{
  const custom=paragraph('Editable custom item',numbering('<Phase & "1">'),{ftsSourceAnchors:['file-source-anchor-1']});
  custom.content[0].rPr={b:true};
  const compound=paragraph('Compound item',numbering('2.3)',{level:1,value:3,definition:{numFmt:{val:'decimal'},lvlText:'%1.%2)'}}));
  compound.content.push({type:'hyperlink',value:'#file-source-anchor-1',content:[{type:'run',content:['Return to custom item']}]});
  const a=await adapt([custom,compound]);
  assert.deepEqual(blockers(a),[]);
  assert.match(output(a),/<p id="file-source-anchor-1">&lt;Phase &amp; &quot;1&quot;&gt; <strong><span style="font-weight:700">Editable custom item<\/span><\/strong><\/p>/);
  assert.match(output(a),/<p>2\.3\) Compound item<a href="#file-source-anchor-1">Return to custom item<\/a><\/p>/);
  assert.doesNotMatch(output(a),/<(?:ol|ul)\b/);
  assert.equal(a.model.stats.numbered,2);
  assert.ok(a.model.warnings.some(w=>w.code==='list-marker-adapted'&&!w.blocking&&/automatic numbering/i.test(w.message)));
  valid(a);
});

test('alphabetic counters beyond CSS compatibility and alternate verified labels retain their exact source text',async()=>{
  const content=[
    paragraph('Lower alphabetic',numbering('bb.',{value:28,definition:{numFmt:{val:'lowerLetter'},lvlText:'%1.'}})),
    paragraph('Upper alphabetic',numbering('BB.',{value:28,definition:{numFmt:{val:'upperLetter'},lvlText:'%1.'}})),
    paragraph('Roman source spelling',numbering('4.',{value:4,definition:{numFmt:{val:'upperRoman'},lvlText:'%1.'}})),
  ];
  const a=await adapt(content);
  assert.deepEqual(blockers(a),[]);
  assert.equal(output(a),'<p>bb. Lower alphabetic</p><p>BB. Upper alphabetic</p><p>4. Roman source spelling</p>');
  valid(a);
});

test('verified Unicode custom bullet labels remain literal while unresolved font glyphs still block',async()=>{
  const bullet=(label,font)=>numbering(label,{font,definition:{numFmt:{val:'bullet'},lvlText:label}});
  const a=await adapt(['→','✓','·'].map(label=>paragraph('Unicode marker',bullet(label))));
  assert.deepEqual(blockers(a),[]);
  assert.equal(output(a),'<p>→ Unicode marker</p><p>✓ Unicode marker</p><p>· Unicode marker</p>');
  for(const [label,font] of [['\uf0b7','Wingdings'],['\uf0b7',undefined],['\uf0a7','Wingdings 3'],['o','Wingdings']]){
    const blocked=await adapt([paragraph('Unknown glyph',bullet(label,font))]);
    assert.ok(blockers(blocked).some(w=>w.code==='unsupported-list-numbering'));
    assert.doesNotMatch(output(blocked),/list-style-type:disc/);
  }
  valid(a);
});

test('missing list levels normalize around real items without adding invented empty ancestors',async()=>{
  const a=await adapt([
    paragraph('Initial nested',numbering('1.',{level:2,definition:{numFmt:{val:'decimal'},lvlText:'%3.'}})),
    paragraph('Deeper real child',numbering('1.',{level:4,definition:{numFmt:{val:'decimal'},lvlText:'%5.'}})),
    paragraph('Real middle',numbering('1.',{level:3,definition:{numFmt:{val:'decimal'},lvlText:'%4.'}})),
  ]);
  assert.deepEqual(blockers(a),[]);
  assert.equal(output(a),'<ol start="1" style="list-style-type:decimal"><li><p>Initial nested</p><ol start="1" style="list-style-type:decimal"><li><p>Deeper real child</p></li></ol><ol start="1" style="list-style-type:decimal"><li><p>Real middle</p></li></ol></li></ol>');
  assert.equal((output(a).match(/<li>/g)||[]).length,3);
  assert.ok(a.model.warnings.some(w=>w.code==='list-depth-review'&&!w.blocking));
  valid(a);
});

test('literal marker items retain child lists, parent continuations, pictures and tables in source order',async()=>{
  const first=paragraph('Custom parent',numbering('Step A:'),{ftsListItem:{itemId:'parent-a'}});
  const child=paragraph('Native child',numbering('1.',{level:1,definition:{numFmt:{val:'decimal'},lvlText:'%2.'}}),{ftsListItem:{itemId:'child-a'}});
  const after=paragraph('After child',undefined,{ftsListContinuation:{itemId:'parent-a'}});
  const image=paragraph('',undefined,{ftsListContinuation:{itemId:'parent-a'}});
  image.content[0].content=[{type:'paraDrawing',drawingType:'inline',extent:{cx:952500,cy:952500},graphic:{id:'literal-item-picture',type:'image',blipFill:{rasterImageId:'list.png'},spPr:{}}}];
  const table={type:'table',ftsListContinuation:{itemId:'parent-a'},tblGrid:[{type:'gridCol',w:1000}],content:[{type:'tblRow',content:[{type:'tblCell',content:{type:'docContent',content:[paragraph('Continuation table')]}}]}]};
  const last=paragraph('Next native sibling',numbering('2.',{value:2}),{ftsListItem:{itemId:'parent-b'}});
  const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1kAAAAASUVORK5CYII=','base64'));
  const a=await adapt([first,child,after,image,table,last],{media:{'word/media/list.png':png}});
  assert.deepEqual(blockers(a),[]);
  assert.match(output(a),/<p>Step A: Custom parent<\/p><ol start="1"[^>]*><li><p>Native child<\/p><\/li><\/ol><p>After child<\/p><div class="c2sPicture" data-picture="0"><\/div>[\s\S]*Continuation table[\s\S]*<\/table>[\s\S]*<ol start="2"[^>]*><li><p>Next native sibling<\/p>/);
  assert.equal(a.model.assets.length,1);
  assert.equal(a.model.blocks.flatMap(block=>block.pictures??[]).length,1);
  assert.equal(a.model.stats.tables,1);
  assert.equal(a.model.stats.numbered,3);
  valid(a);
});

test('literal marker fallback retains source association and metadata verification guards',async()=>{
  const first=paragraph('Custom parent',numbering('Step A:'),{ftsListItem:{itemId:'same-id'}});
  const duplicate=paragraph('Ambiguous child',numbering('Child A:',{level:1,definition:{numFmt:{val:'decimal'},lvlText:'%2.'}}),{ftsListItem:{itemId:'same-id'}});
  const continued=paragraph('Ambiguous continuation',undefined,{ftsListContinuation:{itemId:'same-id'}});
  assert.ok(blockers(await adapt([first,duplicate,continued])).some(w=>w.code==='list-continuation-unverified'));
  for(const extra of [{level:10},{value:-1},{definition:{}},{label:''},{definition:{numFmt:{val:12},lvlText:'%1.'}},{label:'\uf123'}]){
    const a=await adapt([paragraph('Retained for review',numbering('Step A:',extra))]);
    assert.match(output(a),/Retained for review/);
    assert.ok(blockers(a).some(w=>w.code==='unsupported-list-numbering'));
  }
});

test('duplicate native source item IDs cannot make continuation ownership ambiguous',async()=>{
  const first=paragraph('Native parent',numbering('1.'),{ftsListItem:{itemId:'same-native-id'}});
  const duplicate=paragraph('Native child',numbering('1.',{level:1,definition:{numFmt:{val:'decimal'},lvlText:'%2.'}}),{ftsListItem:{itemId:'same-native-id'}});
  const continued=paragraph('Ambiguous native continuation',undefined,{ftsListContinuation:{itemId:'same-native-id'}});
  assert.ok(blockers(await adapt([first,duplicate,continued])).some(w=>w.code==='list-continuation-unverified'));
});

test('invisible or absent marker definitions cannot bypass markerless source verification',async()=>{
  for(const label of [' ','\u200b']){
    const a=await adapt([paragraph('Ambiguous markerless entry',numbering(label))]);
    assert.ok(blockers(a).some(w=>w.code==='unsupported-list-numbering'));
  }
  const missingPattern=numbering('Unverified label',{definition:{numFmt:{val:'decimal'},lvlText:''}});
  assert.ok(blockers(await adapt([paragraph('Missing marker pattern',missingPattern)])).some(w=>w.code==='unsupported-list-numbering'));
});

test('explicit Word None numbering retains its marker-free paragraphs without requiring Confluence task metadata',async()=>{
  const none=numbering('',{definition:{numFmt:{val:'none'},lvlText:''}});
  const a=await adapt([paragraph('Intentionally marker-free',none)]);
  assert.deepEqual(blockers(a),[]);assert.match(output(a),/^<p>Intentionally marker-free<\/p>$/);
  assert.ok(a.model.warnings.some(w=>w.code==='markerless-list-adapted'));valid(a);
  for(const n of [{...none,label:'1.'},{...none,definition:{numFmt:{val:'none'},lvlText:'%1.'}}])assert.ok(blockers(await adapt([paragraph('Inconsistent source',n)])).some(w=>w.code==='unsupported-list-numbering'));
});
