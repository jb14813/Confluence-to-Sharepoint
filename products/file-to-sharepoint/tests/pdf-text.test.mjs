import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../src/engine/pdf-text.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const source='Title α😀\nBody';
const info=()=>({TextCapabilityVersion:1,TextScanComplete:true,TextTruncated:false,TextPagesVisited:1,TextType3Glyphs:11,TextType3UnmappedGlyphs:0,TextInvalidScalars:0,TextUtf8Base64:Buffer.from(source).toString('base64'),TextPages:[{pageIndex:0,utf8Offset:0,utf8Length:17,unicodeScalars:13,meaningfulScalars:11,type3Glyphs:11,type3UnmappedGlyphs:0,bodyImageOps:0,bodyPathOps:0}],GraphicsCapabilityVersion:1,TextActualTextSpans:0,TextSoftMaskedGlyphs:0,TextTransparencyGroupGlyphs:0,GraphicsTransparencyGroups:0,GraphicsSoftMasks:0,GraphicsTransparencyMaxDepth:0,GraphicsUnsupportedFeatures:0,GraphicsUnsupportedReasons:0});
const doc=text=>({type:'document',content:[{type:'paragraph',content:[{type:'run',content:[text]}]}]});

test('PDF source capabilities retain exact bounded Unicode and page ownership',()=>{
 assert.equal(typeof api.readPdfTextCapabilities,'function','Verified native PDF text capabilities must be consumed');
 const result=api.readPdfTextCapabilities(info(),1);
 assert.equal(result.pages[0].text,source);assert.equal(result.pages[0].bodyImageOps,0);
 const assessment=api.assessPdfModelText(result,doc(source));assert.equal(assessment.missingCharacters,0);assert.equal(assessment.extraCharacters,0);assert.equal(assessment.physicalSequenceMatches,true);
});

test('missing, incomplete, corrupt and unsupported native PDF source metadata fails before conversion',()=>{
 assert.equal(typeof api.readPdfTextCapabilities,'function');
 const bad=[{}, {...info(),TextCapabilityVersion:2},{...info(),TextScanComplete:false},{...info(),TextTruncated:true},{...info(),TextType3UnmappedGlyphs:1},{...info(),TextInvalidScalars:1},{...info(),TextPagesVisited:2},{...info(),TextUtf8Base64:Buffer.from([255]).toString('base64')},{...info(),TextActualTextSpans:1},{...info(),TextSoftMaskedGlyphs:1},{...info(),GraphicsUnsupportedFeatures:1,GraphicsUnsupportedReasons:64}];
 for(const item of bad)assert.throws(()=>api.readPdfTextCapabilities(item,1),error=>/^PDF_/.test(error.code));
 for(const change of [{utf8Length:18},{unicodeScalars:12},{pageIndex:1},{utf8Offset:1},{type3Glyphs:12}]){const item=info();Object.assign(item.TextPages[0],change);assert.throws(()=>api.readPdfTextCapabilities(item,1),error=>/^PDF_/.test(error.code));}
});

test('PDF coverage detects partial editable text and cannot count image descriptions or form metadata',()=>{
 assert.equal(typeof api.assessPdfModelText,'function');const result=api.readPdfTextCapabilities(info(),1);
 const partial=doc('Body');partial.pdfForms={value:source};partial.content.push({type:'paraDrawing',docPr:{descr:source},graphic:{type:'image'}});
 const assessed=api.assessPdfModelText(result,partial);assert.ok(assessed.missingCharacters>0);assert.equal(assessed.extraCharacters,0);
 assert.equal(api.assessPdfModelText(result,doc('Body Title α😀')).physicalSequenceMatches,false,'Physical extraction order is diagnostic, never silently called verified reading order');
});

test('PDF Unicode comparison preserves ZWJ, ZWNJ, ligatures, math and case while matching native layout whitespace',()=>{
 assert.equal(typeof api.meaningfulPdfText,'function');
 assert.equal(api.meaningfulPdfText('A\u200c\u200dﬁ²ℝa\u200b\u200e\u2066 \n'),'A\u200c\u200dﬁ²ℝa');
 assert.notEqual(api.meaningfulPdfText('ﬁ'),api.meaningfulPdfText('fi'));
});

test('form-only PDF exemption requires verified absence of every authored body paint operation',()=>{
 assert.equal(typeof api.verifiedEmptyPdfBody,'function');
 const empty={version:1,pages:[{pageIndex:0,text:'\n',meaningfulScalars:0,bodyTextOps:0,bodyImageOps:0,bodyPathOps:0}]};
 assert.equal(api.verifiedEmptyPdfBody(empty),true);
 for(const patch of [{text:'Hidden body'},{meaningfulScalars:1},{bodyTextOps:1},{bodyTextOps:undefined},{bodyImageOps:1},{bodyPathOps:1},{bodyPathOps:undefined}])assert.equal(api.verifiedEmptyPdfBody({...empty,pages:[{...empty.pages[0],...patch}]}),false);
 assert.equal(api.verifiedEmptyPdfBody(null),false);assert.equal(api.verifiedEmptyPdfBody({version:1,pages:[]}),false);
});

function nextInfo(){
 const input=info(),chars=Array.from(api.meaningfulPdfText(source),c=>c.codePointAt(0));
 Object.assign(input,{TextActualTextCapabilityVersion:1,TextActualTextUnsupportedSpans:0,GraphicsCaptureProfile:'page-source-density-bgra-v1',GraphicsCaptureDpi:96,GraphicsCaptureMaxPixels:9437184,GraphicsCaptureMaxDimension:4096,GraphicsCaptureMaxBytes:134217728,TextOrderCapabilityVersion:1,TextOrderScanComplete:true,TextOrderTruncated:false,TextOrderCoordinateSpace:'displayed-crop-top-left-pt',TextOrderedPages:[{pageIndex:0,widthPt:612,heightPt:792,rotation:0,unicodeScalars:chars,scalarBoxesPt:chars.map((_,i)=>[i,10,i+1,20]),wordStarts:[0,5,7]}]});
 Object.assign(input.TextPages[0],{bodyTextOps:13,captureRequired:true,captureDpi:96,captureWidthPx:816,captureHeightPx:1056});return input;
}
test('ActualText requires explicit native replay support and paired adaptive graphics capabilities',()=>{
 const input=nextInfo();input.TextActualTextSpans=1;
 const result=api.readPdfTextCapabilities(input,1);assert.equal(result.pages[0].bodyTextOps,13);assert.equal(result.pages[0].capture.width,816);
 for(const patch of [{TextActualTextCapabilityVersion:undefined},{TextActualTextCapabilityVersion:2},{TextActualTextUnsupportedSpans:1},{TextActualTextUnsupportedSpans:2},{GraphicsCaptureMaxBytes:268435456},{GraphicsCaptureMaxPixels:99999999},{GraphicsCaptureProfile:'unknown'}])assert.throws(()=>api.readPdfTextCapabilities({...input,...patch},1),e=>/^PDF_/.test(e.code));
 const bad=structuredClone(input);delete bad.TextPages[0].bodyTextOps;assert.throws(()=>api.readPdfTextCapabilities(bad,1),e=>/^PDF_/.test(e.code));
});
test('adaptive capture frames stay bound to source geometry and allocation limits only when capture is required',()=>{
 for(const patch of [{captureRequired:undefined},{captureDpi:95},{captureWidthPx:817+10},{captureHeightPx:5000}]){const input=nextInfo();Object.assign(input.TextPages[0],patch);assert.throws(()=>api.readPdfTextCapabilities(input,1),e=>/^PDF_/.test(e.code));}
 const unused=nextInfo();Object.assign(unused.TextPages[0],{captureRequired:false,captureWidthPx:20000,captureHeightPx:20000});assert.equal(api.readPdfTextCapabilities(unused,1).pages[0].capture.required,false,'A noncaptured source page allocates no full-page bitmap');
});

test('native logical PDF order retains bounded scalar boxes and rejects malformed or incomplete coverage',()=>{
 const input=info(),scalars=Array.from(api.meaningfulPdfText(source),c=>c.codePointAt(0));
 Object.assign(input,{TextOrderCapabilityVersion:1,TextOrderScanComplete:true,TextOrderTruncated:false,TextOrderCoordinateSpace:'displayed-crop-top-left-pt',TextOrderedPages:[{pageIndex:0,widthPt:612,heightPt:792,rotation:0,unicodeScalars:scalars,scalarBoxesPt:scalars.map((_,i)=>[i,10,i+1,20]),wordStarts:[0,5,7]}]});
 assert.deepEqual(api.readPdfTextCapabilities(input,1).order.pages[0].unicodeScalars,scalars);
 const grouped=structuredClone(input);Object.assign(grouped.TextOrderedPages[0],{lineStarts:[0,7],paragraphStarts:[0]});assert.deepEqual(api.readPdfTextCapabilities(grouped,1).order.pages[0].lineStarts,[0,7]);
 for(const change of [{lineStarts:[1],paragraphStarts:[0]},{lineStarts:[0,6],paragraphStarts:[0]},{lineStarts:[0,7],paragraphStarts:[0,5]},{lineStarts:[0],paragraphStarts:undefined},{lineStarts:[],paragraphStarts:[]}]){const bad=structuredClone(input);Object.assign(bad.TextOrderedPages[0],change);assert.throws(()=>api.readPdfTextCapabilities(bad,1),e=>/^PDF_/.test(e.code));}
 for(const change of [{rotation:90},{wordStarts:[1]},{scalarBoxesPt:[[1,2,0,3]]},{unicodeScalars:[65]}]){const bad=structuredClone(input);Object.assign(bad.TextOrderedPages[0],change);assert.throws(()=>api.readPdfTextCapabilities(bad,1),e=>/^PDF_/.test(e.code));}
});
