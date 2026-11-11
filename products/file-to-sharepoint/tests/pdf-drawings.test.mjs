import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const context=vm.createContext({TextDecoder,TextEncoder});
vm.runInContext(await readFile(new URL('../vendor/xmldom.js',import.meta.url),'utf8'),context);
const api=await import('../src/engine/pdf-drawings.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const encode=value=>new TextEncoder().encode(value);
const pages=[{W:100,H:100,Dpi:72}];
const nativeTables={version:1,complete:true,coordinateSpace:'displayed-crop-top-left-pt',sourcePageCount:1,tables:[]};
const pdfText={version:1,pages:[{pageIndex:0,text:'A😀'}],order:{version:1,coordinateSpace:'displayed-crop-top-left-pt',pages:[{pageIndex:0,widthPt:100,heightPt:100,unicodeScalars:[65,0x1f600]}]}};
const options={pages,nativeTables,pdfText};
const bounds='leftPt="10" topPt="10" rightPt="30" bottomPt="30"';
const matrix='<ctm a="1" b="-0" c="0" d="1" e="0" f="0"/>';
const path='<path><move x="-1e-8" y="10"/><curve x1="10" y1="10" x2="20" y2="20" x3="30" y3="30"/><close/></path>';
const root=(body,counts=[1,1,1])=>`<drawings xmlns="urn:fts:pdf-drawings:2" version="2" complete="true" coordinateSpace="displayed-crop-top-left-pt" ordinalSpace="native-renderer-paint-calls" sourcePageCount="1" sourcePaintCount="${counts[0]}" outputDrawingCount="${counts[1]}" formedLineCount="${counts[2]}"><page index="0" widthPt="100" heightPt="100">${body}</page></drawings>`;
// Authored V2 protocol examples; no original-paint flags are inferred from old native records.
const source=`<sourcePaint id="1" paintOrdinal="1" nativeOrder="1" clipId="1" kind="fill" role="drawing" fillRule="nonzero" normalComposite="true" ${bounds}>${matrix}${path}<output docPrId="7"/></sourcePaint>`;
const line=`<line ordinal="0" nativeOrder="2" firstPaintOrdinal="2" ${bounds}><text>A😀</text></line>`;
const drawing=`<drawing docPrId="7" nativeOrder="1" kind="vector" role="under-text" ${bounds} rotation="0" flipH="false" flipV="false"><source id="1"/><lineOverlap ordinal="0"/></drawing>`;
const valid=root(`<clip id="1" nativeMode="1">${path}</clip>${source}${line}${drawing}`);
const read=(xml=valid,settings=options)=>api.readPdfDrawings(encode(xml),settings,context.EngineXml.DOMParser);
const refused=(xml,settings)=>assert.throws(()=>read(xml,settings),error=>error.code==='PDF_DRAWINGS_UNVERIFIED');

test('historical native039 V1 records cannot claim verified original fill provenance',async()=>{
  for(const name of ['triangle-gap','alpha-gap','filled-curve-gap']){
    const xml=await readFile(new URL(`fixtures/pdf-drawings/cell-figure-${name}.xml`,import.meta.url)),fixture=JSON.parse(await readFile(new URL(`fixtures/pdf-drawings/cell-figure-${name}.json`,import.meta.url),'utf8'));
    assert.equal(createHash('sha256').update(xml).digest('hex'),fixture.privatePartSha256);
    assert.throws(()=>api.readPdfDrawings(new Uint8Array(xml),fixture.options,context.EngineXml.DOMParser),error=>error.code==='PDF_DRAWINGS_UNVERIFIED');
  }
});

test('native drawing XML retains exact source commands, matrices, Unicode and stable output identities',()=>{
  assert.equal(typeof api.readPdfDrawings,'function');
  const value=read();
  assert.equal(value.pages[0].drawings[0].docPrId,7);
  assert.deepEqual(value.pages[0].drawings[0].sourceIds,[1]);
  assert.deepEqual(value.pages[0].drawings[0].lineOverlaps,[0]);
  assert.deepEqual(value.pages[0].sourcePaints[0].path[0],{command:'move',values:[-1e-8,10]});
  assert.equal(Object.is(value.pages[0].sourcePaints[0].ctm.b,-0),true);
  assert.equal(value.pages[0].lines[0].text,'A😀');
  assert.equal(api.validatePdfDrawings(value,options),value);
});

test('complete zero-output metadata is required and Reader coverage is a scalar bag, never an invented order',()=>{
  assert.equal(typeof api.readPdfDrawings,'function');
  const zero={...options,pdfText:{...pdfText,pages:[{pageIndex:0,text:''}],order:{...pdfText.order,pages:[{pageIndex:0,widthPt:100,heightPt:100,unicodeScalars:[]}]}}};
  assert.deepEqual(read(root('',[0,0,0]),zero).pages[0].drawings,[]);
  assert.equal(read(valid.replace('A😀','😀 A')).pages[0].lines[0].text,'😀 A');
  for(const xml of [valid.replace('A😀','A'),valid.replace('A😀','AA😀'),valid.replace('A😀','A😃'),valid.replace('formedLineCount="1"','formedLineCount="0"')])refused(xml);
  refused(root('',[0,0,0]));
  refused(valid,{...options,pdfText:null});
});

test('roles and exact-once source/output/clip/line references cannot be forged or silently omitted',()=>{
  assert.equal(typeof api.readPdfDrawings,'function');
  for(const xml of [
    valid.replace('sourcePaintCount="1"','sourcePaintCount="2"'),
    valid.replace('docPrId="7"/></sourcePaint>','docPrId="8"/></sourcePaint>'),
    valid.replace('<source id="1"/>','<source id="1"/><source id="1"/>'),
    valid.replace('<source id="1"/>',''),valid.replace('clipId="1"','clipId="2"'),
    valid.replace('<lineOverlap ordinal="0"/>','<lineOverlap ordinal="1"/>'),
    valid.replace('role="under-text"','role="editable-text-wrapper"'),
    valid.replace('<lineOverlap ordinal="0"/>',''),
    valid.replace('role="drawing"','role="fully-clipped"'),
    valid.replace('role="drawing"','role="text-effect"'),
  ])refused(xml);
});

test('text-effect snapshots and native table owners retain independent, validated dispositions',()=>{
  assert.equal(typeof api.readPdfDrawings,'function');
  const effect=source.replace('role="drawing"','role="text-effect"').replace('<output docPrId="7"/>',`<textOwner nativeOrder="99" ${bounds}><text>A</text></textOwner>`);
  const effectXml=root(`<clip id="1" nativeMode="0">${path}</clip>${effect}${line}`,[1,0,1]);
  assert.equal(read(effectXml).pages[0].sourcePaints[0].textOwners[0].nativeOrder,99);
  refused(effectXml.replace('<text>A</text>','<text>B</text>'));
  const tables={...nativeTables,tables:[{ordinal:0,pageIndex:0,rows:1,columns:1,cells:[{row:0,column:0,rowSpan:1,columnSpan:1,leftPt:0,topPt:0,rightPt:50,bottomPt:50}]}]};
  const cell=source.replace('role="drawing"','role="cell-fill"').replace('<output docPrId="7"/>','<cellOwner tableOrdinal="0" row="0" column="0"/>');
  const xml=root(`<clip id="1" nativeMode="1">${path}</clip>${cell}${line}`,[1,0,1]);
  assert.equal(read(xml,{...options,nativeTables:tables}).pages[0].sourcePaints[0].cellOwners[0].tableOrdinal,0);
  refused(xml);refused(xml.replace('column="0"','column="1"'),{...options,nativeTables:tables});
  refused(xml.replace('<cellOwner ','<cellOwner row="0" '),{...options,nativeTables:tables});
});

test('unknown XML, malformed arity, repaired syntax, nonfinite values and size/counter excess fail closed',()=>{
  assert.equal(typeof api.readPdfDrawings,'function');
  for(const xml of [
    valid.replace('complete="true"','complete="false"'),valid.replace('version="2"','version="1"'),
    valid.replace('nativeMode="1"','nativeMode="2"'),valid.replace('widthPt="100"','widthPt="98"'),
    valid.replace('x1="10" ','').replace('<close/>','<close x="1"/>'),
    valid.replace('x1="10"','x1="NaN"'),valid.replace('x1="10"','x1="1e999"'),
    valid.replace('x1="10"','x1="10000001"'),valid.replace('topPt="10"','topPt="31"'),
    valid.replace('<path>','<path extra="true">'),valid.replace('<text>A😀</text>','<text><b>A😀</b></text>'),
    valid.replace('<text>A😀</text>','<text>A&#0;😀</text>'),
    valid.replace('<page ','<!-- unknown --><page '),valid.replace('</page>','unexpected</page>'),
    '<!-- unknown -->'+valid,'<?unverified value?>'+valid,
    '<!DOCTYPE drawings [<!ENTITY x "A">]>'+valid,valid.replace('sourcePaintCount="1"','sourcePaintCount="16385"'),
    valid.replace('sourcePageCount="1"','sourcePageCount="513"'),root(' '.repeat(16*1024*1024)),
  ])refused(xml);
});

test('structured-clone transport repeats all constraints, including paths, Unicode and exact keys',()=>{
  assert.equal(typeof api.validatePdfDrawings,'function');
  for(const mutate of [
    value=>{value.extra=true;},value=>{value.pages[0].drawings[0].docPrId=8;},
    value=>{value.pages[0].sourcePaints[0].path[0].values.push(2);},
    value=>{value.pages[0].sourcePaints[0].ctm.a=Infinity;},
    value=>{value.pages[0].lines[0].text='A\ud800';},
    value=>{value.pages[0].drawings[0].lineOverlaps.push(0);},
    value=>{value.pages[0].sourcePaints[0].outputDocPrId=null;},
    value=>{value.pages[0].clips.push(value.pages[0].clips[0]);},
  ]){const value=structuredClone(read());mutate(value);assert.throws(()=>api.validatePdfDrawings(value,options),error=>error.code==='PDF_DRAWINGS_UNVERIFIED');}
});

test('gap anchors require the unique complete native line interval and under-text refs include every intersection',()=>{
  assert.equal(typeof api.readPdfDrawings,'function');
  const lines=`<line ordinal="0" nativeOrder="2" firstPaintOrdinal="2" leftPt="0" topPt="0" rightPt="100" bottomPt="10"><text>A</text></line><line ordinal="1" nativeOrder="3" firstPaintOrdinal="3" leftPt="0" topPt="30" rightPt="100" bottomPt="40"><text>😀</text></line>`;
  const figure=drawing.replace('role="under-text"','role="figure"').replace('topPt="10" rightPt="30" bottomPt="30"','topPt="12" rightPt="30" bottomPt="14"').replace('<lineOverlap ordinal="0"/>','<gap beforeLine="0" afterLine="1"/>');
  const xml=root(`<clip id="1" nativeMode="1">${path}</clip>${source}${lines}${figure}`,[1,1,2]);
  assert.deepEqual(read(xml).pages[0].drawings[0].gap,{beforeLine:0,afterLine:1});
  refused(xml.replace('beforeLine="0" afterLine="1"','beforeLine="1" afterLine="0"'));
  refused(xml.replace('topPt="12"','topPt="9"'));
  const extra=`<line ordinal="2" nativeOrder="4" firstPaintOrdinal="4" leftPt="0" topPt="0" rightPt="100" bottomPt="10"><text> </text></line><line ordinal="3" nativeOrder="5" firstPaintOrdinal="5" leftPt="0" topPt="30" rightPt="100" bottomPt="40"><text> </text></line>`;
  refused(xml.replace('<drawing ',extra+'<drawing ').replace('formedLineCount="2"','formedLineCount="4"'));
  const split=line.replace('A😀','A')+line.replace('ordinal="0"','ordinal="1"').replace('nativeOrder="2"','nativeOrder="3"').replace('A😀','😀');
  refused(root(`<clip id="1" nativeMode="1">${path}</clip>${source}${split}${drawing}`,[1,1,2]));
});

test('path command-plus-point accounting is cumulative across original paths and unique clips',()=>{
  assert.equal(typeof api.validatePdfDrawings,'function');
  const value=read(),close={command:'close',values:[]};
  value.pages[0].clips[0].path=Array(131072).fill(close);
  value.pages[0].sourcePaints[0].path=Array(131073).fill(close);
  assert.throws(()=>api.validatePdfDrawings(value,options),error=>error.code==='PDF_DRAWINGS_UNVERIFIED');
  value.pages[0].sourcePaints[0].path=Array(131072).fill(close);
  assert.equal(api.validatePdfDrawings(value,options),value);
  value.pages[0].sourcePaints[0].path[0]={command:'move',values:[0,0]};
  assert.throws(()=>api.validatePdfDrawings(value,options),error=>error.code==='PDF_DRAWINGS_UNVERIFIED');
});
