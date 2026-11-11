import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const context=vm.createContext({TextDecoder,TextEncoder});vm.runInContext(await readFile(new URL('../vendor/xmldom.js',import.meta.url),'utf8'),context);
const api=await import('../src/engine/office-xml.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const encode=value=>new TextEncoder().encode(value),xml=text=>`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;

test('valid source replacement characters survive strict Office XML parsing without hiding decoding errors',()=>{
  assert.equal(typeof api.parseOfficeXml,'function');
  const parsed=api.parseOfficeXml(encode(xml('Source \ufffd Ω😀')),context.EngineXml.DOMParser);
  assert.equal(parsed.documentElement.textContent,'Source \ufffd Ω😀');
  const invalid=encode(xml('!'));invalid[Array.from(invalid).indexOf(33)]=255;
  assert.throws(()=>api.parseOfficeXml(invalid,context.EngineXml.DOMParser),e=>e.code==='INVALID_DOCUMENT');
});

test('Office XML still rejects syntax repair warnings and every unrelated parser failure',()=>{
  assert.equal(typeof api.parseOfficeXml,'function');
  for(const input of [xml('\ufffd\u0000'),xml('\ufffd&#0;'),xml('&unknown;'),xml('source').replace('xmlns:w="','xmlns:w='),xml('source').replace('</w:t>','</bad>')])assert.throws(()=>api.parseOfficeXml(encode(input),context.EngineXml.DOMParser),e=>e.code==='INVALID_DOCUMENT');
});
