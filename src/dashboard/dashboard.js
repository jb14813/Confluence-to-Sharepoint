import {filterRows,pageRows,groupRows} from './model.js';
import {sourceKey} from '../background/links.js';
import {siteKey,pageKey} from '../background/sites.js';

const CHECKS={unchecked:'Not checked',available:'Available',missing:'Missing','part-missing':'Imported content missing',blocked:'Unavailable'};
const CHANGES={unchecked:'Source not checked',changed:'Changes available',unchanged:'No newer source update',unknown:'Update status unknown',unavailable:'Unable to check source'};
const RESULTS={pending:'Pending',running:'Updating',updated:'Draft updated','updated-with-notes':'Updated with notes',failed:'Not updated','needs-review':'Needs review','not-run':'Not run'};
const date=value=>Number.isFinite(value)&&value>0?new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Unknown';
export function createDashboardUi({document=globalThis.document,chromeApi=globalThis.chrome}={}){
  const el=id=>document.getElementById(id),selected=new Set();
  let data={rows:[],refresh:{status:'idle'},account:{enabled:false},canStart:false},page=1,windowId=null,confirming=null,destroyed=false,lastRows='',siteSignature='',requested=0;
  const make=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  const write=(node,text)=>{if(node.textContent!==text)node.textContent=text;};
  function link(label,url){const a=make('a',label);if(url){a.href=url;a.target='_blank';a.rel='noopener noreferrer';}return a;}
  const sourceUrl=source=>sourceKey(source)?`${source.origin}/wiki/pages/viewpage.action?pageId=${source.pageId}`:null;
  const destinationUrl=destination=>siteKey(destination.siteUrl)&&pageKey(destination.siteUrl,destination.path)?`${new URL(destination.siteUrl).origin}${destination.path.split('/').map(encodeURIComponent).join('/')}`:null;
  function resultUrl(url,siteUrl){try{const address=new URL(url),site=siteKey(siteUrl);if(!site||address.origin!==new URL(site).origin||address.username||address.password||!pageKey(site,decodeURIComponent(address.pathname)))return null;return address.href;}catch{return null;}}
  async function call(action,payload={}){const reply=await chromeApi.runtime.sendMessage({channel:'c2s-popup',action,payload});if(!reply?.ok)throw new Error(reply?.error?.message||'The extension did not answer. Reopen the dashboard.');return reply.result;}
  async function load(){const sequence=++requested,state=await call('dashboard-state');if(destroyed||sequence!==requested)return;data=state;const present=new Set(data.rows.map(row=>row.id));for(const id of selected)if(!present.has(id))selected.delete(id);render();}
  async function act(work){el('error').hidden=true;try{await work();if(work!==load)await load();}catch(error){write(el('error'),error.message);el('error').hidden=false;}}
  const visible=()=>pageRows(filterRows(data.rows,{query:el('search').value,siteUrl:el('site').value}),page);
  function selection(){write(el('selection-count'),`${selected.size} selected`);el('update').disabled=!selected.size||!data.canStart;el('clear-selection').disabled=!selected.size;el('select-shown').disabled=!visible().rows.length;}
  function renderCatalog(){
    const sites=[...new Map(data.rows.map(row=>[row.destination.siteUrl,row.siteTitle])).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
    const signature=JSON.stringify(sites);
    if(signature!==siteSignature){const chosen=el('site').value;el('site').replaceChildren(make('option','All sites'));el('site').firstChild.value='';for(const [url,title] of sites){const option=make('option',title);option.value=url;el('site').append(option);}if(sites.some(([url])=>url===chosen))el('site').value=chosen;siteSignature=signature;}
    const shown=visible();page=shown.page;
    write(el('page-count'),`Page ${page} of ${shown.pageCount} · ${shown.total} links`);el('previous').disabled=page===1;el('next').disabled=page===shown.pageCount;
    el('empty').hidden=data.rows.length>0;
    const rowsSignature=JSON.stringify(shown.rows);
    if(rowsSignature===lastRows){selection();return;}lastRows=rowsSignature;
    const focusedRow=document.activeElement?.dataset?.row;
    const fragment=document.createDocumentFragment();
    if(data.rows.length&&!shown.rows.length)fragment.append(make('p','No pages match these filters. Try another search or site.','empty'));
    for(const site of groupRows(shown.rows)){
      const section=make('section',undefined,'site-group'),heading=make('h2');heading.append(link(site.title,siteKey(site.siteUrl)));section.append(heading);
      for(const group of site.pages){
        const article=make('section',undefined,'destination'),titleBar=make('div',undefined,'destination-heading'),title=make('h3');
        title.append(link(group.destination.title||'Untitled destination',destinationUrl(group.destination)));titleBar.append(title,make('p',group.destination.path,'path'));article.append(titleBar);
        const table=make('table'),thead=make('thead'),header=make('tr');for(const title of ['Confluence source','Confluence updated','Status'])header.append(make('th',title));thead.append(header);table.append(thead);
        const body=make('tbody');
        for(const row of group.rows){
          const tr=make('tr'),sourceCell=make('td'),source=make('div',undefined,'source-cell'),checkbox=make('input');checkbox.type='checkbox';checkbox.dataset.row=row.id;checkbox.checked=selected.has(row.id);checkbox.setAttribute('aria-label',`Select ${row.sourceLabel} in ${row.destination.title||row.destination.path}`);
          checkbox.addEventListener('change',()=>{if(checkbox.checked)selected.add(row.id);else selected.delete(row.id);selection();});
          const copy=make('div',undefined,'source-copy');copy.append(link(row.sourceLabel,sourceUrl(row.source)),make('small',`${new URL(row.source.origin).hostname} · Page ${row.source.pageId}`));source.append(checkbox,copy);sourceCell.append(source);
          const updated=make('td',date(row.sourceUpdatedAt)),change=row.sourceChange??{status:'unchecked'};
          if(change.status==='unavailable'&&row.sourceUpdatedAt)updated.append(make('small','Previously read','check-detail'));tr.append(sourceCell,updated);
          const check=make('td'),sourceStatus=make('span',CHANGES[change.status]??'Update status unknown','source-change');sourceStatus.dataset.change=change.status;
          if(change.message)sourceStatus.title=change.message;check.append(sourceStatus);
          const label=make('span',`SharePoint: ${CHECKS[row.check.status]??'Unavailable'}`,'check-label check-detail');label.dataset.check=row.check.status;check.append(label);
          if(change.message)check.append(make('span',change.message,'check-detail'));
          if(row.check.message)check.append(make('span',row.check.message,'check-detail'));tr.append(check);body.append(tr);
        }
        table.append(body);article.append(table);section.append(article);
      }
      fragment.append(section);
    }
    el('catalog').replaceChildren(fragment);if(focusedRow)[...el('catalog').querySelectorAll('input[data-row]')].find(input=>input.dataset.row===focusedRow)?.focus();selection();
  }
  function renderBatch(){
    const batch=data.batch;el('batch').hidden=!batch;if(!batch)return;
    el('work-window-note').hidden=batch.status!=='running';
    const finished=batch.items.filter(item=>!['pending','running'].includes(item.status)).length,pending=batch.items.filter(item=>item.status==='pending').length;
    write(el('batch-count'),`${finished} of ${batch.items.length} settled`);el('batch-progress').max=batch.items.length||1;el('batch-progress').value=finished;
    const job=data.job?.batchId===batch.id?data.job:null;
    write(el('batch-status'),batch.status==='running'?(job?.status==='running'?job.message:'Preparing the next update'):batch.message||(batch.status==='complete'?'Finished. Open the drafts to review your updates.':'Paused. Completed results are kept.'));
    el('stop').hidden=batch.status!=='running';el('continue').hidden=batch.status!=='paused'||!pending;el('discard').hidden=batch.status!=='paused'||!pending;
    el('continue').disabled=data.canContinue===false;
    const failed=batch.items.filter(item=>item.status==='failed'&&item.safeToRetry);el('retry').hidden=!failed.length;el('retry').disabled=!!pending||batch.status==='running'||!data.canStart;
    const list=document.createDocumentFragment();
    for(const item of batch.items){
      const row=data.rows.find(row=>row.id===item.id),li=make('li'),label=row?.sourceLabel||`Confluence page ${item.ref.source.pageId}`;
      li.append(make('strong',`${label}: ${RESULTS[item.status]??'Needs review'}`),make('p',row?.destination.title||item.ref.path));
      if(item.error?.message)li.append(make('p',item.error.message));
      if(item.resultInPopup)li.append(make('p','Open the popup to review this result and its notes.'));
      const draft=resultUrl(item.result?.pageUrl,item.ref.siteUrl);if(draft)li.append(link(item.status==='needs-review'?'Review page':'Open draft',draft));
      if(['failed','needs-review'].includes(item.status))li.append(link('Open source',sourceUrl(item.ref.source)));
      if(item.sourceNotReady&&item.ownedSource&&Number.isInteger(item.sourceTabId)){
        const showSource=make('button','Show source tab');showSource.type='button';showSource.addEventListener('click',()=>act(()=>call('show-tab',{tabId:item.sourceTabId})));li.append(showSource);
      }
      if(item.result?.notes?.length){const notes=make('ul');for(const note of item.result.notes)notes.append(make('li',note));li.append(notes);}list.append(li);
    }
    el('result-list').replaceChildren(list);
  }
  function render(){
    write(el('account-note'),data.account.enabled?'Account copy is on. Refresh reads saved history from your known and open Confluence sites.':'Account copy is off. Your list is kept in this browser; Refresh checks its tracked pages.');
    const refresh=data.refresh,running=refresh.status==='running';el('refresh').disabled=running||data.batch?.status==='running'||data.job?.status==='running';el('stop-refresh').hidden=!running;
    const changes=data.rows.filter(row=>row.sourceChange?.status==='changed').length;
    write(el('refresh-status'),refresh.status==='idle'?'':`${refresh.message||refresh.status}${running&&refresh.total?` (${refresh.completed} of ${refresh.total})`:''}${refresh.status==='complete'&&changes?` · ${changes} ${changes===1?'link has':'links have'} source changes.`:''}`);
    const reports=[...(refresh.reports??[]).filter(report=>report.status!=='synced'),...(data.account.problem?[{message:data.account.problem}]:[])];el('refresh-reports').hidden=!reports.length;
    el('refresh-reports').replaceChildren(...reports.map(report=>make('li',`${report.origin?new URL(report.origin).hostname+': ':''}${report.message||report.status}`)));
    write(el('blocker'),data.blocker||'');el('blocker').hidden=!data.blocker;renderCatalog();renderBatch();
  }
  const on=(id,fn)=>el(id).addEventListener('click',fn);
  el('search').addEventListener('input',()=>{page=1;renderCatalog();});el('site').addEventListener('change',()=>{page=1;renderCatalog();});
  on('previous',()=>{page--;renderCatalog();});on('next',()=>{page++;renderCatalog();});
  on('select-shown',()=>{for(const row of visible().rows)selected.add(row.id);for(const input of el('catalog').querySelectorAll('input[data-row]'))input.checked=selected.has(input.dataset.row);selection();});
  on('clear-selection',()=>{selected.clear();for(const input of el('catalog').querySelectorAll('input[data-row]'))input.checked=false;selection();});
  on('refresh',()=>act(()=>call('dashboard-refresh',{windowId})));on('stop-refresh',()=>act(()=>call('dashboard-stop-refresh')));
  on('update',()=>{
    const rows=data.rows.filter(row=>selected.has(row.id));if(!rows.length||!data.canStart)return;
    confirming={ids:rows.map(row=>row.id),...(data.batch?{replaceBatchId:data.batch.id}:{})};const destinations=new Set(rows.map(row=>`${row.destination.siteUrl}|${row.destination.uniqueId??row.destination.path.toLowerCase()}`));
    write(el('confirm-count'),`${rows.length} selected links across ${destinations.size} destination pages.${data.batch?' Previous batch results will be replaced. Review any Needs review entries before confirming.':''}`);el('confirmation').showModal();
  });
  on('confirm',()=>{const selection=confirming;confirming=null;el('confirmation').close();if(selection)act(()=>call('batch-start',{...selection,windowId}));});
  on('stop',()=>act(()=>call('batch-stop',{batchId:data.batch.id})));on('continue',()=>act(()=>call('batch-continue',{batchId:data.batch.id,windowId})));on('discard',()=>act(()=>call('batch-discard',{batchId:data.batch.id})));
  on('retry',()=>act(()=>call('batch-retry',{batchId:data.batch.id,windowId,ids:data.batch.items.filter(item=>item.status==='failed'&&item.safeToRetry).map(item=>item.id)})));
  let queued=false;const changed=(_changes,area)=>{if(!['session','local'].includes(area)||queued||destroyed)return;queued=true;queueMicrotask(()=>{queued=false;act(load);});};
  chromeApi.storage.onChanged.addListener(changed);
  const ready=(async()=>{windowId=await chromeApi.windows.getCurrent().then(window=>window.id,()=>null);await act(load);})();
  function destroy(){destroyed=true;chromeApi.storage.onChanged.removeListener(changed);}
  document.defaultView?.addEventListener('pagehide',destroy,{once:true});return {ready,destroy};
}
if(typeof document!=='undefined'&&!globalThis.__C2S_DASHBOARD_MANUAL__){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>createDashboardUi(),{once:true});else createDashboardUi();}
