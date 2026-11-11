import test from 'node:test';
import assert from 'node:assert/strict';
import {matchPdfTextUnits} from '../src/content/pdf-text-order.js';

const source=(text,boxes)=>({pageIndex:0,widthPt:100,heightPt:100,rotation:0,unicodeScalars:Array.from(text,c=>c.codePointAt(0)),scalarBoxesPt:boxes});
const run=(s,units)=>matchPdfTextUnits({source:s,units,meaningfulText:value=>value.replace(/\s/gu,'')});

test('unique exact source text proves identity even when reconstructed font metrics differ',()=>{
 const s=source('👉🏼Instructions',[[10,10,15,20],[15,10,20,20],...Array.from('Instructions',(_,i)=>[20+i,10,21+i,20])]);
 const result=run(s,[{id:'instruction',text:'Instructions',sourceBoxPt:[20,10,40,20]},{id:'emoji',text:'👉🏼',sourceBoxPt:[10,12,13,19]}]);
 assert.equal(result.ok,true);assert.deepEqual(result.orderedIds,['emoji','instruction']);
 assert.deepEqual(result.assignments.map(a=>[a.start,a.end]),[[2,14],[0,2]]);
});

test('geometry resolves only remaining exact-text ambiguity and cannot fabricate text identity',()=>{
 const s=source('ABAB',[[0,0,1,1],[1,0,2,1],[0,10,1,11],[1,10,2,11]]);
 const units=[{id:'second',text:'AB',sourceBoxPt:[0,10,2,11]},{id:'first',text:'AB',sourceBoxPt:[0,0,2,1]}];
 assert.deepEqual(run(s,units).orderedIds,['first','second']);
 assert.equal(run(s,units.map(u=>({...u,sourceBoxPt:undefined}))).code,'ambiguous-coverage');
 assert.equal(run(s,[{...units[0],text:'AC'},units[1]]).code,'no-contiguous-source-span');
 // Disjoint complete text coverage can resolve a repeated substring itself.
 assert.equal(run(s,[{id:'whole',text:'ABA'},{id:'tail',text:'B',sourceBoxPt:[90,90,91,91]}]).ok,true);
});

test('long repeated prefixes share the comparison budget with candidate scanning',()=>{
 const plain=Array.from('A'.repeat(300)+'B',c=>c.codePointAt(0));let reads=0;
 const unicodeScalars=new Proxy(plain,{get(array,key){if(/^\d+$/.test(String(key)))reads++;return array[key];}});
 const s={...source('',plain.map(()=>[0,0,1,1])),unicodeScalars};
 const result=matchPdfTextUnits({source:s,units:[{id:'tail',text:'A'.repeat(150)+'B'},{id:'head',text:'A'.repeat(150)}],meaningfulText:value=>value,maxMatchAttempts:1000});
 assert.equal(result.ok,false);assert.equal(result.code,'coverage-limit');assert.ok(reads<=1000,`Scalar reads exceeded the comparison budget: ${reads}`);
 // An ordinary unique match still succeeds within a proportionate budget.
 assert.equal(matchPdfTextUnits({source:source('AB',[[0,0,1,1],[1,0,2,1]]),units:[{id:'whole',text:'AB'}],meaningfulText:value=>value,maxMatchAttempts:10}).ok,true);
});

test('coverage and geometry checks also stop within the shared matching budget',()=>{
 let reads=0;const boxes=Array.from({length:60},(_,index)=>[0,index,1,index+1]);
 const scalarBoxesPt=new Proxy(boxes,{get(array,key){if(/^\d+$/.test(String(key)))reads++;return array[key];}});
 const s={...source('A'.repeat(60),boxes),scalarBoxesPt};
 const units=Array.from({length:60},(_,index)=>({id:'unit-'+index,text:'A',sourceBoxPt:[0,index,1,index+1]}));
 const result=matchPdfTextUnits({source:s,units,meaningfulText:value=>value,maxMatchAttempts:10000});
 assert.equal(result.ok,false);assert.equal(result.code,'coverage-limit');assert.ok(reads<=10060,`Geometry reads exceeded the work and initial-validation bounds: ${reads}`);
});
