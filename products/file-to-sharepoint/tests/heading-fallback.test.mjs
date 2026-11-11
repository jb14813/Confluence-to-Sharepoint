import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath}from'node:url';
import {build}from'esbuild';
import {chromium}from'playwright';
import {adaptDocument}from'../src/content/index.js';
import {checkCanvasBlock}from'../../../src/sharepoint/canvas.js';
import {chromiumExecutable}from'./chromium.mjs';

const run=(text,b)=>({type:'run',...(b===undefined?{}:{rPr:{b}}),content:[text]});
const p=(text,b)=>({type:'paragraph',content:[run(text,b)]});
const heading=content=>({type:'paragraph',pPr:{pStyle:'heading'},content});
const document=content=>({type:'document',textPr:{b:false,sz:24,rFonts:{ascii:'Arial'}},styles:{heading:{name:'Heading 1',pPr:{outlineLvl:0},rPr:{b:true}},regular:{rPr:{b:false}}},content});
const adapt=officeDocument=>adaptDocument({name:'headings.docx',bytes:Uint8Array.of(1),result:{officeDocument,warnings:[]}});

test('nonbold heading appearance uses editable paragraphs while source heading identities and levels remain available',async()=>{
  const regular=heading([run('Regular heading',false)]);regular.ftsSourceAnchors=['file-source-anchor-1'];
  const mixed=heading([run('Bold part'),run(' regular part',false)]);
  const allBold=heading([run('All bold'),run(' \n',false),{type:'endRun',rPr:{b:false},content:[]}]);
  const characterStyle=heading([{type:'run',rPr:{rStyle:'regular'},content:['Character-style nonbold']}]);
  const empty=heading([{type:'endRun',rPr:{b:false},content:[]}]);
  const a=await adapt(document([p('Ordinary body'),regular,mixed,allBold,characterStyle,empty,{type:'paragraph',content:[{type:'hyperlink',value:'#file-source-anchor-1',content:[run('Jump to source heading')]}]}]));
  const html=a.model.blocks.map(block=>block.html).join('');
  assert.match(html,/<p id="file-source-anchor-1"[^>]*>[\s\S]*Regular heading/);
  assert.match(html,/<p id="file-heading-2"[^>]*>[\s\S]*Bold part/);
  assert.match(html,/<h1 id="file-heading-3"[^>]*>[\s\S]*All bold/);
  assert.match(html,/<p id="file-heading-4"[^>]*>[\s\S]*Character-style nonbold/);
  assert.ok(html.includes('href="#file-source-anchor-1"'));assert.ok(!html.includes('!important'));
  assert.equal(a.model.headings.length,4);assert.equal(a.model.stats.headings1,4);assert.deepEqual(a.model.headings.map(item=>item.level),[1,1,1,1]);
  assert.deepEqual(a.preview.headingAdaptations.map(item=>({id:item.sourceId,level:item.level,renderedAs:item.renderedAs,reason:item.reason})),[
    {id:'file-source-anchor-1',level:1,renderedAs:'paragraph',reason:'nonbold-text'},
    {id:'file-heading-2',level:1,renderedAs:'paragraph',reason:'nonbold-text'},
    {id:'file-heading-4',level:1,renderedAs:'paragraph',reason:'nonbold-text'}
  ]);
  assert.equal(a.model.warnings.filter(warning=>warning.code==='heading-format-adapted').length,1);assert.ok(!a.model.warnings.some(warning=>warning.blocking));
  for(const block of a.model.blocks)checkCanvasBlock(block);
});

test('nested normal paragraphs tables and textbox text do not change their containing bold heading classification',async()=>{
  const nested=heading([run('Outer bold'),p('Nested nonbold body',false)]);
  const cell={type:'tblCell',tcPr:{},content:{type:'docContent',content:[p('Nonbold table cell',false)]}},table={type:'table',tblGrid:[{type:'gridCol',w:1000}],content:[{type:'tblRow',content:[cell]}]};
  const withTable=heading([run('Heading before table'),table,run('Heading after table')]);
  const noFill={type:'fill',transparent:null,fill:{type:'noFill'}},textbox={type:'paraDrawing',graphic:{type:'shape',id:'textbox',spPr:{fill:noFill,ln:{fill:noFill}},content:{type:'docContent',content:[p('Nonbold textbox content',false)]}}};
  const withTextbox=heading([run('Bold outside textbox'),{type:'run',content:[textbox]}]);
  const a=await adapt(document([nested,withTable,withTextbox,p('Later regular body',false)]));
  assert.equal(a.preview.headingAdaptations,undefined);assert.equal(a.model.headings.length,3);
  assert.equal(a.model.warnings.filter(warning=>warning.code==='heading-format-adapted').length,0);
  const html=a.model.blocks.map(block=>block.html).join('');for(const text of ['Outer bold','Heading before table','Heading after table','Bold outside textbox'])assert.match(html,new RegExp('<h1[^>]*>[\\s\\S]*?'+text));
  assert.ok(!a.model.warnings.some(warning=>warning.blocking),JSON.stringify(a.model.warnings));for(const block of a.model.blocks)checkCanvasBlock(block);
});

test('formatted heading fallback retains mixed400/700 text under the actual tenant heading cascade',{timeout:30000},async()=>{
  const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/content/index.js',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'FileContent',platform:'browser'});
  const browser=await chromium.launch({headless:true,executablePath:await chromiumExecutable()});
  try{
    const page=await browser.newPage(),requests=[];await page.route('**/*',route=>{if(route.request().url()==='https://heading-fallback.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><style>.rte--ck5 .ck-content strong{font-weight:600}.rte--ck5 .ck-content h1,.rte--ck5 .ck-content h2,.rte--ck5 .ck-content h3,.rte--ck5 .ck-content h4{font-weight:600!important}.rte--ck5 .ck-content h1 strong,.rte--ck5 .ck-content h2 strong,.rte--ck5 .ck-content h3 strong,.rte--ck5 .ck-content h4 strong{font-weight:700}</style><div class="rte--ck5"><main class="ck-content"></main></div>'});requests.push(route.request().url());return route.abort();});
    await page.goto('https://heading-fallback.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});
    const output=await page.evaluate(async officeDocument=>{const a=await FileContent.adaptDocument({name:'weights.docx',bytes:Uint8Array.of(1),result:{officeDocument,warnings:[]}});document.querySelector('main').innerHTML=a.model.blocks.map(block=>block.html).join('');/* The native editor removes negative weight overrides under headings. */for(const span of document.querySelectorAll('h1 span[style],h2 span[style],h3 span[style],h4 span[style]'))if(span.style.fontWeight==='400')span.style.removeProperty('font-weight');const rows=[],walker=document.createTreeWalker(document.querySelector('main'),NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;if(!node.textContent.trim())continue;rows.push({text:node.textContent,weight:getComputedStyle(node.parentElement).fontWeight,block:node.parentElement.closest('p,h1,h2,h3,h4,h5,h6').localName});}return{rows,headings:a.model.headings,adaptations:a.preview.headingAdaptations};},document([heading([run('Source regular',false)]),heading([run('Source bold')]),heading([run('Mixed bold'),run('Mixed normal',false)])]));
    assert.deepEqual(output.rows,[{text:'Source regular',weight:'400',block:'p'},{text:'Source bold',weight:'700',block:'h1'},{text:'Mixed bold',weight:'700',block:'p'},{text:'Mixed normal',weight:'400',block:'p'}]);assert.equal(output.headings.length,3);assert.equal(output.adaptations.length,2);assert.deepEqual(requests,[]);
  }finally{await browser.close();}
});
