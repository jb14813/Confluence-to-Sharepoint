// Pages shown only in Confluence's editor have no reading view to copy: live
// docs, and pages open for editing, drafts never published among them. They
// are captured from their stored document (Atlassian Document Format) rather
// than from rendered markup: a live doc's page, or the draft Confluence saves
// while its editor is open. The editor can briefly be ahead of that stored copy
// while Confluence saves (https://community.developer.atlassian.com/t/89849),
// so capture first waits for the stored text to match what the editor shows.
import {convertAdf} from './adf.js';
import {EDITOR} from './detect.js';
import {fetchConfluenceImage,fetchExternalImage,fail} from './images.js';
import {badMetadata,compact} from './html.js';
import {captureHash,readAttachments,readSourceMetadata} from './rest.js';

// The stored copy is read again this many times, a second apart, while the editor is ahead of it.
const SAVE_CHECKS=5;
// Letters and digits only: the editor may split a word into several text
// nodes (around a collaborator's cursor, for example) or space it differently.
const letters=text=>String(text??'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');

// A live doc's title field, and a page's in the editor.
const TITLE_FIELDS='textarea[id^="livepages-title-"],textarea[name="editpages-title"]';

// What the editor shows: its title field and the text people typed.
// Non-editable items such as dates, macros and placeholder hints are left
// out, so edits that change no text (a new picture, a date, formatting) are
// not detected here.
function editorText(document) {
  const editors=document.querySelectorAll(EDITOR);
  const titles=document.querySelectorAll(TITLE_FIELDS);
  if(editors.length!==1||titles.length!==1)return null;
  const parts=[],walker=document.createTreeWalker(editors[0],NodeFilter.SHOW_TEXT,{acceptNode:node=>
    node.parentElement?.closest('[contenteditable]')?.getAttribute('contenteditable')==='false'?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  for(let node;(node=walker.nextNode());)parts.push(node.data);
  return {title:letters(titles[0].value),body:letters(parts.join(''))};
}
function storedText(source) {
  const parts=[];
  (function visit(node){
    if(node?.type==='text'&&typeof node.text==='string')parts.push(node.text);
    if(Array.isArray(node?.content))for(const child of node.content)visit(child);
  })(source.adf);
  return {title:letters(source.title),body:letters(parts.join(''))};
}

export async function captureStoredDocument({document,info,fetchImpl,metadataFetchImpl,onProgress}) {
  const warnings=[],what=info.live?'live doc':'page';
  const warn=(code,message,lost=false)=>{if(!warnings.some(w=>w.code===code))warnings.push({code,message,...(lost?{lost:true}:{})})};
  const progress=value=>{if(typeof onProgress==='function')onProgress(value)};
  const content=source=>{if(!source.adf)fail('metadata-invalid',`Confluence did not return the content of this ${what}.`);return source;};
  progress({phase:'capture',completed:0,total:1,message:`Reading the Confluence ${what}.`});
  let source=content(await readSourceMetadata(info,metadataFetchImpl));
  for(let check=1;;check++) {
    const shown=editorText(document),stored=storedText(source);
    if(!shown||shown.title===stored.title&&shown.body===stored.body)break;
    if(check>SAVE_CHECKS) {
      warn('edits-unsaved',`Confluence had not saved the latest edits to this ${what} when it was captured. Capture again in a few seconds to include them.`);
      break;
    }
    progress({phase:'capture',completed:0,total:1,message:'Waiting for Confluence to save the latest edits.'});
    await new Promise(resolve=>setTimeout(resolve,1000));
    source=content(await readSourceMetadata(info,metadataFetchImpl));
  }
  if(!source.title||source.title.length>255||badMetadata(source.title))fail('metadata-invalid',`The Confluence ${what} title is missing or exceeds the supported length.`);
  const files=await readAttachments(info,source.adf,metadataFetchImpl);
  const {parts,headings,stats}=convertAdf(source.adf,{pageUrl:info.pageUrl,attachment:id=>files.get(String(id).toLowerCase())??null,warn});
  if(source.featureInventory?.unknownMarkTypes?.length)warn('unknown-adf-feature','Unrecognized future Confluence features were captured from their visible static content where possible.');
  const model={title:source.title,sourceName:`${source.title} (Confluence)`.slice(0,255),sourceHash:'',sourceMetadata:source.sourceMetadata,
    featureInventory:source.featureInventory,blocks:[],assets:[],headings,warnings,stats};
  const add=block=>model.blocks.push({id:`block-${model.blocks.length+1}`,...block});
  // Text between pictures forms one block, including a picture that became a
  // link; text never runs from one SharePoint column into another.
  let pending={html:'',text:''},pendingPlace;
  const samePlace=(a,b)=>a===b||Boolean(a&&b&&a.id===b.id&&a.column===b.column);
  const placed=place=>place?{section:{id:place.id,factors:[...place.factors],column:place.column}}:{};
  const flush=()=>{if(pending.html)add({type:'text',html:pending.html,text:compact(pending.text),...placed(pendingPlace)});pending={html:'',text:''};};
  const total=parts.filter(part=>part.kind==='image').length,assets=new Map(),downloads=new Map(),stalledHosts=new Set();let completed=0;
  for(const part of parts) {
    if(!samePlace(part.place,pendingPlace)){flush();pendingPlace=part.place;}
    if(part.kind==='html'){pending.html+=part.html;pending.text+=` ${part.text} `;continue;}
    if(part.kind==='divider'){flush();add({type:'divider',...placed(part.place)});continue;}
    progress({phase:'images',completed,total,message:`Downloading image ${completed+1} of ${total}.`});
    const file=part.url?null:files.get(part.fileId.toLowerCase()),key=part.url?`external ${part.url}`:`file ${file.url} ${file.mime}`;
    if(!downloads.has(key))downloads.set(key,part.url
      ?await fetchExternalImage({url:part.url,displayWidth:part.displayWidth},{fetchImpl,stalledHosts}).catch(()=>null)
      :await fetchConfluenceImage({name:file.name,mime:file.mime,url:file.url,displayWidth:part.displayWidth},{fetchImpl}));
    const asset=downloads.get(key);
    if(!asset) {
      pending.html+=part.link.html;pending.text+=` ${part.link.text} `;completed++;
      warn('external-image-linked','A picture shown from another website became a link to it, because it could not be copied from that website.');
      continue;
    }
    flush();
    if(!assets.has(asset.id)){assets.set(asset.id,asset);model.assets.push(asset)}
    if(asset.scaledFrom)warn('picture-scaled','Pictures wider than SharePoint can show were scaled to 2,408 pixels wide, twice the width of a SharePoint column, before upload.');
    if(part.url)warn('external-image-copied','A picture shown from another website was copied into SharePoint. Check that you may reuse it.');
    for(const [code,message] of part.notes??[])warn(code,message);
    add({type:'image',assetId:asset.id,caption:part.caption,alt:part.alt,widthRatio:part.widthRatio,...(part.displayWidth?{displayWidth:part.displayWidth}:{}),...placed(part.place)});model.stats.images++;completed++;
  }
  flush();
  if(!model.blocks.length)fail('empty-document',`The Confluence ${what} contains no supported body content.`);
  model.sourceHash=await captureHash(info,model);
  progress({phase:'ready',completed,total:completed,message:`Confluence ${what} and all original images are ready.`});
  return model;
}
