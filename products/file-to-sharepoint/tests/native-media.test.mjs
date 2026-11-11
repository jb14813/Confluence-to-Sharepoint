import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
const api=await import('../src/engine/native-media.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const bytes=(...values)=>Uint8Array.from(values),source=bytes(68,79,67,88),hash=async value=>Buffer.from(await webcrypto.subtle.digest('SHA-256',value)).toString('hex');
function filesystem(files,{oversized=false,symlink=false}={}){
 const reads=[];return {reads,readdir(){return ['.','..',...Object.keys(files)];},lstat(path){return {mode:symlink?1:2,size:oversized?151*1024*1024:files[path.split('/').at(-1)].length};},isFile(mode){return mode===2;},readFile(path){reads.push(path);return files[path.split('/').at(-1)].slice();}};
}
const refused=promise=>assert.rejects(promise,error=>error.code==='NATIVE_MEDIA_UNVERIFIED');

test('identical native copies leave original image bytes and the ordinary result shape unchanged',async()=>{
 assert.equal(typeof api.collectNativeMedia,'function');
 const original={'word/media/image1.png':bytes(1,2,3)},fs=filesystem({'image1.png':bytes(1,2,3)});
 assert.equal(await api.collectNativeMedia(fs,original,source),undefined);
 assert.deepEqual(original['word/media/image1.png'],bytes(1,2,3));
});

test('new native image names and explicit replacements are bound to the exact converted DOCX',async()=>{
 assert.equal(typeof api.reconcileNativeMedia,'function');
 const original={'word/media/image1.bmp':bytes(1,2,3),'word/media/image2.png':bytes(4,5,6)},fs=filesystem({'image1.png':bytes(7,8,9),'image2.png':bytes(10,11,12)});
 const manifest=await api.collectNativeMedia(fs,original,source),before=structuredClone(original);
 assert.equal(manifest.sourceDocxHash,await hash(source));assert.equal(manifest.files.length,2);
 const result=await api.reconcileNativeMedia(original,manifest,source);
 assert.deepEqual(original,before);assert.deepEqual(result.media['word/media/image1.png'],bytes(7,8,9));assert.deepEqual(result.media['word/media/image2.png'],bytes(10,11,12));
 assert.equal(result.receipts[0].sourceDocxHash,await hash(source));assert.equal(result.receipts[0].derivedHash,await hash(bytes(7,8,9)));assert.equal(result.receipts[0].originalHash,null);
 assert.equal(result.receipts[1].originalHash,await hash(bytes(4,5,6)));assert.equal(result.receipts[1].originalBytes,3);
});

test('cross-document reuse, changed bytes, duplicate names and unexpected receipt fields are rejected',async()=>{
 assert.equal(typeof api.collectNativeMedia,'function');
 const original={},manifest=await api.collectNativeMedia(filesystem({'image1.png':bytes(1,2,3)}),original,source);
 await refused(api.reconcileNativeMedia(original,manifest,bytes(1)));
 for(const change of [value=>{value.version=2;},value=>{value.files[0].bytes[0]=9;},value=>{value.files[0].sha256='0'.repeat(64);},value=>{value.files.push(structuredClone(value.files[0]));},value=>{value.extra=true;},value=>{value.files[0].url='https://example.test/image.png';},value=>{value.files[0].name='word/media/../other.png';}]){
  const changed=structuredClone(manifest);change(changed);await refused(api.reconcileNativeMedia(original,changed,source));
 }
});

test('native output collection refuses links, paths and excessive allocation before reading bytes',async()=>{
 assert.equal(typeof api.collectNativeMedia,'function');
 for(const fs of [filesystem({'../bad.png':bytes(1)}),filesystem({'image.png':bytes(1)},{symlink:true}),filesystem({'image.png':bytes(1)},{oversized:true})]){
  await refused(api.collectNativeMedia(fs,{},source));assert.equal(fs.reads.length,0);
 }
 const count=filesystem(Object.fromEntries(Array.from({length:4097},(_,i)=>['image'+i+'.png',bytes(1)])));await refused(api.collectNativeMedia(count,{},source));assert.equal(count.reads.length,0);
});
