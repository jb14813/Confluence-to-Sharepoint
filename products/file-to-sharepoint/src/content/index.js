import {checkCanvasBlock} from '../../../../src/sharepoint/canvas.js';
import {MAX_BLOCKS,MAX_PICTURE_BYTES,MAX_TEXT_HTML,SHAREPOINT_COLUMN_WIDTH,sha256Hex} from '../../../../src/transfer/limits.js';
import {adaptForms} from './forms.js';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const clean=value=>String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,'');
const filename=name=>clean(name).split(/[\\/]/).at(-1).replace(/[<>:"|?*]/g,'_').replace(/[. ]+$/,'').slice(0,200)||'Imported document';
const hashText=value=>sha256Hex(new TextEncoder().encode(value));
const bytesOf=value=>value instanceof Uint8Array?value:value instanceof ArrayBuffer?new Uint8Array(value):null;
const attribute=styles=>styles.length?` style="${escape(styles.join(';'))}"`:'';
const tableWrap=html=>`<div class="canvasRteResponsiveTable"><div class="tableCenterAlign tableWrapper">${html}</div></div>`;
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
function borderStyle(border){
  if(!border||['none','nil'].includes(border.value))return null;
  const style={single:'solid',double:'double',dashed:'dashed',dotted:'dotted'}[border.value];
  if(!style)return null;
  const width=Number.isFinite(border.sz)?Math.min(12,Math.max(0,border.sz/8)):0.5;
  return `${width}pt ${style} ${color(border.color)||'#000000'}`;
}

/**
 * Adapt an already reconstructed ONLYOFFICE ToJSON document to native editable
 * SharePoint content. No Office/PDF bytes are interpreted here. Embedded image
 * bytes stay unchanged; only SDK-rendered nontext decorations may be raster.
 */
export async function adaptDocument({name,bytes,result},{measureImage=browserMeasure}={}){
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
  const pictures=new Map(),media=result.media??{},assetPromises=new Map(),styles=new Map(Object.entries(doc.styles??{}));
  const pdfPages=result.pdfForms?.pages??[];
  const preview={version:1,readingOrder:'engine',pages:pdfPages.length?pdfPages.map((p,pageIndex)=>({pageIndex,width:p.W*96/(p.Dpi||72),height:p.H*96/(p.Dpi||72),unit:'px'})):[{pageIndex:0,width:(doc.sectPr?.pgSz?.w??12240)/15,height:(doc.sectPr?.pgSz?.h??15840)/15,unit:'px'}],drawings:[]};
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
    const css=[],c=color(pr.color),background=color(pr.shd?.fill??pr.shd?.color);
    if(c)css.push(`color:${c}`);
    if(background)css.push(`background-color:${background}`);
    if(typeof pr.highlight==='string'&&/^[a-z]{1,24}$/i.test(pr.highlight)&&pr.highlight!=='none')css.push(`background-color:${pr.highlight}`);
    if(Number.isFinite(pr.sz)&&pr.sz>0&&pr.sz<=800)css.push(`font-size:${pr.sz/2}pt`);
    const font=pr.fontFamily?.name??pr.rFonts?.ascii??pr.rFonts?.hAnsi;
    if(typeof font==='string'&&/^[a-z0-9 ,"'-]{1,200}$/i.test(font))css.push(`font-family:${font}`);
    if(pr.caps||pr.smallCaps||pr.spacing||pr.position)warn('typography-reflow','Character spacing, raised text or case effects may differ in the SharePoint editor.');
    return css;
  }
  function formatText(html,pr){
    if(!html)return '';
    if(pr.vanish)warn('hidden-content','Hidden source text is included in the editable preview; review its visibility.');
    if(pr.b)html=`<strong>${html}</strong>`;
    if(pr.i)html=`<em>${html}</em>`;
    if(pr.u&&pr.u!=='none')html=`<u>${html}</u>`;
    if(pr.strike||pr.dstrike)html=`<s>${html}</s>`;
    if(pr.vertAlign==='superscript')html=`<sup>${html}</sup>`;
    if(pr.vertAlign==='subscript')html=`<sub>${html}</sub>`;
    const css=textStyle(pr);return css.length?`<span${attribute(css)}>${html}</span>`:html;
  }
  async function nodes(content,context){
    const list=Array.isArray(content)?content:content?[content]:[];
    let html='';for(const child of list)html+=await render(child,context);return html;
  }
  async function picture(drawing,context,bytesValue,path,declaredMime){
    const info=await asset(bytesValue,path,declaredMime),geometry=drawingGeometry(drawing);
    const displayWidth=Math.max(1,Math.min(100000,Math.round(geometry.width||info.width))),share=Math.min(100,displayWidth/SHAREPOINT_COLUMN_WIDTH*100);
    const index=context.pictures.length;
    context.pictures.push({assetId:info.id,alt:clean(drawing.docPr?.descr??drawing.docPr?.title??''),caption:'',displayWidth,share});
    model.stats.images++;
    return {html:`<div class="c2sPicture" data-picture="${index}"></div>`,assetId:info.id};
  }
  async function drawing(node,context){
    const g=node.graphic,geometry=drawingGeometry(node),entry={sourceId:String(g?.id??node.docPr?.id??preview.drawings.length),kind:g?.type==='image'?'image':g?.content?'textbox':'vector',geometry,blockId:context.id,shape:structuredClone(g?.spPr??{})};
    preview.drawings.push(entry);
    if(node.drawingType==='anchor')warn('positioned-content-reflow','Positioned source content remains editable and grouped, but SharePoint reflows it in document order. Original drawing positions are retained in preview metadata.');
    const xfrm=g?.spPr?.xfrm;
    if(xfrm?.rot||xfrm?.flipH||xfrm?.flipV||g?.blipFill?.srcRect)warn('drawing-transform-review','A source drawing has crop, rotation or reflection metadata; review its appearance in the responsive SharePoint layout.');
    if(g?.type==='image'){
      const found=imageReference(g.blipFill?.rasterImageId,media),p=await picture(node,context,found.bytes,found.path);entry.assetId=p.assetId;return p.html;
    }
    if(g?.content){
      const content=await nodes(g.content.content??g.content,{...context,runPr:merge(context.runPr,g.rPr)}),css=['border:0.5pt solid #777777'];
      const fill=color(g.spPr?.fill?.fill?.color);if(fill)css.push(`background-color:${fill}`);
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
  async function paragraph(node,context){
    const sourceStyle=styleFor(node.pPr?.pStyle),pPr=merge(doc.paraPr,context.paraPr,sourceStyle.pPr,node.pPr),rPr=merge(context.runPr,sourceStyle.rPr,node.rPr);
    let level=Number.isInteger(pPr.outlineLvl)&&pPr.outlineLvl>=0&&pPr.outlineLvl<=5?pPr.outlineLvl+1:Number(/^Heading ([1-6])$/i.exec(sourceStyle.name??'')?.[1]??0);
    const tag=level?`h${level}`:'p',css=[];
    const alignment={start:'left',end:'right',both:'justify',left:'left',right:'right',center:'center',justify:'justify'}[pPr.jc];if(alignment)css.push(`text-align:${alignment}`);
    let inline='',out='';
    const flush=()=>{if(inline){out+=`<${tag}${attribute(css)}>${inline}</${tag}>`;inline='';}};
    // Drawings can become block-level native picture/table parts. Keep them
    // outside paragraphs rather than depending on browser HTML repair.
    for(const child of node.content??[]){
      const rendered=await render(child,{...context,runPr:rPr});
      if(/<(?:div|table|p|h[1-6])\b/.test(rendered)){flush();out+=rendered;}else inline+=rendered;
    }
    flush();
    if(level&&out){const text=out.replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|#39);/g,s=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"})[s]),id=`file-heading-${model.headings.length+1}`;out=out.replace(new RegExp(`<${tag}\\b`),`<${tag} id="${id}"`);model.headings.push({id,level,text});if(level===1)model.stats.headings1++;if(level===2)model.stats.headings2++;}
    if(pPr.numPr){warn('list-numbering-review','Source list numbering is retained as editable paragraphs; automatic list numbering needs adaptation before sending.',{blocking:true});}
    return out||'<p><br></p>';
  }
  async function table(node,context){
    const inherited=styleFor(node.tblPr?.tblStyle),conditional=inherited.tblStylePr??{},whole=conditional.wholeTable??{},pr=merge(inherited.tblPr,whole.tblPr,node.tblPr),borders=pr.tblBorders??{},rows=node.content??[],look=pr.tblLook??{};
    const tableCss=['border-collapse:collapse','width:100%'];
    for(const [side,source] of [['top','top'],['right','end'],['bottom','bottom'],['left','start']]){const border=borderStyle(borders[source]??borders[side]);if(border)tableCss.push(`border-${side}:${border}`);}
    let html='';
    for(let rowIndex=0;rowIndex<rows.length;rowIndex++){
      const row=rows[rowIndex];if(row.type!=='tblRow'){warn('unsupported-content','A reconstructed table row requires adaptation before sending.',{blocking:true});continue;}
      let cells='';
      for(let cellIndex=0;cellIndex<(row.content??[]).length;cellIndex++){
        const cell=row.content[cellIndex];if(cell.type!=='tblCell'){warn('unsupported-content','A reconstructed table cell requires adaptation before sending.',{blocking:true});continue;}
        const applied=[whole];
        if(!look.noHBand)applied.push(conditional[rowIndex%2?'band2Horz':'band1Horz']);
        if(!look.noVBand)applied.push(conditional[cellIndex%2?'band2Vert':'band1Vert']);
        if(look.firstColumn&&cellIndex===0)applied.push(conditional.firstCol);
        if(look.lastColumn&&cellIndex===row.content.length-1)applied.push(conditional.lastCol);
        if(look.firstRow&&rowIndex===0)applied.push(conditional.firstRow);
        if(look.lastRow&&rowIndex===rows.length-1)applied.push(conditional.lastRow);
        const cellStyle=merge(...applied),cp=merge(inherited.tcPr,cellStyle.tcPr,cell.tcPr),css=[],span=cp.gridSpan;
        if(cp.vMerge)warn('vertical-cell-merge','Vertical table merges require review; all cell text remains in the editable table.',{blocking:true});
        if(span!==undefined&&(!Number.isInteger(span)||span<1||span>9999))fail('unsupported-content','A table cell span exceeds the supported limits.');
        for(const side of ['top','right','bottom','left']){
          const key={right:'end',left:'start'}[side]??side,own=cp.tcBorders?.[key]??cp.tcBorders?.[side],outer=(side==='top'&&rowIndex===0)||(side==='bottom'&&rowIndex===rows.length-1)||(side==='left'&&cellIndex===0)||(side==='right'&&cellIndex===row.content.length-1),fallback=outer?(borders[key]??borders[side]):borders[['top','bottom'].includes(side)?'insideH':'insideV'];
          const border=borderStyle(own??fallback);if(border)css.push(`border-${side}:${border}`);
        }
        const background=color(cp.shd?.fill??cp.shd?.color);if(background)css.push(`background-color:${background}`);
        if(['top','center','bottom'].includes(cp.vAlign))css.push(`vertical-align:${cp.vAlign==='center'?'middle':cp.vAlign}`);
        const tag=row.trPr?.tblHeader?'th':'td';
        cells+=`<${tag}${span?` colspan="${span}"`:''}${attribute(css)}>${await nodes(cell.content?.content??cell.content,{...context,runPr:merge(context.runPr,inherited.rPr,cellStyle.rPr),paraPr:merge(context.paraPr,inherited.pPr,cellStyle.pPr)})||'<p><br></p>'}</${tag}>`;
      }
      html+=`<tr>${cells}</tr>`;
    }
    model.stats.tables++;return tableWrap(`<table${attribute(tableCss)}><tbody>${html}</tbody></table>`);
  }
  async function render(node,context){
    if(typeof node==='string'){
      if(clean(node)!==node)warn('source-control-characters','Unsupported control characters were removed from the editable text.');
      // Only strings actually rendered from document content count. Image
      // descriptions, captions, form labels/values and shape geometry never
      // pass through this path and cannot disguise an image-only PDF as text.
      model.stats.editableTextCharacters+=clean(node).replace(/[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu,'').length;
      return escape(clean(node)).replace(/\r\n?|\n/g,'<br>');
    }
    if(!node||typeof node!=='object')return '';
    switch(node.type){
      case 'paragraph':return paragraph(node,context);
      case 'run':case 'endRun':{
        if(node.footnotes?.length||node.endnotes?.length)warn('notes-adaptation-required','Source footnotes or endnotes require adaptation before sending.',{blocking:true});
        const rPr=merge(context.runPr,styleFor(node.rPr?.rStyle).rPr,node.rPr);
        const segments=[];let inline='',hasBlock=false;
        const flush=()=>{if(inline){segments.push({html:formatText(inline,rPr),inline:true});inline='';}};
        for(const child of node.content??[]){
          const html=await render(child,{...context,runPr:rPr});
          if(/<(?:div|table|p|h[1-6])\b/.test(html)){flush();hasBlock=true;segments.push({html,inline:false});}else inline+=html;
        }
        flush();return segments.map(part=>hasBlock&&part.inline?`<p>${part.html}</p>`:part.html).join('');
      }
      case 'table':return table(node,context);
      case 'paraDrawing':return drawing(node,context);
      case 'docContent':return nodes(node.content,context);
      case 'tab':return '&#9;';
      case 'br':case 'break':return '<br>';
      case 'hyperlink':{
        const html=await nodes(node.content,context),href=node.value??node.url??node.href;
        try{const probe={type:'text',html:`<p><a href="${escape(href)}">link</a></p>`};checkCanvasBlock(probe);return `<a href="${escape(href)}">${html}</a>`;}
        catch{warn('unsupported-link','A source hyperlink has an unsupported address; its editable text is preserved.');return html;}
      }
      default:warn('unsupported-content',`Reconstructed content of type ${clean(node.type??'unknown').slice(0,80)} needs adaptation before sending.`,{blocking:true});return nodes(node.content,context);
    }
  }
  for(const reference of ['headerReference','footerReference'])if(Object.values(doc.sectPr?.[reference]??{}).some(Boolean))warn('header-footer-review','Source headers or footers require adaptation before sending.',{blocking:true});
  for(const node of doc.content){
    const context={id:`file-block-${model.blocks.length+1}`,pictures:[],runPr:doc.textPr??{}};
    const html=await render(node,context);
    if(!html.trim())continue;
    if(html.length>MAX_TEXT_HTML)fail('document-limit','A reconstructed document part exceeds the supported SharePoint text limit.');
    const block={id:context.id,type:'text',html,...(context.pictures.length?{pictures:context.pictures}:{})};
    checkCanvasBlock(block);model.blocks.push(block);
  }
  if(!model.blocks.length)fail('empty-document','The reconstructed document has no supported editable content.');
  if(model.blocks.length>MAX_BLOCKS||JSON.stringify(model.blocks).length>8000000)fail('document-limit','The document exceeds the supported SharePoint page size.');
  if(/\.pdf$/i.test(name)){
    if(!model.stats.editableTextCharacters)warn('pdf-ocr-unavailable','This PDF contains no reconstructed editable text. Its images remain available for review, but OCR is not included, so sending is blocked.',{blocking:true});
    else if(preview.drawings.some(drawing=>drawing.kind==='image'))warn('pdf-image-text-review','This PDF contains images alongside editable text. Some pages or words may remain inside images; OCR is not included. Review every page for missing editable text before sending.');
  }
  const formDefinition=await adaptForms(result.pdfForms,{sourceHash,title});
  return {model,pictures,formDefinition,preview};
}
