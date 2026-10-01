// Confluence REST reads for capture, made with the page's own signed-in
// session and answered by the page's own origin.
import {inventoryAdf} from './features.js';
import {listedAttachment,sha256,fail} from './images.js';
import {badMetadata,compact,macroName,oneLine} from './html.js';

// A request that receives nothing for this long has failed.
const REQUEST_TIMEOUT_MS=10_000;
// The most of one answer capture reads. It only protects the tab's memory: the answer, the stored document it
// carries and that document read are all held at once, several times the answer's size in all.
const MAX_ANSWER_BYTES=64*1024*1024;
const TOO_LARGE='Confluence returned more page metadata than capture can hold.';
// Macro bodies, whose text Confluence may show elsewhere than the page, and the places named when page text is missing.
const MACRO_BODIES=new Set(['bodiedExtension','multiBodiedExtension','extensionFrame','bodiedSyncBlock','syncBlock']);
const PLACES={table:'a table',expand:'an expand section',nestedExpand:'an expand section',panel:'a panel',codeBlock:'a code block',
  layoutSection:'a column layout',blockquote:'a quote',taskList:'a task list',decisionList:'a decision list',bulletList:'a list',orderedList:'a list'};

// An answer's text, read as it arrives up to MAX_ANSWER_BYTES; `received` is called as each part arrives.
async function answerText(response,received) {
  if(!response.body?.getReader) {
    const text=await response.text();
    if(text.length>MAX_ANSWER_BYTES)fail('metadata-too-large',TOO_LARGE);
    return text;
  }
  const reader=response.body.getReader(),decoder=new TextDecoder();let size=0,text='';
  try {
    while(true) {
      const {done,value}=await reader.read();if(done)break;
      received();size+=value.byteLength;
      if(size>MAX_ANSWER_BYTES)fail('metadata-too-large',TOO_LARGE);
      text+=decoder.decode(value,{stream:true});
    }
  } catch(error) { try { await reader.cancel(); } catch {} throw error; }
  finally { reader.releaseLock(); }
  return text+decoder.decode();
}

// With `optional`, a resource Confluence reports as not found reads as null.
export async function readJson(address,info,fetchImpl,problem,{optional=false}={}) {
  const controller=new AbortController();let timer;
  // A large answer takes as long as it takes to arrive; only one that stops arriving fails.
  const waiting=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);};
  waiting();
  try {
    let response;
    try { response=await fetchImpl(address,{credentials:'include',headers:{Accept:'application/json'},redirect:'error',cache:'no-store',signal:controller.signal}); }
    catch { fail('metadata-fetch-failed',problem); }
    if(optional&&response?.status===404&&!response.redirected)return null;
    if(!response?.ok||response.redirected||response.url&&new URL(response.url).origin!==info.origin||!/application\/json/i.test(response.headers.get('Content-Type')||'')) {
      fail('metadata-fetch-failed',problem);
    }
    if(Number(response.headers.get('Content-Length'))>MAX_ANSWER_BYTES)fail('metadata-too-large',TOO_LARGE);
    let text;
    try { text=await answerText(response,waiting); } catch(error) { if(error?.code==='metadata-too-large')throw error;fail('metadata-fetch-failed',problem); }
    try{return JSON.parse(text)}catch{fail('metadata-invalid','Confluence returned invalid page metadata.');}
  } finally { clearTimeout(timer); }
}

/**
 * The page's author, update and version, and its stored document (ADF) with
 * what capture expects to find in it, including the addresses of pictures it
 * shows from other websites. A page open in the editor (`info.editing`) is read
 * from its draft, which holds what the editor shows, or as published when
 * Confluence has no draft of it yet.
 */
export async function readSourceMetadata(info,fetchImpl) {
  const address=`${info.baseUrl}/rest/api/content/${encodeURIComponent(info.pageId)}`,expand='expand=body.atlas_doc_format,history,version';
  const problem='Confluence page author and update metadata could not be read.';
  // Only a page Confluence reports having no draft of is read as published: a draft that cannot be read
  // stops capture rather than copying a version the editor does not show.
  let data,unchecked=false;
  try { data=info.editing&&await readJson(`${address}?status=draft&${expand}`,info,fetchImpl,problem,{optional:true})||await readJson(`${address}?${expand}`,info,fetchImpl,problem); }
  catch(error) {
    if(error?.code!=='metadata-too-large')throw error;
    // A live doc or a page in the editor is copied from its stored copy, so one too large to hold stops capture.
    if(info.live||info.editing)fail('capture-limit',`This Confluence ${info.live?'live doc':'page'}’s stored copy is larger than capture can hold (64 MB).`);
    // The reading view is copied from the page: it is read without the checks its stored copy allows (`unchecked`).
    data=await readJson(`${address}?expand=history,version`,info,fetchImpl,problem);unchecked=true;
  }
  // A draft never published names no creator: the author of its version wrote it.
  const author=data?.history?.createdBy??data?.version?.by,updated=data?.version?.when,version=data?.version?.number;
  const displayName=compact(author?.displayName),email=compact(author?.email);
  if(String(data?.id)!==info.pageId||!displayName||displayName.length>255||badMetadata(displayName)||
     email&&(email.length>254||badMetadata(email)||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))||
     typeof updated!=='string'||updated.length>40||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(updated)||!Number.isFinite(Date.parse(updated))||
     !Number.isSafeInteger(version)||version<1) fail('metadata-invalid','Confluence page author or update metadata is incomplete.');
  let expectedMediaCount=null,featureInventory=null,expectedText=[],macroText=[],macroMedia=[],adf=null;const externalPictures=new Set(),textPlaces=new Map(),mediaContexts=new Set(),mediaFiles=new Set();
  const adfValue=data?.body?.atlas_doc_format?.value;
  if(adfValue!==undefined) {
    // Its size is bounded by the answer's (MAX_ANSWER_BYTES), its depth by inventoryAdf.
    if(typeof adfValue!=='string')fail('metadata-invalid','Confluence returned invalid page structure metadata.');
    try{adf=JSON.parse(adfValue)}catch{fail('metadata-invalid','Confluence returned invalid page structure metadata.');}
    if(adf?.type!=='doc'||!Array.isArray(adf.content))fail('metadata-invalid','Confluence returned invalid page structure metadata.');
    featureInventory=inventoryAdf(adf);
    expectedMediaCount=0;
    // Page text Confluence shows is expected in the capture, with the kind of place it sits in. Text in a
    // macro's body is kept apart: apps draw their macros in frames of their own, a tabs macro shows one
    // tab and a synced block shows its source's text, so that text may never appear as page text. So are
    // pictures there, each with the macro holding it (`body`), by the keys the reading view draws it with.
    const named=value=>typeof value==='string'&&value?value:null;
    const visit=(node,place=null,macro=null,body=null)=>{
      if(!node||typeof node!=='object'||Array.isArray(node))fail('metadata-invalid','Confluence returned invalid page structure metadata.');
      if(node.type==='mediaSingle'){if(!body)expectedMediaCount++;else macroMedia.push({macro,localId:named(body.attrs?.localId),macroId:named(body.attrs?.parameters?.macroMetadata?.macroId?.value),key:named(body.attrs?.extensionKey)});}
      if(node.type==='media'&&node.attrs?.type==='external'&&typeof node.attrs.url==='string')try{externalPictures.add(new URL(node.attrs.url,info.pageUrl).href)}catch{/* Not an address. */}
      // The files the page shows, and the pages holding them: its own, and any other a picture was stored from.
      if(node.type==='media'&&typeof node.attrs?.id==='string')mediaFiles.add(node.attrs.id.toLowerCase());
      const context=node.type==='media'?/^contentId-(\d{1,20})$/.exec(node.attrs?.collection??'')?.[1]:null;if(context)mediaContexts.add(context);
      // An expand's title is an attribute, not a text node, and is shown like text.
      const shown=node.type==='text'?node.text:(node.type==='expand'||node.type==='nestedExpand')?node.attrs?.title:null;
      // As capture keeps it: without the control characters SharePoint text refuses.
      if(typeof shown==='string'&&oneLine(shown).length>=8){
        const value=oneLine(shown);
        if(macro)macroText.push({value,macro});
        else{expectedText.push(value);if(!textPlaces.has(value))textPlaces.set(value,node.type==='text'?place??'the body of the page':PLACES[node.type]);}
      }
      if(node.content!==undefined) {
        if(!Array.isArray(node.content))fail('metadata-invalid','Confluence returned invalid page structure metadata.');
        const within=macro??(MACRO_BODIES.has(node.type)?macroName(node):null),where=PLACES[node.type]??place,holder=body??(MACRO_BODIES.has(node.type)?node:null);
        for(const child of node.content)visit(child,where,within,holder);
      }
    };
    visit(adf);
    if(expectedMediaCount+macroMedia.length>2000)fail('capture-limit','This Confluence page contains too many images to capture safely.');
  }
  return {sourceMetadata:{author:{displayName,email:email||null},lastUpdatedAt:updated,version},expectedMediaCount,featureInventory,expectedText:[...new Set(expectedText)],macroText,macroMedia,textPlaces,
    externalPictures,mediaContexts,mediaFiles,adf,unchecked,title:compact(data?.title)};
}

/** The page's version number now, to tell a page that changed during capture from one that did not. */
export async function readVersion(info,fetchImpl) {
  const data=await readJson(`${info.baseUrl}/rest/api/content/${encodeURIComponent(info.pageId)}?expand=version`,info,fetchImpl,'Confluence page update metadata could not be read.');
  return data?.version?.number;
}

/**
 * One page's attachments, keyed by media file id, read page by page. With
 * `wanted`, reading stops once all of those files have been found.
 */
export async function readAttachmentListing(info,contextId,fetchImpl,wanted=null) {
  const path=`/rest/api/content/${encodeURIComponent(contextId)}/child/attachment`,files=new Map();
  let next=`${path}?limit=200`;
  for(let page=0;next;page++) {
    if(page>=25)fail('capture-limit','This Confluence page has too many attachments to capture safely.');
    const data=await readJson(`${info.baseUrl}${next}`,info,fetchImpl,'Confluence page attachments could not be read.');
    for(const entry of Array.isArray(data?.results)?data.results:[]) {
      const file=listedAttachment(entry,{baseUrl:info.baseUrl,contextId});
      if(file)files.set(file.fileId,file);
    }
    if(wanted&&[...wanted].every(id=>files.has(id)))break;
    next=typeof data?._links?.next==='string'&&data._links.next.startsWith(`${path}?`)?data._links.next:null;
  }
  return files;
}

/**
 * The attachments a stored document shows, keyed by media file id. Media
 * normally belongs to the page itself; files shown from another page on the
 * same site are read from that page's listing when the reader can open it.
 */
export async function readAttachments(info,adf,fetchImpl) {
  const wanted=new Map();
  (function visit(node){
    if((node?.type==='media'&&node.attrs?.type==='file'||node?.type==='mediaInline')&&typeof node.attrs?.id==='string') {
      const context=/^contentId-(\d{1,20})$/.exec(node.attrs.collection??'')?.[1]??info.pageId;
      if(!wanted.has(context))wanted.set(context,new Set());
      wanted.get(context).add(node.attrs.id.toLowerCase());
    }
    if(Array.isArray(node?.content))for(const child of node.content)visit(child);
  })(adf);
  if(wanted.size>20)fail('capture-limit','This Confluence page shows files from too many other pages to capture safely.');
  const files=new Map();
  for(const [context,ids] of wanted) {
    try { for(const [id,file] of await readAttachmentListing(info,context,fetchImpl,ids))files.set(id,file); }
    catch(error) {
      // Files shown from another page the reader cannot open are left out with a note.
      if(context===info.pageId)throw error;
    }
  }
  return files;
}

/** A stable identity for a capture: its source page, content and picture files. */
export const captureHash=(info,model)=>sha256(new TextEncoder().encode(JSON.stringify({origin:info.origin,pageId:info.pageId,title:model.title,
  sourceMetadata:model.sourceMetadata,blocks:model.blocks,assets:model.assets.map(({id,name,mime,width,height})=>({id,name,mime,width,height}))})));
