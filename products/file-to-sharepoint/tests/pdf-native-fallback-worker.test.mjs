import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Branch-only transport tests. The converter/FS below are controlled doubles;
// these tests establish no native conversion, layout, content or pixel claim.
// The separate browser regression exercises the real maintained pipeline.
const source=await readFile(new URL('../src/engine/worker.js',import.meta.url),'utf8');
const start=source.indexOf('const parameters=request=>');
const end=source.indexOf('await validateDocx(docxBytes);',start)+'await validateDocx(docxBytes);'.length;
assert.ok(start>0&&end>start,'Real conversion branch must remain observable');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const branch=new AsyncFunction('module','extension','validateDocx','fail',`
  const from='/working/input.pdf',to='/working/output.docx';
  let docxBytes,pdfAssociationType=2;
  ${source.slice(start,end)}
  return {docxBytes,pdfAssociationType};
`);

async function run(steps){
  const files=new Map(),events=[],validated=[];let index=0;
  const module={FS:{
    writeFile(name,bytes){files.set(name,bytes);},
    analyzePath(name){return {exists:files.has(name)};},
    unlink(name){assert.ok(files.has(name));events.push({unlink:name});files.delete(name);},
    readFile(name){events.push({read:name});assert.ok(files.has(name));return files.get(name);},
  },ccall(name,type,types,args){
    assert.equal(name,'main1');assert.deepEqual(args,['/working/params.xml']);
    const xml=files.get(args[0]),request=Number(xml.match(/<m_nTextAssociationType>(\d+)</)[1]);
    events.push({request,outputBefore:files.has('/working/output.docx')});
    const step=steps[index++];assert.ok(step,'No unrequested native retry');
    if(step.output)files.set('/working/output.docx',step.output);
    return step.code;
  }};
  const fail=(message,code)=>{throw Object.assign(new Error(message),{code});};
  try{return {result:await branch(module,'pdf',async bytes=>validated.push(bytes),fail),events,validated};}
  catch(error){return {error,events,validated};}
}

test('transport-only failed native2 discards partial output before request3 on the same module',async()=>{
  const partial=Uint8Array.of(1),fresh=Uint8Array.of(2),actual=await run([{code:1,output:partial},{code:0,output:fresh}]);
  assert.equal(actual.error,undefined);assert.equal(actual.result.docxBytes,fresh);assert.equal(actual.result.pdfAssociationType,4);
  assert.deepEqual(actual.events,[{request:2,outputBefore:false},{unlink:'/working/output.docx'},{request:3,outputBefore:false},{read:'/working/output.docx'}]);
  assert.deepEqual(actual.validated,[fresh]);
});

test('transport-only native password exit never retries or returns even a partial output',async()=>{
  const actual=await run([{code:55,output:Uint8Array.of(1)}]);
  assert.equal(actual.error?.code,'ENCRYPTED_DOCUMENT');assert.equal(actual.result,undefined);
  assert.deepEqual(actual.events,[{request:2,outputBefore:false}]);assert.deepEqual(actual.validated,[]);
});

test('transport-only failed fallback cannot validate or return first-attempt or partial retry output',async()=>{
  for(const output of [undefined,Uint8Array.of(9)]){
    const actual=await run([{code:1,output:Uint8Array.of(1)},{code:2,output}]);
    assert.equal(actual.error?.code,'CONVERSION_FAILED');assert.equal(actual.result,undefined);
    assert.deepEqual(actual.events,[{request:2,outputBefore:false},{unlink:'/working/output.docx'},{request:3,outputBefore:false}]);
    assert.deepEqual(actual.validated,[]);
  }
});

test('transport-only successful native2 retains its profile without invoking request3',async()=>{
  const bytes=Uint8Array.of(3),actual=await run([{code:0,output:bytes}]);
  assert.equal(actual.error,undefined);assert.equal(actual.result.pdfAssociationType,2);assert.equal(actual.result.docxBytes,bytes);
  assert.deepEqual(actual.events,[{request:2,outputBefore:false},{read:'/working/output.docx'}]);assert.deepEqual(actual.validated,[bytes]);
});
