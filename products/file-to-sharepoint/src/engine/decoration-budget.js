import {planPdfPageAssociation} from './pdf-pages.js';
import {hasImageViewTransform} from './image-views.js';
import {validatePdfConversionProfile} from './pdf-native-layout.js';

// This context is internal native-PDF output, never an ordinary DOCX option.
// The same plan is consumed before sandbox export and after its response.
export function planDecorationBudget(document,pdfContext){
  if(pdfContext===undefined)return {maxTotal:512,pageForId:null,perPage:512};
  const refuse=()=>{throw Object.assign(new Error('The PDF drawing source pages could not be verified.'),{code:'DECORATION_PAGE_UNVERIFIED'});};
  const layout=pdfContext?.pdfLayout,pages=pdfContext?.pages;
  try{validatePdfConversionProfile(layout);}catch{refuse();}
  const association=planPdfPageAssociation(document,pages);if(!association)refuse();
  const pageForId=new Map();let visited=0;
  function scan(start,visit){
    const stack=[start];
    while(stack.length){
      const value=stack.pop();if(!value||typeof value!=='object')continue;
      if(++visited>500000)refuse();
      if(value.type==='shape'&&value.content==null||hasImageViewTransform(value))visit(value.id);
      for(const child of Object.values(value))if(child&&typeof child==='object')stack.push(child);
    }
  }
  for(const node of document.content){
    const pageIndex=association.get(node);
    scan(node,id=>{
      if(typeof id!=='string'||!id||id.length>128||pageForId.has(id))refuse();
      pageForId.set(id,pageIndex);
    });
  }
  // Body source sections cannot assign a page to a drawing from headers,
  // styles or another non-body location. Do not expand that drawing's budget.
  scan({...document,content:undefined},()=>refuse());
  return {maxTotal:Math.min(4096,512*pages.length),pageForId,perPage:512};
}
