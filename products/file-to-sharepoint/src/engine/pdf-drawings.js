import {parseOfficeXml} from './office-xml.js';
import {validatePdfNativeTables} from './pdf-native-layout.js';
import {meaningfulPdfText} from './pdf-text.js';

const NS='urn:fts:pdf-drawings:2',SPACE='displayed-crop-top-left-pt',ORDINALS='native-renderer-paint-calls';
const MAX_ITEMS=16384,MAX_PATH_UNITS=262144,MAX_TEXT=1048576,MAX_BYTES=16*1024*1024,MAX_NUMBER=10000000;
const fail=()=>{throw Object.assign(new Error('The PDF drawing sources could not be verified. No content was imported.'),{code:'PDF_DRAWINGS_UNVERIFIED'});};
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,names)=>record(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const integer=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const finite=value=>Number.isFinite(value)&&Math.abs(value)<=MAX_NUMBER;
const list=(value,max=MAX_ITEMS)=>Array.isArray(value)&&value.length<=max;
const boundKeys=['leftPt','topPt','rightPt','bottomPt'],matrixKeys=['a','b','c','d','e','f'];
const rootKeys=['version','complete','coordinateSpace','ordinalSpace','sourcePageCount','sourcePaintCount','outputDrawingCount','formedLineCount','pages'];
const pageKeys=['pageIndex','widthPt','heightPt','clips','sourcePaints','lines','drawings'];
const sourceKeys=['id','paintOrdinal','nativeOrder','clipId','kind','role','bounds','ctm','imageId','imageBasis','fillRule','normalComposite','solidFill','path','outputDocPrId','textOwners','cellOwners'];
const lineKeys=['ordinal','nativeOrder','firstPaintOrdinal','bounds','text'];
const drawingKeys=['docPrId','nativeOrder','kind','role','bounds','rotation','flipH','flipV','imageId','representation','sourceIds','lineOverlaps','gap'];
const arities={move:2,line:2,curve:6,close:0};
const box=value=>keys(value,boundKeys)&&boundKeys.every(key=>finite(value[key]))&&value.leftPt<=value.rightPt&&value.topPt<=value.bottomPt;
const matrix=value=>keys(value,matrixKeys)&&matrixKeys.every(key=>finite(value[key]));
const scalar=value=>integer(value,1,0x10ffff)&&!(value>=0xd800&&value<=0xdfff)&&!(value<32&&![9,10,13].includes(value))&&value!==0xfffe&&value!==0xffff;
const text=value=>typeof value==='string'&&value.length<=MAX_TEXT&&Array.from(value).every(char=>scalar(char.codePointAt(0)));
const bag=value=>{const result=new Map();for(const char of value)result.set(char,(result.get(char)??0)+1);return result;};
const sameBag=(a,b)=>a.size===b.size&&[...a].every(([key,count])=>b.get(key)===count);
const overlaps=(a,b)=>Math.min(a.rightPt,b.rightPt)>Math.max(a.leftPt,b.leftPt)&&Math.min(a.bottomPt,b.bottomPt)>Math.max(a.topPt,b.topPt);
// Native table coordinates use eight decimals; drawing provenance retains
// full doubles. Match only that codec boundary, never a visual tolerance.
const insideCell=(a,b)=>a.leftPt>=b.leftPt-0.00000002&&a.topPt>=b.topPt-0.00000002&&a.rightPt<=b.rightPt+0.00000002&&a.bottomPt<=b.bottomPt+0.00000002;
const inside=(a,b)=>a.leftPt>=b.leftPt&&a.topPt>=b.topPt&&a.rightPt<=b.rightPt&&a.bottomPt<=b.bottomPt;
// The SDK serializes integral EMUs. This is its codec boundary, not a visual
// tolerance. Native double arithmetic followed by unsigned truncation can
// lose one EMU (including exact integer wide-image extents).
const sameExtent=(actual,expected)=>{
  const encoded=Math.floor(actual*12700),ideal=expected*12700;
  return encoded===Math.floor(ideal)||Number.isInteger(ideal)&&encoded===ideal-1;
};

function hasDerivedOrigin(source,bounds){
  // The native PNG frame starts at the exact original control extent. Source
  // bounds instead sample cubic ink. Both already use displayed page points.
  let left=Infinity,top=Infinity;
  for(const command of source.path)for(let index=0;index<command.values.length;index+=2){
    left=Math.min(left,command.values[index]);top=Math.min(top,command.values[index+1]);
  }
  return bounds.leftPt===left&&bounds.topPt===top;
}

function rectangularClip(source,clips,allowClipping=false){
  if(source.clipId===0)return true;
  const path=clips[source.clipId-1].path;
  if(![5,6].includes(path.length)||path[0].command!=='move'||path.at(-1).command!=='close'||path.slice(1,-1).some(p=>p.command!=='line'))return false;
  const points=path.slice(0,-1).map(p=>p.values);
  if(points.length===5){if(points[4][0]!==points[0][0]||points[4][1]!==points[0][1])return false;points.pop();}
  const xs=new Set(points.map(p=>p[0])),ys=new Set(points.map(p=>p[1]));
  if(xs.size!==2||ys.size!==2||new Set(points.map(p=>p.join(','))).size!==4)return false;
  for(let i=0;i<4;i++){const a=points[i],b=points[(i+1)%4];if((a[0]===b[0])===(a[1]===b[1]))return false;}
  const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
  // Noncell derived PNGs already contain the native renderer's original clip.
  // Require an intersecting rectangle; cell/native-vector rules stay strict.
  if(allowClipping)return overlaps(source.bounds,{leftPt:left,topPt:top,rightPt:right,bottomPt:bottom});
  // Provenance paths already use displayed page points; never apply ctm again.
  return source.path.every(command=>command.values.every((value,index)=>index%2?value>top&&value<bottom:value>left&&value<right));
}

/** This validates the converter's bounded, inert provenance. It does not parse
 * PDF paths, infer author intent, sort geometry, or establish reading order.
 * The Reader context is required again after structured-clone transport.
 */
export function validatePdfDrawings(value,{pages,pdfText,nativeTables}={}){
  try{
    if(!keys(value,rootKeys)||value.version!==2||value.complete!==true||value.coordinateSpace!==SPACE||value.ordinalSpace!==ORDINALS||
      !Array.isArray(pages)||!integer(pages.length,1,512)||value.sourcePageCount!==pages.length||
      !['sourcePaintCount','outputDrawingCount','formedLineCount'].every(key=>integer(value[key],0,MAX_ITEMS))||!list(value.pages,512)||value.pages.length!==pages.length)fail();
    validatePdfNativeTables(nativeTables,pages);
    if(pdfText?.version!==1||!Array.isArray(pdfText.pages)||pdfText.pages.length!==pages.length||pdfText.order?.version!==1||
      pdfText.order.coordinateSpace!==SPACE||!Array.isArray(pdfText.order.pages)||pdfText.order.pages.length!==pages.length)fail();
    let sources=0,drawings=0,lines=0,clips=0,pathUnits=0,ownerUnits=0,lineUnits=0,checks=0;const outputIds=new Set();
    const check=()=>{if(++checks>8000000)fail();};
    const checkPath=path=>{
      if(!list(path,MAX_PATH_UNITS))fail();
      for(const command of path){
        if(!keys(command,['command','values'])||!Object.hasOwn(arities,command.command)||!Array.isArray(command.values)||command.values.length!==arities[command.command]||!command.values.every(finite))fail();
        pathUnits+=1+command.values.length/2;if(pathUnits>MAX_PATH_UNITS)fail();
      }
    };
    for(const [pageIndex,page]of value.pages.entries()){
      const sourcePage=pages[pageIndex],dpi=sourcePage?.Dpi??72,reader=pdfText.pages[pageIndex],order=pdfText.order.pages[pageIndex];
      if(!keys(page,pageKeys)||page.pageIndex!==pageIndex||!finite(page.widthPt)||page.widthPt<=0||!finite(page.heightPt)||page.heightPt<=0||
        ![sourcePage?.W,sourcePage?.H,dpi].every(n=>finite(n)&&n>0)||Math.abs(page.widthPt-sourcePage.W*72/dpi)>72/dpi||Math.abs(page.heightPt-sourcePage.H*72/dpi)>72/dpi||
        reader?.pageIndex!==pageIndex||!text(reader.text)||order?.pageIndex!==pageIndex||!finite(order.widthPt)||!finite(order.heightPt)||
        Math.abs(order.widthPt-page.widthPt)>72/dpi||Math.abs(order.heightPt-page.heightPt)>72/dpi||!list(order.unicodeScalars,MAX_TEXT)||!order.unicodeScalars.every(scalar)||
        order.unicodeScalars.some(n=>!meaningfulPdfText(String.fromCodePoint(n)))||!list(page.clips,4096)||!list(page.sourcePaints)||!list(page.lines)||!list(page.drawings))fail();
      if((sources+=page.sourcePaints.length)>MAX_ITEMS||(drawings+=page.drawings.length)>MAX_ITEMS||(lines+=page.lines.length)>MAX_ITEMS||(clips+=page.clips.length)>4096)fail();
      const readerBag=bag(meaningfulPdfText(reader.text)),orderedBag=bag(order.unicodeScalars.map(n=>String.fromCodePoint(n)).join(''));
      if(!sameBag(readerBag,orderedBag))fail();
      for(const [index,clip]of page.clips.entries()){
        if(!keys(clip,['id','nativeMode','path'])||clip.id!==index+1||![0,1].includes(clip.nativeMode))fail();checkPath(clip.path);
      }
      const formed=[];
      for(const [index,line]of page.lines.entries()){
        if(!keys(line,lineKeys)||line.ordinal!==index||!integer(line.nativeOrder,1)||!integer(line.firstPaintOrdinal)||!box(line.bounds)||!text(line.text)||
          !line.firstPaintOrdinal&&meaningfulPdfText(line.text)||(lineUnits+=line.text.length)>MAX_TEXT)fail();
        formed.push(meaningfulPdfText(line.text));
      }
      if(!sameBag(readerBag,bag(formed.join(''))))fail();
      let previousPaint=0;const outputs=new Map();
      for(const [index,source]of page.sourcePaints.entries()){
        if(!keys(source,sourceKeys)||source.id!==index+1||!integer(source.paintOrdinal,1)||source.paintOrdinal<=previousPaint||!integer(source.nativeOrder,1)||
          !integer(source.clipId,0,page.clips.length)||!['fill','stroke','image'].includes(source.kind)||!['drawing','text-effect','cell-fill','cell-border','cell-image','cell-figure','fully-clipped'].includes(source.role)||
          !box(source.bounds)||!matrix(source.ctm)||!list(source.textOwners)||!list(source.cellOwners,4096))fail();
        previousPaint=source.paintOrdinal;checkPath(source.path);
        if(typeof source.normalComposite!=='boolean'||source.kind!=='image'&&source.normalComposite!==true||
          (source.kind==='fill'?!['nonzero','evenodd'].includes(source.fillRule):source.fillRule!==null)||
          (source.solidFill!==null&&(!keys(source.solidFill,['r','g','b','a'])||!Object.values(source.solidFill).every(n=>integer(n,0,255))))||source.kind!=='fill'&&source.solidFill!==null)fail();
        if(source.kind==='image'?!integer(source.imageId,1)||!matrix(source.imageBasis):source.imageId!==null||source.imageBasis!==null)fail();
        const hasOutput=source.role==='drawing'||source.role==='cell-image'||source.role==='cell-figure';
        if(hasOutput?!integer(source.outputDocPrId,1):source.outputDocPrId!==null)fail();
        if(hasOutput){const refs=outputs.get(source.outputDocPrId)??[];refs.push(source.id);outputs.set(source.outputDocPrId,refs);}
        if(source.role==='text-effect'?!source.textOwners.length:source.textOwners.length!==0)fail();
        if(source.role.startsWith('cell-')?!source.cellOwners.length:source.cellOwners.length!==0)fail();
        if(source.role==='cell-image'&&(source.kind!=='image'||source.cellOwners.length!==1)||['cell-fill','cell-border','text-effect'].includes(source.role)&&source.kind==='image')fail();
        const ownerIds=new Set();
        for(const owner of source.textOwners){
          if(!keys(owner,['nativeOrder','bounds','text'])||!integer(owner.nativeOrder,1)||!box(owner.bounds)||!text(owner.text)||(ownerUnits+=owner.text.length)>MAX_TEXT)fail();
          const meaningful=meaningfulPdfText(owner.text),ownerBag=bag(meaningful);
          // An owner is a native split-cont snapshot, not a line ID. Require
          // exact text membership in an overlapping formed line; retain any
          // ambiguity for the compositor rather than inventing an association.
          if([...ownerBag].some(([char,count])=>(readerBag.get(char)??0)<count)||!page.lines.some(line=>{check();return overlaps(owner.bounds,line.bounds)&&meaningfulPdfText(line.text).includes(meaningful);}))fail();
          const id=JSON.stringify(owner);if(ownerIds.has(id))fail();ownerIds.add(id);
        }
        const cells=new Set();
        for(const owner of source.cellOwners){
          if(!keys(owner,['tableOrdinal','row','column'])||!integer(owner.tableOrdinal,0,nativeTables.tables.length-1)||!integer(owner.row)||!integer(owner.column))fail();
          const table=nativeTables.tables[owner.tableOrdinal];
          if(table.pageIndex!==pageIndex||!table.cells.some(cell=>cell.row===owner.row&&cell.column===owner.column))fail();
          const id=`${owner.tableOrdinal}:${owner.row}:${owner.column}`;if(cells.has(id))fail();cells.add(id);
        }
        if(source.role==='cell-figure'){
          if(source.kind!=='fill'||!source.path.length||source.cellOwners.length!==1||!rectangularClip(source,page.clips))fail();
          const owner=source.cellOwners[0],cell=nativeTables.tables[owner.tableOrdinal].cells.find(cell=>cell.row===owner.row&&cell.column===owner.column);
          if(!insideCell(source.bounds,cell))fail();
        }
      }
      const pageOutputIds=new Set();
      for(const drawing of page.drawings){
        if(!keys(drawing,drawingKeys)||!integer(drawing.docPrId,1)||outputIds.has(drawing.docPrId)||!integer(drawing.nativeOrder,1)||
          !['vector','image','derived-vector','text'].includes(drawing.kind)||!['figure','under-text','editable-text-wrapper','cell-image','cell-figure'].includes(drawing.role)||!box(drawing.bounds)||
          !finite(drawing.rotation)||typeof drawing.flipH!=='boolean'||typeof drawing.flipV!=='boolean'||!list(drawing.sourceIds)||!list(drawing.lineOverlaps))fail();
        outputIds.add(drawing.docPrId);pageOutputIds.add(drawing.docPrId);
        if(['image','derived-vector'].includes(drawing.kind)?!integer(drawing.imageId,1):drawing.imageId!==null)fail();
        if(drawing.kind==='derived-vector'){
          const rep=drawing.representation;
          if(!keys(rep,['format','resourceName','pixelWidth','pixelHeight','dpi'])||rep.format!=='png'||rep.resourceName!==`word/media/image${drawing.imageId}.png`||
            !integer(rep.pixelWidth,1,4096)||!integer(rep.pixelHeight,1,4096)||rep.pixelWidth*rep.pixelHeight>8*1024*1024||!finite(rep.dpi)||rep.dpi<192||
            !sameExtent(drawing.bounds.rightPt-drawing.bounds.leftPt,rep.pixelWidth*72/rep.dpi)||!sameExtent(drawing.bounds.bottomPt-drawing.bounds.topPt,rep.pixelHeight*72/rep.dpi)||
            !['figure','under-text','cell-figure'].includes(drawing.role)||drawing.sourceIds.length!==1||drawing.rotation!==0||drawing.flipH||drawing.flipV)fail();
        }else if(drawing.representation!==null)fail();
        if(drawing.role==='editable-text-wrapper'?(drawing.kind!=='text'||drawing.sourceIds.length||drawing.lineOverlaps.length||drawing.gap!==null):(drawing.kind==='text'||!drawing.sourceIds.length))fail();
        const expected=outputs.get(drawing.docPrId)??[],refs=new Set();
        for(const id of drawing.sourceIds){
          if(!integer(id,1,page.sourcePaints.length)||refs.has(id)||!expected.includes(id))fail();refs.add(id);
          const source=page.sourcePaints[id-1];
          if(drawing.kind==='image'&&(source.kind!=='image'||source.imageId!==drawing.imageId)||drawing.kind==='vector'&&source.kind==='image'||(drawing.role==='cell-image')!==(source.role==='cell-image')||(drawing.role==='cell-figure')!==(source.role==='cell-figure'))fail();
          if(drawing.kind==='vector'&&source.kind==='fill'&&source.fillRule==='evenodd')fail();
          if(drawing.kind==='derived-vector'&&(source.kind!=='fill'||source.fillRule!=='evenodd'||source.solidFill===null||!source.path.length||source.normalComposite!==true||
            !hasDerivedOrigin(source,drawing.bounds)||!inside(source.bounds,drawing.bounds)||!rectangularClip(source,page.clips,source.role!=='cell-figure')))fail();
        }
        if(refs.size!==expected.length)fail();
        if(drawing.role==='cell-figure'){
          if(!['vector','derived-vector'].includes(drawing.kind)||drawing.rotation!==0||drawing.flipH||drawing.flipV||drawing.gap!==null)fail();
          const owner=page.sourcePaints[drawing.sourceIds[0]-1].cellOwners[0];
          if(drawing.sourceIds.some(id=>{const other=page.sourcePaints[id-1].cellOwners[0];return other.tableOrdinal!==owner.tableOrdinal||other.row!==owner.row||other.column!==owner.column;}))fail();
          const cell=nativeTables.tables[owner.tableOrdinal].cells.find(cell=>cell.row===owner.row&&cell.column===owner.column);
          if(!insideCell(drawing.bounds,cell)||!list(order.scalarBoxesPt,MAX_TEXT)||order.scalarBoxesPt.length!==order.unicodeScalars.length)fail();
          for(const glyph of order.scalarBoxesPt){
            check();if(!Array.isArray(glyph)||glyph.length!==4||!glyph.every(finite)||glyph[0]>glyph[2]||glyph[1]>glyph[3]||overlaps(drawing.bounds,{leftPt:glyph[0],topPt:glyph[1],rightPt:glyph[2],bottomPt:glyph[3]}))fail();
          }
        }
        let previousLine=-1;
        for(const ordinal of drawing.lineOverlaps){
          if(!integer(ordinal,0,page.lines.length-1)||ordinal<=previousLine||!overlaps(drawing.bounds,page.lines[ordinal].bounds))fail();previousLine=ordinal;
        }
        if(drawing.role==='under-text'||drawing.role==='figure'){
          const intersections=[];for(const line of page.lines){check();if(overlaps(drawing.bounds,line.bounds))intersections.push(line.ordinal);}
          let lastPaint=0;for(const id of drawing.sourceIds)lastPaint=Math.max(lastPaint,page.sourcePaints[id-1].paintOrdinal);
          // The native original scalar provenance survives split/merge. Its
          // minimum callback paint ordinal is distinct from reconstruction
          // nativeOrder (which can retain a later appended glyph). Unknown
          // zero never proves an underlay. Validate the role both ways.
          const underText=intersections.length>0&&intersections.every(index=>page.lines[index].firstPaintOrdinal>lastPaint);
          if((drawing.role==='under-text')!==underText)fail();
          if(underText&&(intersections.length!==drawing.lineOverlaps.length||intersections.some((ordinal,index)=>ordinal!==drawing.lineOverlaps[index])))fail();
        }
        if(drawing.role!=='under-text'&&drawing.lineOverlaps.length)fail();
        if(drawing.gap!==null){
          const gap=drawing.gap;
          if(!keys(gap,['beforeLine','afterLine'])||drawing.role!=='figure'||drawing.lineOverlaps.length||!integer(gap.beforeLine,0,page.lines.length-2)||gap.afterLine!==gap.beforeLine+1||
            drawing.bounds.topPt<page.lines[gap.beforeLine].bounds.bottomPt||drawing.bounds.bottomPt>page.lines[gap.afterLine].bounds.topPt)fail();
          const candidates=[];
          for(let index=0;index+1<page.lines.length;index++){
            check();const before=page.lines[index].bounds,after=page.lines[index+1].bounds;
            if(before.bottomPt<after.topPt&&drawing.bounds.topPt>=before.bottomPt&&drawing.bounds.bottomPt<=after.topPt)candidates.push(index);
          }
          if(candidates.length!==1||candidates[0]!==gap.beforeLine)fail();
        }
      }
      if([...outputs.keys()].some(id=>!pageOutputIds.has(id)))fail();
    }
    if(sources!==value.sourcePaintCount||drawings!==value.outputDrawingCount||lines!==value.formedLineCount)fail();
    return value;
  }catch{fail();}
}

/** Read only the converter's private XML, before DOCX→BIN drops custom parts.
 * Existing Office XML parsing handles UTF-8, XML characters and parser repairs.
 */
export function readPdfDrawings(bytes,options,Parser){
  try{
    if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_BYTES)fail();
    const document=parseOfficeXml(bytes,Parser),root=document.documentElement;
    if(document.doctype||root?.namespaceURI!==NS||root.localName!=='drawings')fail();
    for(let index=0;index<document.childNodes.length;index++){
      const child=document.childNodes.item(index);
      if(child===root||child.nodeType===3&&!child.nodeValue.trim()||child.nodeType===7&&child.nodeName==='xml')continue;
      fail();
    }
    const attributes=(node,required,optional=[],isRoot=false)=>{
      const result={};
      for(let i=0;i<node.attributes.length;i++){
        const attr=node.attributes.item(i);if(isRoot&&attr.name==='xmlns'&&attr.value===NS)continue;
        if(attr.namespaceURI||![...required,...optional].includes(attr.name)||Object.hasOwn(result,attr.name))fail();result[attr.name]=attr.value;
      }
      if(!required.every(name=>Object.hasOwn(result,name)))fail();return result;
    };
    const children=node=>{
      const result=[];for(let i=0;i<node.childNodes.length;i++){
        const child=node.childNodes.item(i);if(child.nodeType===3&&!child.nodeValue.trim())continue;
        if(child.nodeType!==1||child.namespaceURI!==NS)fail();result.push(child);
      }return result;
    };
    const groups=(node,names)=>{
      const result=Object.fromEntries(names.map(name=>[name,[]]));let previous=0;
      for(const child of children(node)){const index=names.indexOf(child.localName);if(index<previous||index<0)fail();previous=index;result[child.localName].push(child);}return result;
    };
    const one=(items,required=true)=>{if(items.length!==(required?1:Math.min(items.length,1)))fail();return items[0];};
    const number=raw=>{if(typeof raw!=='string'||raw.length>32||! /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(raw))fail();const value=Number(raw);if(!finite(value))fail();return value;};
    const int=raw=>{if(typeof raw!=='string'||!/^(?:0|[1-9][0-9]{0,15})$/.test(raw))fail();const value=Number(raw);if(!integer(value))fail();return value;};
    const bool=raw=>{if(!['true','false'].includes(raw))fail();return raw==='true';};
    const bounds=raw=>Object.fromEntries(boundKeys.map(key=>[key,number(raw[key])]));
    const leaf=(node,names,convert=int)=>{const raw=attributes(node,names);if(children(node).length)fail();return Object.fromEntries(names.map(name=>[name,convert(raw[name])]));};
    const readMatrix=node=>leaf(node,matrixKeys,number);
    const readPath=node=>{
      attributes(node,[]);return children(node).map(command=>{
        const names={move:['x','y'],line:['x','y'],curve:['x1','y1','x2','y2','x3','y3'],close:[]}[command.localName];if(!names)fail();
        const values=leaf(command,names,number);return {command:command.localName,values:names.map(name=>values[name])};
      });
    };
    const readText=node=>{
      attributes(node,[]);let value='';for(let i=0;i<node.childNodes.length;i++){const child=node.childNodes.item(i);if(child.nodeType!==3)fail();value+=child.nodeValue;}return value;
    };
    const readOwner=node=>{
      const raw=attributes(node,['nativeOrder',...boundKeys]),items=groups(node,['text']);
      return {nativeOrder:int(raw.nativeOrder),bounds:bounds(raw),text:readText(one(items.text))};
    };
    const raw=attributes(root,rootKeys.filter(name=>name!=='pages'),[],true);
    const value={version:int(raw.version),complete:bool(raw.complete),coordinateSpace:raw.coordinateSpace,ordinalSpace:raw.ordinalSpace,sourcePageCount:int(raw.sourcePageCount),sourcePaintCount:int(raw.sourcePaintCount),outputDrawingCount:int(raw.outputDrawingCount),formedLineCount:int(raw.formedLineCount),pages:[]};
    // Refuse declared excess before allocating the object graph.
    if(value.sourcePageCount>512||[value.sourcePaintCount,value.outputDrawingCount,value.formedLineCount].some(n=>n>MAX_ITEMS))fail();
    for(const pageNode of children(root)){
      if(pageNode.localName!=='page'||value.pages.length>=512)fail();
      const rawPage=attributes(pageNode,['index','widthPt','heightPt']),items=groups(pageNode,['clip','sourcePaint','line','drawing']);
      if(items.clip.length>4096||[items.sourcePaint,items.line,items.drawing].some(items=>items.length>MAX_ITEMS))fail();
      const page={pageIndex:int(rawPage.index),widthPt:number(rawPage.widthPt),heightPt:number(rawPage.heightPt),clips:[],sourcePaints:[],lines:[],drawings:[]};
      for(const node of items.clip){const raw=attributes(node,['id','nativeMode']),parts=groups(node,['path']);page.clips.push({id:int(raw.id),nativeMode:int(raw.nativeMode),path:readPath(one(parts.path))});}
      for(const node of items.sourcePaint){
        const raw=attributes(node,['id','paintOrdinal','nativeOrder','clipId','kind','role',...boundKeys,'fillRule','normalComposite'],['imageId']),parts=groups(node,['ctm','imageBasis','solidFill','path','output','textOwner','cellOwner']);
        const image=raw.kind==='image';if(image!==Object.hasOwn(raw,'imageId'))fail();
        const output=one(parts.output,false),basis=one(parts.imageBasis,image),solid=one(parts.solidFill,false);
        if(!['none','nonzero','evenodd'].includes(raw.fillRule))fail();
        page.sourcePaints.push({id:int(raw.id),paintOrdinal:int(raw.paintOrdinal),nativeOrder:int(raw.nativeOrder),clipId:int(raw.clipId),kind:raw.kind,role:raw.role,bounds:bounds(raw),ctm:readMatrix(one(parts.ctm)),imageId:image?int(raw.imageId):null,imageBasis:basis?readMatrix(basis):null,fillRule:raw.fillRule==='none'?null:raw.fillRule,normalComposite:bool(raw.normalComposite),solidFill:solid?leaf(solid,['r','g','b','a']):null,path:readPath(one(parts.path)),outputDocPrId:output?leaf(output,['docPrId']).docPrId:null,textOwners:parts.textOwner.map(readOwner),cellOwners:parts.cellOwner.map(node=>leaf(node,['tableOrdinal','row','column']))});
      }
      for(const node of items.line){const raw=attributes(node,['ordinal','nativeOrder','firstPaintOrdinal',...boundKeys]),parts=groups(node,['text']);page.lines.push({ordinal:int(raw.ordinal),nativeOrder:int(raw.nativeOrder),firstPaintOrdinal:int(raw.firstPaintOrdinal),bounds:bounds(raw),text:readText(one(parts.text))});}
      for(const node of items.drawing){
        const raw=attributes(node,['docPrId','nativeOrder','kind','role',...boundKeys,'rotation','flipH','flipV'],['imageId']),parts=groups(node,['representation','source','lineOverlap','gap']),gap=one(parts.gap,false),image=['image','derived-vector'].includes(raw.kind),representation=one(parts.representation,raw.kind==='derived-vector');
        if(image!==Object.hasOwn(raw,'imageId'))fail();
        let rep=null;if(representation){const fields=attributes(representation,['format','resourceName','pixelWidth','pixelHeight','dpi']);if(children(representation).length)fail();rep={format:fields.format,resourceName:fields.resourceName,pixelWidth:int(fields.pixelWidth),pixelHeight:int(fields.pixelHeight),dpi:number(fields.dpi)};}
        page.drawings.push({docPrId:int(raw.docPrId),nativeOrder:int(raw.nativeOrder),kind:raw.kind,role:raw.role,bounds:bounds(raw),rotation:number(raw.rotation),flipH:bool(raw.flipH),flipV:bool(raw.flipV),imageId:image?int(raw.imageId):null,representation:rep,sourceIds:parts.source.map(node=>leaf(node,['id']).id),lineOverlaps:parts.lineOverlap.map(node=>leaf(node,['ordinal']).ordinal),gap:gap?leaf(gap,['beforeLine','afterLine']):null});
      }
      value.pages.push(page);
    }
    return validatePdfDrawings(value,options);
  }catch{fail();}
}
