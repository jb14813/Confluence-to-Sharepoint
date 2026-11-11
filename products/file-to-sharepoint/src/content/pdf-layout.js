import {meaningfulPdfText} from '../engine/pdf-text.js';
import {matchPdfTextUnits} from './pdf-text-order.js';
import {planPdfPageAssociation} from '../engine/pdf-pages.js';
import {planPdfTableOrder} from './pdf-table-order.js';
export {planPdfPageAssociation} from '../engine/pdf-pages.js';

function bodyText(value){
  const stack=[value],parts=[];let visited=0,length=0;
  while(stack.length){
    const node=stack.pop();if(++visited>500000)throw Error('PDF content limit');
    if(typeof node==='string'){if((length+=node.length)>131072)throw Error('PDF text limit');parts.push(node);continue;}
    if(Array.isArray(node)){for(let i=node.length-1;i>=0;i--)stack.push(node[i]);continue;}
    if(node&&typeof node==='object')stack.push(node.type==='paraDrawing'?node.graphic?.content:node.content);
  }
  return parts.join('');
}

function wrapperDrawings(node){
  if(node.type!=='paragraph'||node.pPr?.spacing?.lineRule!=='exact'||node.pPr.spacing.line!==1)return null;
  const drawings=[];
  for(const run of node.content??[]){
    if(!['run','endRun'].includes(run?.type))return null;
    for(const child of run.content??[]){
      if(child?.type==='paraDrawing')drawings.push({drawing:child,run});
      else if(typeof child!=='string'||meaningfulPdfText(child))return null;
    }
  }
  return drawings;
}

function sameSdkExtent(a,b){
  // The pinned SDK serializes both millimetre fields as (36000*n)>>0,
  // after independent integer-EMU conversions. Their floating round trips
  // can differ by one EMU (1/12700 pt); preserve only that codec boundary.
  return Number.isSafeInteger(a)&&a>0&&Number.isSafeInteger(b)&&b>0&&Math.abs(a-b)<=1;
}

/** Use only native word intervals and the pinned mode2 native writer geometry.
 * Synthetic wrapper nodes retain their original editable run/drawing objects.
 * Nontext drawings retain their native page and paint order as a separate scene.
 */
export function planPdfReadingOrder(document,{pages,pdfText,pdfLayout}={}){
  const refuse=code=>({ok:false,code});
  if(pdfLayout?.version!==1||pdfLayout.textAssociationType!==2||pdfLayout.flowGeometry!=='native-plain-line-v1'||
    pdfText?.order?.version!==1||pdfText.order.coordinateSpace!=='displayed-crop-top-left-pt')return refuse('native-order-contract-unverified');
  const association=planPdfPageAssociation(document,pages),originalSources=pdfText.order.pages;
  if(!association||!Array.isArray(originalSources)||originalSources.length!==pages.length)return refuse('unproved-page-association');
  const tablePlan=planPdfTableOrder(document,{nativeTables:pdfLayout.nativeTables,pages,sources:originalSources,pageAssociation:association});
  if(!tablePlan.ok)return refuse(tablePlan.code);
  const sources=tablePlan.sources;
  const sections=[...document.content.filter(n=>n.pPr?.sectPr).map(n=>n.pPr.sectPr),document.sectPr];
  const units=[],scenes=pages.map(()=>[]),chains=new Map(),nodeMetadata=new WeakMap();
  try{
    for(const [rootIndex,node]of document.content.entries()){
      const pageIndex=association.get(node),drawings=wrapperDrawings(node),spacing=node.pPr?.spacing;
      if(drawings){
        const nontext=[];
        for(const [drawingIndex,{drawing,run}]of drawings.entries()){
          const text=bodyText(drawing);
          if(!meaningfulPdfText(text)){nontext.push({...run,content:[drawing]});continue;}
          const h=drawing.positionH,v=drawing.positionV,ext=drawing.extent,xfrm=drawing.graphic?.spPr?.xfrm;
          if(drawing.drawingType!=='anchor'||h?.relativeFrom!=='page'||v?.relativeFrom!=='page'||h.percent||v.percent||drawing.simplePos?.use||
            ![h.posOffset,v.posOffset,ext?.cx,ext?.cy].every(Number.isFinite)||ext.cx<=0||ext.cy<=0||!xfrm||xfrm.rot||xfrm.flipH||xfrm.flipV||
            xfrm.chOffX!=null||xfrm.chOffY!=null||xfrm.chExtX!=null||xfrm.chExtY!=null||!sameSdkExtent(xfrm.ext?.cx,ext.cx)||!sameSdkExtent(xfrm.ext?.cy,ext.cy))return refuse('unproved-anchor-coordinates');
          const copy={...node,content:[{...run,content:[drawing]}]};
          units.push({id:`root-${rootIndex}-drawing-${drawingIndex}`,pageIndex,text,node:copy,sourceBoxPt:[h.posOffset/12700,v.posOffset/12700,(h.posOffset+ext.cx)/12700,(v.posOffset+ext.cy)/12700]});
        }
        if(nontext.length)scenes[pageIndex].push({...node,content:nontext});
        continue;
      }
      const previous=chains.get(pageIndex);let box=tablePlan.tables.get(node)?.sourceBoxPt;
      if(previous!==false){
        if(node.type!=='paragraph'||spacing?.lineRule!=='exact'||!Number.isSafeInteger(spacing.line)||spacing.line<=1||
          !Number.isSafeInteger(spacing.before)||spacing.before<0||spacing.after||!previous&&spacing.before===0)chains.set(pageIndex,false);
        else{
          // CPage mode2: before=top-prev.bot; first before=top-1.5mm.
          // Each line is one paragraph and line=bot-top. ToXml truncates to
          // twips; keep the complete quantization interval for every field.
          const correction=1.5*72/25.4,topMin=(previous?.botMin??correction)+spacing.before/20,topMax=(previous?.botMax??correction)+(spacing.before+1)/20;
          const botMin=topMin+spacing.line/20,botMax=topMax+(spacing.line+1)/20;
          chains.set(pageIndex,{botMin,botMax});box=[0,topMin,(sections[pageIndex].pgSz.w+1)/20,botMax];
        }
      }
      const text=bodyText(node);
      if(meaningfulPdfText(text))units.push({id:`root-${rootIndex}`,pageIndex,text,node,...(box?{sourceBoxPt:box}:{})});
      else scenes[pageIndex].push(node);
    }
  }catch{return refuse('coverage-limit');}
  const orderedPages=[],assignments=[];
  for(const [pageIndex,source]of sources.entries()){
    if(source?.pageIndex!==pageIndex)return refuse('unproved-page-association');
    const pageUnits=units.filter(unit=>unit.pageIndex===pageIndex),matched=matchPdfTextUnits({source,units:pageUnits,meaningfulText:meaningfulPdfText});
    if(!matched.ok)return refuse(matched.code);
    const byId=new Map(pageUnits.map(unit=>[unit.id,unit]));
    for(const assignment of matched.assignments){const unit=byId.get(assignment.id),table=tablePlan.tables.get(unit.node);nodeMetadata.set(unit.node,{pageIndex,start:assignment.start,end:assignment.end,...(table?{tableOrdinal:table.ordinal}:{})});assignments.push({pageIndex,...assignment});}
    const nodes=[...scenes[pageIndex],...matched.orderedIds.map(id=>byId.get(id).node)];
    for(const node of scenes[pageIndex])nodeMetadata.set(node,{pageIndex});
    orderedPages.push({pageIndex,nodes});
  }
  return {ok:true,pages:orderedPages,nodeMetadata,assignments,tableProof:tablePlan.proof,tableMetadata:tablePlan.tables};
}
