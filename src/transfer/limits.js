// Limits that come from the platforms themselves, not from this extension.

// SharePoint Online accepts one file of up to 250 MB in a single REST upload
// request; larger files need its chunked upload API, which pictures do not.
// https://github.com/SharePoint/sp-dev-docs/issues/4973
// https://techcommunity.microsoft.com/blog/spblog/always-use-file-chunking-to-upload-files--250-mb-to-sharepoint-online/509988
export const MAX_PICTURE_BYTES=250*1024*1024;

// Chrome refuses an extension message larger than 64 MiB, so pictures move
// between the page and the side panel in pieces this size (base64 adds a third).
// https://developer.chrome.com/docs/extensions/develop/concepts/messaging
export const PICTURE_PIECE_BYTES=8*1024*1024;

// The width of a one-column section on a SharePoint modern page, which an
// Image web part fills unless it is resized.
// https://support.microsoft.com/en-us/sharepoint/web-parts-and-apps-in-sharepoint/image-sizing-and-scaling-in-sharepoint-modern-pages
export const SHAREPOINT_COLUMN_WIDTH=1204;

// The browser's own base64 conversion where it has one; otherwise small slices,
// since spreading many bytes into one call can exhaust a content script's stack.
export const bytesToBase64=bytes=>{
  if(typeof bytes.toBase64==='function')return bytes.toBase64();
  let binary='';for(let offset=0;offset<bytes.length;offset+=4096)binary+=String.fromCharCode.apply(null,bytes.subarray(offset,offset+4096));
  return globalThis.btoa(binary);
};
// Pieces are megabytes long, so they are checked by the decoder itself rather
// than by a pattern, which can exhaust the regular-expression stack. Returns
// null for anything that is not strict, padded base64.
export const base64ToBytes=value=>{
  if(typeof value!=='string'||value.length%4)return null;
  try{
    if(typeof Uint8Array.fromBase64==='function')return Uint8Array.fromBase64(value,{lastChunkHandling:'strict'});
    if(/[^A-Za-z0-9+/=]/.test(value)||/=[^=]/.test(value))return null;
    const binary=globalThis.atob(value),bytes=new Uint8Array(binary.length);
    for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
    return bytes;
  }catch{return null;}
};
export async function sha256Hex(bytes){
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
