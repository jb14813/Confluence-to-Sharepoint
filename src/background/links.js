// Which Confluence page was sent to which SharePoint page, remembered in chrome.storage.local so the SharePoint page
// can be updated from its Confluence page in one click. A link names the controls the send wrote on the page by the
// identities SharePoint keeps for them, also through its editor's saves, and the page by its permanent ID (0.4.7). The
// list stays in the browser; with Keep in my Confluence account on, account.js also keeps it in the user's account,
// told of every change made here through `watch`.
import {pageKey,siteKey} from './sites.js';

// A send writes at most 2000 controls; a link whose outcome was unknown names those it may have written as well.
// The newest links are kept while they name at most 100000 controls in all, well within the extension's storage.
const KEY='links',LIMIT=200,CONTROLS=4000,BUDGET=100_000;
const GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES=new Set(['draft','overwrite','add','update']);
const text=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,255):'';
const time=value=>Number.isSafeInteger(value)&&value>0?value:null;
const lower=value=>String(value??'').toLowerCase();
const guid=value=>typeof value==='string'&&GUID.test(value)?value.toLowerCase():null;

/** A Confluence page as a link knows it: the origin of its Confluence Cloud site and its page id, or null. */
export function sourceKey(source){
  let url;try{url=new URL(source?.origin);}catch{return null;}
  return url.origin===source.origin&&/^https:\/\/[a-z0-9-]+\.atlassian\.net$/.test(url.origin)&&typeof source.pageId==='string'&&/^\d{1,20}$/.test(source.pageId)
    ?{origin:url.origin,pageId:source.pageId}:null;
}
// Stored entries are rebuilt field by field, so nothing unexpected reaches the popup or a send. `titled`: the page takes
// its title, byline and date from this Confluence page; `headed`: the part starts with the Confluence title as a heading;
// `uniqueId`: the SharePoint page's permanent ID, which it keeps through a rename or a move within Site Pages (0.4.7).
export function normalLink(link){
  const source=sourceKey(link?.source),siteUrl=siteKey(link?.siteUrl)===link?.siteUrl?link.siteUrl:null,path=siteUrl?pageKey(siteUrl,link?.path):null;
  const part=Array.isArray(link?.part)?[...new Set(link.part.filter(id=>typeof id==='string'&&GUID.test(id)).map(id=>id.toLowerCase()))].slice(0,CONTROLS):[];
  // A link saved before it said whether the part starts with a heading: one that did not title the page was added below it.
  const headed=typeof link?.headed==='boolean'?link.headed:link?.titled!==true;
  const uniqueId=guid(link?.uniqueId);
  return source&&path&&part.length?{source,siteUrl,path,...(uniqueId?{uniqueId}:{}),title:text(link.title),part,titled:link.titled===true,headed,sentAt:time(link.sentAt)}:null;
}
const normal=normalLink;
/**
 * One SharePoint page: by its permanent ID where both links have one, since another page may have taken an address;
 * by address where either was sent before 0.4.7 and has none.
 */
export const samePage=(a,b)=>a.siteUrl===b.siteUrl&&(a.uniqueId&&b.uniqueId?a.uniqueId===b.uniqueId:lower(a.path)===lower(b.path));
const sameSource=(a,b)=>a.source.origin===b.source.origin&&a.source.pageId===b.source.pageId;
// A link's identity in the list: its Confluence page, and its SharePoint page by ID where known, else by address.
const identity=link=>`${link.source.origin}|${link.source.pageId}|${link.siteUrl}|${link.uniqueId??lower(link.path)}`;
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
const sameParts=(a,b)=>a.length===b.length&&a.every(id=>b.includes(id));

export function createLinks({storage=globalThis.chrome?.storage?.local,now=()=>Date.now()}={}){
  const read=async()=>{const list=(await storage.get(KEY))[KEY];return Array.isArray(list)?list.map(normal).filter(Boolean):[];};
  let watcher=null;
  // One change at a time, as for the remembered sites. What a change adds or alters, and what it removes on purpose,
  // is told to the watcher; links the size limit leaves out are not removals, and a change from the account is not told.
  let queue=Promise.resolve();
  function change(update,{silent=false}={}){
    let report=null;
    const next=queue.then(async()=>{
      const before=await read(),updated=update(before),list=budgeted(newest(updated));
      await storage.set({[KEY]:list});
      const was=new Map(before.map(link=>[identity(link),link])),kept=new Set(updated.map(identity));
      report={added:list.filter(link=>{const old=was.get(identity(link));return !old||JSON.stringify(old)!==JSON.stringify(link);}),
        removed:before.filter(link=>!kept.has(identity(link)))};
      return list;
    });
    queue=next.catch(()=>{});
    if(!silent)next.then(()=>{if(watcher&&report&&(report.added.length||report.removed.length))Promise.resolve().then(()=>watcher(report)).catch(()=>{});},()=>{});
    return next;
  }
  const linkOf=({source,siteUrl,path,uniqueId,title,part,mode})=>MODES.has(mode)?normal({source,siteUrl:siteKey(siteUrl),path,uniqueId,title,part,sentAt:now()}):null;
  return {
    list:async()=>newest(await read()),
    /** The function told of every change made here (account.js). */
    watch(fn){watcher=typeof fn==='function'?fn:null;},
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
     * at worst the next update adds a heading, and never gives the page a title it did not take from here. The page
     * keeps its ID.
     */
    widen({titled,headed,...value}){
      const link=linkOf(value);
      if(!link)return Promise.resolve(null);
      return change(list=>{
        const earlier=list.find(other=>samePage(other,link)&&sameSource(other,link));
        const part=[...new Set([...link.part,...(earlier?.part??[])])].slice(0,CONTROLS);
        const flags=earlier&&value.mode!=='update'?{titled:earlier.titled,headed:earlier.headed}:roles(value.mode,earlier,titled,headed);
        const uniqueId=link.uniqueId??earlier?.uniqueId;
        return [{...link,...(uniqueId?{uniqueId}:{}),part,title:link.title||earlier?.title||'',...flags},...list.filter(other=>other!==earlier)];
      });
    },
    /**
     * A page an update found at another address by its ID: the links with that ID take the new address, as do links
     * sent before 0.4.7 (no ID) at its old address. A link with another ID is another page and stays. Only an address
     * in the site's own Site Pages is taken. A moved link is dated now: it is news, which the account copy takes only
     * from a copy newer than the one it holds, so the other computers learn the new address too.
     */
    moved(url,from,to,uniqueId){
      const siteUrl=siteKey(url),next=siteUrl?pageKey(siteUrl,to):null,id=guid(uniqueId);
      if(!next||typeof from!=='string'||!id)return Promise.resolve(null);
      return change(list=>list.map(link=>link.siteUrl===siteUrl&&(link.uniqueId===id||!link.uniqueId&&lower(link.path)===lower(from))?normal({...link,path:next,uniqueId:id,sentAt:now()})??link:link));
    },
    /**
     * One Confluence page's links merged with its account copy (account.js): the newer of two copies of a link stays;
     * a link the account lacks stays (and is returned in `heal`, to go back to the account); a link `dead` says was
     * removed, here or elsewhere, goes. The account's links never replace this browser's by being absent.
     */
    merge(source,entries,dead=()=>false){
      const key=sourceKey(source);
      if(!key)return Promise.resolve({heal:[]});
      const fresh=(Array.isArray(entries)?entries:[]).map(entry=>normal({...entry,source:key})).filter(Boolean);
      let heal=[];
      return change(list=>{
        const mine=list.filter(link=>sameSource(link,{source:key})),others=list.filter(link=>!sameSource(link,{source:key})),result=[];
        heal=[];
        for(const link of mine){
          if(dead(link))continue;
          const theirs=fresh.find(entry=>samePage(entry,link));
          if(theirs&&!dead(theirs)&&(theirs.sentAt??0)>(link.sentAt??0))continue;
          result.push(link);
          if(!theirs||(theirs.sentAt??0)<(link.sentAt??0))heal.push(link);
        }
        for(const entry of fresh)if(!dead(entry)&&!result.some(link=>samePage(link,entry)))result.push(entry);
        return [...result,...others];
      },{silent:true}).then(()=>({heal}));
    },
    /**
     * An update whose part is no longer on the page: that Confluence page's link to the page goes, by the page's ID
     * where known, and only while it still names the part that was looked for; a newer copy of the link, come from
     * the account meanwhile, stays.
     */
    remove(source,url,path,{uniqueId,part}={}){
      const key=sourceKey(source),siteUrl=siteKey(url),id=guid(uniqueId),looked=Array.isArray(part)?part.map(lower):null;
      return change(list=>list.filter(link=>!(key&&sameSource(link,{source:key})&&link.siteUrl===siteUrl&&
        (id&&link.uniqueId?link.uniqueId===id:lower(link.path)===lower(path))&&(!looked||sameParts(link.part,looked)))));
    },
    /**
     * A page a send found gone: the links with its ID go, and links without an ID at its address; a link with another
     * ID is another page (one that took the address) and stays. Without an ID, only links without one at the address go.
     */
    removeGone(url,path,uniqueId){
      const siteUrl=siteKey(url),id=guid(uniqueId);
      return change(list=>list.filter(link=>!(link.siteUrl===siteUrl&&(id&&link.uniqueId===id||!link.uniqueId&&lower(link.path)===lower(path)))));
    },
    /** A page removed in the Sites view: every link to its address goes. */
    removePage:(url,path)=>{const siteUrl=siteKey(url);return change(list=>list.filter(link=>!(link.siteUrl===siteUrl&&typeof path==='string'&&lower(link.path)===lower(path))));},
    removeSite:url=>{const siteUrl=siteKey(url);return change(list=>list.filter(link=>link.siteUrl!==siteUrl));},
    forget:()=>change(()=>[])
  };
}
