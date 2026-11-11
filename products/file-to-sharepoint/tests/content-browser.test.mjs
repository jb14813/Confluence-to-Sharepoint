import test from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import JSZip from 'jszip';
import {fixtures} from './engine-fixtures.mjs';

const exists=async p=>{try{await access(p);return true;}catch{return false;}};
async function browserPath(){
  for(const p of [process.env.EXTENSION_CHROME_PATH,process.env.CHROME_PATH,chromium.executablePath()])if(p&&await exists(p))return p;
  const base=path.join(process.env.LOCALAPPDATA,'ms-playwright');
  for(const revision of (await readdir(base)).filter(n=>/^chromium-\d+$/.test(n)).sort().reverse())for(const layout of ['chrome-win64/chrome.exe','chrome-win/chrome.exe']){
    const p=path.join(base,revision,layout);if(await exists(p))return p;
  }
  throw Error('An extension-capable Chromium executable is required.');
}

for(const tenant of [false,true])test(`source run weights paint 700/400 under ${tenant?'observed SharePoint CKEditor rules':'browser defaults'}`,{timeout:30000},async()=>{
  const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/content/index.js',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'FileContent',platform:'browser'});
  const browser=await chromium.launch({headless:true,executablePath:await browserPath()});
  try{
    const page=await browser.newPage(),requests=[];
    // These three declarations were read from the actual SharePoint viewer's
    // matched CSS rules. Explicit run formatting must survive its heading and
    // strong baselines without requiring arbitrary important styles.
    const css='.rte--ck5 .ck-content strong{font-weight:600}.rte--ck5 .ck-content h1,.rte--ck5 .ck-content h2,.rte--ck5 .ck-content h3,.rte--ck5 .ck-content h4{font-weight:600!important}.rte--ck5 .ck-content h1 strong,.rte--ck5 .ck-content h2 strong,.rte--ck5 .ck-content h3 strong,.rte--ck5 .ck-content h4 strong{font-weight:700}';
    await page.route('**/*',route=>{if(route.request().url()==='https://heading-weight.test/')return route.fulfill({contentType:'text/html',body:`<!doctype html><head><style>${tenant?css:''}</style></head><body></body>`});requests.push(route.request().url());return route.abort();});
    await page.goto('https://heading-weight.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});
    const output=await page.evaluate(async tenant=>{
      const p=(text,bold,heading=false)=>({type:'paragraph',...(heading?{pPr:{pStyle:'heading'}}:{}),content:[{type:'run',...(bold!==undefined?{rPr:{b:bold}}:{}),content:[text]}]});
      const officeDocument={type:'document',textPr:{b:false,sz:24,rFonts:{ascii:'Arial'}},styles:{heading:{name:'Heading 1',pPr:{outlineLvl:0},rPr:{b:true}}},content:[p('Body normal'),p('Body bold',true),p('Inherited bold',undefined,true),p('Explicit nonbold',false,true),p('Explicit bold',true,true)]};
      const a=await FileContent.adaptDocument({name:'weights.docx',bytes:Uint8Array.of(1),result:{officeDocument,warnings:[]}});const html=a.model.blocks.map(block=>block.html).join('');document.body.innerHTML=tenant?`<div class="rte--ck5"><div class="ck-content">${html}</div></div>`:html;
      await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      return [...document.querySelectorAll('p,h1')].map((paragraph,index)=>{const walker=document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT);walker.nextNode();const node=walker.currentNode.parentElement;node.id='weight-'+index;return{text:node.textContent,id:node.id,weight:getComputedStyle(node).fontWeight};});
    },tenant);
    assert.deepEqual(output.map(row=>row.weight),['400','700','700','400','700']);
    const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');const dom=await cdp.send('DOM.getDocument');
    const fonts=[];for(const row of output){const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#'+row.id});fonts.push((await cdp.send('CSS.getPlatformFontsForNode',{nodeId})).fonts);}
    for(const faces of fonts)assert.ok(faces.every(face=>face.postScriptName!=='Arial-Black'),'SDK boolean bold must not request weight900 Arial Black');
    assert.deepEqual(fonts[2].map(face=>face.postScriptName),fonts[1].map(face=>face.postScriptName),'Heading inherited bold uses the ordinary body bold face');
    assert.deepEqual(fonts[4].map(face=>face.postScriptName),fonts[1].map(face=>face.postScriptName),'Heading explicit bold uses the ordinary body bold face');
    assert.deepEqual(fonts[3].map(face=>face.postScriptName),fonts[0].map(face=>face.postScriptName),'Explicit nonbold heading uses the ordinary body face');
    await cdp.detach();assert.deepEqual(requests,[]);
  }finally{await browser.close();}
});

test('browser adapter decodes exact original media and native editable table/formatting without network access',{timeout:30000},async()=>{
  const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/content/index.js',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'FileContent',platform:'browser'});
  const zip=await JSZip.loadAsync(Buffer.from(fixtures['sample-rich.docx'],'base64'));
  const entry=Object.keys(zip.files).find(n=>n.startsWith('word/media/')&&n.endsWith('.png'));
  assert.ok(entry);
  const image=Array.from(await zip.file(entry).async('uint8array'));
  const officeDocument=JSON.parse(await readFile(new URL('fixtures/content-word.json',import.meta.url)));
  const browser=await chromium.launch({headless:true,executablePath:await browserPath()});
  try{
    const page=await browser.newPage(),requests=[];
    await page.route('**/*',route=>{
      if(route.request().url()==='https://file-import.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><main id="preview"></main></body></html>'});
      requests.push(route.request().url());return route.abort();
    });
    await page.goto('https://file-import.test/');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const output=await page.evaluate(async({officeDocument,image})=>{
      const {model,pictures}=await FileContent.adaptDocument({name:'Sample.docx',bytes:new TextEncoder().encode('source'),result:{officeDocument,media:{'word/media/image1.png':Uint8Array.from(image)},pdfForms:null,warnings:[]}});
      document.querySelector('#preview').innerHTML=model.blocks.map(b=>b.html).join('');
      const asset=model.assets[0],retained=Array.from(new Uint8Array(await pictures.get(asset.id).arrayBuffer()));
      return {asset,retained,cells:[...document.querySelectorAll('td')].map(n=>n.textContent),bold:[...document.querySelectorAll('strong')].map(n=>n.textContent),border:getComputedStyle(document.querySelector('td')).borderTopStyle,slots:document.querySelectorAll('.c2sPicture').length,warnings:model.warnings};
    },{officeDocument,image});
    assert.equal(output.asset.width,100);assert.equal(output.asset.height,50);
    assert.deepEqual(output.retained,image);
    assert.deepEqual(output.cells,['Left editable cell','Right editable cell','Second row','Last cell']);
    assert.ok(output.bold.includes('Editable office paragraph with bold text.'));
    assert.equal(output.border,'solid');assert.equal(output.slots,1);
    const coverage=await page.evaluate(async()=>{
      const adapt=async(text,source)=>{
        const officeDocument={type:'document',sectPr:{pgSz:{w:12240,h:15840}},content:[{type:'paragraph',content:[{type:'run',content:[text]}]}]};
        const scalars=Array.from(source.replace(/\s/gu,''),c=>c.codePointAt(0));
        const result={officeDocument,media:{},pdfForms:{Fields:[],Parents:[],pages:[{W:612,H:792,Dpi:72}]},pdfLayout:{version:1,textAssociationType:2,flowGeometry:'native-plain-line-v1'},pdfText:{version:1,pages:[{pageIndex:0,text:source}],order:{version:1,coordinateSpace:'displayed-crop-top-left-pt',pages:[{pageIndex:0,widthPt:612,heightPt:792,rotation:0,unicodeScalars:scalars,scalarBoxesPt:scalars.map((_,i)=>[i,10,i+1,20]),wordStarts:[0]}]}},warnings:[]};
        return (await FileContent.adaptDocument({name:'verified.pdf',bytes:Uint8Array.of(1),result})).model.warnings;
      };
      return {partial:await adapt('Visible','Visible missing source'),complete:await adapt('Visible & tail','Visible & tail')};
    });
    assert.ok(coverage.partial.some(w=>w.code==='pdf-text-loss'&&w.blocking),'Some editable words cannot disguise missing PDF source text');
    assert.deepEqual(coverage.complete.filter(w=>w.blocking),[],'Actual rendered entities must compare as characters');
    const formOnly=await page.evaluate(async()=>{
      const result={officeDocument:{type:'document',sectPr:{pgSz:{w:12240,h:15840}},content:[]},media:{},pdfForms:{Fields:[{type:30,name:'Name',value:'Alice',page:0,rect:{x1:10,y1:20,x2:110,y2:40}}],Parents:[],pages:[{W:612,H:792,Dpi:72}]},pdfLayout:{version:1,textAssociationType:2,flowGeometry:'native-plain-line-v1'},pdfText:{version:1,pages:[{pageIndex:0,text:'',meaningfulScalars:0,bodyTextOps:0,bodyImageOps:0,bodyPathOps:0}],order:{version:1,coordinateSpace:'displayed-crop-top-left-pt',pages:[{pageIndex:0,widthPt:612,heightPt:792,rotation:0,unicodeScalars:[],scalarBoxesPt:[],wordStarts:[]}]}},warnings:[]};
      const output=await FileContent.adaptDocument({name:'fields-only.pdf',bytes:Uint8Array.of(1),result});
      result.pdfText.pages[0].bodyImageOps=1;let painted;try{await FileContent.adaptDocument({name:'image-and-fields.pdf',bytes:Uint8Array.of(1),result});}catch(e){painted=e.code;}
      return{fields:output.formDefinition.fields,warnings:output.model.warnings,bodyCount:output.model.stats.editableTextCharacters,painted};
    });
    assert.equal(formOnly.fields[0].value,'Alice');assert.equal(formOnly.bodyCount,0);assert.deepEqual(formOnly.warnings.filter(w=>w.blocking),[]);assert.equal(formOnly.painted,'empty-document');
    assert.deepEqual(requests,[]);
  }finally{await browser.close();}
});
