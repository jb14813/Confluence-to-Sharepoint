import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import JSZip from 'jszip';
import {fixtures} from './engine-fixtures.mjs';
import {build} from 'esbuild';

const product=path.resolve(fileURLToPath(new URL('..',import.meta.url))),root=path.resolve(product,'../..');
const rich=await JSZip.loadAsync(Buffer.from(fixtures['sample-rich.docx'],'base64'));
const png=await rich.file('word/media/image1.png').async('nodebuffer');

test('existing offline Word SDK reconstructs HTML lists, continuation images and native merged tables without numbering loss',{timeout:120000},async t=>{
  const svgBundle=await build({entryPoints:[path.join(product,'src/engine/sandbox-svg.js')],bundle:true,write:false,format:'iife',globalName:'FtsSvg',platform:'browser'});
  const sandbox=await readFile(path.join(product,'src/engine/sandbox.js'),'utf8');
  const reader=sandbox.slice(sandbox.indexOf('  function readDocument('),sandbox.indexOf('  let used = false'))+'\nwindow.readDocumentForTest=readDocument;';
  const scripts=['/src/engine/sandbox-setup.js','/vendor/office/jquery.js','/vendor/office/underscore.js','/vendor/office/xregexp.js','/vendor/office/sdkjs/common/AllFonts.js','/vendor/office/sdkjs/word/sdk-all-min.js','/vendor/office/sdkjs/word/sdk-all.js','/svg-helper.js','/src/engine/sandbox-typography.js','/src/engine/sandbox-html.js','/src/engine/sandbox-notes.js','/reader.js'];
  const server=http.createServer(async(req,res)=>{
    try{
      const name=new URL(req.url,'http://localhost').pathname;
      if(name==='/')return res.writeHead(200,{'content-type':'text/html'}).end('<!doctype html><base href="/vendor/office/web-apps/apps/documenteditor/main/"><div id="editor_sdk"></div>'+scripts.map(src=>`<script src="${src}"></script>`).join(''));
      if(name==='/reader.js')return res.writeHead(200,{'content-type':'text/javascript'}).end(reader);
      if(name==='/svg-helper.js')return res.writeHead(200,{'content-type':'text/javascript'}).end(svgBundle.outputFiles[0].text);
      const fromRoot=name.startsWith('/products/')||name.startsWith('/src/sharepoint/')||name.startsWith('/src/transfer/');
      const base=fromRoot?root:product,file=path.resolve(base,'.'+decodeURIComponent(name));
      if(!file.startsWith(base+path.sep))return res.writeHead(403).end();
      const bytes=await readFile(file);
      res.writeHead(200,{'content-type':{'.js':'text/javascript','.wasm':'application/wasm','.json':'application/json'}[path.extname(file)]||'application/octet-stream'}).end(bytes);
    }catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,requests=[];
  const browser=await chromium.launch({headless:true,executablePath:process.env.EXTENSION_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-background-networking','--disable-component-update','--no-first-run']});
  try{
    const context=await browser.newContext({serviceWorkers:'block'});
    await context.route('**/*',route=>{const url=route.request().url();requests.push(url);return url.startsWith(origin+'/')||url.startsWith('blob:')?route.continue():route.abort('blockedbyclient');});
    const run=async(html,nativeDocx=null)=>{
      const page=await context.newPage();
      page.on('pageerror',error=>console.error('HTML import page:',error.message));
      page.on('console',message=>{if(message.type()==='error')console.error('HTML import console:',message.text());});
      page.on('response',response=>{if(response.status()!==200)console.error('HTML import response:',response.status(),response.url());});
      try{
        await page.goto(origin);
        return await page.evaluate(async({html,png,nativeDocx})=>{
          if(typeof window.ftsImportHtml!=='function')return {missing:true,scripts:[...document.scripts].map(s=>s.src),html:document.documentElement.outerHTML.slice(0,200)};
          const api=new Asc.asc_docs_api({'id-view':'editor_sdk'});
          api.disableAutostartMacros=true;api.isSpellCheckEnable=false;api.isCoAuthoringEnable=false;
          while(!api.isLoadFullApi||!api.WordControl)await new Promise(resolve=>setTimeout(resolve,10));
          const nativeResult=await new Promise((resolve,reject)=>{
            const worker=new Worker('/src/engine/worker.js');
            worker.onmessage=({data})=>{worker.terminate();data.error?reject(Error(data.error.message)):resolve(data.result);};
            worker.onerror=event=>{worker.terminate();reject(Error(event.message));};
            worker.postMessage(nativeDocx?{extension:'docx',bytes:Uint8Array.from(atob(nativeDocx),c=>c.charCodeAt(0))}:{extension:'rtf',bytes:new TextEncoder().encode('{\\rtf1\\ansi\\deff0\\pard\\par}')});
          });
          api.asc_nativeOpenFile(nativeResult.officeBin);
          const payload={html,rootLocation:'file:///C:/exported.html',resources:[{name:'mhtml-resource-1.bin',location:'file:///C:/exact.png',contentId:'exact-image',mime:'application/octet-stream',bytes:new Uint8Array(png)}]};
          let state,model;
          try{
            if(!nativeDocx)state=await ftsImportHtml(api,payload);
            model=JSON.parse(window.readDocumentForTest(AscBuilder.Word.Api.GetDocument(),state));
            state?.verifyModel(model);
            const media=nativeDocx?nativeResult.media:{'word/media/mhtml-resource-1.bin':new Uint8Array(png),...Object.fromEntries((state?.inlineImages??[]).map(image=>['word/media/'+image.name,image.bytes]))};
            const {adaptDocument}=await import('/products/file-to-sharepoint/src/content/index.js');
            const adapted=await adaptDocument({name:nativeDocx?'source.docx':'source.doc',bytes:nativeDocx?Uint8Array.from(atob(nativeDocx),c=>c.charCodeAt(0)):new TextEncoder().encode(html),result:{officeDocument:model,media,warnings:state?.warnings??[]}});
            let unicodeControl;
            if(nativeDocx){
              const paragraphs=api.WordControl.m_oLogicDocument.GetAllParagraphs({All:true}),runs=paragraphs.flatMap(p=>p.Content),astral=runs.find(run=>run.Content?.some(item=>item.constructor===AscWord.CRunText&&item.GetCodePoint()>0xffff)),bmp=runs.find(run=>run.Content?.some(item=>item.constructor===AscWord.CRunText)&&run.Content.every(item=>item.constructor!==AscWord.CRunText||item.GetCodePoint()<=0xffff));
              const original=new AscJsonConverter.WriterToJSON(),fixed=new AscJsonConverter.WriterToJSON();ftsPreserveNativeUnicode(fixed);
              const unknown=new AscJsonConverter.WriterToJSON(),serialize=unknown.SerParaRun;unknown.SerParaRun=function(...args){const result=serialize.apply(this,args);result.content.push('Unverified generated text');return result;};ftsPreserveNativeUnicode(unknown);
              let unknownCode;try{unknown.SerParaRun(astral);}catch(error){unknownCode=error.code;}
              unicodeControl={rawAstral:original.SerParaRun(astral),fixedAstral:fixed.SerParaRun(astral),rawBmp:original.SerParaRun(bmp),fixedBmp:fixed.SerParaRun(bmp),freshAstral:new AscJsonConverter.WriterToJSON().SerParaRun(astral),unknownCode};
            }
            const inlineImages=[];
            for(const {bytes,...metadata} of state?.inlineImages??[]){const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();inlineImages.push({...metadata,center:[...ctx.getImageData(canvas.width/2,canvas.height/2,1,1).data]});}
            return {model,html:adapted.model.blocks.map(block=>block.html).join(''),stats:adapted.model.stats,warnings:adapted.model.warnings,pictureInfo:adapted.model.blocks.flatMap(block=>block.pictures??[]),inlineImages,remainingMarkers:state?api.WordControl.m_oLogicDocument.GetAllParagraphs({All:true}).some(p=>p.GetText({Numbering:false}).includes(state.markerPrefix)):false,registered:state?.registered,unicodeControl};
          }catch(error){return {error:error.message,code:error.code,sourceExecuted:window.sourceExecuted===true,...(html.includes('musical symbol')?{model}:{} )};}
          finally{state?.dispose();}
        },{html,png:[...png],nativeDocx});
      }finally{await page.close();}
    };
    await t.test('inline SVG resolves inherited page CSS before source widget ancestors become editable snapshots',async()=>{
      const result=await run('<style>svg.icon{width:20px;height:10px}.theme form[name="livesearchForm"] button svg.icon rect{fill:var(--ink)}</style><p>Before icon</p><div class="search-macro theme" style="color:red;--ink:rgb(0,128,255)"><form class="aui aui-dd-parent" name="livesearchForm" method="POST" action="/wiki/dosearchsite.action"><input type="text" name="queryString" placeholder="Search this space"><button class="search-macro-button aui-button" type="submit"><svg xmlns="http://www.w3.org/2000/svg" class="icon" width="80" height="40" viewBox="0 0 80 40"><rect width="80" height="40" fill="currentColor"/></svg><span>Search</span></button></form></div><p>After icon</p>');
      assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.stats.images,1);assert.equal(result.registered,1);
      assert.equal(result.inlineImages.length,1);assert.equal(result.inlineImages[0].width,40);assert.equal(result.inlineImages[0].height,20);assert.deepEqual(result.inlineImages[0].center,[0,128,255,255]);
      assert.equal(result.pictureInfo[0].displayWidth,20);assert.match(result.html,/Before icon[\s\S]*Search this space[\s\S]*Search[\s\S]*After icon/);assert.ok(result.warnings.some(w=>w.code==='HTML_STATIC_WIDGETS'&&!w.blocking));
    });
    await t.test('SVG preparation cannot connect active content or unknown widget ancestors to obtain styles',async()=>{
      for(const html of ['<svg xmlns="http://www.w3.org/2000/svg" onload="window.sourceExecuted=true" width="20" height="10"><rect width="20" height="10"/></svg>','<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><form><input name="answer"></form></foreignObject></svg>','<form action="https://untrusted.invalid/submit"><button><svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10"/></svg></button></form>','<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="url(https://untrusted.invalid/paint.svg#red)"/></svg>']){
        const result=await run(html);assert.match(result.code,/HTML_(?:CONTENT_BLOCKED|RESOURCE_BLOCKED)/);assert.equal(result.sourceExecuted,false);
      }
      assert.equal(requests.some(url=>url.startsWith('https://untrusted.invalid')),false);
    });
    await t.test('the exact Confluence share-link bookmarklet becomes an explicit editable snapshot while unknown JavaScript remains blocked',async()=>{
      const action='https://example.atlassian.net/wiki?createDialogSpaceKey=MFS&amp;createDialogBlueprintId=32a56cc2-beed-4c8d-a65b-a062b15e4c48';
      const bookmarklet="javascript:(function(){var screenWidth=screen.width,screenHeight=screen.height,popupWidth=640,popupHeight=580,popupLeft=0,popupTop=0; if(screenWidth>popupWidth){popupLeft=Math.round((screenWidth/2)-(popupWidth/2));}if(screenHeight>popupHeight){popupTop=Math.round((screenHeight/2)-(popupHeight/2));}window.open('https://example.atlassian.net/wiki/plugins/sharelinksbookmarklet/bookmarklet.action?bookmarkedURL='+encodeURIComponent(window.location.href), '','left='+popupLeft+',top='+popupTop+',width='+popupWidth+',height='+popupHeight+',personalbar=0,toolbar=0,scrollbars=1,resizable=1');}());";
      const template=`<button class="aui-button create-from-template-button" data-space-key="MFS" data-content-blueprint-id="32a56cc2-beed-4c8d-a65b-a062b15e4c48" href="${action}" disabled>Create shared link</button>`;
      const result=await run(template+`<p>Share from the toolbar.</p><a class="aui-button sharelinks-urlmacro-button" href="${bookmarklet}"><span>Share on Confluence</span></a>`);
      assert.equal(result.error,undefined,JSON.stringify(result));assert.match(result.html,/\[Bookmarklet:[\s\S]*Share on Confluence[\s\S]*\]/);assert.doesNotMatch(result.html,/javascript:|window\.open|encodeURIComponent/);assert.ok(result.warnings.some(w=>w.code==='HTML_STATIC_WIDGETS'&&!w.blocking));
      assert.equal((await run(template+'<a class="aui-button sharelinks-urlmacro-button" href="javascript:alert(1)">Unknown action</a>')).code,'HTML_CONTENT_BLOCKED');
    });
    await t.test('known exported widgets retain editable labels, static states, icon children and safe source action links',async()=>{
      const blueprint='463e7a61-3d03-4c2a-9fb0-ebe07b177016',action=`https://example.atlassian.net/wiki?createDialogSpaceKey=MFS&amp;createDialogBlueprintId=${blueprint}`;
      const result=await run(`<p>Before widgets</p><button class="aui-button create-from-template-button" data-space-key="MFS" href="${action}" data-content-blueprint-id="${blueprint}" disabled="true">Add troubleshooting article</button><a class="confluence-userlink" data-account-id="123:abc" href="/people/123:abc?ref=confluence">Named author</a><div class="blog-post macro-blank-experience"><button class="aui-button create-post">Create blog post</button></div><div class="search-macro"><form class="aui aui-dd-parent" name="livesearchForm" method="POST" action="/wiki/dosearchsite.action"><fieldset class="search-macro-fields"><input type="text" name="queryString" placeholder="Search this space"><button type="submit" class="search-macro-button aui-button"><img src="exact.png" width="20" height="20"><span class="search-macro-button-text">Search</span></button><input type="hidden" name="where" value="conf_all"><input type="hidden" name="additional" value="space name"><input type="hidden" name="labels" value=""><input type="hidden" name="contentType" value=""></fieldset></form></div><p>After widgets</p>`);
      assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.stats.images,1);
      for(const text of ['Before widgets','Add troubleshooting article','Create blog post','Search this space','Search','After widgets'])assert.ok(result.html.includes(text),text);
      assert.match(result.html,/href="https:\/\/example.atlassian.net\/wiki\?createDialogSpaceKey=MFS&amp;createDialogBlueprintId=/);
      assert.match(result.html,/href="https:\/\/example.atlassian.net\/people\/123:abc\?ref=confluence"/);assert.ok(result.warnings.some(w=>w.code==='HTML_STATIC_WIDGETS'&&!w.blocking));assert.doesNotMatch(result.html,/<(?:form|input|button)\b|conf_all|space name/);
    });
    await t.test('exported Figma embeds become precise editable source links without executing embeds',async()=>{
      const target='https://www.figma.com/file/design/Prototype?node-id=1%3A9',result=await run(`<p>Design context</p><iframe src="https://www.figma.com/embed?embed_host=share&amp;url=${encodeURIComponent(target)}" width="800" height="450" sandbox="allow-scripts allow-same-origin"></iframe><p>Following context</p>`);
      assert.equal(result.error,undefined,JSON.stringify(result));assert.ok(result.html.includes(target.replace('%3A',':')));assert.equal(result.html.includes('node-id=1%3A9'),false);assert.match(result.html,/Figma design/);assert.doesNotMatch(result.html,/<iframe|allow-scripts|\/embed\?/);
      assert.ok(result.warnings.some(w=>w.code==='HTML_STATIC_WIDGETS'&&!w.blocking));
      const signed='https://www.figma.com/design/design/Prototype?node-id=2%3a8&signature=a%2Fb%2Bcc%3D',signedResult=await run(`<iframe src="https://www.figma.com/embed?embed_host=share&amp;url=${encodeURIComponent(signed)}"></iframe>`);
      assert.equal(signedResult.error,undefined,JSON.stringify(signedResult));assert.ok(signedResult.html.includes('node-id=2:8&amp;signature=a%2Fb%2Bcc%3D'));
    });
    await t.test('source unknown-attachment state remains editable at its exact inline position',async()=>{
      const result=await run('<p>Inline media icon context: <span class="confluence-embedded-file-wrapper"><img class="confluence-embedded-file unknown-attachment" src="/wiki/plugins/servlet/confluence/placeholder/unknown-attachment?locale=en_US"></span> remains in the same sentence.</p>');
      assert.equal(result.error,undefined,JSON.stringify(result));assert.match(result.html,/Inline media icon context:[\s\S]*\[Unknown attachment\][\s\S]*remains in the same sentence/);assert.equal(result.stats.images,0);
      assert.ok(result.warnings.some(w=>w.code==='HTML_SOURCE_PLACEHOLDER'&&!w.blocking));
    });
    await t.test('exported task reports and attachment upload chrome retain authored content without hidden configuration or tokens',async()=>{
      const result=await run('<div class="table-wrapper"><input type="hidden" name="reportParameters" value="{&quot;columns&quot;:[&quot;description&quot;],&quot;pageSize&quot;:20}"><table class="tasks-report"><tr><td>Rendered task snapshot</td></tr></table></div><div class="plugin_attachments_container"><div class="plugin_attachments_table_container"><fieldset class="hidden"><input type="hidden" class="plugin_attachments_macro_render_param" name="pageId" value="123"><input type="hidden" name="outputType" value="word"><input type="hidden" name="deleteConfirmMessage" value="Are you sure you want to send the attached file " {0}_ to the trash? only a space administrator can undo this action._></fieldset><table class="attachments"><tr><td>Existing attachment</td></tr></table></div><div class="plugin_attachments_upload_container"><form method="POST" class="plugin_attachments_uploadform aui hidden" action="/wiki/pages/plugins/attachments/doattachfile.action?pageId=123" enctype="multipart/form-data"><input type="hidden" name="atl_token" value="MUST-NEVER-SURVIVE"><label>Upload file</label><input type="file" name="file_0"><label>File description</label><input type="text" name="comment_0" value="Authored description"><input type="hidden" name="labels" value="internal"><input type="submit" name="confirm" value="Upload"><iframe class="plugin_attachments_uploadiframe hidden" src=""></iframe></form></div></div>');
      assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.stats.tables,2);
      for(const text of ['Rendered task snapshot','Existing attachment','Upload file','No file selected','File description','Authored description','Upload'])assert.ok(result.html.includes(text),text);
      assert.doesNotMatch(JSON.stringify(result.model),/MUST-NEVER-SURVIVE|reportParameters|atl_token/);assert.ok(result.warnings.some(w=>w.code==='HTML_STATIC_WIDGETS'&&!w.blocking));
    });
    await t.test('widget lookalikes cannot hide active attributes, unknown controls, unsafe links or ambiguous placeholders',async()=>{
      for(const html of ['<div class="blog-post macro-blank-experience"><button class="create-post" onclick="alert(1)">Create</button></div>','<div class="search-macro"><form name="livesearchForm" method="POST" action="https://evil.invalid/"><input name="queryString"></form></div>','<div class="table-wrapper"><input type="hidden" name="reportParameters" value="{&quot;columns&quot;:[&quot;description&quot;]}"><input type="password" name="secret"><table class="tasks-report"></table></div>','<iframe src="https://www.figma.com/embed?url=javascript%3Aalert(1)"></iframe>','<img class="unknown-attachment" src="https://evil.invalid/wiki/plugins/servlet/confluence/placeholder/unknown-attachment">','<p><input type="hidden" name="atl_token" value="authored-unknown"></p>','<div class="plugin_attachments_container"><div class="plugin_attachments_table_container"><fieldset class="hidden"><input type="hidden" name="deleteConfirmMessage" value="Are you sure you want to send the attached file " only onload="alert(1)"></fieldset></div></div>'])assert.match((await run(html)).code,/HTML_(?:CONTENT_BLOCKED|RESOURCE_BLOCKED)/,html);
    });
    await t.test('starts, restarts, nested lists, image and table continuations retain one item each',async()=>{
      const result=await run('<h1>Editable heading</h1><ol start="3"><li><p>Third step</p><p>Same item image<img src="exact.png" width="20" height="20"></p><table><tr><td>Inside item</td><td>Still editable</td></tr></table><ul><li>Nested detail</li></ul><p>Parent continuation</p></li><li>Fourth step</li></ol><p>Interruption</p><ol start="6"><li>Sixth restart</li><li>Seventh step</li></ol>');
      assert.equal(result.missing,undefined,'HTML reconstruction must be provided by the packaged sandbox '+JSON.stringify(result));
      assert.equal(result.error,undefined,JSON.stringify(result));
      assert.equal(result.remainingMarkers,false,'Private source associations must never leak into the native model');
      assert.equal(result.stats.numbered,4);assert.equal(result.stats.bullets,1);assert.equal(result.stats.images,1);assert.equal(result.stats.tables,1);
      assert.match(result.html,/<ol start="3"[^>]*><li>[\s\S]*Third step[\s\S]*Same item image[\s\S]*c2sPicture[\s\S]*Inside item[\s\S]*<ul[^>]*><li>[\s\S]*Nested detail[\s\S]*<\/ul>[\s\S]*Parent continuation[\s\S]*<\/li><li>[\s\S]*Fourth step/);
      assert.match(result.html,/<ol start="6"/);
      assert.equal(result.warnings.some(warning=>warning.blocking),false,JSON.stringify(result.warnings));
      const numbered=[];const walk=value=>{if(!value||typeof value!=='object')return;if(value.ftsNumbering)numbered.push(value.ftsNumbering);for(const child of Object.values(value))walk(child);};walk(result.model);
      assert.deepEqual(numbered.filter(n=>n.definition.numFmt.val==='decimal').map(n=>n.value),[3,4,6,7]);
    });
    await t.test('later-row default vertical merge anchors retain the SDK resolved rowspan',async()=>{
      const result=await run('<table><tr><td>Before A</td><td>Before B</td></tr><tr><td rowspan="2">Later anchor</td><td>Middle</td></tr><tr><td>After</td></tr></table>');
      assert.equal(result.error,undefined,JSON.stringify(result));assert.match(result.html,/<td rowspan="2"[^>]*>[\s\S]*Later anchor/);assert.equal(result.warnings.some(w=>w.blocking),false);
    });
    await t.test('empty source list items keep their native markers without leaking association text',async()=>{
      const result=await run('<ul><li><span class="placeholder-inline-tasks"></span></li><li><p></p></li><li><ul><li></li></ul></li></ul><table><tr><td><ul><li></li></ul></td><td><ul><li></li></ul></td></tr></table>');
      assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.stats.bullets,6);assert.equal(result.remainingMarkers,false);assert.equal(result.warnings.some(w=>w.blocking),false);
    });
    await t.test('native SDK Unicode codepoints survive the JSON boundary in text, links and styled runs',async()=>{
      const result=await run('<p>🏛 Architecture <a href="https://example.test/">😀 link</a> <strong>𝄞 musical symbol</strong> Crème</p><ol start="2"><li>🛠 Native step</li></ol>');
      assert.equal(result.error,undefined,JSON.stringify(result));
      for(const text of ['🏛 Architecture','😀 link','𝄞 musical symbol','🛠 Native step','Crème'])assert.ok(result.html.includes(text),text);
      assert.equal(result.warnings.some(w=>w.blocking),false);
    });
    await t.test('ordinary DOCX retains astral and BMP text with an isolated fail-closed serializer',async()=>{
      const document=await JSZip.loadAsync(Buffer.from(fixtures['sample-rich.docx'],'base64')),xml=await document.file('word/document.xml').async('string');
      assert.ok(xml.includes('<w:sectPr'));
      document.file('word/document.xml',xml.replace('<w:sectPr','<w:p><w:r><w:t>Native Unicode 🏛 😀 𝄞 and BMP Ω é</w:t></w:r></w:p><w:sectPr'));
      const result=await run('',await document.generateAsync({type:'base64'}));
      assert.equal(result.error,undefined,JSON.stringify(result));assert.ok(result.html.includes('Native Unicode 🏛 😀 𝄞 and BMP Ω é'));
      assert.ok(result.unicodeControl.rawAstral.content.join('').includes('\uf3db'),'Control must reproduce the pinned SDK truncation');
      assert.ok(result.unicodeControl.fixedAstral.content.join('').includes('🏛 😀 𝄞'));
      assert.deepEqual(result.unicodeControl.rawBmp,result.unicodeControl.fixedBmp,'Existing BMP output must remain byte-for-byte equivalent');
      assert.deepEqual(result.unicodeControl.rawAstral,result.unicodeControl.freshAstral,'A local writer must not alter the SDK prototype or other instances');
      assert.equal(result.unicodeControl.unknownCode,'UNICODE_SERIALIZATION_UNVERIFIED');
    });
    await t.test('source task states become editable checkbox symbols with markerless grouping and a conversion note',async()=>{
      const result=await run('<ul class="inline-task-list"><li data-inline-task-id="1"><p>Open task</p><p>Open continuation</p></li><li class="checked" data-inline-task-id="3"><p>Completed task</p><ul><li>Nested detail</li></ul></li></ul>');
      assert.equal(result.error,undefined,JSON.stringify(result));assert.match(result.html,/<ul style="list-style-type:disc"><li>[\s\S]*☐[\s\S]*Open task[\s\S]*Open continuation[\s\S]*<\/li><li>[\s\S]*☑[\s\S]*Completed task/);
      const visible=result.html.replace(/<[^>]+>/g,'');assert.ok(visible.includes('☐ Open task'));assert.ok(visible.includes('☑ Completed task'));
      assert.equal((result.html.match(/☐/g)||[]).length,1);assert.equal((result.html.match(/☑/g)||[]).length,1);
      assert.ok(result.warnings.some(w=>w.code==='HTML_TASK_SYMBOLS'&&!w.blocking));
      const tasks=result.model.content.filter(p=>p.ftsListItem?.kind==='task');assert.deepEqual(tasks.map(p=>p.ftsListItem.taskState),['unchecked','checked']);
      assert.ok(tasks.every(p=>p.ftsNumbering.definition.numFmt.val==='none'&&p.ftsNumbering.label===''));
      const unknown=await run('<ul class="inline-task-list"><li class="checked" aria-checked="false" data-inline-task-id="1">Ambiguous task</li></ul>');
      assert.equal(unknown.code,'HTML_LIST_UNSUPPORTED');
    });
    await t.test('source TOC markerless hierarchy preserves working local anchors and source order',async()=>{
      const result=await run('<div class="toc-macro"><ul class="toc-indentation" style="list-style:none"><li><a href="#target-one">First target</a><ul class="toc-indentation" style="list-style:none"><li><a href="#target-two">Second target</a></li></ul></li></ul></div><h2 id="target-one">First target heading</h2><h2 id="target-two">Second target heading</h2>');
      assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.warnings.some(w=>w.blocking),false,JSON.stringify(result.warnings));
      assert.match(result.html,/<ul style="list-style-type:disc"><li>[\s\S]*<ul style="list-style-type:disc">/);
      assert.match(result.html,/href="#file-source-anchor-1"/);assert.match(result.html,/id="file-source-anchor-1"/);assert.match(result.html,/href="#file-source-anchor-2"/);assert.match(result.html,/id="file-source-anchor-2"/);
      assert.equal(result.html.includes('127.0.0.1'),false);assert.equal(result.html.includes('fts-local.invalid'),false);
    });
    await t.test('exporter decision lists split around heading blocks without losing list items or anchor order',async()=>{
      const result=await run('<p><a href="#middle">Jump to middle</a></p><ul class="decision-list"><li>Before split</li><h2 id="middle">Middle heading</h2><li>After split</li><p>Final paragraph</p></ul>');
      assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.stats.bullets,2);assert.equal(result.warnings.some(w=>w.blocking),false);
      assert.match(result.html,/Before split[\s\S]*<\/ul>[\s\S]*id="file-source-anchor-1"[\s\S]*Middle heading[\s\S]*<ul[\s\S]*After split[\s\S]*Final paragraph/);
      assert.match(result.html,/href="#file-source-anchor-1"/);
    });
    await t.test('unresolved anchors, conflicting item markers and invalid counters cannot silently change source semantics',async()=>{
      for(const html of ['<p><a href="#missing">Missing target</a></p>','<h2 id="dup">One</h2><h2 id="dup">Two</h2><a href="#dup">Ambiguous target</a>'])assert.equal((await run(html)).code,'HTML_SEMANTICS_UNVERIFIED');
      for(const html of ['<ol><li style="list-style-type:lower-alpha">Conflicting marker</li></ol>','<ol start=""><li>Invalid start</li></ol>'])assert.equal((await run(html)).code,'HTML_LIST_UNSUPPORTED');
    });
    await t.test('source text audit accounts for editable native line breaks and tabs',async()=>{
      const result=await run('<pre>line one\nline two\tcode value</pre><p>before<br>after</p>');
      assert.equal(result.error,undefined,JSON.stringify(result));
      for(const text of ['line one','line two','code value','before','after'])assert.ok(result.html.includes(text),text);
    });
    await t.test('body stylesheets remain formatting metadata rather than invented visible source text',async()=>{
      const result=await run('<div><style>.toc ul{list-style-type:disc;margin-left:0}</style><p>Visible authored text</p><ul class="toc"><li>Editable entry</li></ul></div>');
      assert.equal(result.error,undefined,JSON.stringify(result));assert.ok(result.html.includes('Visible authored text'));assert.equal(result.html.includes('margin-left'),false);
    });
    await t.test('non-pixel source table CSS uses connected browser geometry instead of blocking editable content',async()=>{
      const result=await run('<p>Before table</p><table><tbody><tr><td style="display:inline">Inline cell</td><td>Ordinary cell</td></tr></tbody></table><p>After table</p>');
      assert.equal(result.error,undefined,JSON.stringify(result));
      assert.match(result.html,/Before table[\s\S]*Inline cell[\s\S]*Ordinary cell[\s\S]*After table/);
      assert.equal(result.stats.tables,1);assert.ok(!result.warnings.some(w=>w.blocking));
      assert.ok(result.warnings.some(w=>w.code==='HTML_TABLE_LAYOUT_ADAPTED'));
    });
    await t.test('remote images, CSS, scripts and active forms are blocked before attaching source markup',async()=>{
      for(const html of ['<img src="https://untrusted.invalid/pixel.png">','<style>@import "https://untrusted.invalid/style.css";</style><p>Text</p>','<style>p{background:u\\72l(https://untrusted.invalid/pixel.png)}</style><p>Text</p>','<script>window.sourceExecuted=true</script><p>Text</p>','<p onclick="alert(1)">Text</p>','<form><input name="answer"></form>','<iframe src="https://untrusted.invalid/embed"></iframe>']){
        const result=await run(html);assert.equal(typeof result.error,'string',html);assert.match(result.code,/HTML_(?:RESOURCE_BLOCKED|CONTENT_BLOCKED|CSS_BLOCKED)/);
      }
      assert.equal(requests.some(url=>url.startsWith('https://untrusted.invalid')),false,'Unsafe source resources must never reach network APIs');
    });
    await context.close();
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
