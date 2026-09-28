// Capture and send run here, in the extension's background, so they keep going
// when the popup closes. Progress and outcome are published in session storage
// (key `job`), which the popup watches.
import {createTransferStore} from '../transfer/store.js';
import {PICTURE_PIECE_BYTES,base64ToBytes,bytesToBase64,sha256Hex} from '../transfer/limits.js';
import {captureStats,confirmedPageUrl,fail,siteAddress,validateCapture} from './checks.js';
import {pageKey,siteKey} from './sites.js';

const CHANNEL='guide-transfer',JOB='job';
// A send in flight, noted in local storage from its claim to its outcome: Chrome clears session storage (the job and
// the capture's session) when the extension is updated or reloaded, and this note is what then says a send was cut short.
const FLIGHT='send-in-flight';
const IMPORTING={checking:'Checking the site',uploading:'Uploading pictures',creating:'Creating the draft',writing:'Preparing the page'};
// The steps of creating a draft, and of writing a page, as the site's tab reports them.
const CREATING={preparing:'Preparing the draft',page:'Creating the page',content:'Saving the content',checkin:'Checking in the draft'};
const WRITING={page:'Checking out the page',content:'Saving the page',checkin:'Checking in the page'};
const WAITING='Waiting for SharePoint to release the page';
// Reasons a site cannot take a draft. They are noted on the remembered site
// until the user visits it again; a sign-in or a passing failure is not.
const LASTING=new Set(['no-site','no-pages','no-permission','no-drafts']);
// Pages a send found gone or unfit, which their site's list forgets.
const FORGOTTEN=new Set(['page-missing','page-unsupported','page-home']);
const decodedPath=pathname=>{try{return pathname.split('/').map(decodeURIComponent).join('/');}catch{return null;}};
const pageAddress=(siteUrl,path)=>`${new URL(siteUrl).origin}${path.split('/').map(encodeURIComponent).join('/')}`;
// Whether a tab shows the page at `url` (whatever its query), and whether in SharePoint's editor, which adds Mode=Edit to the address.
function shows(tabUrl,url){
  let tab;try{tab=new URL(tabUrl);}catch{return null;}
  const a=decodedPath(tab.pathname),b=decodedPath(url.pathname);
  if(tab.origin!==url.origin||a===null||b===null||a.toLowerCase()!==b.toLowerCase())return null;
  return {editing:[...tab.searchParams].some(([key,value])=>key.toLowerCase()==='mode'&&value.toLowerCase()==='edit')};
}
const doneMessage=(page,title)=>!page?`Draft created in ${title}`:page.mode==='add'?`Added to “${page.title}”`:page.mode==='update'?`Updated “${page.title}”`:`Replaced “${page.title}”`;
const UNLINKED='This Confluence page has not been sent to that page from this browser, so there is nothing to update. Choose the page under Send to instead.';
// Without links, as in a background that does not keep them, nothing is remembered and nothing can be updated.
const NO_LINKS={list:async()=>[],sent:async()=>null,widen:async()=>null,remove:async()=>null,removePage:async()=>null};

export function createJobs({chromeApi=globalThis.chrome,sites,links=NO_LINKS,store=createTransferStore({session:chromeApi?.storage?.session}),loadTimeoutMs=60_000,importTimeoutMs=15*60_000,
  captureTimeoutMs=30*60_000,injectTimeoutMs=20_000,pollMs=500,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  const session=chromeApi.storage.session;
  const noted=value=>Promise.resolve().then(()=>value?chromeApi.storage.local.set({[FLIGHT]:value}):chromeApi.storage.local.remove(FLIGHT)).catch(()=>{});
  // Tabs a send opened and is still using; their pages' site visits are not recorded.
  const sendingTabs=new Set();
  let active=null;
  const publish=job=>session.set({[JOB]:{...job,updatedAt:Date.now()}});
  const current=async()=>(await session.get(JOB))[JOB]??null;
  // Every request to a tab is short. Capture and import run in their tabs on
  // their own and are followed through `status`, because Chrome stops an
  // extension service worker whose single request lasts more than five minutes.
  async function message(tabId,action,payload={}){
    let response;
    try{response=await chromeApi.tabs.sendMessage(tabId,{channel:CHANNEL,action,payload});}
    catch{
      // Chrome's own refusal: the tab is gone, or its page was reloaded and the script with it.
      const open=await Promise.resolve().then(()=>chromeApi.tabs.get(tabId)).then(Boolean,()=>false);
      throw open?fail('page-unavailable','The page did not respond. Reload it, then try again.'):fail('tab-closed','The tab it was using was closed.');
    }
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
        await publish({...last,status:'failed',error:{code:typeof error?.code==='string'?error.code:'operation-failed',message:error?.message||'The job stopped.',
          ...(error?.draftMayExist?{draftMayExist:true}:{}),...(error?.pageMayHaveChanged?{pageMayHaveChanged:true}:{})},
          // A tab that was closed is not offered to show.
          ...(error?.review?{review:error.review}:{}),...(error?.code==='tab-closed'?{tabId:null}:Number.isInteger(error?.tabId)?{tabId:error.tabId}:{})}).catch(()=>{});
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
  // What the site's tab reports of the import, as the popup shows it: pictures are counted while they upload; the
  // other steps have no counts.
  const progress=update=>status=>{
    const step=status.step??'';
    const message=step==='waiting'?WAITING:status.stage==='creating'&&Object.hasOwn(CREATING,step)?CREATING[step]:status.stage==='writing'&&Object.hasOwn(WRITING,step)?WRITING[step]:
      Object.hasOwn(IMPORTING,status.stage??'')?IMPORTING[status.stage]:null;
    return message?update({phase:status.stage,message,...status.stage==='uploading'?{completed:status.completedImages??0,total:status.totalImages??0}:{completed:0,total:0}}):null;
  };
  // The tab's own status decides the import's outcome, so a lost answer changes nothing. The import is given up
  // only when it has made no progress for the timeout: a long or throttled one that keeps reporting is followed.
  async function settle(tabId,attemptId,onStatus=()=>{}){
    let deadline=Date.now()+importTimeoutMs,seen='';
    for(;;){
      let status;
      try{status=await message(tabId,'status');}
      catch(error){
        // The popup adds what to review after a send; the tab is not asked to be reloaded.
        if(error?.code==='page-unavailable')error.message='The site’s tab stopped answering during the send.';
        throw error;
      }
      if(status.attemptId!==attemptId)throw fail('attempt-unavailable','The send is no longer running in its SharePoint tab.');
      if(status.stage==='complete')return status.result;
      // What the tab reports about its own failure, such as whether the page is unchanged, is taken as it says.
      if(status.stage==='failed')throw Object.assign(new Error(status.error?.message??'The send stopped.'),status.error,{reported:true});
      const progress=JSON.stringify([status.stage,status.step,status.completedImages,status.totalImages]);
      if(progress!==seen){seen=progress;deadline=Date.now()+importTimeoutMs;}
      if(Date.now()>deadline)throw fail('attempt-unavailable','The send did not finish in time.');
      await onStatus(status);
      await sleep(pollMs);
    }
  }
  // The page in front, as SharePoint shows its author a draft: a tab already showing it for reading is reloaded
  // (never one in the editor) and the send's own tab closed; else the send's tab moves to it.
  async function show(url,tab){
    const target=new URL(url);
    try{
      const open=(await chromeApi.tabs.query({}).catch(()=>[])).filter(other=>other.id!==tab?.id&&shows(other.url,target)?.editing===false);
      const reuse=open.find(other=>other.active&&other.windowId===tab?.windowId)??[...open].sort((a,b)=>(b.lastAccessed??0)-(a.lastAccessed??0))[0];
      if(reuse){
        await chromeApi.tabs.reload(reuse.id);
        await chromeApi.tabs.update(reuse.id,{active:true});
        await chromeApi.windows.update(reuse.windowId,{focused:true});
        if(tab)await Promise.resolve(chromeApi.tabs.remove(tab.id)).catch(()=>{});
        return reuse.id;
      }
      if(tab){await chromeApi.tabs.update(tab.id,{url,active:true});await chromeApi.windows.update(tab.windowId,{focused:true});return tab.id;}
    }catch{/* The page stays one click away in the popup. */}
    return null;
  }
  // What a finished send leaves remembered: the page, under its site with the title it has now, and which Confluence
  // page went to it with what the send wrote there, for a later update. Bookkeeping must not turn a finished send into
  // a failure, and doing it twice changes nothing, so a restart can repeat it.
  async function remember(result,attempt,title,url){
    const path=decodedPath(new URL(url).pathname),pageTitle=typeof result.title==='string'?result.title:'';
    await Promise.resolve().then(()=>sites.visited(attempt.siteUrl,title,{path,title:pageTitle})).catch(()=>{});
    if(attempt.source)await Promise.resolve().then(()=>links.sent({source:attempt.source,siteUrl:attempt.siteUrl,path,title:pageTitle,part:Array.isArray(result.part)?result.part:[],
      mode:attempt.page?.mode??'draft',...(attempt.page?.mode==='update'?{titled:attempt.page.titled,headed:attempt.page.headed}:{})})).catch(()=>{});
  }
  async function complete(result,attempt,title,tab,finish){
    const url=confirmedPageUrl(result,attempt);
    await store.completeAttempt(result);
    await noted(null);
    await remember(result,attempt,title,url);
    const shown=await show(url,tab);
    // What the site refused, and the send therefore left out, goes with the result (plain sentences only).
    const notes=(Array.isArray(result?.notes)?result.notes:[]).filter(note=>typeof note==='string'&&note&&note.length<=400&&!/[\u0000-\u001f\u007f]/.test(note)).slice(0,5);
    const page=attempt.page??null;
    await finish({status:'done',phase:'done',message:doneMessage(page,title),siteTitle:title,...(shown!==null?{tabId:shown}:{}),
      result:{pageUrl:url,siteUrl:attempt.siteUrl,siteTitle:title,...(page?{page:{title:page.title,mode:page.mode}}:{}),...(notes.length?{notes}:{})}});
  }
  // A failure after the import started: when the site's tab said the page (or, for a draft, the site) is as it
  // was, the capture can be sent again and nothing needs review; otherwise the page, or Site Pages, is to review.
  async function stopped(error,attempt,update){
    const page=attempt.page??null,key=attempt.siteUrl;
    await noted(null);
    // A page renamed or moved in SharePoint still holds what was sent: a page made from the Confluence page is overwritten
    // there; one the part was added to keeps its own content, so the earlier copy is removed by hand first.
    if(error?.code==='page-missing'&&page?.mode==='update')error.message=`${error.message} A page that was only renamed or moved still has the earlier copy: ${page.titled===true?'choose Overwrite there, not Add to bottom.':'remove that copy in SharePoint first, then Add to bottom.'}`;
    if(error?.reported&&(page?error.pageUnchanged===true:error.draftMayExist!==true)){
      await store.releaseAttempt(attempt.attemptId);
      // A page that is gone leaves its site's list with its links; an update whose part is gone forgets that link.
      if(page&&FORGOTTEN.has(error.code))await Promise.allSettled([Promise.resolve().then(()=>sites.removePage(key,page.path)),Promise.resolve().then(()=>links.removePage(key,page.path))]);
      if(page&&error.code==='part-missing'&&attempt.source)await Promise.resolve().then(()=>links.remove(attempt.source,key,page.path)).catch(()=>{});
      await update({review:null});
      return error;
    }
    // A page send that may have written the page: its link names what it may have written too, so a later update
    // finds the part whichever the page holds.
    if(page&&attempt.source&&Array.isArray(error?.part)&&error.part.length)await Promise.resolve().then(()=>links.widen({source:attempt.source,siteUrl:key,path:page.path,title:page.title,
      part:error.part,mode:page.mode,...(page.mode==='update'?{titled:page.titled,headed:page.headed}:{})})).catch(()=>{});
    // A draft the site's tab named (SharePoint made the page before the stop) is linked as well as the library.
    const draft=!page&&typeof error?.serverRelativeUrl==='string'?pageKey(key,error.serverRelativeUrl):null;
    const review=page?{pageUrl:pageAddress(key,page.path)}:{sitePagesUrl:`${key}/SitePages`,...(draft?{pageUrl:pageAddress(key,draft)}:{})};
    return Object.assign(error,{review,...(page?{pageMayHaveChanged:true}:{draftMayExist:true})});
  }
  // Captures the Confluence page in `tabId` and keeps it, with its pictures, to be sent; `update` publishes the progress.
  async function captured(tabId,update){
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
    // The capture remembers its page, so the popup can tell it from other pages once it is sent, and a send can
    // remember which Confluence page it came from.
    const page=typeof context.pageId==='string'&&/^\d{1,20}$/.test(context.pageId)?{origin:new URL(context.pageUrl).origin,pageId:context.pageId}:null;
    await store.save({...model,sourcePage:page},files);
    return {...model,sourcePage:page};
  }
  function capture(tabId){
    if(!Number.isInteger(tabId))throw fail('invalid-tab','Open the Confluence page to capture.');
    return start({kind:'capture',tabId,phase:'capturing',message:'Capturing the page',completed:0,total:0},async(update,finish)=>{
      const model=await captured(tabId,update);
      await finish({status:'done',phase:'done',message:'Captured',title:model.title,completed:model.assets.length,total:model.assets.length});
    });
  }
  function send(siteUrl,windowId){return transfer(siteUrl,null,windowId);}
  /**
   * Sends the capture into a page remembered under the site: 'add' puts it below the page's content, 'overwrite' in
   * place of it, and 'update' in place of what an earlier send of the same Confluence page wrote there.
   */
  function sendToPage(siteUrl,pagePath,mode,windowId){
    if(!['add','overwrite','update'].includes(mode))throw fail('invalid-destination','Choose Add to bottom, Overwrite or Update.');
    const path=pageKey(siteUrl,pagePath);
    if(!path)throw fail('invalid-destination','Choose a page of the site to send the page to.');
    return transfer(siteUrl,{path,mode},windowId);
  }
  /**
   * Captures the Confluence page in `tabId` and puts it into a page it was sent to before, in place of what that send
   * wrote there; a page made from it gets its title, byline and date again too.
   */
  function updatePage(tabId,siteUrl,pagePath,windowId){
    if(!Number.isInteger(tabId))throw fail('invalid-tab','Open the Confluence page to update from.');
    const key=siteKey(siteUrl),path=key?pageKey(key,pagePath):null;
    if(!path)throw fail('invalid-destination','Choose a page this Confluence page was sent to.');
    return start({kind:'send',siteUrl:key,page:{path,mode:'update',title:''},phase:'capturing',message:'Capturing the page',completed:0,total:0},async(update,finish)=>{
      // The update replaces the capture, so the earlier one goes first: a capture of another page, already sent, would
      // otherwise have the popup put this job away with it, whatever stops it.
      await store.clear();
      const sent=(await links.list()).filter(link=>link.siteUrl===key&&link.path.toLowerCase()===path.toLowerCase());
      if(!sent.length)throw fail('link-unknown',UNLINKED);
      await update({page:{path:sent[0].path,mode:'update',title:sent[0].title}});
      // What would stop the send is checked before the capture, which can take a while.
      await reachable(key,(await sites.list()).find(site=>site.url===key)?.title||key,sent[0].path);
      // The page in the tab is captured now; it must be the Confluence page that was sent.
      const model=await captured(tabId,update);
      const link=sent.find(entry=>entry.source.origin===model.sourcePage?.origin&&entry.source.pageId===model.sourcePage?.pageId);
      if(!link)throw fail('link-unknown',UNLINKED);
      await sending(key,{path:link.path,mode:'update',title:link.title,part:{controls:link.part,titled:link.titled,headed:link.headed}},windowId,update,finish);
    });
  }
  function transfer(siteUrl,target,windowId){
    const key=siteKey(siteUrl);
    if(!key)throw fail('invalid-destination','Choose a SharePoint site to send the page to.');
    return start({kind:'send',siteUrl:key,...(target?{page:{...target,title:''}}:{}),phase:'opening',message:'Opening the site',completed:0,total:0},(update,finish)=>sending(key,target,windowId,update,finish));
  }
  // Whether the site's tab can be reached, and the page (by its path) is not held by SharePoint's editor in this browser.
  async function reachable(key,name,path){
    // Chrome holds scripts in a site whose access the user withheld from the extension; ask for access rather than wait.
    if(!await Promise.resolve(chromeApi.permissions?.contains({origins:[`${new URL(key).origin}/*`]})).catch(()=>false))
      throw fail('site-access-needed',`Chrome’s site access for this extension does not include ${name}. Allow access, then send again.`);
    // A page open in SharePoint's editor in this browser: the editor holds the page, and is never moved or reloaded from here.
    if(path){
      const address=new URL(pageAddress(key,path));
      const editor=(await Promise.resolve(chromeApi.tabs.query({})).catch(()=>[])).find(tab=>shows(tab.url,address)?.editing);
      if(editor)throw Object.assign(fail('page-in-editor','This page is open in SharePoint’s editor in another tab. Close that tab, then send again.'),{tabId:editor.id});
    }
  }
  // Sends the capture to the site `key`: a new draft, or into the page `target` names.
  async function sending(key,target,windowId,update,finish){
    const record=await store.load();
    if(!record?.model)throw fail('incomplete-capture','Capture a Confluence page first.');
    if(record.attempt)throw fail('import-already-attempted','This capture was already sent. Capture the page again to send it once more.');
    const model=record.model,known=(await sites.list()).find(site=>site.url===key),name=known?.title||key;
    // No second copy by accident: a Confluence page already on this site is updated there, not made into another
    // draft, and a page that already has it is updated, not added to again. (Sending it into another page of the
    // site is left to the user, whom the popup tells.)
    const sentHere=model.sourcePage?(await links.list()).filter(link=>link.siteUrl===key&&link.source.origin===model.sourcePage.origin&&link.source.pageId===model.sourcePage.pageId):[];
    const holding=target&&sentHere.find(link=>link.path.toLowerCase()===target.path.toLowerCase());
    if(!target&&sentHere.length)throw fail('already-sent',`This Confluence page is already in “${sentHere[0].title||'a page'}” on this site. Update it there instead.`);
    if(target?.mode==='add'&&holding)throw fail('already-on-page','This page already has this Confluence page’s content. Update it instead of adding it again.');
    // An update chosen under Send to replaces what the link says this Confluence page wrote on the page.
    if(target?.mode==='update'&&!target.part){
      if(!holding)throw fail('link-unknown',UNLINKED);
      target={...target,title:holding.title,part:{controls:holding.part,titled:holding.titled,headed:holding.headed}};
    }
    let page=null;
    if(target){
      // A page is chosen from its site's list; an update goes to the page its link names.
      const remembered=(known?.pages??[]).find(entry=>entry.path.toLowerCase()===target.path.toLowerCase());
      if(!remembered&&target.mode!=='update')throw fail('page-unknown','Choose a page from the list under its site.');
      // An update carries what its link says of the part: whether the page takes its title from the Confluence page, and whether the part starts with a heading.
      page={path:remembered?.path??target.path,mode:target.mode,title:remembered?.title||target.title||'',...(target.part?{titled:target.part.titled,headed:target.part.headed}:{})};
      await update({page});
    }
    await reachable(key,name,page?.path);
    await Promise.resolve().then(()=>sites.used(key)).catch(()=>{/* Only the order of the sites. */});
    await update({phase:'opening',siteTitle:name,message:`Opening ${name}`,completed:0,total:0});
    const tab=await chromeApi.tabs.create({url:`${key}/SitePages`,active:false,...(Number.isInteger(windowId)?{windowId}:{})});
    sendingTabs.add(tab.id);
    // The send runs in this background tab for minutes; Chrome's memory saver must not discard it meanwhile.
    await Promise.resolve().then(()=>chromeApi.tabs.update(tab.id,{autoDiscardable:false})).catch(()=>{});
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
      const attempt={attemptId:globalThis.crypto.randomUUID(),sourceHash:model.sourceHash,siteUrl:key,tabId:tab.id,...(page?{page}:{}),...(model.sourcePage?{source:model.sourcePage}:{})};
      // The job names its attempt before claiming it, so after a restart it is never taken for an earlier send's.
      await update({attemptId:attempt.attemptId});
      await store.claimAttempt(attempt);
      await noted({attemptId:attempt.attemptId,siteUrl:key,...(page?{page:{path:page.path,mode:page.mode,title:page.title}}:{}),startedAt:Date.now()});
      await update({phase:'checking',message:IMPORTING.checking,completed:0,total:0});
      try{await message(tab.id,'import',{model,attemptId:attempt.attemptId,siteUrl:key,detach:true,...(page?{page:{path:page.path,mode:page.mode,...(target.part?{part:target.part}:{})}}:{})});}
      catch(error){
        // Refused before it started, so nothing was written: the capture can be sent again.
        if(error?.refused){await store.releaseAttempt(attempt.attemptId);throw error;}
        // No answer: the import may have started, so its tab's status decides.
      }
      await update({review:page?{pageUrl:pageAddress(key,page.path)}:{sitePagesUrl:`${key}/SitePages`}});
      let result;
      try{result=await settle(tab.id,attempt.attemptId,progress(update));}
      catch(error){throw await stopped(error,attempt,update);}
      await complete(result,attempt,title,tab,finish);
    }catch(error){
      if(error&&typeof error==='object'&&!Number.isInteger(error.tabId))error.tabId=tab.id;
      throw error;
    }finally{
      sendingTabs.delete(tab.id);
      // Whatever the outcome, the job record now carries it, so the in-flight note has served; the tab is the user's again.
      await noted(null);
      await Promise.resolve().then(()=>chromeApi.tabs.update(tab.id,{autoDiscardable:true})).catch(()=>{});
    }
  }
  async function state(){
    let record=null;
    try{record=await store.load();}catch{/* Shown as nothing captured. */}
    const model=record?.model,attempt=record?.attempt;
    let pageUrl=null;
    if(attempt?.status==='complete')try{pageUrl=confirmedPageUrl(attempt.result,attempt);}catch{/* Not shown. */}
    return {job:await current(),running:Boolean(active),
      // What capture could not copy is kept apart from its layout notes, for the popup to show plainly.
      capture:model?{title:model.title,stats:captureStats(model),warnings:(model.warnings??[]).filter(warning=>!warning.lost).map(warning=>warning.message??warning.code),
        losses:(model.warnings??[]).filter(warning=>warning.lost).map(warning=>warning.message??warning.code),
        attempt:attempt?{status:attempt.status,siteUrl:attempt.siteUrl,pageUrl,page:attempt.page?{title:attempt.page.title,mode:attempt.page.mode}:null}:null,page:model.sourcePage??null}:null};
  }
  async function clear(){
    if(active)throw fail('job-busy','Wait for the current capture or send to finish.');
    await store.clear();await session.remove(JOB);await noted(null);
  }
  async function showTab(tabId){
    let tab;
    try{tab=await chromeApi.tabs.update(tabId,{active:true});}catch{throw fail('tab-closed','That tab was closed.');}
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
    if(active)return;
    let record=null;
    try{record=await store.load();}catch{/* Nothing to follow. */}
    // A job may have started while the record was read.
    if(active)return;
    // Chrome clears session storage (the job, and the session the capture record belongs to) when the extension is
    // updated or reloaded, so a send that was running then has no record left but its note in local storage.
    if(!job){
      let left=null;try{left=(await chromeApi.storage.local.get(FLIGHT))[FLIGHT];}catch{/* No note. */}
      if(left&&typeof left==='object'&&siteKey(left.siteUrl)===left.siteUrl){
        const page=left.page&&typeof left.page==='object'&&pageKey(left.siteUrl,left.page.path)?{path:pageKey(left.siteUrl,left.page.path),mode:left.page.mode,title:typeof left.page.title==='string'?left.page.title:''}:null;
        await publish({kind:'send',status:'failed',phase:'checking',siteUrl:left.siteUrl,...(page?{page}:{}),
          review:page?{pageUrl:pageAddress(left.siteUrl,page.path)}:{sitePagesUrl:`${left.siteUrl}/SitePages`},
          error:{code:'interrupted',message:page?'The extension was updated or restarted while the page was being written.':'The extension was updated or restarted while the draft was being created.',
            ...(page?{pageMayHaveChanged:true}:{draftMayExist:true})}});
        await noted(null);
      }
      return;
    }
    if(job.status!=='running')return;
    // Only the attempt this job claimed is its own: one from an earlier send stays that send's.
    const attempt=record?.attempt?.attemptId&&record.attempt.attemptId===job.attemptId?record.attempt:null,title=job.siteTitle||attempt?.siteUrl;
    if(job.kind==='send'&&attempt?.status==='complete'){
      // The send finished before the restart; only its report, and perhaps its bookkeeping, was lost.
      let url=null;try{url=confirmedPageUrl(attempt.result,attempt);}catch{/* Reported as interrupted below. */}
      if(url)await remember(attempt.result,attempt,title,url);
      if(url){await publish({...job,status:'done',phase:'done',message:doneMessage(attempt.page??null,title),
        result:{pageUrl:url,siteUrl:attempt.siteUrl,siteTitle:title,...(attempt.page?{page:{title:attempt.page.title,mode:attempt.page.mode}}:{})}});return;}
    }
    if(job.kind==='send'&&attempt?.status==='started'&&Number.isInteger(attempt.tabId)){
      const review=attempt.page?{pageUrl:pageAddress(attempt.siteUrl,attempt.page.path)}:{sitePagesUrl:`${attempt.siteUrl}/SitePages`};
      return start({...job,tabId:attempt.tabId,review},async(update,finish)=>{
        let result;
        try{result=await settle(attempt.tabId,attempt.attemptId,progress(update));}catch(error){throw await stopped(error,attempt,update);}
        await complete(result,attempt,title,await chromeApi.tabs.get(attempt.tabId).catch(()=>null),finish);
      });
    }
    await publish({...job,status:'failed',error:{code:'interrupted',message:job.kind==='capture'?'The extension restarted during the capture. Capture the page again.':
      job.page?.mode==='update'?'The extension restarted before the page was updated. Update it again.':job.page?'The extension restarted before the page was written. Send again.':'The extension restarted before the draft was started. Send again.'}});
  }
  return {state,inspect,capture,send,sendToPage,updatePage,clear,showTab,recover,busyTab:tabId=>sendingTabs.has(tabId)};
}
