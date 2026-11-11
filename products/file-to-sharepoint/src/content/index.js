import {preparePdfDrawingAliases,verifyPdfDrawingAliases} from '../engine/pdf-drawing-aliases.js';
import {checkCanvasBlock} from '../../../../src/sharepoint/canvas.js';
import {MAX_BLOCKS,MAX_PICTURE_BYTES,MAX_TEXT_HTML,SHAREPOINT_COLUMN_WIDTH,sha256Hex} from '../../../../src/transfer/limits.js';
import {adaptForms} from './forms.js';
import {cancelsNumbering,contentGroups,renderListContent} from './lists.js';
import {hasCellContent,planWordTable} from './table-grid.js';
import {planTableGeometry} from './table-geometry.js';
import {textboxStyles} from './textbox-style.js';
import {planDocumentParts} from './document-parts.js';
import {createStaticFieldState} from './static-fields.js';
import {planPdfPageAssociation,planPdfReadingOrder} from './pdf-layout.js';
import {composePdfDrawingFlow,planPdfNativeReflow,verifyPdfNativeReflowDrawings} from './pdf-drawing-flow.js';
import {assessPdfRenderedText,verifiedEmptyPdfBody} from '../engine/pdf-text.js';
import {renderImageViewport,renderImagePadding,MIN_NATIVE_IMAGE_WIDTH} from './image-viewport.js';
import {hasImageViewTransform} from '../engine/image-views.js';
import {imageResourceMime,renderStaticSvg} from '../engine/html-resources.js';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const clean=value=>String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,'');
const filename=name=>clean(name).split(/[\\/]/).at(-1).replace(/[<>:"|?*]/g,'_').replace(/[. ]+$/,'').slice(0,200)||'Imported document';
const hashText=value=>sha256Hex(new TextEncoder().encode(value));
const bytesOf=value=>value instanceof Uint8Array?value:value instanceof ArrayBuffer?new Uint8Array(value):null;
const attribute=styles=>styles.length?` style="${escape(styles.join(';'))}"`:'';
// The native PDF engine's embedded URW Base14 files report these families.
// Their established browser equivalents also have native editor definitions.
// Retain the original face in preview provenance when using those equivalents.
const BASE14_BROWSER_FONTS=new Map([['nimbus sans',['Arial','sans-serif']],['nimbus mono',['Courier New','monospace']],['nimbus roman',['Times New Roman','serif']]]);
// The native editor matches these complete declarations literally. Missing
// spaces or different quotes silently discard the family during an edit.
const NATIVE_FONT_FAMILIES=new Map([
  ['arial','Arial, Helvetica, sans-serif'],['courier new',"'Courier New', Courier, monospace"],
  ['times new roman',"'Times New Roman', Times, serif"],['georgia','Georgia, serif'],
  ['lucida sans unicode',"'Lucida Sans Unicode', 'Lucida Grande', sans-serif"],
  ['tahoma','Tahoma, Geneva, sans-serif'],['trebuchet ms',"'Trebuchet MS', Helvetica, sans-serif"],['verdana','Verdana, Geneva, sans-serif']
]);
const tableWrap=html=>`<div class="canvasRteResponsiveTable"><div class="tableCenterAlign tableWrapper">${html}</div></div>`;
const nativeTableWrap=html=>`<figure class="table" style="width:100%;">${html}</figure>`;
function color(value){
  const c=value?.rgba??value?.color?.rgba??value;
  const parts=c&&[c.r??c.red,c.g??c.green,c.b??c.blue];
  return parts?.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&!c.auto?`#${parts.map(n=>n.toString(16).padStart(2,'0')).join('')}`:null;
}
const merge=(...sources)=>{
  const result={};
  for(const source of sources)for(const [key,value] of Object.entries(source??{})){
    if(['__proto__','prototype','constructor'].includes(key))continue;
    result[key]=value&&typeof value==='object'&&!Array.isArray(value)?merge(result[key],value):value;
  }
  return result;
};
function imageMime(bytes){
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return 'image/png';
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  const head=String.fromCharCode(...bytes.subarray(0,12));
  if(/^GIF8[79]a/.test(head))return 'image/gif';
  if(head.startsWith('RIFF')&&head.slice(8)==='WEBP')return 'image/webp';
  fail('unsupported-image','A reconstructed image has an unsupported or invalid file signature.');
}
async function browserMeasure(blob){
  let bitmap;
  try{bitmap=await createImageBitmap(blob);return {width:bitmap.width,height:bitmap.height};}
  catch{fail('invalid-image','A reconstructed image could not be decoded in this browser.');}
  finally{bitmap?.close();}
}
function imageReference(reference,media){
  if(typeof reference!=='string'||!reference||reference.length>1500||/[\\\u0000-\u001f\u007f?#%]/u.test(reference)||reference.startsWith('/')||reference.includes(':')||reference.split('/').some(s=>!s||s==='.'||s==='..'))fail('unsafe-image-reference','A reconstructed image references an external or unsafe file path.');
  const paths=Object.keys(media).filter(path=>path===reference||path.split('/').at(-1)===reference.split('/').at(-1));
  if(paths.length>1)fail('ambiguous-image','More than one reconstructed image matches an embedded image reference.');
  if(!paths.length)fail('missing-image','A reconstructed image is missing from the local document assets.');
  const path=paths[0];
  if(path.startsWith('/')||path.includes(':')||/[\\\u0000-\u001f\u007f]/u.test(path)||path.split('/').some(s=>!s||s==='.'||s==='..'))fail('unsafe-image-reference','A reconstructed image has an unsafe local asset path.');
  return {path,bytes:media[path]};
}
function drawingGeometry(drawing){
  const extent=drawing.extent??drawing.graphic?.spPr?.xfrm?.ext??{};
  const position=(axis,key)=>Number.isFinite(axis?.posOffset)&&!axis.percent?axis.posOffset/9525:Number.isFinite(drawing.simplePos?.[key])&&drawing.simplePos.use?drawing.simplePos[key]/9525:0;
  return {x:position(drawing.positionH,'x'),y:position(drawing.positionV,'y'),width:Number.isFinite(extent.cx)?Math.max(0,extent.cx/9525):0,height:Number.isFinite(extent.cy)?Math.max(0,extent.cy/9525):0,unit:'px',horizontalReference:drawing.positionH?.relativeFrom??'inline',verticalReference:drawing.positionV?.relativeFrom??'inline'};
}
function borderStyle(border,warn){
  if(!border)return null;
  if(['none','nil'].includes(border.value))return '0pt solid #000000';
  const nativeStyles=new Map([['single','solid'],['double','double'],['dashed','dashed'],['dotted','dotted']]);
  const style=nativeStyles.get(border.value)??(/dash/i.test(String(border.value))?'dashed':'solid');
  if(!nativeStyles.has(border.value)||Number.isFinite(border.sz)&&(border.sz<0||border.sz>96))warn('table-border-adapted','Some table borders were simplified to native SharePoint strokes. Cell text and merged structure are preserved.');
  const width=Number.isFinite(border.sz)?Math.min(12,Math.max(0,border.sz/8)):0.5;
  return `${width}pt ${style} ${color(border.color)||'#000000'}`;
}

/**
 * Adapt an already reconstructed ONLYOFFICE ToJSON document to native editable
 * SharePoint content. No Office/PDF bytes are interpreted here. Embedded image
 * bytes stay unchanged at their natural aspect. Verified nonuniform viewports
 * use a derived PNG so SharePoint's natural-aspect image renderer preserves them.
 */
export async function adaptDocument({name,bytes,result},{measureImage=browserMeasure,signal}={}){
  const sourceBytes=bytesOf(bytes),doc=result?.officeDocument;
  if(!sourceBytes?.length||typeof name!=='string'||!doc||doc.type!=='document'||!Array.isArray(doc.content))fail('invalid-document','A source file and its reconstructed document model are required.');
  const originalHash=await sha256Hex(sourceBytes),sourceHash=await hashText(`file-to-sharepoint:source:v1:${originalHash}`),sourceName=filename(name),title=sourceName.replace(/\.[^.]{1,8}$/,'').trim().slice(0,255)||'Imported document';
  const warnings=(result.warnings??[]).map(w=>typeof w==='string'?{code:'engine-warning',message:clean(w),material:true}:{...w});
  const warned=new Set(warnings.map(w=>w.code));
  function warn(code,message,{blocking=false,material=true}={}){
    if(warned.has(code))return;
    warned.add(code);warnings.push({code,message,material,...(blocking?{blocking:true}:{})});
  }
  const model={title,sourceName,sourceHash,sourceFileHash:originalHash,sourceKind:'file',blocks:[],assets:[],headings:[],warnings,stats:{images:0,headings1:0,headings2:0,bullets:0,numbered:0,tables:0,editableTextCharacters:0}};
  const pictures=new Map(),media=result.media??{},assetPromises=new Map(),viewportPromises=new Map(),paddingPromises=new Map(),styles=new Map(Object.entries(doc.styles??{}));
  const sourceMediaBytes=Object.values(media).reduce((sum,value)=>sum+(bytesOf(value)?.length??0),0);
  let viewportBytes=0;const fallbackFonts=new Set();
  const svgNames=new Set([...(result.svgResourceNames??[]),...(result.svgImages??[]).map(image=>image.name)]);
  const pdfPages=result.pdfForms?.pages??[];
  const preview={version:1,readingOrder:'engine',pages:pdfPages.length?pdfPages.map((p,pageIndex)=>({pageIndex,width:p.W*96/(p.Dpi||72),height:p.H*96/(p.Dpi||72),unit:'px'})):[{pageIndex:0,width:(doc.sectPr?.pgSz?.w??12240)/15,height:(doc.sectPr?.pgSz?.h??15840)/15,unit:'px'}],drawings:[]};
  const documentParts=planDocumentParts(doc,warn);
  const fieldReceipt={count:0},bodyFields=createStaticFieldState(warn,fieldReceipt);
  if(documentParts.headers.length||documentParts.footers.length||documentParts.notes.length)preview.documentParts=[];
  if(result.nativeImages?.length){
    preview.nativeImages=structuredClone(result.nativeImages);
    warn('native-image-format-adapted','Some embedded images were converted for SharePoint.');
  }
  if(result.pdfDerivedImages?.length)preview.pdfDerivedImages=structuredClone(result.pdfDerivedImages);
  const pdfPageAssociation=/\.pdf$/i.test(name)?planPdfPageAssociation(doc,pdfPages):null;
  const pdfTextOrder=/\.pdf$/i.test(name)?planPdfReadingOrder(doc,{pages:pdfPages,pdfText:result.pdfText,pdfLayout:result.pdfLayout}):null;
  let verifiedAliases;
  const nativeDrawings=result.pdfLayout?.nativeDrawings;
  if(nativeDrawings?.pages?.some(page=>page.drawings?.some(drawing=>drawing.kind==='derived-vector'))){
    if(!Array.isArray(result.pdfDrawingAliases)||!Array.isArray(result.pdfDerivedImages))throw Object.assign(new Error('The PDF drawing sources could not be verified. No content was imported.'),{code:'PDF_DRAWINGS_UNVERIFIED'});
    const context=await preparePdfDrawingAliases(nativeDrawings,result.docxBytes,{signal});
    verifiedAliases=await verifyPdfDrawingAliases(context,doc,media,{signal,expectedAliases:result.pdfDrawingAliases,expectedResources:result.pdfDerivedImages});
  }else if(result.pdfDrawingAliases!==undefined&&(!Array.isArray(result.pdfDrawingAliases)||result.pdfDrawingAliases.length))throw Object.assign(new Error('The PDF drawing sources could not be verified. No content was imported.'),{code:'PDF_DRAWINGS_UNVERIFIED'});
  if(result.pdfDrawingAliases?.length)preview.pdfDrawingAliases=structuredClone(result.pdfDrawingAliases);
  const pdfOrder=pdfTextOrder?.ok&&nativeDrawings?composePdfDrawingFlow(doc,{pages:pdfPages,pdfText:result.pdfText,nativeTables:result.pdfLayout.nativeTables,pdfDrawings:nativeDrawings,textPlan:pdfTextOrder,verifiedAliases}):pdfTextOrder;
  const nativeReflow=/\.pdf$/i.test(name)&&!pdfOrder?.ok&&nativeDrawings?
    planPdfNativeReflow(doc,{pages:pdfPages,pdfText:result.pdfText,nativeTables:result.pdfLayout.nativeTables,pdfDrawings:nativeDrawings,verifiedAliases}):null;
  if(/\.pdf$/i.test(name)){
    preview.readingOrder='engine-serialization';preview.pageAssociation=pdfPageAssociation?'native-sections':'unverified';preview.blocks=[];
    if(!pdfPageAssociation)warn('pdf-page-association-unverified','The reconstructed sections do not verify the original PDF page associations. Sending is blocked for review.',{blocking:true});
    if(pdfOrder.ok){preview.readingOrder='verified-native-word-order';if(pdfOrder.drawingProof)preview.drawingFlow=pdfOrder.drawingProof;}
    else if(nativeReflow?.ok){
      preview.readingOrder='native-sharepoint-reflow';
      preview.layoutAdaptation={mode:'native-sharepoint',sourceOrderVerified:false,reason:pdfOrder.code??'unverified-source-order'};
      warn('pdf-native-layout-adapted','This PDF was adapted to standard SharePoint content. Graphics appear as separate images; overlapping layouts and text order may differ. Review the preview before sending.');
    }else if(pdfTextOrder.ok){
      const surface=pdfOrder.code==='PDF_DRAWING_SURFACE_REQUIRED';
      warn(surface?'pdf-drawing-surface-required':'pdf-drawing-flow-unverified',surface?'This PDF\'s overlapping graphics and text could not be preserved. Sending is blocked.':'The PDF drawing positions could not be verified against its editable text. Sending is blocked.',{blocking:true});
    }else warn('pdf-reading-order-unverified','The editable content could not be matched completely and unambiguously to the native PDF reading order. Sending is blocked.',{blocking:true});
  }
  function styleFor(id,seen=new Set()){
    if(!id)return {};
    if(seen.has(id)||!styles.has(String(id))){warn('missing-style','A source style could not be resolved; review the affected formatting.');return {};}
    seen.add(id);const style=styles.get(String(id));return merge(styleFor(style.basedOn,seen),style);
  }
  async function asset(bytesValue,path,declaredMime){
    const imageBytes=bytesOf(bytesValue);
    if(!imageBytes?.length||imageBytes.length>MAX_PICTURE_BYTES)fail('invalid-image','An embedded image is empty or exceeds the upload limit.');
    const mime=imageMime(imageBytes);
    if(declaredMime&&declaredMime!==mime)fail('invalid-image','An SDK decoration does not match its declared image type.');
    const id=await sha256Hex(imageBytes);
    if(!assetPromises.has(id))assetPromises.set(id,(async()=>{
      const blob=new Blob([imageBytes],{type:mime}),size=await measureImage(blob);
      if(!size||![size.width,size.height].every(v=>Number.isInteger(v)&&v>0&&v<=100000))fail('invalid-image','A reconstructed image has invalid natural dimensions.');
      const info={id,name:filename(path),mime,width:size.width,height:size.height,size:imageBytes.length};
      model.assets.push(info);pictures.set(id,blob);return info;
    })());
    return assetPromises.get(id);
  }
  function textStyle(pr){
    const css=[],c=color(pr.color),background=color(pr.highlight)??color(pr.shd?.fill??pr.shd?.color);
    if(typeof pr.b==='boolean')css.push(`font-weight:${pr.b?'700':'400'}`);
    if(c)css.push(`color:${c}`);
    if(background)css.push(`background-color:${background}`);
    if(typeof pr.highlight==='string'&&/^[a-z]{1,24}$/i.test(pr.highlight)&&pr.highlight!=='none')css.push(`background-color:${pr.highlight}`);
    if(Number.isFinite(pr.sz)&&pr.sz>0&&pr.sz<=800)css.push(`font-size:${pr.sz/2}pt`);
    // SDK rFonts retain the resolved run/style face. fontFamily can still be
    // the merged document default and must not mask that explicit selection.
    const font=[pr.rFonts?.ascii,pr.rFonts?.hAnsi,pr.fontFamily?.name].find(value=>typeof value==='string'&&/^[a-z0-9 ,"'-]{1,200}$/i.test(value));
    if(font){
      const key=font.trim().replace(/^(["'])(.*)\1$/,'$2').toLowerCase(),fallbacks=BASE14_BROWSER_FONTS.get(key);
      const nativeFamily=NATIVE_FONT_FAMILIES.get(fallbacks?.[0].toLowerCase()??key);
      css.push(`font-family:${nativeFamily??font}`);
      if(fallbacks&&!fallbackFonts.has(key)){
        fallbackFonts.add(key);(preview.fontFallbacks??=[]).push({sourceFamily:font,fallbacks:[...fallbacks]});
        warn('font-display-fallback','Some document fonts use compatible SharePoint fonts.');
      }
      if(!nativeFamily)warn('native-editor-font-review','SharePoint may replace a source font with the site font when the text is edited.');
    }
    if(pr.caps||pr.smallCaps||pr.spacing||pr.position)warn('typography-reflow','Character spacing, raised text or case effects may differ in the SharePoint editor.');
    return css;
  }
  function formatText(html,pr){
    if(!html)return '';
    if(pr.vanish)warn('hidden-content','Hidden source text is included in the editable preview; review its visibility.');
    if(pr.i)html=`<em>${html}</em>`;
    if(pr.u&&pr.u!=='none')html=`<u>${html}</u>`;
    if(pr.strike||pr.dstrike)html=`<s>${html}</s>`;
    if(pr.vertAlign==='superscript')html=`<sup>${html}</sup>`;
    if(pr.vertAlign==='subscript')html=`<sub>${html}</sub>`;
    // SharePoint gives strong and headings their own weights. Keep semantic
    // bold outside the explicitly styled run so its children retain the SDK's
    // resolved 700/400 rather than inheriting the tenant's 600 baseline.
    const css=textStyle(pr);if(css.length)html=`<span${attribute(css)}>${html}</span>`;
    return pr.b?`<strong>${html}</strong>`:html;
  }
  async function nodes(content,context){
    const list=Array.isArray(content)?content:content?[content]:[];
    return renderListContent(list,child=>render(child,context),warn,ordered=>model.stats[ordered?'numbered':'bullets']++);
  }
  async function picture(drawing,context,bytesValue,path,declaredMime,viewport){
    let info=await asset(bytesValue,path,declaredMime);const geometry={...drawingGeometry(drawing),...(viewport?{width:viewport.width,height:viewport.height}:{})};
    let displayWidth=Math.max(1,Math.min(100000,Math.round(geometry.width||info.width)));
    const index=context.pictures.length;
    const height=geometry.width>0&&geometry.height>0?geometry.height*displayWidth/geometry.width:null;
    // HTML image dimensions can round to integral pixels in the Word importer.
    // Native Office extents and frozen SVG viewports retain EMU precision.
    const rounding=viewport?1:result.sourceContainer==='mhtml'&&!svgNames.has(path.split('/').at(-1))?displayWidth/(geometry.width||1):(2+2*info.height/info.width)/9525*displayWidth/(geometry.width||1);
    if(height!==null&&Math.abs(height-displayWidth*info.height/info.width)>rounding){
      if(!Number.isFinite(height)||height<=0||height>100000)fail('image-dimensions','A reconstructed image has unsupported display dimensions.');
      const source=info,key=source.id+':'+displayWidth+':'+height;
      if(!viewportPromises.has(key)){
        if(Object.keys(media).length+viewportPromises.size+paddingPromises.size>=4096)fail('document-limit','The authored image viewports exceed the 4096-resource limit.');
        viewportPromises.set(key,(async()=>{
          const rendered=await renderImageViewport(pictures.get(source.id),{sourceWidth:source.width,sourceHeight:source.height,displayWidth,displayHeight:height});
          viewportBytes+=rendered.bytes.length;
          if(viewportBytes+sourceMediaBytes>150*1024*1024)fail('document-limit','The expanded document and authored image viewports exceed the 150 MiB limit.');
          const derived=await asset(rendered.bytes,`viewport-${source.id.slice(0,16)}-${rendered.width}x${rendered.height}.png`,rendered.mime);
          (preview.imageViewports??=[]).push({sourceAssetId:source.id,derivedAssetId:derived.id,sourceWidth:source.width,sourceHeight:source.height,sourceBytes:source.size,displayWidth,displayHeight:height,width:rendered.width,height:rendered.height,outputBytes:derived.size,density:rendered.density,requestedDensity:rendered.requestedDensity,densityLimited:rendered.densityLimited});
          warn('image-viewport-adapted','Image display proportions were preserved for SharePoint.');
          if(rendered.densityLimited)warn('image-viewport-resolution','Image resolution was limited to fit the browser rendering limits.');
          return derived;
        })());
      }
      info=await viewportPromises.get(key);
    }
    if(displayWidth<MIN_NATIVE_IMAGE_WIDTH){
      const source=info,key=source.id+':'+displayWidth;
      if(!paddingPromises.has(key)){
        if(Object.keys(media).length+viewportPromises.size+paddingPromises.size>=4096)fail('document-limit','The narrow images exceed the 4096-resource limit.');
        const sourceDisplayWidth=displayWidth;
        paddingPromises.set(key,(async()=>{
          const rendered=await renderImagePadding(pictures.get(source.id),{sourceWidth:source.width,sourceHeight:source.height,displayWidth:sourceDisplayWidth},{signal});
          viewportBytes+=rendered.bytes.length;
          if(viewportBytes+sourceMediaBytes>150*1024*1024)fail('document-limit','The expanded document and narrow images exceed the 150 MiB limit.');
          const derived=await asset(rendered.bytes,`padded-${source.id.slice(0,16)}-${rendered.width}x${rendered.height}.png`,rendered.mime);
          (preview.imagePadding??=[]).push({sourceAssetId:source.id,derivedAssetId:derived.id,sourceWidth:source.width,sourceHeight:source.height,sourceBytes:source.size,sourceDisplayWidth,displayWidth:rendered.displayWidth,width:rendered.width,height:rendered.height,paddingRight:rendered.paddingRight,outputBytes:derived.size});
          warn('image-minimum-width-adapted','Some narrow graphics include extra transparent space so SharePoint can display them.');
          return {info:derived,displayWidth:rendered.displayWidth};
        })());
      }
      const padded=await paddingPromises.get(key);info=padded.info;displayWidth=padded.displayWidth;
    }
    const share=Math.min(100,displayWidth/SHAREPOINT_COLUMN_WIDTH*100);
    context.pictures.push({assetId:info.id,alt:clean(drawing.docPr?.descr??drawing.docPr?.title??''),caption:'',displayWidth,share});
    model.stats.images++;
    return {html:`<div class="c2sPicture" data-picture="${index}"></div>`,assetId:info.id};
  }
  async function drawing(node,context){
    const g=node.graphic,geometry=drawingGeometry(node),entry={sourceId:String(g?.id??node.docPr?.id??preview.drawings.length),kind:g?.type==='image'?'image':g?.content?'textbox':'vector',geometry,blockId:context.id,shape:structuredClone(g?.spPr??{})};
    if(context.pageIndex!==undefined)entry.pageIndex=context.pageIndex;
    preview.drawings.push(entry);
    if(node.drawingType==='anchor')warn('positioned-content-reflow','Positioned source content remains editable and grouped, but SharePoint reflows it in document order. Original drawing positions are retained in preview metadata.');
    const xfrm=g?.spPr?.xfrm;
    if(nativeReflow&&xfrm&&(xfrm.rot!=null&&!Number.isFinite(xfrm.rot)||[xfrm.flipH,xfrm.flipV].some(value=>value!=null&&typeof value!=='boolean')))
      fail('drawing-transform-unverified','A source drawing has invalid transform metadata.');
    if(g?.type!=='image'&&(xfrm?.rot||xfrm?.flipH||xfrm?.flipV)){
      if(nativeReflow&&g?.content){
        // Normal text orientation is an explicit layout adaptation. Inherited
        // transforms on nested graphics must not be silently discarded.
        const stack=[g.content];let visited=0,nestedDrawing=false;
        while(stack.length){
          if(++visited>500000)fail('document-limit','The textbox exceeds the document limit.');
          const node=stack.pop();if(Array.isArray(node))stack.push(...node);
          else if(node&&typeof node==='object'){if(node.type==='paraDrawing'){nestedDrawing=true;break;}if(node.content!=null)stack.push(node.content);}
        }
        if(nestedDrawing)warn('drawing-transform-unverified','A transformed textbox contains graphics whose inherited transform could not be preserved.',{blocking:true});
        else warn('pdf-text-orientation-adapted','Rotated or mirrored text was converted to normal editable paragraphs because SharePoint does not support that text orientation.');
      }else warn('drawing-transform-review','A source drawing has rotation or reflection metadata; review its appearance in the responsive SharePoint layout.',{blocking:!!nativeReflow});
    }
    if(g?.type==='image'){
      const found=imageReference(g.blipFill?.rasterImageId,media),view=result.imageViews?.[String(g.id)];
      if(hasImageViewTransform(g)){
        if(view){
          if(view.source?.resourceName!==found.path||view.source.sourceBytes!==found.bytes.byteLength||view.source.sourceHash!==await sha256Hex(found.bytes))fail('invalid-image','The transformed image does not match its original source resource.');
          const p=await picture(node,context,view.bytes,`image-view-${String(g.id)}.png`,view.mime,view.viewport);
          entry.assetId=p.assetId;entry.imageView=true;
          (preview.imageViews??=[]).push({sourceId:entry.sourceId,sourceAssetId:view.source.sourceHash,derivedAssetId:p.assetId,viewport:structuredClone(view.viewport),affine:structuredClone(view.affine),density:view.density,requestedDensity:view.requestedDensity,densityLimited:view.densityLimited});
          warn('image-transform-adapted','Image crops, rotations and reflections were preserved for SharePoint.');
          if(view.densityLimited)warn('image-viewport-resolution','Image resolution was limited to fit the browser rendering limits.');
          return p.html;
        }
        warn('image-transform-unverified','An image crop, rotation or reflection could not be preserved. Sending is blocked.',{blocking:true});
      }else if(view)fail('invalid-image','An ordinary source image has an unexpected transformed view.');
      let svg=/\.svg$/i.test(found.path);
      if(!svg){try{svg=imageResourceMime(found.bytes)==='image/svg+xml';}catch{/* Preserve the ordinary asset signature guard for other formats. */}}
      if(svg){
        if(hasImageViewTransform(g))fail('svg-image-transform','An SVG image crop, rotation or reflection could not be preserved.');
        const svgAbort=()=>{if(signal?.aborted)throw new DOMException('Conversion cancelled.','AbortError');};svgAbort();
        const sourceHash=await sha256Hex(found.bytes),viewport=geometry.width>0&&geometry.height>0?{width:geometry.width,height:geometry.height}:null,key=sourceHash+':'+geometry.width+':'+geometry.height;
        svgAbort();
        const cache=drawing.svgImages??=new Map();
        if(!cache.has(key))cache.set(key,(async()=>{
          if(cache.size+Object.keys(media).length>=4096)fail('document-limit','The SVG pictures exceed the 4096-resource limit.');
          const rendered=await renderStaticSvg(found.bytes,geometry.width,{signal,...(viewport?{displayHeight:viewport.height}:{})});svgAbort();viewportBytes+=rendered.bytes.length;
          if(viewportBytes+sourceMediaBytes>150*1024*1024)fail('document-limit','The expanded document and SVG pictures exceed the 150 MiB limit.');
          return rendered;
        })());
        const rendered=await cache.get(key);svgAbort();const p=await picture(node,context,rendered.bytes,`svg-${sourceHash.slice(0,16)}.png`,'image/png',viewport);svgAbort();
        entry.assetId=p.assetId;entry.svgImage=true;
        (preview.svgImages??=[]).push({sourceId:entry.sourceId,resourceName:found.path,sourceHash,sourceBytes:found.bytes.length,derivedHash:p.assetId,width:rendered.width,height:rendered.height,outputBytes:rendered.bytes.length,...(rendered.density!==undefined?{density:rendered.density,requestedDensity:rendered.requestedDensity,densityLimited:rendered.densityLimited}:{})});
        warn('svg-image-adapted','SVG pictures were preserved as PNG images for SharePoint.');
        if(rendered.densityLimited)warn('image-viewport-resolution','Image resolution was limited to fit the browser rendering limits.');return p.html;
      }
      const p=await picture(node,context,found.bytes,found.path);entry.assetId=p.assetId;return p.html;
    }
    if(g?.content){
      const fields=createStaticFieldState(warn,fieldReceipt);
      const content=await nodes(g.content.content??g.content,{...context,fields,runPr:merge(context.runPr,g.rPr)}),css=textboxStyles(g,color,warn);fields.finish();
      if(nativeReflow&&css.length===1&&css[0]==='border:0pt solid #000000')return content;
      return tableWrap(`<table style="border-collapse:collapse;width:100%"><tbody><tr><td${attribute(css)}>${content||'<p><br></p>'}</td></tr></tbody></table>`);
    }
    const decoration=result.decorations?.[String(g?.id)];
    if(decoration){
      if(g?.type!=='shape')fail('unsupported-content','Only nontext shapes may use the engine decoration renderer.');
      const p=await picture(node,context,decoration.bytes,`decoration-${entry.sourceId}.${decoration.mime==='image/jpeg'?'jpg':'png'}`,decoration.mime);
      entry.assetId=p.assetId;entry.decoration=true;return p.html;
    }
    warn('vector-adaptation-required','A reconstructed nontext shape has no local SDK-rendered decoration. Its original geometry is retained for review, and sending is blocked.',{blocking:true});
    return '';
  }
  const sourceAnchorIds=new Set();
  async function paragraph(node,context){
    let sourceAnchor;
    if(node.ftsSourceAnchors!==undefined){
      const values=node.ftsSourceAnchors;
      if(!Array.isArray(values)||values.length!==1||!/^file-source-anchor-[1-9][0-9]{0,4}$/.test(values[0])||sourceAnchorIds.has(values[0]))
        warn('source-anchor-unverified','A source link target is malformed or duplicated. Sending is blocked.',{blocking:true});
      else{sourceAnchor=values[0];sourceAnchorIds.add(sourceAnchor);}
    }
    const sourceStyle=styleFor(node.pPr?.pStyle),pPr=merge(doc.paraPr,context.paraPr,sourceStyle.pPr,node.pPr),rPr=merge(context.runPr,sourceStyle.rPr,node.rPr);
    let level=Number.isInteger(pPr.outlineLvl)&&pPr.outlineLvl>=0&&pPr.outlineLvl<=5?pPr.outlineLvl+1:Number(/^Heading ([1-6])$/i.exec(sourceStyle.name??'')?.[1]??0);
    const css=[],headingState={nonbold:false};
    const alignment={start:'left',end:'right',both:'justify',left:'left',right:'right',center:'center',justify:'justify'}[pPr.jc];if(alignment)css.push(`text-align:${alignment}`);
    const chunks=[],noteContext={...context,noteMarkers:[]};let inline='';
    const flush=()=>{if(inline){chunks.push({inline:true,html:inline});inline='';}};
    // Drawings can become block-level native picture/table parts. Keep them
    // outside paragraphs rather than depending on browser HTML repair.
    for(const child of node.content??[]){
      const rendered=await render(child,{...noteContext,runPr:rPr,headingState});
      if(/<(?:div|table|p|h[1-6])\b/.test(rendered)){flush();chunks.push({inline:false,html:rendered});}else inline+=rendered;
    }
    inline+=flushNoteMarkers(noteContext);flush();
    // The native editor removes nonbold overrides from headings. Preserve that
    // source appearance as a formatted paragraph, retaining its source identity
    // and heading level in the model. All-bold headings keep their native tag.
    const adapted=!!level&&headingState.nonbold,tag=level&&!adapted?`h${level}`:'p';
    if(level&&!adapted)css.unshift('font-weight:normal');
    let out=chunks.map(chunk=>chunk.inline?`<${tag}${attribute(css)}>${chunk.html}</${tag}>`:chunk.html).join('');
    if(level&&out){const text=out.replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|#39);/g,s=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"})[s]),id=sourceAnchor??`file-heading-${model.headings.length+1}`;out=out.replace(new RegExp(`<${tag}\\b`),`<${tag} id="${id}"`);model.headings.push({id,level,text});if(level===1)model.stats.headings1++;if(level===2)model.stats.headings2++;if(adapted){(preview.headingAdaptations??=[]).push({sourceId:id,level,blockId:context.id,renderedAs:'paragraph',reason:'nonbold-text'});warn('heading-format-adapted','Some headings were preserved as formatted paragraphs to keep their text appearance.');}}
    else if(sourceAnchor){if(out.includes('<p'))out=out.replace(/<p\b/,`<p id="${sourceAnchor}"`);else warn('source-anchor-unverified','A source link target has no editable paragraph. Sending is blocked.',{blocking:true});}
    if(pPr.numPr&&!node.ftsNumbering&&!cancelsNumbering(pPr.numPr))warn('list-numbering-unverified','The Word engine did not verify this paragraph’s list numbering. Sending is blocked.',{blocking:true});
    return out||'<p><br></p>';
  }
  async function table(node,context){
    const inherited=styleFor(node.tblPr?.tblStyle),conditional=inherited.tblStylePr??{},whole=conditional.wholeTable??{},pr=merge(inherited.tblPr,whole.tblPr,node.tblPr),borders=pr.tblBorders??{},rows=node.content??[],look=pr.tblLook??{},grid=planWordTable(node);
    const tableCss=['border-collapse:collapse','width:100%'];
    const geometry=planTableGeometry(node,pdfOrder?.ok?pdfOrder.tableMetadata.get(node)?.nativeTable:undefined);
    if(geometry)tableCss.push('table-layout:fixed');
    const columns=geometry?`<colgroup>${geometry.columnPercentages.map(width=>`<col style="width:${width}%"/>`).join('')}</colgroup>`:'';
    function geometryCss(item,row){
      if(!geometry)return [];
      const start=item.startCol??(item===row.emitted[0]?0:row.endCol),css=[];
      const width=geometry.columnPercentages.slice(start,start+item.colSpan).reduce((sum,value)=>sum+Math.round(value*10000),0)/10000;
      css.push(`width:${width}%`);
      const minimum=geometry.rowMinimumPt?.slice(item.rowIndex??row.rowIndex,(item.rowIndex??row.rowIndex)+(item.rowSpan??1)).reduce((sum,value)=>sum+(value??0),0);
      if(minimum>0){
        const height=Math.round(minimum*10000)/10000;
        if(!Number.isFinite(minimum)||minimum>4096||height<=0)warn('table-cell-height-adapted','Some source row heights use automatic SharePoint sizing so all editable cell content can expand to fit.');
        else css.push(`height:${height}pt`);
      }
      return css;
    }
    function cellData(item){
        const {cell,rowIndex,startCol,colSpan}=item;
        const applied=[whole];
        if(!look.noHBand)applied.push(conditional[rowIndex%2?'band2Horz':'band1Horz']);
        if(!look.noVBand)applied.push(conditional[startCol%2?'band2Vert':'band1Vert']);
        if(look.firstColumn&&startCol===0)applied.push(conditional.firstCol);
        if(look.lastColumn&&startCol+colSpan===grid.columns)applied.push(conditional.lastCol);
        if(look.firstRow&&rowIndex===0)applied.push(conditional.firstRow);
        if(look.lastRow&&rowIndex===rows.length-1)applied.push(conditional.lastRow);
        const cellStyle=merge(...applied),cp=merge(inherited.tcPr,cellStyle.tcPr,cell.tcPr),edge={};
        for(const side of ['top','right','bottom','left']){
          const key={right:'end',left:'start'}[side]??side,own=cp.tcBorders?.[key]??cp.tcBorders?.[side],outer=(side==='top'&&rowIndex===0)||(side==='bottom'&&rowIndex===rows.length-1)||(side==='left'&&startCol===0)||(side==='right'&&startCol+colSpan===grid.columns),fallback=outer?(borders[key]??borders[side]):borders[['top','bottom'].includes(side)?'insideH':'insideV'];
          edge[side]=borderStyle(own??fallback,warn);
        }
        return {cp,cellStyle,edge,context:{...context,runPr:merge(context.runPr,inherited.rPr,cellStyle.rPr),paraPr:merge(context.paraPr,inherited.pPr,cellStyle.pPr)}};
    }
    let html='';
    for(const row of grid.rows){
      let cells='';
      for(const item of row.emitted){
        if(item.gap){cells+=`<td${item.colSpan>1?` colspan="${item.colSpan}"`:''}${attribute([...geometryCss(item,row),'vertical-align:top'])}><p><br></p></td>`;continue;}
        const data=cellData(item),{cp}=data,css=geometryCss(item,row),chain=[item,...item.continuations],tail=cellData(chain.at(-1));
        for(const continuation of item.continuations){
          const next=cellData(continuation);
          if(['left','right'].some(side=>next.edge[side]!==data.edge[side]))warn('merged-cell-border-adapted','Some vertically merged cells use one representative native border per side. All merged cell content is preserved.');
        }
        for(const side of ['top','right','bottom','left']){
          const border=['left','right'].includes(side)?chain.map(part=>cellData(part).edge[side]).find(value=>value&&!value.startsWith('0pt '))??data.edge[side]:(side==='bottom'?tail:data).edge[side];
          if(border)css.push(`border-${side}:${border}`);
        }
        const background=color(cp.shd?.fill??cp.shd?.color);if(background)css.push(`background-color:${background}`);
        // The SDK omits numeric TOP=0 from raw tcPr JSON. Its resolved cell
        // alignment preserves explicit top over an inherited center style.
        // CTableCellPr.Init_Default is top; HTML cells otherwise use middle.
        const vertical=item.cell.ftsVerticalAlign??cp.vAlign??'top';
        if(['top','center','bottom'].includes(vertical))css.push(`vertical-align:${vertical==='center'?'middle':vertical}`);
        let content='';
        for(const part of chain){if(part!==item&&!hasCellContent(part.cell.content))continue;content+=await nodes(part.cell.content?.content??part.cell.content,cellData(part).context);}
        const tag=rows[item.rowIndex].trPr?.tblHeader?'th':'td';
        cells+=`<${tag}${item.colSpan>1?` colspan="${item.colSpan}"`:''}${item.rowSpan>1?` rowspan="${item.rowSpan}"`:''}${attribute(css)}>${content||'<p><br></p>'}</${tag}>`;
      }
      html+=`<tr>${cells}</tr>`;
    }
    model.stats.tables++;return nativeTableWrap(`<table${attribute(tableCss)}>${columns}<tbody>${html}</tbody></table>`);
  }
  async function render(node,context){
    if(typeof node==='string'){
      if(context.fields&&!context.fields.visible())return '';
      if(clean(node)!==node)warn('source-control-characters','Unsupported control characters were removed from the editable text.');
      // Only strings actually rendered from document content count. Image
      // descriptions, captions, form labels/values and shape geometry never
      // pass through this path and cannot disguise an image-only PDF as text.
      const visible=clean(node).replace(/[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu,'');
      model.stats.editableTextCharacters+=visible.length;
      if(visible.length&&context.headingState&&context.runPr?.b!==true)context.headingState.nonbold=true;
      let text=clean(node),out='';
      while(text&&context.noteMarkers?.length){
        const leading=/^\s*/u.exec(text)[0];out+=escape(leading);text=text.slice(leading.length);if(!text)break;
        const reference=context.noteMarkers.shift(),custom=reference.customMark;
        const mark=typeof custom==='string'&&text.startsWith(custom)?custom:new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)[Symbol.iterator]().next().value.segment;
        out+=`<a id="${reference.id}" href="#${reference.note.id}">${escape(mark)}</a>`;text=text.slice(mark.length);
      }
      return (out+escape(text)).replace(/\r\n?|\n/g,'<br>');
    }
    if(!node||typeof node!=='object')return '';
    if(context.fields?.control(node))return '';
    switch(node.type){
      case 'paragraph':return paragraph(node,context);
      case 'run':case 'endRun':{
        const rPr=merge(context.runPr,styleFor(node.rPr?.rStyle).rPr,node.rPr);
        const segments=[];let inline='',hasBlock=false;
        const flush=()=>{if(inline){segments.push({html:formatText(inline,rPr),inline:true});inline='';}};
        for(const child of node.content??[]){
          const html=await render(child,{...context,runPr:rPr});
          if(/<(?:div|table|p|h[1-6])\b/.test(html)){flush();hasBlock=true;segments.push({html,inline:false});}else inline+=html;
        }
        flush();return segments.map(part=>hasBlock&&part.inline?`<p>${part.html}</p>`:part.html).join('');
      }
      case 'table':return table(node,{...context,headingState:null});
      case 'paraDrawing':return context.fields&&!context.fields.visible()?'':drawing(node,{...context,headingState:null});
      case 'docContent':return nodes(node.content,context);
      case 'footnoteRef':case 'endnoteRef':case 'footnoteNum':case 'endnoteNum':{
        if(context.fields&&!context.fields.visible())return '';
        const reference=documentParts.reference(node,context.note);
        if(!reference)return '';
        if(reference.customFollows){if(!reference.numberOnly)context.noteMarkers.push(reference);return '';}
        return reference.numberOnly?`<sup>${escape(reference.label)}</sup>`:`<sup id="${reference.id}"><a href="#${reference.note.id}">${escape(reference.label)}</a></sup>`;
      }
      case 'blockLvlSdt':
        if(node.sdtContent?.type!=='docContent'||!Array.isArray(node.sdtContent.content)){warn('unsupported-content','A source content control has no verified editable content.',{blocking:true});return '';}
        warn('content-wrapper-adapted','Word content controls were converted to ordinary editable SharePoint content. Their document-only control behavior is not retained.');
        return nodes(node.sdtContent.content,context);
      case 'inlineLvlSdt':
        if(!Array.isArray(node.content)){warn('unsupported-content','A source content control has no verified editable content.',{blocking:true});return '';}
        warn('content-wrapper-adapted','Word content controls were converted to ordinary editable SharePoint content. Their document-only control behavior is not retained.');
        return nodes(node.content,context);
      case 'tab':return context.fields&&!context.fields.visible()?'':'&#9;';
      case 'br':case 'break':return context.fields&&!context.fields.visible()?'':'<br>';
      case 'hyperlink':{
        const html=await nodes(node.content,context),href=node.value??node.url??node.href;
        try{const probe={type:'text',html:`<p><a href="${escape(href)}">link</a></p>`};checkCanvasBlock(probe);return `<a href="${escape(href)}">${html}</a>`;}
        catch{warn('unsupported-link','A source hyperlink has an unsupported address; its editable text is preserved.');return html;}
      }
      default:warn('unsupported-content',`Reconstructed content of type ${clean(node.type??'unknown').slice(0,80)} needs adaptation before sending.`,{blocking:true});return nodes(node.content,context);
    }
  }
  function flushNoteMarkers(context){
    if(!context.noteMarkers.length)return '';
    warn('note-marker-adapted','A custom note mark has no following editable text. Its linked reference number is placed at the end of the paragraph; original content is retained.');
    return context.noteMarkers.splice(0).map(reference=>`<sup id="${reference.id}"><a href="#${reference.note.id}">${reference.label}</a></sup>`).join('');
  }
  const renderOrder=pdfOrder?.ok?pdfOrder:nativeReflow;
  const groups=renderOrder?.ok?renderOrder.pages.flatMap(page=>contentGroups(page.nodes).map(nodes=>({nodes,pageIndex:page.pageIndex}))):contentGroups(doc.content).map(nodes=>({nodes,...(pdfPageAssociation?{pageIndex:pdfPageAssociation.get(nodes[0])}:{})}));
  async function appendGroup(group,pageIndex,note,fields=bodyFields){
    const context={id:`file-block-${model.blocks.length+1}`,pictures:[],noteMarkers:[],fields,runPr:doc.textPr??{},...(note?{note}:{}),...(pageIndex!==undefined?{pageIndex}:{})};
    const html=await nodes(group,context)+flushNoteMarkers(context);
    if(!html.trim())return;
    if(html.length>MAX_TEXT_HTML)fail('document-limit','A reconstructed document part exceeds the supported SharePoint text limit.');
    const block={id:context.id,type:'text',html,...(context.pictures.length?{pictures:context.pictures}:{})};
    checkCanvasBlock(block);model.blocks.push(block);
    if(preview.blocks){
      const spans=pdfOrder?.ok?group.map(node=>pdfOrder.nodeMetadata.get(node)).filter(meta=>meta?.start!==undefined):[];
      preview.blocks.push({blockId:block.id,...(context.pageIndex!==undefined?{pageIndex:context.pageIndex}:{}),...(spans.length?{sourceInterval:{start:Math.min(...spans.map(span=>span.start)),end:Math.max(...spans.map(span=>span.end))}}:{})});
    }
  }
  async function appendPart(part){
    const fields=createStaticFieldState(warn,fieldReceipt);
    const start=model.blocks.length,label=part.kind==='header'?'Header':part.kind==='footer'?'Footer':part.kind==='footnote'?`Footnote ${part.ordinal}`:`Endnote ${part.ordinal}`;
    const id=part.id??`file-${part.kind}-${preview.documentParts.filter(value=>value.kind===part.kind).length+1}`;
    model.blocks.push({id:`file-block-${model.blocks.length+1}`,type:'text',html:`<p id="${id}"><strong>${escape(label)}</strong></p>`});
    for(const group of contentGroups(part.content))await appendGroup(group,undefined,part.kind==='footnote'||part.kind==='endnote'?part:undefined,fields);
    fields.finish();
    if(part.references?.length){
      const html=`<p>${part.references.map((reference,index)=>`<a href="#${reference.id}">Back to reference${part.references.length>1?' '+(index+1):''}</a>`).join(' · ')}</p>`;
      model.blocks.push({id:`file-block-${model.blocks.length+1}`,type:'text',html});
    }
    preview.documentParts.push({kind:part.kind,sourceId:part.sourceId,id,...(part.variants?{variants:part.variants,sections:part.sections}:{}),blockIds:model.blocks.slice(start).map(block=>block.id)});
  }
  for(const part of documentParts.headers)await appendPart(part);
  for(const {nodes:group,pageIndex} of groups)await appendGroup(group,pageIndex);
  bodyFields.finish();
  for(const part of documentParts.notes)await appendPart(part);
  for(const part of documentParts.footers)await appendPart(part);
  if(fieldReceipt.count)preview.staticFields=fieldReceipt;
  const formDefinition=await adaptForms(result.pdfForms,{sourceHash,title});
  const formOnly=/\.pdf$/i.test(name)&&!!formDefinition&&verifiedEmptyPdfBody(result.pdfText);
  if(!model.blocks.length&&formOnly)model.blocks.push({id:'file-block-1',type:'text',html:'<p><br></p>'});
  if(!model.blocks.length)fail('empty-document','The reconstructed document has no supported editable content.');
  if(model.blocks.length>MAX_BLOCKS||JSON.stringify(model.blocks).length>8000000)fail('document-limit','The document exceeds the supported SharePoint page size.');
  if(/\.pdf$/i.test(name)){
    if(result.pdfText){
      const template=globalThis.document.createElement('template');template.innerHTML=model.blocks.map(block=>block.html).join('');
      const coverage=assessPdfRenderedText(result.pdfText,template.content.textContent??'');preview.textCoverage=coverage;
      if(coverage.missingCharacters||coverage.extraCharacters)warn('pdf-text-loss','The converted page does not retain all verified PDF source text. Sending is blocked.',{blocking:true});
    }
    if(!model.stats.editableTextCharacters&&!formOnly)warn('pdf-ocr-unavailable','This PDF contains no reconstructed editable text. Its images remain available for review, but OCR is not included, so sending is blocked.',{blocking:true});
    else if(preview.drawings.some(drawing=>drawing.kind==='image'))warn('pdf-image-text-review','This PDF contains images alongside editable text. Some pages or words may remain inside images; OCR is not included. Review every page for missing editable text before sending.');
  }
  if(nativeReflow)verifyPdfNativeReflowDrawings(nativeReflow,preview.drawings);
  const usedAssets=new Set(model.blocks.flatMap(block=>block.type==='image'?[block.assetId]:(block.pictures??[]).map(picture=>picture.assetId)));
  model.assets=model.assets.filter(asset=>usedAssets.has(asset.id));for(const id of pictures.keys())if(!usedAssets.has(id))pictures.delete(id);
  return {model,pictures,formDefinition,preview};
}
