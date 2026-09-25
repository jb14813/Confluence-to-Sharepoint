// Confluence is recognized from the markup it serves, not from its host name:
// Atlassian's page metadata and body id identify the product, its declared
// base URL supplies the REST and attachment root, and the article renderer
// shows when a page is ready. The same signals are present on atlassian.net
// sites and on Confluence Cloud custom domains.

const ARTICLE='#main-content[data-testid="pageContentRendererTestId"] .ak-renderer-document';
// Confluence's editor, as live docs and pages open for editing show it.
export const EDITOR='[data-testid="ak-editor-container"] .ProseMirror[contenteditable="true"]';
const PAGE_TITLE='h1#heading-title-text';
const OVERVIEW_TITLE='h1#title-text';
const REST_CACHE_MS=5*60_000;
// A cached title that disagrees with the page is read again once it is this
// old, so a renamed page is not mistaken for one that is still loading.
const RECHECK_AFTER_MS=5_000;
const REQUEST_TIMEOUT_MS=10_000;
export const NOT_CONFLUENCE='Open a Confluence page or a SharePoint site in this tab.';
const NOT_A_PAGE='Open a Confluence page in this tab.';
const LOADING='Confluence did not expose one complete article and title. Wait for the page to finish loading.';
const EDITOR_LOADING='Confluence has not finished opening this page in its editor. Wait for it to load.';
const UNTITLED='This page has no title yet. Give it a title in Confluence, then capture it.';
const SELF_HOSTED='This is a Confluence Data Center or Server page. This version captures Confluence Cloud pages only.';
const UNREADABLE='Confluence did not return this page’s details with your current sign-in. Refresh to try again.';
const NO_HOMEPAGE='The Confluence space home page could not be identified. Open it from the space page tree, then refresh.';
const responses=new Map();

const compact=text=>String(text??'').normalize('NFC').replace(/[\u200b\ufeff]/gu,'').replace(/\s+/gu,' ').trim();
const letters=text=>compact(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
const meta=(document,name)=>document.querySelector(`meta[name="${name}"]`)?.getAttribute('content')??null;
const currentUrl=location=>{try{return new URL(typeof location==='string'?location:location?.href);}catch{return null;}};

export const topLevelArticles=document=>[...document.querySelectorAll(ARTICLE)].filter(article=>!article.parentElement?.closest('.ak-renderer-document'));

/** Returns the Confluence application root when this document is served by Confluence. */
export function confluenceSite({document=globalThis.document,location=globalThis.location}={}){
  const url=currentUrl(location);
  if(!url||url.protocol!=='https:'||url.username||url.password||!document?.querySelector)return null;
  const renderer=!!document.querySelector('#main-content[data-testid="pageContentRendererTestId"]');
  const product=document.body?.id==='com-atlassian-confluence'||renderer||
    ['confluence-base-url','confluence-request-time','ajs-confluence-flavour'].some(name=>meta(document,name)!==null);
  if(!product)return null;
  let root;
  const declared=meta(document,'ajs-base-url')??meta(document,'confluence-base-url');
  if(declared!==null){
    let base;
    try{base=new URL(declared);}catch{return null;}
    if(base.protocol!=='https:'||base.origin!==url.origin||base.username||base.password||base.search||base.hash)return null;
    root=base.pathname.replace(/\/+$/,'');
  }else if(url.pathname.startsWith('/wiki/'))root='/wiki';
  else return null;
  if(root&&!/^(?:\/[A-Za-z0-9._~-]+)+$/.test(root))return null;
  if(root&&url.pathname!==root&&!url.pathname.startsWith(`${root}/`))return null;
  // Data Center and Server serve the ajs-* base metadata too, but never these
  // Cloud-only markers or the Cloud article renderer.
  return {url,origin:url.origin,contextPath:root,baseUrl:`${url.origin}${root}`,
    cloud:renderer||['ajs-cloud-id','ajs-confluence-flavour','confluence-base-url'].some(name=>meta(document,name)!==null)};
}

/** Identifies the document route below the Confluence root; returns null for application pages. */
export function confluenceRoute(site){
  const rest=site.url.pathname.slice(site.contextPath.length)||'/';
  const key=value=>{try{const decoded=decodeURIComponent(value);return decoded&&decoded.length<=255&&!/[\u0000-\u001f\u007f/]/.test(decoded)?decoded:null;}catch{return null;}};
  let match=/^\/spaces\/([^/]+)\/pages\/(\d{1,20})(?:\/.*)?$/.exec(rest);
  if(match)return key(match[1])===null?null:{type:'page',spaceKey:key(match[1]),pageId:match[2]};
  // A page open in the editor, where a draft never published also opens.
  match=/^\/spaces\/([^/]+)\/pages\/edit-v2\/(\d{1,20})(?:\/.*)?$/.exec(rest);
  if(match)return key(match[1])===null?null:{type:'editor',spaceKey:key(match[1]),pageId:match[2]};
  match=/^\/spaces\/([^/]+)\/overview\/?$/.exec(rest);
  if(match)return key(match[1])===null?null:{type:'overview',spaceKey:key(match[1])};
  const legacy=site.url.searchParams.get('pageId');
  if(rest==='/pages/viewpage.action'&&/^\d{1,20}$/.test(legacy??''))return {type:'page',spaceKey:null,pageId:legacy};
  return null;
}

// Reads Confluence's REST API with the page's own session; only successful
// responses are cached. With `missing`, a resource Confluence reports as not
// found reads as MISSING rather than as a failure.
const MISSING=Symbol('missing');
async function readRest(site,path,fetchImpl,maxAge,{missing=false}={}){
  const key=`${site.baseUrl}${path}`,cached=responses.get(key);
  if(cached&&Date.now()-cached.time<maxAge)return cached.value;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
    const response=await fetchImpl(`${site.baseUrl}${path}`,{credentials:'include',headers:{Accept:'application/json'},redirect:'error',cache:'no-store',signal:controller.signal});
    if(missing&&response?.status===404&&!response.redirected)return MISSING;
    if(!response?.ok||response.redirected||response.url&&new URL(response.url).origin!==site.origin||!/application\/json/i.test(response.headers.get('Content-Type')||''))return null;
    const text=await response.text();
    if(text.length>1_000_000)return null;
    const value=JSON.parse(text);
    responses.set(key,{time:Date.now(),value});
    return value;
  }catch{return null;}
  finally{clearTimeout(timer);}
}
async function pageDetails(site,pageId,fetchImpl,maxAge){
  const page=await readRest(site,`/rest/api/content/${encodeURIComponent(pageId)}`,fetchImpl,maxAge);
  return String(page?.id)===pageId&&typeof page.title==='string'&&compact(page.title)?{id:pageId,title:page.title,live:page.subtype==='live'}:null;
}
// A page in the editor is described by its draft, which Confluence saves while
// the editor is open and which is all a page never published has. Only a page
// Confluence reports having no draft of is described by its published copy, as
// capture reads it (rest.js); a draft that cannot be read is not replaced by a
// copy the editor does not show. A new draft's title may still be empty.
async function draftDetails(site,pageId,fetchImpl,maxAge){
  const path=`/rest/api/content/${encodeURIComponent(pageId)}`;
  let page=await readRest(site,`${path}?status=draft`,fetchImpl,maxAge,{missing:true});
  if(page===MISSING)page=await readRest(site,path,fetchImpl,maxAge);
  return String(page?.id)===pageId&&typeof page.title==='string'?{id:pageId,title:page.title}:null;
}
async function spaceHomepage(site,spaceKey,fetchImpl,maxAge){
  const home=(await readRest(site,`/rest/api/space/${encodeURIComponent(spaceKey)}?expand=homepage`,fetchImpl,maxAge))?.homepage;
  return /^\d{1,20}$/.test(String(home?.id??''))&&typeof home.title==='string'&&compact(home.title)?{id:String(home.id),title:home.title}:null;
}
// Confluence Cloud swaps the address first and the rendered page later, so a
// rendered title is compared with the addressed page's real title.
async function addressedPage(read,renderedTitle){
  const first=await read(REST_CACHE_MS);
  if(!first||letters(first.title)===letters(renderedTitle))return first;
  return read(RECHECK_AFTER_MS);
}

/**
 * Single inspection of the open document. `pending` means Confluence is
 * still rendering the page the address names, so a caller may wait and retry.
 * `live` marks a live doc, whose content is captured from the stored page, and
 * `editing` a page open in the editor, captured from its stored draft.
 */
export async function inspectConfluencePage({document=globalThis.document,location=globalThis.location,fetchImpl=(...args)=>globalThis.fetch(...args)}={}){
  const result={supported:false,pending:false,live:false,editing:false,product:null,sourceType:'confluence',title:'',pageUrl:'',origin:'',baseUrl:'',pageId:'',spaceKey:'',reason:NOT_CONFLUENCE};
  const site=confluenceSite({document,location});
  if(!site)return result;
  Object.assign(result,{product:'confluence',pageUrl:site.url.href,origin:site.origin,baseUrl:site.baseUrl,reason:NOT_A_PAGE});
  if(!site.cloud){result.reason=SELF_HOSTED;return result;}
  const route=confluenceRoute(site);
  if(!route)return result;
  result.spaceKey=route.spaceKey??'';
  // The editor has no reading-view article: the page is read from the draft
  // Confluence stores for it, once the editor showing that draft has loaded.
  // The draft is read by the id in the address, so the page-id metadata, which
  // Confluence can leave from the previous page (see live docs), is not used.
  // Its title is read again after a few seconds, as people rename drafts.
  if(route.type==='editor'){
    if(document.querySelectorAll(EDITOR).length!==1){Object.assign(result,{pending:true,reason:EDITOR_LOADING});return result;}
    const page=await draftDetails(site,route.pageId,fetchImpl,RECHECK_AFTER_MS);
    if(!page){result.reason=UNREADABLE;return result;}
    const title=compact(page.title);
    if(!title){result.reason=UNTITLED;return result;}
    if(title.length>500){result.reason='The Confluence page title exceeds the supported length.';return result;}
    Object.assign(result,{supported:true,editing:true,title,pageId:page.id,reason:''});
    return result;
  }
  const articles=topLevelArticles(document),titles=document.querySelectorAll(route.type==='overview'?OVERVIEW_TITLE:PAGE_TITLE);
  result.reason=LOADING;
  if(articles.length>1||titles.length>1)return result;
  // Live docs are always open in the editor, with an editable title field, and
  // never render the reading-view article, so their content is read from the
  // stored page. They are known by the page the address names: Confluence
  // leaves the previous page's id in the page metadata after moving to a live
  // doc in-app. A published page still loading has no title field and waits.
  if(route.type==='page'&&!articles.length&&document.querySelector('textarea[id^="livepages-title-"]')){
    const page=await pageDetails(site,route.pageId,fetchImpl,REST_CACHE_MS);
    if(!page){result.reason=UNREADABLE;return result;}
    if(page.live){Object.assign(result,{supported:true,live:true,title:compact(page.title),pageId:page.id,reason:''});return result;}
  }
  // During in-app navigation Confluence changes the address and its page-id
  // metadata first, then the title, then the article; a page-id that still
  // disagrees with the address means nothing of the new page has rendered.
  const declaredId=meta(document,'ajs-page-id');
  if(!articles.length||!titles.length||route.type==='page'&&declaredId!==null&&declaredId!==route.pageId){result.pending=true;return result;}
  const title=compact(titles[0].textContent);
  if(!title||title.length>500){result.reason='The Confluence page title is missing or exceeds the supported length.';return result;}
  const addressed=route.type==='overview'
    ?await addressedPage(maxAge=>spaceHomepage(site,route.spaceKey,fetchImpl,maxAge),title)
    :await addressedPage(maxAge=>pageDetails(site,route.pageId,fetchImpl,maxAge),title);
  if(!addressed){result.reason=route.type==='overview'?NO_HOMEPAGE:UNREADABLE;return result;}
  if(letters(addressed.title)!==letters(title)){result.pending=true;return result;}
  Object.assign(result,{supported:true,title,pageId:addressed.id,reason:''});
  return result;
}

/** Waits briefly while Confluence finishes rendering the page named by the address. */
export async function waitForConfluencePage({timeout=8000,interval=250,...options}={}){
  const deadline=Date.now()+timeout;
  for(;;){
    const result=await inspectConfluencePage(options);
    if(!result.pending||Date.now()>=deadline)return result;
    await new Promise(resolve=>setTimeout(resolve,interval));
  }
}
