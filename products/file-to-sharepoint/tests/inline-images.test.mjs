import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {fixtures} from './engine-fixtures.mjs';
const api=await import('../src/engine/inline-images.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const zip=await JSZip.loadAsync(Buffer.from(fixtures['sample-rich.docx'],'base64')),png=await zip.file('word/media/image1.png').async('uint8array');
const source={sourceHash:'a'.repeat(64),sourceBytes:120},image=()=>({name:'mhtml-resource-2.bin',mime:'image/png',bytes:png,width:100,height:50,...source});
const options={allowed:true,sourceInputs:[source],imageReferences:['mhtml-resource-2.bin']};

test('inline SVG outputs bind to their source and referenced SDK image without replacing embedded bytes',()=>{
  assert.equal(typeof api.mergeInlineImages,'function');
  const original=Uint8Array.of(1,2),media={'word/media/original.bin':original};
  const result=api.mergeInlineImages(media,[image()],options);
  assert.equal(result.media['word/media/original.bin'],original);assert.equal(result.media['word/media/mhtml-resource-2.bin'],png);assert.equal(Object.keys(media).length,1);
  assert.equal(result.images[0].sourceHash,source.sourceHash);assert.equal(result.images[0].bytes,undefined);
});

test('missing, forged, colliding or oversized inline SVG media fails closed',()=>{
  assert.equal(typeof api.mergeInlineImages,'function');
  for(const patch of [{name:'../image.png'},{sourceHash:'b'.repeat(64)},{sourceBytes:121},{mime:'image/svg+xml'},{width:0},{height:5000},{bytes:Uint8Array.of(1,2,3)}])assert.throws(()=>api.mergeInlineImages({},[{...image(),...patch}],options),e=>e.code==='INVALID_OFFICE_MODEL');
  for(const args of [[{},[],options],[{},[image()],{...options,allowed:false}],[{},[image()],{...options,imageReferences:[]}],[{'word/media/mhtml-resource-2.bin':png},[image()],options],[{},[image(),image()],{...options,sourceInputs:[source,source]}]])assert.throws(()=>api.mergeInlineImages(...args),e=>e.code==='INVALID_OFFICE_MODEL');
});
