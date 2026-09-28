// SharePoint sites the user visits, remembered in chrome.storage.local and
// offered as destinations, each with the pages of it the user opens or the
// extension writes. The list never leaves the browser.
import {fail,siteAddress} from './checks.js';

const KEY='sites',LIMIT=30,PAGES=10;
const text=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,255):'';
const decoded=path=>{try{return path.split('/').map(decodeURIComponent).join('/');}catch{return null;}};

/** The address a site is remembered by, or null for a site that cannot receive pages: not SharePoint Online, a personal OneDrive, or the admin center. */
export function siteKey(value){
  let address;
  try{address=siteAddress(value);}catch{return null;}
  const host=new URL(address).hostname.toLowerCase();
  return /^[a-z0-9-]+\.sharepoint\.com$/.test(host)&&!/-(?:my|admin)\.sharepoint\.com$/.test(host)?address:null;
}

/** A page's server-relative path as it is remembered: a page in the site's own Site Pages (not one of its views or templates), or null. */
export function pageKey(siteUrl,path){
  const site=siteKey(siteUrl);
  if(!site||typeof path!=='string'||path.length>1500||!path.startsWith('/')||/[\\\x00-\x1f\x7f?#]/.test(path))return null;
  const sitePath=decoded(new URL(site).pathname.replace(/\/$/,''));
  if(sitePath===null)return null;
  const prefix=`${sitePath}/SitePages/`;
  if(!path.toLowerCase().startsWith(prefix.toLowerCase())||!/\.aspx$/i.test(path))return null;
  const inside=path.slice(prefix.length).split('/');
  if(inside.some(part=>!part||part==='.'||part==='..')||inside.length>1&&/^(?:forms|templates)$/i.test(inside[0]))return null;
  return path;
}

// Pinned sites first, then the most recently used, then the most recently visited.
const ordered=list=>[...list].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||(b.usedAt??0)-(a.usedAt??0)||(b.visitedAt??0)-(a.visitedAt??0));
// Beyond the limit the unpinned sites used or visited longest ago are
// forgotten, so a site just visited is always kept.
const recent=site=>Math.max(site.usedAt??0,site.visitedAt??0);
function limited(list){
  const pinned=list.filter(site=>site.pinned),kept=list.filter(site=>!site.pinned).sort((a,b)=>recent(b)-recent(a)).slice(0,Math.max(0,LIMIT-pinned.length));
  return ordered([...pinned,...kept]);
}
const time=value=>Number.isSafeInteger(value)&&value>0?value:null;
// A page whose title is not known yet is named from its file, which SharePoint names after the title with hyphens for spaces.
const nameOf=path=>path.slice(path.lastIndexOf('/')+1).replace(/\.aspx$/i,'').replace(/-/g,' ').trim();
const pageEntry=(site,page)=>{const path=pageKey(site.url,page?.path);return path?{path,title:text(page.title)||nameOf(path),visitedAt:time(page.visitedAt)}:null;};
// Newest first, one entry for each page whatever its letter case, at most 10.
function pagesOf(list){
  const seen=new Set();
  return [...list].sort((a,b)=>(b.visitedAt??0)-(a.visitedAt??0)).filter(page=>{const key=page.path.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).slice(0,PAGES);
}
const withPage=(pages,page)=>page?pagesOf([page,...pages.filter(other=>other.path.toLowerCase()!==page.path.toLowerCase())]):pages;
// Stored entries are rebuilt field by field, so nothing unexpected reaches the popup.
const normal=site=>({url:site.url,title:text(site.title),visitedAt:time(site.visitedAt),usedAt:time(site.usedAt),pinned:site.pinned===true,
  problem:typeof site.problem==='string'&&text(site.problem)?text(site.problem):null,pages:pagesOf((Array.isArray(site.pages)?site.pages:[]).map(page=>pageEntry(site,page)).filter(Boolean))});

export function createSites({storage=globalThis.chrome?.storage?.local,now=()=>Date.now()}={}){
  const read=async()=>{const list=(await storage.get(KEY))[KEY];return Array.isArray(list)?list.filter(site=>siteKey(site?.url)===site?.url).map(normal):[];};
  // One change at a time: several SharePoint tabs can report visits together.
  let queue=Promise.resolve();
  function change(update){
    const next=queue.then(async()=>{const list=limited(update(await read()));await storage.set({[KEY]:list});return list;});
    queue=next.catch(()=>{});
    return next;
  }
  const edit=(url,apply)=>{const key=siteKey(url);return change(list=>list.map(site=>site.url===key?apply(site):site));};
  return {
    list:async()=>ordered(await read()),
    /** A visit adds the site or refreshes its title, and clears a problem an earlier send noted; a page visit also puts the page first. */
    visited(url,title,page){
      const key=siteKey(url);
      if(!key)return Promise.resolve(null);
      const at=now(),seen=page?pageEntry({url:key},{...page,visitedAt:at}):null;
      return change(list=>{
        const known=list.find(site=>site.url===key);
        if(known)return list.map(site=>site===known?{...site,title:text(title)||site.title,visitedAt:at,problem:null,pages:withPage(site.pages,seen)}:site);
        return [...list,{url:key,title:text(title),visitedAt:at,usedAt:null,pinned:false,problem:null,pages:withPage([],seen)}];
      });
    },
    /** A page the extension created or wrote, first in its site's pages with the title it has now; only for a remembered site. */
    pageVisited:(url,page)=>{const at=now();return edit(url,site=>({...site,pages:withPage(site.pages,pageEntry(site,{...page,visitedAt:at}))}));},
    removePage:(url,path)=>edit(url,site=>({...site,pages:site.pages.filter(page=>typeof path!=='string'||page.path.toLowerCase()!==path.toLowerCase())})),
    used:url=>edit(url,site=>({...site,usedAt:now()})),
    problem:(url,message)=>edit(url,site=>({...site,problem:text(message)||'This site could not receive the page.'})),
    // One place of the 30 stays for the site last visited, so pinning never hides a site that is open in a tab.
    pin:(url,pinned)=>change(list=>{
      const key=siteKey(url);
      if(pinned===true&&list.filter(site=>site.pinned&&site.url!==key).length>=LIMIT-1)throw fail('too-many-pins',`Up to ${LIMIT-1} sites can be pinned. Unpin one first.`);
      return list.map(site=>site.url===key?{...site,pinned:pinned===true}:site);
    }),
    remove:url=>{const key=siteKey(url);return change(list=>list.filter(site=>site.url!==key));},
    forget:()=>change(()=>[])
  };
}
