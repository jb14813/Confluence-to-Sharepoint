// SharePoint is recognized from what the page serves rather than from its
// address. SharePoint's own markup identifies the product; the site (web) that
// owns the page comes from the page context SharePoint renders into it and is
// confirmed through SharePoint's REST endpoint on the same origin. Tenant
// roots, /sites/ and /teams/ sites, subsites, lists, libraries and _layouts
// pages therefore resolve without guessing from the path.

const JSON_TYPE='application/json;odata=nometadata';
const GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS=10_000;
const DETECTION_BUDGET_MS=15_000;
const MAX_PROBES=5;
const CACHE_MS=10*60_000;
// Library and list folders never contain a subsite, and managed paths such as
// /sites are never webs themselves, so neither is worth a REST probe.
const CONTAINERS=/^(?:SitePages|SiteAssets|Lists|Forms|Shared Documents|Style Library|SiteCollectionDocuments|SiteCollectionImages|FormServerTemplates)$/i;
const MANAGED_PATHS=/^\/(?:sites|teams|portals|personal)$/i;
const FILE=/\.(?:aspx?|html?|xml|json|docx?|xlsx?|pptx?|pdf|txt|one|png|jpe?g|gif|svg|webp)$/i;
const CONTEXT=/(?:"spPageContextInfo"\s*:|\b_spPageContextInfo\s*=)\s*\{/g;
const MEMBER=/[{,]\s*(?:"(\w+)"|'(\w+)'|(\w+))\s*:\s*("(?:[^"\\\n]|\\.)*")/g;
const CONTEXT_KEYS=['webServerRelativeUrl','webAbsoluteUrl','serverRequestPath','webTitle'];
export const NOT_SHAREPOINT='Open a Confluence page or a SharePoint site in this tab.';
const DENIED='SharePoint did not allow this site to be read with your current sign-in. Sign in with an account that can create pages here, then send again.';
const UNREACHABLE='SharePoint did not respond while this site was being checked. Send again in a moment.';
const NO_SITE='This address is not inside a site that could be identified. Visit the site you want to send to, so it is remembered, then send again.';
// A destination must satisfy the same Site Pages preconditions that
// createDraftClient().inspectSite() enforces before its first write.
const PAGES_PROBLEMS={
  'no-pages':'This SharePoint site does not have one Site Pages library for new pages. Choose another site.',
  'no-permission':'Your account cannot add and edit pages in this SharePoint site. Choose a site where you can create pages.',
  'no-drafts':'This site’s Site Pages library does not keep draft versions, so a new page could not stay unpublished. Ask a site owner to turn on major and minor versions, or choose another site.'
};

const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
const encode=value=>encodeURIComponent(value).replace(/[!'()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const trimmed=path=>path.replace(/\/+$/,'')||'/';
const decoded=pathname=>trimmed(pathname.split('/').map(decodeURIComponent).join('/'));
const within=(path,web)=>web==='/'||same(path,web)||path.toLowerCase().startsWith(`${web.toLowerCase()}/`);
const safePath=path=>typeof path==='string'&&path.startsWith('/')&&!path.startsWith('//')&&path.length<=1500&&
  (path==='/'||path.slice(1).split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/[\\\u0000-\u001f\u007f?#]/.test(part)));
/** The canonical site address used throughout the extension; the root web has no trailing slash. */
export const siteUrlFor=(origin,path)=>path==='/'?origin:origin+path.split('/').map(encode).join('/');

/** SharePoint's server-rendered markers, plus any inline scripts that carry its page context. */
export function sharePointMarkers(document){
  if(!document?.querySelector)return {product:false,contexts:[]};
  const generator=/^Microsoft SharePoint\b/i.test(document.querySelector('meta[name="generator" i]')?.getAttribute('content')||'');
  const chrome=!!document.querySelector('#spPageChromeAppDiv,#s4-workspace,#s4-bodyContainer');
  const layouts=!!document.querySelector('link[href*="/_layouts/15/"],script[src*="/_layouts/15/"]');
  const contexts=[...document.querySelectorAll('script:not([src])')].map(script=>script.textContent||'').filter(text=>text.includes('spPageContextInfo'));
  return {product:generator||chrome||layouts||contexts.length>0,contexts};
}

function objectAt(text,start){
  let depth=0,quote=null,escaped=false;
  for(let index=start;index<text.length&&index-start<4_000_000;index++){
    const char=text[index];
    if(quote){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char===quote)quote=null;continue;}
    if(char==='"'||char==="'")quote=char;
    else if(char==='{'||char==='[')depth++;
    else if((char==='}'||char===']')&&--depth===0)return text.slice(start,index+1);
  }
  return null;
}
// Classic pages publish the context as a script literal rather than JSON.
// Keep only the object's own members so a nested object cannot supply a value.
function ownMembers(object){
  let output='',depth=0,quote=null,escaped=false;
  for(const char of object){
    if(quote){if(depth<=1)output+=char;if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char===quote)quote=null;continue;}
    if(char==='{'||char==='['){if(++depth===1)output+=char;continue;}
    if(char==='}'||char===']'){if(depth--===1)output+=char;continue;}
    if(char==='"'||char==="'")quote=char;
    if(depth<=1)output+=char;
  }
  return output;
}

/** Reads the web SharePoint rendered this page for: modern JSON context or the classic _spPageContextInfo literal. */
export function pageContext(texts){
  for(const text of texts){
    CONTEXT.lastIndex=0;
    for(let match;(match=CONTEXT.exec(text));){
      const object=objectAt(text,match.index+match[0].length-1);
      if(!object)continue;
      const values={};
      let parsed=null;
      try{parsed=JSON.parse(object);}catch{/* A script literal is read member by member below. */}
      if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)){
        for(const key of CONTEXT_KEYS)if(typeof parsed[key]==='string')values[key]=parsed[key];
      }else{
        for(const member of ownMembers(object).matchAll(MEMBER)){
          const key=member[1]??member[2]??member[3];
          if(CONTEXT_KEYS.includes(key)&&!Object.hasOwn(values,key))try{values[key]=JSON.parse(member[4]);}catch{/* Ignore an unreadable value. */}
        }
      }
      if(typeof values.webServerRelativeUrl==='string')return values;
    }
  }
  return null;
}

function hintFor(context,url,path){
  if(!context)return null;
  const web=trimmed(context.webServerRelativeUrl);
  if(!safePath(web)||!within(path,web))return null;
  if(context.webAbsoluteUrl!==undefined){
    try{
      const absolute=new URL(context.webAbsoluteUrl);
      if(absolute.origin!==url.origin||!same(decoded(absolute.pathname),web))return null;
    }catch{return null;}
  }
  // Modern pages keep their first server-rendered context during in-app
  // navigation. It names the current web only while the address is still the
  // page SharePoint rendered; otherwise deeper webs are checked first.
  const request=context.serverRequestPath;
  return {path:web,fresh:request===undefined||typeof request==='string'&&same(trimmed(request),path)};
}

/** Web paths to confirm, most specific first. A current page context needs no probing. */
export function candidateWebPaths(path,hint=null){
  if(hint?.fresh)return [hint.path];
  const parts=path==='/'?[]:path.slice(1).split('/'),eligible=[];
  for(let count=parts.length;count>=0;count--){
    const candidate=count?`/${parts.slice(0,count).join('/')}`:'/',segments=parts.slice(0,count);
    if(count&&(FILE.test(segments.at(-1))||MANAGED_PATHS.test(candidate)||segments.some(part=>part.startsWith('_')||CONTAINERS.test(part))))continue;
    eligible.push(candidate);
  }
  if(!hint)return eligible.slice(0,MAX_PROBES);
  return [...eligible.filter(candidate=>candidate.length>hint.path.length&&within(candidate,hint.path)).slice(0,MAX_PROBES-1),hint.path];
}

async function readJson(url,origin,fetchImpl,deadline){
  const remaining=deadline-Date.now();
  if(remaining<=0)return {status:'unreachable'};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(REQUEST_TIMEOUT_MS,remaining));
  try{
    const response=await fetchImpl(url,{method:'GET',headers:{Accept:JSON_TYPE},credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal});
    if(response.status===400||response.status===404)return {status:'missing'};
    if(response.status===401||response.status===403)return {status:'denied'};
    if(!response.ok||response.redirected||response.url&&new URL(response.url).origin!==origin||!/json/i.test(response.headers.get('Content-Type')||''))return {status:'unreachable'};
    const text=await response.text();
    if(text.length>1_000_000)return {status:'unreachable'};
    const data=JSON.parse(text);
    return {status:'ok',body:data?.d??data};
  }catch{return {status:'unreachable'};}
  finally{clearTimeout(timer);}
}

function pagesProblem(body){
  const lists=body?.value??body?.results;
  if(!Array.isArray(lists))return 'unreachable';
  const pages=lists.filter(list=>list?.BaseTemplate===119);
  if(pages.length!==1)return 'no-pages';
  const low=String(pages[0].EffectiveBasePermissions?.Low??'');
  if(!/^\d+$/.test(low)||Number(low)>0xffffffff||(BigInt(low)&7n)!==7n)return 'no-permission';
  if(pages[0].EnableVersioning!==true||pages[0].EnableMinorVersions!==true)return 'no-drafts';
  return null;
}

/** The web at `path`, confirmed by its own REST endpoint: {status:'ok',web}, or why not. */
async function readWeb(origin,path,fetchImpl,deadline){
  const identity=await readJson(`${siteUrlFor(origin,path)}/_api/web?$select=Id,Url,ServerRelativeUrl,Title`,origin,fetchImpl,deadline);
  if(identity.status!=='ok')return identity;
  const body=identity.body;
  const server=typeof body?.ServerRelativeUrl==='string'?trimmed(body.ServerRelativeUrl):null;
  let address=null;
  try{address=new URL(body?.Url);}catch{/* Checked below. */}
  try{
    if(!GUID.test(body?.Id??'')||!safePath(server)||!same(server,path)||!address||address.origin!==origin||!same(decoded(address.pathname),server)||
      body.Title!==undefined&&(typeof body.Title!=='string'||body.Title.length>255))return {status:'missing'};
  }catch{return {status:'missing'};}
  return {status:'ok',web:{path:server,url:siteUrlFor(origin,server),title:typeof body.Title==='string'?body.Title:''}};
}

// The page's own address, when it is one SharePoint could serve.
function pageAddress(location){
  let url;
  try{url=new URL(location?.href);}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
  let path;
  try{path=decoded(url.pathname);}catch{return {url,path:null};}
  return {url,path:safePath(path)?path:null};
}

/**
 * The site (web) a SharePoint page belongs to, as {url,title}, or null when it cannot
 * be told. The page context names it while SharePoint rendered the page for its
 * current address. SharePoint also moves to other pages, and other sites, without
 * reloading, and keeps the first page's context; the web that owns the address is then
 * confirmed through its own REST endpoint, most specific first. `known` keeps the
 * answers for one page, so a site already confirmed there is not asked about again.
 */
export async function pageSite({document=globalThis.document,location=globalThis.location,fetchImpl=(...args)=>globalThis.fetch(...args),known=new Map()}={}){
  const address=pageAddress(location);
  if(!address?.path)return null;
  const {url,path}=address,markers=sharePointMarkers(document);
  if(!markers.product)return null;
  const context=pageContext(markers.contexts),hint=hintFor(context,url,path);
  if(hint?.fresh)return {url:siteUrlFor(url.origin,hint.path),title:typeof context.webTitle==='string'?context.webTitle:''};
  const deadline=Date.now()+DETECTION_BUDGET_MS;
  for(const candidate of candidateWebPaths(path,hint)){
    const key=`${url.origin}|${candidate.toLowerCase()}`;
    const result=known.get(key)??await readWeb(url.origin,candidate,fetchImpl,deadline);
    if(result.status==='ok'||result.status==='missing')known.set(key,result);
    if(result.status==='ok')return {url:result.web.url,title:result.web.title};
    if(result.status!=='missing')return null;
  }
  return null;
}

/** Creates a detector with its own short-lived cache of confirmed destination webs. */
export function createSharePointDetector({cacheMs=CACHE_MS}={}){
  const webs=new Map();
  async function verifyWeb(origin,path,fetchImpl,deadline){
    const key=`${origin}|${path.toLowerCase()}`,cached=webs.get(key);
    if(cached&&Date.now()-cached.time<cacheMs)return cached.result;
    const identity=await readWeb(origin,path,fetchImpl,deadline);
    if(identity.status!=='ok')return identity;
    const web=identity.web;
    const pages=await readJson(`${web.url}/_api/web/lists?$select=Id,BaseTemplate,EnableVersioning,EnableMinorVersions,EffectiveBasePermissions&$filter=BaseTemplate%20eq%20119`,origin,fetchImpl,deadline);
    if(pages.status==='denied'||pages.status==='unreachable')return pages;
    const problem=pages.status==='ok'?pagesProblem(pages.body):'no-pages';
    if(problem==='unreachable')return {status:'unreachable'};
    if(problem)return {status:'unsuitable',web,problem};
    // Only a usable destination is remembered, so Refresh re-checks a site
    // whose owner has just changed its permissions or versioning.
    const result={status:'ok',web};
    webs.set(key,{time:Date.now(),result});
    return result;
  }
  return async function detectSharePointSite({document=globalThis.document,location=globalThis.location,fetchImpl=(...args)=>globalThis.fetch(...args)}={}){
    const unsupported=(reason,product=null,code=null)=>({supported:false,kind:'unsupported',product,reason,...(code?{code}:{})});
    let url;
    try{url=new URL(location?.href);}catch{return unsupported(NOT_SHAREPOINT);}
    if(url.protocol!=='https:'||url.username||url.password||url.port)return unsupported(NOT_SHAREPOINT);
    const markers=sharePointMarkers(document);
    if(!markers.product)return unsupported(NOT_SHAREPOINT);
    let path;
    try{path=decoded(url.pathname);}catch{return unsupported(NO_SITE,'sharepoint','no-site');}
    if(!safePath(path))return unsupported(NO_SITE,'sharepoint','no-site');
    const deadline=Date.now()+DETECTION_BUDGET_MS;
    for(const candidate of candidateWebPaths(path,hintFor(pageContext(markers.contexts),url,path))){
      const result=await verifyWeb(url.origin,candidate,fetchImpl,deadline);
      if(result.status==='ok')return {supported:true,kind:'sharepoint',siteUrl:result.web.url,siteTitle:result.web.title,pageUrl:url.origin+url.pathname};
      if(result.status==='unsuitable')return unsupported(PAGES_PROBLEMS[result.problem],'sharepoint',result.problem);
      if(result.status==='denied')return unsupported(DENIED,'sharepoint','denied');
      if(result.status==='unreachable')return unsupported(UNREACHABLE,'sharepoint','unreachable');
    }
    return unsupported(NO_SITE,'sharepoint','no-site');
  };
}

export const detectSharePointSite=createSharePointDetector();
