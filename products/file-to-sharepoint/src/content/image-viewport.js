const MAX_SIDE=4096,MAX_PIXELS=8*1024*1024,MAX_BYTES=32*1024*1024;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
export const MIN_NATIVE_IMAGE_WIDTH=12;

export function planImagePadding({sourceWidth,sourceHeight,displayWidth}){
  if(![sourceWidth,sourceHeight,displayWidth].every(n=>Number.isSafeInteger(n)&&n>0&&n<=100000))
    fail('image-padding-invalid','A narrow image has invalid source or display dimensions.');
  if(displayWidth>=MIN_NATIVE_IMAGE_WIDTH)return null;
  // An integral multiple keeps the original pixels at exactly the same scale.
  // Only the transparent canvas grows; the original paint is never stretched.
  const factor=Math.ceil(MIN_NATIVE_IMAGE_WIDTH/displayWidth),width=sourceWidth*factor,height=sourceHeight;
  if(width>MAX_SIDE||height>MAX_SIDE||width*height>MAX_PIXELS)
    fail('image-padding-limit','A narrow image cannot be displayed within the browser rendering limits.');
  return {width,height,displayWidth:displayWidth*factor,paddingRight:width-sourceWidth};
}

export function planImageViewport({sourceWidth,sourceHeight,displayWidth,displayHeight}){
  if(![sourceWidth,sourceHeight,displayWidth,displayHeight].every(n=>Number.isFinite(n)&&n>0&&n<=100000)||![sourceWidth,sourceHeight].every(Number.isInteger))
    fail('image-viewport-invalid','An image viewport has invalid source or display dimensions.');
  const requestedDensity=Math.max(2,sourceWidth/displayWidth,sourceHeight/displayHeight);
  const scale=Math.min(requestedDensity,MAX_SIDE/displayWidth,MAX_SIDE/displayHeight,Math.sqrt(MAX_PIXELS/(displayWidth*displayHeight)));
  let width=Math.max(1,Math.min(MAX_SIDE,Math.ceil(displayWidth*scale))),height=Math.max(1,Math.min(MAX_SIDE,Math.ceil(displayHeight*scale)));
  while(width*height>MAX_PIXELS){if(width/displayWidth>=height/displayHeight)width--;else height--;}
  if(Math.abs(displayWidth*height/width-displayHeight)>1){
    // Side/area caps can make independent pixel rounding distort tall images.
    // Choose the largest bounded integer viewport within one CSS pixel; retain
    // two pixels per display pixel whenever the bounds permit that density.
    const minimumDensity=scale>=2?2:0;let fitted=false;
    for(let candidate=width;candidate>0;candidate--){
      const other=Math.ceil(candidate*displayHeight/displayWidth);
      if(other<1||other>MAX_SIDE||candidate*other>MAX_PIXELS||Math.min(candidate/displayWidth,other/displayHeight)<minimumDensity-1e-10||Math.abs(displayWidth*other/candidate-displayHeight)>1)continue;
      width=candidate;height=other;fitted=true;break;
    }
    if(!fitted)fail('image-viewport-limit','The authored image proportions cannot be preserved within the browser rendering limits.');
  }
  const density=Math.min(width/displayWidth,height/displayHeight);
  return{width,height,density,requestedDensity,densityLimited:density<requestedDensity-1e-10};
}

async function verifyStatic(blob){
  // Canvas snapshots cannot preserve GIF, WebP or APNG animation. Use the
  // browser's own decoder metadata rather than infer frame structure ourselves.
  if(!['image/png','image/gif','image/webp'].includes(blob.type))return;
  if(typeof ImageDecoder!=='function'||!await ImageDecoder.isTypeSupported(blob.type))fail('image-viewport-animation','This browser cannot verify whether the resized source image is animated.');
  let decoder;
  try{
    decoder=new ImageDecoder({data:await blob.arrayBuffer(),type:blob.type});await decoder.tracks.ready;await decoder.completed;
    const track=decoder.tracks.selectedTrack;
    if(!decoder.complete||!track||!Number.isInteger(track.frameCount)||track.frameCount<1)fail('image-viewport-animation','The resized image frame count could not be verified.');
    // A single-frame GIF can report animated=true because it has a loop
    // extension. The completed input's actual frame count is authoritative.
    if(track.frameCount!==1)fail('image-viewport-animation','An animated image cannot be preserved by a static PNG.');
  }catch(error){if(typeof error.code==='string')throw error;fail('image-viewport-render','The source image could not be decoded for its authored viewport.');}
  finally{decoder?.close();}
}

/** Native SharePoint floors proportional image widths. A transparent gutter
 * keeps narrow images visible without changing their original paint scale. */
export async function renderImagePadding(blob,dimensions,{signal}={}){
  const checkAbort=()=>{if(signal?.aborted)throw new DOMException('Conversion cancelled.','AbortError');};
  checkAbort();const plan=planImagePadding(dimensions);if(!plan)return null;
  let bitmap,canvas;
  try{
    if(!(blob instanceof Blob)||!blob.size)fail('image-padding-render','The narrow source image is empty.');
    await verifyStatic(blob);checkAbort();bitmap=await createImageBitmap(blob);checkAbort();
    if(bitmap.width!==dimensions.sourceWidth||bitmap.height!==dimensions.sourceHeight)
      fail('image-padding-render','The narrow source image dimensions changed.');
    canvas=document.createElement('canvas');canvas.width=plan.width;canvas.height=plan.height;
    const context=canvas.getContext('2d');if(!context)fail('image-padding-render','The browser image renderer is unavailable.');
    context.drawImage(bitmap,0,0);
    const output=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));checkAbort();
    if(!output?.size||output.size>MAX_BYTES)fail('image-padding-render','The narrow image exceeds the 32 MiB rendering limit.');
    const bytes=new Uint8Array(await output.arrayBuffer());checkAbort();
    if(bytes.length<24||![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)||new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(16)!==plan.width||new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(20)!==plan.height)
      fail('image-padding-render','The narrow image PNG could not be verified.');
    return {...plan,mime:'image/png',bytes};
  }catch(error){if(error?.name==='AbortError'||typeof error.code==='string')throw error;fail('image-padding-render','The narrow source image could not be prepared.');}
  finally{bitmap?.close();if(canvas){canvas.width=1;canvas.height=1;}}
}

/** Render only a verified nonuniform viewport. Natural-aspect callers retain
 * their original bytes and never enter this function. All dimensions are from
 * the browser/Office layout, not HTML attributes interpreted by a new parser. */
export async function renderImageViewport(blob,dimensions){
  const plan=planImageViewport(dimensions);let bitmap,canvas;
  try{
    if(!(blob instanceof Blob)||!blob.size)fail('image-viewport-render','The source viewport image is empty.');
    await verifyStatic(blob);bitmap=await createImageBitmap(blob);
    if(bitmap.width!==dimensions.sourceWidth||bitmap.height!==dimensions.sourceHeight)fail('image-viewport-render','The source image dimensions changed while preparing its authored viewport.');
    canvas=document.createElement('canvas');canvas.width=plan.width;canvas.height=plan.height;
    const context=canvas.getContext('2d');if(!context)fail('image-viewport-render','The browser image renderer is unavailable.');
    context.drawImage(bitmap,0,0,plan.width,plan.height);
    const output=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!output?.size||output.size>MAX_BYTES)fail('image-viewport-render','The authored image viewport could not be rendered within the 32 MiB limit.');
    const bytes=new Uint8Array(await output.arrayBuffer());
    if(bytes.length<24||![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)||new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(16)!==plan.width||new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(20)!==plan.height)
      fail('image-viewport-render','The authored image viewport PNG could not be verified.');
    return{...plan,mime:'image/png',bytes};
  }catch(error){if(typeof error.code==='string')throw error;fail('image-viewport-render','The source image could not be rendered for its authored viewport.');}
  finally{bitmap?.close();if(canvas){canvas.width=1;canvas.height=1;}}
}
