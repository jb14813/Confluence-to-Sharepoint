import {convertDocument,MAX_DOCUMENT_BYTES} from '../engine/index.js';
import {adaptDocument} from '../content/index.js';
import {createTransferStore} from '../../../../src/transfer/store.js';
import {checkCanvasBlock} from '../../../../src/sharepoint/canvas.js';
import {createSites,siteKey} from '../../../../src/background/sites.js';
import {confirmedPageUrl} from '../../../../src/background/checks.js';
import {createFileTransfer,FLIGHT_KEY} from './transfer.js';
import {mountForm} from '../../form/portable-form.js';
import {readProductConfig,loadProductConfig,applyProductConfig} from './product.js';
import {installFileSitePrefill} from './site-prefill.js';
const $=id=>document.getElementById(id),store=createTransferStore({databaseName:'file-to-sharepoint-v1'});
let current=null,busy=false,abort=null,formPreview=null,urls=new Map(),orphaned=null,pendingLinkedFile=null,previewReady=false;
const say=text=>{$('status').textContent=text;};
const stages={forms:'Checking the interactive form installation…',checking:'Checking the destination…',uploading:'Uploading and verifying pictures…',creating:'Creating and verifying the draft…',complete:'Draft verified. Opening SharePoint…'};
let transfer,sitePrefill;
function buttons(){
  const attempted=!!current?.attempt||!!orphaned,blocked=current?.model.warnings?.some(w=>w.blocking);
  $('send').disabled=busy||!current||!previewReady||attempted||blocked||!$('reviewed').checked||!siteKey($('site').value.trim())||!$('title').value.trim();
  $('file').disabled=busy||attempted;$('title').disabled=busy||!current||attempted;$('site').disabled=busy||attempted;
  $('new-file').disabled=busy||attempted;$('reviewed').disabled=busy||!current||!previewReady||attempted||blocked;
  $('cancel').hidden=!abort;$('check').disabled=busy;$('reset').disabled=busy;
  $('load-linked-images').disabled=busy||attempted||!pendingLinkedFile;
}
async function locked(work){
  return navigator.locks.request('file-to-sharepoint-operation',{ifAvailable:true},async lock=>{
    if(!lock){say('Another file import window is working. Continue there.');return;}
    busy=true;buttons();try{return await work();}finally{busy=false;buttons();}
  });
}
function image(file,info,cache){
  let url=cache.get(info.assetId);if(!url){url=URL.createObjectURL(file);cache.set(info.assetId,url);}
  const img=document.createElement('img');img.src=url;img.alt=info.alt??'';img.style.maxWidth='100%';
  if(info.displayWidth)img.style.width=`${info.displayWidth}px`;img.style.height='auto';return img;
}
async function render(){
  previewReady=false;
  formPreview?.dispose();formPreview=null;for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();
  const previewUrls=urls=new Map(),files=new Map();
  const picture=id=>{if(!files.has(id))files.set(id,store.picture(id));return files.get(id);};
  $('paper').replaceChildren();$('notes').replaceChildren();$('reviewed').checked=false;
  $('document').hidden=!current;$('picker').hidden=!!current;$('form-section').hidden=true;$('form-notice').hidden=true;
  $('check').hidden=true;$('review-link').hidden=true;$('reset').hidden=true;
  if(!current){$('title').value='';sitePrefill?.apply();buttons();return;}
  const {model,attempt}=current;
  $('filename').textContent=model.sourceName;$('title').value=model.title;
  $('document-stats').textContent=`${model.assets.length} pictures · ${model.stats.tables} tables · editable page content`;
  let previewError=null;
  try{
    for(const block of model.blocks){
      checkCanvasBlock(block);
      if(block.type==='text'){
        const template=document.createElement('template');template.innerHTML=block.html;
        for(const slot of template.content.querySelectorAll('.c2sPicture')) {
          const info=block.pictures[Number(slot.dataset.picture)],file=await picture(info.assetId);
          if(urls!==previewUrls)return;
          if(!file)throw Error('A local preview image is missing. '+(attempt||orphaned?'Check the retained send before importing again.':'Choose the source file again.'));
          slot.replaceChildren(image(file,info,previewUrls));
        }
        const section=document.createElement('section');section.className='preview-block';section.append(template.content);$('paper').append(section);
      }else if(block.type==='image'){
        const file=await picture(block.assetId);if(urls!==previewUrls)return;
        if(!file)throw Error('A local preview image is missing. '+(attempt||orphaned?'Check the retained send before importing again.':'Choose the source file again.'));
        $('paper').append(image(file,block,previewUrls));
      }
    }
    const definition=model.fileReview?.formDefinition;
    if(definition){$('form-section').hidden=false;$('form-notice').hidden=false;formPreview=mountForm($('form-preview'),definition,{submit:async()=>{throw Error('This is a local preview. Responses are submitted from the SharePoint form.');}});}
    previewReady=true;
  }catch(error){
    if(urls!==previewUrls)return;
    previewError=error;$('paper').replaceChildren();for(const url of previewUrls.values())URL.revokeObjectURL(url);previewUrls.clear();
    formPreview?.dispose();formPreview=null;$('form-section').hidden=true;$('form-notice').hidden=true;
  }
  const notes=[...(model.warnings??[]),...(attempt?.result?.notes??[]).map(message=>({message}))];$('notes').hidden=!notes.length;
  if(notes.length){const heading=document.createElement('h3');heading.textContent='Conversion notes';$('notes').append(heading);}
  for(const note of notes){const p=document.createElement('p');p.textContent=note.message;if(note.blocking)p.className='blocking';$('notes').append(p);}
  if(attempt){
    $('reset').hidden=false;$('check').hidden=attempt.status==='complete';
    $('reset').textContent=attempt.status==='complete'?'Import another file':'I reviewed SharePoint; start another file';
    $('review-link').hidden=false;$('review-link').href=attempt.siteUrl;$('site').value=attempt.siteUrl;
    if(attempt.status==='complete'){
      $('review-link').href=confirmedPageUrl(attempt.result,attempt);say('Draft created and verified. Review it in SharePoint before publishing.');
    }else say('An earlier send needs a status check. Its identity is retained to prevent a duplicate draft.');
  }
  buttons();
  if(previewError)throw previewError;
}
async function restore(){
  current=await store.load();
  const flight=(await chrome.storage.local.get(FLIGHT_KEY))[FLIGHT_KEY];
  // Chrome updates/restarts clear session storage. Keep the durable destination
  // reference so losing the local preview cannot silently enable a duplicate.
  orphaned=flight&&!current?.attempt?flight:null;
  let previewError;
  try{await render();}catch(error){previewError=error;}
  if(orphaned){$('picker').hidden=true;$('reset').hidden=false;$('check').hidden=true;$('review-link').href=flight.siteUrl;$('review-link').hidden=false;say('A send was interrupted across a browser restart. Review this SharePoint site before importing again.');buttons();}
  if(previewError)report(previewError);
}
async function choose(file,{loadLinkedImages=false}={}){
  if(!file)return;
  await locked(async()=>{
    if((await store.load())?.attempt||(await chrome.storage.local.get(FLIGHT_KEY))[FLIGHT_KEY])throw Error('Review the previous send before choosing another file.');
    if(file.size>MAX_DOCUMENT_BYTES)throw Error('Choose a document up to 50 MiB.');
    pendingLinkedFile=null;$('linked-image-review').hidden=true;
    abort=new AbortController();buttons();say('Reconstructing the document locally…');
    try{
      const bytes=new Uint8Array(await file.arrayBuffer()),result=await convertDocument({name:file.name,bytes},{signal:abort.signal,loadLinkedImages});
      say('Preparing editable content and form controls…');
      const adapted=await adaptDocument({name:file.name,bytes,result},{signal:abort.signal});
      if(abort.signal.aborted)throw new DOMException('Conversion cancelled.','AbortError');
      const model={...adapted.model,fileReview:{formDefinition:adapted.formDefinition,preview:adapted.preview}};
      await store.save(model,adapted.pictures);current=await store.load();await render();
      say(model.warnings.some(w=>w.blocking)?'This document includes content that needs adaptation. See conversion notes.':'Review the content and conversion notes, then choose a destination.');
    }catch(error){
      if(['HTML_LINKED_IMAGES_REQUIRED','HTML_LINKED_IMAGE_FAILED'].includes(error.code)&&Array.isArray(error.urls)){
        pendingLinkedFile=file;$('linked-image-hosts').textContent=[...new Set(error.urls.map(url=>new URL(url).host))].join(', ');$('linked-image-review').hidden=false;
      }
      throw error;
    }finally{abort=null;buttons();}
  });
}
function report(error){say(error.name==='AbortError'?'Conversion cancelled.':error.message??'The operation stopped. Review the destination before sending again.');}
$('file').addEventListener('change',event=>choose(event.target.files[0]).catch(report));
$('picker').addEventListener('dragover',event=>{event.preventDefault();});
$('picker').addEventListener('drop',event=>{event.preventDefault();if(!busy&&!current)choose(event.dataTransfer.files[0]).catch(report);});
$('cancel').addEventListener('click',()=>abort?.abort());
$('load-linked-images').addEventListener('click',()=>{if(pendingLinkedFile)choose(pendingLinkedFile,{loadLinkedImages:true}).catch(report);});
for(const id of ['title','site','reviewed'])$(id).addEventListener('input',buttons);
$('new-file').addEventListener('click',()=>locked(async()=>{await store.clear();current=null;await render();$('file').value='';say('Choose a file to begin.');}).catch(report));
$('reset').addEventListener('click',()=>locked(async()=>{await store.clear();await chrome.storage.local.remove(FLIGHT_KEY);orphaned=null;current=null;await render();$('file').value='';say('Choose a file to begin.');}).catch(report));
$('send').addEventListener('click',()=>locked(async()=>{
  current=await store.load();if(!current)throw Error('Choose the source file again.');
  current.model.title=$('title').value.trim();
  // Title is local review data. Save only before claiming a send, under the
  // cross-window operation lock, so no in-flight attempt can be overwritten.
  if(current.attempt)throw Error('This document was already sent. Review the previous attempt.');
  const files=new Map();for(const asset of current.model.assets)files.set(asset.id,await store.picture(asset.id));
  await store.save(current.model,files);
  try{await transfer.send({model:current.model,siteUrl:siteKey($('site').value.trim()),formDefinition:current.model.fileReview?.formDefinition});}
  finally{await restore();}
}).catch(report));
$('check').addEventListener('click',()=>locked(async()=>{try{await transfer.follow(current.attempt);}finally{await restore();}}).catch(report));
(async()=>{
  // The standard package supplies its presentation settings at the combined
  // entry point. The standalone preview needs no optional-file fetch.
  const product=location.pathname.endsWith('/file-workspace.html')?await loadProductConfig():readProductConfig();
  if(location.pathname.endsWith('/file-workspace.html')&&!product.isCombined)throw Error('The standard extension file-workspace configuration is missing.');
  transfer=createFileTransfer({store,destinationScript:product.destinationScript,onProgress:state=>say(stages[state.stage]??'Preparing the SharePoint draft…')});
  applyProductConfig(document,product,{version:chrome.runtime.getManifest().version});
  for(const site of await createSites().list()){const option=document.createElement('option');option.value=site.url;option.textContent=site.title;$('sites').append(option);}
  await restore();
  sitePrefill=installFileSitePrefill({input:$('site'),canApply:()=>!busy&&!current&&!orphaned,onChange:buttons});
})().catch(report);
