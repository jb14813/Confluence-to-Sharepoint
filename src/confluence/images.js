import {badMetadata} from './html.js';
import {MAX_PICTURE_BYTES,SHAREPOINT_COLUMN_WIDTH,sha256Hex} from '../transfer/limits.js';

const TYPES = new Set(['image/png','image/jpeg','image/gif','image/webp']);
const EXTENSIONS = {'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp'};
const SVG = 'image/svg+xml';
const PICTURE_TYPES = new Set([...TYPES, SVG]);
/** Whether capture places a file of this type as a SharePoint picture; SVG is converted to PNG. */
export const isPicture = mime => PICTURE_TYPES.has(mime);
// Chrome's own limits for a canvas: 32,767 pixels a side and 268,435,456 in all.
const MAX_CANVAS_SIDE = 32_767, MAX_CANVAS_PIXELS = 268_435_456;
export const unsupportedPicture = name => fail('unsupported-image', `A picture on this page (${name}) is not PNG, JPEG, GIF, WebP or SVG, which capture supports.`);

export function fail(code, message) { throw Object.assign(new Error(message), {code}); }
export const sha256 = sha256Hex;

function attachmentRoot(baseUrl) {
  let base;
  try { base = new URL(baseUrl); } catch { fail('invalid-attachment', 'The Confluence attachment origin is invalid.'); }
  const root = base.pathname.replace(/\/+$/, '');
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || (root && !/^(?:\/[A-Za-z0-9._~-]+)+$/.test(root))) fail('invalid-attachment', 'The Confluence attachment origin is invalid.');
  return {origin:base.origin, root};
}
// The stable original-attachment route, below the Confluence application root.
const downloadUrl = ({origin, root}, contextId, name) => `${origin}${root}/download/attachments/${contextId}/${encodeURIComponent(name).replace(/[!'()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;

/**
 * An attachment from a page's attachment listing (`/rest/api/content/{id}/child/attachment`),
 * for pages captured from their stored document. Returns null for an entry that is not a usable file.
 */
export function listedAttachment(entry, {baseUrl, contextId}) {
  const name = typeof entry?.title === 'string' ? entry.title : '';
  const fileId = String(entry?.extensions?.fileId ?? '').toLowerCase();
  const mime = String(entry?.extensions?.mediaType ?? '').split(';')[0].trim().toLowerCase();
  if (!/^\d+$/.test(contextId) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(fileId) ||
      !name || name.length > 255 || /[\\/]/.test(name) || badMetadata(name) || name === '.' || name === '..' || mime.length > 255) return null;
  return {fileId, name, mime, url:downloadUrl(attachmentRoot(baseUrl), contextId, name)};
}

/** A picture's own file name, as the page gives it, or null for a placeholder or unsafe name. */
export function pictureFileName(value) {
  return typeof value === 'string' && value && value !== 'file' && !value.startsWith('confluence-image-') && value.length <= 255 &&
    !/[\\/\u0000-\u001f\u007f]/.test(value) && value !== '.' && value !== '..' ? value : null;
}

/** The original-attachment address of a picture's file, to link to when the picture cannot be copied; null without a safe name. */
export function attachmentLink(media, baseUrl) {
  const contextId = media?.getAttribute('data-context-id') || '', name = pictureFileName(media?.getAttribute('data-file-name'));
  if (!/^\d+$/.test(contextId) || !name) return null;
  try { return downloadUrl(attachmentRoot(baseUrl), contextId, name); } catch { return null; }
}

/** `baseUrl` is the Confluence application root: its origin plus context path, such as /wiki. */
export function attachmentInfo(media, baseUrl) {
  const contextId = media.getAttribute('data-context-id') || '';
  const name = media.getAttribute('data-file-name') || '';
  const mime = (media.getAttribute('data-file-mime-type') || '').toLowerCase();
  const incomplete=name==='file'&&!mime;
  if (!/^\d+$/.test(contextId) || !name || name.length > 255 || /[\\/\u0000-\u001f\u007f]/.test(name) || name === '.' || name === '..') fail('invalid-attachment', 'An image is missing a valid Confluence attachment identifier or filename.');
  if (!incomplete&&!PICTURE_TYPES.has(mime)) unsupportedPicture(name);
  const base = attachmentRoot(baseUrl);
  let fallbackUrl='';
  const fileId=media.getAttribute('data-id') || '';
  const rawDisplay=media.querySelector('img')?.getAttribute('src') || '';
  try {
    const display=new URL(rawDisplay);
    const allowedKeys=new Set(['allowAnimated','client','collection','height','max-age','mode','source','token','width']);
    const pathId=/^\/file\/([a-f0-9-]{36})\/image\/cdn$/i.exec(display.pathname)?.[1] || '';
    const expectedCollection=`contentId-${contextId}`;
    if(display.protocol==='https:'&&display.hostname==='media-cdn.atlassian.com'&&!display.port&&!display.username&&!display.password&&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(fileId)&&pathId.toLowerCase()===fileId.toLowerCase()&&
      display.searchParams.get('collection')===expectedCollection&&display.searchParams.get('token')&&
      [...display.searchParams.keys()].every(key=>allowedKeys.has(key))){display.hash='';fallbackUrl=display.href;}
    const blobPrefix=`${base.origin}/`,blobId=display.pathname.startsWith(blobPrefix)?display.pathname.slice(blobPrefix.length):'';
    const blobMeta=new URLSearchParams(display.hash.replace(/^#/,'')),blobKeys=new Set(['media-blob-url','id','collection','contextId','mimeType','name','size','width','height','alt','clientId']);
    if(display.protocol==='blob:'&&display.origin===base.origin&&!display.search&&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(fileId)&&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(blobId)&&
      blobMeta.get('media-blob-url')==='true'&&blobMeta.get('id')===fileId&&blobMeta.get('collection')===expectedCollection&&
      blobMeta.get('contextId')===contextId&&(!blobMeta.has('mimeType')||blobMeta.get('mimeType')===mime)&&
      (!blobMeta.has('name')||blobMeta.get('name')===name)&&(!blobMeta.has('size')||/^\d{1,9}$/.test(blobMeta.get('size')||''))&&
      /^\d{1,6}$/.test(blobMeta.get('width')||'')&&/^\d{1,6}$/.test(blobMeta.get('height')||'')&&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(blobMeta.get('clientId')||'')&&
      [...blobMeta.keys()].every(key=>blobKeys.has(key))){display.hash='';fallbackUrl=display.href;}
  } catch {/* The original attachment route remains authoritative. */}
  if(incomplete&&!fallbackUrl)fail('invalid-attachment','Confluence had not finished loading a picture on this page, and its file was not found among the page attachments. Reload the page and capture again.');
  return incomplete?{name:`confluence-image-${fileId}`,mime:null,url:null,fallbackUrl,fileId}:{name,mime,url:downloadUrl(base,contextId,name),...(fallbackUrl?{fallbackUrl}:{})};
}

function dimensions(bytes, mime) {
  const invalid = () => fail('unsupported-image', 'A Confluence attachment does not contain the declared image format.');
  const ascii = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/png') {
    if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value) || ascii(12,4)!=='IHDR' || view.getUint32(8)!==13) invalid();
    return {width:view.getUint32(16),height:view.getUint32(20)};
  }
  if (mime === 'image/gif') {
    if (bytes.length < 13 || !['GIF87a','GIF89a'].includes(ascii(0,6))) invalid();
    return {width:view.getUint16(6,true),height:view.getUint16(8,true)};
  }
  if (mime === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0]!==255 || bytes[1]!==216) invalid();
    let offset=2;
    while(offset + 4 <= bytes.length) {
      if(bytes[offset++]!==255) invalid();
      while(bytes[offset]===255) offset++;
      const marker=bytes[offset++];
      if(marker===0xd9 || marker===0xda) break;
      if(marker===0x01 || (marker>=0xd0 && marker<=0xd7)) continue;
      if(offset+2>bytes.length) invalid();
      const length=view.getUint16(offset);
      if(length<2 || offset+length>bytes.length) invalid();
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        if(length<8) invalid();
        return {width:view.getUint16(offset+5),height:view.getUint16(offset+3)};
      }
      offset+=length;
    }
    invalid();
  }
  if (mime === 'image/webp') {
    if(bytes.length<30 || ascii(0,4)!=='RIFF' || ascii(8,4)!=='WEBP' || view.getUint32(4,true)+8!==bytes.length) invalid();
    const kind=ascii(12,4);
    if(kind==='VP8X') return {width:1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16),height:1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)};
    if(kind==='VP8 ' && bytes[23]===0x9d && bytes[24]===0x01 && bytes[25]===0x2a) return {width:view.getUint16(26,true)&0x3fff,height:view.getUint16(28,true)&0x3fff};
    if(kind==='VP8L' && bytes[20]===0x2f) return {width:1+bytes[21]+((bytes[22]&0x3f)<<8),height:1+(bytes[22]>>6)+(bytes[23]<<2)+((bytes[24]&0x0f)<<10)};
    invalid();
  }
  invalid();
}

// Only SharePoint's own upload limit applies to a picture; there is no page total.
function checkSize(length) {
  if(length>MAX_PICTURE_BYTES) fail('asset-too-large', 'A picture on this page is larger than 250 MB, the most SharePoint accepts in one upload.');
}

// `received` is called as each part of the file arrives.
async function readBytes(response, received = () => {}) {
  const declared = response.headers.get('content-length');
  if(declared && /^\d+$/.test(declared)) checkSize(Number(declared));
  let bytes;
  if(response.body?.getReader) {
    const reader=response.body.getReader();const chunks=[];let length=0;
    try {
      while(true) {
        const {done,value}=await reader.read();if(done) break;
        received();length+=value.byteLength;checkSize(length);chunks.push(value);
      }
    } catch(error) { try { await reader.cancel(); } catch {} throw error; }
    finally { reader.releaseLock(); }
    bytes=new Uint8Array(length);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  } else {
    bytes=new Uint8Array(await response.arrayBuffer());checkSize(bytes.byteLength);
  }
  return bytes;
}

/**
 * Draws an SVG picture to PNG, because SharePoint image controls take bitmap
 * formats and an SVG file could carry script into the SharePoint site. An SVG
 * drawn as an image runs no scripts and loads no other files. The PNG is twice
 * the width Confluence showed (or the picture's own width), at most twice a
 * SharePoint column, so it stays sharp on high-density screens.
 */
async function rasterizeSvg(bytes, displayWidth) {
  const invalid = () => fail('unsupported-image', 'An SVG picture on this page could not be converted to PNG.');
  const svg = new globalThis.DOMParser().parseFromString(new TextDecoder().decode(bytes), SVG).documentElement;
  if(svg?.localName!=='svg' || svg.namespaceURI!=='http://www.w3.org/2000/svg') invalid();
  const url = URL.createObjectURL(new Blob([bytes],{type:SVG}));
  try {
    const image = globalThis.document.createElement('img');
    image.src = url;
    try { await image.decode(); } catch { invalid(); }
    // The picture's own size: absolute width and height, else its view box, else the browser's reading of it.
    const length = value => /^\s*\d+(?:\.\d+)?(?:px)?\s*$/.test(value ?? '') ? parseFloat(value) : 0;
    const box = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number), boxRatio = box[2] > 0 && box[3] > 0 ? box[3] / box[2] : 0;
    let width = length(svg.getAttribute('width')), height = length(svg.getAttribute('height'));
    if(!width && !height && boxRatio) { width = box[2]; height = box[3]; }
    else if(width && !height && boxRatio) height = width * boxRatio;
    else if(height && !width && boxRatio) width = height / boxRatio;
    if(!(width > 0 && height > 0)) { width = image.naturalWidth || 300; height = image.naturalHeight || 150; }
    const shown = Math.min(displayWidth > 0 ? displayWidth : width, SHAREPOINT_COLUMN_WIDTH);
    const scale = Math.min(2 * shown / width, MAX_CANVAS_SIDE / Math.max(width, height), Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise(resolve => { try { canvas.toBlob(resolve, 'image/png'); } catch { resolve(null); } });
    if(!png) invalid();
    return new Uint8Array(await png.arrayBuffer());
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Fetch the stable original-attachment route; signed display URLs never enter the model.
 * Returns the picture's bytes with its identity (SHA-256), name, type and size.
 */
export async function fetchConfluenceImage(info, {fetchImpl=globalThis.fetch}={}) {
  let response;
  // The route is on the page's own origin and redirects to Atlassian's media
  // service with a signed address. Cookies go only to Confluence: the media
  // service answers any origin (Access-Control-Allow-Origin: *), which browsers
  // refuse for requests that include credentials.
  if(info.url)try { response=await fetchImpl(info.url,{credentials:'same-origin',method:'GET',headers:{Accept:info.mime}}); }
  catch {/* A content blocker can reject Confluence's download route before an HTTP response exists. */}
  if(!response?.ok && info.fallbackUrl) {
    try { response=await fetchImpl(info.fallbackUrl,{credentials:'omit',method:'GET',headers:{Accept:info.mime||'image/png,image/jpeg,image/gif,image/webp'}}); }
    catch { response=null; }
  }
  if(!response?.ok) fail('attachment-fetch-failed', 'An original Confluence image could not be downloaded. Keep the source page signed in and retry capture.');
  const source=(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if(info.mime&&source!==info.mime || !PICTURE_TYPES.has(source)) fail('unsupported-image', 'A Confluence image download returned an unexpected file type, possibly a sign-in page.');
  let bytes;
  try { bytes=await readBytes(response); }
  catch(error) { if(typeof error?.code==='string') throw error;fail('attachment-fetch-failed', 'A Confluence image download ended before it could be verified.'); }
  const picture=await preparePicture(bytes,source,info.displayWidth);
  const name=!info.mime?`${info.name}.${EXTENSIONS[picture.mime]}`:source===SVG?`${info.name.replace(/\.svg$/i,'')}.png`:info.name;
  return {id:picture.id,name,...picture};
}

// A picture from another website that sends nothing for this long is linked instead.
const EXTERNAL_STALL_MS = 30_000;

/** The picture type a file's first bytes declare. Websites often send pictures with a generic type. */
function sniffPicture(bytes) {
  const starts = signature => signature.every((value, index) => bytes[index] === value);
  if(starts([137,80,78,71,13,10,26,10])) return 'image/png';
  if(starts([255,216,255])) return 'image/jpeg';
  const ascii = String.fromCharCode(...bytes.subarray(0, 12));
  if(ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image/gif';
  if(ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * A picture a Confluence page shows from another website, which is not a
 * Confluence attachment. It is requested over https without cookies or the
 * page address (the browser still names the Confluence site as the request's
 * origin), and copied only when that website lets the Confluence site read it
 * (CORS). Throws when it cannot be copied; the caller then links to it.
 * `stalledHosts`, shared by one capture, skips a website that stopped sending.
 */
export async function fetchExternalImage({url, displayWidth}, {fetchImpl=globalThis.fetch, stallMs=EXTERNAL_STALL_MS, stalledHosts=null}={}) {
  const unavailable = () => fail('external-image-unavailable', 'A picture from another website could not be copied.');
  let address;
  try { address = new URL(url); } catch { unavailable(); }
  if(address.protocol !== 'https:' || address.username || address.password || stalledHosts?.has(address.host)) unavailable();
  const controller = new AbortController();
  let timer, stalled = false;
  const waiting = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; controller.abort(); }, stallMs); };
  waiting();
  try {
    let response, bytes;
    try {
      response = await fetchImpl(address.href, {credentials:'omit', referrerPolicy:'no-referrer', mode:'cors', method:'GET', headers:{Accept:[...PICTURE_TYPES].join(',')}, signal:controller.signal});
      if(!response?.ok) unavailable();
      bytes = await readBytes(response, waiting);
    } catch(error) {
      if(stalled) stalledHosts?.add(address.host);
      if(typeof error?.code==='string') throw error;
      unavailable();
    }
    const declared = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const source = sniffPicture(bytes) ?? (declared === SVG ? SVG : null);
    if(!source) fail('unsupported-image', 'A picture from another website is not PNG, JPEG, GIF, WebP or SVG.');
    const picture = await preparePicture(bytes, source, displayWidth);
    // Its file name, which SharePoint does not use: uploads are named by content.
    let leaf = '';
    try { leaf = decodeURIComponent(address.pathname.slice(address.pathname.lastIndexOf('/') + 1)); } catch { /* Keep the generic name. */ }
    const stem = leaf.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'picture';
    return {id:picture.id, name:`${stem}.${EXTENSIONS[picture.mime]}`, ...picture};
  } finally { clearTimeout(timer); controller.abort(); }
}

/**
 * Checks a downloaded picture and prepares it for SharePoint: an SVG is drawn
 * to PNG, the picture is decoded to confirm the dimensions its file declares,
 * and a picture wider than SharePoint can show is scaled.
 */
async function preparePicture(bytes, source, displayWidth) {
  if(source===SVG) { bytes=await rasterizeSvg(bytes,displayWidth);checkSize(bytes.byteLength); }
  const mime=source===SVG?'image/png':source;
  const size=dimensions(bytes,mime);
  if(!size.width || !size.height) fail('image-dimensions', 'A Confluence picture has no width or height.');
  try {
    const bitmap=await globalThis.createImageBitmap(new Blob([bytes],{type:mime}));
    const matches=bitmap.width===size.width && bitmap.height===size.height;bitmap.close();
    if(!matches) throw new Error('Image dimensions disagree.');
  } catch { fail('unsupported-image', 'A Confluence picture is damaged, or too large for this browser to open.'); }
  const scaled=await scaleToSharePoint(bytes,mime,size);
  if(scaled){bytes=scaled.bytes;Object.assign(size,scaled.size);}
  return {id:await sha256(bytes),mime,size:bytes.byteLength,bytes,...size,...(scaled?{scaledFrom:scaled.from}:{})};
}

/**
 * SharePoint shows a picture at most as wide as a one-column section, twice
 * that on high-density screens, so pixels beyond that width only cost upload
 * time and storage. A wider picture is scaled to that width in its own format
 * (JPEG and WebP at high quality). Animated GIFs keep their frames, and a
 * picture is kept as it was if scaling would not make it smaller.
 */
async function scaleToSharePoint(bytes,mime,size) {
  const width=2*SHAREPOINT_COLUMN_WIDTH;
  if(size.width<=width||mime==='image/gif')return null;
  const height=Math.max(1,Math.round(size.height*width/size.width));
  try {
    const bitmap=await globalThis.createImageBitmap(new Blob([bytes],{type:mime}),{resizeWidth:width,resizeHeight:height,resizeQuality:'high'});
    const canvas=globalThis.document.createElement('canvas');canvas.width=width;canvas.height=height;
    canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
    const blob=await new Promise(resolve=>{try{canvas.toBlob(resolve,mime,mime==='image/png'?undefined:0.92);}catch{resolve(null);}});
    if(!blob||blob.type!==mime||blob.size>=bytes.byteLength)return null;
    return {bytes:new Uint8Array(await blob.arrayBuffer()),size:{width,height},from:{width:size.width,height:size.height,size:bytes.byteLength}};
  } catch { return null; }
}
