import {parseOfficeXml} from './office-xml.js';

const NS='urn:fts:pdf-layout:1',SPACE='displayed-crop-top-left-pt';
const fail=()=>{throw Object.assign(new Error('The PDF table layout could not be verified. No content was imported.'),{code:'PDF_LAYOUT_UNVERIFIED'});};
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,names)=>record(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const rootKeys=['version','complete','coordinateSpace','sourcePageCount','tables'];
const tableKeys=['ordinal','pageIndex','rows','columns','cells'];
const cellKeys=['row','column','rowSpan','columnSpan','leftPt','topPt','rightPt','bottomPt'];
// Native geometry is serialized to eight decimal places. This tolerance covers
// only that decimal boundary, not neighbouring cells or glyph assignment.
const EPSILON=0.00000002;

/** Validate the native closed-grid contract again after worker transport. It is
 * not a table detector: every cell and serialized table ordinal comes from the
 * converter's existing grid/writer, then must tile without gaps or overlap.
 */
export function validatePdfNativeTables(value,pages){
  const paragraphProfile=record(value)&&Object.hasOwn(value,'textAssociationType');
  if(!keys(value,paragraphProfile?[...rootKeys,'textAssociationType']:rootKeys)||value.version!==1||value.complete!==true||value.coordinateSpace!==SPACE||
    !Array.isArray(pages)||!integer(pages.length,1,4096)||value.sourcePageCount!==pages.length||
    !Array.isArray(value.tables)||value.tables.length>256)fail();
  if(paragraphProfile&&(value.textAssociationType!==4||value.tables.length!==0))fail();
  const pageSizes=pages.map(page=>{
    const dpi=page?.Dpi??72;
    if(![page?.W,page?.H,dpi].every(n=>Number.isFinite(n)&&n>0&&n<=10000000))fail();
    return {width:page.W*72/dpi,height:page.H*72/dpi,tolerance:72/dpi};
  });
  let cellCount=0,previousPage=-1;const bounds=[];
  for(const [ordinal,table]of value.tables.entries()){
    if(!keys(table,tableKeys)||table.ordinal!==ordinal||!integer(table.pageIndex,0,pages.length-1)||table.pageIndex<previousPage||
      !integer(table.rows,1,4096)||!integer(table.columns,1,4096)||table.rows*table.columns>65536||
      !Array.isArray(table.cells)||!table.cells.length||(cellCount+=table.cells.length)>4096)fail();
    previousPage=table.pageIndex;
    const occupied=new Uint8Array(table.rows*table.columns),xs=new Map(),ys=new Map(),page=pageSizes[table.pageIndex];
    const edge=(map,index,position)=>{if(map.has(index)&&Math.abs(map.get(index)-position)>EPSILON)fail();map.set(index,position);};
    let previousAnchor=-1;
    for(const cell of table.cells){
      if(!keys(cell,cellKeys)||!integer(cell.row,0,table.rows-1)||!integer(cell.column,0,table.columns-1)||
        !integer(cell.rowSpan,1,table.rows-cell.row)||!integer(cell.columnSpan,1,table.columns-cell.column)||
        ![cell.leftPt,cell.topPt,cell.rightPt,cell.bottomPt].every(n=>Number.isFinite(n)&&n>=0)||
        cell.leftPt>=cell.rightPt||cell.topPt>=cell.bottomPt||cell.rightPt>page.width+page.tolerance||cell.bottomPt>page.height+page.tolerance)fail();
      const anchor=cell.row*table.columns+cell.column;
      if(anchor<=previousAnchor)fail();previousAnchor=anchor;
      edge(xs,cell.column,cell.leftPt);edge(xs,cell.column+cell.columnSpan,cell.rightPt);
      edge(ys,cell.row,cell.topPt);edge(ys,cell.row+cell.rowSpan,cell.bottomPt);
      for(let row=cell.row;row<cell.row+cell.rowSpan;row++)for(let column=cell.column;column<cell.column+cell.columnSpan;column++){
        const index=row*table.columns+column;if(occupied[index])fail();occupied[index]=1;
      }
    }
    if(occupied.some(n=>!n))fail();
    for(const edges of [xs,ys]){
      const sorted=[...edges].sort((a,b)=>a[0]-b[0]);
      if(sorted.some((entry,index)=>index&&entry[1]<=sorted[index-1][1]))fail();
    }
    const box={pageIndex:table.pageIndex,left:xs.get(0),right:xs.get(table.columns),top:ys.get(0),bottom:ys.get(table.rows)};
    if(bounds.some(other=>other.pageIndex===box.pageIndex&&Math.min(other.right,box.right)-Math.max(other.left,box.left)>EPSILON&&Math.min(other.bottom,box.bottom)-Math.max(other.top,box.top)>EPSILON))fail();
    bounds.push(box);
  }
  return value;
}

export function validatePdfConversionProfile(layout){
  const mode=layout?.nativeTables?.textAssociationType??2;
  if(layout?.version!==1||![2,4].includes(mode)||layout.textAssociationType!==mode||
    layout.flowGeometry!==(mode===2?'native-plain-line-v1':'native-plain-paragraph-v1')||
    mode===4&&(!Array.isArray(layout.nativeTables.tables)||layout.nativeTables.tables.length))
    throw Object.assign(new Error('The PDF conversion profile could not be verified.'),{code:'PDF_ORDER_UNVERIFIED'});
  return mode;
}

/** Read only the converter's private XML part, before the existing DOCX→BIN
 * conversion can discard it. Office XML syntax/UTF-8 validation stays shared.
 */
export function readPdfNativeLayout(bytes,pages,Parser){
  try{
    if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>1024*1024)fail();
    const document=parseOfficeXml(bytes,Parser),root=document.documentElement;
    if(document.doctype||root?.namespaceURI!==NS||root.localName!=='pdfLayout')fail();
    const attributes=(node,expected,rootNode=false)=>{
      const result={};
      for(let i=0;i<node.attributes.length;i++){
        const attribute=node.attributes.item(i);
        if(rootNode&&attribute.name==='xmlns'&&attribute.value===NS)continue;
        if(attribute.namespaceURI||!expected.includes(attribute.name)||Object.hasOwn(result,attribute.name))fail();
        result[attribute.name]=attribute.value;
      }
      if(Object.keys(result).length!==expected.length)fail();return result;
    };
    const children=(node,name)=>{
      const result=[];
      for(let i=0;i<node.childNodes.length;i++){
        const child=node.childNodes.item(i);
        if(child.nodeType===3&&!child.nodeValue.trim())continue;
        if(child.nodeType!==1||child.namespaceURI!==NS||child.localName!==name)fail();
        result.push(child);
      }
      return result;
    };
    const number=(raw,coordinate=false)=>{
      if(!(coordinate?/^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,8})?$/:/^(?:0|[1-9][0-9]{0,9})$/).test(raw))fail();
      return Number(raw);
    };
    const paragraphProfile=root.hasAttribute('textAssociationType');
    const raw=attributes(root,['version','complete','coordinateSpace','sourcePageCount',...(paragraphProfile?['textAssociationType']:[])],true);
    if(raw.complete!=='true')fail();
    const result={version:number(raw.version),complete:true,coordinateSpace:raw.coordinateSpace,sourcePageCount:number(raw.sourcePageCount),tables:[]};
    if(paragraphProfile){if(raw.textAssociationType!=='4')fail();result.textAssociationType=4;}
    for(const node of children(root,'table')){
      const rawTable=attributes(node,tableKeys.filter(name=>name!=='cells')),table={};
      for(const key of Object.keys(rawTable))table[key]=number(rawTable[key]);
      table.cells=children(node,'cell').map(node=>{
        const rawCell=attributes(node,cellKeys),cell={};if(children(node,'unused').length)fail();
        for(const key of cellKeys)cell[key]=number(rawCell[key],key.endsWith('Pt'));
        return cell;
      });
      result.tables.push(table);
    }
    return validatePdfNativeTables(result,pages);
  }catch{fail();}
}
