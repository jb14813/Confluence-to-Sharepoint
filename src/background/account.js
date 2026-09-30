// The sent list, also kept in the user's own Confluence account when the user turns on "Keep in my Confluence account"
// in the popup's Sites view (0.4.7): private user properties of the user's own account on each Confluence Cloud site
// the user sends pages from, which, as Atlassian documents, only that account can read ("Only the
// app itself can access user properties, no other app or user can access properties created by another app or user":
// https://developer.atlassian.com/cloud/confluence/confluence-entity-properties/). No other server is involved.
//
// The account copy is the union of what every browser with the setting on has sent: this browser's list stays the
// working copy, and a copy missing from the account never removes anything here. Of two copies of a link, the newer
// (by the time it was sent) stays. Removals travel as dated marks, which remove only copies no newer than themselves:
// a link crossed off or overwritten (its version), a page gone, and a site or page removed in the Sites view. Changes
// wait in a queue in local storage until Confluence takes them; they never hold up a capture, a send or the popup.
//
// The setting is one for all the user's Chrome browsers (0.4.9): Chrome sync holds it (`accountCopy`, dated), and every
// browser follows the newest. Turning it off also leaves a dated note in the account (`off`), so a browser without
// Chrome sync turns itself off the next time it saves or reads there; turning it on removes the note. The pinned sites
// are synced by Chrome too (pins.js), no longer kept in the account.
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
const OPS=new Set(['put','drop','forget','clear']),KINDS=new Set(['site','page','gone']);
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

/** A link as its account record keeps it: site, path, page ID, title, part, whether it titles the page, heading, time sent. */
export const encodeEntry=link=>({s:link.siteUrl,p:link.path,...(link.uniqueId?{u:link.uniqueId}:{}),t:link.title??'',i:link.part.map(shortId),ti:link.titled?1:0,h:link.headed?1:0,at:link.sentAt??0});
/** An account record's entry as a link of the Confluence page `pageId` on `origin`, rebuilt field by field, or null. */
export function decodeEntry(origin,pageId,entry){
  if(!plain(entry)||!Array.isArray(entry.i))return null;
  const part=entry.i.map(longId);
  if(part.some(id=>!id))return null;
  return normalLink({source:{origin,pageId},siteUrl:entry.s,path:entry.p,uniqueId:entry.u,title:entry.t,part,titled:entry.ti===1,headed:entry.h===1,sentAt:entry.at});
}
// One SharePoint page, as links.js's samePage: by permanent ID where both have one, else by address.
const sameEntry=(a,b)=>a?.s===b?.s&&(a.u&&b.u?lower(a.u)===lower(b.u):lower(a.p)===lower(b.p));
const validEntry=entry=>plain(entry)&&typeof entry.s==='string'&&typeof entry.p==='string'&&Array.isArray(entry.i)&&entry.i.length>0&&entry.i.every(id=>SHORT.test(id))&&
  (entry.u===undefined||typeof entry.u==='string'&&GUID.test(entry.u))&&Number.isSafeInteger(entry.at??0);
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
 * An operation applied to the value of one key; null means the key is deleted. `put` adds or replaces a link unless the
 * account's copy is as new or a mark takes it; `drop` marks a link's version removed; `forget` marks a page gone, or a
 * site or page removed in the Sites view; `clear` deletes the key. Applying an operation twice changes nothing more,
 * and the marks stay within what one value may hold.
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
    if(old&&(old.at??0)>=(op.entry.at??0))return value;
    record.pages[op.pageId]=[...list.filter(entry=>!sameEntry(entry,op.entry)),op.entry];
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
const keysOf=op=>op.op==='put'||op.op==='drop'?[recordKey(op.pageId)]:op.op==='forget'?[REMOVED]:DATA_KEYS;
// Stored operations are checked before they are used, and go only to Confluence Cloud sites.
function validOp(op){
  if(!plain(op)||!OPS.has(op.op)||typeof op.id!=='string'||!Array.isArray(op.done))return false;
  if(op.origin!==undefined&&(typeof op.origin!=='string'||!ORIGIN.test(op.origin)))return false;
  if(op.op==='put'||op.op==='drop')return Boolean(sourceKey({origin:op.origin,pageId:op.pageId}))&&validEntry(op.entry);
  if(op.op==='forget')return KINDS.has(op.kind)&&Boolean(siteKey(op.siteUrl))&&Number.isSafeInteger(op.at);
  return typeof op.origin==='string'&&Number.isSafeInteger(op.at);
}

// What went wrong with one Confluence site's account, as said while the setting is on.
function problem(kind,origin,status){
  let host=origin;try{host=new URL(origin).host;}catch{/* Named as given. */}
  const error=fail(`account-${kind}`,{
    'signed-out':`Sign in to ${host} to keep your sent pages in your Confluence account. This browser’s list is used meanwhile.`,
    access:`Chrome’s site access for this extension does not include ${host}, so your sent pages can’t be kept in your Confluence account there. Allow access to ${host}.`,
    unreachable:`Your Confluence account on ${host} did not answer. This browser’s list is used meanwhile, and the changes are saved there when it answers.`,
    refused:`Your Confluence account on ${host} did not take the change (HTTP ${status}). This browser’s list is used meanwhile.`,
    unreadable:`The copy in your Confluence account on ${host} is not one this version can read, so it was left as it is. This browser’s list is used meanwhile.`,
    changed:`Your Confluence account on ${host} changed while it was being saved; the change is made again shortly.`}[kind]);
  return Object.assign(error,{kind,host});
}
// The same, for a removal still to make after the setting was turned off.
function removalMessage(error){
  if(error?.kind==='signed-out')return `Sign in to ${error.host} so your sent pages can be removed from your Confluence account there.`;
  if(error?.kind==='access')return `Allow this extension’s site access to ${error.host} so your sent pages can be removed from your Confluence account there.`;
  return error?.host?`Your sent pages will be removed from your Confluence account on ${error.host} when it answers.`:'Your sent pages will be removed from your Confluence account when it answers.';
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
    throw problem('refused',origin,answer.status);
  }
  const property=async key=>{if(!KEYS.includes(key))throw fail('account-key','Not a key this extension keeps.');return `/${encodeURIComponent(await me())}/property/${key}`;};
  return {
    async read(key){
      const answer=await call('GET',await property(key));
      if(answer.status===404)return {exists:false,value:null};
      if(answer.status!==200)throw problem('refused',origin,answer.status);
      const value=checked(key,answer.data?.value);
      if(!value)throw problem('unreadable',origin);
      return {exists:true,value};
    },
    // Made or deleted meanwhile, from another computer: nothing is written over it; the next flush reads it again.
    async write(key,value,exists){
      const answer=await call(exists?'PUT':'POST',await property(key),{value});
      if(exists&&answer.status===404||!exists&&[400,409].includes(answer.status))throw problem('changed',origin);
      if(![200,201,204].includes(answer.status))throw problem('refused',origin,answer.status);
    },
    async remove(key){
      const answer=await call('DELETE',await property(key));
      if(![200,204,404].includes(answer.status))throw problem('refused',origin,answer.status);
    }
  };
}

export function createAccount({storage=globalThis.chrome?.storage?.local,sync=globalThis.chrome?.storage?.sync,fetchImpl=(...args)=>globalThis.fetch(...args),
  permissions=globalThis.chrome?.permissions,links,now=()=>Date.now()}={}){
  const clients=new Map();
  async function clientFor(origin){
    if(!ORIGIN.test(origin))throw problem('refused',origin,0);
    // Chrome sends nothing to a site whose access the user withheld; that is said, not taken for silence.
    if(permissions?.contains&&!await Promise.resolve(permissions.contains({origins:[`${origin}/*`]})).catch(()=>true))throw problem('access',origin);
    if(!clients.has(origin))clients.set(origin,client(origin,fetchImpl));
    return clients.get(origin);
  }
  const readState=async()=>{
    const value=(await storage.get(STATE))[STATE];
    // `enabledAt`: when the setting was last turned on, which an older note in the account does not turn off again.
    return {enabled:value?.enabled===true,enabledAt:Number.isSafeInteger(value?.enabledAt)&&value.enabledAt>=0?value.enabledAt:0,origins:Array.isArray(value?.origins)?[...new Set(value.origins.filter(origin=>typeof origin==='string'&&ORIGIN.test(origin)))]:[],
      problem:typeof value?.problem==='string'&&value.problem?value.problem.slice(0,400):null,full:Array.isArray(value?.full)?value.full.filter(key=>RECORD_KEYS.includes(key)):[]};
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
      if(op.op==='put'||op.op==='drop')list=list.filter(old=>!(old.op===op.op&&old.origin===op.origin&&old.pageId===op.pageId&&!old.done.length&&sameEntry(old.entry,op.entry)&&(old.entry.at??0)<=(op.entry.at??0)));
      list.push(op);
    }
    await writeQueue(list);
  }
  // Storage-only changes of the state and the queue, one at a time and never waiting on the network.
  let lock=Promise.resolve();
  const locked=work=>{const next=lock.then(work);lock=next.catch(()=>{});return next;};
  // The account's own work, one piece at a time; a flush asked for while one already waits is not asked twice.
  let net=Promise.resolve(),pending=false,failedAt=0,races=0;
  const onNet=work=>{const next=net.then(work);net=next.catch(()=>{});return next;};
  function schedule(){if(pending)return;pending=true;void onNet(async()=>{pending=false;await flush();});}

  // A Confluence site this browser sends pages from: its links from that site go there (under the lock).
  async function adopt(origin){
    const state=await readState();
    if(!state.enabled||state.origins.includes(origin))return;
    await writeState({...state,origins:[...state.origins,origin]});
    await append((await links.list()).filter(link=>link.source.origin===origin).map(putOf));
  }
  // Turned on (by the user here, or through Chrome sync): the links go to the Confluence sites they came from.
  async function turnOn(at){
    await locked(async()=>{
      const state=await readState();
      await writeState({...state,enabled:true,enabledAt:at,problem:null});
      const local=await links.list();
      // A site used before (its removal after the setting was last turned off may still wait) gets them again.
      await append(local.filter(link=>state.origins.includes(link.source.origin)).map(putOf));
      for(const origin of new Set(local.map(link=>link.source.origin)))await adopt(origin);
    });
    failedAt=0;
  }
  // Turned off (here, through Chrome sync, or by a note another browser left): the extension's data goes from every
  // Confluence site this browser used, with a note dated `at`; nothing more is sent. `said`: why, when not the user's here.
  async function turnOff(at,said=null){
    await locked(async()=>{
      const state=await readState();
      // Already off, it keeps saying why (another computer turned it off), whatever turns it off again.
      await writeState({...state,enabled:false,problem:said??(state.enabled?null:state.problem)});
      await writeQueue(state.origins.map(origin=>stamp({op:'clear',origin,at})));
    });
    failedAt=0;
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

  // Applies the queued operations to every account they are for. The operations added meanwhile stay queued.
  async function flush(){
    const state=await readState(),queue=await readQueue();
    // While the setting is off, only the removal of what was kept goes out.
    const work=state.enabled?queue:queue.filter(op=>op.op==='clear');
    const targets=op=>op.origin?[op.origin]:state.origins;
    const doneBy=new Map(),full=new Set(state.full),cleared=new Set();let failure=null,offAt=0;
    for(const origin of [...new Set(work.flatMap(targets))]){
      const ops=work.filter(op=>targets(op).includes(origin)&&!op.done.includes(origin));
      if(!ops.length)continue;
      try{
        const account=await clientFor(origin),values=new Map();
        const last=ops.map(op=>op.op).lastIndexOf('clear');
        if(last>=0){
          // Removed, then noted as turned off (dated as the choice was), for the browsers that have no Chrome sync.
          for(const key of DATA_KEYS)await account.remove(key);
          const note=await account.read(OFF),at=Math.max(ops[last].at??0,note.value?.at??0);
          if(!note.exists||note.value.at<at)await account.write(OFF,{v:VERSION,off:1,at},note.exists);
          for(const key of DATA_KEYS)values.set(key,{exists:false,value:null,before:'null'});cleared.add(origin);
        }else{
          // Before anything is saved: a note of the setting turned off after it was turned on here stops this browser;
          // an older one is left from before and goes.
          const note=await account.read(OFF);
          if(note.exists&&note.value.at>state.enabledAt){offAt=Math.max(offAt,note.value.at);continue;}
          if(note.exists)await account.remove(OFF);
        }
        const after=last>=0?ops.slice(last+1):ops,keys=new Set(after.flatMap(keysOf));
        // Records are written without what the Sites view removed, so its marks are read with them.
        if([...keys].some(key=>RECORD_KEYS.includes(key)))keys.add(REMOVED);
        for(const key of keys)if(!values.has(key)){const read=await account.read(key);values.set(key,{...read,before:JSON.stringify(read.value)});}
        for(const op of after)for(const key of keysOf(op)){const entry=values.get(key);entry.value=applyOp(key,entry.value,op);}
        const marks=values.get(REMOVED)?.value?.marks??[];
        for(const [key,entry] of values){
          if(entry.value===null){if(entry.exists)await account.remove(key);continue;}
          let value=entry.value;
          if(RECORD_KEYS.includes(key)){const fit=fitted(value,marks);value=fit.value;if(fit.dropped)full.add(key);else full.delete(key);}
          if(JSON.stringify(value)===entry.before)continue;
          await account.write(key,value,entry.exists);
        }
        for(const op of ops){if(!doneBy.has(op.id))doneBy.set(op.id,new Set());doneBy.get(op.id).add(origin);}
      }catch(error){failure??=error;}
    }
    await locked(async()=>{
      const current=await readQueue();
      for(const op of current){const done=doneBy.get(op.id);if(done)op.done=[...new Set([...op.done,...done])];}
      const latest=await readState(),remaining=current.filter(op=>!complete(op,latest));
      await writeQueue(remaining);
      const origins=latest.enabled?latest.origins:latest.origins.filter(origin=>!cleared.has(origin));
      // Off because another computer turned it off: that stays said until it is turned on again.
      const message=failure?(!latest.enabled&&remaining.some(op=>op.op==='clear')?removalMessage(failure):failure.message):!latest.enabled&&latest.problem===ELSEWHERE?ELSEWHERE:null;
      await writeState({...latest,origins,full:[...full],problem:message});
    });
    // A key another computer made or deleted meanwhile is read and written again at once, a few times; any other
    // failure waits before the popup tries again.
    if(offAt){await offElsewhere(offAt);return !failure;}
    if(failure?.kind==='changed'&&races<3){races++;failedAt=0;schedule();}
    else{races=0;failedAt=failure?now():0;}
    return !failure;
  }
  // Merges the account's copy of one Confluence page's links into this browser's, once nothing for that site waits.
  async function refreshNow(key){
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
      // A Confluence site where this browser sent nothing and the account holds nothing of the extension is left
      // alone: nothing is written there.
      if(!known&&!record.exists&&!removed.exists)return;
      if(!known)await locked(()=>adopt(key.origin));
      const marks=[...(record.value?.gone??[]),...(removed.value?.marks??[])];
      const entries=(record.value?.pages?.[key.pageId]??[]).map(entry=>decodeEntry(key.origin,key.pageId,entry)).filter(Boolean);
      const {heal}=await links.merge(key,entries,link=>dead(encodeEntry(link),key.pageId,marks));
      if(heal.length){await locked(()=>append(heal.map(putOf)));schedule();}
      if(!failedAt)await locked(async()=>{const latest=await readState();if(latest.problem)await writeState({...latest,problem:null});});
    }catch(error){
      failedAt=now();
      await locked(async()=>{const latest=await readState();await writeState({...latest,problem:typeof error?.message==='string'?error.message:'Your Confluence account did not answer.'});});
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
      void onNet(()=>key?refreshNow(key):flush()).catch(()=>{});
    },
    /** The user turns the setting off: for every Chrome of theirs with sync on, and here: see turnOff. */
    async disable(){
      const at=now();
      await turnOff(at);
      await writeSetting(false,at);
    },
    /** A change of the setting Chrome sync brought, or this browser's own coming back, which changes nothing. */
    async synced(value){
      if(!plain(value)||![0,1].includes(value.on))return;
      const state=await readState(),on=value.on===1,at=Number.isSafeInteger(value.at)&&value.at>0?value.at:now();
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
    /** Sends what waits, as when the popup opens; not again for a while after the account did not answer. */
    retry(){
      if(failedAt&&now()-failedAt<RETRY_MS)return;
      void readQueue().then(queue=>{if(queue.length)schedule();},()=>{});
    },
    /** Settles when every piece of work started so far has finished. */
    async idle(){for(;;){const n=net,l=lock;await n;await l;await new Promise(resolve=>setTimeout(resolve,0));if(n===net&&l===lock)return;}}
  };
}
