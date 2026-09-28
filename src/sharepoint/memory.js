// Remembers the SharePoint site a page belongs to, and the site page it shows. The page context SharePoint
// renders into the page names the site while it is current for the page's address, so no request is made.
// SharePoint also moves to other pages, and other sites, without reloading; the site is then confirmed through
// its own REST endpoint (src/sharepoint/detect.js). The background keeps the list (src/background/sites.js).
import {pageContext,pageSite,sharePointMarkers} from './detect.js';

const CHANNEL='site-memory';
const decoded=path=>{try{return path.split('/').map(decodeURIComponent).join('/');}catch{return null;}};

/** The site that owns this SharePoint page, or null when it cannot be told. */
export function visitedSite(options={}){
  return pageSite(options);
}

/**
 * The site page an address shows, as {path, title}, or null: a page in the site's own Site Pages library, not one
 * of its views or templates, nor the site's home page, which the page context names while it is current for the
 * address. `title` is SharePoint's name for the page (document.title).
 */
export function visitedPage({document=globalThis.document,location=globalThis.location,site,title=document?.title??'',context=pageContext(sharePointMarkers(document).contexts)}={}){
  let url;try{url=new URL(location.href);}catch{return null;}
  let sitePath=null;try{sitePath=decoded(new URL(site.url).pathname.replace(/\/$/,''));}catch{/* Not a site. */}
  const path=decoded(url.pathname);
  if(path===null||sitePath===null)return null;
  const prefix=`${sitePath}/SitePages/`;
  if(!path.toLowerCase().startsWith(prefix.toLowerCase())||!/\.aspx$/i.test(path))return null;
  const inside=path.slice(prefix.length).split('/');
  if(inside.some(part=>!part||part==='.'||part==='..')||inside.length>1&&/^(?:forms|templates)$/i.test(inside[0]))return null;
  if(context?.isWebWelcomePage===true&&typeof context.serverRequestPath==='string'&&context.serverRequestPath.toLowerCase()===path.toLowerCase())return null;
  return {path,title:String(title??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,255)};
}

/**
 * Tells the background which site this page belongs to and which site page it shows, and again whenever
 * SharePoint moves to another page or site in this page, or names the page. Chrome's Navigation API reports each
 * move, including SharePoint's own in-page ones.
 * https://developer.mozilla.org/docs/Web/API/Navigation/currententrychange_event
 */
export function watchVisits({chromeApi=globalThis.chrome,document=globalThis.document,location=globalThis.location,navigation=globalThis.navigation,fetchImpl,MutationObserverImpl=globalThis.MutationObserver}={}){
  const known=new Map();
  let path=null,turn=0,site=null,reported=null,titleAtMove=null,lastTitle=null,observer=null,context;
  // After a move without reloading, document.title still names the page before until SharePoint names the new
  // one, so a title unchanged since the move is not the page's.
  const title=()=>titleAtMove!==null&&document.title===titleAtMove?'':document.title;
  async function report(){
    if(!site)return;
    // The page context SharePoint rendered stays the same for the life of the page.
    context??=pageContext(sharePointMarkers(document).contexts);
    const page=visitedPage({document,location,site,title:title(),context});
    const key=JSON.stringify([site.url,site.title,page?.path??null,page?.title??null]);
    // The same site and page are not reported twice in a row.
    if(key===reported)return;
    reported=key;
    await Promise.resolve(chromeApi.runtime.sendMessage({channel:CHANNEL,action:'site-visited',url:site.url,title:site.title,...(page?{page}:{})})).catch(()=>{});
  }
  function stop(){navigation?.removeEventListener('currententrychange',check);observer?.disconnect();}
  async function check(){
    // An updated extension disconnects this copy; the new one follows the page.
    if(!chromeApi.runtime?.id){stop();return;}
    // SharePoint rewriting the address of the same page (a query, its encoding or letter case) changes nothing.
    let current;try{current=new URL(location.href).pathname;}catch{return;}
    current=(decoded(current)??current).toLowerCase();
    if(current===path)return;
    titleAtMove=path===null?null:document.title;
    path=current;
    const mine=++turn;
    const found=await pageSite({document,location,known,...(fetchImpl?{fetchImpl}:{})}).catch(()=>null);
    // A later move answers for itself.
    if(mine!==turn)return;
    site=found;
    await report();
  }
  navigation?.addEventListener('currententrychange',check);
  // SharePoint names the page in document.title once it has loaded it.
  if(MutationObserverImpl&&document?.head){
    observer=new MutationObserverImpl(()=>{
      if(!chromeApi.runtime?.id){stop();return;}
      if(document.title===lastTitle)return;
      lastTitle=document.title;void report();
    });
    observer.observe(document.head,{subtree:true,childList:true,characterData:true});
  }
  return check();
}

if(typeof document!=='undefined'&&globalThis.chrome?.runtime?.sendMessage&&!globalThis.__C2S_SITE_MEMORY__){globalThis.__C2S_SITE_MEMORY__=true;void watchVisits();}
