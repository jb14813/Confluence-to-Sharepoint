import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {readPdfDrawings,validatePdfDrawings} from '../src/engine/pdf-drawings.js';

const parser=vm.createContext({TextDecoder,TextEncoder});
vm.runInContext(await readFile(new URL('../vendor/xmldom.js',import.meta.url),'utf8'),parser);
const options={pages:[{W:100,H:100,Dpi:72}],nativeTables:{version:1,complete:true,coordinateSpace:'displayed-crop-top-left-pt',sourcePageCount:1,tables:[]},pdfText:{version:1,pages:[{pageIndex:0,text:''}],order:{version:1,coordinateSpace:'displayed-crop-top-left-pt',pages:[{pageIndex:0,widthPt:100,heightPt:100,unicodeScalars:[],scalarBoxesPt:[]}]}}};
// Authored V2 protocol unit case, not claimed to be a native fixture.
const xml=`<drawings xmlns="urn:fts:pdf-drawings:2" version="2" complete="true" coordinateSpace="displayed-crop-top-left-pt" ordinalSpace="native-renderer-paint-calls" sourcePageCount="1" sourcePaintCount="1" outputDrawingCount="1" formedLineCount="0"><page index="0" widthPt="100" heightPt="100"><sourcePaint id="1" paintOrdinal="1" nativeOrder="1" clipId="0" kind="fill" role="drawing" leftPt="10" topPt="10" rightPt="20" bottomPt="20" fillRule="evenodd" normalComposite="true"><ctm a="1" b="0" c="0" d="1" e="0" f="0"/><solidFill r="25" g="102" b="229" a="127"/><path><move x="10" y="10"/><line x="20" y="10"/><line x="10" y="20"/><close/></path><output docPrId="1"/></sourcePaint><drawing docPrId="1" nativeOrder="1" kind="derived-vector" role="figure" leftPt="10" topPt="10" rightPt="20.125" bottomPt="20.125" rotation="0" flipH="false" flipV="false" imageId="1"><representation format="png" resourceName="word/media/image1.png" pixelWidth="27" pixelHeight="27" dpi="192"/><source id="1"/></drawing></page></drawings>`;
const read=value=>readPdfDrawings(new TextEncoder().encode(value),options,parser.EngineXml.DOMParser);
const reject=value=>assert.throws(()=>read(value),error=>error.code==='PDF_DRAWINGS_UNVERIFIED');
test('V2 preserves original evenodd source facts separately from the derived pixel viewport',()=>{
 const value=read(xml),source=value.pages[0].sourcePaints[0],drawing=value.pages[0].drawings[0];
 assert.equal(value.version,2);assert.equal(source.fillRule,'evenodd');assert.equal(source.normalComposite,true);assert.deepEqual(source.solidFill,{r:25,g:102,b:229,a:127});assert.equal(source.imageId,null);assert.equal(source.bounds.rightPt,20);assert.equal(drawing.bounds.rightPt,20.125);assert.equal(drawing.representation.resourceName,'word/media/image1.png');
 assert.equal(validatePdfDrawings(structuredClone(value),options).version,2);
});
test('V2 required paint metadata, original source identity and derived representation cannot be forged',()=>{
 for(const changed of [
  xml.replaceAll('pdf-drawings:2','pdf-drawings:1').replace('version="2"','version="1"'),
  xml.replace(' fillRule="evenodd"',''),xml.replace(' normalComposite="true"',''),xml.replace('normalComposite="true"','normalComposite="false"'),
  xml.replace('fillRule="evenodd"','fillRule="unknown"'),xml.replace('a="127"','a="256"'),xml.replace('<solidFill r="25" g="102" b="229" a="127"/>',''),
  xml.replace('resourceName="word/media/image1.png"','resourceName="word/media/image2.png"'),xml.replace('pixelWidth="27"','pixelWidth="28"'),xml.replace('dpi="192"','dpi="191"'),
  xml.replace('pixelWidth="27"','pixelWidth="4097"'),xml.replace('format="png"','format="jpeg"'),xml.replace('rightPt="20.125"','rightPt="19.875"'),
  xml.replace('<source id="1"/>','<source id="1"/><source id="1"/>'),xml.replace('kind="derived-vector"','kind="image"'),
 ])reject(changed);
 const value=read(xml);value.pages[0].sourcePaints[0].normalComposite=false;assert.throws(()=>validatePdfDrawings(value,options),error=>error.code==='PDF_DRAWINGS_UNVERIFIED');
});
test('surviving plain evenodd vectors are refused while explicitly nonzero authored vectors retain null representation',()=>{
 const plain=xml.replace('kind="derived-vector"','kind="vector"').replace(' imageId="1"','').replace(/<representation[^>]+\/>/,'');
 reject(plain);const value=read(plain.replace('fillRule="evenodd"','fillRule="nonzero"'));assert.equal(value.pages[0].drawings[0].representation,null);
});
test('none fill rules become null only for non-fill paint; combined stroke-fill remains unsupported',()=>{
 const plain=xml.replace('kind="derived-vector"','kind="vector"').replace(' imageId="1"','').replace(/<representation[^>]+\/>/,'').replace(/<solidFill[^>]+\/>/,'');
 const stroke=plain.replace('kind="fill"','kind="stroke"').replace('fillRule="evenodd"','fillRule="none"');
 const source=read(stroke).pages[0].sourcePaints[0];assert.equal(source.fillRule,null);assert.equal(source.solidFill,null);
 reject(plain.replace('fillRule="evenodd"','fillRule="none"'));reject(stroke.replace('kind="stroke"','kind="stroke-fill"'));
 reject(stroke.replace('<path>','<solidFill r="1" g="2" b="3" a="4"/><path>'));
});
test('a cell clip is harmless only when one exact rectangle strictly encloses every original endpoint and Bezier control',()=>{
 const settings=structuredClone(options);settings.nativeTables.tables=[{ordinal:0,pageIndex:0,rows:1,columns:1,cells:[{row:0,column:0,rowSpan:1,columnSpan:1,leftPt:0,topPt:0,rightPt:50,bottomPt:50}]}];
 const clip='<clip id="1" nativeMode="1"><path><move x="9" y="9"/><line x="21" y="9"/><line x="21" y="21"/><line x="9" y="21"/><close/></path></clip>';
 const cell=xml.replace('<sourcePaint ',clip+'<sourcePaint ').replace('clipId="0"','clipId="1"').replace('role="drawing"','role="cell-figure"').replace('role="figure"','role="cell-figure"').replace('<output docPrId="1"/>','<output docPrId="1"/><cellOwner tableOrdinal="0" row="0" column="0"/>');
 const parse=raw=>readPdfDrawings(new TextEncoder().encode(raw),settings,parser.EngineXml.DOMParser);
 assert.equal(parse(cell).pages[0].sourcePaints[0].clipId,1);
 for(const changed of [cell.replaceAll('x="9"','x="10"'),cell.replace('x="9" y="9"','x="10" y="10"'),cell.replace('x="21" y="9"','x="20" y="10"'),cell.replace('<line x="21" y="9"/>','<line x="9" y="21"/>'),cell.replace('<line x="20" y="10"/>','<curve x1="9" y1="10" x2="20" y2="10" x3="20" y3="10"/>'),cell.replace('</path></clip>','<move x="1" y="1"/><close/></path></clip>')])assert.throws(()=>parse(changed),error=>error.code==='PDF_DRAWINGS_UNVERIFIED');
 // ctm is provenance, not a command to transform the already displayed clip.
 assert.equal(parse(cell.replace('a="1" b="0"','a="200" b="0"')).pages[0].sourcePaints[0].clipId,1);
});
