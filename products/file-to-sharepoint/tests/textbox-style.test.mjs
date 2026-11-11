import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {adaptDocument} from '../src/content/index.js';
import {checkCanvasBlock} from '../../../src/sharepoint/canvas.js';

// Native-open SDK models retain an uncalculated outer RGBA cache. The explicit
// srgb child holds the declared source color before document layout runs.
const fill=(type,color)=>({type:'fill',transparent:null,fill:{type,...(color?{color:{rgba:{red:0,green:0,blue:0,alpha:255},color:{type:'srgb',rgba:{red:color[0],green:color[1],blue:color[2],alpha:255}},mods:[],type:'uniColor'}}:{})}});
const noFill=()=>fill('noFill');
const source=(spPr,style)=>({type:'document',content:[{type:'paragraph',content:[{type:'run',content:[{type:'paraDrawing',graphic:{type:'shape',id:'textbox',spPr,style,content:{type:'docContent',content:[{type:'paragraph',content:[{type:'run',content:['Editable source textbox']}]}]}}}]}]}]});
const run=officeDocument=>adaptDocument({name:'source.docx',bytes:Uint8Array.of(1),result:{officeDocument,warnings:[]}});
const html=result=>result.model.blocks.map(block=>block.html).join('');
const blocking=result=>result.model.warnings.filter(warning=>warning.blocking);

test('SDK explicit no-fill textbox does not acquire an invented visible border',async()=>{
  const result=await run(source({fill:noFill(),ln:{fill:noFill()}}));
  assert.match(html(result),/border:0pt solid #000000/);
  assert.doesNotMatch(html(result),/#777777/);
  assert.match(html(result),/Editable source textbox/);
  assert.deepEqual(blocking(result),[]);
  for(const block of result.model.blocks)checkCanvasBlock(block);
});

test('SDK explicit solid textbox border and fill retain their source colors and width',async()=>{
  const result=await run(source({fill:fill('solid',[250,240,220]),ln:{fill:fill('solid',[18,52,86]),w:25400,prstDash:'solid',cmpd:'sng'}}));
  assert.match(html(result),/border:2pt solid #123456/);
  assert.match(html(result),/background-color:#faf0dc/);
  assert.deepEqual(blocking(result),[]);
  for(const block of result.model.blocks)checkCanvasBlock(block);
});

test('unresolved or unrepresentable textbox decoration uses native styles without blocking editable content',async()=>{
  const unresolvedTheme=fill('solid',[0,0,0]);unresolvedTheme.fill.color.color={type:'scheme',val:'accent1'};
  for(const spPr of [{fill:fill('grad'),ln:{fill:noFill()}},{fill:unresolvedTheme,ln:{fill:noFill()}},{fill:noFill(),ln:{fill:fill('solid',[0,0,0]),w:null}},{fill:noFill(),ln:{fill:fill('solid',[0,0,0]),w:25400,prstDash:'dashDot'}},{fill:noFill()}]){
    const result=await run(source(spPr));
    assert.match(html(result),/Editable source textbox/);
    assert.deepEqual(blocking(result),[]);
    assert.ok(result.model.warnings.some(warning=>warning.code==='textbox-style-adapted'));
    assert.doesNotMatch(html(result),/#777777/);
  }
});

test('actual packaged SDK PDF textbox fixture retains every native text group without gray borders',async()=>{
  const doc=JSON.parse(await readFile(new URL('./fixtures/content-pdf.json',import.meta.url),'utf8'));
  const textboxes=[];
  function walk(value){if(!value||typeof value!=='object')return;if(value.type==='paraDrawing'&&value.graphic?.content)textboxes.push(value);for(const child of Object.values(value))if(child&&typeof child==='object')walk(child);}
  walk(doc);
  // Use the unchanged real SDK textbox nodes. Vector/image adaptation is a
  // separate contract and does not participate in this source-style control.
  const result=await run({...doc,content:textboxes.map(drawing=>({type:'paragraph',content:[{type:'run',content:[drawing]}]}))});
  assert.equal(result.preview.drawings.filter(drawing=>drawing.kind==='textbox').length,7);
  assert.equal((html(result).match(/border:0pt solid #000000/g)||[]).length,7);
  assert.doesNotMatch(html(result),/#777777/);
  assert.ok(!blocking(result).some(warning=>warning.code==='textbox-style-review'));
  for(const block of result.model.blocks)checkCanvasBlock(block);
});
