import {linkKey,sourceKey} from './links.js';
import {fail} from './checks.js';
import {confluenceRoute} from '../confluence/detect.js';
import {workWindow} from './windows.js';

const KEY='dashboardBatch',LIMIT=2000,BUDGET=4_000_000;
const PAUSE=new Set(['sign-in-needed','site-access-needed','site-unreachable','site-unsuitable','site-changed','site-page-missing','capture-loss','work-window-unavailable']);
const size=value=>new TextEncoder().encode(JSON.stringify(value)).length;
export function transferBlocker(state){
  if(state.running)return 'Wait for the current capture or send to finish.';
  if(state.job?.status!=='done'&&(state.job?.review||state.job?.error?.pageMayHaveChanged||state.job?.error?.draftMayExist))return 'Review the previous send and clear it in the popup before continuing.';
  if(state.capture&&state.capture.attempt?.status!=='complete')return state.capture.attempt?'Review and clear the previous attempt in the popup.':'Send or clear your unsent capture in the popup first.';
  return null;
}
export function createBulkUpdates({chromeApi=globalThis.chrome,session=chromeApi.storage.session,links,jobs,now=()=>Date.now()}={}){
  let batch=null,owner=null,starting=null,active=null,loadFailed=false;
  const save=()=>{if(size(batch)>BUDGET)throw fail('batch-too-large','The batch metadata reached its size limit.');return session.set({[KEY]:batch});};
  // Leave room for compact terminal checkpoints and the pause message before starting writes.
  const fits=()=>size({...batch,currentId:null})+batch.items.filter(item=>['pending','running'].includes(item.status)).length*256+6000<=BUDGET;
  function retainOutcome(item){
    if(fits())return;
    delete item.result;delete item.error;item.resultInPopup=true;
    batch.limitReached=true;batch.stopRequested=true;batch.message='Batch results reached their size limit. Review the current result in the popup, then discard pending items and select a smaller batch.';
  }
  async function restore(){if(loadFailed){await api.load();await api.recover();}}
  const state=async()=>{await restore();return structuredClone(batch);};
  function chosen(id){if(!batch||batch.id!==id)throw fail('batch-unknown','This batch is no longer current.');}
  function pending(){return batch?.items.some(item=>item.status==='pending');}
  async function blocked(){const reason=transferBlocker(await jobs.state());if(reason)throw fail('capture-blocked',reason);}
  function classify(item,outcome,capture){
    item.safeToRetry=outcome.safeToRetry===true;
    if(outcome.attemptId)item.attemptId=outcome.attemptId;
    if(outcome.status==='done'){
      const notes=[...new Set([...(capture?.losses??[]),...(capture?.warnings??[]),...(outcome.result?.notes??[])])].filter(value=>typeof value==='string').map(value=>value.slice(0,1500));
      item.status=notes.length?'updated-with-notes':'updated';item.result={...outcome.result,notes};item.safeToRetry=false;
    }else{
      item.status=item.safeToRetry?'failed':'needs-review';item.error={code:outcome.error?.code??'operation-failed',message:(outcome.error?.message??'The update stopped.').slice(0,1500)};
      if(outcome.review)item.result={...outcome.review};
    }
  }
  async function closeSource(tab,source){
    if(!tab?.owned||!Number.isInteger(tab.tabId))return;
    const open=await chromeApi.tabs.get(tab.tabId).catch(()=>null);
    if(!open||open.active||open.pendingUrl)return;
    try{const url=new URL(open.url),route=confluenceRoute({url,contextPath:'/wiki'});
      if(url.origin!==source.origin||route?.type!=='page'||route.pageId!==source.pageId||['edit','edit-v2'].some(key=>url.searchParams.has(key))||[...url.searchParams].some(([key,value])=>key.toLowerCase()==='mode'&&value.toLowerCase()==='edit'))return;
      await chromeApi.tabs.remove(tab.tabId).catch(()=>{});
    }catch{/* Preserve tabs whose location cannot be established. */}
  }
  async function pump(){
    let reusableSource=null,paused=false;
    try{
      for(const item of batch.items){
        if(item.status!=='pending')continue;
        if(batch.stopRequested)break;
        const link=(await links.list()).find(link=>linkKey(link)===item.id);
        if(!link){item.status='not-run';item.error={message:'This tracked link was removed.'};await save();continue;}
        const previousRef=item.ref;item.ref=reference(link);item.status='running';item.updateStarted=false;delete item.sourceNotReady;batch.currentId=item.id;
        if(!fits()){item.ref=previousRef;item.status='not-run';item.error={message:'The current link metadata no longer fits in this batch.'};batch.currentId=null;batch.limitReached=true;batch.stopRequested=true;batch.message='Select a smaller batch for the remaining pages.';await save();break;}
        await save();let sourceTab,accepted=false;
        try{
          const windowId=await workWindow(chromeApi,batch.windowId);
          sourceTab=await jobs.openSource(link.source,{windowId,reuse:reusableSource,requiredWindow:true,onOpened:async opened=>{
            item.sourceTabId=opened.tabId;item.ownedSource=opened.owned===true;await save();
          }});
          reusableSource={...sourceTab,source:link.source};
          item.sourceTabId=sourceTab.tabId;item.ownedSource=sourceTab.owned===true;await save();
          item.updateStarted=true;await save();
          const transfer=jobs.updatePage(sourceTab.tabId,link.siteUrl,link.path,windowId,{batchId:batch.id,batchItemId:item.id,foreground:false});accepted=true;
          const outcome=await transfer;
          classify(item,outcome,(await jobs.state()).capture);
        }catch(error){
          // Source preparation is read-only; Update errors carry the job's explicit proof.
          item.status=accepted?'needs-review':'failed';item.safeToRetry=!accepted;
          item.error={code:error?.code??'source-unavailable',message:(error?.message??'Open the source and try again.').slice(0,1500)};
          if(Number.isInteger(error?.sourceTabId))item.sourceTabId=error.sourceTabId;
          if(error?.sourceNotReady){item.sourceNotReady=true;paused=true;batch.stopRequested=true;batch.message='Show the source tab and wait for it to load, then retry this failed item.';}
        }
        batch.currentId=null;
        retainOutcome(item);
        await save();
        if(batch.limitReached)break; // The full current outcome remains protected in jobs.state.
        if(item.status==='needs-review'){batch.message='Review the interrupted update before continuing.';break;}
        if(item.error?.code==='capture-loss'){paused=true;reusableSource=null;batch.message='The capture missed content. Review and clear it in the popup before continuing.';break;}
        if(item.sourceTabId&&!sourceTab){reusableSource=null;}
        // The result is checkpointed before the single capture is released.
        const jobState=await jobs.state();
        if(!transferBlocker(jobState)||item.safeToRetry)await jobs.clear({batchId:batch.id});
        if(PAUSE.has(item.error?.code)){paused=true;batch.message=item.error.message;break;}
      }
      batch.status=paused||pending()||batch.items.some(item=>item.status==='needs-review')?'paused':'complete';
      if(batch.status==='complete')batch.finishedAt=now();await save();
    }catch(error){batch.status='paused';batch.message=(error?.message||'The queue was interrupted. Review it before continuing.').slice(0,1500);await save();}
    finally{try{if(reusableSource)await closeSource(reusableSource,reusableSource.source);}finally{owner=null;active=null;}}
  }
  function reference(link){return {source:link.source,siteUrl:link.siteUrl,path:link.path,...(link.uniqueId?{uniqueId:link.uniqueId}:{})};}
  async function start({ids,windowId,replaceBatchId}={}){
    if(owner||starting||active)throw fail('batch-busy','An update batch is already running.');
    starting=crypto.randomUUID();const id=starting;
    try{
      await restore();if(owner||active)throw fail('batch-busy','Wait for the recovered batch.');owner=id;
      if(pending())throw fail('batch-pending','Continue or discard the pending batch first.');
      if(batch&&replaceBatchId!==batch.id)throw fail('batch-results','Review the previous batch results, then confirm replacing them with a new batch.');
      await blocked();
      if(!Array.isArray(ids)||!ids.length||ids.length>LIMIT||ids.some(value=>typeof value!=='string'||!value||value.length>4096))throw fail('invalid-selection','Select between 1 and 2,000 tracked links.');
      const all=await links.list(),selected=[...new Set(ids)].map(id=>all.find(link=>linkKey(link)===id));
      if(selected.some(link=>!link||!sourceKey(link.source)))throw fail('link-unknown','Some selected links were removed. Refresh the selection.');
      selected.sort((a,b)=>`${a.siteUrl}|${a.uniqueId??a.path.toLowerCase()}|${a.source.origin}|${a.source.pageId}`.localeCompare(`${b.siteUrl}|${b.uniqueId??b.path.toLowerCase()}|${b.source.origin}|${b.source.pageId}`));
      const next={id,status:'running',items:selected.map(link=>({id:linkKey(link),ref:reference(link),status:'pending',safeToRetry:false})),currentId:null,stopRequested:false,windowId:windowId??null,startedAt:now()};
      if(size(next)+selected.length*256+6000>BUDGET)throw fail('batch-too-large','The selected update metadata is too large. Select fewer pages.');
      batch=next;await save();await jobs.clear({batchId:id});active=pump();return {batchId:id};
    }catch(error){if(owner===id)owner=null;throw error;}finally{starting=null;}
  }
  const api={state,start,ownsWork:()=>Boolean(owner||starting),ownerId:()=>owner??starting,
    async load(){try{batch=(await session.get(KEY))[KEY]??null;loadFailed=false;if(batch?.status==='running')owner=batch.id;}catch(error){loadFailed=true;throw error;}},
    async recoveryFailed(message){
      try{
        if(batch?.status==='running'){
          batch.status='paused';batch.message=`Recovery stopped. ${String(message||'Review the previous attempt before continuing.').slice(0,400)}`;
          const item=batch.items.find(item=>item.status==='running');
          if(item){item.status='needs-review';item.safeToRetry=false;item.error={message:'Recovery could not establish this outcome.'};}
          batch.currentId=null;await save();
        }
      }finally{owner=null;}
    },
    async recover(){
      if(!batch)return;
      const current=batch.items.find(item=>item.status==='running');
      if(current){const jobState=await jobs.state(),job=jobState.job;
        if(jobState.running&&job?.batchId===batch.id&&job.batchItemId===current.id){owner=batch.id;return;}
        if(job?.batchId===batch.id&&job.batchItemId===current.id&&job.status!=='running'){
          classify(current,job,jobState.capture);batch.currentId=null;retainOutcome(current);
          if(current.status!=='needs-review'&&job.error?.code!=='capture-loss'){
            await closeSource({tabId:current.sourceTabId,owned:current.ownedSource===true},current.ref.source);
            if(!transferBlocker(jobState)||current.safeToRetry)await jobs.clear({batchId:batch.id});
          }
        }else if(current.updateStarted===false&&!jobState.running&&!jobState.capture?.attempt){current.status='failed';current.safeToRetry=true;current.error={message:'The worker restarted before Update accepted this item.'};}
        else{current.status='needs-review';current.safeToRetry=false;current.error={message:'The worker restarted before this outcome was recorded. Review the previous attempt.'};}
        if(current.error?.code!=='capture-loss')await closeSource({tabId:current.sourceTabId,owned:current.ownedSource===true},current.ref.source);
      }
      if(batch.status==='running'){batch.currentId=null;batch.status=pending()||current?.status==='needs-review'?'paused':'complete';if(!batch.limitReached)batch.message='The worker restarted. Completed results are kept; Continue runs pending items only.';}if(current||batch.status==='paused'||batch.status==='complete')await save();owner=null;
    },
    async stop({batchId}){chosen(batchId);if(!owner)throw fail('batch-paused','This batch is already paused.');batch.stopRequested=true;await save();},
    async continue({batchId,windowId}){chosen(batchId);if(owner||active)throw fail('batch-busy','Wait for the current item.');if(batch.limitReached)throw fail('batch-results-full','Review the current result in the popup and discard pending items before selecting a smaller batch.');if(!pending())throw fail('batch-empty','No pending updates remain.');owner=batch.id;batch.stopRequested=false;
      try{await blocked();await jobs.clear({batchId:batch.id});if(Number.isInteger(windowId))batch.windowId=windowId;batch.status='running';delete batch.message;await save();active=pump();return {batchId:batch.id};}catch(error){owner=null;throw error;}},
    async discard({batchId}){chosen(batchId);if(owner||active)throw fail('batch-busy','Stop after the current item first.');for(const item of batch.items)if(item.status==='pending'){item.status='not-run';item.error={message:'Pending update discarded.'};}batch.status='complete';batch.finishedAt=now();await save();},
    async retry({batchId,ids,windowId}){
      chosen(batchId);if(owner||active)throw fail('batch-busy','Wait for the current item.');if(pending())throw fail('batch-pending','Continue or discard pending items first.');
      const safe=new Set(batch.items.filter(item=>item.status==='failed'&&item.safeToRetry).map(item=>item.id));
      if(!Array.isArray(ids)||!ids.length||ids.some(id=>!safe.has(id)))throw fail('retry-unsafe','Only known-not-written failures can be retried.');
      owner=batch.id;batch.stopRequested=false;
      try{
        await blocked();const all=await links.list(),chosenIds=new Set(ids);
        for(const item of batch.items)if(chosenIds.has(item.id)){
          if(all.some(link=>linkKey(link)===item.id)){item.status='pending';item.safeToRetry=false;delete item.error;delete item.result;}
          else{item.status='not-run';item.safeToRetry=false;item.error={message:'This tracked link was removed.'};}
        }
        if(Number.isInteger(windowId))batch.windowId=windowId;delete batch.message;delete batch.finishedAt;
        batch.status=pending()?'running':'complete';await save();
        if(pending()){await jobs.clear({batchId:batch.id});active=pump();}else owner=null;
        return {batchId:batch.id};
      }catch(error){owner=null;throw error;}
    },
    idle:async()=>{await active;}
  };return api;
}
