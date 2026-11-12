import {pdfDrawingAliasName,assertPdfDrawingAliasProof} from '../engine/pdf-drawing-aliases.js';
import {validatePdfDrawings} from '../engine/pdf-drawings.js';
import {planPdfPageAssociation} from '../engine/pdf-pages.js';
import {hasCellContent,planWordTable} from './table-grid.js';
import {matchPdfTextUnits} from './pdf-text-order.js';
import {meaningfulPdfText} from '../engine/pdf-text.js';

const fail=()=>{throw Object.assign(new Error('The PDF drawing sources could not be verified. No content was imported.'),{code:'PDF_DRAWINGS_UNVERIFIED'});};
// Native positive unsigned conversion truncates; subtraction of original
// double coordinates can lose one EMU only at an exact integer boundary.
const derivedExtent=(actual,ideal)=>actual===Math.floor(ideal)||Number.isInteger(ideal)&&actual===ideal-1;

/** Bind only stable native docPr IDs and the existing section/table topology.
 * Runtime graphic IDs are an output lookup key after identity is established;
 * they are never interpreted as source IDs, paint order or geometric anchors.
 */
export function bindPdfDrawings(value,document,{pages,nativeTables,pdfText,verifiedAliases}={}){
  try{
    validatePdfDrawings(value,{pages,nativeTables,pdfText});
    if(verifiedAliases!==undefined)assertPdfDrawingAliasProof(verifiedAliases,value,document);
    const association=planPdfPageAssociation(document,pages);if(!association)fail();
    if(document.content.some(node=>!['paragraph','table'].includes(node.type)))fail();
    const sdkTables=document.content.filter(node=>node.type==='table');
    if(sdkTables.length!==nativeTables.tables.length)fail();
    const tableCells=new WeakMap(),knownTables=new WeakSet();
    for(const [ordinal,table]of sdkTables.entries()){
      const expected=nativeTables.tables[ordinal],grid=planWordTable(table),anchors=grid.rows.flatMap(row=>row.emitted);
      if(association.get(table)!==expected.pageIndex||grid.columns!==expected.columns||grid.rows.length!==expected.rows||
        anchors.some(cell=>cell.gap)||anchors.length!==expected.cells.length)fail();
      knownTables.add(table);
      for(const [index,cell]of anchors.entries()){
        const source=expected.cells[index];
        if(cell.rowIndex!==source.row||cell.startCol!==source.column||cell.rowSpan!==source.rowSpan||cell.colSpan!==source.columnSpan||
          cell.continuations.some(item=>hasCellContent(item.cell.content)))fail();
        const owner={tableOrdinal:ordinal,row:source.row,column:source.column};tableCells.set(cell.cell,owner);
        for(const continuation of cell.continuations)tableCells.set(continuation.cell,owner);
      }
    }
    const expected=new Map(),byDocPrId=new Map(),byGraphicId=new Map(),boundPages=value.pages.map(page=>({pageIndex:page.pageIndex,drawings:[]}));
    for(const page of value.pages)for(const drawing of page.drawings)expected.set(drawing.docPrId,{page,drawing});
    const stack=document.content.map(root=>({node:root,root,pageIndex:association.get(root),cellOwner:null})).reverse(),seen=new WeakSet();let visited=0;
    while(stack.length){
      if(++visited>500000)fail();const current=stack.pop(),{node,root,pageIndex}=current;
      if(node==null||typeof node==='string')continue;
      if(typeof node!=='object'||seen.has(node))fail();seen.add(node);
      if(Array.isArray(node)){for(let index=node.length-1;index>=0;index--)stack.push({...current,node:node[index]});continue;}
      let cellOwner=current.cellOwner;
      if(node.type==='table'&&!knownTables.has(node))fail();
      if(node.type==='tblCell'){cellOwner=tableCells.get(node);if(!cellOwner)fail();}
      if(node.type==='paraDrawing'){
        const docPrId=node.docPr?.id,graphic=node.graphic,source=expected.get(docPrId),graphicId=graphic?.id;
        if(!Number.isSafeInteger(docPrId)||docPrId<1||!source||byDocPrId.has(docPrId)||typeof graphicId!=='string'||!graphicId||graphicId.length>256||byGraphicId.has(graphicId)||source.page.pageIndex!==pageIndex)fail();
        const {drawing,page}=source;
        if(['image','derived-vector'].includes(drawing.kind)?graphic.type!=='image':graphic.type!=='shape')fail();
        if(drawing.kind==='derived-vector'){
          const rep=drawing.representation,xfrm=graphic.spPr?.xfrm,extent=xfrm?.ext,crop=graphic.blipFill?.srcRect;
          // Retain canonical source identity; a runtime name needs a byte-verified
          // proof tied to this exact ledger/model and stable docPr identity.
          // Runtime extX/extY may be zero until layout; serialized xfrm and
          // paraDrawing extents retain the real native codec values.
          // The anchor subtracts world coordinates; the picture uses its own
          // width/height. Verify each independently against the exact native
          // truncation boundary rather than requiring identical rounding.
          if(graphic.blipFill?.rasterImageId!==(verifiedAliases===undefined?`image${drawing.imageId}.png`:pdfDrawingAliasName(verifiedAliases,value,document,docPrId))||!crop||Object.keys(crop).length!==4||crop.l!==0||crop.t!==0||crop.r!==100||crop.b!==100||
            !extent||!node.extent||!['cx','cy'].every((key,index)=>[extent[key],node.extent[key]].every(actual=>Number.isSafeInteger(actual)&&actual>0&&
              derivedExtent(actual,rep[index?'pixelHeight':'pixelWidth']*914400/rep.dpi)))||
            xfrm.rot!=null&&xfrm.rot!==0||xfrm.flipH!=null&&xfrm.flipH!==false||xfrm.flipV!=null&&xfrm.flipV!==false)fail();
        }
        const sources=drawing.sourceIds.map(id=>page.sourcePaints[id-1]);
        if(drawing.role==='cell-image'||drawing.role==='cell-figure'){
          if(node.drawingType!=='inline'||!cellOwner||!sources.length||sources.some(source=>source.cellOwners.length!==1||
            source.cellOwners[0].tableOrdinal!==cellOwner.tableOrdinal||source.cellOwners[0].row!==cellOwner.row||source.cellOwners[0].column!==cellOwner.column))fail();
        }else if(cellOwner||node.drawingType!=='anchor')fail();
        if(drawing.role==='editable-text-wrapper'?(graphic.content?.type!=='docContent'||!Array.isArray(graphic.content.content)):graphic.content!=null)fail();
        const entry={docPrId,graphicId,pageIndex,drawing,sources,node,root,cellOwner:cellOwner??null};
        byDocPrId.set(docPrId,entry);byGraphicId.set(graphicId,entry);boundPages[pageIndex].drawings.push(entry);
        if(graphic.content!=null)stack.push({...current,node:graphic.content,cellOwner});
      }
      if(node.content!=null)stack.push({...current,node:node.content,cellOwner});
    }
    if(byDocPrId.size!==expected.size)fail();
    // The returned order follows the native ledger, never the traversal order
    // or the numerical value of an SDK runtime graphic ID.
    for(const page of boundPages)page.drawings=value.pages[page.pageIndex].drawings.map(drawing=>byDocPrId.get(drawing.docPrId));
    return {byGraphicId,byDocPrId,pages:boundPages};
  }catch{fail();}
}

/** Bind page-local formed lines to exact original Reader scalar occurrences.
 * Table permutations, destination units, paint order and authored list intent
 * are deliberately not inferred here. Empty lines have no scalar anchor.
 */
export function bindPdfDrawingLines(value,{pages,nativeTables,pdfText}={}){
  try{
    validatePdfDrawings(value,{pages,nativeTables,pdfText});
    const result=[];
    for(const page of value.pages){
      const units=page.lines.filter(line=>meaningfulPdfText(line.text)).map(line=>({
        id:`page-${page.pageIndex}-line-${line.ordinal}`,pageIndex:page.pageIndex,text:line.text,
        sourceBoxPt:[line.bounds.leftPt,line.bounds.topPt,line.bounds.rightPt,line.bounds.bottomPt],
      }));
      const source=pdfText.order.pages[page.pageIndex],matched=matchPdfTextUnits({source,units,meaningfulText:meaningfulPdfText});if(!matched.ok)fail();
      const assignments=new Map(matched.assignments.map(assignment=>[assignment.id,assignment])),covered=new Uint8Array(source.unicodeScalars.length),byOrdinal=new Map(),byId=new Map();
      for(const line of page.lines){
        const id=`page-${page.pageIndex}-line-${line.ordinal}`,assignment=assignments.get(id);
        if(!assignment){if(meaningfulPdfText(line.text))fail();byOrdinal.set(line.ordinal,{line,start:null,end:null,sourceIndices:[]});continue;}
        const sourceIndices=[];
        for(let index=assignment.start;index<assignment.end;index++){if(covered[index]!==0)fail();covered[index]=1;sourceIndices.push(index);}
        byOrdinal.set(line.ordinal,{line,start:assignment.start,end:assignment.end,sourceIndices});byId.set(id,line.ordinal);
      }
      if(covered.some(value=>value!==1))fail();
      result.push({pageIndex:page.pageIndex,byOrdinal,orderedOrdinals:matched.orderedIds.map(id=>byId.get(id))});
    }
    return {pages:result};
  }catch{fail();}
}
