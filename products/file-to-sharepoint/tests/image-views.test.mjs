import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const api=await import('../src/engine/image-views.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const original=new Uint8Array([1,2,3]),sourceHash=createHash('sha256').update(original).digest('hex');
const png=()=>{const bytes=new Uint8Array(24);bytes.set([137,80,78,71,13,10,26,10]);const header=new DataView(bytes.buffer);header.setUint32(16,20);header.setUint32(20,40);return bytes;};
const drawing=(id,transformed=true)=>({type:'paraDrawing',graphic:{type:'image',id,spPr:{xfrm:{ext:{cx:95250,cy:190500},...(transformed?{flipH:true}:{})}},blipFill:{rasterImageId:'image1.png'}}});
const doc=()=>({type:'document',content:[{type:'paragraph',content:[drawing('transformed'),drawing('natural',false)]}]});
const media={'word/media/image1.png':original};
const view=()=>({bytes:png(),mime:'image/png',width:20,height:40,viewport:{x:0,y:0,width:10,height:20,unit:'px'},source:{resourceName:'word/media/image1.png',sourceHash,sourceBytes:3,xfrm:structuredClone(drawing('transformed').graphic.spPr.xfrm),srcRect:null},affine:{xPixelsPerMm:2*96/25.4,yPixelsPerMm:2*96/25.4,bounds:{min_x:0,min_y:0,max_x:19,max_y:39}},density:2,requestedDensity:2,densityLimited:false});

test('only transformed images can receive SDK views bound to exact source bytes and native transforms',async()=>{
  assert.equal(typeof api.verifyImageViews,'function');
  const views={transformed:view()},result=await api.verifyImageViews(doc(),media,views,[]);
  assert.equal(result.imageViews,views);assert.deepEqual(result.warnings,[]);
  const natural={type:'document',content:[{type:'paragraph',content:[drawing('natural',false)]}]};
  assert.deepEqual(await api.verifyImageViews(natural,media,{},[]),{imageViews:{},warnings:[]});
  const identity=drawing('identity',false).graphic;identity.blipFill.srcRect={l:0,t:0,r:100,b:100};
  assert.equal(api.hasImageViewTransform(identity),false);
  identity.blipFill.srcRect={l:0,t:0,r:100};assert.equal(api.hasImageViewTransform(identity),true);
  identity.blipFill.srcRect={l:0,t:0,r:100,b:null};assert.equal(api.hasImageViewTransform(identity),true);
  identity.blipFill.srcRect={l:10,t:0,r:100,b:100};assert.equal(api.hasImageViewTransform(identity),true);
  delete identity.blipFill.srcRect;
  for(const [key,value]of [['rot',NaN],['rot','0'],['flipH',0],['flipH','false']]){
    const malformed=structuredClone(identity);malformed.spPr.xfrm[key]=value;assert.equal(api.hasImageViewTransform(malformed),true);
  }
  identity.blipFill.srcRect=0;assert.equal(api.hasImageViewTransform(identity),true);
});

test('missing, forged, foreign and oversized views are rejected before adaptation',async()=>{
  assert.equal(typeof api.verifyImageViews,'function');
  for(const change of [
    value=>{delete value.transformed;},value=>{value.natural=view();},
    value=>{value.transformed.source.sourceHash='0'.repeat(64);},
    value=>{value.transformed.source.xfrm.flipH=false;},value=>{value.transformed.source.srcRect={l:50,r:100};},
    value=>{value.transformed.source.resourceName='https://images.invalid/source.png';},
    value=>{value.transformed.width=21;},value=>{value.transformed.viewport.width=50;},
    value=>{value.transformed.density=1;},value=>{value.transformed.densityLimited=true;},
    value=>{value.transformed.affine.xPixelsPerMm=1;},value=>{value.transformed.affine.bounds.max_x=20;},
    value=>{value.transformed.viewport.x=Infinity;},value=>{value.transformed.bytes=new Uint8Array(33*1024*1024);},
  ]){
    const views={transformed:view()};change(views);
    await assert.rejects(()=>api.verifyImageViews(doc(),media,views,[]),error=>error.code==='INVALID_OFFICE_MODEL');
  }
  await assert.rejects(()=>api.verifyImageViews(doc(),{...media,'other/image1.png':original},{transformed:view()},[]),error=>error.code==='INVALID_OFFICE_MODEL');
});

test('an unavailable transformed image must have exactly one explicit blocking warning',async()=>{
  assert.equal(typeof api.verifyImageViews,'function');
  const warnings=[{code:'IMAGE_VIEW_UNAVAILABLE',sourceId:'transformed',message:'The animated transformed image cannot be rendered safely.',blocking:true}];
  assert.deepEqual(await api.verifyImageViews(doc(),media,{},warnings),{imageViews:{},warnings});
  for(const bad of [[{...warnings[0],blocking:false}],[...warnings,...warnings],[{...warnings[0],sourceId:'natural'}]])
    await assert.rejects(()=>api.verifyImageViews(doc(),media,{},bad),error=>error.code==='INVALID_OFFICE_MODEL');
  await assert.rejects(()=>api.verifyImageViews(doc(),media,{transformed:view()},warnings),error=>error.code==='INVALID_OFFICE_MODEL');
});

test('only exact needed local resources are hydrated, with duplicates shared and unrelated media excluded',()=>{
  assert.equal(typeof api.imageViewResources,'function');
  const input={...media,'word/media/unrelated.png':Uint8Array.of(99)},document=doc();document.content[0].content.push(drawing('same-source'));
  const selected=api.imageViewResources(document,input);
  assert.deepEqual(Object.keys(selected),['word/media/image1.png']);assert.equal(selected['word/media/image1.png'],original);
  assert.deepEqual(Object.keys(api.imageViewResources({type:'document',content:[drawing('ordinary',false)]},input)),[]);
  assert.throws(()=>api.imageViewResources(document,{}),error=>error.code==='INVALID_OFFICE_MODEL');
});
