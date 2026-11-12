import {siteKey,pageKey} from './sites.js';
import {confirmedPageUrl} from './checks.js';
const KEY='file-pages',LIMIT=500,GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const title=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,255):'';
function normal(value){
 if(!value||siteKey(value.siteUrl)!==value.siteUrl||!pageKey(value.siteUrl,value.path)||!Number.isSafeInteger(value.lastSentAt)||value.lastSentAt<1||!GUID.test(value.lastAttemptId??'')||!['draft','add','overwrite'].includes(value.mode))return null;
 return {siteUrl:value.siteUrl,path:value.path,title:title(value.title),lastSentAt:value.lastSentAt,lastAttemptId:value.lastAttemptId,mode:value.mode};
}
const key=value=>`${value.siteUrl}|${value.path.toLowerCase()}`;
/** Destination receipts only. No original file, path, hash, body or file revision is retained here. */
export function createFilePages({storage=globalThis.chrome?.storage?.local,now=()=>Date.now()}={}){
 const read=async()=>{const value=(await storage.get(KEY))[KEY];return (Array.isArray(value)?value:[]).map(normal).filter(Boolean).sort((a,b)=>b.lastSentAt-a.lastSentAt).slice(0,LIMIT);};
 let queue=Promise.resolve();
 function change(update){const next=queue.then(async()=>{const rows=await update(await read());await storage.set({[KEY]:rows});return rows;});queue=next.catch(()=>{});return next;}
 return {list:read,
  async record({attempt,result}){
   if(!GUID.test(attempt?.attemptId??''))throw Error('A verified import attempt is required.');
   const url=new URL(confirmedPageUrl(result,attempt)),path=url.pathname.split('/').map(decodeURIComponent).join('/');
   const recordedAt=now(),lastSentAt=Number.isSafeInteger(attempt.startedAt)&&attempt.startedAt>0&&attempt.startedAt<=recordedAt?attempt.startedAt:recordedAt;
   const row=normal({siteUrl:attempt.siteUrl,path,title:result.title,lastSentAt,lastAttemptId:attempt.attemptId,mode:attempt.page?.mode??'draft'});
   if(!row)throw Error('The verified destination could not be remembered.');
   const rows=await change(previous=>{const old=previous.find(item=>key(item)===key(row));return old?.lastAttemptId===row.lastAttemptId?previous:[row,...previous.filter(item=>key(item)!==key(row))].sort((a,b)=>b.lastSentAt-a.lastSentAt).slice(0,LIMIT);});return rows.find(item=>key(item)===key(row));
  },
  removeSite:siteUrl=>change(rows=>rows.filter(row=>row.siteUrl!==siteUrl)),
  removePage:(siteUrl,path)=>change(rows=>rows.filter(row=>row.siteUrl!==siteUrl||row.path.toLowerCase()!==path.toLowerCase())),
  forget:()=>change(()=>[])
 };
}

/** A receipt is acknowledged for the current browser session. Forgetting a
 * destination must not let a retained completed capture put it back on reopen. */
export function createFilePageRecorder({filePages,sites,session=globalThis.chrome?.storage?.session}){
 const ACK='file-import-recorded-attempt';let queue=Promise.resolve();
 return value=>{const next=queue.then(async()=>{
  confirmedPageUrl(value?.result,value?.attempt);
  if((await session.get(ACK))[ACK]===value.attempt.attemptId)return null;
  const row=await filePages.record(value);await sites.visited(row.siteUrl,'',{path:row.path,title:row.title});await sites.used(row.siteUrl);
  await session.set({[ACK]:value.attempt.attemptId});return row;
 });queue=next.catch(()=>{});return next;};
}
