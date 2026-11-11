const fail=()=>{throw Object.assign(new Error('The PDF drawing sources could not be verified. No content was imported.'),{code:'PDF_DRAWINGS_UNVERIFIED'});};
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');

/** Verify the original DOCX resources before the SDK frame is constructed.
 * These are native representations of original vector paint, not PDF bitmap
 * sources. Receipts let the caller reject later same-name native replacements.
 * Full source provenance is independently validated by validatePdfDrawings.
 */
export async function verifyPdfDrawingResources(value,media,{signal}={}){
 try{
  const check=()=>{if(signal?.aborted)throw new DOMException('Aborted','AbortError');};check();
  if(value?.version!==2||!Array.isArray(value.pages)||value.pages.length>512||!record(media)||Object.keys(media).length>10000)fail();
  let total=0,derived=0,count=0;const resources=new Map(),receipts=[];
  for(const bytes of Object.values(media))if(!(bytes instanceof Uint8Array)||(total+=bytes.byteLength)>150*1024*1024)fail();
  for(const page of value.pages){
   if(!Array.isArray(page.drawings))fail();
   for(const drawing of page.drawings){
    if(++count>16384)fail();if(drawing.kind!=='derived-vector')continue;
    const rep=drawing.representation;
    if(!record(rep)||Object.keys(rep).length!==5||rep.format!=='png'||!integer(drawing.imageId,1,Number.MAX_SAFE_INTEGER)||rep.resourceName!==`word/media/image${drawing.imageId}.png`||
      !integer(rep.pixelWidth,1,4096)||!integer(rep.pixelHeight,1,4096)||rep.pixelWidth*rep.pixelHeight>8*1024*1024||!Number.isFinite(rep.dpi)||rep.dpi<192||rep.dpi>10000000)fail();
    if(resources.has(rep.resourceName)){if(JSON.stringify(resources.get(rep.resourceName))!==JSON.stringify([rep.pixelWidth,rep.pixelHeight,rep.dpi]))fail();continue;}
    if(Object.keys(media).some(name=>name!==rep.resourceName&&name.split('/').at(-1)===`image${drawing.imageId}.png`))fail();
    const bytes=media[rep.resourceName];
    if(!(bytes instanceof Uint8Array)||bytes.byteLength<33||(derived+=bytes.byteLength)>32*1024*1024||
      ![137,80,78,71,13,10,26,10].every((n,index)=>bytes[index]===n))fail();
    const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(header.getUint32(8)!==13||header.getUint32(12)!==0x49484452||header.getUint32(16)!==rep.pixelWidth||header.getUint32(20)!==rep.pixelHeight)fail();
    // Header dimensions alone do not prove that IDAT decodes to a real image.
    let bitmap;
    try{check();bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));check();if(bitmap.width!==rep.pixelWidth||bitmap.height!==rep.pixelHeight)fail();}
    finally{bitmap?.close();}
    resources.set(rep.resourceName,[rep.pixelWidth,rep.pixelHeight,rep.dpi]);
    check();const sha256=await digest(bytes);check();
    receipts.push({resourceName:rep.resourceName,sha256,bytes:bytes.byteLength,pixelWidth:rep.pixelWidth,pixelHeight:rep.pixelHeight,dpi:rep.dpi,imageId:drawing.imageId});
   }
  }
  return receipts;
 }catch(error){if(error?.name==='AbortError')throw error;fail();}
}
