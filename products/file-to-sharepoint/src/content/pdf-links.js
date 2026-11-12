import {checkCanvasBlock} from '../../../../src/sharepoint/canvas.js';
const fail=()=>{throw Object.assign(new Error('The PDF link metadata could not be verified.'),{code:'PDF_LINKS_UNVERIFIED'});};
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const escape=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

export function createPdfLinkSection(info,existingHrefs=[]){
 if(!info||info.version!==1||!integer(info.sourcePageCount,1,4096)||!Array.isArray(info.links)||info.links.length>10000||!integer(info.unsupportedCount,0,10000)||!integer(info.linkCount,0,10000)||info.linkCount!==info.links.length+info.unsupportedCount)fail();
 const existing=new Set(existingHrefs.map(href=>{try{return new URL(href).href;}catch{return href;}})),entries=new Map(),targetPages=new Set();let unsupported=info.unsupportedCount,pageLinks=false;
 for(const item of info.links){
  if(!item||Array.isArray(item)||!integer(item.pageIndex,0,info.sourcePageCount-1)||Object.keys(item).some(key=>!['pageIndex','kind','url','targetPageIndex'].includes(key)))fail();
  let href,label;
  if(item.kind==='uri'){
   if(typeof item.url!=='string'||item.url.length>8192||item.targetPageIndex!==undefined)fail();
   try{
    if(/[\u0000-\u001f\u007f\\]/u.test(item.url))throw Error();
    href=new URL(item.url).href;checkCanvasBlock({type:'text',html:`<p><a href="${escape(href)}">link</a></p>`});label=href;
   }catch{unsupported++;continue;}
  }else if(item.kind==='page'){
   if(!integer(item.targetPageIndex,0,info.sourcePageCount-1)||item.url!==undefined)fail();
   href='#file-pdf-page-'+(item.targetPageIndex+1);label='Source page '+(item.targetPageIndex+1);targetPages.add(item.targetPageIndex);pageLinks=true;
  }else fail();
  if(existing.has(href))continue;
  if(!entries.has(href))entries.set(href,{href,label,pages:new Set()});entries.get(href).pages.add(item.pageIndex+1);
 }
 const html=entries.size?'<p><strong>Links from the PDF</strong></p><ul>'+[...entries.values()].map(entry=>`<li><a href="${escape(entry.href)}">${escape(entry.label)}</a> (source ${entry.pages.size===1?'page':'pages'} ${[...entry.pages].sort((a,b)=>a-b).join(', ')})</li>`).join('')+'</ul>':'';
 if(html)checkCanvasBlock({type:'text',html});
 return{html,links:entries.size,unsupported,pageLinks,targetPages:[...targetPages].sort((a,b)=>a-b)};
}
