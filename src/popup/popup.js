// The toolbar popup: what the current tab shows, the capture, the remembered
// sites and the running job. The background does the work; the popup sends
// commands and reads the state again whenever it changes.
const CHANNEL='c2s-popup';
const STOPPED={capture:'Capture stopped',send:'Draft not created'};
// Problems where the site's own tab helps: signing in, a slow site, or a draft that may need review.
const TAB_HELP=new Set(['sign-in-needed','site-page-missing','site-load-timeout','site-unsuitable','site-changed','site-unreachable']);
const address=url=>url.replace(/^https:\/\//,'');
const originOf=url=>{try{return new URL(url).origin;}catch{return null;}};

export function createPopup({document=globalThis.document,chromeApi=globalThis.chrome,location=globalThis.location}={}){
  const el=id=>document.getElementById(id);
  const state={tab:null,context:null,data:null,chosen:null,view:'main',access:false,allAccess:true,problem:null};
  let destroyed=false;
  async function call(action,payload={}){
    const response=await chromeApi.runtime.sendMessage({channel:CHANNEL,action,payload});
    if(response?.ok!==true)throw Object.assign(new Error(response?.error?.message??'The extension did not answer. Close this popup and open it again.'),{code:response?.error?.code??'no-answer'});
    return response.result;
  }
  // The tab the popup opened over; the popup page opened in its own window names it in ?tab=.
  async function currentTab(){
    const named=new URLSearchParams(location.search).get('tab');
    if(named!==null&&/^\d{1,10}$/.test(named))return chromeApi.tabs.get(Number(named));
    const [tab]=await chromeApi.tabs.query({active:true,currentWindow:true});
    return tab??null;
  }
  const siteOrigins=()=>chromeApi.runtime?.getManifest?.()?.host_permissions??[];
  // Chrome hides a tab's address where the user withheld the extension's site access.
  async function accessWithheld(tab){
    if(!tab||tab.url)return false;
    try{return !(await chromeApi.permissions.contains({origins:siteOrigins()}));}catch{return false;}
  }
  // Whether the extension may reach every site it declares, which a send to a withheld site needs.
  async function allSitesAllowed(){
    try{return await chromeApi.permissions.contains({origins:siteOrigins()});}catch{return true;}
  }
  async function load(){state.data=await call('state');}
  async function refresh(){
    try{
      state.problem=null;
      state.tab=await currentTab();
      state.access=await accessWithheld(state.tab);
      state.allAccess=await allSitesAllowed();
      await load();
      // Only a Confluence page is read here; SharePoint sites are checked when a page is sent to them.
      let host='';try{host=new URL(state.tab?.url).hostname;}catch{/* Not a web page. */}
      state.context=!state.access&&/\.atlassian\.net$/i.test(host)?await call('inspect',{tabId:state.tab.id}).catch(()=>null):null;
    }catch(error){state.problem=error.message;}
    render();
  }
  async function act(work){
    state.problem=null;
    try{await work();await load();}catch(error){state.problem=error.message;}
    render();
  }
  function siteText(site){
    const text=document.createElement('span');text.className='site-text';
    const name=document.createElement('span');name.className='site-title';name.textContent=site.title||address(site.url);
    const where=document.createElement('span');where.className='site-address';where.textContent=address(site.url);
    text.append(name,where);
    if(site.problem){const problem=document.createElement('span');problem.className='site-problem';problem.textContent=site.problem;text.append(problem);}
    return text;
  }
  function renderDestinations(sites,capture,running){
    el('send').hidden=!capture||Boolean(capture.attempt);
    if(!sites.some(site=>site.url===state.chosen))state.chosen=(sites.find(site=>!site.problem)??sites[0])?.url??null;
    el('destinations').replaceChildren(...sites.map(site=>{
      const choice=document.createElement('label');choice.className='destination';if(site.problem)choice.dataset.problem='true';
      const input=document.createElement('input');input.type='radio';input.name='destination';input.value=site.url;input.checked=site.url===state.chosen;input.disabled=running;
      input.addEventListener('change',()=>{state.chosen=site.url;render();});
      choice.append(input,siteText(site));return choice;
    }));
    el('no-sites').hidden=sites.length>0;
    const chosen=sites.find(site=>site.url===state.chosen);
    el('send-button').textContent=chosen?`Create draft in ${chosen.title||address(chosen.url)}`:'Create draft';
    el('send-button').disabled=!chosen||running;
  }
  function renderStatus(job,sent){
    let tone='idle',title='',detail='',showTab=false,draft=null,review=null,busy=false,total=0,completed=0;
    if(state.problem){tone='error';title='Something went wrong';detail=state.problem;}
    else if(job?.status==='running'){tone='neutral';title=job.message||'Working';detail='You can close this popup; it keeps going.';busy=true;total=job.total??0;completed=job.completed??0;}
    else if(job?.status==='failed'){
      // After the import started a draft may exist, so the page must not simply be sent again.
      const mayExist=job.kind==='send'&&(job.error?.draftMayExist===true||Boolean(job.review));
      tone='error';title=mayExist?'A draft may already exist':STOPPED[job.kind]??'Stopped';
      detail=mayExist?`${job.error?.message??''} Review Site Pages before you send this page again.`.trim():job.error?.message??'';
      showTab=Number.isInteger(job.tabId)&&(TAB_HELP.has(job.error?.code)||Boolean(job.review));review=job.review?.sitePagesUrl??null;
    }
    else if(job?.status==='done'&&job.kind==='send'&&job.result){tone='success';title=job.message;detail=[...(job.result.notes??[]),'The draft is unpublished. Review it, then publish it in SharePoint.'].join(' ');draft=job.result.editUrl;}
    else if(sent){tone='success';title='Sent to SharePoint';detail='The draft is unpublished. Capture the page again to send it somewhere else.';draft=sent.editUrl;}
    el('status').dataset.tone=tone;
    el('status-title').textContent=title;
    el('status-detail').textContent=detail;el('status-detail').hidden=!detail;
    // Counted work fills the bar; a step without counts leaves it indeterminate, moving until the step is done.
    const progress=el('progress');progress.hidden=!busy;
    if(total){progress.max=total;progress.value=Math.min(completed,total);}else progress.removeAttribute('value');
    el('progress-counts').textContent=total?`${Math.min(completed,total)} of ${total} pictures`:'';el('progress-counts').hidden=!total;
    el('show-tab').hidden=!showTab;
    el('open-draft').hidden=!draft;if(draft)el('open-draft').href=draft;else el('open-draft').removeAttribute('href');
    el('site-pages').hidden=!review;if(review)el('site-pages').href=review;else el('site-pages').removeAttribute('href');
  }
  function renderSites(sites){
    el('site-list').replaceChildren(...sites.map(site=>{
      const item=document.createElement('li');item.className='site';
      const pin=document.createElement('button');pin.type='button';pin.className='text-button';pin.textContent=site.pinned?'Unpin':'Pin';
      pin.addEventListener('click',()=>act(()=>call('pin',{url:site.url,pinned:!site.pinned})));
      const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='Remove';remove.setAttribute('aria-label',`Remove ${site.title||address(site.url)}`);
      remove.addEventListener('click',()=>act(()=>call('remove',{url:site.url})));
      item.append(siteText(site),pin,remove);return item;
    }));
    el('sites-empty').hidden=sites.length>0;el('forget').hidden=!sites.length;
  }
  function render(){
    if(destroyed)return;
    const {data,context}=state,sites=data?.sites??[],onConfluence=context?.kind==='confluence';
    const lastCapture=data?.capture??null,lastJob=data?.job??null,running=lastJob?.status==='running';
    // Whether this tab shows the captured page: by site and page id, or by title where the id is unknown.
    const samePage=Boolean(lastCapture&&onConfluence)&&(lastCapture.page?.pageId&&context.pageId
      ?lastCapture.page.pageId===context.pageId&&lastCapture.page.origin===originOf(context.pageUrl):lastCapture.title===context.title);
    // A capture already sent is finished: another Confluence page starts afresh, and the draft stays in view on its own page.
    const finished=lastCapture?.attempt?.status==='complete'&&onConfluence&&!samePage&&!running;
    const capture=finished?null:lastCapture,job=finished?null:lastJob;
    const sent=capture?.attempt?.status==='complete'?capture.attempt:null;
    // Without the background's state there is nothing to check; the status says why.
    const unanswered=!data&&Boolean(state.problem);
    // A send stopped for want of site access asks for it, until Chrome grants it.
    const accessNeeded=state.access||job?.status==='failed'&&job.error?.code==='site-access-needed'&&!state.allAccess;
    document.body.dataset.state=unanswered?'failed':!data?'loading':state.access?'access':running?'running':job?.status==='failed'?'failed':sent?'sent':capture?'captured':'idle';
    el('main-view').hidden=state.view!=='main';el('sites-view').hidden=state.view!=='sites';
    el('access').hidden=!accessNeeded;el('page').hidden=state.access||unanswered;
    // The captured page, or the Confluence page in this tab.
    el('page-step').textContent=capture?'Captured page':'Confluence page';
    el('page-title').textContent=capture?.title??(onConfluence?context.title:!data?'Checking this tab…':'Open a Confluence page to capture it');
    const note=!capture&&context?.kind==='unsupported'&&context.product==='confluence'?context.reason:'';
    el('page-note').textContent=note;el('page-note').hidden=!note;
    el('page-stats').textContent=capture?.stats??'';el('page-stats').hidden=!capture;
    const items=texts=>(texts??[]).map(text=>{const item=document.createElement('li');item.textContent=text;return item;});
    // What the capture did not copy is always in view; layout notes fold away.
    el('losses').replaceChildren(...items(capture?.losses));el('losses').hidden=!capture?.losses?.length;
    el('warnings').replaceChildren(...items(capture?.warnings));
    el('notes').hidden=!capture?.warnings?.length;
    const captureButton=el('capture');
    captureButton.hidden=!onConfluence;captureButton.disabled=running;
    captureButton.textContent=running&&job.kind==='capture'?'Capturing…':!capture?'Capture page':samePage?'Capture again':'Capture this page instead';
    captureButton.className=capture?'secondary-button':'primary-button';
    el('clear').hidden=!capture||running;
    renderDestinations(sites,capture,running);
    renderStatus(job,sent);
    renderSites(sites);
  }
  const on=(id,handler)=>el(id).addEventListener('click',handler);
  on('capture',()=>act(()=>call('capture',{tabId:state.tab.id})));
  on('send-button',()=>act(()=>call('send',{siteUrl:state.chosen,windowId:state.tab?.windowId??null})));
  on('clear',()=>act(()=>call('clear')));
  on('show-tab',()=>act(()=>call('show-tab',{tabId:state.data.job.tabId})));
  on('sites-link',()=>{state.view=state.view==='sites'?'main':'sites';render();});
  on('back',()=>{state.view='main';render();});
  on('forget',()=>act(()=>call('forget')));
  on('allow-access',()=>{
    // permissions.request needs this click, so it is called directly in the handler.
    chromeApi.permissions.request({origins:siteOrigins()}).then(granted=>{
      if(granted){void refresh();return;}
      state.problem="Allow site access for this extension in Chrome's extensions menu. If that option is unavailable, your organization manages it.";render();
    },error=>{state.problem=error?.message??'Chrome did not allow access.';render();});
  });
  const changed=(changes,area)=>{if(area==='session'&&changes.job||area==='local'&&changes.sites)void load().then(render,()=>{});};
  chromeApi.storage.onChanged.addListener(changed);
  function destroy(){destroyed=true;chromeApi.storage.onChanged.removeListener(changed);}
  document.defaultView?.addEventListener('pagehide',destroy);
  const ready=refresh();
  render();
  return {ready,refresh,destroy};
}

if(typeof document!=='undefined'&&globalThis.chrome?.runtime?.id&&!globalThis.__C2S_POPUP_MANUAL__){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>createPopup(),{once:true});else createPopup();
}
