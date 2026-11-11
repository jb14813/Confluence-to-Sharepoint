import {bindPdfDrawings,bindPdfDrawingLines} from './pdf-drawing-bindings.js';
import {planPdfPageAssociation} from '../engine/pdf-pages.js';

// Native SharePoint cannot retain arbitrary PDF overlays. Reuse the converter's
// document order and ordinary page parts, while retaining complete source binds.
export function planPdfNativeReflow(document,options){
  const bound=bindPdfDrawings(options.pdfDrawings,document,options);
  const association=planPdfPageAssociation(document,options.pages);
  if(!association)throw Object.assign(new Error('The PDF source pages could not be verified.'),{code:'PDF_DRAWINGS_UNVERIFIED'});
  const pages=options.pages.map((_,pageIndex)=>({pageIndex,nodes:[]})),nodeMetadata=new WeakMap();
  for(const node of document.content){
    const pageIndex=association.get(node);
    if(!Number.isInteger(pageIndex)||!pages[pageIndex])throw Object.assign(new Error('The PDF source pages could not be verified.'),{code:'PDF_DRAWINGS_UNVERIFIED'});
    pages[pageIndex].nodes.push(node);nodeMetadata.set(node,{pageIndex});
  }
  return {ok:true,pages,nodeMetadata,drawings:bound.byGraphicId};
}

export function verifyPdfNativeReflowDrawings(plan,rendered){
  const fail=()=>{throw Object.assign(new Error('Some PDF graphics were not retained in the editable page.'),{code:'PDF_DRAWINGS_UNVERIFIED'});};
  if(!(plan?.drawings instanceof Map)||!Array.isArray(rendered)||rendered.length!==plan.drawings.size)fail();
  const seen=new Set();
  for(const drawing of rendered){
    const expected=plan.drawings.get(drawing?.sourceId);
    if(!expected||seen.has(drawing.sourceId)||drawing.pageIndex!==expected.pageIndex||
      expected.drawing.role!=='editable-text-wrapper'&&!/^[a-f0-9]{64}$/.test(drawing.assetId??''))fail();
    seen.add(drawing.sourceId);
  }
  return true;
}

const CODE='PDF_DRAWING_FLOW_UNVERIFIED',MAX_CHECKS=8000000;
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const fail=(reason,details={})=>{throw Object.assign(new Error('The PDF drawing placement could not be verified.'),{code:CODE,reason,...details});};
const intersects=(a,b)=>Math.max(a[0],b[0])<Math.min(a[2],b[2])&&Math.max(a[1],b[1])<Math.min(a[3],b[3]);
const box=value=>[value.leftPt,value.topPt,value.rightPt,value.bottomPt];

/** Resolve only source-proven figure constraints against the existing intact
 * text-unit plan. This is neither a text-order detector nor a compositor.
 * Under-text surfaces remain explicit requirements and never a scene prefix.
 * Any refused figure invalidates the whole returned placement plan.
 */
export function planPdfDrawingFlow(document,{pages,pdfText,nativeTables,pdfDrawings,textPlan,verifiedAliases}={}){
  try{
    const context={pages,pdfText,nativeTables,verifiedAliases},drawings=bindPdfDrawings(pdfDrawings,document,context),lines=bindPdfDrawingLines(pdfDrawings,context);
    if(textPlan?.ok!==true||!Array.isArray(textPlan.pages)||textPlan.pages.length!==pages.length||
      !(textPlan.nodeMetadata instanceof WeakMap)||!Array.isArray(textPlan.assignments)||textPlan.assignments.length>65536||
      !Array.isArray(textPlan.tableProof)||textPlan.tableProof.length!==nativeTables.tables.length)fail('invalid-text-plan');
    let checks=0;const check=()=>{if(++checks>MAX_CHECKS)fail('coverage-limit');};
    const indexMaps=pdfText.order.pages.map(source=>({canonicalToOriginal:Array.from({length:source.unicodeScalars.length},(_,index)=>index),originalToCanonical:Array(source.unicodeScalars.length),tableRanges:new Uint8Array(source.unicodeScalars.length)}));
    for(const [ordinal,proof]of textPlan.tableProof.entries()){
      const native=nativeTables.tables[ordinal],source=pdfText.order.pages[native.pageIndex],map=indexMaps[native.pageIndex],n=source.unicodeScalars.length;
      if(proof?.ordinal!==ordinal||proof.pageIndex!==native.pageIndex||!integer(proof.start,0,n)||!integer(proof.end,proof.start+1,n)||
        !Array.isArray(proof.sourceIndices)||proof.sourceIndices.length!==proof.end-proof.start||!Array.isArray(proof.cells)||proof.cells.length!==native.cells.length)fail('invalid-text-plan');
      const claimed=new Set();let position=0;
      for(const [index,cell]of proof.cells.entries()){
        const expected=native.cells[index];if(cell.row!==expected.row||cell.column!==expected.column||!Array.isArray(cell.sourceIndices)||cell.sourceIndices.length>n)fail('invalid-text-plan');
        let previous=-1;
        for(const original of cell.sourceIndices){
          check();if(!integer(original,proof.start,proof.end-1)||original<=previous||claimed.has(original)||proof.sourceIndices[position++]!==original)fail('invalid-text-plan');
          previous=original;claimed.add(original);
        }
      }
      if(claimed.size!==proof.sourceIndices.length)fail('invalid-text-plan');
      for(const [offset,original]of proof.sourceIndices.entries()){
        check();const canonical=proof.start+offset;if(map.tableRanges[canonical])fail('invalid-text-plan');map.tableRanges[canonical]=1;map.canonicalToOriginal[canonical]=original;
      }
    }
    for(const map of indexMaps)for(const [canonical,original]of map.canonicalToOriginal.entries()){
      check();if(map.originalToCanonical[original]!==undefined)fail('invalid-text-plan');map.originalToCanonical[original]=canonical;
    }
    const bySpan=new Map(),identifiers=new Set();
    for(const assignment of textPlan.assignments){
      if(typeof assignment?.id!=='string'||!assignment.id||assignment.id.length>256||identifiers.has(assignment.id)||!integer(assignment.pageIndex,0,pages.length-1))fail('invalid-text-plan');
      const n=indexMaps[assignment.pageIndex].canonicalToOriginal.length;
      if(!integer(assignment.start,0,n)||!integer(assignment.end,assignment.start+1,n))fail('invalid-text-plan');
      const key=`${assignment.pageIndex}:${assignment.start}:${assignment.end}`;if(bySpan.has(key))fail('invalid-text-plan');
      identifiers.add(assignment.id);bySpan.set(key,assignment);
    }
    const unitPages=[],used=new Set(),seenNodes=new WeakSet(),sdkTables=document.content.filter(node=>node.type==='table');let nodeCount=0;
    for(const [pageIndex,page]of textPlan.pages.entries()){
      if(page?.pageIndex!==pageIndex||!Array.isArray(page.nodes)||page.nodes.length>500000)fail('invalid-text-plan');
      const units=[],owners=Array(indexMaps[pageIndex].canonicalToOriginal.length);let cursor=0;
      for(const node of page.nodes){
        if(++nodeCount>500000||!node||typeof node!=='object'||seenNodes.has(node))fail('invalid-text-plan');seenNodes.add(node);
        const metadata=textPlan.nodeMetadata.get(node);if(metadata?.pageIndex!==pageIndex)fail('invalid-text-plan');
        if(metadata.start===undefined&&metadata.end===undefined)continue;
        const assignment=bySpan.get(`${pageIndex}:${metadata.start}:${metadata.end}`);
        if(!assignment||used.has(assignment.id)||metadata.start!==cursor||!['paragraph','table'].includes(node.type))fail('invalid-text-plan');
        if(node.type==='table'?(!integer(metadata.tableOrdinal,0,sdkTables.length-1)||sdkTables[metadata.tableOrdinal]!==node):metadata.tableOrdinal!==undefined)fail('invalid-text-plan');
        const unit={...assignment,node};units.push(unit);used.add(unit.id);cursor=unit.end;
        for(let index=unit.start;index<unit.end;index++){check();if(owners[index])fail('invalid-text-plan');owners[index]=unit;}
      }
      if(cursor!==owners.length||owners.some(owner=>!owner))fail('invalid-text-plan');unitPages.push({units,owners});
    }
    if(used.size!==textPlan.assignments.length)fail('invalid-text-plan');
    const result=[];let surfaces=0;
    for(const page of drawings.pages){
      const source=pdfText.order.pages[page.pageIndex],linePage=lines.pages[page.pageIndex],map=indexMaps[page.pageIndex],{units,owners}=unitPages[page.pageIndex],placements=[],surfaceRequirements=[],cellImages=[],cellFigures=[];
      const canonicalExtent=entry=>{
        let start=Infinity,end=-Infinity;
        for(const original of entry.sourceIndices){check();const canonical=map.originalToCanonical[original];start=Math.min(start,canonical);end=Math.max(end,canonical+1);}
        return {start,end};
      };
      for(const entry of page.drawings){
        const drawing=entry.drawing,details={pageIndex:page.pageIndex,docPrId:entry.docPrId};
        if(drawing.role==='editable-text-wrapper')continue;
        if(drawing.role==='cell-image'){cellImages.push(entry);continue;}
        if(drawing.role==='cell-figure'){cellFigures.push(entry);continue;}
        if(drawing.role==='under-text'){
          surfaceRequirements.push({...entry,lineOrdinals:drawing.lineOverlaps.slice(),lineBindings:drawing.lineOverlaps.map(ordinal=>linePage.byOrdinal.get(ordinal))});surfaces++;continue;
        }
        if(drawing.role!=='figure')fail('unproved-figure-role',details);
        const bounds=box(drawing.bounds);
        for(const table of nativeTables.tables){
          if(table.pageIndex!==page.pageIndex)continue;
          for(const cell of table.cells){check();if(intersects(bounds,box(cell)))fail('unproved-cell-owner',details);}
        }
        let aboveAll=true,belowAll=true;
        for(const glyph of source.scalarBoxesPt){
          check();if(intersects(bounds,glyph))fail('figure-intersects-source-text',details);
          if(bounds[3]>glyph[1])aboveAll=false;if(bounds[1]<glyph[3])belowAll=false;
        }
        let boundary,beforeUnitId=null,afterUnitId=null,sourceInterval,canonicalInterval,sourceLines=null,rule;
        if(drawing.gap){
          const previous=linePage.byOrdinal.get(drawing.gap.beforeLine),following=linePage.byOrdinal.get(drawing.gap.afterLine);
          if(!previous?.sourceIndices.length||!following?.sourceIndices.length)fail('unproved-figure-interval',details);
          sourceInterval={start:previous.end,end:following.start};
          if(sourceInterval.start>sourceInterval.end)fail('reversed-figure-constraints',details);
          const previousExtent=canonicalExtent(previous),followingExtent=canonicalExtent(following);
          // Scalar occurrences, rather than native line order, define these
          // endpoints. Complete verified table permutations are explicit.
          canonicalInterval={start:previousExtent.end,end:followingExtent.start};
          if(canonicalInterval.start>canonicalInterval.end)fail('reversed-figure-constraints',details);
          const previousUnit=owners[canonicalInterval.start-1],followingUnit=owners[canonicalInterval.end];
          if(!previousUnit||!followingUnit)fail('unproved-figure-interval',details);
          boundary=followingUnit.start;
          if(previousUnit===followingUnit||boundary<canonicalInterval.start||boundary>canonicalInterval.end)fail('inside-text-unit',details);
          beforeUnitId=followingUnit.id;afterUnitId=previousUnit.id;sourceLines={before:previous.line.ordinal,after:following.line.ordinal};rule='before-following-unit';
        }else if(!source.unicodeScalars.length){boundary=0;sourceInterval=canonicalInterval={start:0,end:0};rule='text-free-page';}
        else if(aboveAll){boundary=0;beforeUnitId=units[0]?.id??null;sourceInterval=canonicalInterval={start:0,end:0};rule='before-all-text';}
        else if(belowAll){boundary=source.unicodeScalars.length;afterUnitId=units.at(-1)?.id??null;sourceInterval=canonicalInterval={start:boundary,end:boundary};rule='after-all-text';}
        else fail('unproved-figure-interval',details);
        placements.push({docPrId:entry.docPrId,graphicId:entry.graphicId,node:entry.node,beforeUnitId,afterUnitId,boundary,sourceInterval,canonicalInterval,sourceLines,rule});
      }
      result.push({pageIndex:page.pageIndex,indices:{canonicalToOriginal:map.canonicalToOriginal,originalToCanonical:map.originalToCanonical},placements,surfaceRequirements,cellImages,cellFigures});
    }
    return {ok:true,pages:result,placementComplete:surfaces===0,requiresSurfaceComposition:surfaces>0};
  }catch(error){return {ok:false,code:CODE,reason:error?.code===CODE?error.reason:'invalid-drawing-contract',message:'The PDF drawing placement could not be verified.',...(error?.code===CODE&&error.pageIndex!==undefined?{pageIndex:error.pageIndex}:{}),...(error?.code===CODE&&error.docPrId!==undefined?{docPrId:error.docPrId}:{})};}
}

/** Assemble only the complete source-proven responsive flow. Figure wrappers
 * retain their native run/drawing objects; text and whole tables stay intact.
 * Backgrounds require a separate editable surface and never become a prefix.
 */
export function composePdfDrawingFlow(document,options={}){
  const flow=planPdfDrawingFlow(document,options);
  if(!flow.ok)return flow;
  if(flow.requiresSurfaceComposition)return {ok:false,code:'PDF_DRAWING_SURFACE_REQUIRED',reason:'under-text-surface-required'};
  const refuse=()=>({ok:false,code:CODE,reason:'unproved-figure-wrapper'}),{textPlan}=options;
  const wrappers=new Map();
  for(const root of document.content){
    if(root.type!=='paragraph'||root.pPr?.sectPr)continue;
    for(const run of root.content??[]){
      if(!['run','endRun'].includes(run?.type)||!Array.isArray(run.content))continue;
      for(const node of run.content)if(node?.type==='paraDrawing')wrappers.set(node,{root,run});
    }
  }
  const pages=[],nodeMetadata=new WeakMap(),proof=[];
  for(const page of flow.pages){
    const original=textPlan.pages[page.pageIndex],units=original.nodes.filter(node=>textPlan.nodeMetadata.get(node)?.start!==undefined);
    const boundaries=new Map();
    for(const placement of page.placements){
      const wrapper=wrappers.get(placement.node);if(!wrapper)return refuse();
      const node={...wrapper.root,content:[{...wrapper.run,content:[placement.node]}]};
      nodeMetadata.set(node,{pageIndex:page.pageIndex,drawingDocPrId:placement.docPrId,sourceBoundary:placement.boundary});
      if(!boundaries.has(placement.boundary))boundaries.set(placement.boundary,[]);
      boundaries.get(placement.boundary).push(node);
    }
    const nodes=[];
    for(const unit of units){
      const metadata=textPlan.nodeMetadata.get(unit);
      if(boundaries.has(metadata.start)){nodes.push(...boundaries.get(metadata.start));boundaries.delete(metadata.start);}
      nodes.push(unit);nodeMetadata.set(unit,metadata);
    }
    const end=units.length?textPlan.nodeMetadata.get(units.at(-1)).end:0;
    if(boundaries.has(end)){nodes.push(...boundaries.get(end));boundaries.delete(end);}
    if(boundaries.size)return refuse();
    pages.push({pageIndex:page.pageIndex,nodes});
    proof.push({pageIndex:page.pageIndex,figures:page.placements.map(({docPrId,graphicId,boundary,rule})=>({docPrId,graphicId,boundary,rule})),cellImages:page.cellImages.map(({docPrId})=>docPrId),cellFigures:page.cellFigures.map(({docPrId})=>docPrId)});
  }
  return {...textPlan,pages,nodeMetadata,drawingProof:proof};
}
