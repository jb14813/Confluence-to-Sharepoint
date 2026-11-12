const fail=()=>{throw Object.assign(new Error('The PDF links exceed the supported metadata limits or could not be verified.'),{code:'PDF_LINKS_UNVERIFIED'});};

// Consume the existing native reader's metadata; never execute PDF actions.
export function readPdfLinkAnnotations(readAnnotations,pages){
 const result={version:1,sourcePageCount:pages.length,links:[],linkCount:0,unsupportedCount:0};let annotations=0;
 const destinations=new Map(pages.map((page,index)=>[page.originIndex,index]));
 for(const [pageIndex,page]of pages.entries()){
  const entries=readAnnotations(page.originIndex);
  if(!Array.isArray(entries)||(annotations+=entries.length)>100000)fail();
  for(const entry of entries){
   if(entry?.type!==1)continue;
   let action=entry.A;const seen=new WeakSet();
   do{
    if(++result.linkCount>10000)fail();
    if(action!=null){
     if(typeof action!=='object'||Array.isArray(action)||seen.has(action))fail();
     seen.add(action);
    }
    if(action?.S===6&&typeof action.URI==='string'&&action.URI.length<=8192)result.links.push({pageIndex,kind:'uri',url:action.URI});
    else if(action?.S===1&&Number.isSafeInteger(action.page)&&destinations.has(action.page))result.links.push({pageIndex,kind:'page',targetPageIndex:destinations.get(action.page)});
    else result.unsupportedCount++;
    action=action?.Next;
   }while(action!=null);
  }
 }
 return result;
}
