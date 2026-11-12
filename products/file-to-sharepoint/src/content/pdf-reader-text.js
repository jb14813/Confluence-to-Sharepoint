import {assessPdfModelText,meaningfulPdfText} from '../engine/pdf-text.js';

// Adapt the existing reader's complete text output, never PDF bytes or inferred
// geometry. Use this only after drawing/page binding has succeeded.
export function planReaderTextPage({nodes,sourceText,drawings}){
 if(!Array.isArray(nodes)||typeof sourceText!=='string'||sourceText.length>2097152||!Array.isArray(drawings))return null;
 let visited=0;
 const known=new Set(['paragraph','run','endRun','docContent','paraDrawing','hyperlink','br','break','tab']);
 const walk=(roots,visit)=>{
  const stack=[roots],seen=new WeakSet();
  while(stack.length){
   if(++visited>1000000)throw Error('Reader text adaptation limit');
   const node=stack.pop();if(node==null||typeof node==='string')continue;
   if(typeof node!=='object'||seen.has(node))throw Error('Invalid reader text tree');seen.add(node);
   if(Array.isArray(node)){for(let i=node.length-1;i>=0;i--)stack.push(node[i]);continue;}
   if(!known.has(node.type))throw Error('Retain the existing unsupported-content path');
   visit(node);if(node.type==='paraDrawing')stack.push(node.graphic?.content);else stack.push(node.content);
  }
 };
 const textOf=root=>{
  const stack=[root],parts=[];let length=0;
  while(stack.length){
   if(++visited>1000000)throw Error('Reader text adaptation limit');
   const node=stack.pop();if(typeof node==='string'){if((length+=node.length)>2097152)throw Error('Reader text limit');parts.push(node);continue;}
   if(!node||typeof node!=='object')continue;
   if(Array.isArray(node)){for(let i=node.length-1;i>=0;i--)stack.push(node[i]);continue;}
   if(node.type==='br'||node.type==='break'){parts.push('\n');continue;}
   if(node.type==='tab'){parts.push('\t');continue;}
   if(node.type==='paragraph')stack.push('\n');
   stack.push(node.type==='paraDrawing'?node.graphic?.content:node.content);
  }
  return parts.join('');
 };
 const normalize=value=>value.replace(/\s+/gu,' ').trim();
 try{
  const links=new Set(),candidates=new Map();
  walk(nodes,node=>{
   if(node.type==='hyperlink')links.add(node);
   if(node.type!=='paragraph')return;
   let containsDrawing=false;walk(node.content,child=>{if(child.type==='paraDrawing')containsDrawing=true;});
   if(containsDrawing)return;
   const key=normalize(textOf(node));if(key)candidates.set(key,candidates.has(key)?null:node);
  });
  const coverage=assessPdfModelText({pages:[{text:sourceText}]},{content:nodes});
  if(coverage.missingCharacters||coverage.extraCharacters||coverage.physicalSequenceMatches||!meaningfulPdfText(sourceText))return null;
  const paragraphs=sourceText.split(/\r?\n[\t ]*\r?\n/u).filter(value=>normalize(value));
  if(!paragraphs.length||paragraphs.length>100000)return null;
  let retainedStyledParagraphs=0;const retainedLinks=new Set();
  const textNodes=paragraphs.map(value=>{
   const original=candidates.get(normalize(value));
   if(original){retainedStyledParagraphs++;walk(original,node=>{if(node.type==='hyperlink')retainedLinks.add(node);});return original;}
   return{type:'paragraph',content:[{type:'run',content:[value]}]};
  });
  // Existing links and native tables must not disappear as a side effect of
  // readable-text recovery. A page we cannot retain stays on its original path.
  if(links.size!==retainedLinks.size||[...links].some(link=>!retainedLinks.has(link)))return null;
  const figures=[],replacedTextWrappers=[],sourceTextWrappers=[];let orientationAdapted=false;
  for(const entry of drawings){
   const transform=entry.node?.graphic?.spPr?.xfrm;
   if(transform&&(transform.rot!=null&&!Number.isFinite(transform.rot)||[transform.flipH,transform.flipV].some(value=>value!=null&&typeof value!=='boolean')))return null;
   if(entry.drawing.role==='editable-text-wrapper'){
    replacedTextWrappers.push(entry.graphicId);
    sourceTextWrappers.push({sourceId:entry.graphicId,docPrId:entry.docPrId??entry.node.docPr?.id,...(entry.drawing.bounds?{bounds:structuredClone(entry.drawing.bounds)}:{}),rotation:entry.drawing.rotation??0,flipH:entry.drawing.flipH??false,flipV:entry.drawing.flipV??false});
    orientationAdapted||=!!(transform?.rot||transform?.flipH||transform?.flipV);continue;
   }
   if(entry.root?.type!=='paragraph'||!nodes.includes(entry.root))return null;
   const run=entry.root.content?.find(run=>['run','endRun'].includes(run.type)&&run.content?.includes(entry.node));
   if(!run)return null;
   figures.push({...entry.root,content:[{...run,content:[entry.node]}]});
  }
  return{nodes:[...figures,...textNodes],replacedTextWrappers,sourceTextWrappers,orientationAdapted,retainedStyledParagraphs,paragraphs:paragraphs.length,sourceCharacters:coverage.sourceCharacters};
 }catch{return null;}
}
