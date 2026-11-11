// Match intact editable units to the existing native PDF reader's ordered
// Unicode scalars. Reading order comes only from these verified intervals.
export function matchPdfTextUnits({source,units,meaningfulText,maxMatchAttempts=4000000}){
  const refuse=(code,details={})=>({ok:false,code,...details});
  if(typeof meaningfulText!=='function'||!Array.isArray(units)||!source||source.rotation!==0||
    ![source.widthPt,source.heightPt].every(n=>Number.isFinite(n)&&n>0)||
    !Array.isArray(source.unicodeScalars)||!Array.isArray(source.scalarBoxesPt)||
    source.unicodeScalars.length!==source.scalarBoxesPt.length)return refuse('unproved-coordinates');
  const finiteBox=box=>Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)&&box[0]<=box[2]&&box[1]<=box[3];
  if(source.scalarBoxesPt.some(box=>!finiteBox(box)))return refuse('unproved-coordinates');
  const overlaps=(a,b)=>Math.max(a[0],b[0])<Math.min(a[2],b[2])&&Math.max(a[1],b[1])<Math.min(a[3],b[3]);
  const chars=source.unicodeScalars,identifiers=new Set(),candidates=[],resolved=new Map(),covered=new Uint8Array(chars.length);
  let attempts=0,candidateCount=0,total=0;
  for(const [unitIndex,unit]of units.entries()){
    if(typeof unit?.id!=='string'||identifiers.has(unit.id)||typeof unit.text!=='string'||
      unit.pageIndex!==undefined&&unit.pageIndex!==source.pageIndex)return refuse('invalid-unit',{unitIndex});
    identifiers.add(unit.id);
    const text=Array.from(meaningfulText(unit.text),c=>c.codePointAt(0));total+=text.length;
    if(!text.length)return refuse('invalid-unit',{unitIndex});
    if(unit.sourceBoxPt!==undefined&&!finiteBox(unit.sourceBoxPt))return refuse('unproved-coordinates',{unitIndex});
    const spans=[];
    for(let start=0;start<=chars.length-text.length;start++){
      if(++attempts>maxMatchAttempts)return refuse('coverage-limit',{unitIndex});
      let matches=true;
      for(let offset=0;offset<text.length;offset++){
        if(++attempts>maxMatchAttempts)return refuse('coverage-limit',{unitIndex});
        if(chars[start+offset]!==text[offset]){matches=false;break;}
      }
      if(matches){if(++candidateCount>65536)return refuse('coverage-limit',{unitIndex});spans.push({start,end:start+text.length});}
    }
    if(!spans.length)return refuse('no-contiguous-source-span',{unitIndex});
    candidates.push(spans);
  }
  if(total!==chars.length)return refuse('incomplete-coverage');
  let exhausted=false;
  const unclaimed=span=>{for(let i=span.start;i<span.end;i++){if(++attempts>maxMatchAttempts){exhausted=true;return false;}if(covered[i])return false;}return true;};
  // Exact disjoint text coverage proves identity before geometry is needed.
  // A selected Word font can change a native PDF glyph's reconstructed width;
  // it cannot change a unique complete Unicode interval into a different one.
  for(const useGeometry of [false,true]){
    let changed=true;
    while(changed){
      changed=false;
      for(let index=0;index<units.length;index++){
        if(resolved.has(index))continue;
        candidates[index]=candidates[index].filter(unclaimed);
        if(exhausted)return refuse('coverage-limit',{unitIndex:index});
        if(useGeometry&&candidates[index].length>1&&units[index].sourceBoxPt){
          candidates[index]=candidates[index].filter(span=>{
            for(let i=span.start;i<span.end;i++){
              if(++attempts>maxMatchAttempts){exhausted=true;return false;}
              if(!overlaps(source.scalarBoxesPt[i],units[index].sourceBoxPt))return false;
            }
            return true;
          });
        }
        if(exhausted)return refuse('coverage-limit',{unitIndex:index});
        if(!candidates[index].length)return refuse('overlapping-source-spans',{unitIndex:index});
        if(candidates[index].length!==1)continue;
        const span=candidates[index][0];resolved.set(index,span);
        for(let i=span.start;i<span.end;i++){if(++attempts>maxMatchAttempts)return refuse('coverage-limit',{unitIndex:index});covered[i]=1;}
        changed=true;
      }
    }
  }
  if(resolved.size!==units.length)return refuse('ambiguous-coverage');
  if(covered.some(n=>n!==1))return refuse('incomplete-coverage');
  const assignments=units.map((unit,index)=>({id:unit.id,...resolved.get(index)}));
  return {ok:true,assignments,orderedIds:assignments.slice().sort((a,b)=>a.start-b.start).map(a=>a.id)};
}
