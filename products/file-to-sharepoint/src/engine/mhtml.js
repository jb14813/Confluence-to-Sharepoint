import {MimeParser} from '../../vendor/mime-parser.js';

const MAX_SOURCE=50*1024*1024,MAX_EXPANDED=150*1024*1024;
const fail=(message,code='INVALID_MHTML')=>{throw Object.assign(new Error(message),{code});};
const binaryString=bytes=>{
  const parts=[];
  for(let i=0;i<bytes.length;i+=16384)parts.push(String.fromCharCode(...bytes.subarray(i,i+16384)));
  return parts.join('');
};
const single=(headers,name)=>{
  const values=headers.getRawHeader(name)||[];
  if(values.length>1)fail('The Word archive contains ambiguous MIME headers.');
  return values[0]?.trim()||'';
};

/** Resource identities are never filesystem paths or network requests. */
export function resourceLocation(value,base){
  if(typeof value!=='string'||!value||value.length>4096||/[\\\u0000-\u0020\u007f]/u.test(value)||/%(?:00|2f|5c)/i.test(value))
    fail('The Word archive contains an unsafe embedded resource identity.','UNSAFE_MHTML_RESOURCE');
  let decoded;
  try{decoded=decodeURIComponent(value);}catch{fail('The Word archive contains an invalid resource identity.','UNSAFE_MHTML_RESOURCE');}
  if(decoded.split(/[/?#]/).some(part=>part==='.'||part==='..'))
    fail('The Word archive contains a relative traversal in a resource identity.','UNSAFE_MHTML_RESOURCE');
  let url;
  try{url=new URL(value,base);}catch{fail('The Word archive contains an invalid resource location.','UNSAFE_MHTML_RESOURCE');}
  if(!['file:','https:','http:'].includes(url.protocol)||url.username||url.password||url.hash||url.protocol==='file:'&&url.hostname)
    fail('The Word archive contains an unsupported embedded resource location.','UNSAFE_MHTML_RESOURCE');
  return url.href;
}

/** Only MIME-wrapped .doc files take this route; genuine OLE remains native. */
export function isMhtmlDocument(bytes){
  if(!(bytes instanceof Uint8Array)||!bytes.length)return false;
  const head=new TextDecoder().decode(bytes.subarray(0,65536)).split(/\r?\n\r?\n/,1)[0];
  return /^MIME-Version\s*:\s*1\.0\s*$/mi.test(head)&&/^Content-Type\s*:\s*multipart\/related\b/mi.test(head);
}

/** Decode a bounded flat Word MIME archive with the established upstream parser.
 * HTML remains inert data here. The processing sandbox validates/reconstructs it.
 * Exactly one HTML root is required; separate HTML bodies are never concatenated.
 */
export function parseMhtml(bytes){
  if(!(bytes instanceof Uint8Array)||!bytes.length)fail('The Word archive is empty.');
  if(bytes.length>MAX_SOURCE)fail('The document exceeds the 50 MiB limit.','DOCUMENT_TOO_LARGE');
  let rootLocation='',html='',boundary='',partCount=0,headerBytes=0,expandedBytes=0,htmlCount=0;
  const parts=new Map(),resources=[],media=Object.create(null),locations=new Set(),contentIds=new Set();
  const emitter={
    startPart(number,headers){
      if(++partCount>4096)fail('The Word archive contains too many MIME parts.','DOCUMENT_TOO_LARGE');
      const size=headers.rawHeaderText.length;
      headerBytes+=size;
      if(size>65536||headerBytes>2*1024*1024)fail('The Word archive MIME headers exceed the local processing limit.','DOCUMENT_TOO_LARGE');
      const mime=headers.contentType.type;
      single(headers,'content-type');single(headers,'content-transfer-encoding');
      if(number===''){
        if(mime!=='multipart/related'||!headers.contentType.has('boundary'))fail('The Word file is not a related MIME archive.');
        boundary=headers.contentType.get('boundary');
        if(typeof boundary!=='string'||!boundary||boundary.length>200||/[\r\n]/.test(boundary))fail('The Word archive boundary is invalid.');
        return;
      }
      // Confluence Word exports contain one flat related set. More MIME trees
      // require a distinct import contract rather than heuristic body selection.
      if(number.includes('.')||mime.startsWith('multipart/')||mime.startsWith('message/'))fail('The Word archive has an unsupported nested MIME structure.');
      const location=single(headers,'content-location'),rawId=single(headers,'content-id');
      const contentId=rawId.replace(/^<([^<>]+)>$/,'$1');
      if(contentId&&(!/^[^<>\s\u0000-\u001f\u007f]{1,1000}$/u.test(contentId)))fail('The Word archive contains an invalid content identity.');
      if(mime==='text/html'){
        if(++htmlCount>1||!location)fail('The Word archive must contain exactly one identified HTML body.');
        rootLocation=resourceLocation(location);
      }
      const charset=headers.contentType.get('charset');
      if(mime.startsWith('text/')&&charset){try{new TextDecoder(charset);}catch{fail('The Word archive uses an unsupported text encoding.');}}
      parts.set(number,{mime,location,contentId,chunks:[],text:[],decoder:mime==='text/html'?new TextDecoder(charset||'utf-8',{fatal:true}):null});
    },
    deliverPartData(number,data,raw){
      const part=parts.get(number);
      if(!part)fail('The Word archive contains an unidentified MIME body.');
      const size=typeof data==='string'?data.length*2:data?.byteLength;
      if(!Number.isSafeInteger(size))fail('The Word archive returned invalid decoded data.');
      expandedBytes+=size;
      if(expandedBytes>MAX_EXPANDED)fail('The expanded document exceeds the 150 MiB limit.','DOCUMENT_TOO_LARGE');
      if(part.mime==='text/html'){
        if(typeof data!=='string')fail('The Word archive HTML text could not be decoded.');
        if(!(raw instanceof Uint8Array))fail('The Word archive HTML encoding could not be verified.');
        part.decoder.decode(raw,{stream:true});
        part.text.push(data);
      }else{
        const chunk=raw instanceof Uint8Array?raw:data;
        if(!(chunk instanceof Uint8Array))fail('The Word archive resource could not be decoded.');
        part.chunks.push(chunk);
      }
    },
    endPart(number){
      if(number==='')return;
      const part=parts.get(number);
      if(!part)fail('The Word archive MIME structure is incomplete.');
      if(part.mime==='text/html'){part.decoder.decode();html=part.text.join('');}
      else{
        const location=part.location?resourceLocation(part.location,rootLocation||undefined):'';
        if(!location&&!part.contentId)fail('An embedded Word resource has no identity.');
        if(location&&locations.has(location)||part.contentId&&contentIds.has(part.contentId))fail('The Word archive contains colliding resource identities.','AMBIGUOUS_MHTML_RESOURCE');
        if(location)locations.add(location);
        if(part.contentId)contentIds.add(part.contentId);
        const length=part.chunks.reduce((sum,value)=>sum+value.length,0),content=new Uint8Array(length);
        let offset=0;for(const chunk of part.chunks){content.set(chunk,offset);offset+=chunk.length;}
        const name=`mhtml-resource-${resources.length+1}.bin`;
        resources.push({name,location,contentId:part.contentId,mime:part.mime,bytes:content});
        media['word/media/'+name]=content;
      }
      parts.delete(number);
    },
  };
  try{
    const parser=new MimeParser(emitter,{bodyformat:'decode',strformat:'unicode',stripcontinuations:true,onerror(error){throw error;}});
    for(let offset=0;offset<bytes.length;offset+=65536)parser.deliverData(binaryString(bytes.subarray(offset,offset+65536)));
    parser.deliverEOF();
    // A permissive email reader may accept EOF without the final boundary.
    // A document import requires an intact archive before accepting its model.
    const tail=binaryString(bytes.subarray(Math.max(0,bytes.length-boundary.length-128))).trimEnd();
    if(htmlCount!==1||!html.trim()||parts.size||!boundary||!tail.endsWith('\n--'+boundary+'--'))fail('The Word archive is empty or truncated.');
    if(html.includes('\0')||html.length>50*1024*1024)fail('The decoded Word HTML is invalid or oversized.');
    return {html,rootLocation,resources,media,expandedBytes};
  }catch(error){
    if(['INVALID_MHTML','DOCUMENT_TOO_LARGE','UNSAFE_MHTML_RESOURCE','AMBIGUOUS_MHTML_RESOURCE'].includes(error?.code))throw error;
    fail('The Word MIME archive could not be decoded safely.');
  }
}
