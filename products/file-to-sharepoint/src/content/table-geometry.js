/** Preserve declared SDK grid widths or independently verified PDF cell axes as
 * responsive column proportions and row minima. The native editor represents
 * these through tableCellWidth and tableCellHeight; CSS cell height expands
 * to fit content, preserving editable text at narrower responsive widths.
 */
export function planTableGeometry(node,nativeTable){
  let widths,source,rowMinimumPt;
  if(nativeTable){
    const xs=new Map(),ys=new Map();
    const edge=(map,index,value)=>{if(map.has(index)&&Math.abs(map.get(index)-value)>0.00000002)throw Error('Conflicting native table edge');map.set(index,value);};
    try{
      for(const cell of nativeTable.cells){
        edge(xs,cell.column,cell.leftPt);edge(xs,cell.column+cell.columnSpan,cell.rightPt);
        edge(ys,cell.row,cell.topPt);edge(ys,cell.row+cell.rowSpan,cell.bottomPt);
      }
      widths=Array.from({length:nativeTable.columns},(_,i)=>xs.get(i+1)-xs.get(i));
      rowMinimumPt=Array.from({length:nativeTable.rows},(_,i)=>ys.get(i+1)-ys.get(i));
      source='native-pdf-cells';
    }catch{return null;}
  }else{
    if(!Array.isArray(node?.tblGrid)||!node.tblGrid.length)return null;
    widths=node.tblGrid.map(column=>column?.w);source='sdk-tblGrid';
    // The pinned SDK serializes atLeast/exact row heights in twips. Automatic
    // heights carry no source minimum. SharePoint cell heights remain minima
    // so source content and future edits can expand without clipping.
    const minima=(node.content??[]).map(row=>{
      const height=row.trPr?.trHeight;
      return height&&['atLeast','exact'].includes(height.hRule)&&Number.isFinite(height.val)&&height.val>0?height.val/20:null;
    });
    if(minima.some(value=>value!==null))rowMinimumPt=minima;
  }
  if(!widths.length||widths.length>9999||widths.some(width=>!Number.isFinite(width)||width<=0)||
    rowMinimumPt?.some(height=>height!==null&&(!Number.isFinite(height)||height<=0)))return null;
  const total=widths.reduce((sum,width)=>sum+width,0);if(!Number.isFinite(total))return null;
  // Canvas accepts positive percentages with four decimal places. Assign the
  // rounding remainder to the final column so the whole grid remains 100%.
  let used=0;
  const units=widths.map((width,index)=>{const value=index===widths.length-1?1000000-used:Math.round(width/total*1000000);used+=value;return value;});
  if(units.some(value=>value<=0||value>1000000))return null;
  return {source,columnPercentages:units.map(value=>value/10000),...(rowMinimumPt?{rowMinimumPt}:{})};
}
