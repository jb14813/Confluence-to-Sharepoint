import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {imageViewGraphics} from '../src/engine/image-views.js';
const image=()=>({type:'image',id:'header-image',spPr:{xfrm:{rot:15}},blipFill:{rasterImageId:'word/media/header.png'}});
const header=()=>({type:'hdr',ftsSourceId:'source-header',content:{type:'docContent',content:[{type:'paraDrawing',graphic:image()}]}});

test('repeated exact source-part metadata shares image verification without weakening body identities',()=>{
  const first=header(),copy=structuredClone(first);
  assert.equal(imageViewGraphics({type:'document',sectPr:{headerReference:{default:first,even:copy}},content:[]}).size,1);
  copy.content.content[0].graphic.spPr.xfrm.rot=99;
  assert.throws(()=>imageViewGraphics({sectPr:{headerReference:{default:first,even:copy}},content:[]}),{code:'INVALID_OFFICE_MODEL'});
  assert.throws(()=>imageViewGraphics({content:[image(),image()]}),{code:'INVALID_OFFICE_MODEL'});
});

const window={};
vm.runInNewContext(await readFile(new URL('../src/engine/sandbox-image-views.js',import.meta.url),'utf8'),{window,Map,Set,WeakSet});
test('SDK enumeration includes real endnote graphics and deduplicates only exact native objects',()=>{
  assert.equal(typeof window.ftsDocumentDrawingObjects,'function');
  const body={Get_Id:()=> 'body'},end={Get_Id:()=> 'end'};
  const doc={GetAllDrawingObjects:()=>[{Drawing:body}],Document:{Endnotes:{GetAllDrawingObjects:array=>{array.push({GraphicObj:end},{GraphicObj:body});return array;}}}};
  const drawings=window.ftsDocumentDrawingObjects(doc);
  assert.deepEqual(Array.from(drawings,value=>value.Drawing),[body,end]);
  doc.Document.Endnotes.GetAllDrawingObjects=array=>{array.push({GraphicObj:{Get_Id:()=> 'body'}});return array;};
  assert.throws(()=>window.ftsDocumentDrawingObjects(doc),/duplicated|invalid/i);
});
