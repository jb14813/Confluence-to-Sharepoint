import test from 'node:test';import assert from 'node:assert/strict';
import {adaptDocument} from '../src/content/index.js';
import {checkCanvasBlock} from '../../../src/sharepoint/canvas.js';
const cell=text=>({type:'tblCell',content:[{type:'paragraph',content:[{type:'run',content:[text]}]}]});

test('native SDK unequal table columns retain responsive source ratios',async()=>{
 const table={type:'table',tblGrid:[{type:'gridCol',w:1440},{type:'gridCol',w:4320}],tblPr:{tblLayout:'fixed'},content:[{type:'tblRow',content:[cell('Narrow'),cell('Wide')]}]};
 const result=await adaptDocument({name:'unequal.docx',bytes:Uint8Array.of(1),result:{officeDocument:{type:'document',content:[table]},warnings:[],media:{}}});
 const html=result.model.blocks.map(b=>b.html).join('');
 assert.match(html,/^<figure class="table" style="width:100%;"><table\b/);
 assert.match(html,/<\/table><\/figure>$/);
 assert.match(html,/<colgroup><col style="width:25%"\s*\/?><col style="width:75%"\s*\/?><\/colgroup>/);
 assert.match(html,/table-layout:fixed/);for(const block of result.model.blocks)checkCanvasBlock(block);
});


test('current native table wrapper preserves four-decimal source columns, spans, text and picture bytes',async()=>{
 const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
 const merged=cell('Merged source');merged.tcPr={gridSpan:2,vMerge:'restart'};
 merged.content.push({type:'paragraph',content:[{type:'run',content:[{type:'paraDrawing',drawingType:'inline',extent:{cx:20*9525,cy:20*9525},graphic:{id:'cell-image',type:'image',blipFill:{rasterImageId:'cell.png'},spPr:{}}}]}]});
 const continuation=cell('');continuation.tcPr={gridSpan:2,vMerge:'continue'};
 const table={type:'table',tblGrid:[{w:1440},{w:1440},{w:2880}],content:[
  {type:'tblRow',content:[merged,cell('Top right')]},
  {type:'tblRow',content:[continuation,cell('Bottom right')]}
 ]};
 const fractional={type:'table',tblGrid:[{w:208955},{w:791045}],content:[{type:'tblRow',content:[cell('Narrow source'),cell('Wide source')]}]};
 const result=await adaptDocument({name:'fractional.docx',bytes:Uint8Array.of(1),result:{officeDocument:{type:'document',content:[table,fractional]},warnings:[],media:{'cell.png':png}}},{measureImage:async()=>({width:1,height:1})});
 const html=result.model.blocks.map(b=>b.html).join('');
 assert.equal((html.match(/<figure class="table" style="width:100%;">/g)||[]).length,2);
 assert.doesNotMatch(html,/canvasRteResponsiveTable|tableWrapper/);
 assert.match(html,/<colgroup><col style="width:20\.8955%"\s*\/?><col style="width:79\.1045%"\s*\/?><\/colgroup>/);
 assert.match(html,/<td colspan="2" rowspan="2" style="[^"]*width:50%/);
 for(const text of ['Merged source','Top right','Bottom right','Narrow source','Wide source'])assert.ok(html.includes(text));
 assert.match(html,/<div class="c2sPicture" data-picture="0"><\/div>/);
 assert.equal(result.model.assets.length,1);
 assert.deepEqual(new Uint8Array(await result.pictures.get(result.model.assets[0].id).arrayBuffer()),png);
 for(const block of result.model.blocks)checkCanvasBlock(block);
});

test('source textboxes keep their existing legacy table grouping',async()=>{
 const drawing={type:'paraDrawing',drawingType:'inline',graphic:{id:'textbox',type:'shape',spPr:{},content:[{type:'paragraph',content:[{type:'run',content:['Textbox source']}]}]}};
 const result=await adaptDocument({name:'textbox.docx',bytes:Uint8Array.of(1),result:{officeDocument:{type:'document',content:[{type:'paragraph',content:[drawing]}]},warnings:[],media:{}}});
 const html=result.model.blocks.map(b=>b.html).join('');
 assert.match(html,/^<div class="canvasRteResponsiveTable"><div class="tableCenterAlign tableWrapper"><table\b/);
 assert.doesNotMatch(html,/<figure/);assert.match(html,/Textbox source/);
 for(const block of result.model.blocks)checkCanvasBlock(block);
});

test('source widths and row minima survive as native editable cell properties',async()=>{
 const table={type:'table',tblGrid:[{w:1440},{w:4320}],content:[
  {type:'tblRow',trPr:{trHeight:{val:800,hRule:'atLeast'}},content:[cell(''),cell('')]},
  {type:'tblRow',trPr:{trHeight:{val:400,hRule:'exact'}},content:[cell('Editable narrow'),cell('Expandable source text')]}
 ]};
 const result=await adaptDocument({name:'row-minimum.docx',bytes:Uint8Array.of(1),result:{officeDocument:{type:'document',content:[table]},warnings:[],media:{}}});
 const html=result.model.blocks.map(b=>b.html).join('');
 assert.match(html,/<td style="[^"]*width:25%[^"]*height:40pt[^"]*"/);
 assert.match(html,/<td style="[^"]*width:75%[^"]*height:20pt[^"]*"/);
 for(const block of result.model.blocks)checkCanvasBlock(block);
});

test('merged cell properties cover the sum of their verified source columns and rows',async()=>{
 const merged=cell('Merged source');merged.tcPr={gridSpan:2,vMerge:'restart'};
 const continuation=cell('');continuation.tcPr={gridSpan:2,vMerge:'continue'};
 const table={type:'table',tblGrid:[{w:1440},{w:1440},{w:2880}],content:[
  {type:'tblRow',trPr:{trHeight:{val:400,hRule:'atLeast'}},content:[merged,cell('Top right')]},
  {type:'tblRow',trPr:{trHeight:{val:800,hRule:'atLeast'}},content:[continuation,cell('Bottom right')]}
 ]};
 const result=await adaptDocument({name:'merged-minimum.docx',bytes:Uint8Array.of(1),result:{officeDocument:{type:'document',content:[table]},warnings:[],media:{}}});
 const html=result.model.blocks.map(b=>b.html).join('');
 assert.match(html,/<td colspan="2" rowspan="2" style="[^"]*width:50%[^"]*height:60pt[^"]*"/);
});


test('over-budget cell height retains editable source using native automatic sizing',async()=>{
 const table={type:'table',tblGrid:[{w:1440}],content:[{type:'tblRow',trPr:{trHeight:{val:81921,hRule:'atLeast'}},content:[cell('Retained source content')]}]};
 const result=await adaptDocument({name:'too-tall.docx',bytes:Uint8Array.of(1),result:{officeDocument:{type:'document',content:[table]},warnings:[],media:{}}});
 assert.ok(result.model.warnings.some(w=>w.code==='table-cell-height-adapted'&&!w.blocking));
 assert.ok(!result.model.warnings.some(w=>w.blocking));
 assert.match(result.model.blocks.map(b=>b.html).join(''),/Retained source content/);
 assert.doesNotMatch(result.model.blocks.map(b=>b.html).join(''),/height:/);
});


test('SDK default vertical alignment is top and explicit center/bottom remain source-driven',async()=>{
 const a=cell('Default top'),b=cell('Explicit center'),c=cell('Explicit bottom');b.tcPr={vAlign:'center'};c.tcPr={vAlign:'bottom'};
 const table={type:'table',tblGrid:[{w:1},{w:1},{w:1}],content:[{type:'tblRow',content:[a,b,c]}]};
 const result=await adaptDocument({name:'alignment.docx',bytes:Uint8Array.of(1),result:{officeDocument:{type:'document',content:[table]},warnings:[],media:{}}});
 const html=result.model.blocks.map(b=>b.html).join('');
 assert.match(html,/<td style="[^"]*vertical-align:top[^"]*"><p>Default top/);
 assert.match(html,/<td style="[^"]*vertical-align:middle[^"]*"><p>Explicit center/);
 assert.match(html,/<td style="[^"]*vertical-align:bottom[^"]*"><p>Explicit bottom/);
});

test('resolved SDK cell alignment overrides an inherited table style including numeric top',async()=>{
 const a=cell('Top overrides inherited center'),b=cell('Inherited center'),c=cell('Explicit bottom');
 a.ftsVerticalAlign='top';b.ftsVerticalAlign='center';c.ftsVerticalAlign='bottom';c.tcPr={vAlign:'bottom'};
 const table={type:'table',tblPr:{tblStyle:'centered'},tblGrid:[{w:1},{w:1},{w:1}],content:[{type:'tblRow',content:[a,b,c]}]};
 const officeDocument={type:'document',styles:{centered:{tcPr:{vAlign:'center'}}},content:[table]};
 const result=await adaptDocument({name:'inherited-alignment.docx',bytes:Uint8Array.of(1),result:{officeDocument,warnings:[],media:{}}});
 const html=result.model.blocks.map(b=>b.html).join('');
 assert.match(html,/<td style="[^"]*vertical-align:top[^"]*"><p>Top overrides inherited center/);
 assert.match(html,/<td style="[^"]*vertical-align:middle[^"]*"><p>Inherited center/);
 assert.match(html,/<td style="[^"]*vertical-align:bottom[^"]*"><p>Explicit bottom/);
 for(const block of result.model.blocks)checkCanvasBlock(block);
});
