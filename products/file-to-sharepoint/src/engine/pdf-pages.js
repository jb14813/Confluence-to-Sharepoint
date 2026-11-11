// The native converter emits one Word section per source PDF page
// (CPage::Record/WriteSectionToFile). No drawing or paint order is inferred.
export function planPdfPageAssociation(document,pages){
  if(document?.type!=='document'||!Array.isArray(document.content)||!Array.isArray(pages)||!pages.length)return null;
  if(document.content.some(node=>!node||typeof node!=='object'||Array.isArray(node)))return null;
  const boundaries=document.content.filter(node=>node.pPr?.sectPr);
  if(boundaries.length+1!==pages.length||boundaries.some(node=>node.type!=='paragraph'||node.pPr.sectPr.type!=='nextPage'))return null;
  const sections=[...boundaries.map(node=>node.pPr.sectPr),document.sectPr];
  for(let i=0;i<pages.length;i++){
    const source=pages[i],section=sections[i]?.pgSz,dpi=source?.Dpi??72;
    if(![source?.W,source?.H,dpi,section?.w,section?.h].every(n=>Number.isFinite(n)&&n>0))return null;
    // Reader dimensions are rounded source pixels; sections use integral
    // twips. Permit only these existing native quantization boundaries.
    const tolerance=72/dpi+1/20;
    if(Math.abs(source.W*72/dpi-section.w/20)>tolerance||Math.abs(source.H*72/dpi-section.h/20)>tolerance)return null;
  }
  const association=new WeakMap();let pageIndex=0;
  for(const node of document.content){association.set(node,pageIndex);if(node.pPr?.sectPr)pageIndex++;}
  return association;
}
