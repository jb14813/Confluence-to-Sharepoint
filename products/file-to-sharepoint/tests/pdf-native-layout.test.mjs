import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const context=vm.createContext({TextDecoder,TextEncoder});
vm.runInContext(await readFile(new URL('../vendor/xmldom.js',import.meta.url),'utf8'),context);
const api=await import('../src/engine/pdf-native-layout.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const encode=value=>new TextEncoder().encode(value),pages=[{W:100,H:100,Dpi:72},{W:200,H:100,Dpi:72}];
const root=content=>`<pdfLayout xmlns="urn:fts:pdf-layout:1" version="1" complete="true" coordinateSpace="displayed-crop-top-left-pt" sourcePageCount="2">${content}</pdfLayout>`;
const cell=(row,column,rowSpan=1,columnSpan=1,leftPt=column*20,topPt=row*10,rightPt=(column+columnSpan)*20,bottomPt=(row+rowSpan)*10)=>`<cell row="${row}" column="${column}" rowSpan="${rowSpan}" columnSpan="${columnSpan}" leftPt="${leftPt}" topPt="${topPt}" rightPt="${rightPt}" bottomPt="${bottomPt}"/>`;
const table=content=>`<table ordinal="0" pageIndex="0" rows="2" columns="2">${content}</table>`;
const valid=root(table(cell(0,0,2)+cell(0,1)+cell(1,1)));
const read=xml=>api.readPdfNativeLayout(encode(xml),pages,context.EngineXml.DOMParser);
const refused=xml=>assert.throws(()=>read(xml),error=>error.code==='PDF_LAYOUT_UNVERIFIED');

test('native PlainParagraph fallback requires actual mode4 sidecar and no claimed native tables',()=>{
 const mode4=root('').replace('sourcePageCount="2"','sourcePageCount="2" textAssociationType="4"');
 const parsed=read(mode4);assert.equal(parsed.textAssociationType,4);assert.deepEqual(parsed.tables,[]);
 assert.equal(api.validatePdfConversionProfile({version:1,textAssociationType:4,flowGeometry:'native-plain-paragraph-v1',nativeTables:parsed}),4);
 for(const xml of [mode4.replace('="4"','="3"'),mode4.replace('="4"','="2"'),valid.replace('sourcePageCount="2"','sourcePageCount="2" textAssociationType="4"')])refused(xml);
 for(const patch of [{textAssociationType:3},{flowGeometry:'native-plain-line-v1'},{nativeTables:read(root(''))}])assert.throws(()=>api.validatePdfConversionProfile({version:1,textAssociationType:4,flowGeometry:'native-plain-paragraph-v1',nativeTables:parsed,...patch}),{code:'PDF_ORDER_UNVERIFIED'});
 assert.equal(api.validatePdfConversionProfile({version:1,textAssociationType:2,flowGeometry:'native-plain-line-v1',nativeTables:read(root(''))}),2);
});

test('native PDF table metadata retains zero-based serialized ordinals, merged cells and empty table sets',()=>{
  assert.equal(typeof api.readPdfNativeLayout,'function');
  const parsed=read(valid);
  assert.equal(parsed.sourcePageCount,2);assert.equal(parsed.complete,true);
  assert.deepEqual(parsed.tables[0],{ordinal:0,pageIndex:0,rows:2,columns:2,cells:[
    {row:0,column:0,rowSpan:2,columnSpan:1,leftPt:0,topPt:0,rightPt:20,bottomPt:20},
    {row:0,column:1,rowSpan:1,columnSpan:1,leftPt:20,topPt:0,rightPt:40,bottomPt:10},
    {row:1,column:1,rowSpan:1,columnSpan:1,leftPt:20,topPt:10,rightPt:40,bottomPt:20},
  ]});
  assert.deepEqual(read(root('')).tables,[]);
});

test('a grid must tile exactly with consistent physical boundaries and source-page geometry',()=>{
  assert.equal(typeof api.readPdfNativeLayout,'function');
  for(const xml of [
    root(table(cell(0,0,2)+cell(0,1))), // hole
    root(table(cell(0,0,2)+cell(0,1)+cell(1,1)+cell(0,0))), // overlap
    root(table(cell(0,0,2)+cell(0,1)+cell(1,1,1,1,21))), // shifted shared edge
    root(table(cell(0,0,2)+cell(0,1)+cell(1,1,1,1,20,9))), // mismatched row edge
    valid.replace('rightPt="40"','rightPt="200"'),
    valid.replace('rowSpan="2"','rowSpan="3"'),
    valid.replace('leftPt="0"','leftPt="-1"'),
    valid.replace('leftPt="0"','leftPt="NaN"'),
    valid.replace('ordinal="0"','ordinal="1"'),
    valid.replace('pageIndex="0"','pageIndex="2"'),
    valid.replace('sourcePageCount="2"','sourcePageCount="1"'),
  ])refused(xml);
  refused(root(table(cell(0,1)+cell(0,0,2)+cell(1,1)))); // producer traversal must be row-major
});

test('unrecognized or repaired XML, incomplete metadata and oversized structures fail closed',()=>{
  assert.equal(typeof api.readPdfNativeLayout,'function');
  for(const xml of [
    valid.replace('complete="true"','complete="false"'),valid.replace('version="1"','version="2"'),
    valid.replace('urn:fts:pdf-layout:1','urn:unverified'),valid.replace(' rows="2"',' extra="yes" rows="2"'),
    valid.replace('<cell ','<other '),valid.replace('</table>','text</table>'),
    valid.replace('leftPt="0"','leftPt="0" leftPt="1"'),
    '<!DOCTYPE pdfLayout [<!ENTITY x "0">]>'+valid,
    valid.replace('leftPt="0"','leftPt="&#0;"'),
    valid.replace('leftPt="0"','leftPt="1e-300"'),
    root(table(cell(0,0)).replace('rows="2"','rows="999999999"')),
    root(' '.repeat(1024*1024)),
  ])refused(xml);
});

test('worker transport retains the same strict contract and rejects overlapping tables or changed fields',()=>{
  assert.equal(typeof api.validatePdfNativeTables,'function');
  const parsed=read(valid);assert.equal(api.validatePdfNativeTables(parsed,pages),parsed);
  for(const change of [
    value=>{delete value.complete;},value=>{value.unverified=true;},
    value=>{value.tables[0].cells[0].rowSpan=1;},value=>{value.tables[0].cells[0].bottomPt=Infinity;},
    value=>{value.tables[0].cells[0].sourceText='invented';},
    value=>{value.tables.push({...structuredClone(value.tables[0]),ordinal:1});},
  ]){
    const value=structuredClone(parsed);change(value);
    assert.throws(()=>api.validatePdfNativeTables(value,pages),error=>error.code==='PDF_LAYOUT_UNVERIFIED');
  }
  const two=structuredClone(parsed);two.tables.push({...structuredClone(two.tables[0]),ordinal:1,pageIndex:1});
  assert.equal(api.validatePdfNativeTables(two,pages),two);
});
