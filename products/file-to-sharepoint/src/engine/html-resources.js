import {rasterizeSvg} from '../../../../src/transfer/svg.js';
const MAX_BYTES=32*1024*1024,MAX_TOTAL=150*1024*1024,MAX_IMAGES=4096;
const fail=(message,code='HTML_RESOURCE_BLOCKED',extra={})=>{throw Object.assign(new Error(message),{code,...extra});};
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const checkAbort=signal=>{if(signal?.aborted)throw new DOMException('Conversion cancelled.','AbortError');};
const hrefAttribute=attribute=>attribute.localName==='href'&&(!attribute.namespaceURI||attribute.namespaceURI==='http://www.w3.org/1999/xlink');
function svgCss(value){
  const css=value.replace(/\/\*[\s\S]*?\*\//g,'');
  if(css.includes('\\')||/@(?:import|font-face|namespace)\b|(?:image-set|cross-fade|paint|element|expression)\s*\(/i.test(css))fail('An SVG picture depends on external styles or fonts.');
  const remaining=css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'"(]+))\s*\)/gi,(_,double,single,plain)=>{
    if(!/^#[^\s'"()\\]+$/u.test(double??single??plain))fail('An SVG picture depends on external styles or fonts.');return '';
  });
  if(/url\s*\(/i.test(remaining))fail('An SVG picture has an unverified paint reference.');
}
function mime(bytes,declared=''){
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  const head=String.fromCharCode(...bytes.subarray(0,12));
  if(/^GIF8[79]a/.test(head))return 'image/gif';
  if(head.startsWith('RIFF')&&head.slice(8)==='WEBP')return 'image/webp';
  const headText=new TextDecoder().decode(bytes.subarray(0,65536)),xml=/^\s*(?:<|$)/.test(headText);
  // Unknown binary formats need only the short sniff. An XML candidate may
  // contain long comments or a prefixed SVG root; scan the bounded source so
  // a wrong filename cannot hide active SVG before a native bitmap override.
  const text=xml&&bytes.length>65536?new TextDecoder().decode(bytes):headText;
  if(declared.split(';')[0].trim().toLowerCase()==='image/svg+xml'||xml&&/<(?:[A-Za-z_][\w.-]*:)?svg\b/i.test(text))return 'image/svg+xml';
  fail('A linked or embedded picture is not a readable PNG, JPEG, GIF, WebP or SVG.');
}
export {mime as imageResourceMime};
export function validateStaticSvg(bytes){
  const doc=new DOMParser().parseFromString(new TextDecoder('utf-8',{fatal:true}).decode(bytes),'image/svg+xml'),svg=doc.documentElement;
  if(svg?.localName!=='svg'||svg.namespaceURI!=='http://www.w3.org/2000/svg'||doc.querySelector('parsererror'))fail('An SVG picture is malformed.');
  if(doc.doctype||doc.querySelector('script,foreignObject,iframe,frame,object,embed,form,input,button,animate,animateMotion,animateTransform,set'))fail('An SVG picture contains active or animated content that cannot be preserved as a static image.');
  // Image-mode decoding is inert. Reject dependencies as well: an unavailable
  // external font/image must not silently turn into an incomplete PNG.
  for(const element of doc.querySelectorAll('*'))for(const attribute of element.attributes){
    if(attribute.name.toLowerCase().startsWith('on'))fail('An SVG picture contains active event handlers.');
    if(attribute.namespaceURI==='http://www.w3.org/XML/1998/namespace'&&attribute.localName==='base'&&attribute.value)fail('An SVG picture changes the base of its resource references.');
    if((hrefAttribute(attribute)||attribute.name==='src')&&attribute.value&&!attribute.value.startsWith('#')&&!/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(attribute.value))fail('An SVG picture depends on another file. Include a self-contained image.');
    if(['style','fill','stroke','filter','clip-path','mask','marker','marker-start','marker-mid','marker-end','cursor'].includes(attribute.name))svgCss(attribute.value);
  }
  for(const style of doc.querySelectorAll('style'))svgCss(style.textContent);
  return doc;
}
async function svgWait(promise,signal){
  const ready=Promise.resolve(promise);let abort;
  if(signal?.aborted){ready.catch(()=>{});checkAbort(signal);}
  try{return await Promise.race([ready,new Promise((_,reject)=>{abort=()=>reject(new DOMException('Conversion cancelled.','AbortError'));signal?.addEventListener('abort',abort,{once:true});})]);}
  finally{signal?.removeEventListener('abort',abort);}
}
/** Image-mode SVG is inert, but it can still contain an animated raster. Use
 * the browser decoder's complete metadata before any Blob/image attachment.
 * Structural SVG parsing and dependency policy remain in the existing guard.
 */
export async function verifyStaticSvg(bytes,{signal}={}){
  checkAbort(signal);
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_BYTES)fail('An SVG picture exceeds the 32 MiB source limit.');
  let doc;try{doc=validateStaticSvg(bytes);}catch(error){if(error?.code==='HTML_RESOURCE_BLOCKED')throw error;fail('An SVG picture is malformed.');}
  if(doc.querySelectorAll('*').length>500000)fail('An SVG picture exceeds its element limit.');
  const seen=new Set();let imageCount=0,total=bytes.length;
  for(const image of doc.querySelectorAll('*')){
    for(const attribute of image.attributes){
      if(!(hrefAttribute(attribute)||attribute.name==='src')||!attribute.value||attribute.value.startsWith('#'))continue;
      if(++imageCount>MAX_IMAGES)fail('An SVG picture exceeds its nested image limit.');
      const value=attribute.value;if(seen.has(value))continue;seen.add(value);
      const match=/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\t\r\n ]+)$/i.exec(value);if(!match)fail('An SVG picture has an invalid embedded raster image.');
      let nested;try{nested=Uint8Array.from(atob(match[2]),char=>char.charCodeAt(0));}catch{fail('An SVG picture has an invalid embedded raster image.');}
      total+=nested.length;if(!nested.length||nested.length>MAX_BYTES||total>MAX_TOTAL)fail('An SVG picture exceeds its nested image byte limit.');
      const type=match[1].toLowerCase();if(mime(nested)!==type)fail('An SVG picture has an ambiguous embedded image type.');
      if(type==='image/png'){
        if(nested.length<24)fail('An SVG picture has an invalid embedded PNG.');const header=new DataView(nested.buffer,nested.byteOffset,nested.byteLength),width=header.getUint32(16),height=header.getUint32(20);
        if(!width||!height||width>4096||height>4096||width*height>8*1024*1024)fail('An SVG picture exceeds its embedded PNG pixel limit.');
      }
      if(typeof ImageDecoder!=='function'||!await svgWait(ImageDecoder.isTypeSupported(type),signal))fail('The embedded SVG image frame count cannot be verified.');
      checkAbort(signal);let decoder,decoded;
      try{
        decoder=new ImageDecoder({data:nested,type});const ready=decoder.tracks.ready,completed=decoder.completed;ready.catch(()=>{});completed.catch(()=>{});
        await svgWait(ready,signal);await svgWait(completed,signal);
        if(!decoder.complete||decoder.tracks.selectedTrack?.frameCount!==1)fail('An SVG picture contains an animated image that cannot be preserved as a static PNG.');
        const decoding=decoder.decode({frameIndex:0,completeFramesOnly:true}).then(value=>{
          if(signal?.aborted){value.image?.close();checkAbort(signal);}decoded=value;return value;
        });
        const value=await svgWait(decoding,signal),frame=value.image;
        if(value.complete!==true||!frame||![frame.codedWidth,frame.codedHeight,frame.displayWidth,frame.displayHeight].every(n=>Number.isSafeInteger(n)&&n>0&&n<=4096)||frame.codedWidth*frame.codedHeight>8*1024*1024||frame.displayWidth*frame.displayHeight>8*1024*1024)fail('An SVG picture exceeds its decoded raster pixel limit.');
        total+=frame.codedWidth*frame.codedHeight*4;if(total>MAX_TOTAL)fail('An SVG picture exceeds its expanded raster byte limit.');
      }catch(error){if(error?.name==='AbortError'||error?.code==='HTML_RESOURCE_BLOCKED')throw error;fail('An SVG picture has an unreadable embedded raster image.');}
      finally{decoded?.image?.close();decoder?.close();}
    }
  }
  checkAbort(signal);return doc;
}
/** Guard original ZIP SVGs before native generated-image aliases can replace
 * their bytes. Other formats remain the native media adapter's responsibility.
 */
export async function verifySvgMedia(media,{signal}={}){
  checkAbort(signal);
  if(!media||typeof media!=='object'||Array.isArray(media)||Object.keys(media).length>MAX_IMAGES)fail('The embedded image resources exceed their count limit.');
  let total=0;const entries=Object.entries(media);
  for(const[,bytes]of entries){if(!(bytes instanceof Uint8Array)||(total+=bytes.length)>MAX_TOTAL)fail('The embedded image resources exceed their 150 MiB byte limit.');}
  for(const[name,bytes]of entries){
    checkAbort(signal);let svg=/\.svg$/i.test(name);
    if(!svg){try{svg=mime(bytes)==='image/svg+xml';}catch{/* The native converter handles other embedded formats. */}}
    if(svg)await verifyStaticSvg(bytes,{signal});
  }
  checkAbort(signal);
}
export async function renderStaticSvg(bytes,displayWidth=0,{signal,displayHeight}={}){
  await verifyStaticSvg(bytes,{signal});const drawn=await rasterizeSvg(bytes,displayWidth,{maxSide:4096,maxPixels:8*1024*1024,signal,...(displayHeight!==undefined?{displayHeight}:{})}),output=drawn.bytes;checkAbort(signal);
  if(!(output instanceof Uint8Array)||output.length<24||output.length>MAX_BYTES||mime(output)!=='image/png')fail('An SVG picture could not be rendered within its PNG byte limit.');
  const header=new DataView(output.buffer,output.byteOffset,output.byteLength),width=header.getUint32(16),height=header.getUint32(20);
  if(!width||!height||width>4096||height>4096||width*height>8*1024*1024)fail('An SVG picture could not be rendered within its PNG pixel limit.');
  return{...drawn,mime:'image/png',width,height};
}
async function download(url,{fetchImpl,signal,timeoutMs}){
  checkAbort(signal);
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
  signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(url,{method:'GET',credentials:'omit',mode:'cors',referrerPolicy:'no-referrer',redirect:'error',signal:controller.signal,headers:{Accept:'image/png,image/jpeg,image/gif,image/webp,image/svg+xml'}});
    if(!response.ok||response.redirected||response.type==='opaque')fail('A linked picture could not be read from its source. Include it in the document and try again.');
    const length=response.headers.get('content-length');if(length&&/^\d+$/.test(length)&&Number(length)>MAX_BYTES)fail('A linked picture exceeds the 32 MiB download limit.');
    const chunks=[];let size=0;
    if(!response.body?.getReader)fail('A linked picture could not be read safely.');
    const reader=response.body.getReader();
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)fail('A linked picture exceeds the 32 MiB download limit.');chunks.push(value);}}
    catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    if(!bytes.length)fail('A linked picture is empty.');
    return {bytes,mime:mime(bytes,response.headers.get('content-type')||'')};
  }catch(error){if(signal?.aborted)throw new DOMException('Conversion cancelled.','AbortError');if(error.code)throw error;fail('A linked picture could not be downloaded. Include it in the document and try again.');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
}

/** Called in the extension page, never in the isolated SDK or native worker.
 * Source URLs stay inert unless the user explicitly enables linked-image reads.
 * Existing bitmap bytes are preserved; only SVG needs a local PNG rendering.
 */
export async function prepareHtmlResources(payload,{loadLinkedImages=false,fetchImpl=globalThis.fetch,signal,timeoutMs=30000}={}){
  checkAbort(signal);
  if(typeof payload?.html!=='string'||!Array.isArray(payload.resources)||payload.resources.length>MAX_IMAGES)fail('The Word resource payload is invalid.');
  const doc=new DOMParser().parseFromString(payload.html,'text/html'),resources=payload.resources.map(r=>({...r})),byLocation=new Map(),byCid=new Map(),linkedImages=[],inlineSvgSources=[];
  let total=payload.html.length*2;
  for(const resource of resources){
    if(!(resource.bytes instanceof Uint8Array))fail('An embedded Word image is invalid.');total+=resource.bytes.length;
    if(resource.location)byLocation.set(resource.location,resource);if(resource.contentId)byCid.set(resource.contentId,resource);
  }
  if(total>MAX_TOTAL)fail('The expanded document exceeds the 150 MiB limit.');
  const missing=new Set(),used=new Set();
  const identities=new Set(resources.flatMap(resource=>[resource.name,resource.contentId].filter(Boolean)));let nextName=resources.length+1;
  const allocateName=()=>{let name;do{name=`mhtml-resource-${nextName++}.bin`;}while(identities.has(name));identities.add(name);return name;};
  for(const img of doc.querySelectorAll('img')){
    const src=img.getAttribute('src')||'';let url;try{url=new URL(src,payload.rootLocation);}catch{fail('A Word picture has an invalid address.');}
    const resource=src.startsWith('cid:')?byCid.get(src.slice(4)):byLocation.get(url.href);
    if(resource){used.add(resource);continue;}
    // The source exporter uses this exact marker when an attachment is already
    // unknown. The sandbox retains that source state as an explicit text note.
    if(img.classList.contains('confluence-embedded-file')&&img.classList.contains('unknown-attachment')&&/^\/wiki\/plugins\/servlet\/confluence\/placeholder\/unknown-attachment(?:\?locale=[A-Za-z_]+)?$/.test(src))continue;
    // A relative file reference has no trustworthy website origin. Never guess
    // one from unrelated links or send local paths to a remote website.
    if(url.protocol!=='https:'||url.username||url.password||url.hash||!src.startsWith('https://'))fail('An image is missing from the document. Include the original image in the file and try again.');
    missing.add(url.href);
  }
  if(missing.size&&loadLinkedImages!==true)fail('This Word export links to pictures that are not included in the file. Load the linked pictures to continue.','HTML_LINKED_IMAGES_REQUIRED',{urls:[...missing]});
  for(const url of missing){
    checkAbort(signal);
    if(resources.length>=MAX_IMAGES)fail('The document contains too many pictures.');
    let source;try{source=await download(url,{fetchImpl,signal,timeoutMs});}catch(error){if(error.name==='AbortError')throw error;fail(error.message,'HTML_LINKED_IMAGE_FAILED',{urls:[...missing]});}
    total+=source.bytes.length;if(total>MAX_TOTAL)fail('The expanded document exceeds the 150 MiB limit.');
    checkAbort(signal);
    const resource={name:allocateName(),location:url,contentId:'',...source};resources.push(resource);byLocation.set(url,resource);used.add(resource);
    linkedImages.push({url,sourceHash:await hash(source.bytes),sourceMime:source.mime,sourceBytes:source.bytes.length});
  }
  const inline=[...doc.querySelectorAll('svg')].filter(svg=>!svg.parentElement?.closest('svg'));
  if(inline.length+resources.length>MAX_IMAGES)fail('The document contains too many pictures.','DOCUMENT_TOO_LARGE');
  for(const svg of inline){
    // Inline SVG depends on the document cascade. The existing isolated HTML
    // host freezes its computed styles and viewport before rasterizing it.
    const bytes=new TextEncoder().encode(new XMLSerializer().serializeToString(svg));validateStaticSvg(bytes);
    inlineSvgSources.push({sourceHash:await hash(bytes),sourceBytes:bytes.length});checkAbort(signal);
  }
  for(const resource of resources){
    checkAbort(signal);
    if(!used.has(resource))continue;
    const sourceMime=mime(resource.bytes,resource.mime);
    if(sourceMime==='image/svg+xml'){
      const drawn=await renderStaticSvg(resource.bytes,0,{signal});checkAbort(signal);
      // Preserve the SVG's CSS intrinsic width while retaining the renderer's
      // high-density PNG. Only this controlled metadata may supply density.
      const pixelWidth=new DataView(drawn.bytes.buffer,drawn.bytes.byteOffset,drawn.bytes.byteLength).getUint32(16);
      resource.svgDensity=pixelWidth/drawn.ownWidth;
      resource.bytes=drawn.bytes;resource.mime='image/png';total+=drawn.bytes.length;
    }
    const proof=linkedImages.find(p=>p.url===resource.location);if(proof){proof.outputHash=await hash(resource.bytes);proof.outputMime=resource.mime;proof.outputBytes=resource.bytes.length;}
    if(total>MAX_TOTAL)fail('The expanded document exceeds the 150 MiB limit.');
  }
  const media=Object.create(null);for(const resource of resources)media['word/media/'+resource.name]=resource.bytes;
  checkAbort(signal);
  return {htmlImport:{...payload,html:'<!doctype html>'+doc.documentElement.outerHTML,resources},media,linkedImages,inlineSvgSources};
}
