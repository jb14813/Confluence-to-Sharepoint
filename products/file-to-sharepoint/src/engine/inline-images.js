const fail=()=>{throw Object.assign(new Error('The Office model returned invalid inline image data.'),{code:'INVALID_OFFICE_MODEL'});};
const signature=[137,80,78,71,13,10,26,10];
/** Accept only PNGs for exact original inline SVGs and actual SDK image refs.
 * The ordinary adapter still decodes every image and hashes its retained bytes.
 */
export function mergeInlineImages(media,images,{allowed=false,sourceInputs=[],imageReferences=[]}={}){
  if(!Array.isArray(images)||images.length>4096||!Array.isArray(sourceInputs)||sourceInputs.length!==images.length||!allowed&&images.length)fail();
  const sources=new Map(),references=new Set(imageReferences),names=new Set(Object.keys(media).map(name=>name.split('/').at(-1)));
  for(const input of sourceInputs){if(!/^[a-f0-9]{64}$/.test(input?.sourceHash)||!Number.isSafeInteger(input.sourceBytes)||input.sourceBytes<1||input.sourceBytes>32*1024*1024)fail();const key=input.sourceHash+':'+input.sourceBytes;sources.set(key,(sources.get(key)||0)+1);}
  const merged=Object.assign(Object.create(null),media),proof=[];let total=Object.values(media).reduce((n,bytes)=>n+bytes.byteLength,0);
  for(const image of images){
    if(!image||!/^mhtml-resource-[1-9][0-9]{0,4}\.bin$/.test(image.name)||names.has(image.name)||!references.has(image.name)||image.mime!=='image/png'||!(image.bytes instanceof Uint8Array)||image.bytes.length<24||image.bytes.length>32*1024*1024||!signature.every((value,index)=>image.bytes[index]===value)||![image.width,image.height].every(n=>Number.isInteger(n)&&n>0&&n<=4096)||image.width*image.height>8*1024*1024)fail();
    const header=new DataView(image.bytes.buffer,image.bytes.byteOffset,image.bytes.byteLength);
    if(header.getUint32(16)!==image.width||header.getUint32(20)!==image.height)fail();
    const key=image.sourceHash+':'+image.sourceBytes,count=sources.get(key);if(!count)fail();sources.set(key,count-1);
    names.add(image.name);total+=image.bytes.byteLength;if(total>150*1024*1024)fail();
    merged['word/media/'+image.name]=image.bytes;const {bytes,...metadata}=image;proof.push(metadata);
  }
  if(total>150*1024*1024||[...sources.values()].some(n=>n))fail();
  return {media:merged,images:proof};
}
