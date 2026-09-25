// Confluence REST reads for capture, made with the page's own signed-in
// session and answered by the page's own origin.
import {inventoryAdf} from './features.js';
import {listedAttachment,sha256,fail} from './images.js';
import {badMetadata,compact} from './html.js';

const REQUEST_TIMEOUT_MS=10_000;
// Macro bodies, whose text Confluence may show elsewhere than the page, and the places named when page text is missing.
const MACRO_BODIES=new Set(['bodiedExtension','multiBodiedExtension','extensionFrame','bodiedSyncBlock','syncBlock']);
const PLACES={table:'a table',expand:'an expand section',nestedExpand:'an expand section',panel:'a panel',codeBlock:'a code block',
  layoutSection:'a column layout',blockquote:'a quote',taskList:'a task list',decisionList:'a decision list',bulletList:'a list',orderedList:'a list'};
// A macro by the name its app gives it (Forge, then Connect and Confluence's own), never by its content.
function macroName(node){
  if(node.type==='bodiedSyncBlock'||node.type==='syncBlock')return 'a synced block';
  const title=[node.attrs?.parameters?.extensionTitle,node.attrs?.parameters?.macroMetadata?.title,node.attrs?.text].find(value=>typeof value==='string'&&compact(value));
  return title&&compact(title).length<=60&&!badMetadata(title)?`the “${compact(title)}” macro`:'a Confluence macro';
}

// With `optional`, a resource Confluence reports as not found reads as null.
export async function readJson(address,info,fetchImpl,problem,{optional=false}={}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try {
    let response;
    try { response=await fetchImpl(address,{credentials:'include',headers:{Accept:'application/json'},redirect:'error',cache:'no-store',signal:controller.signal}); }
    catch { fail('metadata-fetch-failed',problem); }
    if(optional&&response?.status===404&&!response.redirected)return null;
    if(!response?.ok||response.redirected||response.url&&new URL(response.url).origin!==info.origin||!/application\/json/i.test(response.headers.get('Content-Type')||'')) {
      fail('metadata-fetch-failed',problem);
    }
    if(Number(response.headers.get('Content-Length'))>1_000_000)fail('metadata-invalid','Confluence returned oversized page metadata.');
    let text;
    try { text=await response.text(); } catch { fail('metadata-fetch-failed',problem); }
    if(text.length>1_000_000)fail('metadata-invalid','Confluence returned oversized page metadata.');
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
  const data=info.editing&&await readJson(`${address}?status=draft&${expand}`,info,fetchImpl,problem,{optional:true})||await readJson(`${address}?${expand}`,info,fetchImpl,problem);
  // A draft never published names no creator: the author of its version wrote it.
  const author=data?.history?.createdBy??data?.version?.by,updated=data?.version?.when,version=data?.version?.number;
  const displayName=compact(author?.displayName),email=compact(author?.email);
  if(String(data?.id)!==info.pageId||!displayName||displayName.length>255||badMetadata(displayName)||
     email&&(email.length>254||badMetadata(email)||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))||
     typeof updated!=='string'||updated.length>40||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(updated)||!Number.isFinite(Date.parse(updated))||
     !Number.isSafeInteger(version)||version<1) fail('metadata-invalid','Confluence page author or update metadata is incomplete.');
  let expectedMediaCount=null,featureInventory=null,expectedText=[],macroText=[],adf=null;const externalPictures=new Set(),textPlaces=new Map();
  const adfValue=data?.body?.atlas_doc_format?.value;
  if(adfValue!==undefined) {
    if(typeof adfValue!=='string'||adfValue.length>800_000)fail('metadata-invalid','Confluence returned invalid page structure metadata.');
    try{adf=JSON.parse(adfValue)}catch{fail('metadata-invalid','Confluence returned invalid page structure metadata.');}
    if(adf?.type!=='doc'||!Array.isArray(adf.content))fail('metadata-invalid','Confluence returned invalid page structure metadata.');
    featureInventory=inventoryAdf(adf);
    expectedMediaCount=0;let nodeCount=0;
    // Page text Confluence shows is expected in the capture, with the kind of place it sits in. Text in a
    // macro's body is kept apart: apps draw their macros in frames of their own, a tabs macro shows one
    // tab and a synced block shows its source's text, so that text may never appear as page text.
    const visit=(node,place=null,macro=null)=>{
      if(!node||typeof node!=='object'||Array.isArray(node)||++nodeCount>100_000)fail('metadata-invalid','Confluence returned invalid page structure metadata.');
      if(node.type==='mediaSingle')expectedMediaCount++;
      if(node.type==='media'&&node.attrs?.type==='external'&&typeof node.attrs.url==='string')try{externalPictures.add(new URL(node.attrs.url,info.pageUrl).href)}catch{/* Not an address. */}
      // An expand's title is an attribute, not a text node, and is shown like text.
      const shown=node.type==='text'?node.text:(node.type==='expand'||node.type==='nestedExpand')?node.attrs?.title:null;
      if(typeof shown==='string'&&compact(shown).length>=8){
        const value=compact(shown);
        if(macro)macroText.push({value,macro});
        else{expectedText.push(value);if(!textPlaces.has(value))textPlaces.set(value,node.type==='text'?place??'the body of the page':PLACES[node.type]);}
      }
      if(node.content!==undefined) {
        if(!Array.isArray(node.content))fail('metadata-invalid','Confluence returned invalid page structure metadata.');
        const within=macro??(MACRO_BODIES.has(node.type)?macroName(node):null),where=PLACES[node.type]??place;
        for(const child of node.content)visit(child,where,within);
      }
    };
    visit(adf);
    if(expectedMediaCount>2000)fail('capture-limit','This Confluence page contains too many images to capture safely.');
  }
  return {sourceMetadata:{author:{displayName,email:email||null},lastUpdatedAt:updated,version},expectedMediaCount,featureInventory,expectedText:[...new Set(expectedText)],macroText,textPlaces,
    externalPictures,adf,title:compact(data?.title)};
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
