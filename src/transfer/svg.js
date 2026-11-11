import {SHAREPOINT_COLUMN_WIDTH} from './limits.js';
const SVG='image/svg+xml';
const MAX_CANVAS_SIDE=32767,MAX_CANVAS_PIXELS=268435456;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};

/**
 * Draws an SVG picture to PNG, because SharePoint image controls take bitmap
 * formats and an SVG file could carry script into the SharePoint site. An SVG
 * drawn as an image runs no scripts and loads no other files. The PNG is twice
 * the larger of the picture's own width and the widest Confluence shows it at,
 * at most twice a SharePoint column: sharp on high-density screens where the
 * page shows it, and when it is made larger in SharePoint up to its own size,
 * as an original picture of that size would be. Returns the PNG and the
 * picture's own width, at most a SharePoint column.
 */
export async function rasterizeSvg(bytes, displayWidth, {maxSide=MAX_CANVAS_SIDE,maxPixels=MAX_CANVAS_PIXELS,signal,displayHeight}={}) {
  const invalid = () => fail('unsupported-image', 'An SVG picture on this page could not be converted to PNG.');
  const aborted=()=>{if(signal?.aborted)throw new DOMException('Conversion cancelled.','AbortError');};
  const wait=async promise=>{
    if(!signal)return promise;const ready=Promise.resolve(promise);let cancel;
    if(signal.aborted){ready.catch(()=>{});aborted();}
    try{return await Promise.race([ready,new Promise((_,reject)=>{cancel=()=>reject(new DOMException('Conversion cancelled.','AbortError'));signal.addEventListener('abort',cancel,{once:true});})]);}
    finally{signal.removeEventListener('abort',cancel);}
  };
  aborted();
  const viewport=displayHeight!==undefined;
  if(viewport&&![displayWidth,displayHeight].every(value=>Number.isFinite(value)&&value>0&&value<=100000))fail('image-viewport-invalid','An SVG picture has invalid display dimensions.');
  const svg = new globalThis.DOMParser().parseFromString(new TextDecoder().decode(bytes), SVG).documentElement;
  if(svg?.localName!=='svg' || svg.namespaceURI!=='http://www.w3.org/2000/svg') invalid();
  const url = URL.createObjectURL(new Blob([bytes],{type:SVG}));
  let image,canvas;
  try {
    image = globalThis.document.createElement('img');
    image.src = url;
    try { await wait(image.decode()); } catch(error) { if(error?.name==='AbortError')throw error;invalid(); }
    aborted();
    // The picture's own size: absolute width and height, else its view box, else the browser's reading of it.
    const length = value => /^\s*\d+(?:\.\d+)?(?:px)?\s*$/.test(value ?? '') ? parseFloat(value) : 0;
    const box = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number), boxRatio = box[2] > 0 && box[3] > 0 ? box[3] / box[2] : 0;
    let width = length(svg.getAttribute('width')), height = length(svg.getAttribute('height'));
    if(!width && !height && boxRatio) { width = box[2]; height = box[3]; }
    else if(width && !height && boxRatio) height = width * boxRatio;
    else if(height && !width && boxRatio) width = height / boxRatio;
    if(!(width > 0 && height > 0)) { width = image.naturalWidth || 300; height = image.naturalHeight || 150; }
    canvas = globalThis.document.createElement('canvas');
    let viewportPlan;
    if(viewport){
      const requestedDensity=Math.max(2,2*Math.min(width,SHAREPOINT_COLUMN_WIDTH)/displayWidth),scale=Math.min(requestedDensity,maxSide/displayWidth,maxSide/displayHeight,Math.sqrt(maxPixels/(displayWidth*displayHeight)));
      canvas.width=Math.max(1,Math.min(maxSide,Math.ceil(displayWidth*scale)));canvas.height=Math.max(1,Math.min(maxSide,Math.ceil(displayHeight*scale)));
      while(canvas.width*canvas.height>maxPixels){if(canvas.width/displayWidth>=canvas.height/displayHeight)canvas.width--;else canvas.height--;}
      const density=Math.min(canvas.width/displayWidth,canvas.height/displayHeight);
      viewportPlan={width:canvas.width,height:canvas.height,density,requestedDensity,densityLimited:density<requestedDensity-1e-10};
    }else{
      const drawn = Math.min(Math.max(displayWidth > 0 ? displayWidth : 0, width), SHAREPOINT_COLUMN_WIDTH);
      const scale = Math.min(2 * drawn / width, maxSide / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
      canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    }
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await wait(new Promise(resolve => { try { canvas.toBlob(resolve, 'image/png'); } catch { resolve(null); } }));
    aborted();
    if(!png) invalid();
    const output=new Uint8Array(await png.arrayBuffer());aborted();
    return {bytes:output, ownWidth:Math.max(1, Math.round(Math.min(width, SHAREPOINT_COLUMN_WIDTH))),...(viewportPlan??{})};
  } finally { image?.removeAttribute('src');if(canvas){canvas.width=1;canvas.height=1;}URL.revokeObjectURL(url); }
}
