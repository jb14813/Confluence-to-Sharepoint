import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {authoredDrawingCase} from './pdf-drawing-authored.mjs';
import {readPdfDrawings} from '../src/engine/pdf-drawings.js';
import {convertDocument} from '../src/engine/index.js';

const parser=vm.createContext({TextDecoder,TextEncoder});
vm.runInContext(await readFile(new URL('../vendor/xmldom.js',import.meta.url),'utf8'),parser);
async function fixture(name='zero'){
 const authored=authoredDrawingCase(name),source=authored.data,bytes=new TextEncoder().encode(authored.xml);
 const nativeDrawings=readPdfDrawings(bytes,source.options,parser.EngineXml.DOMParser),{pages,pdfText,nativeTables}=source.options;
 return {docxBytes:Uint8Array.of(1),officeBin:new TextEncoder().encode('DOCY'),media:{},warnings:[],pdfForms:{Fields:[],Parents:[],pages},pdfText,pdfLayout:{version:1,textAssociationType:2,flowGeometry:'native-plain-line-v1',nativeTables,nativeDrawings}};
}

// Authored V2 protocol records supply worker results; transport and frames are inert.
// This covers parent validation and cleanup, not native conversion or editing.
async function transport(result){
 const saved=Object.fromEntries(['Worker','document','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const controller=new AbortController(),observed={frames:0,removed:0,terminated:0,posted:null},listeners=new Map();
 globalThis.Worker=class{
  terminate(){observed.terminated++;}
  postMessage(){queueMicrotask(()=>{Promise.resolve(this.onmessage({data:{result}})).catch(error=>{observed.unexpected=String(error);controller.abort();});});}
 };
 globalThis.window={addEventListener(type,receive){listeners.set(type,receive);},removeEventListener(type){listeners.delete(type);}};
 globalThis.document={createElement(){observed.frames++;return {style:{},setAttribute(){},remove(){observed.removed++;},contentWindow:{postMessage(value){observed.posted=value;queueMicrotask(()=>controller.abort());}}};},body:{append(frame){queueMicrotask(()=>listeners.get('message')?.({source:frame.contentWindow,data:{channel:'fts-office-model',nonce:new URL(frame.src).hash.slice(1),type:'ready'}}));}}};
 try{
  await assert.rejects(convertDocument({name:'source.pdf',bytes:new TextEncoder().encode('%PDF-')},{signal:controller.signal,timeoutMs:1000}),error=>{observed.error=error;return true;});
  assert.equal(observed.unexpected,undefined);return observed;
 }finally{
  controller.abort();for(const [key,descriptor]of Object.entries(saved))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
 }
}

test('PDF drawing transport refuses missing, incomplete or false paint metadata before loading the SDK',async()=>{
 for(const [name,change]of [
  ['zero',value=>{delete value.pdfLayout.nativeDrawings;}],
  ['zero',value=>{value.pdfLayout.nativeDrawings.complete=false;}],
  ['paint-before',value=>{value.pdfLayout.nativeDrawings.pages[0].lines[0].firstPaintOrdinal=0;}],
 ]){
  const value=await fixture(name);change(value);const actual=await transport(value);
  assert.equal(actual.error.code,'PDF_DRAWINGS_UNVERIFIED');assert.equal(actual.frames,0);assert.ok(actual.terminated>0);
 }
});

test('validated native drawing metadata and original Reader context reach the opaque SDK with cleanup',async()=>{
 const value=await fixture('paint-before'),actual=await transport(value);
 assert.equal(actual.error.name,'AbortError');assert.equal(actual.frames,1);assert.equal(actual.removed,1);assert.ok(actual.terminated>0);
 assert.deepEqual(actual.posted.pdfContext.pdfText,value.pdfText);
 assert.deepEqual(actual.posted.pdfContext.pdfLayout.nativeDrawings,value.pdfLayout.nativeDrawings);
});
