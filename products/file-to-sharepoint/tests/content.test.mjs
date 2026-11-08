import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {checkCanvasBlock,serializeCanvas} from '../../../src/sharepoint/canvas.js';
import {sha256Hex} from '../../../src/transfer/limits.js';

const {adaptDocument}=await import('../src/content/index.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};
  throw error;
});
const fixture=async name=>JSON.parse(await readFile(new URL(`fixtures/content-${name}.json`,import.meta.url)));
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
const bytes=new TextEncoder().encode('original source bytes');
const measureImage=async()=>({width:1,height:1});
const run=async(officeDocument,extra={},name='source.docx')=>{
  assert.equal(typeof adaptDocument,'function','The reconstructed content adapter must exist');
  return adaptDocument({name,bytes,result:{officeDocument,media:{'word/media/image1.png':png,'word/media/image1.jpg':Uint8Array.of(255,216,255,224,0,0,255,217)},pdfForms:null,warnings:[],...extra}},{measureImage});
};
const text=adapted=>adapted.model.blocks.filter(b=>b.type==='text').map(b=>b.html).join('');

test('ordinary reconstructed Word retains four editable table cells, bold text and exact original image bytes',async()=>{
  const adapted=await run(await fixture('word'));
  for(const word of ['Left editable cell','Right editable cell','Second row','Last cell'])assert.ok(text(adapted).includes(word));
  assert.equal((text(adapted).match(/<td\b/g)||[]).length,4);
  assert.match(text(adapted),/<strong[^>]*>.*Editable office paragraph with bold text\./s);
  assert.match(text(adapted),/border(?:-\w+)?:0\.5pt solid #000000/);
  const id=await sha256Hex(png);
  assert.equal(adapted.model.assets.length,1);
  assert.equal(adapted.model.assets[0].id,id);
  assert.deepEqual(new Uint8Array(await adapted.pictures.get(id).arrayBuffer()),png);
  assert.equal(adapted.model.assets[0].width,1);
  for(const block of adapted.model.blocks)assert.doesNotThrow(()=>checkCanvasBlock(block));
  assert.equal(adapted.formDefinition,null);
  assert.equal(adapted.model.sourceMetadata,undefined);
  assert.equal(adapted.model.sourceName,'source.docx');
  assert.notEqual(adapted.model.sourceHash,await sha256Hex(bytes),'Source identity must be in the File product namespace');
  const again=await run(await fixture('word'));
  assert.equal(again.model.sourceHash,adapted.model.sourceHash);
});

test('PDF reconstructed textboxes retain all real source text, grouping and drawing geometry with explicit fidelity warnings',async()=>{
  const raw=await fixture('forms');
  const adapted=await run(await fixture('pdf'),{pdfForms:{...raw.forms,pages:raw.pages}},'evidence.pdf');
  for(const word of ['Left cell','Right cell','Name:','Alice','Approved:','Department:','Engineering','ONLYOFFICE Import Evidence'])assert.ok(text(adapted).includes(word),word);
  assert.ok((text(adapted).match(/<table\b/g)||[]).length>=7,'Textboxes must keep visual grouping');
  assert.equal(adapted.preview.drawings.length,17);
  assert.equal(adapted.preview.drawings.filter(d=>d.kind==='textbox').length,7);
  assert.ok(adapted.preview.drawings.every(d=>Number.isFinite(d.geometry.width)));
  assert.ok(adapted.preview.drawings.some(d=>d.kind==='vector'&&d.shape.custGeom.pathLst.length));
  assert.ok(adapted.model.warnings.some(w=>w.code==='vector-adaptation-required'&&w.blocking));
  assert.ok(adapted.model.warnings.some(w=>w.code==='positioned-content-reflow'&&w.material));
  for(const block of adapted.model.blocks)checkCanvasBlock(block);
});

test('styles inherit by source IDs, text stays escaped, Unicode survives and source filenames are safe',async()=>{
  const doc={type:'document',styles:{heading:{name:'Heading 1',rPr:{color:{r:18,g:52,b:86},b:true},pPr:{outlineLvl:0}}},content:[{type:'paragraph',pPr:{pStyle:'heading'},content:[{type:'run',content:['Crème brûlée <script>& "text"']}]}]};
  const adapted=await run(doc,{},'C:\\private\\unsafe<name>.docx');
  assert.match(text(adapted),/<h1\b/);
  assert.match(text(adapted),/color:#123456/);
  assert.match(text(adapted),/Crème brûlée &lt;script&gt;&amp;/);
  assert.equal(adapted.model.headings[0].text,'Crème brûlée <script>& "text"');
  assert.ok(text(adapted).includes(`id="${adapted.model.headings[0].id}"`));
  assert.ok(!/[\\/<>]/.test(adapted.model.sourceName));
  checkCanvasBlock(adapted.model.blocks[0]);
});

test('missing, external, ambiguous or unsupported media blocks adaptation instead of making a partial document',async()=>{
  const doc=await fixture('word');
  await assert.rejects(run(doc,{media:{}}),{code:'missing-image'});
  const image=doc.content.at(-1).content[0].content[0].graphic;
  image.blipFill.rasterImageId='https://example.test/image1.png';
  await assert.rejects(run(doc),{code:'unsafe-image-reference'});
  image.blipFill.rasterImageId='image1.png';
  await assert.rejects(run(doc,{media:{'word/media/image1.png':png,'other/image1.png':png}}),{code:'ambiguous-image'});
  await assert.rejects(run(doc,{media:{'word/media/image1.png':new TextEncoder().encode('<svg onload=alert(1)>')}}),{code:'unsupported-image'});
});

test('unknown reconstructed content and merged table cells cannot silently report full fidelity',async()=>{
  const doc={type:'document',content:[{type:'paragraph',content:[{type:'run',content:['Keep me']},{type:'equation',content:['x+y']}]}]};
  const adapted=await run(doc);
  assert.match(text(adapted),/Keep me/);assert.match(text(adapted),/x\+y/);
  assert.ok(adapted.model.warnings.some(w=>w.code==='unsupported-content'&&w.blocking));
  const table=await fixture('word');table.content.find(n=>n.type==='table').content[0].content[0].tcPr.vMerge='restart';
  assert.ok((await run(table)).model.warnings.some(w=>w.code==='vertical-cell-merge'&&w.material));
});

test('original PDF fields become runtime-valid logical fields preserving export values, parents and safe keys',async()=>{
  const raw=await fixture('forms');
  const adapted=await run({type:'document',content:[{type:'paragraph',content:[{type:'run',content:['Form']}]}]},{pdfForms:{...raw.forms,pages:raw.pages}});
  const d=adapted.formDefinition;
  assert.equal(d.version,1);assert.match(d.id,/^[a-f0-9]{64}$/);assert.equal(d.fields.length,4);
  const fields=new Map(d.fields.map(f=>[f.sourceName,f]));
  assert.equal(fields.get('person_name').value,'Alice');
  assert.equal(fields.get('approved').value,true);assert.equal(fields.get('approved').exportValue,'Yes');
  assert.deepEqual(fields.get('department').choices,[{label:'Engineering',value:'eng'},{label:'Operations',value:'ops'}]);
  assert.equal(fields.get('department').value,'eng');
  assert.deepEqual(fields.get('shift').choices,[{value:'day',label:'day'},{value:'night',label:'night'}]);
  assert.equal(fields.get('shift').value,'day');assert.equal(fields.get('shift').required,true);
  assert.deepEqual(fields.get('person_name').geometry,{pageIndex:0,rect:{x:125,y:249.8898,width:200,height:22}});
  // Exercise the independently maintained production runtime validator, not a copy of its rules.
  const {build}=await import('esbuild');
  const bundle=await build({entryPoints:[fileURLToPath(new URL('../sharepoint-form/src/runtime/definition.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'});
  const {validateDefinition}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  assert.deepEqual(validateDefinition(d),d);
  for(const f of raw.forms.Fields)if(f.name==='person_name')f.name='__proto__';
  const safe=(await run({type:'document',content:[{type:'paragraph',content:['Form']}]},{pdfForms:raw})).formDefinition;
  assert.equal(safe.fields[0].sourceName,'__proto__');assert.match(safe.fields[0].id,/^f_[a-f0-9]{16}$/);
  assert.deepEqual(validateDefinition(safe),safe);
});

test('script-dependent, signed, multiselect and invalid PDF definitions fail closed',async()=>{
  const doc={type:'document',content:[{type:'paragraph',content:['Form']}]};
  for(const mutation of [f=>f.Fields[0].type=33,f=>f.Fields[0].actions={K:{JS:'alert(1)'}},f=>f.Fields[2].multipleSelection=1,f=>f.Fields[2].value='unknown',f=>f.Fields[3].Parent=999]){
    const {forms,pages}=await fixture('forms');mutation(forms);
    await assert.rejects(run(doc,{pdfForms:{...forms,pages}}),{code:'unsupported-form'});
  }
  const {forms,pages}=await fixture('forms');forms.Fields[0].value='x'.repeat(32769);
  await assert.rejects(run(doc,{pdfForms:{...forms,pages}}),{code:'unsupported-form'});
});

test('native table and picture slot output serializes through the shared SharePoint writer',async()=>{
  const adapted=await run(await fixture('word'));
  const asset=adapted.model.assets[0],id=asset.id;
  const receipt={assetId:id,width:1,height:1,listId:'11111111-1111-4111-8111-111111111111',uniqueId:'22222222-2222-4222-8222-222222222222',serverRelativeUrl:`/sites/review/SiteAssets/sha256-${id}.png`,absoluteUrl:`https://tenant.sharepoint.com/sites/review/SiteAssets/sha256-${id}.png`};
  const canvas=serializeCanvas(adapted.model,[receipt],{siteId:'33333333-3333-4333-8333-333333333333',webId:'44444444-4444-4444-8444-444444444444',siteUrl:'https://tenant.sharepoint.com/sites/review'});
  assert.ok(canvas.CanvasContent1.includes('Left editable cell'));
  assert.ok(canvas.CanvasContent1.includes(`sha256-${id}.png`));
});

test('engine-rendered nontext decorations preserve pixels, geometry and mixed-run text formatting',async()=>{
  const doc={type:'document',content:[{type:'paragraph',content:[{type:'run',rPr:{b:true},content:['Before ',{type:'paraDrawing',drawingType:'anchor',extent:{cx:952500,cy:476250},positionH:{posOffset:95250,relativeFrom:'page'},positionV:{posOffset:190500,relativeFrom:'page'},graphic:{id:'shape1',type:'shape',content:null,spPr:{custGeom:{pathLst:[{commands:[{id:'moveTo',pt:{x:'0',y:'0'}}]}]}}}},' After']}]}]};
  const adapted=await run(doc,{decorations:{shape1:{bytes:png,mime:'image/png',width:1,height:1}}});
  assert.ok(!adapted.model.warnings.some(w=>w.blocking));
  assert.match(text(adapted),/<strong>Before <\/strong>/);
  assert.match(text(adapted),/<strong> After<\/strong>/);
  assert.equal(adapted.preview.drawings[0].assetId,await sha256Hex(png));
  assert.deepEqual(adapted.preview.drawings[0].geometry,{x:10,y:20,width:100,height:50,unit:'px',horizontalReference:'page',verticalReference:'page'});
  assert.deepEqual(new Uint8Array(await adapted.pictures.get(await sha256Hex(png)).arrayBuffer()),png);
});

test('conditional table styles preserve colored bold header cells and nested notes cannot be dropped silently',async()=>{
  const doc={type:'document',styles:{table:{tblStylePr:{firstRow:{rPr:{b:true,color:{r:255,g:0,b:0}},tcPr:{shd:{fill:{r:255,g:255,b:0}}}}}}},content:[{type:'table',tblPr:{tblStyle:'table',tblLook:{firstRow:true}},content:[{type:'tblRow',content:[{type:'tblCell',content:{type:'docContent',content:[{type:'paragraph',content:[{type:'run',content:['Header'],footnotes:[{content:['Note']}]}]}]}}]}]}]};
  const adapted=await run(doc);
  assert.match(text(adapted),/background-color:#ffff00/);
  assert.match(text(adapted),/color:#ff0000/);
  assert.match(text(adapted),/<strong>Header<\/strong>/);
  assert.ok(adapted.model.warnings.some(w=>w.code==='notes-adaptation-required'&&w.blocking));
});

test('radio group identity and required/read-only flags come from its parent even when widgets expose defaults',async()=>{
  const {forms,pages}=await fixture('forms');
  forms.Parents[0].readOnly=1;
  for(const field of forms.Fields.filter(f=>f.type===28)){field.name='widget appearance name';field.required=0;field.readOnly=0;}
  const adapted=await run({type:'document',content:[{type:'paragraph',content:['Form']}]},{pdfForms:{...forms,pages}});
  const radio=adapted.formDefinition.fields.find(f=>f.kind==='radio');
  assert.equal(radio.sourceName,'shift');assert.equal(radio.required,true);assert.equal(radio.readOnly,true);
});

test('image-only PDFs stay reviewable but block sending when editable source text is absent',async()=>{
  const image={type:'paraDrawing',drawingType:'inline',docPr:{descr:'These image alternative words are not editable PDF text',title:'Image caption'},extent:{cx:952500,cy:476250},graphic:{id:'scan-image',type:'image',blipFill:{rasterImageId:'image1.png'},spPr:{}}};
  const doc={type:'document',content:[{type:'paragraph',content:[{type:'run',content:[' \n\t\u00a0\u200b',image]}]}]};
  const {forms,pages}=await fixture('forms');
  const adapted=await run(doc,{pdfForms:{...forms,pages}},'SCAN.PDF');
  assert.equal(adapted.model.assets.length,1,'Keep the scanned page available in preview');
  assert.ok(adapted.model.blocks.length);
  assert.ok(adapted.formDefinition.fields.some(f=>f.value==='Alice'),'Form labels/values must not pass the document-text gate');
  assert.ok(adapted.model.warnings.some(w=>w.code==='pdf-ocr-unavailable'&&w.blocking&&w.material));
  assert.equal(adapted.model.stats.editableTextCharacters,0);
  assert.deepEqual(new Uint8Array(await adapted.pictures.get(await sha256Hex(png)).arrayBuffer()),png);
  const office=await run(doc);
  assert.ok(!office.model.warnings.some(w=>w.code==='pdf-ocr-unavailable'),'This gate applies to PDF reconstruction');
});

test('mixed text/image PDFs preserve editable words and warn that image text cannot be checked without OCR',async()=>{
  const doc={type:'document',content:[{type:'paragraph',content:[{type:'run',content:['Editable source page']}]},{type:'paragraph',content:[{type:'run',content:[{type:'paraDrawing',drawingType:'inline',graphic:{id:'scanned-page',type:'image',blipFill:{rasterImageId:'image1.png'},spPr:{}}}]}]}]};
  const adapted=await run(doc,{},'mixed.pdf');
  assert.match(text(adapted),/Editable source page/);
  assert.ok(adapted.model.warnings.some(w=>w.code==='pdf-image-text-review'&&w.material&&!w.blocking));
  assert.ok(adapted.model.stats.editableTextCharacters>0);
  assert.ok(!adapted.model.warnings.some(w=>w.code==='pdf-ocr-unavailable'));
  assert.equal(adapted.model.assets.length,1);
});
