import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {chromiumExecutable} from './chromium.mjs';

test('PDF adapter places a source-proven figure between intact editable units and blocks surfaces',{timeout:30000},async()=>{
  const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/content/index.js',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'FileContent',platform:'browser'});
  const browser=await chromium.launch({headless:true,executablePath:await chromiumExecutable()});
  try{
    const page=await browser.newPage(),requests=[];
    await page.route('**/*',route=>{if(route.request().url()==='https://pdf-flow.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'});requests.push(route.request().url());return route.abort();});
    await page.goto('https://pdf-flow.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});
    const result=await page.evaluate(async()=>{
      const bounds={leftPt:0,topPt:10,rightPt:10,bottomPt:15},para=value=>({type:'paragraph',content:[{type:'run',content:[value]}]});
      const drawing={type:'paraDrawing',docPr:{id:7},drawingType:'anchor',positionH:{relativeFrom:'page',posOffset:0},positionV:{relativeFrom:'page',posOffset:127000},extent:{cx:127000,cy:63500},graphic:{id:'figure-7',type:'shape',content:null}};
      const officeDocument={type:'document',sectPr:{pgSz:{w:2000,h:2000}},content:[{...para(drawing),pPr:{spacing:{line:1,lineRule:'exact'}}},para('A'),para('B')]};
      const nativeTables={version:1,complete:true,coordinateSpace:'displayed-crop-top-left-pt',sourcePageCount:1,tables:[]};
      const pdfText={version:1,pages:[{pageIndex:0,text:'AB'}],order:{version:1,coordinateSpace:'displayed-crop-top-left-pt',pages:[{pageIndex:0,widthPt:100,heightPt:100,rotation:0,unicodeScalars:[65,66],scalarBoxesPt:[[0,0,10,5],[0,20,10,25]],wordStarts:[0,1]}]}};
      const nativeDrawings={version:2,complete:true,coordinateSpace:'displayed-crop-top-left-pt',ordinalSpace:'native-renderer-paint-calls',sourcePageCount:1,sourcePaintCount:1,outputDrawingCount:1,formedLineCount:2,pages:[{pageIndex:0,widthPt:100,heightPt:100,clips:[],sourcePaints:[{id:1,paintOrdinal:1,nativeOrder:1,clipId:0,kind:'fill',role:'drawing',bounds,ctm:{a:1,b:0,c:0,d:1,e:0,f:0},imageId:null,imageBasis:null,fillRule:'nonzero',normalComposite:true,solidFill:null,path:[],outputDocPrId:7,textOwners:[],cellOwners:[]}],lines:[{ordinal:0,nativeOrder:2,firstPaintOrdinal:2,text:'A',bounds:{leftPt:0,topPt:0,rightPt:10,bottomPt:5}},{ordinal:1,nativeOrder:3,firstPaintOrdinal:3,text:'B',bounds:{leftPt:0,topPt:20,rightPt:10,bottomPt:25}}],drawings:[{docPrId:7,nativeOrder:1,kind:'vector',role:'figure',bounds,rotation:0,flipH:false,flipV:false,imageId:null,representation:null,sourceIds:[1],lineOverlaps:[],gap:{beforeLine:0,afterLine:1}}]}]};
      const canvas=document.createElement('canvas');canvas.width=2;canvas.height=1;canvas.getContext('2d').fillRect(0,0,2,1);const blob=await new Promise(resolve=>canvas.toBlob(resolve)),bytes=new Uint8Array(await blob.arrayBuffer());
      const input={officeDocument,pdfText,pdfForms:{Fields:[],Parents:[],pages:[{W:100,H:100,Dpi:72}]},pdfLayout:{version:1,textAssociationType:2,flowGeometry:'native-plain-line-v1',nativeTables,nativeDrawings},decorations:{'figure-7':{bytes,mime:'image/png',width:2,height:1}},warnings:[]};
      const before=JSON.stringify(officeDocument),normal=await FileContent.adaptDocument({name:'flow.pdf',bytes:Uint8Array.of(1),result:input});
      const order=normal.model.blocks.map(block=>block.pictures?.length?'figure':new DOMParser().parseFromString(block.html,'text/html').body.textContent);
      const surface=structuredClone(input);surface.pdfLayout.nativeDrawings.pages[0].drawings[0].role='under-text';surface.pdfLayout.nativeDrawings.pages[0].drawings[0].gap=null;
      surface.pdfLayout.nativeDrawings.pages[0].drawings[0].bounds={leftPt:0,topPt:0,rightPt:10,bottomPt:25};surface.pdfLayout.nativeDrawings.pages[0].sourcePaints[0].bounds=surface.pdfLayout.nativeDrawings.pages[0].drawings[0].bounds;surface.pdfLayout.nativeDrawings.pages[0].drawings[0].lineOverlaps=[0,1];
      const blocked=await FileContent.adaptDocument({name:'surface.pdf',bytes:Uint8Array.of(2),result:surface});
      const textOnly=structuredClone(surface),wrapper=textOnly.officeDocument.content[0],textShape=wrapper.content[0].content[0];
      textOnly.officeDocument.content=[wrapper];delete textOnly.decorations;
      textShape.graphic.content={type:'docContent',content:[para('A'),para('B')]};
      textShape.graphic.spPr={xfrm:{rot:5400000},fill:{fill:{type:'noFill'}},ln:{fill:{fill:{type:'noFill'}}}};
      const textLedger=textOnly.pdfLayout.nativeDrawings;textLedger.sourcePaintCount=0;textLedger.pages[0].sourcePaints=[];
      Object.assign(textLedger.pages[0].drawings[0],{kind:'text',role:'editable-text-wrapper',rotation:90,sourceIds:[],lineOverlaps:[],gap:null});
      const orientation=await FileContent.adaptDocument({name:'rotated-text.pdf',bytes:Uint8Array.of(3),result:textOnly});
      const invalid=structuredClone(textOnly);invalid.officeDocument.content[0].content[0].content[0].graphic.spPr.xfrm.rot=NaN;let invalidCode;
      try{await FileContent.adaptDocument({name:'invalid-transform.pdf',bytes:Uint8Array.of(4),result:invalid});}catch(error){invalidCode=error.code;}
      const nested=structuredClone(textOnly),nestedLedger=nested.pdfLayout.nativeDrawings;
      nested.media={'word/media/image1.png':bytes};nestedLedger.sourcePaintCount=1;nestedLedger.outputDrawingCount=2;
      nestedLedger.pages[0].sourcePaints=[{id:1,paintOrdinal:1,nativeOrder:1,clipId:0,kind:'image',role:'drawing',bounds,ctm:{a:1,b:0,c:0,d:1,e:0,f:0},imageId:1,imageBasis:{a:1,b:0,c:0,d:1,e:0,f:0},fillRule:null,normalComposite:true,solidFill:null,path:[],outputDocPrId:8,textOwners:[],cellOwners:[]}];
      nestedLedger.pages[0].drawings.push({...nativeDrawings.pages[0].drawings[0],docPrId:8,kind:'image',imageId:1});
      nested.officeDocument.content[0].content[0].content[0].graphic.content.content.splice(1,0,para({type:'paraDrawing',docPr:{id:8},drawingType:'anchor',graphic:{id:'nested-image',type:'image',blipFill:{rasterImageId:'image1.png'}}}));
      const nestedResult=await FileContent.adaptDocument({name:'nested-transform.pdf',bytes:Uint8Array.of(5),result:nested});
      if(invalidCode!=='drawing-transform-unverified'||!nestedResult.model.warnings.some(w=>w.code==='drawing-transform-unverified'&&w.blocking))throw Error('Native reflow waived an unverified graphic transform');
      return{order,proof:normal.preview.drawingFlow,coverage:normal.preview.textCoverage,warnings:normal.model.warnings,adapted:{warnings:blocked.model.warnings,stats:blocked.model.stats,coverage:blocked.preview.textCoverage,readingOrder:blocked.preview.readingOrder},orientation:{warnings:orientation.model.warnings,coverage:orientation.preview.textCoverage,html:orientation.model.blocks.map(b=>b.html).join('')},unchanged:JSON.stringify(officeDocument)===before};
    });
    assert.deepEqual(result.order,['A','figure','B']);assert.equal(result.unchanged,true);assert.equal(result.coverage.missingCharacters,0);assert.equal(result.coverage.extraCharacters,0);
    assert.equal(result.proof[0].figures[0].boundary,1);assert.ok(!result.warnings.some(w=>w.blocking));
    assert.ok(result.adapted.warnings.some(w=>w.code==='pdf-native-layout-adapted'&&!w.blocking));assert.ok(!result.adapted.warnings.some(w=>w.blocking));
    assert.equal(result.adapted.stats.images,1);assert.equal(result.adapted.coverage.missingCharacters,0);assert.equal(result.adapted.coverage.extraCharacters,0);assert.equal(result.adapted.readingOrder,'native-sharepoint-reflow');
    assert.ok(result.orientation.warnings.some(w=>w.code==='pdf-text-orientation-adapted'&&!w.blocking));assert.ok(!result.orientation.warnings.some(w=>w.blocking));assert.equal(result.orientation.coverage.missingCharacters,0);assert.match(result.orientation.html,/<p>A<\/p><p>B<\/p>/);assert.deepEqual(requests,[]);
  }finally{await browser.close();}
});
