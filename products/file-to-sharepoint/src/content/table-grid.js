const invalid=()=>{throw Object.assign(new Error('The reconstructed table has an invalid or unsupported merge layout.'),{code:'unsupported-content'});};
const integer=(value,min=0)=>Number.isInteger(value)&&value>=min&&value<=9999;

// Word keeps a cell in every row of a vertical merge. HTML emits only its
// anchor; retain continuation descriptors for content, formatting and borders.
export function planWordTable(table){
  if(!Array.isArray(table.content)||table.content.length>9999)invalid();
  const declared=table.tblGrid?.length;
  if(declared!==undefined&&(!Array.isArray(table.tblGrid)||!integer(declared,1)))invalid();
  let columns=declared??0;
  const rows=table.content.map((row,rowIndex)=>{
    if(row.type!=='tblRow'||!Array.isArray(row.content))invalid();
    const before=row.trPr?.gridBefore??0,after=row.trPr?.gridAfter??0;
    if(!integer(before)||!integer(after))invalid();
    let col=before;
    const cells=row.content.map((cell,cellIndex)=>{
      const span=cell.tcPr?.gridSpan??1,vm=cell.tcPr?.vMerge;
      if(cell.type!=='tblCell'||!integer(span,1)||cell.tcPr?.hMerge||vm!==undefined&&!['restart','continue'].includes(vm))invalid();
      const item={cell,rowIndex,cellIndex,startCol:col,colSpan:span,rowSpan:1,continuations:[]};col+=span;return item;
    });
    const width=col+after;
    if(!integer(width,1)||declared&&width>declared)invalid();
    columns=Math.max(columns,width);return {rowIndex,before,after,cells,endCol:col};
  });
  let active=new Map();
  for(const row of rows){
    const next=new Map(),emitted=[];
    if(row.before)emitted.push({gap:true,colSpan:row.before});
    for(const item of row.cells){
      const key=`${item.startCol}:${item.colSpan}`,vm=item.cell.tcPr?.vMerge;
      if(vm==='continue'){
        const anchor=active.get(key);if(!anchor)invalid();
        anchor.rowSpan++;anchor.continuations.push(item);next.set(key,anchor);
      }else{
        emitted.push(item);if(vm==='restart')next.set(key,item);
      }
    }
    if(row.endCol<columns)emitted.push({gap:true,colSpan:columns-row.endCol});
    row.emitted=emitted;active=next;
  }
  return {columns,rows};
}

// Empty SDK wrapper paragraphs in continuation cells are structural. Unknown
// nodes, notes, list items, drawings and actual text must still be rendered.
export function hasCellContent(value){
  if(typeof value==='string')return value.length>0;
  if(Array.isArray(value))return value.some(hasCellContent);
  if(!value||typeof value!=='object')return false;
  if(!['docContent','paragraph','run','endRun'].includes(value.type))return true;
  return Boolean(value.ftsNumbering||value.pPr?.numPr||value.footnotes?.length||value.endnotes?.length)||hasCellContent(value.content);
}
