// Capture and send run here, in the extension's background, so they keep going
// when the popup closes. Progress and outcome are published in session storage
// (key `job`), which the popup watches.
import {createTransferStore} from '../transfer/store.js';
import {PICTURE_PIECE_BYTES,base64ToBytes,bytesToBase64,sha256Hex} from '../transfer/limits.js';
import {captureStats,confirmedUrl,fail,siteAddress,validateCapture} from './checks.js';
import {siteKey} from './sites.js';

const CHANNEL='guide-transfer',JOB='job';
const IMPORTING={checking:'Checking the site',uploading:'Uploading pictures',creating:'Creating the draft'};
// The steps of creating the draft, as the site's tab reports them.
const CREATING={preparing:'Preparing the draft',page:'Creating the page',content:'Saving the content'};
// Reasons a site cannot take a draft. They are noted on the remembered site
// until the user visits it again; a sign-in or a passing failure is not.
const LASTING=new Set(['no-site','no-pages','no-permission','no-drafts']);

export function createJobs({chromeApi=globalThis.chrome,sites,store=createTransferStore({session:chromeApi?.storage?.session}),loadTimeoutMs=60_000,importTimeoutMs=15*60_000,
  captureTimeoutMs=30*60_000,injectTimeoutMs=20_000,pollMs=500,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  const session=chromeApi.storage.session;
  // Tabs a send opened and is still using; their pages' site visits are not recorded.
  const sendingTabs=new Set();
  let active=null;
  const publish=job=>session.set({[JOB]:{...job,updatedAt:Date.now()}});
  const current=async()=>(await session.get(JOB))[JOB]??null;
  // Every request to a tab is short. Capture and import run in their tabs on
  // their own and are followed through `status`, because Chrome stops an
  // extension service worker whose single request lasts more than five minutes.
  async function message(tabId,action,payload={}){
    const response=await chromeApi.tabs.sendMessage(tabId,{channel:CHANNEL,action,payload});
    if(response?.ok===true)return response.result;
    // A refusal carries the page's own reason; no answer means the page could not be reached.
    if(response?.ok===false)throw Object.assign(new Error(response.error?.message??'The page refused the request.'),response.error,{refused:true});
    throw fail('page-unavailable','The page did not respond. Reload it, then try again.');
  }
  /** What a tab shows: a Confluence page, a SharePoint site, or neither with the reason. */
  async function inspect(tabId){
    let timer;
    try{
      // Chrome holds scripts for a site whose access the user withheld, so the wait is bounded.
      await Promise.race([chromeApi.scripting.executeScript({target:{tabId},files:['content.js']}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('The script was not injected in time.')),injectTimeoutMs);})]);
    }catch{throw fail('page-unavailable','The extension cannot read this tab.');}
    finally{clearTimeout(timer);}
    const context=await message(tabId,'inspect');
    if(context?.kind==='sharepoint')return {...context,tabId,siteUrl:siteAddress(context.siteUrl)};
    if(context?.kind==='confluence'&&typeof context.title==='string'&&typeof context.pageUrl==='string')return {...context,tabId};
    return {kind:'unsupported',tabId,product:['confluence','sharepoint'].includes(context?.product)?context.product:null,reason:context?.reason??'',
      code:typeof context?.code==='string'&&/^[a-z-]{1,40}$/.test(context.code)?context.code:null};
  }
  // Runs `work` as the one job. Its failure is published with code, message
  // and the review details; the returned promise never rejects.
  function start(job,work){
    if(active)throw fail('job-busy','Wait for the current capture or send to finish.');
    let last={...job},shown='',settled=false;
    const update=change=>{
      if(settled)return Promise.resolve();
      const next={...last,...change,status:'running'},text=JSON.stringify(next);
      // Unchanged progress is not published again, so an open popup is not asked to reload.
      if(text===shown)return Promise.resolve();
      shown=text;last=next;return publish(next);
    };
    const finish=record=>{settled=true;return publish(last={...last,...record});};
    active=(async()=>{
      try{await update({});await work(update,finish);}
      catch(error){
        settled=true;
        await publish({...last,status:'failed',error:{code:typeof error?.code==='string'?error.code:'operation-failed',message:error?.message||'The job stopped.',...(error?.draftMayExist?{draftMayExist:true}:{})},
          ...(error?.review?{review:error.review}:{}),...(Number.isInteger(error?.tabId)?{tabId:error.tabId}:{})}).catch(()=>{});
      }finally{active=null;}
    })();
    return active;
  }
  async function loaded(tabId){
    for(let tries=0;tries*250<loadTimeoutMs;tries++){
      const tab=await chromeApi.tabs.get(tabId).catch(()=>null);
      if(!tab)throw fail('site-tab-closed','The site’s tab was closed before the draft was created. Send again.');
      if(tab.status==='complete')return tab;
      await sleep(250);
    }
    throw fail('site-load-timeout','The SharePoint site did not finish loading. Check it in its tab, then send again.');
  }
  // The tab's own status decides the import's outcome, so a lost answer changes nothing.
  async function settle(tabId,attemptId,onStatus=()=>{}){
    for(const deadline=Date.now()+importTimeoutMs;;){
      const status=await message(tabId,'status');
      if(status.attemptId!==attemptId)throw fail('attempt-unavailable','The import is no longer running in its SharePoint tab. Review Site Pages before sending again.');
      if(status.stage==='complete')return status.result;
      if(status.stage==='failed')throw Object.assign(new Error(status.error?.message??'The import stopped.'),status.error);
      if(Date.now()>deadline)throw fail('attempt-unavailable','The import did not finish in time. Review Site Pages before sending again.');
      await onStatus(status);
      await sleep(pollMs);
    }
  }
  async function complete(result,attempt,title,tab,finish){
    const url=confirmedUrl(result,attempt);
    await store.completeAttempt(result);
    // Bookkeeping must not turn a created draft into a failure.
    await Promise.resolve().then(()=>sites.visited(attempt.siteUrl,title)).catch(()=>{});
    // The draft replaces the site's page in the tab that created it, in front.
    if(tab)try{await chromeApi.tabs.update(tab.id,{url,active:true});await chromeApi.windows.update(tab.windowId,{focused:true});}catch{/* Open draft stays in the popup. */}
    // What the site refused, and the draft therefore left out, goes with the result (plain sentences only).
    const notes=(Array.isArray(result?.notes)?result.notes:[]).filter(note=>typeof note==='string'&&note&&note.length<=400&&!/[\u0000-\u001f\u007f]/.test(note)).slice(0,5);
    await finish({status:'done',phase:'done',message:`Draft created in ${title}`,siteTitle:title,...(tab?{tabId:tab.id}:{}),result:{editUrl:url,siteUrl:attempt.siteUrl,siteTitle:title,...(notes.length?{notes}:{})}});
  }
  function capture(tabId){
    if(!Number.isInteger(tabId))throw fail('invalid-tab','Open the Confluence page to capture.');
    return start({kind:'capture',tabId,phase:'capturing',message:'Capturing the page',completed:0,total:0},async(update,finish)=>{
      // The old capture goes first, so a failure cannot leave its pictures ready to send under a new title.
      await store.clear();
      const context=await inspect(tabId);
      if(context.kind!=='confluence')throw fail('source-changed','Open the Confluence page you want to capture, then try again.');
      await update({title:context.title});
      await message(tabId,'capture',{detach:true});
      for(const deadline=Date.now()+captureTimeoutMs;;){
        const status=await message(tabId,'status');
        if(status.stage==='ready')break;
        if(status.stage==='failed')throw Object.assign(new Error(status.error?.message??'The capture stopped.'),status.error);
        if(Date.now()>deadline)throw fail('capture-timeout','The capture did not finish. Reload the page, then capture it again.');
        await update({completed:status.completedImages??0,total:status.totalImages??0});
        await sleep(pollMs);
      }
      const model=await message(tabId,'captured');
      validateCapture(model);
      // The pictures stay in the page's tab until they are read in pieces here and checked against their SHA-256 identity.
      const files=new Map();
      for(const [index,asset] of model.assets.entries()){
        await update({phase:'saving',message:'Saving pictures',completed:index,total:model.assets.length});
        const pieces=[];
        for(let offset=0;offset!==null;){
          const piece=await message(tabId,'picture',{id:asset.id,offset});
          const bytes=base64ToBytes(piece?.data);
          if(!bytes?.length||piece.next!==null&&piece.next!==offset+bytes.length)throw fail('picture-incomplete','A captured picture could not be read. Capture the page again.');
          pieces.push(bytes);offset=piece.next;
        }
        const file=new Blob(pieces,{type:asset.mime});
        if(file.size!==asset.size||await sha256Hex(await file.arrayBuffer())!==asset.id)throw fail('picture-incomplete','A captured picture did not arrive intact. Capture the page again.');
        files.set(asset.id,file);
      }
      // The capture remembers its page, so the popup can tell it from other pages once it is sent.
      const page=typeof context.pageId==='string'&&/^\d{1,20}$/.test(context.pageId)?{origin:new URL(context.pageUrl).origin,pageId:context.pageId}:null;
      await store.save({...model,sourcePage:page},files);
      await finish({status:'done',phase:'done',message:'Captured',title:model.title,completed:model.assets.length,total:model.assets.length});
    });
  }
  function send(siteUrl,windowId){
    const key=siteKey(siteUrl);
    if(!key)throw fail('invalid-destination','Choose a SharePoint site to send the page to.');
    return start({kind:'send',siteUrl:key,phase:'opening',message:'Opening the site',completed:0,total:0},async(update,finish)=>{
      const record=await store.load();
      if(!record?.model)throw fail('incomplete-capture','Capture a Confluence page first.');
      if(record.attempt)throw fail('import-already-attempted','This capture was already sent. Capture the page again to send it once more.');
      const model=record.model,name=(await sites.list()).find(site=>site.url===key)?.title||key;
      // Chrome holds scripts in a site whose access the user withheld from the extension; ask for access rather than wait.
      if(!await Promise.resolve(chromeApi.permissions?.contains({origins:[`${new URL(key).origin}/*`]})).catch(()=>false))
        throw fail('site-access-needed',`Chrome's site access for this extension does not include ${name}. Allow access, then send again.`);
      await sites.used(key);
      await update({siteTitle:name,message:`Opening ${name}`});
      const tab=await chromeApi.tabs.create({url:`${key}/SitePages`,active:false,...(Number.isInteger(windowId)?{windowId}:{})});
      sendingTabs.add(tab.id);
      try{
        await loaded(tab.id);
        await update({phase:'checking',message:`Checking ${name}`,tabId:tab.id});
        let context=null;
        for(let tries=0;tries<3&&!context;tries++){try{context=await inspect(tab.id);}catch{await sleep(1000);}}
        if(context?.kind!=='sharepoint'){
          const sharePoint=context?.product==='sharepoint';
          if(sharePoint&&LASTING.has(context.code)){await sites.problem(key,context.reason);throw fail('site-unsuitable',context.reason);}
          if(sharePoint&&context.code==='unreachable')throw fail('site-unreachable',context.reason);
          if(sharePoint&&context.code==='denied')throw fail('sign-in-needed',context.reason);
          // A page on the site's own address that is not SharePoint, such as "404 NOT FOUND", is no sign-in problem:
          // Chrome hides the address of a tab that left for a sign-in page, which the extension may not read.
          let shown=null;try{shown=new URL((await chromeApi.tabs.get(tab.id))?.url);}catch{/* Address hidden or tab gone. */}
          if(shown?.origin===new URL(key).origin)
            throw fail('site-page-missing',`${name}’s Site Pages did not open in the tab that opened. Check the site in that tab, then send again.`);
          throw fail('sign-in-needed',`Sign in to ${name} in the tab that opened, then send again.`);
        }
        if(context.siteUrl!==key){
          const reason=`This address opens ${context.siteTitle||context.siteUrl}, not the remembered site. Visit the site you want so it is remembered, then send again.`;
          await sites.problem(key,reason);throw fail('site-changed',reason);
        }
        const title=context.siteTitle||name;
        // Every picture reaches the site's tab before the one-time import attempt is claimed, so a transfer problem cannot lock the capture.
        for(const [index,asset] of model.assets.entries()){
          await update({phase:'preparing',message:'Preparing pictures',siteTitle:title,completed:index,total:model.assets.length});
          const file=await store.picture(asset.id);
          if(!file||file.size!==asset.size)throw fail('picture-unavailable','A captured picture is missing from this browser. Capture the page again.');
          for(let offset=0;offset<file.size;offset+=PICTURE_PIECE_BYTES)
            await message(tab.id,'stage',{id:asset.id,size:asset.size,offset,data:bytesToBase64(new Uint8Array(await file.slice(offset,offset+PICTURE_PIECE_BYTES).arrayBuffer()))});
        }
        const attempt={attemptId:globalThis.crypto.randomUUID(),sourceHash:model.sourceHash,siteUrl:key,tabId:tab.id};
        await store.claimAttempt(attempt);
        await update({phase:'checking',message:IMPORTING.checking,completed:0,total:0});
        try{await message(tab.id,'import',{model,attemptId:attempt.attemptId,siteUrl:key,detach:true});}
        catch(error){
          // Refused before it started, so nothing was written: the capture can be sent again.
          if(error?.refused){await store.releaseAttempt(attempt.attemptId);throw error;}
          // No answer: the import may have started, so its tab's status decides.
        }
        const review={sitePagesUrl:`${key}/SitePages`};
        await update({review});
        let result;
        try{
          // Pictures are counted while they upload; the other steps have no counts.
          result=await settle(tab.id,attempt.attemptId,status=>{
            const message=status.stage==='creating'&&Object.hasOwn(CREATING,status.step??'')?CREATING[status.step]:Object.hasOwn(IMPORTING,status.stage??'')?IMPORTING[status.stage]:null;
            return message?update({phase:status.stage,message,...status.stage==='uploading'?{completed:status.completedImages??0,total:status.totalImages??0}:{completed:0,total:0}}):null;
          });
        }catch(error){throw Object.assign(error,{review,draftMayExist:true});}
        await complete(result,attempt,title,tab,finish);
      }catch(error){
        if(error&&typeof error==='object'&&!Number.isInteger(error.tabId))error.tabId=tab.id;
        throw error;
      }finally{sendingTabs.delete(tab.id);}
    });
  }
  async function state(){
    let record=null;
    try{record=await store.load();}catch{/* Shown as nothing captured. */}
    const model=record?.model,attempt=record?.attempt;
    let editUrl=null;
    if(attempt?.status==='complete')try{editUrl=confirmedUrl(attempt.result,attempt);}catch{/* Not shown. */}
    return {job:await current(),running:Boolean(active),
      // What capture could not copy is kept apart from its layout notes, for the popup to show plainly.
      capture:model?{title:model.title,stats:captureStats(model),warnings:(model.warnings??[]).filter(warning=>!warning.lost).map(warning=>warning.message??warning.code),
        losses:(model.warnings??[]).filter(warning=>warning.lost).map(warning=>warning.message??warning.code),
        attempt:attempt?{status:attempt.status,siteUrl:attempt.siteUrl,editUrl}:null,page:model.sourcePage??null}:null};
  }
  async function clear(){
    if(active)throw fail('job-busy','Wait for the current capture or send to finish.');
    await store.clear();await session.remove(JOB);
  }
  async function showTab(tabId){
    const tab=await chromeApi.tabs.update(tabId,{active:true});
    await chromeApi.windows.update(tab.windowId,{focused:true});
  }
  /**
   * After a restart of the background: a started import is followed to its end,
   * one that finished is reported, and any other running job is reported as
   * interrupted. Chrome restarts the worker when something needs it, such as
   * the popup opening.
   */
  async function recover(){
    const job=await current();
    if(active||job?.status!=='running')return;
    let record=null;
    try{record=await store.load();}catch{/* Nothing to follow. */}
    // A job may have started while the record was read.
    if(active)return;
    const attempt=record?.attempt,title=job.siteTitle||attempt?.siteUrl;
    if(job.kind==='send'&&attempt?.status==='complete'){
      // The draft was made before the restart; only its report was lost.
      let url=null;try{url=confirmedUrl(attempt.result,attempt);}catch{/* Reported as interrupted below. */}
      if(url){await publish({...job,status:'done',phase:'done',message:`Draft created in ${title}`,result:{editUrl:url,siteUrl:attempt.siteUrl,siteTitle:title}});return;}
    }
    if(job.kind==='send'&&attempt?.status==='started'&&Number.isInteger(attempt.tabId)){
      const review={sitePagesUrl:`${attempt.siteUrl}/SitePages`};
      return start({...job,tabId:attempt.tabId,review},async(update,finish)=>{
        let result;
        try{result=await settle(attempt.tabId,attempt.attemptId);}catch(error){throw Object.assign(error,{review,draftMayExist:true});}
        await complete(result,attempt,title,await chromeApi.tabs.get(attempt.tabId).catch(()=>null),finish);
      });
    }
    await publish({...job,status:'failed',error:{code:'interrupted',message:job.kind==='capture'?'The extension restarted during the capture. Capture the page again.':'The extension restarted before the draft was started. Send again.'}});
  }
  return {state,inspect,capture,send,clear,showTab,recover,busyTab:tabId=>sendingTabs.has(tabId)};
}
