const MAX_FILES=4096,MAX_BYTES=150*1024*1024,MAX_DOCX=200*1024*1024;
const fail=()=>{throw Object.assign(new Error('The converted document images could not be verified. No content was imported.'),{code:'NATIVE_MEDIA_UNVERIFIED'});};
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,names)=>record(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const filename=value=>typeof value==='string'&&value.length>0&&value.length<=200&&value!=='.'&&value!=='..'&&!/[\\/\u0000-\u001f\u007f?#%:]/u.test(value);
const resource=value=>typeof value==='string'&&value.startsWith('word/media/')&&filename(value.slice(11));
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>a instanceof Uint8Array&&a.length===b.length&&a.every((value,index)=>value===b[index]);
function mediaSize(media){
 if(!record(media)||Object.keys(media).length>10000)fail();let total=0;
 for(const bytes of Object.values(media)){if(!(bytes instanceof Uint8Array)||(total+=bytes.length)>MAX_BYTES)fail();}return total;
}
function documentBytes(bytes){if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_DOCX)fail();}

/** DOCX→BIN can rename or recreate embedded pictures. Collect its actual local
 * media outputs, retaining identical original ZIP resources without a second
 * receipt or byte copy. Each invocation runs inside one fresh native worker.
 */
export async function collectNativeMedia(fs,original,docxBytes){
 try{
  documentBytes(docxBytes);let total=mediaSize(original);const names=fs.readdir('/working/media').filter(name=>name!=='.'&&name!=='..');
  if(names.length>MAX_FILES||new Set(names).size!==names.length||names.some(name=>!filename(name)))fail();
  const files=[];
  for(const name of names.sort()){
   const path='/working/media/'+name,stat=fs.lstat(path);
   if(!fs.isFile(stat.mode)||!Number.isSafeInteger(stat.size)||stat.size<1||stat.size>MAX_BYTES)fail();
   const bytes=fs.readFile(path),key='word/media/'+name;
   if(!(bytes instanceof Uint8Array)||bytes.length!==stat.size)fail();
   if(same(original[key],bytes))continue;
   if((total+=bytes.length)>MAX_BYTES)fail();files.push({name:key,sha256:await digest(bytes),bytes});
  }
  return files.length?{version:1,sourceDocxHash:await digest(docxBytes),files}:undefined;
 }catch{fail();}
}

/** Validate the transported output against the exact DOCX used for this native
 * conversion. Native names are authoritative for its SDK model. Originals stay
 * in the retained source DOCX; changed names/bytes get explicit provenance.
 */
export async function reconcileNativeMedia(original,value,docxBytes){
 try{
  documentBytes(docxBytes);let total=mediaSize(original);
  if(!keys(value,['version','sourceDocxHash','files'])||value.version!==1||!/^[a-f0-9]{64}$/.test(value.sourceDocxHash)||
    value.sourceDocxHash!==await digest(docxBytes)||!Array.isArray(value.files)||value.files.length<1||value.files.length>MAX_FILES)fail();
  const names=new Set(),media=Object.assign(Object.create(null),original),receipts=[];
  for(const file of value.files){
   if(!keys(file,['name','sha256','bytes'])||!resource(file.name)||names.has(file.name)||!/^[a-f0-9]{64}$/.test(file.sha256)||
     !(file.bytes instanceof Uint8Array)||!file.bytes.length||same(original[file.name],file.bytes)||(total+=file.bytes.length)>MAX_BYTES||await digest(file.bytes)!==file.sha256)fail();
   names.add(file.name);const previous=original[file.name];
   receipts.push({resourceName:file.name,sourceDocxHash:value.sourceDocxHash,derivedHash:file.sha256,derivedBytes:file.bytes.length,originalHash:previous?await digest(previous):null,originalBytes:previous?.length??null});
   media[file.name]=file.bytes;
  }
  return {media,receipts};
 }catch{fail();}
}
