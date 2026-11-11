import {validateStaticSvg,renderStaticSvg} from './html-resources.js';
export {imageResourceMime,verifyStaticSvg} from './html-resources.js';
export {planDecorationBudget} from './decoration-budget.js';
export {imageViewGraphics} from './image-views.js';

const MAX_BYTES=150*1024*1024,MAX_IMAGES=4096;
const fail=(message,code='HTML_SVG_UNVERIFIED')=>{throw Object.assign(new Error(message),{code});};
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const roots=body=>[...body.querySelectorAll('svg')].filter(svg=>!svg.parentElement?.closest('svg'));
const encode=svg=>new TextEncoder().encode(new XMLSerializer().serializeToString(svg));
const reserve=(plan,count)=>{plan.totalBytes+=count;if(plan.totalBytes>plan.maxBytes)fail('The expanded SVG document exceeds the 150 MiB limit.','DOCUMENT_TOO_LARGE');};

function idsWithin(svg){
  const ids=new Map();
  for(const node of [svg,...svg.querySelectorAll('[id]')])if(node.hasAttribute('id')){
    const id=node.getAttribute('id');if(ids.has(id))fail('An SVG fragment target is ambiguous.');ids.set(id,node);
  }
  return ids;
}
function fragment(value,svg,ids,sourceIds){
  let url,id;try{url=new URL(value,svg.ownerDocument.baseURI);id=decodeURIComponent(url.hash.slice(1));}catch{fail('An SVG paint reference is malformed.');}
  const withoutHash=url=>{const copy=new URL(url);copy.hash='';return copy.href;};
  if(!value.startsWith('#')&&![svg.ownerDocument.URL,svg.ownerDocument.baseURI].some(base=>withoutHash(url)===withoutHash(base)))fail('An SVG paint reference is not local to its source document.');
  if(!id||!ids.has(id))fail('An SVG paint reference has no unique target inside its own picture.');
  if(sourceIds&&sourceIds.get(id)!==ids.get(id))fail('An SVG paint reference is shared across pictures or source elements and cannot be verified within one image.');
  return '#'+encodeURIComponent(id);
}
function portable(value,svg,ids,sourceIds){
  return value.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'"(]+))\s*\)/gi,(_,double,single,plain)=>'url("'+fragment(double??single??plain,svg,ids,sourceIds)+'")');
}
function validateReferences(svg,sourceIds){
  const ids=idsWithin(svg);
  for(const element of [svg,...svg.querySelectorAll('*')]){
    for(const attribute of element.attributes){
      if(['href','xlink:href'].includes(attribute.name)&&attribute.value.startsWith('#'))fragment(attribute.value,svg,ids,sourceIds);
      portable(attribute.value,svg,ids,sourceIds);
    }
    if(element.localName==='style')portable(element.textContent,svg,ids,sourceIds);
  }
}

/** Validate every source SVG before its inert HTML host is attached. */
export async function preflight(body,{resources,totalBytes,maxBytes=MAX_BYTES,assertActive}){
  if(assertActive!==undefined&&typeof assertActive!=='function')fail('The SVG preparation lifecycle is invalid.');
  assertActive?.();
  if(!Array.isArray(resources)||!Number.isSafeInteger(totalBytes)||totalBytes<0||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_BYTES)fail('The SVG preparation budget is invalid.');
  const plan={entries:[],totalBytes,maxBytes,names:new Set(resources.flatMap(resource=>[resource.name,resource.contentId].filter(Boolean))),nextName:resources.length+1};
  if(totalBytes>maxBytes)fail('The expanded SVG document exceeds the 150 MiB limit.','DOCUMENT_TOO_LARGE');
  const source=roots(body);if(source.length+resources.length>MAX_IMAGES)fail('The Word export contains too many pictures.','DOCUMENT_TOO_LARGE');
  const sourceIds=new Map();
  for(const element of body.ownerDocument.querySelectorAll('[id]')){const id=element.getAttribute('id');sourceIds.set(id,sourceIds.has(id)?null:element);}
  for(const svg of source){
    assertActive?.();
    const bytes=encode(svg);reserve(plan,bytes.length);validateStaticSvg(bytes);validateReferences(svg,sourceIds);
    const sourceHash=await hash(bytes);assertActive?.();
    plan.entries.push({source:svg.cloneNode(true),sourceHash,sourceBytes:bytes.length});
  }
  return plan;
}

/** Resolve the native browser cascade on the existing guarded SDK HTML host. */
export async function prepare(body,plan,{register}={}){
  const source=roots(body),inlineImages=[];
  if(source.length!==plan.entries.length)fail('The inline SVG source association changed.');
  if(source.length&&typeof register!=='function')fail('The inline SVG image registry is unavailable.');
  for(let index=0;index<source.length;index++){
    const svg=source[index],entry=plan.entries[index];
    if(!svg.isEqualNode(entry.source))fail('The inline SVG source association changed.');
    if(svg.getAnimations({subtree:true}).length)fail('Animated SVG styles cannot be preserved as a static picture.');
    const css=getComputedStyle(svg),pixels=value=>/^\d+(?:\.\d+)?px$/.test(value)?parseFloat(value):NaN,width=pixels(css.width),height=pixels(css.height);
    if(!(width>0&&height>0)||css.display==='none'||css.visibility!=='visible')fail('The SVG has no verified visible viewport.');
    if(css.transform!=='none'||['rotate','scale','translate'].some(property=>css.getPropertyValue(property)&&css.getPropertyValue(property)!=='none')||css.mixBlendMode!=='normal'||css.boxShadow!=='none'||['border-top-width','border-right-width','border-bottom-width','border-left-width','padding-top','padding-right','padding-bottom','padding-left'].some(property=>parseFloat(css.getPropertyValue(property))!==0))fail('The SVG has outer effects whose editable image geometry cannot be verified.');
    const clone=svg.cloneNode(true),originals=[svg,...svg.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')],ids=idsWithin(svg);
    for(let nodeIndex=0;nodeIndex<originals.length;nodeIndex++){
      const computed=getComputedStyle(originals[nodeIndex]);
      for(const property of computed){
        const value=portable(computed.getPropertyValue(property),svg,ids);
        // Bound computed-style expansion before constructing an oversized
        // styled clone; count XML escaping as well as the browser CSS text.
        const escaped=(property+': '+value+' !important;  ').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
        reserve(plan,new TextEncoder().encode(escaped).length);
        copies[nodeIndex].style.setProperty(property,value,'important');
      }
      // Yield between bounded groups so cancellation by frame disposal remains
      // responsive even for an unusually complex, but source-bounded, picture.
      if(nodeIndex&&nodeIndex%128===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    clone.querySelectorAll('style').forEach(style=>style.remove());
    clone.setAttribute('width',String(width));clone.setAttribute('height',String(height));
    clone.style.setProperty('width',width+'px','important');clone.style.setProperty('height',height+'px','important');
    const frozen=encode(clone);reserve(plan,frozen.length);validateStaticSvg(frozen);validateReferences(clone);
    const rendered=await renderStaticSvg(frozen,0);reserve(plan,rendered.bytes.length);
    const bitmap=await createImageBitmap(new Blob([rendered.bytes],{type:'image/png'}));
    let pixelWidth,pixelHeight;try{pixelWidth=bitmap.width;pixelHeight=bitmap.height;}finally{bitmap.close();}
    let name;do{name='mhtml-resource-'+(plan.nextName++)+'.bin';}while(plan.names.has(name));plan.names.add(name);
    const image={name,mime:'image/png',bytes:rendered.bytes,width:pixelWidth,height:pixelHeight,sourceHash:entry.sourceHash,sourceBytes:entry.sourceBytes};
    const url=register(image);if(typeof url!=='string'||!url.startsWith('blob:'))fail('The inline SVG image was not registered locally.');
    const img=body.ownerDocument.createElement('img');img.src=url;
    for(const attribute of ['class','id','dir','title'])if(svg.hasAttribute(attribute))img.setAttribute(attribute,svg.getAttribute(attribute));
    const alt=svg.getAttribute('aria-label')||svg.querySelector('title')?.textContent;if(alt)img.alt=alt;
    img.width=Math.max(1,Math.round(width));img.height=Math.max(1,Math.round(height));
    for(const property of ['display','vertical-align','margin-top','margin-right','margin-bottom','margin-left','float','clear'])img.style.setProperty(property,css.getPropertyValue(property),'important');
    img.style.setProperty('width',width+'px','important');img.style.setProperty('height',height+'px','important');
    // SVG paint, opacity and clipping are already baked into the PNG once.
    for(const[property,value]of [['opacity','1'],['filter','none'],['clip-path','none'],['mask','none'],['background','none'],['border','0'],['padding','0']])img.style.setProperty(property,value,'important');
    svg.replaceWith(img);
    inlineImages.push(image);
  }
  return{inlineImages,totalBytes:plan.totalBytes};
}
