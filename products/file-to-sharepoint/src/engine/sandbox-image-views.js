/* Native SDK image views. This classic helper interprets no DrawingML paths or
 * transform matrices: the existing CImageShape draw implementation owns them. */
(() => {
  'use strict';
  const MAX_SIDE=4096,MAX_PIXELS=8*1024*1024,MAX_BYTES=32*1024*1024,MAX_SOURCE=150*1024*1024,CSS_PER_MM=96/25.4;
  const fail=message=>{throw Object.assign(new Error(message),{code:'IMAGE_VIEW_MODEL_INVALID'});};
  window.ftsDocumentDrawingObjects=function(documentApi){
    const wrappers=documentApi.GetAllDrawingObjects(),extra=documentApi.Document?.Endnotes?.GetAllDrawingObjects?.([])??[];
    if(!Array.isArray(wrappers)||!Array.isArray(extra))fail('The native drawing enumeration is invalid.');
    const pending=[...wrappers,...extra],seen=new Set(),ids=new Map(),result=[];let visited=0;
    for(let index=0;index<pending.length;index++){
      if(++visited>500000)fail('The native drawing enumeration exceeds its processing limit.');
      const item=pending[index],drawing=item?.Drawing??item?.GraphicObj??item;
      if(!drawing||typeof drawing!=='object')fail('The native drawing enumeration is invalid.');
      if(seen.has(drawing))continue;seen.add(drawing);
      const id=drawing.Get_Id?.();
      if(typeof id!=='string'||!id||ids.has(id))fail('The native drawing identifiers are invalid or duplicated.');
      ids.set(id,drawing);result.push({Drawing:drawing});
      if(Array.isArray(drawing.spTree))for(const child of drawing.spTree)pending.push(child);
    }
    return result;
  };
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  const aborted=signal=>{if(signal?.aborted)throw new DOMException('Image view conversion was cancelled.','AbortError');};
  const wait=async(promise,signal)=>{
    aborted(signal);let cancel;
    try{return await Promise.race([promise,new Promise((_,reject)=>{cancel=()=>reject(new DOMException('Image view conversion was cancelled.','AbortError'));signal?.addEventListener('abort',cancel,{once:true});})]);}
    finally{signal?.removeEventListener('abort',cancel);}
  };
  const completeIdentity=rect=>rect&&typeof rect==='object'&&!Array.isArray(rect)&&Object.keys(rect).length===4&&rect.l===0&&rect.t===0&&rect.r===100&&rect.b===100;
  const needed=graphic=>{
    const x=graphic.spPr?.xfrm,r=graphic.blipFill?.srcRect;
    return !!((x?.rot!=null&&x.rot!==0)||(x?.flipH!=null&&x.flipH!==false)||(x?.flipV!=null&&x.flipV!==false)||(r!=null&&!completeIdentity(r)));
  };
  const pathSafe=value=>typeof value==='string'&&value.length>0&&value.length<=1500&&!/[\\\u0000-\u001f\u007f?#%:]/u.test(value)&&!value.startsWith('/')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
  function mime(bytes){
    if(window.FtsSvg?.imageResourceMime)return FtsSvg.imageResourceMime(bytes);
    if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return'image/png';
    if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return'image/jpeg';
    if(/^GIF8[79]a/.test(String.fromCharCode(...bytes.subarray(0,6))))return'image/gif';
    if(String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP')return'image/webp';
    throw new Error('The transformed source image has an unsupported file signature.');
  }
  async function staticImage(bytes,type,signal){
    if(type==='image/svg+xml'){
      if(typeof window.FtsSvg?.verifyStaticSvg!=='function')throw new Error('The transformed SVG source cannot be verified.');
      await FtsSvg.verifyStaticSvg(bytes,{signal});return;
    }
    if(type==='image/jpeg')return;
    if(typeof ImageDecoder!=='function'||!await wait(ImageDecoder.isTypeSupported(type),signal))throw new Error('The transformed image frame count cannot be verified in this browser.');
    let decoder;
    try{
      aborted(signal);decoder=new ImageDecoder({data:bytes,type});
      await wait(decoder.tracks.ready,signal);await wait(decoder.completed,signal);
      if(!decoder.complete||decoder.tracks.selectedTrack?.frameCount!==1)throw new Error('An animated source image cannot be preserved by a static transformed PNG.');
    }finally{decoder?.close();}
  }

  window.ftsExportImageViews=async function(documentApi,model,budget={},options={}){
    const imageViews=Object.create(null),warnings=[],images=[],seen=new Set(),parts=new Map(),stack=[{value:model,page:0}];let visited=0;
    // Associate nested drawings with their real serialized root section. PDF
    // callers additionally supply the independently checked pageForId map.
    let page=0;
    if(!model||!Array.isArray(model.content))fail('The image source model is invalid.');
    stack.length=0;
    for(const root of model.content){stack.push({value:root,page});if(root?.pPr?.sectPr)page++;}
    if(model.sectPr)stack.push({value:model.sectPr,page:0});
    while(stack.length){
      const{value,page}=stack.pop();if(!value||typeof value!=='object')continue;if(++visited>500000)fail('The image source model exceeds its processing limit.');
      const partKey=['hdr','ftr'].includes(value.type)&&typeof value.ftsSourceId==='string'?value.type+':'+value.ftsSourceId:['footnote','endnote'].includes(value.type)&&typeof value.id==='string'?value.type+':'+value.id:null;
      if(partKey){if(parts.has(partKey)){if(!same(parts.get(partKey),value))fail('The repeated document part metadata is conflicting.');continue;}parts.set(partKey,value);}
      if(value.type==='image'){
        const graphic=value,id=graphic.id;
        if(typeof id!=='string'||!id||id.length>128||seen.has(id))fail('The image source model has invalid or duplicate graphic identifiers.');
        seen.add(id);if(needed(graphic))images.push({id,graphic,page});
      }
      for(const child of Object.values(value))if(child&&typeof child==='object')stack.push({value:child,page});
    }
    if(!images.length)return{imageViews,warnings};
    images.reverse();
    const{media,signal}=options;aborted(signal);
    const maxTotal=budget.maxTotal??512,perPage=budget.perPage??512;
    if(![maxTotal,perPage].every(value=>Number.isInteger(value)&&value>0&&value<=4096))fail('The image rendering budget is invalid.');
    const warn=(id,error)=>warnings.push({code:'IMAGE_VIEW_UNAVAILABLE',sourceId:id,message:String(error?.message||'The transformed image could not be reconstructed.').slice(0,1000),blocking:true});
    const all=new Map(),nativeSeen=new Set(),nativeStack=window.ftsDocumentDrawingObjects(documentApi).map(wrapper=>wrapper.Drawing);
    while(nativeStack.length){const drawing=nativeStack.pop();if(!drawing||nativeSeen.has(drawing))continue;nativeSeen.add(drawing);const id=drawing.Get_Id?.();if(all.has(id))fail('The native drawing identifiers are duplicated.');all.set(id,drawing);if(Array.isArray(drawing.spTree))nativeStack.push(...drawing.spTree);}
    const resources=new Map(),registered=[],perPageCount=new Map(),documentUrls=AscCommon.g_oDocumentUrls,loader=AscCommon.g_image_loader;
    let totalBytes=0,disposed=false;
    const clearCache=url=>{if(loader.map_image_index[url])delete loader.map_image_index[url];};
    const cleanup=()=>{
      if(disposed)return;disposed=true;
      for(const resource of registered){
        clearCache(resource.url);URL.revokeObjectURL(resource.url);
        if(documentUrls.urls[resource.key]===resource.url)delete documentUrls.urls[resource.key];
        if(documentUrls.urlsReverse[resource.url]===resource.key)delete documentUrls.urlsReverse[resource.url];
      }
      documentUrls.imageCount=Math.max(0,documentUrls.imageCount-registered.filter(resource=>resource.mapped).length);
    };
    try{
      let inputBytes=0;
      if(!media||typeof media!=='object'||Array.isArray(media))throw new Error('The transformed source images were not provided locally.');
      const entries=Object.entries(media);
      if(entries.length>4096)throw new Error('The transformed source media exceeds its resource limit.');
      for(const[name,bytes]of entries){if(!pathSafe(name)||!(bytes instanceof Uint8Array))throw new Error('The transformed source media is invalid.');inputBytes+=bytes.length;if(inputBytes>MAX_SOURCE)throw new Error('The transformed source media exceeds 150 MiB.');}
      async function resource(reference){
        if(!pathSafe(reference))throw new Error('The transformed image has an unsafe resource reference.');
        const matches=entries.filter(([name])=>name===reference||name.split('/').at(-1)===reference.split('/').at(-1));
        if(matches.length!==1)throw new Error('The transformed image has a missing or ambiguous local resource.');
        const[name,bytes]=matches[0];
        if(!resources.has(name))resources.set(name,(async()=>{
          if(!bytes.length||bytes.length>50*1024*1024)throw new Error('The transformed source image exceeds its byte limit.');
          const type=mime(bytes);await staticImage(bytes,type,signal);aborted(signal);
          const hash=Array.from(new Uint8Array(await wait(crypto.subtle.digest('SHA-256',bytes),signal)),value=>value.toString(16).padStart(2,'0')).join('');
          aborted(signal);const url=URL.createObjectURL(new Blob([bytes],{type})),alias='fts-image-view-'+crypto.randomUUID(),key=documentUrls.mediaPrefix+alias;
          const value={name,bytes:bytes.length,type,hash,url,alias,key};registered.push(value);aborted(signal);
          if(Object.hasOwn(documentUrls.urls,key)||Object.hasOwn(documentUrls.urlsReverse,url))throw new Error('A private image identity collided.');
          documentUrls.addImageUrl(alias,url);value.mapped=true;
          let timer;
          try{await wait(new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('The local SDK image loader timed out.')),12000);loader.LoadImagesWithCallback([url],()=>{if(disposed){clearCache(url);return;}const image=loader.map_image_index[url]?.Image;if(image)resolve();else reject(new Error('The local SDK image could not be decoded.'));});}),signal);}
          finally{clearTimeout(timer);}
          aborted(signal);const image=loader.map_image_index[url]?.Image;
          value.width=image?.naturalWidth||image?.width;value.height=image?.naturalHeight||image?.height;
          if(![value.width,value.height].every(n=>Number.isInteger(n)&&n>0&&n<=100000))throw new Error('The local SDK image has invalid natural dimensions.');
          return value;
        })());
        return resources.get(name);
      }
      for(let index=0;index<images.length;index++){
        const item=images[index];aborted(signal);
        try{
          const page=budget.pageForId?budget.pageForId.get(item.id):item.page,onPage=(perPageCount.get(page)||0)+1;perPageCount.set(page,onPage);
          if(index>=maxTotal||onPage>perPage||!Number.isInteger(page)||page<0||budget.pageForId&&page!==item.page)throw new Error('The transformed image has no verified page ownership or exceeds its image budget.');
          const xfrm=item.graphic.spPr?.xfrm??null,srcRect=item.graphic.blipFill?.srcRect??null;
          if(!xfrm||xfrm.rot!=null&&!Number.isFinite(xfrm.rot)||[xfrm.flipH,xfrm.flipV].some(value=>value!=null&&typeof value!=='boolean'))throw new Error('The transformed image has malformed native transform metadata.');
          if(srcRect&&(!['l','t','r','b'].every(key=>Object.hasOwn(srcRect,key)&&Number.isFinite(srcRect[key]))||Object.keys(srcRect).length!==4||srcRect.r<=srcRect.l||srcRect.b<=srcRect.t))throw new Error('The transformed image has incomplete or invalid crop metadata.');
          const drawing=all.get(item.id),writer=new AscJsonConverter.WriterToJSON();
          if(!drawing||drawing.getObjectType()!==AscDFH.historyitem_type_ImageShape||drawing.textBoxContent||drawing.txBody)throw new Error('The source identifier does not refer to an image-only native drawing.');
          if(JSON.stringify(writer.SerXfrm(drawing.spPr?.xfrm)??null)!==JSON.stringify(xfrm)||JSON.stringify(writer.SerSrcRect(drawing.blipFill?.srcRect)??null)!==JSON.stringify(srcRect))throw new Error('The transformed image model does not match its live SDK source.');
          const nativeReference=writer.SerBlipFill(drawing.blipFill).rasterImageId,reference=item.graphic.blipFill.rasterImageId;
          if(nativeReference!==reference)throw new Error('The transformed source resource does not match the live SDK image.');
          const image=await resource(reference);aborted(signal);
          const prepared=AscFormat.ExecuteNoHistory(()=>{
            const copy=drawing.copy({cacheImage:false});copy.setBDeleted(false);copy.setParent(drawing.parent);if(drawing.group)copy.setGroup(drawing.group);
            copy.blipFill.setRasterImageId(image.alias);copy.recalculate();
            const nativeMatrix=drawing.getTransformMatrix(),matrix=typeof nativeMatrix.CreateDublicate==='function'?nativeMatrix.CreateDublicate():nativeMatrix;
            const renderer={pen:copy.pen,draw:graphics=>copy.draw(graphics,matrix)};
            const width=drawing.extX*CSS_PER_MM,height=drawing.extY*CSS_PER_MM;
            if(![width,height].every(n=>Number.isFinite(n)&&n>0))throw new Error('The native image extents are invalid.');
            const requestedDensity=Math.max(2,image.width/width,image.height/height);
            if(!Number.isFinite(requestedDensity)||requestedDensity>1000000)throw new Error('The requested image resolution exceeds the native rendering limit.');
            const oldFlag=AscCommon.IsShapeToImageConverter;AscCommon.IsShapeToImageConverter=true;
            try{
              let density=requestedDensity,checked;
              for(let attempt=0;attempt<16;attempt++){
                const frameWidth=Math.max(1,Math.ceil(210*CSS_PER_MM*density)),frameHeight=Math.max(1,Math.ceil(297*CSS_PER_MM*density));
                const checker=new AscFormat.CSlideBoundsChecker();checker.init(frameWidth,frameHeight,210,297);checker.transform(1,0,0,1,0,0);checker.AutoCheckLineWidth=true;checker.CheckLineWidth(renderer);renderer.draw(checker);checker.CorrectBounds2();
                const b=checker.Bounds,spanWidth=b.max_x-b.min_x,spanHeight=b.max_y-b.min_y,pixelsWide=Math.floor(spanWidth+1),pixelsHigh=Math.floor(spanHeight+1);
                if(![b.min_x,b.min_y,b.max_x,b.max_y].every(n=>Number.isFinite(n)&&Math.abs(n)<=10000000)||!Number.isFinite(spanWidth)||!Number.isFinite(spanHeight)||pixelsWide<1||pixelsHigh<1)throw new Error('The native image painted bounds are invalid.');
                checked={frameWidth,frameHeight,width:pixelsWide,height:pixelsHigh,bounds:{min_x:b.min_x,min_y:b.min_y,max_x:b.max_x,max_y:b.max_y}};
                if(pixelsWide<=MAX_SIDE&&pixelsHigh<=MAX_SIDE&&pixelsWide*pixelsHigh<=MAX_PIXELS)break;
                density*=Math.min((MAX_SIDE-1)/pixelsWide,(MAX_SIDE-1)/pixelsHigh,Math.sqrt((MAX_PIXELS-MAX_SIDE*2)/(pixelsWide*pixelsHigh)));
                checked=null;
              }
              if(!checked)throw new Error('The transformed image cannot fit the browser canvas budget.');
              const sx=checked.frameWidth/210,sy=checked.frameHeight/297;
              if(Math.max(sx,sy)>1000000||checked.width/sx*CSS_PER_MM>100000||checked.height/sy*CSS_PER_MM>100000)throw new Error('The native image viewport exceeds its display bounds.');
              return{renderer,requestedDensity,...checked};
            }finally{AscCommon.IsShapeToImageConverter=oldFlag;}
          },null,[]);
          let canvas;
          try{
            aborted(signal);canvas=document.createElement('canvas');canvas.width=prepared.width;canvas.height=prepared.height;
            const context=canvas.getContext('2d');if(!context)throw new Error('The native image canvas is unavailable.');
            const oldFlag=AscCommon.IsShapeToImageConverter;AscCommon.IsShapeToImageConverter=true;
            try{const graphics=new AscCommon.CGraphics();graphics.init(context,prepared.frameWidth,prepared.frameHeight,210,297);graphics.m_oFontManager=AscCommon.g_fontManager;graphics.m_oCoordTransform.tx=-prepared.bounds.min_x;graphics.m_oCoordTransform.ty=-prepared.bounds.min_y;graphics.transform(1,0,0,1,0,0);prepared.renderer.draw(graphics);}
            finally{AscCommon.IsShapeToImageConverter=oldFlag;}
            const blob=await wait(new Promise(resolve=>canvas.toBlob(resolve,'image/png')),signal);
            if(!blob?.size||blob.size>MAX_BYTES||blob.size+totalBytes>MAX_BYTES||blob.size+totalBytes+inputBytes>MAX_SOURCE)throw new Error('The transformed PNG images exceed their bounded output budget.');
            const bytes=new Uint8Array(await wait(blob.arrayBuffer(),signal));aborted(signal);
            if(bytes.length<24||![137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)||new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(16)!==prepared.width||new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(20)!==prepared.height)throw new Error('The transformed PNG output could not be verified.');
            const sx=prepared.frameWidth/210,sy=prepared.frameHeight/297,b=prepared.bounds,density=Math.min(sx,sy)/CSS_PER_MM;
            imageViews[item.id]={bytes,mime:'image/png',width:prepared.width,height:prepared.height,
              viewport:{x:b.min_x/sx*CSS_PER_MM,y:b.min_y/sy*CSS_PER_MM,width:prepared.width/sx*CSS_PER_MM,height:prepared.height/sy*CSS_PER_MM,unit:'px'},
              affine:{xPixelsPerMm:sx,yPixelsPerMm:sy,bounds:b},
              source:{resourceName:image.name,sourceHash:image.hash,sourceBytes:image.bytes,xfrm:structuredClone(xfrm),srcRect:structuredClone(srcRect)},
              density,requestedDensity:prepared.requestedDensity,densityLimited:density<prepared.requestedDensity-1e-10};
            totalBytes+=bytes.length;
          }finally{if(canvas){canvas.width=0;canvas.height=0;}}
        }catch(error){if(error?.name==='AbortError')throw error;warn(item.id,error);}
      }
      aborted(signal);return{imageViews,warnings};
    }catch(error){if(error?.name==='AbortError')throw error;for(const item of images)if(!imageViews[item.id]&&!warnings.some(w=>w.sourceId===item.id))warn(item.id,error);return{imageViews,warnings};}
    finally{cleanup();}
  };
})();
