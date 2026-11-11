import {verifyPdfDrawingResources} from './pdf-drawing-resources.js';

const contexts=new WeakMap(),proofs=new WeakMap(),MAX_BYTES=150*1024*1024;
let zipApi;
async function loadZip(){
 if(!zipApi)zipApi=import(new URL('../../vendor/jszip.min.js',import.meta.url).href).then(()=>globalThis.JSZip);
 const Zip=await zipApi;if(typeof Zip?.loadAsync!=='function')fail();return Zip;
}
const fail=()=>{throw Object.assign(new Error('The PDF drawing sources could not be verified. No content was imported.'),{code:'PDF_DRAWINGS_UNVERIFIED'});};
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const same=(a,b)=>a instanceof Uint8Array&&b instanceof Uint8Array&&a.length===b.length&&a.every((n,i)=>n===b[i]);
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const checkSignal=signal=>{if(signal?.aborted)throw new DOMException('Aborted','AbortError');};
const frozen=rows=>Object.freeze(rows.map(row=>Object.freeze({...row})));
const equalReceipts=(actual,expected)=>Array.isArray(actual)&&actual.length===expected.length&&actual.every((row,i)=>record(row)&&Object.keys(row).length===Object.keys(expected[i]).length&&Object.entries(expected[i]).every(([key,value])=>Object.hasOwn(row,key)&&row[key]===value));
function mediaSize(media){
 if(!record(media)||Object.keys(media).length>10000)fail();let total=0;
 for(const bytes of Object.values(media))if(!(bytes instanceof Uint8Array)||(total+=bytes.length)>MAX_BYTES)fail();
}

/** Bind protected canonical PNGs to the actual retained DOCX, before aliases
 * replace names in the SDK media map. The original receipt schema is unchanged.
 */
export async function preparePdfDrawingAliases(value,docxBytes,{originalMedia,signal}={}){
 try{
  checkSignal(signal);if(value?.version!==2||!Array.isArray(value.pages)||value.pages.length>512)fail();
  const drawings=[],ids=new Set();let count=0;
  for(const [pageIndex,page]of value.pages.entries()){
   if(!Array.isArray(page.drawings))fail();
   for(const drawing of page.drawings){
    if(++count>16384||!Number.isSafeInteger(drawing.docPrId)||drawing.docPrId<1||ids.has(drawing.docPrId))fail();ids.add(drawing.docPrId);
    if(drawing.kind==='derived-vector')drawings.push({pageIndex,docPrId:drawing.docPrId,imageId:drawing.imageId,resourceName:drawing.representation?.resourceName});
   }
  }
  if(!drawings.length){const token=Object.freeze({receipts:Object.freeze([])});contexts.set(token,{value,ids,drawings,canonical:new Map(),originalHashes:new Map(),sourceDocxHash:null});return token;}
  if(!(docxBytes instanceof Uint8Array)||!docxBytes.length||docxBytes.length>200*1024*1024)fail();
  const Zip=typeof globalThis.JSZip?.loadAsync==='function'?globalThis.JSZip:await loadZip();checkSignal(signal);
  const zip=await Zip.loadAsync(docxBytes);checkSignal(signal);const files=Object.values(zip.files);
  if(files.length>10000)fail();let expanded=0;
  for(const file of files)if(!file.dir){const size=file._data?.uncompressedSize;if(!Number.isSafeInteger(size)||size<0||(expanded+=size)>MAX_BYTES)fail();}
  await Zip.loadAsync(docxBytes,{checkCRC32:true});checkSignal(signal);
  const media=Object.create(null);
  for(const file of files)if(!file.dir&&file.name.startsWith('word/media/')){
   if(file.unsafeOriginalName!==undefined&&file.unsafeOriginalName!==file.name)fail();
   media[file.name]=await file.async('uint8array');checkSignal(signal);
  }
  const receipts=await verifyPdfDrawingResources(value,media,{signal});checkSignal(signal);
  if(originalMedia!==undefined){mediaSize(originalMedia);for(const receipt of receipts)if(!same(media[receipt.resourceName],originalMedia[receipt.resourceName]))fail();}
  const canonical=new Map(receipts.map(receipt=>[receipt.resourceName,{receipt,bytes:media[receipt.resourceName]}]));
  const originalHashes=new Map(),canonicalHashes=new Map(receipts.map(r=>[r.resourceName,r.sha256]));
  for(const [name,bytes]of Object.entries(media)){
   const hash=canonicalHashes.get(name)??await digest(bytes);checkSignal(signal);
   if(originalHashes.has(hash)&&!same(originalHashes.get(hash),bytes))fail();originalHashes.set(hash,bytes);
  }
  const sourceDocxHash=await digest(docxBytes);checkSignal(signal);
  const token=Object.freeze({receipts:frozen(receipts)});contexts.set(token,{value,ids,drawings,canonical,originalHashes,sourceDocxHash});return token;
 }catch(error){if(error?.name==='AbortError')throw error;fail();}
}

/** A collided protected slot may contain another exact original ZIP resource,
 * but never an unknown/reencoded replacement, even if that slot is not used.
 */
export async function verifyPdfDrawingAliasMedia(context,media,{signal}={}){
 try{
  checkSignal(signal);const source=contexts.get(context);if(!source)fail();mediaSize(media);
  for(const [name,canonical]of source.canonical){
   const bytes=media[name];if(!(bytes instanceof Uint8Array))fail();if(same(bytes,canonical.bytes))continue;
   const hash=await digest(bytes);checkSignal(signal);if(!same(bytes,source.originalHashes.get(hash)))fail();
  }
 }catch(error){if(error?.name==='AbortError')throw error;fail();}
}

/** Resolve exact original bytes against the final model's own docPr/image
 * references. Receipts are portable evidence; only the opaque returned object
 * can authorize a synchronous binder alias in this process.
 */
export async function verifyPdfDrawingAliases(context,document,media,{signal,expectedAliases,expectedResources}={}){
 try{
  checkSignal(signal);const source=contexts.get(context);if(!source||!record(document)||document.type!=='document'||!Array.isArray(document.content))fail();mediaSize(media);
  if(expectedResources!==undefined&&!equalReceipts(expectedResources,context.receipts))fail();
  await verifyPdfDrawingAliasMedia(context,media,{signal});checkSignal(signal);
  const wanted=new Map(source.drawings.map(d=>[d.docPrId,d])),nodes=new Map(),allIds=new Set(),seen=new WeakSet(),stack=[document.content];let visited=0;
  while(stack.length){
   const node=stack.pop();if(node==null||typeof node!=='object')continue;
   if(++visited>500000||seen.has(node))fail();seen.add(node);
   if(node.type==='paraDrawing'){
    const id=node.docPr?.id;if(!source.ids.has(id)||allIds.has(id))fail();allIds.add(id);
    if(wanted.has(id)){if(node.graphic?.type!=='image')fail();nodes.set(id,node);}
   }
   for(const child of Object.values(node))if(child&&typeof child==='object')stack.push(child);
  }
  if(allIds.size!==source.ids.size||nodes.size!==wanted.size)fail();
  const receipts=[],byId=new Map(),hashes=new Map();
  for(const drawing of source.drawings){
   checkSignal(signal);const canonical=source.canonical.get(drawing.resourceName),node=nodes.get(drawing.docPrId),name=node.graphic.blipFill?.rasterImageId;
   if(!canonical||typeof name!=='string'||name.length>200||!/^image[1-9][0-9]*\.png$/.test(name))fail();
   const sdkResourceName='word/media/'+name,bytes=media[sdkResourceName];
   if(Object.keys(media).some(key=>key!==sdkResourceName&&key.split('/').at(-1)===name)||!same(bytes,canonical.bytes))fail();
   if(!hashes.has(sdkResourceName))hashes.set(sdkResourceName,await digest(bytes));checkSignal(signal);
   if(hashes.get(sdkResourceName)!==canonical.receipt.sha256)fail();
   const receipt={docPrId:drawing.docPrId,pageIndex:drawing.pageIndex,...canonical.receipt,sdkResourceName,sourceDocxHash:source.sourceDocxHash};receipts.push(receipt);byId.set(drawing.docPrId,receipt);
  }
  if(expectedAliases!==undefined&&!equalReceipts(expectedAliases,receipts))fail();
  const token=Object.freeze({receipts:frozen(receipts)});proofs.set(token,{value:source.value,document,byId});return token;
 }catch(error){if(error?.name==='AbortError')throw error;fail();}
}

export function pdfDrawingAliasName(proof,value,document,docPrId){
 const data=proofs.get(proof),receipt=data?.byId.get(docPrId);
 if(!data||data.value!==value||data.document!==document||!receipt)fail();
 return receipt.sdkResourceName.slice('word/media/'.length);
}

export function assertPdfDrawingAliasProof(proof,value,document){
 const data=proofs.get(proof);if(!data||data.value!==value||data.document!==document)fail();
}
