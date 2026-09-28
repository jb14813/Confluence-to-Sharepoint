// Which Confluence page was sent to which SharePoint page, remembered in chrome.storage.local so the SharePoint page
// can be updated from its Confluence page in one click. A link names the controls the send wrote on the page by the
// identities SharePoint keeps for them, also through its editor's saves. The list never leaves the browser.
import {pageKey,siteKey} from './sites.js';

// A send writes at most 2000 controls; a link whose outcome was unknown names those it may have written as well.
// The newest links are kept while they name at most 100000 controls in all, well within the extension's storage.
const KEY='links',LIMIT=200,CONTROLS=4000,BUDGET=100_000;
const GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES=new Set(['draft','overwrite','add','update']);
const text=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,255):'';
const time=value=>Number.isSafeInteger(value)&&value>0?value:null;

/** A Confluence page as a link knows it: the origin of its Confluence Cloud site and its page id, or null. */
export function sourceKey(source){
  let url;try{url=new URL(source?.origin);}catch{return null;}
  return url.origin===source.origin&&/^https:\/\/[a-z0-9-]+\.atlassian\.net$/.test(url.origin)&&typeof source.pageId==='string'&&/^\d{1,20}$/.test(source.pageId)
    ?{origin:url.origin,pageId:source.pageId}:null;
}
// Stored entries are rebuilt field by field, so nothing unexpected reaches the popup or a send. `titled`: the page takes
// its title, byline and date from this Confluence page; `headed`: the part starts with the Confluence title as a heading.
function normal(link){
  const source=sourceKey(link?.source),siteUrl=siteKey(link?.siteUrl)===link?.siteUrl?link.siteUrl:null,path=siteUrl?pageKey(siteUrl,link?.path):null;
  const part=Array.isArray(link?.part)?[...new Set(link.part.filter(id=>typeof id==='string'&&GUID.test(id)).map(id=>id.toLowerCase()))].slice(0,CONTROLS):[];
  // A link saved before it said whether the part starts with a heading: one that did not title the page was added below it.
  const headed=typeof link?.headed==='boolean'?link.headed:link?.titled!==true;
  return source&&path&&part.length?{source,siteUrl,path,title:text(link.title),part,titled:link.titled===true,headed,sentAt:time(link.sentAt)}:null;
}
const samePage=(a,b)=>a.siteUrl===b.siteUrl&&a.path.toLowerCase()===b.path.toLowerCase();
const sameSource=(a,b)=>a.source.origin===b.source.origin&&a.source.pageId===b.source.pageId;
const newest=list=>[...list].sort((a,b)=>(b.sentAt??0)-(a.sentAt??0));
function budgeted(list){
  const kept=[];let total=0;
  for(const link of list.slice(0,LIMIT)){total+=link.part.length;if(total>BUDGET)break;kept.push(link);}
  return kept;
}
// What a send of `mode` makes of the link: a draft or an overwrite titles the page and adds no heading; content added
// below starts with its heading and leaves the title as the link had it; an update keeps what the send used.
function roles(mode,earlier,titled,headed){
  if(mode==='draft'||mode==='overwrite')return {titled:true,headed:false};
  if(mode==='add')return {titled:earlier?.titled===true,headed:true};
  return {titled:typeof titled==='boolean'?titled:earlier?.titled===true,headed:typeof headed==='boolean'?headed:earlier?.headed===true};
}

export function createLinks({storage=globalThis.chrome?.storage?.local,now=()=>Date.now()}={}){
  const read=async()=>{const list=(await storage.get(KEY))[KEY];return Array.isArray(list)?list.map(normal).filter(Boolean):[];};
  // One change at a time, as for the remembered sites.
  let queue=Promise.resolve();
  function change(update){
    const next=queue.then(async()=>{const list=budgeted(newest(update(await read())));await storage.set({[KEY]:list});return list;});
    queue=next.catch(()=>{});
    return next;
  }
  const matching=(url,path)=>{const siteUrl=siteKey(url);return link=>link.siteUrl===siteUrl&&(path===undefined||typeof path==='string'&&link.path.toLowerCase()===path.toLowerCase());};
  const linkOf=({source,siteUrl,path,title,part,mode})=>MODES.has(mode)?normal({source,siteUrl:siteKey(siteUrl),path,title,part,sentAt:now()}):null;
  return {
    list:async()=>newest(await read()),
    /**
     * After a verified send of `source` to the page: 'draft' and 'overwrite' leave only its content on the page, so
     * every other link to the page goes; 'add' replaces its earlier link to the page, and 'update' refreshes it with
     * the `titled` and `headed` it was sent with.
     */
    sent({titled,headed,...value}){
      const link=linkOf(value);
      if(!link)return Promise.resolve(null);
      return change(list=>{
        const earlier=list.find(other=>samePage(other,link)&&sameSource(other,link)),whole=value.mode==='draft'||value.mode==='overwrite';
        return [{...link,...roles(value.mode,earlier,titled,headed)},...list.filter(other=>!samePage(other,link)||!whole&&!sameSource(other,link))];
      });
    },
    /**
     * After a page send whose outcome is unknown: the link names what the send may have written (first) as well as
     * what was there, so the next update replaces this Confluence page's content whichever the page holds. Nothing
     * else is dropped. An add or overwrite keeps the flags of the link it had, since either state may be the page's:
     * at worst the next update adds a heading, and never gives the page a title it did not take from here.
     */
    widen({titled,headed,...value}){
      const link=linkOf(value);
      if(!link)return Promise.resolve(null);
      return change(list=>{
        const earlier=list.find(other=>samePage(other,link)&&sameSource(other,link));
        const part=[...new Set([...link.part,...(earlier?.part??[])])].slice(0,CONTROLS);
        const flags=earlier&&value.mode!=='update'?{titled:earlier.titled,headed:earlier.headed}:roles(value.mode,earlier,titled,headed);
        return [{...link,part,title:link.title||earlier?.title||'',...flags},...list.filter(other=>other!==earlier)];
      });
    },
    remove:(source,url,path)=>{const key=sourceKey(source),on=matching(url,path);return change(list=>list.filter(link=>!(key&&on(link)&&sameSource(link,{source:key}))));},
    removePage:(url,path)=>{const on=matching(url,typeof path==='string'?path:null);return change(list=>list.filter(link=>!on(link)));},
    removeSite:url=>{const on=matching(url);return change(list=>list.filter(link=>!on(link)));},
    forget:()=>change(()=>[])
  };
}
