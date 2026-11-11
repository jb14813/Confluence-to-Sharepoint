import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cp,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import {chromium} from 'playwright';
import {chromiumExecutable} from './chromium.mjs';
import {nativeNotesFixture,nativeNotesReviewFixture} from './native-notes-fixture.mjs';
import {nativeFormattingFixture} from './native-formatting-fixture.mjs';

test('genuine DOCX retains exact note positions, header/footer identities, links and images in the shipped SDK capture',{timeout:180000},async()=>{
  const product=fileURLToPath(new URL('..',import.meta.url)),artifacts=path.resolve('.artifacts/native-notes');await mkdir(artifacts,{recursive:true});
  const dir=await mkdtemp(path.join(artifacts,'capture-')),extension=path.join(dir,'extension');await mkdir(extension);
  await cp(path.join(product,'src/engine'),path.join(extension,'src/engine'),{recursive:true});
  await cp(path.join(product,'vendor'),path.join(extension,'vendor'),{recursive:true});
  await build({entryPoints:[path.join(product,'src/engine/html-resources.js')],outfile:path.join(extension,'src/engine/html-resources.js'),bundle:true,format:'esm',platform:'browser',target:'chrome127'});
  await build({entryPoints:[path.join(product,'src/engine/sandbox-svg.js')],outfile:path.join(extension,'src/engine/sandbox-svg.js'),bundle:true,format:'iife',globalName:'FtsSvg',platform:'browser',target:'chrome127'});
  // Opt-in historical baseline: feed these same genuinely captured source
  // documents through HEAD's unchanged adapter without editing working files.
  const adapterPlugins=process.env.FTS_ADAPTER_BASELINE==='1'?[{name:'historical-native-adapter',setup(builder){builder.onLoad({filter:/[\\/]src[\\/]content[\\/].*\.js$/},args=>({contents:execFileSync('git',['show','HEAD:'+path.relative(path.resolve(product,'../..'),args.path).replaceAll(path.sep,'/')],{cwd:product,encoding:'utf8'}),loader:'js'}));}}]:[];
  await build({stdin:{contents:"export {adaptDocument} from './src/content/index.js';",resolveDir:product,sourcefile:'native-parts-adapter.js'},outfile:path.join(extension,'adapter.js'),bundle:true,format:'esm',platform:'browser',target:'chrome127',plugins:adapterPlugins});
  let sandbox=await readFile(path.join(extension,'src/engine/sandbox.html'),'utf8');
  if(!sandbox.includes('sandbox-notes.js'))sandbox=sandbox.replace('<script src="/src/engine/sandbox.js">','<script src="/src/engine/sandbox-notes.js"></script><script src="/src/engine/sandbox.js">');
  await writeFile(path.join(extension,'src/engine/sandbox.html'),sandbox);
  const sourceSandbox=path.join(extension,'src/engine/sandbox.js');
  await writeFile(sourceSandbox,(await readFile(sourceSandbox,'utf8')).replace('} catch(error) {send(',"} catch(error) {console.error('Native note fixture:',error?.stack);send("));
  // A source-only baseline switch makes the genuine pre-fix defect observable
  // without changing the product or the vendor SDK.
  if(process.env.FTS_NOTES_BASELINE==='1'){
    const file=path.join(extension,'src/engine/sandbox.js');await writeFile(file,(await readFile(file,'utf8')).replace('ftsCaptureNativeNotes(writer);',''));
  }
  const shipping=JSON.parse(await readFile(path.join(product,'extension/manifest.json'),'utf8'));
  await writeFile(path.join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Native note capture regression',version:'1.0.0',background:{service_worker:'background.js'},sandbox:{pages:['src/engine/sandbox.html']},content_security_policy:shipping.content_security_policy}));
  await writeFile(path.join(extension,'background.js'),'void 0;');
  await writeFile(path.join(extension,'index.html'),'<!doctype html><body><script type="module" src="harness.js"></script>');
  await writeFile(path.join(extension,'harness.js'),"import {convertDocument} from './src/engine/index.js';import {adaptDocument} from './adapter.js';window.convertDocument=convertDocument;window.adaptDocument=adaptDocument;");
  const bytes=await nativeNotesFixture();await writeFile(path.join(dir,'source.docx'),bytes);
  const context=await chromium.launchPersistentContext(path.join(dir,'profile'),{headless:true,executablePath:await chromiumExecutable(),ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-background-networking','--disable-component-update','--no-first-run']});
  const requests=[],errors=[];await context.route(/^https?:/,route=>{requests.push(route.request().url());return route.abort('blockedbyclient');});
  try{
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);await page.waitForFunction(()=>window.convertDocument);
    const prepare=async(name,bytes)=>page.evaluate(async({name,base64})=>{
      try{
        const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),output=await convertDocument({name,bytes}),adapted=await adaptDocument({name,bytes,result:output});
        const root=document.createElement('main');root.innerHTML=adapted.model.blocks.map(block=>block.html).join('');
        const flow=[];function visit(node){if(node.nodeType===Node.TEXT_NODE){if(node.textContent)flow.push(node.textContent);return;}if(node.nodeType!==Node.ELEMENT_NODE)return;if(node.matches('sup[id] > a'))return;if(node.matches('sup[id]')&&node.querySelector('a')){flow.push(node.querySelector('a').getAttribute('href'));return;}if(node.classList.contains('c2sPicture')){flow.push('picture');return;}for(const child of node.childNodes)visit(child);}visit(root);
        const links=Array.from(root.querySelectorAll('a'),a=>({href:a.getAttribute('href'),text:a.textContent})),targets=Array.from(root.querySelectorAll('[id]'),node=>node.id),assets=[];
        for(const[id,blob]of adapted.pictures)assets.push({id,mime:blob.type,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))});
        window.lastPrepared={name,bytes,result:output,adapted};
        return{model:output.officeDocument,prepared:adapted.model,preview:adapted.preview,assets,convertedDocx:Array.from(output.docxBytes),rendered:{text:root.textContent,html:root.innerHTML,flow,links,targets,pictures:root.querySelectorAll('.c2sPicture').length}};
      }catch(error){return{error:error.message,code:error.code};}
    },{name,base64:bytes.toString('base64')});
    const persist=async(name,source,result)=>{
      const destination=path.join(dir,name);await mkdir(path.join(destination,'assets'),{recursive:true});await writeFile(path.join(destination,'source.docx'),source);
      if(result.convertedDocx)await writeFile(path.join(destination,'converted.docx'),Buffer.from(result.convertedDocx));
      await writeFile(path.join(destination,'office-model.json'),JSON.stringify(result.model,null,2));
      await writeFile(path.join(destination,'prepared-model.json'),JSON.stringify(result.prepared,null,2));
      await writeFile(path.join(destination,'preview.json'),JSON.stringify(result.preview,null,2));
      await writeFile(path.join(destination,'prepared.html'),result.rendered?.html??'');
      for(const asset of result.assets??[]){assert.match(asset.id,/^[0-9a-f]{64}$/);await writeFile(path.join(destination,'assets',asset.id),Buffer.from(asset.bytes));}
      await writeFile(path.join(destination,'manifest.json'),JSON.stringify({sourceFile:'source.docx',convertedDocx:'converted.docx',model:'prepared-model.json',preview:'preview.json',assets:(result.assets??[]).map(({bytes,...asset})=>({...asset,file:'assets/'+asset.id,size:bytes.length}))},null,2));
    };
    const result=await prepare('native-notes.docx',bytes);
    await writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));
    assert.equal(result.error,undefined,JSON.stringify({result,errors}));
    await persist('notes',bytes,result);
    const model=result.model??(typeof result.json==='string'?JSON.parse(result.json):result.json);assert.ok(model,'The real conversion must return the SDK model');
    const walk=function*(value){if(!value||typeof value!=='object')return;yield value;for(const child of Object.values(value))if(child&&typeof child==='object')yield*walk(child);};
    const bodyRun=[...walk(model.content)].find(value=>value.type==='run'&&value.footnotes?.length&&value.endnotes?.length);assert.ok(bodyRun,'Both references must be captured from the same original source run');
    assert.deepEqual(bodyRun.content.map(value=>typeof value==='string'?value:value.type),['Before😀','footnoteRef','Middle','paraDrawing','endnoteRef','After']);
    const foot=bodyRun.footnotes[0],end=bodyRun.endnotes[0];assert.equal(foot.type,'footnote');assert.equal(end.type,'endnote');
    assert.equal(bodyRun.content[1].footnote,foot.id);assert.equal(bodyRun.content[4].footnote,end.id);
    const header=model.sectPr.headerReference.default,first=model.sectPr.headerReference.first,footer=model.sectPr.footerReference.default;
    assert.equal(typeof header.ftsSourceId,'string');assert.equal(typeof first.ftsSourceId,'string');assert.notEqual(header.ftsSourceId,footer.ftsSourceId);
    for(const[part,label]of[[header,'Header'],[footer,'Footer'],[foot,'Foot'],[end,'End']]){
      const nodes=[...walk(part)],strings=nodes.filter(value=>value.type==='run').flatMap(value=>value.content.filter(value=>typeof value==='string')).join('');
      assert.ok(strings.includes(`${label} lead`),label);assert.ok(strings.includes(`${label} text😀`),label);
      assert.ok(nodes.some(value=>value.type==='hyperlink'&&value.value==='https://example.com/native-notes'),`${label} must retain the source link`);
      assert.ok(nodes.some(value=>value.type==='image'),`${label} must retain the source image`);
    }
    const assertPrepared=async(result,source)=>{
      assert.deepEqual(result.prepared.warnings.filter(warning=>warning.blocking),[],'Every captured source part must adapt without content loss');
      assert.equal(result.rendered.pictures,6,'Both native header objects, footer, body and both notes retain their source image placements');
      assert.equal(result.prepared.stats.images,6);
      for(const label of ['Header','Footer','Foot','End']){assert.ok(result.rendered.text.includes(label+' lead'),label);assert.ok(result.rendered.text.includes(label+' text😀'),label);assert.ok(result.rendered.links.some(link=>link.href==='https://example.com/native-notes'&&link.text.includes(label+' link')),label);}
      const start=result.rendered.flow.indexOf('Before😀');assert.ok(start>=0);assert.deepEqual(result.rendered.flow.slice(start,start+6),['Before😀','#file-footnote-1','Middle','picture','#file-endnote-1','After']);
      for(const link of result.rendered.links.filter(link=>link.href?.startsWith('#')))assert.ok(result.rendered.targets.includes(link.href.slice(1)),`Reference target ${link.href} must exist in editable native content`);
      assert.deepEqual(result.preview.documentParts.map(part=>part.kind).sort(),['endnote','footer','footnote','header','header']);
      assert.ok(result.assets.length>0);assert.ok(result.assets.every(asset=>asset.bytes.length>0));
      const sourceIds=[...walk(result.model)].filter(node=>node.type==='image').map(node=>node.id).sort();
      assert.deepEqual(result.preview.drawings.filter(drawing=>drawing.kind==='image').map(drawing=>drawing.sourceId).sort(),sourceIds,'Every captured source image must have an adapted native placement');
      const archive=await JSZip.loadAsync(source);
      for(const file of Object.values(archive.files).filter(file=>!file.dir&&/^word\/media\/.+\.png$/.test(file.name))){const original=await file.async('nodebuffer'),id=createHash('sha256').update(original).digest('hex');assert.ok(result.assets.some(asset=>asset.id===id),`Original source image bytes ${file.name} must remain retained`);}
    };
    const formattingSource=await nativeFormattingFixture(),formatting=await prepare('native-formatting.docx',formattingSource);
    await writeFile(path.join(dir,'formatting-result.json'),JSON.stringify(formatting,null,2));
    assert.equal(formatting.error,undefined,JSON.stringify({error:formatting.error,code:formatting.code,errors}));
    await persist('formatting',formattingSource,formatting);await assertPrepared(result,bytes);await assertPrepared(formatting,formattingSource);
    const nativeNodes=[...walk(formatting.model)],numbered=nativeNodes.filter(node=>node.type==='paragraph'&&node.ftsNumbering);
    assert.equal(numbered[0].ftsNumbering.level,2,'The initial skipped level must be captured from genuine source');
    assert.equal(numbered.find(node=>node.ftsNumbering.label==='Phase 7:').ftsNumbering.definition.lvlText,'Phase %1:');
    assert.equal(numbered.find(node=>node.ftsNumbering.label==='2.3)').ftsNumbering.definition.lvlText,'%1.%2)');
    assert.ok(nativeNodes.some(node=>node.type==='tblRow'&&node.trPr?.trHeight?.val>81920),'The oversized row height must survive native capture');
    const nativeTable=nativeNodes.find(node=>node.type==='table');
    assert.equal(nativeTable.content[0].content[0].tcPr.tcBorders.start.value,'none');assert.equal(nativeTable.content[1].content[0].tcPr.tcBorders.start.value,'single');assert.equal(nativeTable.content[1].content[0].tcPr.tcBorders.start.color.r,255);
    const textbox=nativeNodes.find(node=>node.type==='shape'&&[...walk(node.content)].some(child=>child.type==='run'&&child.content?.includes('Decorative textbox text')));assert.ok(textbox,'The genuine source textbox must retain editable native content');
    assert.equal(textbox.spPr.fill.fill.type,'gradFill');assert.equal(textbox.spPr.ln.cmpd,'tri');assert.equal(textbox.spPr.ln.prstDash,'dashDot');
    for(const text of ['Initial skipped list level','Phase 7:','Custom marker item','Compound parent','2.3)','Compound marker item','Merged anchor','Merged continuation','Tall right cell','Second right cell','Decorative textbox text'])assert.ok(formatting.rendered.text.includes(text),text);
    for(const code of ['list-depth-review','list-marker-adapted','table-cell-height-adapted','merged-cell-border-adapted','textbox-style-adapted'])assert.ok(formatting.prepared.warnings.some(warning=>warning.code===code),code);
    assert.doesNotMatch(formatting.rendered.html,/height:5000pt/);assert.match(formatting.rendered.html,/rowspan="2"/);assert.match(formatting.rendered.html,/border-left:1pt solid #ff0000/);
    const reviewSource=await nativeNotesReviewFixture(),review=await prepare('native-notes-review.docx',reviewSource);
    await writeFile(path.join(dir,'review-result.json'),JSON.stringify(review,null,2));
    assert.equal(review.error,undefined,JSON.stringify({error:review.error,code:review.code,errors}));await persist('review',reviewSource,review);
    assert.deepEqual(review.prepared.warnings.filter(warning=>warning.blocking),[]);
    const reviewNodes=[...walk(review.model)],ordinaryRefs=reviewNodes.filter(node=>node.type==='footnoteRef'&&!node.customMark);
    assert.equal(ordinaryRefs.length,2);assert.ok(ordinaryRefs.every(reference=>reference.number===1),'Both distinct ordinary source references must expose the actual native-open Number1 state');assert.notEqual(ordinaryRefs[0].footnote,ordinaryRefs[1].footnote);
    assert.ok(review.rendered.links.some(link=>link.href==='#file-footnote-1'&&link.text==='1'));assert.ok(review.rendered.links.some(link=>link.href==='#file-footnote-2'&&link.text==='2'));
    assert.ok(review.rendered.links.some(link=>link.href==='#file-footnote-3'&&link.text==='*'));
    const cachedStart=review.rendered.flow.indexOf('Field lead');assert.ok(cachedStart>=0);assert.deepEqual(review.rendered.flow.slice(cachedStart,cachedStart+5),['Field lead','Cached prefix','#file-footnote-2','Cached suffix','Field final']);
    for(const text of ['Field lead','Cached prefix','Cached suffix','Field final','Custom before','Custom after','Second lead','Second text😀','Custom lead','Custom note text😀'])assert.equal(review.rendered.text.split(text).length-1,1,`${text} must survive exactly once`);
    assert.ok(review.rendered.text.includes('Custom before*Custom after'));assert.equal((review.rendered.text.match(/\*/g)||[]).length,2,'The body and note retain each existing star once');
    assert.doesNotMatch(review.rendered.text,/QUOTE|cached field/);
    for(const link of review.rendered.links.filter(link=>link.href?.startsWith('#')))assert.ok(review.rendered.targets.includes(link.href.slice(1)),`Review reference target ${link.href} must exist`);
    assert.equal(review.rendered.pictures,8);assert.equal(review.prepared.stats.images,8);
    assert.deepEqual(review.preview.drawings.filter(drawing=>drawing.kind==='image').map(drawing=>drawing.sourceId).sort(),reviewNodes.filter(node=>node.type==='image').map(node=>node.id).sort());
    for(const label of ['Header','Footer','Foot','End','Second','Custom'])assert.ok(review.rendered.links.some(link=>link.href==='https://example.com/native-notes'&&link.text.includes(label+' link')),`${label} link`);
    assert.ok(review.assets.some(asset=>asset.id===result.assets[0].id),'The review fixture retains the exact original source PNG bytes');
    const nativeControl=reviewNodes.find(node=>node.type==='blockLvlSdt');assert.equal(nativeControl.sdtContent.type,'docContent');assert.ok(Array.isArray(nativeControl.sdtContent.content));
    assert.ok(reviewNodes.some(node=>node.type==='inlineLvlSdt'&&Array.isArray(node.content)));
    assert.ok(review.prepared.warnings.some(warning=>warning.code==='content-wrapper-adapted'));
    for(const text of ['Block control content','Inline control before','Inline control content','Inline control after'])assert.equal(review.rendered.text.split(text).length-1,1,text);
    assert.ok(review.rendered.text.includes('Inline control beforeInline control contentInline control after'));
    assert.equal(reviewNodes.filter(node=>node.type==='fldChar').length,3,'The genuine balanced begin/separate/end source controls must reach the adapter');
    assert.ok(review.prepared.warnings.some(warning=>warning.code==='static-field-adapted'));assert.equal(review.preview.staticFields.count,1);
    assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
