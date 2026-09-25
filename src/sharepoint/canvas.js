// Ordinary canvas positions follow PnPjs's clientside-pages contract:
// https://github.com/pnp/pnpjs/blob/version-4/packages/sp/clientside-pages/types.ts
// Image field names/version come from the supplied, locally inspected page
// export. No page-specific identities, flexible positions or placeholders are
// copied. The destination tenant must still verify native image/text rendering.
import { SHAREPOINT_COLUMN_WIDTH } from '../transfer/limits.js';

const IMAGE_PART = 'd1d91016-032f-456d-98a4-721247c305e8';
// SharePoint's Divider web part, a line across its column, with the data its editor stores for one it adds;
// its text part keeps no <hr> once edited.
const DIVIDER_PART = '2161a1c6-db61-4731-b97c-3cdb303f7cbb';
const dividerData = instanceId => ({id:DIVIDER_PART,instanceId,title:'Divider',description:'Add a line between web parts to make the page easier to read.',audiences:[],hideOn:{mobile:false},
  serverProcessedContent:{htmlStrings:{},searchablePlainTexts:{},imageSources:{},links:{}},dataVersion:'1.2',properties:{minimumLayoutWidth:1,length:100,weight:1},containsDynamicDataSource:false});
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const NIL = '00000000-0000-0000-0000-000000000000';
const MIME = {'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp'};
const TAGS = new Set('p h1 h2 h3 h4 h5 h6 span strong b em i u s sup sub br ol ul li table thead tbody tfoot tr td th a blockquote pre code div'.split(' '));
const ATTRS = new Set('id href style start type scope colspan rowspan class'.split(' '));
// SharePoint's own markup for a table without borders, as its editor writes it:
// two wrapper divs and the table style. A div must be one of them; no other class is accepted.
const CLASSES = {div:new Set(['canvasRteResponsiveTable','tableCenterAlign tableWrapper']),table:new Set(['noBorderTableStyleNeutral'])};
const ENTITIES = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'};
const badControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
// Match the characters the Confluence heading slugger can emit, plus legacy
// ASCII underscores. Restrict fragments to the converter's URI encoding.
const HEADING_ID = /^[\p{L}\p{N}\p{M}\p{Extended_Pictographic}\p{Regional_Indicator}\u200d_][\p{L}\p{N}\p{M}\p{Extended_Pictographic}\p{Regional_Indicator}\u200d_-]{0,200}$/u;
function fail(code,message) { throw Object.assign(new Error(message),{code}); }
function guid(value) { return typeof value === 'string' && GUID.test(value) && value.toLowerCase() !== NIL; }
const dimensions = (w,h) => [w,h].every(v=>Number.isInteger(v)&&v>0&&v<=100_000);
const same = (a,b) => a.toLowerCase()===b.toLowerCase();

function pathValid(path) {
  return typeof path==='string' && path.startsWith('/') && !path.startsWith('//') && path.length<=1500 &&
    path.slice(1).split('/').every(part=>part.length>0&&part.length<=200&&part!=='.'&&part!=='..'&&
      !/[\\\u0000-\u001f\u007f?*:|"<>]/u.test(part)&&!/[. ]$/.test(part)&&!/%(?:2e|2f|5c)/i.test(part));
}
function siteInfo(metadata) {
  if (!metadata || !guid(metadata.siteId) || !guid(metadata.webId) || typeof metadata.siteUrl!=='string') {
    fail('invalid-site','Destination site and web GUIDs are required.');
  }
  let url,path,rawPath;
  try {
    url=new URL(metadata.siteUrl);
    rawPath=metadata.siteUrl.replace(/^https:\/\/[^/]+/i,'').replace(/\/$/,'');
    path=url.pathname.split('/').map(decodeURIComponent).join('/').replace(/\/$/,'');
    const rawDecoded=rawPath.split('/').map(decodeURIComponent).join('/');
    if ((rawDecoded&&!pathValid(rawDecoded)) || (path&&!pathValid(path))) throw Error();
  } catch { fail('invalid-site','A valid HTTPS SharePoint site URL is required.'); }
  if (url.protocol!=='https:' ||
      url.port || url.username || url.password || url.search || url.hash || /[\\\u0000-\u0020\u007f]/u.test(metadata.siteUrl) ||
      path.split('/').some(p=>/^(?:_api|_layouts|SitePages|Pages)$/i.test(p)||/\.aspx$/i.test(p))) {
    fail('invalid-site','The destination must be a SharePoint site URL, not a page, API, or external address.');
  }
  return {origin:url.origin,path,siteId:metadata.siteId.toLowerCase(),webId:metadata.webId.toLowerCase()};
}

function attributeValue(raw) {
  // Normalized converter output needs only these entities. Refuse unknown
  // named entities in attributes rather than interpreting browser-specific URL
  // or CSS escapes. Text entities remain untouched and render as source text.
  return raw.replace(/&([^;\s&]+);?/g,(whole,name)=>{
    if (!whole.endsWith(';')) fail('unsafe-content','HTML attributes must use complete escaped entities.');
    if (Object.hasOwn(ENTITIES,name)) return ENTITIES[name];
    if (/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(name)) {
      const value=name[1].toLowerCase()==='x'?parseInt(name.slice(2),16):Number(name.slice(1));
      if (value>0&&value<=0x10ffff&&!(value>=0xd800&&value<=0xdfff)) return String.fromCodePoint(value);
    }
    fail('unsafe-content','An HTML attribute contains an unsupported character entity.');
  });
}
function checkStyle(value,tag) {
  if (/[{}@\\&<>\u0000-\u001f\u007f]|url\s*\(|expression\s*\(/iu.test(value)) fail('unsafe-content','Unsafe inline formatting was found.');
  const color = /^(?:#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d.,%\s]+\))$/i;
  const rules = {
    color, 'background-color':color,
    'font-family':/^[a-z0-9 ,"'-]{1,200}$/i,
    'font-size':/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i,
    'text-align':/^(?:left|center|right|justify)$/i,
    'font-weight':/^(?:normal|bold|[1-9]00)$/i,
    'font-style':/^(?:normal|italic|oblique)$/i,
    'vertical-align':/^(?:top|middle|bottom|baseline)$/i,
    'white-space':/^(?:pre|pre-wrap)$/i,
    'table-layout':/^fixed$/i,
    overflow:/^visible$/i,
    width:/^(?:100|[1-9]?\d(?:\.\d{1,4})?)%$/
  };
  for (const declaration of value.split(';')) {
    if (!declaration.trim()) continue;
    const match=/^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i.exec(declaration);
    if (!match || !Object.hasOwn(rules,match[1].toLowerCase()) || !rules[match[1].toLowerCase()].test(match[2])) {
      fail('unsafe-content','Unsupported inline formatting was found.');
    }
    if(match[1].toLowerCase()==='table-layout'&&tag!=='table'||
       match[1].toLowerCase()==='overflow'&&!['ul','ol'].includes(tag))fail('unsafe-content','Unsupported inline formatting was found.');
  }
}
function checkHref(value) {
  if (/[\u0000-\u0020\u007f\\]/u.test(value)) fail('unsafe-content','A document link contains unsafe characters.');
  if (value.startsWith('#')) {
    let id;
    try { id=decodeURIComponent(value.slice(1)); } catch { fail('unsafe-content','Invalid local heading link.'); }
    if (!HEADING_ID.test(id) || value!==`#${encodeURIComponent(id)}`) fail('unsafe-content','Invalid local heading link.');
    return;
  }
  let url;
  try { url=new URL(value); } catch { fail('unsafe-content','A document link must use HTTP, HTTPS, mailto, or a local heading fragment.'); }
  if (!['http:','https:','mailto:'].includes(url.protocol) || url.username || url.password ||
      (url.protocol!=='mailto:'&&!/^https?:\/\//i.test(value)) || (url.protocol==='mailto:'&&!url.pathname)) {
    fail('unsafe-content','A document link uses an unsupported or credential-bearing address.');
  }
}
function checkAttribute(tag,name,value) {
  if (!ATTRS.has(name)||badControl.test(value)) fail('unsafe-content','Unsupported HTML attribute.');
  if (name==='id'&&!HEADING_ID.test(value)) fail('unsafe-content','Invalid heading identifier.');
  if (name==='href') { if(tag!=='a') fail('unsafe-content','Links require anchor elements.'); checkHref(value); }
  if (name==='style') checkStyle(value,tag);
  if (name==='class'&&!CLASSES[tag]?.has(value)) fail('unsafe-content','Unsupported HTML class.');
  if (name==='start'&&(tag!=='ol'||!/^\d{1,7}$/.test(value))) fail('unsafe-content','Invalid ordered-list start.');
  if (name==='type'&&(tag!=='ol'||!/^[1aAiI]$/.test(value))) fail('unsafe-content','Invalid ordered-list type.');
  if (name==='scope'&&(tag!=='th'||!['row','col'].includes(value))) fail('unsafe-content','Invalid table header scope.');
  if (['colspan','rowspan'].includes(name)&&(!['td','th'].includes(tag)||!/^\d{1,4}$/.test(value)||Number(value)<1)) fail('unsafe-content','Invalid table cell span.');
}
function safeHtml(html) {
  if (typeof html!=='string'||!html.trim()||html.length>2_000_000||badControl.test(html)) fail('unsafe-content','Text HTML is empty, too large, or contains control characters.');
  const stack=[];
  let pos=0,hasCode=false;
  while (pos<html.length) {
    const start=html.indexOf('<',pos);
    if (start<0) break;
    const match=/^<\s*(\/?)\s*([a-z][a-z0-9]*)(\s[^<>]*?|)\s*(\/?)>/i.exec(html.slice(start));
    if (!match) fail('unsafe-content','Text HTML must contain balanced supported elements with escaped literal angle brackets.');
    const [,closing,rawTag,rawAttrs,selfClosing]=match, tag=rawTag.toLowerCase();
    if (!TAGS.has(tag)) fail('unsafe-content','Unsupported HTML element.');
    if (closing) {
      if (rawAttrs.trim()||selfClosing||stack.pop()!==tag) fail('unsafe-content','Text HTML contains mismatched closing tags.');
    } else {
      const names=new Set();
      let remaining=rawAttrs;
      while (remaining.trim()) {
        const attr=/^\s+([a-z][a-z0-9-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/i.exec(remaining);
        if (!attr) fail('unsafe-content','HTML attributes must be explicitly quoted and supported.');
        const name=attr[1].toLowerCase();
        if(names.has(name)) fail('unsafe-content','Duplicate HTML attributes are not supported.');
        names.add(name); checkAttribute(tag,name,attributeValue(attr[2]??attr[3]));
        remaining=remaining.slice(attr[0].length);
      }
      if (tag==='div'&&!names.has('class')) fail('unsafe-content','Unsupported HTML element.');
      if (tag!=='br') {
        if(selfClosing) fail('unsafe-content','Only line breaks can be self-closing.');
        stack.push(tag);
      }
      if(tag==='pre'||tag==='code') hasCode=true;
    }
    pos=start+match[0].length;
  }
  if(stack.length) fail('unsafe-content','Text HTML has unclosed elements.');
  // Return the validated markup unchanged so source words, escapes and spacing
  // survive. This accepts normalized HTML, not arbitrary Confluence DOM.
  return {html,hasCode};
}

function receiptMap(model,receipts,site) {
  if (!Array.isArray(model.assets)||!Array.isArray(receipts)) fail('invalid-model','Assets and upload receipts must be arrays.');
  const assets=new Map(),result=new Map(),paths=new Set(),fileIds=new Set();
  for(const asset of model.assets) {
    if(!asset||typeof asset.id!=='string'||!HASH.test(asset.id)||assets.has(asset.id.toLowerCase())||
       !Object.hasOwn(MIME,asset.mime)||!dimensions(asset.width,asset.height)) fail('invalid-model','Each source image requires a unique SHA256 identity, supported MIME type, and natural dimensions.');
    assets.set(asset.id.toLowerCase(),asset);
  }
  const used=new Set(model.blocks.filter(b=>b.type==='image').map(b=>typeof b.assetId==='string'?b.assetId.toLowerCase():''));
  if([...used].some(id=>!assets.has(id))) fail('invalid-model','An image block references an undeclared source asset.');
  for(const r of receipts) {
    const key=typeof r?.assetId==='string'?r.assetId.toLowerCase():'';
    const asset=assets.get(key);
    if (!asset||!used.has(key)||result.has(key)||!guid(r.uniqueId)||!guid(r.listId)||
        r.width!==asset.width||r.height!==asset.height||!pathValid(r.serverRelativeUrl)||typeof r.absoluteUrl!=='string') {
      fail('invalid-receipt','An image upload receipt is missing, duplicated, or does not match its source asset.');
    }
    let url,decoded;
    try { url=new URL(r.absoluteUrl); decoded=url.pathname.split('/').map(decodeURIComponent).join('/'); }
    catch { fail('invalid-receipt','An image upload receipt has an invalid file URL.'); }
    const relative=r.serverRelativeUrl.slice(site.path.length+1),segments=relative.split('/');
    if(!r.serverRelativeUrl.toLowerCase().startsWith(`${site.path.toLowerCase()}/`)||segments.length<2||
       segments.some(p=>/^(?:_api|_layouts|sitepages|pages)$/i.test(p))||
       !same(segments.at(-1),`sha256-${key}.${MIME[asset.mime]}`)||
       url.origin!==site.origin||url.username||url.password||url.search||url.hash||!same(decoded,r.serverRelativeUrl)||
       /[\\\u0000-\u0020\u007f]/u.test(r.absoluteUrl)||paths.has(r.serverRelativeUrl.toLowerCase())||fileIds.has(r.uniqueId.toLowerCase())) {
      fail('invalid-receipt','Image references must identify distinct verified files inside the selected SharePoint site.');
    }
    paths.add(r.serverRelativeUrl.toLowerCase()); fileIds.add(r.uniqueId.toLowerCase()); result.set(key,{...r,asset});
  }
  if([...used].some(id=>!result.has(id))) fail('missing-receipt','Every source image must be uploaded and verified before creating a draft.');
  return result;
}

// The column layouts SharePoint sections have, in twelfths: halves, a third
// beside two thirds either way, and three equal columns.
const SECTION_FACTORS=new Set(['6,6','4,8','8,4','4,4,4']);
/** A block's `section`, the SharePoint section column it goes in: {id, factors, column}; absent for the page's own column. */
function checkSection(section) {
  if(section===undefined) return;
  if(!section||typeof section!=='object'||Array.isArray(section)||Object.keys(section).sort().join()!=='column,factors,id'||
     !Number.isSafeInteger(section.id)||section.id<1||section.id>2000||!Array.isArray(section.factors)||!section.factors.every(Number.isInteger)||
     !SECTION_FACTORS.has(section.factors.join())||!Number.isInteger(section.column)||section.column<1||section.column>section.factors.length) {
    fail('invalid-model','A block’s columns are not a layout SharePoint sections have.');
  }
}

/**
 * Checks one captured block against the rules serializeCanvas applies, so a
 * page that cannot become SharePoint content is refused before any upload.
 */
export function checkCanvasBlock(block) {
  checkSection(block?.section);
  if(block?.type==='text') { safeHtml(block.html); return; }
  if(block?.type==='divider') { if(Object.keys(block).some(key=>!['id','type','section'].includes(key))) fail('invalid-model','A divider holds nothing but its place.'); return; }
  if(block?.type!=='image'||![block.caption??'',block.alt??''].every(v=>typeof v==='string'&&v.length<=100_000&&!badControl.test(v))||
     (block.widthRatio!==undefined&&(!Number.isFinite(block.widthRatio)||block.widthRatio<=0||block.widthRatio>1))||
     (block.displayWidth!==undefined&&(!Number.isInteger(block.displayWidth)||block.displayWidth<1||block.displayWidth>100_000))) fail('invalid-model','Image references, captions, alternative text, or proportional widths are invalid.');
}

/** Pure serialization. Upload receipts must originate from the retained asset client. */
export function serializeCanvas(model,assetReceipts,siteMetadata,{idFactory=()=>globalThis.crypto.randomUUID()}={}) {
  const site=siteInfo(siteMetadata);
  if(!model||typeof model.title!=='string'||!model.title.trim()||model.title.length>255||badControl.test(model.title)||
     !Array.isArray(model.blocks)||!model.blocks.length||model.blocks.length>2000||typeof idFactory!=='function') fail('invalid-model','A titled document with 1–2000 ordered text, image or divider blocks is required.');
  const blockIds=new Set(),expanded=[];
  let textCount=0,imageCount=0,dividerCount=0,totalHtml=0;
  for(const block of model.blocks) {
    if(!block||!['text','image','divider'].includes(block.type)||typeof block.id!=='string'||!block.id||block.id.length>200||blockIds.has(block.id)) fail('invalid-model','Each ordered text, image or divider block requires a unique source identifier.');
    blockIds.add(block.id);
    checkSection(block.section);
    if(block.type==='text') {
      const checked=safeHtml(block.html);
      expanded.push({type:'text',html:checked.html,section:block.section});totalHtml+=checked.html.length;textCount++;
    } else if(block.type==='divider') {
      checkCanvasBlock(block);
      expanded.push({type:'divider',section:block.section});dividerCount++;
    } else {
      if(typeof block.assetId!=='string'||!HASH.test(block.assetId)||
         ![block.caption??'',block.alt??''].every(v=>typeof v==='string'&&v.length<=100_000&&!badControl.test(v))||
         (block.widthRatio!==undefined&&(!Number.isFinite(block.widthRatio)||block.widthRatio<=0||block.widthRatio>1))||
     (block.displayWidth!==undefined&&(!Number.isInteger(block.displayWidth)||block.displayWidth<1||block.displayWidth>100_000))) fail('invalid-model','Image references, captions, alternative text, or proportional widths are invalid.');
      expanded.push({type:'image',block,section:block.section}); imageCount++;
    }
  }
  if(totalHtml>8_000_000) fail('invalid-model','The document exceeds the supported canvas text size.');
  // Sections, as SharePoint stores them: a zone for each run of blocks in the
  // page's own column and for each column layout, a sectionIndex for each of
  // its columns with its width in twelfths, in order, and an empty column kept
  // as SharePoint's placeholder for one.
  const zones=[];
  for(const entry of expanded) {
    const key=entry.section?`section ${entry.section.id}`:'page';
    const zone=zones.at(-1);
    if(zone?.key===key) {
      if(entry.section&&(entry.section.factors.join()!==zone.factors.join()||entry.section.column<zone.entries.at(-1).section.column)) fail('invalid-model','A column layout’s blocks must keep its columns, in order.');
      zone.entries.push(entry);continue;
    }
    if(entry.section&&zones.some(other=>other.key===key)) fail('invalid-model','A column layout’s blocks must be together.');
    zones.push({key,factors:entry.section?entry.section.factors:[12],entries:[entry]});
  }
  const uploaded=receiptMap(model,assetReceipts,site);
  const forbiddenIds=new Set([...blockIds,...[site.siteId,site.webId,IMAGE_PART,DIVIDER_PART],...[...uploaded.values()].flatMap(r=>[r.listId,r.uniqueId])].map(s=>s.toLowerCase()));
  function freshId() {
    const id=idFactory();
    if(!guid(id)||forbiddenIds.has(id.toLowerCase())) fail('invalid-id','Every new canvas section/control requires a fresh, distinct UUID.');
    forbiddenIds.add(id.toLowerCase()); return id.toLowerCase();
  }
  const controls=[];
  zones.forEach((zone,zoneNumber)=>{
    const zoneId=freshId();
    const position=(sectionIndex,controlIndex)=>({layoutIndex:1,zoneIndex:zoneNumber+1,zoneId,sectionIndex,sectionFactor:zone.factors[sectionIndex-1],...(controlIndex?{controlIndex}:{})});
    const emptyColumn=sectionIndex=>controls.push({displayMode:2,emphasis:{},position:position(sectionIndex)});
    let column=1,count=0;
    for(const entry of zone.entries) {
      for(const target=entry.section?.column??1;column<target;column++,count=0) if(!count) emptyColumn(column);
      controls.push(control(entry,position(column,++count),zone.factors[column-1]));
    }
    while(column<zone.factors.length) emptyColumn(++column);
  });
  function control(entry,position,factor) {
    const id=freshId();
    const base={position,id,controlType:entry.type==='text'?4:3,isFromSectionTemplate:false,addedFromPersistedData:true};
    if(entry.type==='text') {
      return {...base,contentVersion:5,innerHTML:entry.html};
    }
    if(entry.type==='divider') {
      return {...base,webPartId:DIVIDER_PART,reservedWidth:Math.round(SHAREPOINT_COLUMN_WIDTH*factor/12),reservedHeight:1,webPartData:dividerData(id)};
    }
    const block=entry.block;
    const r=uploaded.get(block.assetId.toLowerCase()), ratio=block.widthRatio??1;
    const imageSource={siteid:site.siteId,webid:site.webId,listid:r.listId.toLowerCase(),uniqueid:r.uniqueId.toLowerCase(),width:String(r.width),height:String(r.height)};
    // A picture shown narrower than its file is resized the way SharePoint's
    // own editor stores a resize (desired size, share of the column, centred),
    // keeping the full file for high-density screens. In a section's column it
    // is shown at most as wide as that column.
    const columnWidth=Math.round(SHAREPOINT_COLUMN_WIDTH*factor/12),inSection=factor<12;
    const shown=Number.isInteger(block.displayWidth)?Math.min(block.displayWidth,columnWidth):null;
    const resize=shown&&shown<r.width?{resizeDesiredWidth:shown,resizeDesiredHeight:shown*r.height/r.width,resizeCoefficient:shown/columnWidth,alignment:'Center',fixAspectRatio:false}:null;
    const reservedWidth=resize?columnWidth:inSection?Math.min(r.width,columnWidth):r.width*ratio;
    return {...base,webPartId:IMAGE_PART,reservedWidth,reservedHeight:resize?resize.resizeDesiredHeight:reservedWidth*r.height/r.width,webPartData:{
      id:IMAGE_PART,instanceId:id,title:'Image',description:'Image',audiences:[],hideOn:{mobile:false},
      serverProcessedContent:{htmlStrings:{},searchablePlainTexts:{captionText:block.caption??''},imageSources:{imageSource:r.serverRelativeUrl},links:{},customMetadata:{imageSource}},
      dataVersion:'1.13',properties:{imageSourceType:2,isCaptionEnabled:!!block.caption,altText:block.alt??'',linkUrl:'',overlayText:'',
        fileName:r.serverRelativeUrl.split('/').at(-1),siteId:site.siteId,webId:site.webId,listId:r.listId.toLowerCase(),uniqueId:r.uniqueId.toLowerCase(),
        isStretchEnabled:false,imgWidth:r.width,imgHeight:r.height,isCaptionHeightMigrated:true,...resize},containsDynamicDataSource:false
    }};
  }
  // The page's text is written for SharePoint's current editor, CKEditor 5 (text content version 5), as its
  // own editor marks a page it saves and as PnP Core does; a page without the mark is drawn by the earlier
  // editor's reader, which draws every table with borders, panels too.
  controls.push({controlType:0,pageSettingsSlice:{isDefaultDescription:true,isDefaultThumbnail:true,rtePageSettings:{contentVersion:5}}});
  const warnings=[];
  if(imageCount) warnings.push({code:'native-image-layout-unverified',message:'Images retain natural aspect ratios and proportional reserved-size hints. Native Image version 1.13 and final responsive widths require review in this SharePoint tenant.'});
  return {CanvasContent1:JSON.stringify(controls),controlCount:textCount+imageCount+dividerCount,textCount,imageCount,dividerCount,warnings};
}
