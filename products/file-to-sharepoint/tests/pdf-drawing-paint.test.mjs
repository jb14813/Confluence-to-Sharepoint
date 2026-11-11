import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
import {authoredDrawingCase} from './pdf-drawing-authored.mjs';
import {readPdfDrawings,validatePdfDrawings} from '../src/engine/pdf-drawings.js';
const context=vm.createContext({TextDecoder,TextEncoder});vm.runInContext(await readFile(new URL('../vendor/xmldom.js',import.meta.url),'utf8'),context);
const encode=value=>new TextEncoder().encode(value),Parser=context.EngineXml.DOMParser;
async function fixture(name){return authoredDrawingCase(name);}
const refuses=(xml,options)=>assert.throws(()=>readPdfDrawings(encode(xml),options,Parser),error=>error.code==='PDF_DRAWINGS_UNVERIFIED');

test('authored V2 original scalar paint counters distinguish before/between/after merged editable runs',async()=>{
 for(const[name,expected,first]of [['paint-before','under-text',2],['paint-between','figure',1],['paint-after','figure',1]]){
  const{xml,data}=await fixture(name),value=readPdfDrawings(encode(xml),data.options,Parser);assert.equal(value.pages[0].lines[0].text,'ABCD');assert.equal(value.pages[0].lines[0].firstPaintOrdinal,first);assert.equal(value.pages[0].drawings[0].role,expected);
 }
});

test('every formed line requires its original paint counter, and neither reconstruction order nor a missing field substitutes',async()=>{
 const{xml,data}=await fixture('paint-before');refuses(xml.replace(/ firstPaintOrdinal="[^"]+"/,''),data.options);refuses(xml.replace('firstPaintOrdinal="2"','firstPaintOrdinal="0"'),data.options);refuses(xml.replace('firstPaintOrdinal="2"','firstPaintOrdinal="2.5"'),data.options);
 const value=readPdfDrawings(encode(xml),data.options,Parser);delete value.pages[0].lines[0].firstPaintOrdinal;assert.throws(()=>validatePdfDrawings(value,data.options),error=>error.code==='PDF_DRAWINGS_UNVERIFIED');
});

test('the independent role gate compares every merged source paint with every geometric text overlap',async()=>{
 const before=await fixture('paint-before');refuses(before.xml.replace('paintOrdinal="1"','paintOrdinal="2"'),before.data.options);
 const between=await fixture('paint-between');refuses(between.xml.replace('role="figure"','role="under-text"').replace('</drawing>','<lineOverlap ordinal="0"/></drawing>'),between.data.options);
 refuses(before.xml.replace('role="under-text"','role="figure"').replace('<lineOverlap ordinal="0"/>',''),before.data.options);
});

test('counter zero remains explicit unknown on whitespace-only lines and cannot prove an underlay',()=>{
 const options={pages:[{W:100,H:100,Dpi:72}],nativeTables:{version:1,complete:true,coordinateSpace:'displayed-crop-top-left-pt',sourcePageCount:1,tables:[]},pdfText:{version:1,pages:[{pageIndex:0,text:''}],order:{version:1,coordinateSpace:'displayed-crop-top-left-pt',pages:[{pageIndex:0,widthPt:100,heightPt:100,unicodeScalars:[]}]}}};
 const xml='<drawings xmlns="urn:fts:pdf-drawings:2" version="2" complete="true" coordinateSpace="displayed-crop-top-left-pt" ordinalSpace="native-renderer-paint-calls" sourcePageCount="1" sourcePaintCount="0" outputDrawingCount="0" formedLineCount="1"><page index="0" widthPt="100" heightPt="100"><line ordinal="0" nativeOrder="1" firstPaintOrdinal="0" leftPt="0" topPt="0" rightPt="10" bottomPt="10"><text> \t</text></line></page></drawings>';
 assert.equal(readPdfDrawings(encode(xml),options,Parser).pages[0].lines[0].firstPaintOrdinal,0);
 const changed=structuredClone(options);changed.pdfText.pages[0].text='A';changed.pdfText.order.pages[0].unicodeScalars=[65];refuses(xml.replace(' \t','A'),changed);
});
