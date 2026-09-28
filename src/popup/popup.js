// The toolbar popup: what the current tab shows, where its Confluence page was
// sent before, the capture, where to send it (the pinned sites and the sites open
// in a tab, with their open pages), and the running job. The background does the
// work; the popup sends commands and reads the state again whenever it changes.
const CHANNEL='c2s-popup';
const STOPPED={capture:'Capture stopped',send:'Draft not created'};
// Problems where a tab helps: signing in, a slow site, a draft that may need review, or the page's editor.
const TAB_HELP=new Set(['sign-in-needed','site-page-missing','site-load-timeout','site-unsuitable','site-changed','site-unreachable','page-in-editor']);
const address=url=>url.replace(/^https:\/\//,'');
const originOf=url=>{try{return new URL(url).origin;}catch{return null;}};
const quoted=title=>`“${title}”`;
// A page's name, and its file's name where another page of the site has the same title, as two drafts of one Confluence page do.
function pageName(document,page,pages){
  const title=document.createElement('span');title.className='page-title';title.textContent=page.title;
  if(pages.filter(other=>other.title===page.title).length<2)return [title];
  const file=document.createElement('span');file.className='page-file';file.textContent=page.path.slice(page.path.lastIndexOf('/')+1);
  return [title,file];
}
// A page's place as tabs and remembered pages are compared: origin and decoded path, in lower case.
function place(origin,path){try{return `${origin}${path.split('/').map(decodeURIComponent).join('/')}`.toLowerCase();}catch{return null;}}
// The remembered site a tab's address belongs to, the most specific first; the tenant root only outside /sites/ and /teams/.
function siteOfTab(sites,tabUrl){
  let url;try{url=new URL(tabUrl);}catch{return null;}
  const path=url.pathname.toLowerCase();
  return sites.filter(site=>{
    let at;try{at=new URL(site.url);}catch{return false;}
    const base=at.pathname.replace(/\/$/,'').toLowerCase();
    return at.origin===url.origin&&(base?path===base||path.startsWith(`${base}/`):!/^\/(?:sites|teams)\//.test(path));
  }).sort((a,b)=>b.url.length-a.url.length)[0]??null;
}

export function createPopup({document=globalThis.document,chromeApi=globalThis.chrome,location=globalThis.location}={}){
  const el=id=>document.getElementById(id);
  // `updateInstead`: the page Send to updates rather than make another draft; `addMode`: what the first page button does.
  // `problem` is what went wrong last, of kind 'command' (a refused command, replaced by the next job news), 'tab' (the
  // named tab is gone) or 'access' (site access refused); `closedTabs` are tabs a job named that turned out closed.
  const state={tab:null,context:null,data:null,open:[],sharePoint:true,chosen:null,page:null,tabSite:null,view:'main',access:false,allAccess:true,problem:null,problemKind:null,closedTabs:new Set(),updateInstead:null,addMode:'add'};
  let destroyed=false;
  async function call(action,payload={}){
    const response=await chromeApi.runtime.sendMessage({channel:CHANNEL,action,payload});
    if(response?.ok!==true)throw Object.assign(new Error(response?.error?.message??'The extension did not answer. Close this popup and open it again.'),{code:response?.error?.code??'no-answer'});
    return response.result;
  }
  // The tab named in ?tab=, when the popup page was opened in a window of its own; else the popup is over the active tab.
  const namedTab=(()=>{const named=new URLSearchParams(location.search).get('tab');return named!==null&&/^\d{1,10}$/.test(named)?Number(named):null;})();
  const TAB_GONE='The tab this window was opened for was closed. Close this window.';
  async function currentTab(){
    if(namedTab!==null){try{return await chromeApi.tabs.get(namedTab);}catch{throw Object.assign(new Error(TAB_GONE),{kind:'tab'});}}
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
  // The addresses of the SharePoint tabs open now: they decide which sites and pages Send to offers. Read each time
  // the popup reads its state, and never kept.
  async function openTabs(){
    try{return (await chromeApi.tabs.query({url:'https://*.sharepoint.com/*'})).map(tab=>tab.url).filter(url=>typeof url==='string');}catch{return [];}
  }
  // Whether the extension may reach SharePoint sites at all: withheld, no open site can be seen or remembered.
  async function sharePointAllowed(){
    try{return await chromeApi.permissions.contains({origins:['https://*.sharepoint.com/*']});}catch{return true;}
  }
  async function load(){const [data,open,sharePoint]=await Promise.all([call('state'),openTabs(),sharePointAllowed()]);state.data=data;state.open=open;state.sharePoint=sharePoint;}
  async function refresh(){
    try{
      state.problem=null;
      state.tab=await currentTab();
      state.access=await accessWithheld(state.tab);
      state.allAccess=await allSitesAllowed();
      await load();
      // Opened over a tab of a remembered site, the popup chooses that site.
      state.tabSite=siteOfTab(state.data?.sites??[],state.tab?.url)?.url??null;
      // Only a Confluence page is read here; SharePoint sites are checked when a page is sent to them.
      let host='';try{host=new URL(state.tab?.url).hostname;}catch{/* Not a web page. */}
      state.context=!state.access&&/\.atlassian\.net$/i.test(host)?await call('inspect',{tabId:state.tab.id}).catch(()=>null):null;
    }catch(error){state.problem=error.message;state.problemKind=error?.kind==='tab'?'tab':'command';}
    render();
  }
  async function act(work){
    // A closed named tab stays said whatever else is done; a command refused because a job is running (a second click)
    // is answered by that job's own progress.
    const tabGone=state.problemKind==='tab';
    if(!tabGone){state.problem=null;state.problemKind=null;}
    try{await work();await load();}catch(error){if(error?.code==='job-busy')await load().catch(()=>{});else if(!tabGone){state.problem=error.message;state.problemKind='command';}}
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
  // The SharePoint pages the Confluence page in the tab was sent to, each with the title it has in the site's list.
  function renderSent(links,sites,running){
    el('sent-to').hidden=!links.length;
    const rows=links.map(link=>{
      const site=sites.find(entry=>entry.url===link.siteUrl),known=site?.pages?.find(entry=>entry.path.toLowerCase()===link.path.toLowerCase());
      return {link,site,path:link.path,title:known?.title||link.title||link.path.slice(link.path.lastIndexOf('/')+1)};
    });
    el('sent-list').replaceChildren(...rows.map(({link,site,path,title},index)=>{
      const row=document.createElement('li');row.className='sent-row';
      const text=document.createElement('span');text.className='page-text';text.title=path;
      // Pages of one site that share a title, as pages made from one Confluence page do, show their file names too.
      const name=pageName(document,rows[index],rows.filter(other=>other.link.siteUrl===link.siteUrl));
      const where=document.createElement('span');where.className='site-address';where.textContent=site?.title||address(link.siteUrl);
      text.append(...name,where);
      const label=name.length>1?`Update ${title} (${name[1].textContent})`:`Update ${title}`;
      const update=document.createElement('button');update.type='button';update.className='secondary-button';update.textContent='Update';update.disabled=running||state.problemKind==='tab';update.setAttribute('aria-label',label);
      update.addEventListener('click',()=>act(()=>call('update-page',{tabId:state.tab.id,siteUrl:link.siteUrl,pagePath:link.path,windowId:state.tab?.windowId??null})));
      row.append(text,update);return row;
    }));
  }
  // A link's page title, as the site's list has it now.
  function linkTitle(link,sites){
    const known=sites.find(site=>site.url===link.siteUrl)?.pages?.find(entry=>entry.path.toLowerCase()===link.path.toLowerCase());
    return known?.title||link.title||link.path.slice(link.path.lastIndexOf('/')+1);
  }
  function renderDestinations(sites,capture,running,updating){
    // An update sends its capture straight to its page, so Send to is not offered meanwhile; nor is a send while
    // the extension cannot read the tab it is over.
    el('send').hidden=!capture||Boolean(capture.attempt)||updating||state.access||state.problemKind==='tab';
    if(!sites.some(site=>site.url===state.chosen)){
      state.chosen=(sites.find(site=>site.url===state.tabSite)??sites.find(site=>!site.problem)??sites[0])?.url??null;state.page=null;
    }
    const chosen=sites.find(site=>site.url===state.chosen)??null;
    const page=chosen?.pages?.find(entry=>entry.path===state.page)??null;
    if(!page)state.page=null;
    el('destinations').replaceChildren(...sites.flatMap(site=>{
      const choice=document.createElement('label');choice.className='destination';if(site.problem)choice.dataset.problem='true';
      const input=document.createElement('input');input.type='radio';input.name='destination';input.value=site.url;input.checked=site.url===state.chosen;input.disabled=running;
      input.addEventListener('change',()=>{state.chosen=site.url;state.page=null;render();});
      choice.append(input,siteText(site));
      if(site!==chosen||!site.pages?.length)return [choice];
      // The chosen site's pages, under it.
      const pages=document.createElement('div');pages.className='pages';pages.setAttribute('role','radiogroup');pages.setAttribute('aria-label',`Pages in ${site.title||address(site.url)}`);
      pages.append(...site.pages.map(entry=>{
        const option=document.createElement('label');option.className='destination page-option';option.title=entry.path;
        const radio=document.createElement('input');radio.type='radio';radio.name='page';radio.value=entry.path;radio.checked=entry.path===state.page;radio.disabled=running;
        radio.addEventListener('change',()=>{state.page=entry.path;render();});
        const text=document.createElement('span');text.className='page-text';text.append(...pageName(document,entry,site.pages));
        option.append(radio,text);return option;
      }));
      return [choice,pages];
    }));
    el('no-sites').hidden=sites.length>0;
    el('draft-choice').hidden=Boolean(page);el('page-choice').hidden=!page;
    // Where the captured Confluence page already is on the chosen site (newest first): a new draft there would be a
    // second copy, so the page it is on is updated instead, and a page that has it is updated rather than added to.
    const source=capture?.page,all=state.data?.links??[];
    const here=source&&chosen?all.filter(link=>link.siteUrl===chosen.url&&link.source?.origin===source.origin&&link.source?.pageId===source.pageId):[];
    const holding=page?here.find(link=>link.path.toLowerCase()===page.path.toLowerCase()):null,elsewhere=page&&!holding?here[0]:null;
    state.updateInstead=here[0]?.path??null;state.addMode=holding?'update':'add';
    const already=here.length?linkTitle(here[0],state.data?.sites??[]):'';
    el('send-button').textContent=here.length?`Update ${quoted(already)}`:chosen?`Create draft in ${chosen.title||address(chosen.url)}`:'Create draft';
    el('draft-note').textContent=here.length?`This Confluence page is already in ${quoted(already)}. Update replaces what it sent there with its current content, as an unpublished draft.`:'Creates an unpublished draft. You publish it in SharePoint.';
    el('send-button').disabled=!chosen||running;
    el('page-question').textContent=page?`Send to ${quoted(page.title)}?`:'';
    el('add-button').textContent=holding?'Update':'Add to bottom';
    // The note under the buttons explains the buttons shown.
    el('page-modes').textContent=holding?'Update replaces what this Confluence page sent here with its current content; the rest of the page stays. Overwrite replaces the page’s content, title, byline and date. Either way the change is an unpublished draft, and the earlier version stays in the page’s history.'
      :'Add to bottom keeps the page and adds this below it. Overwrite replaces its content, title, byline and date; the earlier version stays in the page’s history. Either way the change is an unpublished draft.';
    el('page-warning').textContent=elsewhere?`This Confluence page is already in ${quoted(linkTitle(elsewhere,state.data?.sites??[]))}. Sending it here makes a second copy.`:'';
    el('page-warning').hidden=!elsewhere;
    for(const id of ['add-button','overwrite-button'])el(id).disabled=running;
  }
  function renderStatus(job,sent){
    let tone='idle',title='',detail='',showTab=false,open=null,openLabel='Open draft',review=null,reviewLabel='Review Site Pages',busy=false,total=0,completed=0;
    const page=job?.page??null;
    if(state.problem){tone='error';title='Something went wrong';detail=state.problem;}
    else if(job?.status==='running'){tone='neutral';title=job.message||'Working';detail='You can close this popup; it keeps going.';busy=true;total=job.total??0;completed=job.completed??0;}
    else if(job?.status==='failed'&&page){
      // After a page send started, the page may have changed unless the site's tab said it had not.
      const mayHaveChanged=job.error?.pageMayHaveChanged===true||Boolean(job.review);
      tone='error';title=mayHaveChanged?'The page may have changed':page.mode!=='update'?page.title?`Not sent to ${quoted(page.title)}`:'Not sent to the page':page.title?`${quoted(page.title)} was not updated`:'The page was not updated';
      detail=mayHaveChanged?`${job.error?.message??''} Review the page before you send again.`.trim():job.error?.message??'';
      showTab=Number.isInteger(job.tabId)&&!state.closedTabs.has(job.tabId)&&(TAB_HELP.has(job.error?.code)||mayHaveChanged);review=job.review?.pageUrl??null;reviewLabel='Review the page';
    }
    else if(job?.status==='failed'){
      // After the import started a draft may exist, so the page must not simply be sent again.
      const mayExist=job.kind==='send'&&(job.error?.draftMayExist===true||Boolean(job.review));
      tone='error';title=mayExist?'A draft may already exist':STOPPED[job.kind]??'Stopped';
      detail=mayExist?`${job.error?.message??''} Review ${job.review?.pageUrl?'the draft':'Site Pages'} before you send this page again.`.trim():job.error?.message??'';
      // The draft SharePoint made before the stop is linked when the site's tab named it; else the library is.
      showTab=Number.isInteger(job.tabId)&&!state.closedTabs.has(job.tabId)&&(TAB_HELP.has(job.error?.code)||Boolean(job.review));review=job.review?.pageUrl??job.review?.sitePagesUrl??null;
      if(job.review?.pageUrl)reviewLabel='Review the draft';
    }
    else if(job?.status==='done'&&job.kind==='send'&&job.result){
      tone='success';title=job.message;open=job.result.pageUrl;
      const onPage=Boolean(job.result.page);openLabel=onPage?'Open page':'Open draft';
      detail=[...(job.result.notes??[]),onPage?'The changes are an unpublished draft. Review them, then publish the page in SharePoint.':'The draft is unpublished. Review it, then publish it in SharePoint.'].join(' ');
    }
    else if(sent){
      tone='success';open=sent.pageUrl;
      if(sent.page){title=sent.page.mode==='update'?`Updated ${quoted(sent.page.title)}`:`Sent to ${quoted(sent.page.title)}`;detail='The changes are an unpublished draft. Capture the page again to send it somewhere else.';openLabel='Open page';}
      else{title='Sent to SharePoint';detail='The draft is unpublished. Capture the page again to send it somewhere else.';}
    }
    el('status').dataset.tone=tone;
    el('status-title').textContent=title;
    el('status-detail').textContent=detail;el('status-detail').hidden=!detail;
    // Counted work fills the bar; a step without counts leaves it indeterminate, moving until the step is done.
    const progress=el('progress');progress.hidden=!busy;
    if(total){progress.max=total;progress.value=Math.min(completed,total);}else progress.removeAttribute('value');
    el('progress-counts').textContent=total?`${Math.min(completed,total)} of ${total} pictures`:'';el('progress-counts').hidden=!total;
    el('show-tab').hidden=!showTab;el('show-tab').textContent=page?'Show the tab':'Show the site’s tab';
    el('open-draft').hidden=!open;el('open-draft').textContent=openLabel;if(open)el('open-draft').href=open;else el('open-draft').removeAttribute('href');
    el('site-pages').hidden=!review;el('site-pages').textContent=reviewLabel;if(review)el('site-pages').href=review;else el('site-pages').removeAttribute('href');
  }
  function renderSites(sites){
    el('site-list').replaceChildren(...sites.map(site=>{
      const entry=document.createElement('li');entry.className='site-entry';
      const item=document.createElement('div');item.className='site';
      const pin=document.createElement('button');pin.type='button';pin.className='text-button';pin.textContent=site.pinned?'Unpin':'Pin';pin.setAttribute('aria-label',`${site.pinned?'Unpin':'Pin'} ${site.title||address(site.url)}`);
      pin.addEventListener('click',()=>act(()=>call('pin',{url:site.url,pinned:!site.pinned})));
      const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='Remove';remove.setAttribute('aria-label',`Remove ${site.title||address(site.url)}`);
      remove.addEventListener('click',()=>act(()=>call('remove',{url:site.url})));
      item.append(siteText(site),pin,remove);entry.append(item);
      // The site's remembered pages, each of which can be removed.
      if(site.pages?.length){
        const pages=document.createElement('ul');pages.className='page-list';pages.setAttribute('aria-label',`Pages in ${site.title||address(site.url)}`);
        pages.append(...site.pages.map(page=>{
          const row=document.createElement('li');row.className='page-row';
          const parts=pageName(document,page,site.pages),name=document.createElement('span');name.className='page-text';name.title=page.path;name.append(...parts);
          const forget=document.createElement('button');forget.type='button';forget.className='text-button';forget.textContent='Remove';forget.setAttribute('aria-label',parts.length>1?`Remove ${page.title} (${parts[1].textContent})`:`Remove ${page.title}`);
          forget.addEventListener('click',()=>act(()=>call('remove-page',{url:site.url,path:page.path})));
          row.append(name,forget);return row;
        }));
        entry.append(pages);
      }
      return entry;
    }));
    el('sites-empty').hidden=sites.length>0;el('forget').hidden=!sites.length;
  }
  // Where Send to offers to send: the pinned sites and the sites open in a tab, each with its pages open in a tab. The
  // site and page chosen stay while the popup is open, so the list does not change under a choice or a send.
  function destinations(sites){
    const openSites=new Set(state.open.map(url=>siteOfTab(sites,url)?.url).filter(Boolean));
    const openPages=new Set(state.open.map(url=>{try{const tab=new URL(url);return place(tab.origin,tab.pathname);}catch{return null;}}).filter(Boolean));
    return sites.filter(site=>site.pinned||openSites.has(site.url)||site.url===state.chosen).map(site=>({...site,
      pages:(site.pages??[]).filter(page=>openPages.has(place(originOf(site.url),page.path))||site.url===state.chosen&&page.path===state.page)}));
  }
  function render(){
    if(destroyed)return;
    // A radio the keyboard is on is rebuilt with its list, so focus goes back to it afterwards.
    const active=document.activeElement,focused=active?.tagName==='INPUT'&&active.type==='radio'?{name:active.name,value:active.value}:null;
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
    // A send stopped for want of site access asks for it, until Chrome grants it; so does a capture with nowhere
    // to go while some declared site is withheld, since the open sites cannot be seen then.
    const offered=destinations(sites);
    const accessNeeded=state.access||!state.allAccess&&(job?.status==='failed'&&job.error?.code==='site-access-needed'||Boolean(capture)&&!capture.attempt&&!offered.length&&!state.sharePoint);
    document.body.dataset.state=unanswered?'failed':!data?'loading':state.access?'access':running?'running':job?.status==='failed'?'failed':sent?'sent':capture?'captured':'idle';
    el('main-view').hidden=state.view!=='main';el('sites-view').hidden=state.view!=='sites';
    // The header's Sites link opens the Sites view, which has its own way back.
    el('sites-link').hidden=state.view==='sites';
    el('sites-problem').textContent=state.view==='sites'&&state.problem?state.problem:'';el('sites-problem').hidden=!(state.view==='sites'&&state.problem);
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
    captureButton.hidden=!onConfluence||state.problemKind==='tab';captureButton.disabled=running;
    captureButton.textContent=running&&(job.kind==='capture'||job.phase==='capturing')?'Capturing…':!capture?'Capture page':samePage?'Capture again':'Capture this page instead';
    captureButton.className=capture?'secondary-button':'primary-button';
    el('clear').hidden=!capture||running;
    // Where the tab's Confluence page was sent before, while the card is about that page.
    const links=onConfluence&&context.pageId&&(!capture||samePage)?(data?.links??[]).filter(link=>link.source?.pageId===context.pageId&&link.source?.origin===originOf(context.pageUrl)):[];
    renderSent(links,sites,running);
    renderDestinations(offered,capture,running,running&&job?.page?.mode==='update');
    renderStatus(job,sent);
    renderSites(sites);
    if(focused){const escaped=globalThis.CSS?.escape?.(focused.value)??focused.value;document.querySelector(`input[name="${focused.name}"][value="${escaped}"]`)?.focus({preventScroll:true});}
  }
  const on=(id,handler)=>el(id).addEventListener('click',handler);
  on('capture',()=>act(()=>call('capture',{tabId:state.tab.id})));
  on('send-button',()=>act(()=>state.updateInstead?call('send-page',{siteUrl:state.chosen,pagePath:state.updateInstead,mode:'update',windowId:state.tab?.windowId??null})
    :call('send',{siteUrl:state.chosen,windowId:state.tab?.windowId??null})));
  const sendPage=mode=>act(()=>call('send-page',{siteUrl:state.chosen,pagePath:state.page,mode,windowId:state.tab?.windowId??null}));
  on('add-button',()=>sendPage(state.addMode));
  on('overwrite-button',()=>sendPage('overwrite'));
  on('cancel-page',()=>{state.page=null;render();});
  on('clear',()=>act(()=>call('clear')));
  // A tab that turns out closed is no longer offered; the job's own report stays in view.
  on('show-tab',()=>{const tabId=state.data?.job?.tabId;act(async()=>{try{await call('show-tab',{tabId});}catch(error){if(error?.code!=='tab-closed')throw error;state.closedTabs.add(tabId);}});});
  // Switching views moves the keyboard to the other view's way back, since the control pressed is hidden with its view.
  on('sites-link',()=>{state.view=state.view==='sites'?'main':'sites';render();el(state.view==='sites'?'back':'sites-link').focus({preventScroll:true});});
  // A refusal shown in the Sites view is answered there; it does not follow the user back.
  on('back',()=>{if(state.problemKind==='command'){state.problem=null;state.problemKind=null;}state.view='main';render();el('sites-link').focus({preventScroll:true});});
  on('forget',()=>act(()=>call('forget')));
  on('allow-access',()=>{
    // permissions.request needs this click, so it is called directly in the handler.
    chromeApi.permissions.request({origins:siteOrigins()}).then(granted=>{
      // Pages already open get their scripts, so the sites open in tabs are remembered and offered at once.
      if(granted){void call('inject-open-pages').catch(()=>{}).then(()=>refresh());return;}
      state.problem='Allow site access for this extension in Chrome’s extensions menu. If that option is unavailable, your organization manages it.';state.problemKind='access';render();
    },error=>{state.problem=error?.message??'Chrome did not allow access.';state.problemKind='access';render();});
  });
  // A job's news is fresher than a refused command, so it takes the status back; a closed tab or refused access stays said.
  const changed=(changes,area)=>{if(area==='session'&&changes.job&&state.problemKind==='command'&&state.view==='main'){state.problem=null;state.problemKind=null;}
    if(area==='session'&&changes.job||area==='local'&&(changes.sites||changes.links))void load().then(render,()=>{});};
  chromeApi.storage.onChanged.addListener(changed);
  // The popup page in a window of its own stays open while its tab moves on, so it follows the tab.
  const followed=(id,info)=>{if(id===namedTab&&info?.status==='complete')void refresh();};
  const closed=id=>{if(id===namedTab){state.problem=TAB_GONE;state.problemKind='tab';render();}};
  if(namedTab!==null){chromeApi.tabs.onUpdated?.addListener(followed);chromeApi.tabs.onRemoved?.addListener(closed);}
  function destroy(){destroyed=true;chromeApi.storage.onChanged.removeListener(changed);if(namedTab!==null){chromeApi.tabs.onUpdated?.removeListener(followed);chromeApi.tabs.onRemoved?.removeListener(closed);}}
  document.defaultView?.addEventListener('pagehide',destroy);
  const ready=refresh();
  render();
  return {ready,refresh,destroy};
}

if(typeof document!=='undefined'&&globalThis.chrome?.runtime?.id&&!globalThis.__C2S_POPUP_MANUAL__){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>createPopup(),{once:true});else createPopup();
}
