// Which Confluence page was sent to which SharePoint page, remembered in chrome.storage.local so the SharePoint page
// can be updated from its Confluence page in one click. A link names the controls the send wrote on the page by the
// identities SharePoint keeps for them, also through its editor's saves, and the page by its permanent ID (0.4.7). The
// list stays in the browser; with Keep in my Confluence account on, account.js also keeps it in the user's account,
// told of every change made here through `watch`.
import {pageKey,siteKey} from './sites.js';

// A send writes at most 2001 controls (a capture's 2000 blocks, and the heading of a part added below a page); a link
// whose outcome was unknown names those it may have written as well.
// The newest 2000 links are kept while they take at most 4,000,000 bytes as stored, the oldest going first beyond that.
// 0.5.0 kept 200 links naming at most 100,000 controls in all, which take about 3,900,000 bytes as stored (39 a
// control): no user keeps fewer links than then, one who sent more pages keeps Update for more of them (the account
// copy, 32 records of 32,000 bytes in account.js, holds about 40,000 controls at 25 bytes each), and the list takes no
// more of the 10 MB Chrome gives an extension's local storage (chrome.storage.local QUOTA_BYTES) than 0.5.0 could.
// A link also names what this Confluence page's earlier sends wrote on the page, which restoring an earlier version
// in SharePoint's version history brings back: the last SENDS sends, while the link fits one entry of the account copy
// (see shared); a link whose newest send alone is too big for the account keeps them up to what an update carries.
// Over the budget, those earlier sends go first, from the oldest link on, so a link's history never pushes out a link.
const KEY='links',LIMIT=2000,CONTROLS=4000,BUDGET=4_000_000,SENDS=8,ENTRY=16_000;
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
// `sentAt`: when the part was sent; `movedAt`: when the page was last found at a new address, if it was (0.5.1).
// `part` names the newest send's controls first, then the earlier sends'; `sends` says how many each send wrote, newest
// first, where there is more than one (the account copy keeps the controls only, as one send).
export function normalLink(link){
  const source=sourceKey(link?.source),siteUrl=siteKey(link?.siteUrl)===link?.siteUrl?link.siteUrl:null,path=siteUrl?pageKey(siteUrl,link?.path):null;
  const part=Array.isArray(link?.part)?[...new Set(link.part.filter(id=>typeof id==='string'&&GUID.test(id)).map(id=>id.toLowerCase()))].slice(0,CONTROLS):[];
  // A link saved before it said whether the part starts with a heading: one that did not title the page was added below it.
  const headed=typeof link?.headed==='boolean'?link.headed:link?.titled!==true;
  const uniqueId=guid(link?.uniqueId),movedAt=time(link?.movedAt);
  const sends=Array.isArray(link?.sends)&&link.sends.length>1&&link.sends.length<=SENDS&&link.sends.every(count=>Number.isSafeInteger(count)&&count>0)&&
    link.sends.reduce((sum,count)=>sum+count,0)===part.length?[...link.sends]:null;
  return source&&path&&part.length?{source,siteUrl,path,...(uniqueId?{uniqueId}:{}),title:text(link.title),part,...(sends?{sends}:{}),titled:link.titled===true,headed,sentAt:time(link.sentAt),...(movedAt?{movedAt}:{})}:null;
}
// A link's part as its sends wrote it, newest first; one send where the link does not say.
function sendsOf(link){
  let at=0;return link?(link.sends??[link.part.length]).map(count=>link.part.slice(at,at+=count)):[];
}
// Sends' controls as one link names them: the newest whole, then earlier ones while they fit `room` and SENDS, whole,
// or with `cut` the last in part (an unknown outcome keeps what it can of what was there).
function joined(sends,room,cut=false){
  const kept=[],seen=new Set();let left=room;
  for(const ids of sends){
    const fresh=ids.filter(id=>!seen.has(id)),taken=!kept.length?fresh:fresh.length<=left?fresh:cut?fresh.slice(0,Math.max(0,left)):[];
    if(!fresh.length)continue;
    if(!taken.length||kept.length===SENDS)break;
    kept.push(taken);left-=taken.length;taken.forEach(id=>seen.add(id));
  }
  return {part:kept.flat(),sends:kept.length>1?kept.map(ids=>ids.length):null};
}
const normal=normalLink;
// When a link's address was last set: by its send, or by a move found later.
const placedAt=link=>Math.max(link.sentAt??0,link.movedAt??0);
/**
 * Two copies of one link: the newer send gives the part, title and flags, and the newer send or move the address, the
 * first copy winning a tie. A move is dated apart from the send, so a computer that follows a renamed page while it
 * holds an older part never makes that part news: the review of 0.5.0 found a newer update's part replaced so.
 */
function combine(mine,theirs){
  const content=(theirs.sentAt??0)>(mine.sentAt??0)?theirs:mine,place=placedAt(theirs)>placedAt(mine)?theirs:mine,at=placedAt(place),uniqueId=place.uniqueId??content.uniqueId;
  return normal({...content,path:place.path,uniqueId,movedAt:at>(content.sentAt??0)?at:null})??mine;
}
/**
 * One SharePoint page: by its permanent ID where both links have one, since another page may have taken an address;
 * by address where either was sent before 0.4.7 and has none.
 */
export const samePage=(a,b)=>a.siteUrl===b.siteUrl&&(a.uniqueId&&b.uniqueId?a.uniqueId===b.uniqueId:lower(a.path)===lower(b.path));
const sameSource=(a,b)=>a.source.origin===b.source.origin&&a.source.pageId===b.source.pageId;
// A link's identity in the list: its Confluence page, and its SharePoint page by ID where known, else by address.
const identity=link=>`${link.source.origin}|${link.source.pageId}|${link.siteUrl}|${link.uniqueId??lower(link.path)}`;
const newest=list=>[...list].sort((a,b)=>(b.sentAt??0)-(a.sentAt??0));
const encoder=new TextEncoder();
// The controls a link can name and still share an entry of the account copy (account.js): an entry takes at most
// ENTRY bytes, a control 25 (22 characters, quoted, and a comma), the link's site, address, ID and title what they take
// as stored (a title of 255 characters outside Latin script alone takes 765), and its other fields under 100.
const shared=link=>Math.floor((ENTRY-100-encoder.encode(JSON.stringify([link.siteUrl,link.path,link.uniqueId??'',link.title])).length)/25);
function budgeted(list){
  const kept=list.slice(0,LIMIT),size=link=>encoder.encode(JSON.stringify(link)).length+1;
  let total=1+kept.reduce((sum,link)=>sum+size(link),0);
  for(let at=kept.length-1;at>=0&&total>BUDGET;at--)if(kept[at].sends){
    const trimmed=normal({...kept[at],part:sendsOf(kept[at])[0],sends:null});
    total+=size(trimmed)-size(kept[at]);kept[at]=trimmed;
  }
  while(total>BUDGET)total-=size(kept.pop());
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
  // is told to the watcher; what the size limit leaves out (links, or earlier sends' controls) is not a change to tell,
  // and a change from the account is not told.
  let queue=Promise.resolve();
  function change(update,{silent=false}={}){
    let report=null;
    const next=queue.then(async()=>{
      const before=await read(),updated=update(before),list=budgeted(newest(updated));
      await storage.set({[KEY]:list});
      const was=new Map(before.map(link=>[identity(link),link])),asked=new Map(updated.map(link=>[identity(link),link]));
      report={added:list.filter(link=>{const old=was.get(identity(link));return !old||JSON.stringify(old)!==JSON.stringify(asked.get(identity(link)));}),
        removed:before.filter(link=>!asked.has(identity(link)))};
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
     * the `titled` and `headed` it was sent with. After an add or an update, the link names the earlier sends' controls
     * too (see SENDS), which an update then replaces whichever the page holds.
     */
    sent({titled,headed,...value}){
      const link=linkOf(value);
      if(!link)return Promise.resolve(null);
      return change(list=>{
        const earlier=list.find(other=>samePage(other,link)&&sameSource(other,link)),whole=value.mode==='draft'||value.mode==='overwrite';
        // Overwrite leaves only its own content, with its own title and flags: a link from before it is not carried on.
        const {part,sends}=whole?{part:link.part,sends:null}:joined([link.part,...sendsOf(earlier)],link.part.length>shared(link)?CONTROLS:shared(link));
        return [normal({...link,part,sends,...roles(value.mode,earlier,titled,headed)}),...list.filter(other=>!samePage(other,link)||!whole&&!sameSource(other,link))];
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
        const {part,sends}=joined([link.part,...sendsOf(earlier)],CONTROLS,true);
        const flags=earlier&&value.mode!=='update'?{titled:earlier.titled,headed:earlier.headed}:roles(value.mode,earlier,titled,headed);
        const uniqueId=link.uniqueId??earlier?.uniqueId;
        return [normal({...link,...(uniqueId?{uniqueId}:{}),part,sends,title:link.title||earlier?.title||'',...flags}),...list.filter(other=>other!==earlier)];
      });
    },
    /**
     * A page an update found at another address by its ID: the links with that ID take the new address, as do links
     * sent before 0.4.7 (no ID) at its old address. A link with another ID is another page and stays. Only an address
     * in the site's own Site Pages is taken. A moved link is dated as moved now, its send's time kept: the account copy
     * takes the new address from it, and the part, title and flags only from the newer send (see combine).
     */
    moved(url,from,to,uniqueId){
      const siteUrl=siteKey(url),next=siteUrl?pageKey(siteUrl,to):null,id=guid(uniqueId);
      if(!next||typeof from!=='string'||!id)return Promise.resolve(null);
      return change(list=>list.map(link=>link.siteUrl===siteUrl&&(link.uniqueId===id||!link.uniqueId&&lower(link.path)===lower(from))?normal({...link,path:next,uniqueId:id,movedAt:now()})??link:link));
    },
    /**
     * One Confluence page's links merged with its account copy (account.js): of two copies of a link, the newer send
     * and the newer address are kept (combine); a link the account lacks, or holds older, stays (and is returned in
     * `heal`, to go back to the account); a link `dead` says was removed, here or elsewhere, goes. The account's links
     * never replace this browser's by being absent.
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
          const theirs=fresh.find(entry=>samePage(entry,link)),kept=theirs&&!dead(theirs)?combine(link,theirs):link;
          result.push(kept);
          if(!theirs||(kept.sentAt??0)>(theirs.sentAt??0)||placedAt(kept)>placedAt(theirs))heal.push(kept);
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
