// SharePoint sites the user visits, remembered in chrome.storage.local and
// offered as destinations. The list never leaves the browser.
import {siteAddress} from './checks.js';

const KEY='sites',LIMIT=30;
const text=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,255):'';

/** The address a site is remembered by, or null for a site that cannot receive pages: not SharePoint Online, a personal OneDrive, or the admin center. */
export function siteKey(value){
  let address;
  try{address=siteAddress(value);}catch{return null;}
  const host=new URL(address).hostname.toLowerCase();
  return /^[a-z0-9-]+\.sharepoint\.com$/.test(host)&&!/-(?:my|admin)\.sharepoint\.com$/.test(host)?address:null;
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
// Stored entries are rebuilt field by field, so nothing unexpected reaches the popup.
const normal=site=>({url:site.url,title:text(site.title),visitedAt:time(site.visitedAt),usedAt:time(site.usedAt),pinned:site.pinned===true,problem:typeof site.problem==='string'&&text(site.problem)?text(site.problem):null});

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
    /** A visit adds the site or refreshes its title, and clears a problem an earlier send noted. */
    visited(url,title){
      const key=siteKey(url);
      if(!key)return Promise.resolve(null);
      return change(list=>{
        const known=list.find(site=>site.url===key);
        if(known)return list.map(site=>site===known?{...site,title:text(title)||site.title,visitedAt:now(),problem:null}:site);
        return [...list,{url:key,title:text(title),visitedAt:now(),usedAt:null,pinned:false,problem:null}];
      });
    },
    used:url=>edit(url,site=>({...site,usedAt:now()})),
    problem:(url,message)=>edit(url,site=>({...site,problem:text(message)||'This site could not receive the page.'})),
    pin:(url,pinned)=>edit(url,site=>({...site,pinned:pinned===true})),
    remove:url=>{const key=siteKey(url);return change(list=>list.filter(site=>site.url!==key));},
    forget:()=>change(()=>[])
  };
}
