import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {adaptForms} from '../src/content/forms.js';
test('immutable form identity includes reviewed definition content, including renamed source titles',async()=>{
 const raw=JSON.parse(await readFile(new URL('./fixtures/content-forms.json',import.meta.url),'utf8')),options={sourceHash:'a'.repeat(64),title:'Original name'};
 const original=await adaptForms(raw,options),repeated=await adaptForms(raw,options),renamed=await adaptForms(raw,{...options,title:'Renamed source'});
 assert.equal(original.id,repeated.id);assert.notEqual(original.id,renamed.id);assert.deepEqual(original.fields,renamed.fields);
 const modified=structuredClone(raw);modified.forms.Fields.find(f=>f.name==='person_name').value='Bob';
 const changed=await adaptForms(modified,options);assert.notEqual(original.id,changed.id);
});
