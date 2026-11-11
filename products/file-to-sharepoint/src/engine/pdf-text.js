const MAX_SCALARS=1048576,MAX_BYTES=4*1024*1024;
const space=/[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200B\u200E\u200F\u2028-\u202F\u205F\u2066-\u2069\u3000\uFEFF]/gu;
const fail=(message='The PDF source text could not be verified. No content was imported.',code='PDF_TEXT_UNVERIFIED')=>{throw Object.assign(new Error(message),{code});};
const integer=(n,max=MAX_SCALARS)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
const scalar=n=>integer(n,0x10ffff)&&!(n>=0xd800&&n<=0xdfff);
const decode=bytes=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail();}};

// This is exactly the native observer's layout-space predicate. In particular,
// ZWJ/ZWNJ, ligatures, case and mathematical characters remain unchanged.
export const meaningfulPdfText=value=>value.replace(space,'');

/** Field appearances are excluded natively. Only a genuinely empty authored
 * body can use a form-only page without claiming its field values as OCR. */
export const verifiedEmptyPdfBody=source=>source?.version===1&&Array.isArray(source.pages)&&source.pages.length>0&&source.pages.length<=4096&&source.pages.every((page,index)=>page?.pageIndex===index&&typeof page.text==='string'&&!meaningfulPdfText(page.text)&&page.meaningfulScalars===0&&page.bodyTextOps===0&&page.bodyImageOps===0&&page.bodyPathOps===0);

export function readPdfTextCapabilities(info,pageCount){
  if(info?.TextCapabilityVersion!==1||info.GraphicsCapabilityVersion!==1||info.TextScanComplete!==true||info.TextTruncated!==false||!integer(pageCount,4096)||!pageCount||info.TextPagesVisited!==pageCount||info.NumberOfPages!==undefined&&info.NumberOfPages!==pageCount)fail();
  const counts=['TextType3Glyphs','TextType3UnmappedGlyphs','TextInvalidScalars','TextActualTextSpans','TextSoftMaskedGlyphs','TextTransparencyGroupGlyphs','GraphicsTransparencyGroups','GraphicsSoftMasks','GraphicsTransparencyMaxDepth','GraphicsUnsupportedFeatures','GraphicsUnsupportedReasons'];
  if(counts.some(key=>!integer(info[key])))fail();
  const replay=info.TextActualTextCapabilityVersion!==undefined;
  if(replay&&(info.TextActualTextCapabilityVersion!==1||!integer(info.TextActualTextUnsupportedSpans)||info.TextActualTextUnsupportedSpans>info.TextActualTextSpans))fail();
  if(!replay&&info.TextActualTextUnsupportedSpans!==undefined)fail();
  if(info.TextType3UnmappedGlyphs||info.TextInvalidScalars||info.TextActualTextSpans&&(!replay||info.TextActualTextUnsupportedSpans)||info.TextSoftMaskedGlyphs||info.TextTransparencyGroupGlyphs)fail('Some source text in this PDF cannot yet be preserved safely. No content was imported.','PDF_TEXT_UNSUPPORTED');
  if(info.GraphicsUnsupportedFeatures||info.GraphicsUnsupportedReasons)fail('Some graphics in this PDF cannot yet be preserved safely. No content was imported.','PDF_GRAPHICS_UNSUPPORTED');
  const adaptive=info.GraphicsCaptureProfile==='page-source-density-bgra-v1';
  if(replay&&!adaptive||adaptive&&(info.GraphicsCaptureDpi!==96||info.GraphicsCaptureMaxPixels!==9437184||info.GraphicsCaptureMaxDimension!==4096||info.GraphicsCaptureMaxBytes!==134217728)||info.GraphicsCaptureProfile!==undefined&&!adaptive&&info.GraphicsCaptureProfile!=='page-96dpi-bgra-v1')fail();
  const encoded=info.TextUtf8Base64;
  if(typeof encoded!=='string'||encoded.length>Math.ceil(MAX_BYTES/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))fail();
  let raw;try{raw=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));}catch{fail();}
  if(raw.length>MAX_BYTES||!Array.isArray(info.TextPages)||info.TextPages.length!==pageCount)fail();
  let end=0,glyphs=0,unmapped=0,scalars=0;
  const pages=info.TextPages.map((page,pageIndex)=>{
    if(page?.pageIndex!==pageIndex||!integer(page.utf8Offset,MAX_BYTES)||!integer(page.utf8Length,MAX_BYTES)||page.utf8Offset<end||page.utf8Offset+page.utf8Length>raw.length||!integer(page.unicodeScalars)||!integer(page.meaningfulScalars)||page.meaningfulScalars>page.unicodeScalars||!integer(page.type3Glyphs)||!integer(page.type3UnmappedGlyphs))fail();
    if(meaningfulPdfText(decode(raw.subarray(end,page.utf8Offset))))fail();
    const text=decode(raw.subarray(page.utf8Offset,page.utf8Offset+page.utf8Length));
    if(Array.from(text).length!==page.unicodeScalars||Array.from(meaningfulPdfText(text)).length!==page.meaningfulScalars)fail();
    for(const key of ['bodyTextOps','bodyImageOps','bodyPathOps'])if(page[key]!==undefined&&!integer(page[key]))fail();
    if(replay&&!integer(page.bodyTextOps))fail();
    let capture;
    if(adaptive){
      const {captureRequired:required,captureDpi:dpi,captureWidthPx:width,captureHeightPx:height}=page;
      if(typeof required!=='boolean'||!Number.isFinite(dpi)||dpi<96||dpi>1000000||!integer(width,1000000000)||!integer(height,1000000000)||!!width!==!!height||required&&(!width||width>4096||height>4096||width*height>9437184))fail();
      capture={required,dpi,width,height};
    }
    end=page.utf8Offset+page.utf8Length;glyphs+=page.type3Glyphs;unmapped+=page.type3UnmappedGlyphs;scalars+=page.unicodeScalars;
    return {pageIndex,text,unicodeScalars:page.unicodeScalars,meaningfulScalars:page.meaningfulScalars,...(page.bodyTextOps!==undefined?{bodyTextOps:page.bodyTextOps}:{}),...(page.bodyImageOps!==undefined?{bodyImageOps:page.bodyImageOps}:{}),...(page.bodyPathOps!==undefined?{bodyPathOps:page.bodyPathOps}:{}),...(capture?{capture}:{})};
  });
  if(scalars>MAX_SCALARS||glyphs!==info.TextType3Glyphs||unmapped!==info.TextType3UnmappedGlyphs||meaningfulPdfText(decode(raw.subarray(end))))fail();
  const result={version:1,pages,order:null};
  if(info.TextOrderCapabilityVersion!==undefined){
    if(info.TextOrderCapabilityVersion!==1||info.TextOrderScanComplete!==true||info.TextOrderTruncated!==false||info.TextOrderCoordinateSpace!=='displayed-crop-top-left-pt'||!Array.isArray(info.TextOrderedPages)||info.TextOrderedPages.length!==pageCount)fail('The PDF reading order could not be verified. No content was imported.','PDF_ORDER_UNVERIFIED');
    let characters=0,words=0;
    for(const [index,page]of info.TextOrderedPages.entries()){
      if(page.pageIndex!==index||!Number.isFinite(page.widthPt)||page.widthPt<=0||!Number.isFinite(page.heightPt)||page.heightPt<=0||page.rotation!==0||!Array.isArray(page.unicodeScalars)||!Array.isArray(page.scalarBoxesPt)||!Array.isArray(page.wordStarts)||page.unicodeScalars.length!==page.scalarBoxesPt.length)fail();
      characters+=page.unicodeScalars.length;words+=page.wordStarts.length;
      if(characters>65536||words>16384||page.unicodeScalars.some(c=>!scalar(c)||!meaningfulPdfText(String.fromCodePoint(c)))||page.scalarBoxesPt.some(box=>!Array.isArray(box)||box.length!==4||box.some(n=>!Number.isFinite(n)||Math.abs(n)>10000000)||box[0]>box[2]||box[1]>box[3])||page.wordStarts.some((n,i)=>!integer(n,65536)||n>=page.unicodeScalars.length||i===0&&n!==0||i>0&&n<=page.wordStarts[i-1])||!!page.unicodeScalars.length!==!!page.wordStarts.length)fail();
      if(page.lineStarts!==undefined||page.paragraphStarts!==undefined){
        const validStarts=values=>Array.isArray(values)&&values.length<=page.wordStarts.length&&!!values.length===!!page.unicodeScalars.length&&values.every((n,i)=>integer(n,65536)&&n<page.unicodeScalars.length&&(i===0?n===0:n>values[i-1]));
        if(!validStarts(page.lineStarts)||!validStarts(page.paragraphStarts))fail();
        const words=new Set(page.wordStarts),lines=new Set(page.lineStarts);
        if(page.lineStarts.some(n=>!words.has(n))||page.paragraphStarts.some(n=>!lines.has(n)))fail();
      }
      const ordered=page.unicodeScalars.map(c=>String.fromCodePoint(c)).join('');
      const coverage=compareText(meaningfulPdfText(pages[index].text),ordered);
      if(coverage.missingCharacters||coverage.extraCharacters)fail();
    }
    if(JSON.stringify(info.TextOrderedPages).length>16*1024*1024)fail();
    result.order={version:1,coordinateSpace:info.TextOrderCoordinateSpace,pages:info.TextOrderedPages};
  }
  if(adaptive){
    if(!result.order)fail();
    for(const page of pages){
      if(!page.capture.required)continue;
      const geometry=result.order.pages[page.pageIndex];
      // Native std::to_wstring retains six decimals of point geometry. Permit
      // only that serialization interval before taking the same pixel ceil.
      const matches=(pixels,points)=>pixels>=Math.ceil((points-0.000001)*page.capture.dpi/72)&&pixels<=Math.ceil((points+0.000001)*page.capture.dpi/72);
      if(!matches(page.capture.width,geometry.widthPt)||!matches(page.capture.height,geometry.heightPt))fail();
    }
  }
  return result;
}

function compareText(source,actual){
  const counts=new Int32Array(0x110000);let sourceCharacters=0,modelCharacters=0,missingCharacters=0,extraCharacters=0;
  for(const char of source){counts[char.codePointAt(0)]++;sourceCharacters++;}
  for(const char of actual){counts[char.codePointAt(0)]--;modelCharacters++;}
  for(const count of counts)if(count>0)missingCharacters+=count;else extraCharacters-=count;
  return {sourceCharacters,modelCharacters,missingCharacters,extraCharacters,physicalSequenceMatches:source===actual};
}

/** Count only actual body runs, never styles, alt text, field metadata or stats. */
export function assessPdfRenderedText(source,text){
  if(typeof text!=='string'||text.length>MAX_SCALARS*2)fail();
  return compareText(meaningfulPdfText(source.pages.map(page=>page.text).join('\n')),meaningfulPdfText(text));
}

export function assessPdfModelText(source,document){
  const stack=[document.content],parts=[];let visited=0,length=0;
  while(stack.length){
    const node=stack.pop();if(++visited>500000)fail();
    if(typeof node==='string'){length+=node.length;if(length>MAX_SCALARS*2)fail();parts.push(node);continue;}
    if(Array.isArray(node)){for(let i=node.length-1;i>=0;i--)stack.push(node[i]);continue;}
    if(!node||typeof node!=='object')continue;
    if(node.type==='paraDrawing')stack.push(node.graphic?.content);
    else if(node.content!==undefined)stack.push(node.content);
  }
  return compareText(meaningfulPdfText(source.pages.map(page=>page.text).join('\n')),meaningfulPdfText(parts.join('')));
}
