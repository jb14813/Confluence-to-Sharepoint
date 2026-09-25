// Remembers the SharePoint site a page belongs to. The page context SharePoint
// renders into the page names it while it is current for the page's address, so
// no request is made. SharePoint also moves to other pages, and other sites,
// without reloading; the site is then confirmed through its own REST endpoint
// (src/sharepoint/detect.js). The background keeps the list (src/background/sites.js).
import {pageSite} from './detect.js';

const CHANNEL='site-memory';

/** The site that owns this SharePoint page, or null when it cannot be told. */
export function visitedSite(options={}){
  return pageSite(options);
}

/**
 * Tells the background which site this page belongs to, and again whenever
 * SharePoint moves to another site in this page. Chrome's Navigation API reports
 * each move, including SharePoint's own in-page ones.
 * https://developer.mozilla.org/docs/Web/API/Navigation/currententrychange_event
 */
export function watchVisits({chromeApi=globalThis.chrome,document=globalThis.document,location=globalThis.location,navigation=globalThis.navigation,fetchImpl}={}){
  const known=new Map();
  let path=null,reported=null,turn=0;
  async function check(){
    // An updated extension disconnects this copy; the new one follows the page.
    if(!chromeApi.runtime?.id){navigation?.removeEventListener('currententrychange',check);return;}
    // SharePoint rewriting the address of the same page changes nothing.
    let current;try{current=new URL(location.href).pathname;}catch{return;}
    if(current===path)return;
    path=current;
    const mine=++turn;
    const site=await pageSite({document,location,known,...(fetchImpl?{fetchImpl}:{})}).catch(()=>null);
    // A later move answers for itself; the same site is not reported twice in a row.
    if(mine!==turn||!site||site.url===reported?.url&&site.title===reported?.title)return;
    reported=site;
    await Promise.resolve(chromeApi.runtime.sendMessage({channel:CHANNEL,action:'site-visited',url:site.url,title:site.title})).catch(()=>{});
  }
  navigation?.addEventListener('currententrychange',check);
  return check();
}

if(typeof document!=='undefined'&&globalThis.chrome?.runtime?.sendMessage&&!globalThis.__C2S_SITE_MEMORY__){globalThis.__C2S_SITE_MEMORY__=true;void watchVisits();}
