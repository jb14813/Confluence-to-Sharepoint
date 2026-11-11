import {validatePdfNativeTables} from '../engine/pdf-native-layout.js';
import {meaningfulPdfText} from '../engine/pdf-text.js';
import {planWordTable} from './table-grid.js';

const EPSILON=0.00000002; // Native eight-decimal-point serialization only.
const inside=(a,b)=>a[0]>=b[0]-EPSILON&&a[1]>=b[1]-EPSILON&&a[2]<=b[2]+EPSILON&&a[3]<=b[3]+EPSILON;
const touches=(a,b)=>Math.max(a[0],b[0])<Math.min(a[2],b[2])&&Math.max(a[1],b[1])<Math.min(a[3],b[3]);
function textOf(value){
  const stack=[value],parts=[];let nodes=0;
  while(stack.length){
    if(++nodes>500000)throw Error('Table content limit');
    const node=stack.pop();
    if(typeof node==='string')parts.push(node);
    else if(Array.isArray(node)){for(let i=node.length-1;i>=0;i--)stack.push(node[i]);}
    else if(node&&typeof node==='object')stack.push(node.type==='paraDrawing'?node.graphic?.content:node.content);
  }
  return meaningfulPdfText(parts.join(''));
}

/** Canonicalize only complete source-proven table intervals. Original native
 * order remains authoritative within each cell and everywhere outside tables.
 * Every reordered scalar retains its original native index and bounding box.
 */
export function planPdfTableOrder(document,{nativeTables,pages,sources,pageAssociation,maxChecks=8000000}={}){
  const refuse=(code)=>({ok:false,code});
  try{
    const sdkTables=document.content.filter(node=>node.type==='table');
    if(nativeTables===undefined)return sdkTables.length?refuse('native-table-contract-unverified'):{ok:true,sources,tables:new WeakMap(),proof:[]};
    validatePdfNativeTables(nativeTables,pages);
    if(sdkTables.length!==nativeTables.tables.length)return refuse('native-table-count-mismatch');
    // Native semantic tables are root objects. Nested or hidden SDK tables
    // cannot borrow a serialized root ordinal.
    let visited=0,totalTables=0;const stack=[document.content];
    while(stack.length){const node=stack.pop();if(++visited>500000)return refuse('coverage-limit');
      if(Array.isArray(node))for(const child of node)stack.push(child);
      else if(node&&typeof node==='object'){if(node.type==='table')totalTables++;stack.push(node.content);if(node.type==='paraDrawing')stack.push(node.graphic?.content);}
    }
    if(totalTables!==sdkTables.length)return refuse('native-table-count-mismatch');
    const result=sources.slice(),tables=new WeakMap(),proof=[],perPage=new Map();let checks=0;
    for(const [ordinal,native]of nativeTables.tables.entries()){
      const node=sdkTables[ordinal],source=sources[native.pageIndex];
      if(pageAssociation.get(node)!==native.pageIndex||!source||source.pageIndex!==native.pageIndex||source.rotation!==0)return refuse('native-table-page-mismatch');
      const grid=planWordTable(node),anchors=grid.rows.flatMap(row=>row.emitted);
      if(grid.columns!==native.columns||grid.rows.length!==native.rows||anchors.some(cell=>cell.gap)||anchors.length!==native.cells.length)return refuse('native-table-topology-mismatch');
      for(const [index,cell]of anchors.entries()){
        const expected=native.cells[index];
        if(cell.rowIndex!==expected.row||cell.startCol!==expected.column||cell.rowSpan!==expected.rowSpan||cell.colSpan!==expected.columnSpan||
          cell.continuations.some(item=>textOf(item.cell)))return refuse('native-table-topology-mismatch');
      }
      if(!Array.isArray(source.unicodeScalars)||!Array.isArray(source.scalarBoxesPt)||source.unicodeScalars.length!==source.scalarBoxesPt.length)return refuse('unproved-coordinates');
      const boxes=native.cells.map(cell=>[cell.leftPt,cell.topPt,cell.rightPt,cell.bottomPt]);
      const bounds=[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))];
      const indices=boxes.map(()=>[]),all=[];
      for(const [index,box]of source.scalarBoxesPt.entries()){
        if(++checks>maxChecks)return refuse('coverage-limit');
        if(!Array.isArray(box)||box.length!==4||box.some(n=>!Number.isFinite(n))||box[0]>box[2]||box[1]>box[3])return refuse('unproved-coordinates');
        if(!touches(box,bounds)&&!inside(box,bounds))continue;
        let found=-1;
        for(const [cellIndex,cellBox]of boxes.entries()){
          if(++checks>maxChecks)return refuse('coverage-limit');
          if(inside(box,cellBox)){if(found!==-1)return refuse('ambiguous-table-glyph');found=cellIndex;}
        }
        if(found===-1)return refuse('partial-table-glyph');
        indices[found].push(index);all.push(index);
      }
      if(!all.length)return refuse('unanchored-empty-table');
      const start=all[0],end=all.at(-1)+1;
      if(end-start!==all.length)return refuse('noncontiguous-table-source');
      for(const [index,cellIndices]of indices.entries()){
        const expected=cellIndices.map(i=>String.fromCodePoint(source.unicodeScalars[i])).join('');
        if(textOf(anchors[index].cell)!==expected)return refuse('native-table-cell-text-mismatch');
      }
      const permutation=indices.flat(),record={ordinal,pageIndex:native.pageIndex,start,end,sourceIndices:permutation,cells:indices.map((sourceIndices,index)=>({row:native.cells[index].row,column:native.cells[index].column,sourceIndices}))};
      const onPage=perPage.get(native.pageIndex)??[];
      if(onPage.some(other=>start<other.end&&end>other.start))return refuse('overlapping-table-source');
      onPage.push(record);perPage.set(native.pageIndex,onPage);tables.set(node,{ordinal,pageIndex:native.pageIndex,sourceBoxPt:bounds,nativeTable:native});proof.push(record);
    }
    for(const [pageIndex,records]of perPage){
      const original=sources[pageIndex],unicodeScalars=original.unicodeScalars.slice(),scalarBoxesPt=original.scalarBoxesPt.slice();
      for(const record of records)for(const [offset,index]of record.sourceIndices.entries()){
        unicodeScalars[record.start+offset]=original.unicodeScalars[index];scalarBoxesPt[record.start+offset]=original.scalarBoxesPt[index];
      }
      // These copies are used only by intact-unit coverage matching. Original
      // word/line/paragraph hierarchy stays untouched in the source capability.
      result[pageIndex]={...original,unicodeScalars,scalarBoxesPt};
    }
    return {ok:true,sources:result,tables,proof};
  }catch{return refuse('native-table-contract-unverified');}
}
