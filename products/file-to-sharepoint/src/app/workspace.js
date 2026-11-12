import {convertDocument,MAX_DOCUMENT_BYTES} from '../engine/index.js';
import {adaptDocument} from '../content/index.js';
import {createTransferStore} from '../../../../src/transfer/store.js';
import {checkCanvasBlock} from '../../../../src/sharepoint/canvas.js';
import {siteKey,pageKey} from '../../../../src/background/sites.js';
import {confirmedPageUrl,captureStats} from '../../../../src/background/checks.js';
import {destinationChoices} from '../../../../src/popup/destinations.js';
import {createFileTransfer,FLIGHT_KEY} from './transfer.js';
import {readProductConfig,loadProductConfig,applyProductConfig} from './product.js';
import {installFileSitePrefill} from './site-prefill.js';
const $=id=>document.getElementById(id),store=createTransferStore({databaseName:'file-to-sharepoint-v1'});
let current=null,busy=false,abort=null,orphaned=null,pendingLinkedFile=null,ready=false,transfer,sitePrefill,product;
let metadata={sites:[],filePages:[]},open=[],pageHint=null,renderTurn=0;
let destinationsPending=false,destinationsRefreshing=false;
const UI_KEY='file-import-choice';let choice=null,choiceSaving=Promise.resolve();
const recorded=new Set();
const say=text=>{$('status').textContent=text;};
const stages={checking:'Checking the destination…',uploading:'Uploading and verifying pictures…',creating:'Creating and verifying the draft…',writing:'Saving and verifying the page…',complete:'Draft verified. Opening SharePoint…'};
async function call(action,payload={}){
 const reply=await chrome.runtime.sendMessage({channel:product.isCombined?'c2s-popup':'file-ui',action,payload});
 if(!reply?.ok)throw Error(reply?.error?.message??'The extension did not answer. Reopen file import.');return reply.result;
}
function saveChoice(){
 if(busy||!current||current.attempt||orphaned)return choiceSaving;
 choice={sourceHash:current.model.sourceHash,title:$('title').value,siteUrl:siteKey($('site').value.trim()),pagePath:$('page-target').value||null,hint:location.hash};
 const value={...choice};choiceSaving=choiceSaving.catch(()=>{}).then(()=>chrome.storage.session.set({[UI_KEY]:value}));return choiceSaving;
}
function buttons(){
 const attempted=!!current?.attempt||!!orphaned,protectedSend=!!orphaned||current?.attempt&&current.attempt.status!=='complete';
 const blocked=current?.model.warnings?.some(w=>w.blocking),target=$('page-target').value;
 const disabled=busy||!current||!ready||attempted||blocked||!siteKey($('site').value.trim())||!$('title').value.trim();
 $('send').disabled=disabled;$('add').disabled=disabled||!target;$('overwrite').disabled=disabled||!target;
 $('send').hidden=!!target;$('page-actions').hidden=!target;
 $('file').disabled=busy||!!protectedSend;$('choose-file').disabled=$('file').disabled;$('choose-file').textContent=current?'Choose another file':'Choose a file';$('title').disabled=busy||!current||attempted;$('site').disabled=busy||!!protectedSend;$('page-target').disabled=busy||!!protectedSend;
 $('new-file').disabled=busy||!!protectedSend;$('new-file').hidden=!current;
 for(const radio of $('destinations').querySelectorAll('input'))radio.disabled=busy||!!protectedSend;
 $('file-settings').disabled=busy;$('cancel').hidden=!abort;$('progress').hidden=!busy;
 $('check').disabled=busy;$('reset').disabled=busy;$('load-linked-images').disabled=busy||!!protectedSend||!pendingLinkedFile;
 $('recovery').hidden=$('check').hidden&&$('review-link').hidden&&$('reset').hidden;
 $('status-panel').dataset.tone=busy?'neutral':current?.attempt?.status==='complete'?'success':'idle';
}
function destinations(){
 const chosen=siteKey($('site').value.trim()),selected=pageHint??$('page-target').value;
 const sites=destinationChoices(metadata.sites,{open,chosen,page:selected});
 if(!sites.length)$('manual-site').open=true;
 $('sites').replaceChildren(...sites.map(site=>{const option=document.createElement('option');option.value=site.url;option.textContent=site.title;return option;}));
 $('destinations').replaceChildren(...sites.map(site=>{const label=document.createElement('label');label.className='destination';const radio=document.createElement('input');radio.type='radio';radio.name='destination';radio.value=site.url;radio.checked=site.url===chosen;radio.disabled=busy||!!orphaned||!!current?.attempt&&current.attempt.status!=='complete';const text=document.createElement('span');text.textContent=site.title||site.url;label.append(radio,text);radio.addEventListener('change',()=>{$('site').value=site.url;$('page-target').value='';destinations();buttons();void saveChoice().catch(report);});return label;}));
 const pages=new Map();for(const page of [...(sites.find(site=>site.url===chosen)?.pages??[]),...(metadata.filePages??[]).filter(page=>page.siteUrl===chosen)])if(pageKey(chosen,page.path))pages.set(page.path.toLowerCase(),page);
 if(selected&&pageKey(chosen,selected)&&!pages.has(selected.toLowerCase()))pages.set(selected.toLowerCase(),{path:selected,title:selected.split('/').pop().replace(/\.aspx$/i,'')});
 const first=document.createElement('option');first.value='';first.textContent='Create a new page';$('page-target').replaceChildren(first,...[...pages.values()].map(page=>{const option=document.createElement('option');option.value=page.path;option.textContent=page.title||page.path;return option;}));
 if(selected&&pageKey(chosen,selected))$('page-target').value=selected;pageHint=null;
 $('page-question').textContent=$('page-target').value?`Send to “${$('page-target').selectedOptions[0].textContent}”?`:'';
}
const openSharePointTabs=()=>chrome.tabs.query({url:'https://*.sharepoint.com/*'}).then(tabs=>tabs.map(tab=>tab.url).filter(Boolean),()=>[]);
async function refreshDestinations(){
 destinationsPending=true;if(busy||destinationsRefreshing)return;destinationsRefreshing=true;
 try{while(destinationsPending&&!busy){destinationsPending=false;const [data,tabs]=await Promise.all([call('file-import-state'),openSharePointTabs()]);if(busy){destinationsPending=true;break;}metadata=data;open=tabs;destinations();buttons();}}
 finally{destinationsRefreshing=false;}
}
async function locked(work){return navigator.locks.request('file-to-sharepoint-operation',{ifAvailable:true},async lock=>{if(!lock){say('Another file import window is working. Continue there.');return;}busy=true;buttons();try{return await work();}finally{busy=false;buttons();if(destinationsPending)void refreshDestinations().catch(()=>{});}});}
async function localAssets(model){
 for(const block of model.blocks)checkCanvasBlock(block);
 for(const asset of model.assets){const file=await store.picture(asset.id);if(!(file instanceof Blob)||file.size!==asset.size)throw Error('A local source image is missing. '+(current?.attempt||orphaned?'Check the retained send before importing again.':'Choose the source file again.'));}
}
async function remember(){
 if(current?.attempt?.status!=='complete'||recorded.has(current.attempt.attemptId))return;
 const attempt=current.attempt,result=attempt.result;confirmedPageUrl(result,attempt);
 try{await call('file-page-recorded',{attempt:{attemptId:attempt.attemptId,siteUrl:attempt.siteUrl,startedAt:attempt.startedAt,...(attempt.page?{page:attempt.page}:{})},result:{verified:result.verified,publication:result.publication,pageUrl:result.pageUrl,title:result.title,...(result.attemptId?{attemptId:result.attemptId}:{})}});recorded.add(attempt.attemptId);metadata=await call('file-import-state');}
 catch{const p=document.createElement('p');p.textContent='The import is verified, but its dashboard entry could not be saved. Reopen file import to try saving that entry again.';$('note-list').append(p);$('notes').hidden=false;$('notes').open=true;}
}
async function render(){
 const turn=++renderTurn;ready=false;$('note-list').replaceChildren();$('notes').hidden=true;$('check').hidden=true;$('review-link').hidden=true;$('reset').hidden=true;
 $('document').hidden=!current;$('picker').hidden=!!current;
 if(!current){$('title').value='';sitePrefill?.apply();destinations();buttons();return;}
 const {model,attempt}=current;$('filename').textContent=model.sourceName;$('title').value=!attempt&&choice?.sourceHash===model.sourceHash?choice.title:model.title;
 if(!attempt&&choice?.sourceHash===model.sourceHash&&choice.siteUrl){$('site').value=choice.siteUrl;pageHint=choice.pagePath;}
 const fields=model.stats.formFields??0;$('document-stats').textContent=[captureStats(model),fields?`${fields} form field${fields===1?'':'s'}`:null].filter(Boolean).join(' · ');
 let sourceError;try{await localAssets(model);if(turn!==renderTurn)return;ready=true;}catch(error){sourceError=error;}
 const notes=[...(model.warnings??[]),...(attempt?.result?.notes??[]).map(message=>({message}))];
 for(const note of notes){const p=document.createElement('p');p.textContent=note.message;if(note.blocking)p.className='blocking';$('note-list').append(p);}
 $('notes').hidden=!notes.length;$('notes-summary').textContent=`Conversion notes (${notes.length})`;$('notes').open=notes.some(note=>note.blocking)||!!attempt?.result?.notes?.length;
 if(attempt){
  $('review-link').hidden=false;$('review-link').href=siteKey(attempt.siteUrl)??'#';$('site').value=attempt.siteUrl;
  if(attempt.status==='complete'){$('review-link').href=confirmedPageUrl(attempt.result,attempt);say(attempt.page?'Page updated and verified. Open it in SharePoint to review and publish.':'Draft created and verified. Open it in SharePoint to review and publish.');await remember();}
  else{$('check').hidden=false;$('reset').hidden=false;say('This import needs a status check before another import can start.');}
 }
 destinations();buttons();if(sourceError)throw sourceError;
}
async function restore(){
 current=await store.load();choice=(await chrome.storage.session.get(UI_KEY))[UI_KEY]??null;const flight=(await chrome.storage.local.get(FLIGHT_KEY))[FLIGHT_KEY];orphaned=flight&&!current?.attempt?flight:null;
 let error;try{await render();}catch(problem){error=problem;}
 if(orphaned){$('picker').hidden=true;$('reset').hidden=false;$('check').hidden=true;$('review-link').hidden=false;$('review-link').href=siteKey(flight.siteUrl)??'#';say('A send was interrupted across a browser restart. Check SharePoint before starting another import.');buttons();}
 if(error)report(error);
}
function applyPendingHint(){const previous=$('site').value;$('site').value='';sitePrefill?.apply();if(!$('site').value)$('site').value=previous;destinations();buttons();}
async function choose(file,{loadLinkedImages=false}={}){
 if(!file)return;let pendingHint=false;await locked(async()=>{
  const existing=await store.load();if(existing?.attempt&&existing.attempt.status!=='complete'||(await chrome.storage.local.get(FLIGHT_KEY))[FLIGHT_KEY])throw Error('Check the previous send before choosing another file.');
  pendingHint=existing?.attempt?.status==='complete'&&choice?.hint!==location.hash;
  if(file.size>MAX_DOCUMENT_BYTES)throw Error('Choose a document up to 50 MiB.');pendingLinkedFile=null;$('linked-image-review').hidden=true;abort=new AbortController();buttons();say('Converting the document…');
  try{const bytes=new Uint8Array(await file.arrayBuffer()),result=await convertDocument({name:file.name,bytes},{signal:abort.signal,loadLinkedImages}),adapted=await adaptDocument({name:file.name,bytes,result},{signal:abort.signal});if(abort.signal.aborted)throw new DOMException('Conversion cancelled.','AbortError');
   const model=adapted.model;await choiceSaving.catch(()=>{});await chrome.storage.session.remove(UI_KEY);choice=null;await store.save(model,adapted.pictures);current=await store.load();
   await render();say(model.warnings.some(w=>w.blocking)?'This file contains content that could not be converted. See conversion notes.':'Ready to send.');
  }catch(error){if(['HTML_LINKED_IMAGES_REQUIRED','HTML_LINKED_IMAGE_FAILED'].includes(error.code)&&Array.isArray(error.urls)){pendingLinkedFile=file;$('linked-image-hosts').textContent=[...new Set(error.urls.map(url=>new URL(url).host))].join(', ');$('linked-image-review').hidden=false;}throw error;}
  finally{abort=null;buttons();}
 });
 if(pendingHint)applyPendingHint();
 await saveChoice();
}
function report(error){say(error.name==='AbortError'?'Conversion cancelled.':error.message??'The operation stopped. Check SharePoint before sending again.');$('status-panel').dataset.tone='error';}
$('file').addEventListener('change',event=>choose(event.target.files[0]).catch(report));
$('choose-file').addEventListener('click',()=>{$('file').value='';$('file').click();});
$('file-card').addEventListener('dragover',event=>event.preventDefault());$('file-card').addEventListener('drop',event=>{event.preventDefault();if(!$('file').disabled)choose(event.dataTransfer.files[0]).catch(report);});
$('cancel').addEventListener('click',()=>abort?.abort());$('load-linked-images').addEventListener('click',()=>{if(pendingLinkedFile)choose(pendingLinkedFile,{loadLinkedImages:true}).catch(report);});
$('title').addEventListener('input',()=>{buttons();void saveChoice().catch(report);});$('site').addEventListener('input',()=>{$('page-target').value='';destinations();buttons();void saveChoice().catch(report);});$('page-target').addEventListener('change',()=>{destinations();buttons();void saveChoice().catch(report);});
$('file-settings').addEventListener('click',()=>call('open-file-settings').catch(report));
for(const id of ['workspace-dashboard','product-brand'])$(id).addEventListener('click',event=>{if(product.isCombined){event.preventDefault();call('open-dashboard').catch(report);}});
async function clear(reviewed=false){const previous=await store.load();if(!reviewed&&(previous?.attempt&&previous.attempt.status!=='complete'||(await chrome.storage.local.get(FLIGHT_KEY))[FLIGHT_KEY]))throw Error('Check the previous send before clearing it.');const pendingHint=previous?.attempt?.status==='complete'&&choice?.hint!==location.hash;await store.clear();await choiceSaving.catch(()=>{});await chrome.storage.session.remove(UI_KEY);choice=null;if(reviewed)await chrome.storage.local.remove(FLIGHT_KEY);orphaned=null;current=null;pendingLinkedFile=null;$('linked-image-review').hidden=true;$('file').value='';await render();say('Choose a file to begin.');return pendingHint;}
async function clearAndPrefill(reviewed=false){if(await locked(()=>clear(reviewed)))applyPendingHint();}
$('new-file').addEventListener('click',()=>clearAndPrefill().catch(report));$('reset').addEventListener('click',()=>clearAndPrefill(true).catch(report));
async function send(mode=null){await locked(async()=>{
 if(!ready)throw Error('Choose the source file again.');current=await store.load();if(!current||current.attempt)throw Error('Check the previous import before sending again.');current.model.title=$('title').value.trim();
 const files=new Map();for(const asset of current.model.assets)files.set(asset.id,await store.picture(asset.id));await store.save(current.model,files);
 const target=mode?{path:$('page-target').value,mode}:null;try{await transfer.send({model:current.model,siteUrl:siteKey($('site').value.trim()),page:target});}finally{await restore();}
 });}
$('send').addEventListener('click',()=>send().catch(report));$('add').addEventListener('click',()=>send('add').catch(report));$('overwrite').addEventListener('click',()=>send('overwrite').catch(report));
$('check').addEventListener('click',()=>locked(async()=>{try{await transfer.follow(current.attempt);}finally{await restore();}}).catch(report));
(async()=>{
 product=location.pathname.endsWith('/file-workspace.html')?await loadProductConfig():readProductConfig();if(location.pathname.endsWith('/file-workspace.html')&&!product.isCombined)throw Error('The file-import configuration is missing.');applyProductConfig(document,product,{version:chrome.runtime.getManifest().version});$('file-settings').hidden=!product.isCombined;
 transfer=createFileTransfer({store,destinationScript:product.destinationScript,onProgress:state=>say(stages[state.stage]??'Preparing the SharePoint draft…')});metadata=await call('file-import-state');open=await openSharePointTabs();
 await restore();sitePrefill=installFileSitePrefill({input:$('site'),canApply:()=>!busy&&!orphaned&&(!current||!current.attempt&&!choice&&!$('site').value),onChange:()=>{destinations();buttons();},onPage:path=>{pageHint=path;}});destinations();buttons();
 const refresh=()=>void refreshDestinations().catch(()=>{});
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.sites||changes['file-pages']))refresh();});
 chrome.tabs.onUpdated.addListener((_id,change)=>{if(change.url||change.status==='complete')refresh();});chrome.tabs.onRemoved.addListener(refresh);
})().catch(report);
