const fail=()=>{throw Object.assign(new Error('The Office model returned invalid transformed image data.'),{code:'INVALID_OFFICE_MODEL'});};
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const exactKeys=(value,keys)=>record(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const canonical=value=>Array.isArray(value)?value.map(canonical):record(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');

export function hasImageViewTransform(graphic){
  const transform=graphic?.spPr?.xfrm,crop=graphic?.blipFill?.srcRect;
  // The SDK stores crop boundaries, not OOXML crop amounts. Only its complete
  // full rectangle is an identity; missing individual fields default to null.
  const fullCrop=record(crop)&&Object.keys(crop).length===4&&crop.l===0&&crop.t===0&&crop.r===100&&crop.b===100;
  const malformedRotation=transform?.rot!=null&&(typeof transform.rot!=='number'||!Number.isFinite(transform.rot));
  const malformedFlip=['flipH','flipV'].some(key=>transform?.[key]!=null&&typeof transform[key]!=='boolean');
  return graphic?.type==='image'&&!!(malformedRotation||malformedFlip||transform?.rot||transform?.flipH||transform?.flipV||crop!=null&&!fullCrop);
}

export function imageViewGraphics(document){
  const needed=new Map(),parts=new Map(),pending=[document];let visited=0;
  while(pending.length){
    const value=pending.pop();if(!value||typeof value!=='object')continue;if(++visited>500000)fail();
    const partKey=['hdr','ftr'].includes(value.type)&&typeof value.ftsSourceId==='string'?value.type+':'+value.ftsSourceId:['footnote','endnote'].includes(value.type)&&typeof value.id==='string'?value.type+':'+value.id:null;
    if(partKey){if(parts.has(partKey)){if(!same(parts.get(partKey),value))fail();continue;}parts.set(partKey,value);}
    if(hasImageViewTransform(value)){
      if(typeof value.id!=='string'||!value.id||value.id.length>128||needed.has(value.id))fail();needed.set(value.id,value);
    }
    for(const child of Object.values(value))if(child&&typeof child==='object')pending.push(child);
  }
  return needed;
}

function imageResource(graphic,media){
  const reference=graphic.blipFill?.rasterImageId;
  if(typeof reference!=='string'||!reference||reference.length>1500||/[\\\u0000-\u001f\u007f?#%]/u.test(reference)||reference.startsWith('/')||reference.includes(':')||reference.split('/').some(part=>!part||part==='.'||part==='..'))fail();
  const resources=Object.keys(media).filter(name=>name===reference||name.split('/').at(-1)===reference.split('/').at(-1));
  if(resources.length!==1)fail();return resources[0];
}

/** Hydrate only requested transformed images. Ordinary resources and unrelated
 * ZIP entries never cross into the SDK frame for image-view rendering. */
export function imageViewResources(document,media){
  if(!record(media)||Object.keys(media).length>4096)fail();
  const resources=Object.create(null);let total=0;
  for(const graphic of imageViewGraphics(document).values()){
    const name=imageResource(graphic,media),bytes=media[name];
    if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>50*1024*1024)fail();
    if(!Object.hasOwn(resources,name)){total+=bytes.length;if(total>150*1024*1024)fail();resources[name]=bytes;}
  }
  return resources;
}

/** Bind an opaque SDK render to the exact native image model and original ZIP
 * resource. Ordinary images must stay on the unchanged-byte path. Every needed
 * view must have either a verified PNG or an explicit blocking failure.
 */
export async function verifyImageViews(document,media,imageViews,warnings,budget={maxTotal:512,pageForId:null,perPage:512}){
  if(!record(imageViews)||!Array.isArray(warnings)||warnings.length>4096||!record(media))fail();
  const needed=imageViewGraphics(document);
  if(needed.size>budget.maxTotal||Object.keys(imageViews).length>needed.size)fail();
  const failures=new Set(),perPage=new Map();
  for(const warning of warnings){
    if(!exactKeys(warning,['code','sourceId','message','blocking'])||warning.code!=='IMAGE_VIEW_UNAVAILABLE'||warning.blocking!==true||
      typeof warning.message!=='string'||!warning.message||warning.message.length>1000||!needed.has(warning.sourceId)||failures.has(warning.sourceId)||Object.hasOwn(imageViews,warning.sourceId))fail();
    failures.add(warning.sourceId);
  }
  let total=0,outputBytes=0;const hashes=new Map();
  for(const bytes of Object.values(media)){if(!(bytes instanceof Uint8Array))fail();total+=bytes.byteLength;}
  if(total>150*1024*1024)fail();
  for(const [id,graphic]of needed){
    if(budget.pageForId){const page=budget.pageForId.get(id),count=(perPage.get(page)||0)+1;if(page===undefined||count>budget.perPage)fail();perPage.set(page,count);}
    if(failures.has(id))continue;
    const view=imageViews[id];
    if(!exactKeys(view,['bytes','mime','width','height','viewport','source','affine','density','requestedDensity','densityLimited']))fail();
    const resource=imageResource(graphic,media),original=media[resource],source=view.source,viewport=view.viewport;
    if(!exactKeys(source,['resourceName','sourceHash','sourceBytes','xfrm','srcRect'])||source.resourceName!==resource||source.sourceBytes!==original.byteLength||
      !same(source.xfrm,graphic.spPr?.xfrm??null)||!same(source.srcRect,graphic.blipFill?.srcRect??null))fail();
    if(!hashes.has(resource))hashes.set(resource,digest(original));if(source.sourceHash!==await hashes.get(resource))fail();
    if(view.mime!=='image/png'||!(view.bytes instanceof Uint8Array)||view.bytes.length<24||view.bytes.length>32*1024*1024||
      ![137,80,78,71,13,10,26,10].every((n,i)=>view.bytes[i]===n)||![view.width,view.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=4096)||view.width*view.height>8*1024*1024)fail();
    const header=new DataView(view.bytes.buffer,view.bytes.byteOffset,view.bytes.byteLength);
    if(header.getUint32(16)!==view.width||header.getUint32(20)!==view.height||!exactKeys(viewport,['x','y','width','height','unit'])||viewport.unit!=='px'||
      ![viewport.x,viewport.y].every(n=>Number.isFinite(n)&&Math.abs(n)<=10000000)||![viewport.width,viewport.height].every(n=>Number.isFinite(n)&&n>0&&n<=100000)||
      Math.abs(viewport.width*view.height/view.width-viewport.height)>1)fail();
    const affine=view.affine,bounds=affine?.bounds,cssPixelsPerMm=96/25.4;
    if(!exactKeys(affine,['xPixelsPerMm','yPixelsPerMm','bounds'])||!exactKeys(bounds,['min_x','min_y','max_x','max_y'])||
      ![affine.xPixelsPerMm,affine.yPixelsPerMm].every(n=>Number.isFinite(n)&&n>0&&n<=1000000)||
      !Object.values(bounds).every(n=>Number.isFinite(n)&&Math.abs(n)<=10000000)||bounds.min_x>bounds.max_x||bounds.min_y>bounds.max_y||
      Math.floor(bounds.max_x-bounds.min_x+1)!==view.width||Math.floor(bounds.max_y-bounds.min_y+1)!==view.height)fail();
    const expectedViewport={x:bounds.min_x/affine.xPixelsPerMm*cssPixelsPerMm,y:bounds.min_y/affine.yPixelsPerMm*cssPixelsPerMm,width:view.width/affine.xPixelsPerMm*cssPixelsPerMm,height:view.height/affine.yPixelsPerMm*cssPixelsPerMm};
    if(Object.entries(expectedViewport).some(([key,value])=>Math.abs(viewport[key]-value)>1e-10*Math.max(1,Math.abs(value))))fail();
    const density=Math.min(view.width/viewport.width,view.height/viewport.height);
    if(!Number.isFinite(view.density)||view.density<=0||Math.abs(view.density-density)>1e-10*Math.max(1,density)||!Number.isFinite(view.requestedDensity)||view.requestedDensity<2||view.requestedDensity>1000000||
      typeof view.densityLimited!=='boolean'||view.densityLimited!==(density<view.requestedDensity-1e-10))fail();
    outputBytes+=view.bytes.byteLength;total+=view.bytes.byteLength;
    if(outputBytes>32*1024*1024||total>150*1024*1024)fail();
  }
  if(Object.keys(imageViews).some(id=>!needed.has(id)))fail();
  return {imageViews,warnings};
}
