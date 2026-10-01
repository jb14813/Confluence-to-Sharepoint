// The sent list, also kept in the user's own Confluence account when the user turns on "Keep in my Confluence account"
// in the popup's Sites view (0.4.7): private user properties of the user's own account on each Confluence Cloud site
// the user sends pages from, which, as Atlassian documents, only that account can read ("Only the
// app itself can access user properties, no other app or user can access properties created by another app or user":
// https://developer.atlassian.com/cloud/confluence/confluence-entity-properties/). No other server is involved.
//
// The account copy is the union of what every browser with the setting on has sent: this browser's list stays the
// working copy, and a copy missing from the account never removes anything here. Of two copies of a link, the part,
// title and flags of the newer send stay, and the address of the newer send or move (a page found renamed), dated
// apart (0.5.1). Removals travel as dated marks, which remove only copies sent no later than themselves:
// a link crossed off or overwritten (its version), a page gone, and a site or page removed in the Sites view. Changes
// wait in a queue in local storage until Confluence takes them; they never hold up a capture, a send or the popup.
//
// The setting is one for all the user's Chrome browsers (0.4.9): Chrome sync holds it (`accountCopy`, dated), and every
// browser follows the newest; an undated value (a first start's) overrides no browser's own. Turning it off also leaves
// a dated note in the account (`off`) on the Confluence sites this browser used, so a browser without Chrome sync turns
// itself off the next time it saves or reads there; turning it on removes an older note from those sites, which this
// browser keeps listing for that (0.5.1). Marks and notes reach only those sites: a site is used once this browser
// sends from it, or once the account there holds anything of the extension (read when the popup opens over its page).
// A removal that had to wait (signed out, say) is made only in an account holding this browser's entries (0.5.1, see
// holds); for a site that is gone it is done, and one failing for two weeks while the setting stays off is given up and
// said (see lasting). The pinned sites are synced by Chrome too (pins.js), no longer kept in the account.
//
// Measured (2026-09-27): the service worker reads and writes user properties with the browser's own sign-in; a value
// may hold 32,768 characters of JSON (one more was refused); a POST to a key that exists is refused (409) and a PUT to
// one that does not (404), each leaving the account as it was; one account took 64 values of 30 KB.
// https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-user-properties/
import {fail} from './checks.js';
import {normalLink,sourceKey} from './links.js';
import {siteKey} from './sites.js';

const STATE='account',QUEUE='accountQueue',SETTING='accountCopy',VERSION=2;
const PREFIX='confluence-to-sharepoint-',RECORDS=32,MAX_BYTES=32_000,TIMEOUT_MS=20_000,MAX_OPS=2000,MAX_MARKS=200,RETRY_MS=30_000;
const RECORD_KEYS=Array.from({length:RECORDS},(_,index)=>`${PREFIX}sent-${String(index).padStart(2,'0')}`);
const LEGACY_PINS=`${PREFIX}pins`,REMOVED=`${PREFIX}removed`,OFF=`${PREFIX}off`;
// What turning the setting off deletes: the 32 records, the removal marks, and the pins 0.4.7 and 0.4.8 kept there.
const DATA_KEYS=[...RECORD_KEYS,LEGACY_PINS,REMOVED];
/** Every key the extension may touch in a Confluence account: its data, and the note that the setting was turned off. */
export const KEYS=[...DATA_KEYS,OFF];
const ORIGIN=/^https:\/\/[a-z0-9-]+\.atlassian\.net$/,SHORT=/^[A-Za-z0-9_-]{22}$/,GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// `on`: the setting turned on, which removes an older off note from one site (see flush).
const OPS=new Set(['put','drop','forget','clear','on']),KINDS=new Set(['site','page','gone']);
// A removal still failing after this many tries over this long is given up (see lasting): Atlassian's April 2022 outage
// kept some Cloud sites down for about two weeks, so a site silent for less may still come back.
const LASTING_TRIES=10,LASTING_MS=14*86_400_000;
const FULL='Some older sent pages did not fit in your Confluence account; the browsers that sent them keep them.';
const ELSEWHERE='Keep in my Confluence account was turned off on another computer, so it is off here too.';
const lower=value=>String(value??'').toLowerCase();
const plain=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);

/** The record holding a Confluence page's entries: its page id modulo 32. */
export const recordKey=pageId=>RECORD_KEYS[Number(BigInt(pageId)%BigInt(RECORDS))];

// A control id (a GUID) in 22 characters, base64url of its 16 bytes, and back.
function shortId(guid){
  const hex=guid.replace(/-/g,'');let binary='';
  for(let at=0;at<32;at+=2)binary+=String.fromCharCode(parseInt(hex.slice(at,at+2),16));
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function longId(text){
  if(typeof text!=='string'||!SHORT.test(text))return null;
  const binary=atob(`${text.replace(/-/g,'+').replace(/_/g,'/')}==`);
  if(binary.length!==16)return null;
  const hex=[...binary].map(char=>char.charCodeAt(0).toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/**
 * A link as its account record keeps it: site, path, page ID, title, part, whether it titles the page, heading, time
 * sent, and (0.5.1) the time the page was found at a new address, if it was; an entry without it is read as before.
 */
export const encodeEntry=link=>({s:link.siteUrl,p:link.path,...(link.uniqueId?{u:link.uniqueId}:{}),t:link.title??'',i:link.part.map(shortId),...(link.sends?{n:[...link.sends]}:{}),ti:link.titled?1:0,h:link.headed?1:0,at:link.sentAt??0,...(link.movedAt?{mv:link.movedAt}:{})});
/** An account record's entry as a link of the Confluence page `pageId` on `origin`, rebuilt field by field, or null. */
export function decodeEntry(origin,pageId,entry){
  if(!plain(entry)||!Array.isArray(entry.i)||!validMoved(entry))return null;
  const part=entry.i.map(longId);
  if(part.some(id=>!id))return null;
  // `n`: how many controls each send wrote, newest first (0.5.1), so the earlier sends stay apart; links.js leaves off
  // counts that do not add up to the part.
  return normalLink({source:{origin,pageId},siteUrl:entry.s,path:entry.p,uniqueId:entry.u,title:entry.t,part,...(Array.isArray(entry.n)?{sends:entry.n}:{}),titled:entry.ti===1,headed:entry.h===1,sentAt:entry.at,movedAt:entry.mv});
}
// One SharePoint page, as links.js's samePage: by permanent ID where both have one, else by address.
const sameEntry=(a,b)=>a?.s===b?.s&&(a.u&&b.u?lower(a.u)===lower(b.u):lower(a.p)===lower(b.p));
const validMoved=entry=>entry.mv===undefined||Number.isSafeInteger(entry.mv)&&entry.mv>0;
const validEntry=entry=>plain(entry)&&typeof entry.s==='string'&&typeof entry.p==='string'&&Array.isArray(entry.i)&&entry.i.length>0&&entry.i.every(id=>SHORT.test(id))&&
  (entry.u===undefined||typeof entry.u==='string'&&GUID.test(entry.u))&&Number.isSafeInteger(entry.at??0)&&validMoved(entry)&&
  (entry.n===undefined||Array.isArray(entry.n)&&entry.n.length<=16&&entry.n.every(count=>Number.isSafeInteger(count)&&count>0));
// When an entry's address was last set: by its send, or by a move found later.
const placedAt=entry=>Math.max(entry.at??0,entry.mv??0);
// Two copies of one entry, as links.js combines two links: the newer send gives the part, title and flags, the newer
// send or move the address; the copy the account holds wins a tie.
function combined(held,entry){
  const content=(entry.at??0)>(held.at??0)?entry:held,place=placedAt(entry)>placedAt(held)?entry:held,at=placedAt(place),u=place.u??content.u;
  const {mv,...rest}=content;
  return {...rest,p:place.p,...(u?{u}:{}),...(at>(rest.at??0)?{mv:at}:{})};
}
const validMark=mark=>plain(mark)&&typeof mark.s==='string'&&Number.isSafeInteger(mark.at)&&(mark.g===undefined||/^\d{1,20}$/.test(String(mark.g)))&&
  (mark.k===undefined||KINDS.has(mark.k))&&(mark.p===undefined||typeof mark.p==='string')&&(mark.u===undefined||typeof mark.u==='string'||Array.isArray(mark.u));

/**
 * Whether a removal mark takes an entry of the Confluence page `pageId`: a crossed-off or overwritten link (`g`, its
 * version), a page gone (`gone`: by ID, or links without an ID at its address), a page removed in the Sites view
 * (`page`: its address, or its links' IDs), or a site (`site`). Only copies no newer than the mark are taken.
 */
function takes(mark,entry,pageId){
  if(entry.s!==mark.s||(entry.at??0)>mark.at)return false;
  if(mark.g!==undefined)return String(mark.g)===pageId&&sameEntry(mark,entry);
  if(mark.k==='site')return true;
  const ids=[].concat(mark.u??[]).map(lower);
  if(mark.k==='gone')return entry.u?ids.includes(lower(entry.u)):Boolean(mark.p)&&lower(mark.p)===lower(entry.p);
  return Boolean(mark.p)&&lower(mark.p)===lower(entry.p)||Boolean(entry.u)&&ids.includes(lower(entry.u));
}
const dead=(entry,pageId,marks)=>marks.some(mark=>takes(mark,entry,pageId));

// A value read from the account, as this version keeps it; null for one it cannot read (never written over).
function checked(key,value){
  if(!plain(value)||value.v!==VERSION)return null;
  if(key===OFF)return value.off===1&&Number.isSafeInteger(value.at)&&value.at>=0?{v:VERSION,off:1,at:value.at}:null;
  if(key===REMOVED)return Array.isArray(value.marks)?{v:VERSION,marks:value.marks.filter(validMark)}:null;
  if(!plain(value.pages)||value.gone!==undefined&&!Array.isArray(value.gone))return null;
  const pages={};
  for(const [pageId,list] of Object.entries(value.pages)){
    if(!/^\d{1,20}$/.test(pageId)||!Array.isArray(list))continue;
    const entries=list.filter(validEntry);
    if(entries.length)pages[pageId]=entries;
  }
  return {v:VERSION,pages,gone:(value.gone??[]).filter(validMark).filter(mark=>mark.g!==undefined)};
}

const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
// The newest marks that fit in one value, as they are kept: newest first.
function fittingMarks(marks){
  let size=bytes({v:VERSION,marks:[]}),count=0;
  for(const mark of marks){const next=size+bytes(mark)+(count?1:0);if(next>MAX_BYTES)break;size=next;count++;}
  return marks.slice(0,count);
}
// Two marks of the same removal: the same kind, site, address and page IDs.
const markIds=mark=>[].concat(mark.u??[]).map(lower).sort().join(' ');
const sameMark=(a,b)=>a.k===b.k&&a.s===b.s&&lower(a.p)===lower(b.p)&&markIds(a)===markIds(b);

/**
 * An operation applied to the value of one key; null means the key is deleted. `put` adds a link, or takes the newer
 * send's part and the newer address into the account's copy, unless a mark takes it; `drop` marks a link's version
 * removed; `forget` marks a page gone, or a site or page removed in the Sites view; `clear` deletes the key. Applying
 * an operation twice changes nothing more, and the marks stay within what one value may hold.
 */
export function applyOp(key,value,op){
  if(op.op==='clear')return null;
  if(key===REMOVED){
    if(op.op!=='forget')return value;
    const mark={k:op.kind,s:op.siteUrl,...(op.path?{p:op.path}:{}),...(op.uniqueIds?.length?{u:op.uniqueIds}:op.uniqueId?{u:op.uniqueId}:{}),at:op.at};
    // The same removal marked as late or later already covers this one; an earlier mark of it gives way to it.
    const marks=value?.marks??[];
    if(marks.some(other=>sameMark(other,mark)&&other.at>=mark.at))return value;
    return {v:VERSION,marks:fittingMarks([...marks.filter(other=>!sameMark(other,mark)),mark].sort((a,b)=>b.at-a.at).slice(0,MAX_MARKS))};
  }
  if(op.op!=='put'&&op.op!=='drop'||recordKey(op.pageId)!==key)return value;
  const record={v:VERSION,pages:{...(value?.pages??{})},gone:[...(value?.gone??[])]};
  const list=record.pages[op.pageId]??[];
  if(op.op==='put'){
    if(dead(op.entry,op.pageId,record.gone))return value;
    const old=list.find(entry=>sameEntry(entry,op.entry));
    if(old&&(old.at??0)>=(op.entry.at??0)&&placedAt(old)>=placedAt(op.entry))return value;
    record.pages[op.pageId]=[...list.filter(entry=>!sameEntry(entry,op.entry)),old?combined(old,op.entry):op.entry];
    return record;
  }
  const mark={g:op.pageId,s:op.entry.s,...(op.entry.u?{u:op.entry.u}:{p:op.entry.p}),at:op.entry.at??0};
  record.gone=[...record.gone.filter(other=>!(String(other.g)===op.pageId&&sameEntry(other,mark)&&other.at<=mark.at)),mark].sort((a,b)=>b.at-a.at).slice(0,MAX_MARKS);
  const next=list.filter(entry=>!takes(mark,entry,op.pageId));
  if(next.length)record.pages[op.pageId]=next;else delete record.pages[op.pageId];
  return record;
}

/**
 * A record as it is written: without entries a Sites-view mark takes, and within 32,000 bytes. An entry too big to
 * share a record leaves it first, then the oldest marks beyond 50, then the oldest entries; the browsers that sent them
 * keep them, since a copy missing from the account removes nothing.
 */
export function fitted(value,marks=[]){
  const record=structuredClone(value);let dropped=0;
  for(const [pageId,list] of Object.entries(record.pages)){
    const live=list.filter(entry=>!dead(entry,pageId,marks)),kept=live.filter(entry=>bytes(entry)<=MAX_BYTES/2);
    dropped+=live.length-kept.length;
    if(kept.length)record.pages[pageId]=kept;else delete record.pages[pageId];
  }
  while(bytes(record)>MAX_BYTES){
    if(record.gone.length>50){record.gone.pop();continue;}
    let oldest=null;
    for(const [pageId,list] of Object.entries(record.pages))list.forEach((entry,index)=>{if(!oldest||(entry.at??0)<(oldest.entry.at??0))oldest={pageId,index,entry};});
    if(!oldest){if(!record.gone.length)break;record.gone.pop();continue;}
    record.pages[oldest.pageId].splice(oldest.index,1);
    if(!record.pages[oldest.pageId].length)delete record.pages[oldest.pageId];
    dropped++;
  }
  return {value:record,dropped};
}

// The keys an operation reads and writes.
const keysOf=op=>op.op==='put'||op.op==='drop'?[recordKey(op.pageId)]:op.op==='forget'?[REMOVED]:op.op==='clear'?DATA_KEYS:[];
// One of this browser's entries as a removal names it: its Confluence page, and its SharePoint page (by ID, else address).
const identityOf=link=>({g:link.source.pageId,s:link.siteUrl,p:link.path,...(link.uniqueId?{u:link.uniqueId}:{})});
const validIdentity=item=>plain(item)&&typeof item.g==='string'&&/^\d{1,20}$/.test(item.g)&&typeof item.s==='string'&&typeof item.p==='string'&&
  (item.u===undefined||typeof item.u==='string'&&GUID.test(item.u));
// Stored operations are checked before they are used, and go only to Confluence Cloud sites.
function validOp(op){
  if(!plain(op)||!OPS.has(op.op)||typeof op.id!=='string'||!Array.isArray(op.done))return false;
  if(op.origin!==undefined&&(typeof op.origin!=='string'||!ORIGIN.test(op.origin)))return false;
  if(op.op==='put'||op.op==='drop')return Boolean(sourceKey({origin:op.origin,pageId:op.pageId}))&&validEntry(op.entry);
  if(op.op==='forget')return KINDS.has(op.kind)&&Boolean(siteKey(op.siteUrl))&&Number.isSafeInteger(op.at);
  if(op.op==='on')return typeof op.origin==='string'&&Number.isSafeInteger(op.at);
  // A removal queued before 0.5.1 names nothing: this browser's list, as it is when the removal runs, is used.
  return typeof op.origin==='string'&&Number.isSafeInteger(op.at)&&(op.expect===undefined||Array.isArray(op.expect)&&op.expect.every(validIdentity))&&
    (op.waited===undefined||op.waited===true)&&(op.tries===undefined||Number.isSafeInteger(op.tries))&&(op.since===undefined||Number.isSafeInteger(op.since));
}
// A removal that could not be made when the setting was turned off (`waited`), or one queued before 0.5.1, which waited
// through an update: the account signed in now may not be the one signed in then (see holds).
const waitedOp=op=>op.waited===true||op.expect===undefined;
/**
 * Whether the account signed in holds any of the entries `named`, which this browser put there. Confluence answers for
 * whoever is signed in, and the account ID is held in memory only, so a removal that waited (signed out, the worker
 * stopped) could otherwise be made in another account signed in meanwhile, as the review of 0.5.0 found. An account
 * holding none of them, or nothing at all, cannot be told to be the user's, and is left as it is. A removal made at
 * once is made in the account signed in when the user chose it, as every save is, whatever this browser still lists:
 * a site removed in the Sites view before, or Forget all, leaves only marks there.
 */
async function holds(account,named){
  for(const key of new Set(named.map(item=>recordKey(item.g)))){
    let read;
    try{read=await account.read(key);}catch(error){if(error?.kind==='unreadable')continue;throw error;}
    if(read.exists&&named.some(item=>(read.value.pages[item.g]??[]).some(entry=>sameEntry(entry,item))))return true;
  }
  return false;
}

// What went wrong with one Confluence site's account, as said while the setting is on: `reading` when nothing was being
// changed (a read); `missing` when the site answered 404 to whom the sign-in is for, an address every Confluence Cloud
// site serves, so the site is gone.
function problem(kind,origin,{status,reading=false}={}){
  let host=origin;try{host=new URL(origin).host;}catch{/* Named as given. */}
  const error=fail(`account-${kind}`,{
    'signed-out':`Sign in to ${host} to keep your sent pages in your Confluence account. This browser’s list is used meanwhile.`,
    access:`Chrome’s site access for this extension does not include ${host}, so your sent pages can’t be kept in your Confluence account there. Allow access to ${host}.`,
    missing:`The Confluence site ${host} was not found (HTTP 404), so your sent pages can’t be kept in your Confluence account there. This browser’s list is used meanwhile.`,
    unreachable:`Your Confluence account on ${host} did not answer. This browser’s list is used meanwhile.`,
    refused:reading?`Your Confluence account on ${host} could not be read (HTTP ${status}). This browser’s list is used meanwhile.`:
      `Your Confluence account on ${host} did not take the change (HTTP ${status}). This browser’s list is used meanwhile.`,
    unreadable:`The copy in your Confluence account on ${host} is not one this version can read, so it was left as it is. This browser’s list is used meanwhile.`,
    changed:`Your Confluence account on ${host} changed while it was being saved; the change is made again shortly.`}[kind]);
  return Object.assign(error,{kind,host,origin});
}
// The same, while changes for that site wait to be saved there.
const waitingMessage=error=>error?.kind==='unreachable'?`Your Confluence account on ${error.host} did not answer. This browser’s list is used meanwhile, and the changes are saved there when it answers.`:error?.message;
// The same, for a removal still to make after the setting was turned off.
function removalMessage(error){
  if(error?.kind==='signed-out')return `Sign in to ${error.host} so your sent pages can be removed from your Confluence account there.`;
  if(error?.kind==='access')return `Allow this extension’s site access to ${error.host} so your sent pages can be removed from your Confluence account there.`;
  return error?.host?`Your sent pages will be removed from your Confluence account on ${error.host} when it answers.`:'Your sent pages will be removed from your Confluence account when it answers.';
}
// A removal that waited and found none of this browser's entries in the account signed in (see holds). Turned on and
// off again while signed in to the right account, the removal is made at once there.
function skippedMessage(origin){
  let host=origin;try{host=new URL(origin).host;}catch{/* Named as given. */}
  return `Nothing was removed from the Confluence account signed in on ${host}, as none of this browser’s sent pages are kept in it. If it is the account that keeps them, turn Keep in my Confluence account on and off again while signed in to it.`;
}
// A removal given up after failing for two weeks (see lasting): the copy may still be there, and the site is no longer
// listed, so turning the setting on over one of its pages takes it on again (see refreshNow) for the turning off.
function abandonedMessage(origin){
  let host=origin;try{host=new URL(origin).host;}catch{/* Named as given. */}
  return `Your sent pages were not removed from your Confluence account on ${host}, as it did not take the removal for two weeks. To remove them, open a page of ${host} while signed in there, and turn Keep in my Confluence account on and off again.`;
}

// One Confluence site's account, for the signed-in user: only the user's own properties, only the extension's keys.
function client(origin,fetchImpl){
  let who=null;
  async function call(method,path,body){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
    try{
      const response=await fetchImpl(`${origin}/wiki/rest/api/user${path}`,{method,credentials:'include',redirect:'error',signal:controller.signal,
        headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      const text=await response.text();let data=null;
      try{data=text?JSON.parse(text):null;}catch{/* Not JSON. */}
      // Signed out, or another account: the account id is looked up again next time.
      if(response.status===401||response.status===403){who=null;throw problem('signed-out',origin);}
      return {status:response.status,data};
    }catch(error){if(error?.kind)throw error;throw problem('unreachable',origin);}
    finally{clearTimeout(timer);}
  }
  async function me(){
    if(who)return who;
    const answer=await call('GET','/current');
    if(answer.status===200&&answer.data?.type==='known'&&typeof answer.data.accountId==='string'&&/^[A-Za-z0-9:_-]{1,128}$/.test(answer.data.accountId))return who=answer.data.accountId;
    if(answer.status===200)throw problem('signed-out',origin);
    throw problem(answer.status===404?'missing':'refused',origin,{status:answer.status,reading:true});
  }
  const property=async key=>{if(!KEYS.includes(key))throw fail('account-key','Not a key this extension keeps.');return `/${encodeURIComponent(await me())}/property/${key}`;};
  return {
    async read(key){
      const answer=await call('GET',await property(key));
      if(answer.status===404)return {exists:false,value:null};
      if(answer.status!==200)throw problem('refused',origin,{status:answer.status,reading:true});
      const value=checked(key,answer.data?.value);
      if(!value)throw problem('unreadable',origin);
      return {exists:true,value};
    },
    // Made or deleted meanwhile, from another computer: nothing is written over it; the next flush reads it again.
    async write(key,value,exists){
      const answer=await call(exists?'PUT':'POST',await property(key),{value});
      // Making a key is answered 201 or 409, never 404: whom the sign-in is for is asked again, which a site that is gone
      // answers 404 as well (missing), while reads and deletes there only find nothing.
      if(!exists&&answer.status===404){who=null;await me();}
      if(exists&&answer.status===404||!exists&&[400,409].includes(answer.status))throw problem('changed',origin);
      if(![200,201,204].includes(answer.status))throw problem('refused',origin,{status:answer.status});
    },
    async remove(key){
      const answer=await call('DELETE',await property(key));
      if(![200,204,404].includes(answer.status))throw problem('refused',origin,{status:answer.status});
    }
  };
}

export function createAccount({storage=globalThis.chrome?.storage?.local,sync=globalThis.chrome?.storage?.sync,fetchImpl=(...args)=>globalThis.fetch(...args),
  permissions=globalThis.chrome?.permissions,links,now=()=>Date.now()}={}){
  const clients=new Map();
  async function clientFor(origin){
    if(!ORIGIN.test(origin))throw problem('refused',origin,{status:0});
    // Chrome sends nothing to a site whose access the user withheld; that is said, not taken for silence.
    if(permissions?.contains&&!await Promise.resolve(permissions.contains({origins:[`${origin}/*`]})).catch(()=>true))throw problem('access',origin);
    if(!clients.has(origin))clients.set(origin,client(origin,fetchImpl));
    return clients.get(origin);
  }
  const readState=async()=>{
    const value=(await storage.get(STATE))[STATE];
    // `enabledAt`: when the setting was last turned on, which an older note in the account does not turn off again.
    return {enabled:value?.enabled===true,enabledAt:Number.isSafeInteger(value?.enabledAt)&&value.enabledAt>=0?value.enabledAt:0,origins:Array.isArray(value?.origins)?[...new Set(value.origins.filter(origin=>typeof origin==='string'&&ORIGIN.test(origin)))]:[],
      problem:typeof value?.problem==='string'&&value.problem?value.problem.slice(0,400):null,
      // The Confluence site the problem is with, asked again when the popup opens, so a sign-in the user made clears it.
      problemOrigin:typeof value?.problemOrigin==='string'&&ORIGIN.test(value.problemOrigin)?value.problemOrigin:null,
      // The records whose older entries did not fit, as `<site> <key>`, so a site's removal clears its own (0.5.1).
      full:Array.isArray(value?.full)?value.full.filter(item=>typeof item==='string'&&ORIGIN.test(item.split(' ')[0])&&RECORD_KEYS.includes(item.split(' ')[1])):[]};
  };
  // Written only when it changes, so the popup redraws only for news.
  const writeState=async value=>{const was=(await storage.get(STATE))[STATE];if(JSON.stringify(was)!==JSON.stringify(value))await storage.set({[STATE]:value});};
  const readQueue=async()=>{const list=(await storage.get(QUEUE))[QUEUE];return Array.isArray(list)?list.filter(validOp):[];};
  const writeQueue=list=>storage.set({[QUEUE]:list.slice(-MAX_OPS)});
  const stamp=op=>({...op,id:globalThis.crypto.randomUUID(),done:[],...(op.op==='put'||op.op==='drop'?{}:{at:op.at??now()})});
  const putOf=link=>stamp({op:'put',origin:link.source.origin,pageId:link.source.pageId,entry:encodeEntry(link)});
  // The setting as Chrome sync holds it, for every Chrome of the user's where sync is on; written only by the user's own
  // choice (and by a note from a browser without sync), each dated, so the newest choice wins everywhere.
  const readSetting=async()=>{try{const value=(await sync?.get(SETTING))?.[SETTING];return plain(value)&&[0,1].includes(value.on)&&Number.isSafeInteger(value.at)&&value.at>=0?{on:value.on,at:value.at}:null;}catch{return null;}};
  const writeSetting=async(on,at)=>{try{const was=await readSetting();if(!was||was.at<=at)await sync?.set({[SETTING]:{on:on?1:0,at}});}catch{/* Kept in this browser only. */}};
  // Operations added to the queue (under the lock); a newer copy of a link replaces an older one still waiting. While
  // the setting is off nothing but a removal waits, so work begun before it was turned off never goes out later.
  async function append(ops){
    if(!(await readState()).enabled)ops=ops.filter(op=>op.op==='clear');
    if(!ops.length)return;
    let list=await readQueue();
    for(const op of ops){
      if(op.op==='put'||op.op==='drop')list=list.filter(old=>!(old.op===op.op&&old.origin===op.origin&&old.pageId===op.pageId&&!old.done.length&&sameEntry(old.entry,op.entry)&&(old.entry.at??0)<=(op.entry.at??0)&&placedAt(old.entry)<=placedAt(op.entry)));
      if(op.op==='on')list=list.filter(old=>!(old.op==='on'&&old.origin===op.origin));
      list.push(op);
    }
    await writeQueue(list);
  }
  // Storage-only changes of the state and the queue, one at a time and never waiting on the network.
  let lock=Promise.resolve();
  const locked=work=>{const next=lock.then(work);lock=next.catch(()=>{});return next;};
  // The account's own work, one piece at a time; a flush asked for while one already waits is not asked twice.
  // `failedKind`: what the last failure was; a sign-in or a site-access grant is the user's to make, and the popup's
  // opening after one checks again at once, while any other failure waits RETRY_MS.
  let net=Promise.resolve(),pending=false,failedAt=0,failedKind=null,races=0;
  const usersToFix=kind=>kind==='signed-out'||kind==='access';
  const onNet=work=>{const next=net.then(work);net=next.catch(()=>{});return next;};
  function schedule(){if(pending)return;pending=true;void onNet(async()=>{pending=false;await flush();});}

  // A Confluence site this browser sends pages from, or whose account holds the extension's data: its links from that
  // site go there, and an off note there older than the setting's turning on goes (under the lock).
  async function adopt(origin){
    const state=await readState();
    if(!state.enabled||state.origins.includes(origin))return;
    await writeState({...state,origins:[...state.origins,origin]});
    await append([...(await links.list()).filter(link=>link.source.origin===origin).map(putOf),stamp({op:'on',origin})]);
  }
  // Turned on (by the user here, or through Chrome sync): the links go to the Confluence sites they came from, and an
  // older off note goes from every site this browser used, links or not.
  async function turnOn(at){
    await locked(async()=>{
      const state=await readState();
      await writeState({...state,enabled:true,enabledAt:at,problem:null,problemOrigin:null});
      const local=await links.list();
      // A site used before (its removal after the setting was last turned off may still wait) gets them again.
      await append([...local.filter(link=>state.origins.includes(link.source.origin)).map(putOf),...state.origins.map(origin=>stamp({op:'on',origin}))]);
      for(const origin of new Set(local.map(link=>link.source.origin)))await adopt(origin);
    });
    failedAt=0;failedKind=null;
  }
  // Turned off (here, through Chrome sync, or by a note another browser left): the extension's data goes from every
  // Confluence site this browser used, with a note dated `at`; nothing more is sent. `said`: why, when not the user's here.
  async function turnOff(at,said=null){
    await locked(async()=>{
      const state=await readState(),local=await links.list(),waiting=await readQueue();
      // Already off, it keeps saying why (another computer turned it off), whatever turns it off again.
      await writeState({...state,enabled:false,problem:said??(state.enabled?null:state.problem),problemOrigin:said||state.enabled?null:state.problemOrigin});
      // Each removal names this browser's entries from that site (and those a removal still waiting named), so that,
      // should it have to wait, it is made only in the account holding them (see holds); the list is read before Forget
      // all clears it.
      const earlier=origin=>waiting.filter(op=>op.op==='clear'&&op.origin===origin);
      const named=origin=>[...new Map([...earlier(origin).flatMap(op=>op.expect??[]),
        ...local.filter(link=>link.source.origin===origin).map(identityOf)].map(item=>[JSON.stringify(item),item])).values()];
      // A removal still waiting keeps its count of failed tries, and when they began (see lasting).
      const tried=origin=>{const tries=Math.max(0,...earlier(origin).map(op=>op.tries??0)),since=Math.min(...earlier(origin).map(op=>op.since??Infinity));
        return {...(tries?{tries}:{}),...(Number.isFinite(since)?{since}:{})};};
      await writeQueue(state.origins.map(origin=>stamp({op:'clear',origin,at,expect:named(origin),...tried(origin)})));
    });
    failedAt=0;failedKind=null;
    void onNet(flush).catch(()=>{});
  }
  // A note in the account newer than this browser's turning on: the setting was turned off on another computer. It is
  // off here too, in Chrome sync as well, dated as the note is.
  async function offElsewhere(at){
    if(!(await readState()).enabled)return;
    // This browser first, so the change coming back through Chrome sync finds it already off.
    await turnOff(at,ELSEWHERE);
    await writeSetting(false,at);
  }
  const complete=(op,state)=>op.origin?op.done.includes(op.origin):state.origins.length>0&&state.origins.every(origin=>op.done.includes(origin));

  // A removal failing LASTING_TRIES times over LASTING_MS, given up while the setting stays off (see flush): waiting
  // would only keep a message nothing clears.
  const lasting=(clear,error)=>error?.kind!=='changed'&&(clear.tries??0)+1>=LASTING_TRIES&&now()-(clear.since??now())>=LASTING_MS;

  // Applies the queued operations to every account they are for. The operations added meanwhile stay queued.
  async function flush(){
    const state=await readState(),queue=await readQueue();
    // While the setting is off, only the removal of what was kept goes out.
    const work=state.enabled?queue:queue.filter(op=>op.op==='clear');
    const targets=op=>op.origin?[op.origin]:state.origins;
    // The site the popup says something about is asked again even with nothing waiting for it (its note read, nothing
    // written), so the message goes once the user has signed in or allowed access there.
    const probe=state.enabled&&state.problem?state.problemOrigin:null;
    const doneBy=new Map(),full=new Set(state.full),skipped=[],abandoned=[],waited=new Set(),givenUp=new Set(),failures=[];let offAt=0;
    const done=(op,origin)=>{if(!doneBy.has(op.id))doneBy.set(op.id,new Set());doneBy.get(op.id).add(origin);};
    for(const origin of [...new Set([...work.flatMap(targets),...(probe?[probe]:[])])]){
      const ops=work.filter(op=>targets(op).includes(origin)&&!op.done.includes(origin));
      if(!ops.length&&origin!==probe)continue;
      try{
        const account=await clientFor(origin),values=new Map();
        const last=ops.map(op=>op.op).lastIndexOf('clear'),after=last>=0?ops.slice(last+1):ops;
        if(last>=0){
          // Removed, then noted as turned off (dated as the choice was), for the browsers that have no Chrome sync. One
          // that waited, only in the account holding this browser's entries; elsewhere nothing is removed or noted, the
          // removal is done, and the site stays among those holding the copy, for turning it on and off again.
          const clears=ops.filter(op=>op.op==='clear');
          const mine=!clears.some(waitedOp)||await holds(account,[...clears.flatMap(op=>op.expect??[]),...(await links.list()).filter(link=>link.source.origin===origin).map(identityOf)]);
          if(mine)for(const key of DATA_KEYS)await account.remove(key);else skipped.push(origin);
          // Turned on again since (what follows the removal was queued while it was on): no note is left, and an older
          // one goes, removed or not, as what follows is saved there; one newer than the turning on stops this browser.
          if(after.length){
            const note=await account.read(OFF);
            if(note.exists&&note.value.at>state.enabledAt){offAt=Math.max(offAt,note.value.at);continue;}
            if(note.exists)await account.remove(OFF);
          }else if(mine){
            const note=await account.read(OFF),at=Math.max(ops[last].at??0,note.value?.at??0);
            if(!note.exists||note.value.at<at)await account.write(OFF,{v:VERSION,off:1,at},note.exists);
          }
          if(mine)for(const key of DATA_KEYS)values.set(key,{exists:false,value:null,before:'null'});
        }else{
          // Before anything is saved: a note of the setting turned off after it was turned on here stops this browser;
          // an older one is left from before and goes.
          const note=await account.read(OFF);
          if(note.exists&&note.value.at>state.enabledAt){offAt=Math.max(offAt,note.value.at);continue;}
          if(note.exists&&ops.length)await account.remove(OFF);
        }
        const keys=new Set(after.flatMap(keysOf));
        // Records are written without what the Sites view removed, so its marks are read with them.
        if([...keys].some(key=>RECORD_KEYS.includes(key)))keys.add(REMOVED);
        for(const key of keys)if(!values.has(key)){const read=await account.read(key);values.set(key,{...read,before:JSON.stringify(read.value)});}
        for(const op of after)for(const key of keysOf(op)){const entry=values.get(key);entry.value=applyOp(key,entry.value,op);}
        const marks=values.get(REMOVED)?.value?.marks??[];
        for(const [key,entry] of values){
          // A record removed takes its note that older entries did not fit with it.
          if(entry.value===null){full.delete(`${origin} ${key}`);if(entry.exists)await account.remove(key);continue;}
          let value=entry.value;
          if(RECORD_KEYS.includes(key)){const fit=fitted(value,marks);value=fit.value;if(fit.dropped)full.add(`${origin} ${key}`);else full.delete(`${origin} ${key}`);}
          if(JSON.stringify(value)===entry.before)continue;
          await account.write(key,value,entry.exists);
        }
        for(const op of ops)done(op,origin);
      }catch(error){
        // Given up while the setting is off (only removals wait then), and said: turned on again, a removal waits for
        // the next turning off, which the site must be listed for.
        if(!state.enabled&&ops.some(op=>op.op==='clear'&&lasting(op,error))){givenUp.add(origin);abandoned.push(origin);for(const op of ops)done(op,origin);continue;}
        // A site that is gone (see problem) took its account with it: nothing is left to remove or mark there, nor a
        // note. The site leaves the list unless this browser's links wait for it, which are said; a send from it or the
        // popup over its page takes it on again, should it answer again.
        if(error?.kind==='missing'){
          givenUp.add(origin);for(const op of ops)if(op.op!=='put'&&op.op!=='drop')done(op,origin);
          if(!ops.some(op=>op.op==='put'||op.op==='drop'))continue;
        }
        failures.push({error,origin,waiting:ops.some(op=>op.op!=='clear'&&op.op!=='on')});
        // A removal not made now waits, and is then checked (see holds); a key changed meanwhile is tried again at once.
        if(error?.kind!=='changed')for(const op of ops)if(op.op==='clear')waited.add(op.id);
      }
    }
    // What the user can fix (a sign-in, site access) is said first; each site's problem is said, as far as they fit.
    failures.sort((a,b)=>Number(usersToFix(b.error?.kind))-Number(usersToFix(a.error?.kind)));
    const failure=failures[0]?.error??null;
    await locked(async()=>{
      const current=await readQueue();
      for(const op of current){
        const by=doneBy.get(op.id);if(by)op.done=[...new Set([...op.done,...by])];
        if(waited.has(op.id)){op.waited=true;op.tries=(op.tries??0)+1;op.since??=now();}
      }
      // A site whose copy was removed stays listed, as it holds the note that turning the setting on removes; one whose
      // removal was given up does not, unless work for it was queued meanwhile (turned on again), which keeps it listed
      // for the next turning off.
      const latest=await readState(),kept=origin=>current.some(op=>op.origin===origin&&!op.done.includes(origin));
      const origins=latest.origins.filter(origin=>!givenUp.has(origin)||kept(origin));
      const remaining=current.filter(op=>!complete(op,{...latest,origins}));
      await writeQueue(remaining);
      const removing=origin=>!latest.enabled&&remaining.some(op=>op.op==='clear'&&op.origin===origin);
      // Each site's problem is said, as far as they fit; off, so are the removals given up or not made.
      const texts=[...failures.map(({error,origin,waiting})=>removing(origin)?removalMessage(error):waiting?waitingMessage(error):error?.message),
        ...(latest.enabled?[]:[...abandoned.map(abandonedMessage),...skipped.map(skippedMessage)])];
      let message=null;
      for(const text of new Set(texts.filter(text=>typeof text==='string'&&text))){
        const next=message?`${message} ${text}`:text;if(next.length>400)break;message=next;
      }
      // Off because another computer turned it off: that stays said until it is turned on again.
      message??=!latest.enabled&&latest.problem===ELSEWHERE?ELSEWHERE:null;
      await writeState({...latest,origins,full:[...full].filter(item=>origins.includes(item.split(' ')[0])||!givenUp.has(item.split(' ')[0])),problem:message,
        problemOrigin:message&&failure?failures[0].origin:null});
    });
    // A key another computer made or deleted meanwhile is read and written again at once, a few times; any other
    // failure waits before the popup tries again.
    if(offAt){await offElsewhere(offAt);return !failure;}
    if(failures.some(item=>item.error?.kind==='changed')&&races<3){races++;failedAt=0;schedule();}
    else{races=0;failedAt=failure?now():0;failedKind=failure?.kind??null;}
    return !failure;
  }
  // Whether the account holds any record besides `skip`: one it cannot read counts, since it is there.
  async function anyRecord(account,skip){
    for(const key of RECORD_KEYS.filter(key=>key!==skip)){
      try{if((await account.read(key)).exists)return true;}catch(error){if(error?.kind==='unreadable')return true;throw error;}
    }
    return false;
  }
  // Merges the account's copy of one Confluence page's links into this browser's, once nothing for that site waits.
  // `chosen`: the user turned the setting on over this page, rather than only opened the popup there.
  async function refreshNow(key,{chosen=false}={}){
    let state=await readState();
    if(!state.enabled)return;
    await flush();
    state=await readState();
    const waiting=(await readQueue()).some(op=>op.origin?op.origin===key.origin:state.origins.includes(key.origin)&&!op.done.includes(key.origin));
    if(waiting)return;
    try{
      const account=await clientFor(key.origin),known=state.origins.includes(key.origin);
      // Turned off on another computer since it was turned on here: off here too, and nothing of the account is taken.
      const note=await account.read(OFF);
      if(note.exists&&note.value.at>state.enabledAt){await offElsewhere(note.value.at);return;}
      const record=await account.read(recordKey(key.pageId)),removed=await account.read(REMOVED);
      // Turned off while the account was read: nothing of it is taken, or sent back.
      if(!(await readState()).enabled)return;
      // A Confluence site where this browser sent nothing is taken on when the account holds anything of the extension
      // there (a record, removal marks, the note that it was turned off), so turning the setting off here reaches it;
      // every record is looked for only when the user turns the setting on over its page, as that reads 31 keys more.
      // A site holding nothing of it is left alone: nothing is written there.
      if(!known&&!record.exists&&!removed.exists&&!note.exists&&!(chosen&&await anyRecord(account,recordKey(key.pageId))))return;
      if(!known){await locked(()=>adopt(key.origin));schedule();}
      const marks=[...(record.value?.gone??[]),...(removed.value?.marks??[])];
      const entries=(record.value?.pages?.[key.pageId]??[]).map(entry=>decodeEntry(key.origin,key.pageId,entry)).filter(Boolean);
      const {heal}=await links.merge(key,entries,link=>dead(encodeEntry(link),key.pageId,marks));
      if(heal.length){await locked(()=>append(heal.map(putOf)));schedule();}
      if(!failedAt)await locked(async()=>{const latest=await readState();if(latest.problem)await writeState({...latest,problem:null,problemOrigin:null});});
    }catch(error){
      // A site this browser uses nothing on, read anonymously (a public page), is not one to sign in to for this;
      // turned on over its page, the user asked for it.
      if(error?.kind==='signed-out'&&!chosen&&!state.origins.includes(key.origin))return;
      failedAt=now();failedKind=error?.kind??null;
      await locked(async()=>{const latest=await readState();await writeState({...latest,problem:typeof error?.message==='string'?error.message:'Your Confluence account did not answer.',
        problemOrigin:typeof error?.origin==='string'&&ORIGIN.test(error.origin)?error.origin:key.origin});});
    }
  }
  // Operations for the account, dated and queued, then sent; nothing is kept in the account while the setting is off.
  async function enqueue(ops){
    const added=await locked(async()=>{
      const state=await readState();
      if(!state.enabled||!ops.length)return false;
      for(const origin of new Set(ops.map(op=>op.origin).filter(Boolean)))await adopt(origin);
      await append(ops.map(stamp));
      return true;
    });
    if(added)schedule();
  }

  return {
    /** Whether the setting is on, and what the account last had to say, if anything. */
    state:async()=>{const {enabled,problem:said,full}=await readState();return {enabled,problem:said??(enabled&&full.length?FULL:null)};},
    /**
     * The user turns the setting on: for every Chrome of theirs with sync on, and here, where this browser's links go
     * to the Confluence sites they came from; then the Confluence page in the tab, if any, is merged with its copy.
     */
    async enable({origin,pageId}={}){
      const key=sourceKey({origin,pageId}),at=now();
      // This browser first, so its own change coming back through Chrome sync finds it already on.
      await turnOn(at);
      await writeSetting(true,at);
      void onNet(()=>key?refreshNow(key,{chosen:true}):flush()).catch(()=>{});
    },
    /** The user turns the setting off: for every Chrome of theirs with sync on, and here: see turnOff. */
    async disable(){
      const at=now();
      await turnOff(at);
      await writeSetting(false,at);
    },
    /**
     * A change of the setting Chrome sync brought, or this browser's own coming back, which changes nothing. An undated
     * value (a first start's, from a browser where it was never chosen) is no choice: it changes nothing here.
     */
    async synced(value){
      if(!plain(value)||![0,1].includes(value.on)||!Number.isSafeInteger(value.at)||value.at<=0)return;
      const state=await readState(),on=value.on===1,at=value.at;
      // Already on, and turned on again later elsewhere (this browser missed the Off between, as Chrome sync brings only
      // its last value): dated as that choice, so an off note left between them is older. Nothing is sent again.
      if(on&&state.enabled&&value.at>state.enabledAt)await locked(async()=>{const latest=await readState();if(latest.enabled&&value.at>latest.enabledAt)await writeState({...latest,enabledAt:value.at});});
      if(on===state.enabled)return;
      if(on){await turnOn(at);void onNet(flush).catch(()=>{});}
      else await turnOff(at);
    },
    /**
     * At the background's start: a setting Chrome sync does not hold yet (first start of 0.4.9) goes there undated, so
     * a choice made on another computer wins; one it holds is followed.
     */
    async start(){
      const held=await readSetting(),state=await readState();
      if(!held){try{await sync?.set({[SETTING]:{on:state.enabled?1:0,at:0}});}catch{/* Kept in this browser only. */}return;}
      await this.synced(held);
    },
    /** The Confluence page in the tab, merged with its account copy, once this browser's changes are in. */
    refresh({origin,pageId}={}){
      const key=sourceKey({origin,pageId});
      if(!key)return Promise.resolve();
      return onNet(()=>refreshNow(key)).catch(()=>{});
    },
    /** What the sent list reports it changed (links.js `watch`): links added or altered, and links removed on purpose. */
    changed({added=[],removed=[]}={}){
      return enqueue([...removed.map(link=>({op:'drop',origin:link.source.origin,pageId:link.source.pageId,entry:encodeEntry(link)})),
        ...added.map(link=>({op:'put',origin:link.source.origin,pageId:link.source.pageId,entry:encodeEntry(link)}))]).catch(()=>{});
    },
    /** The Sites view's and the jobs' own operations: forget a site, a page, or a page gone. */
    queue(ops){
      const valid=(Array.isArray(ops)?ops:[]).filter(op=>op?.op==='forget');
      return valid.length?enqueue(valid).catch(()=>{}):Promise.resolve();
    },
    /**
     * Sends what waits, as when the popup opens, and asks again a site the popup says something about; not again for
     * a while after the account did not answer, but at once after a sign-in or an access grant, which the user makes.
     */
    retry(){
      if(failedAt&&now()-failedAt<RETRY_MS&&!usersToFix(failedKind))return;
      void Promise.all([readQueue(),readState()]).then(([queue,state])=>{if(queue.length||state.enabled&&state.problem&&state.problemOrigin)schedule();},()=>{});
    },
    /** Settles when every piece of work started so far has finished. */
    async idle(){for(;;){const n=net,l=lock;await n;await l;await new Promise(resolve=>setTimeout(resolve,0));if(n===net&&l===lock)return;}}
  };
}
