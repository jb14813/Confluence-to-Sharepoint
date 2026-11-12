import test from 'node:test';
import assert from 'node:assert/strict';
const {readPdfLinkAnnotations}=await import('../src/engine/pdf-annotations.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const pages=[{originIndex:7},{originIndex:3}];

test('native annotation action chains retain URI and internal destinations and account for unsupported actions',()=>{
 assert.equal(typeof readPdfLinkAnnotations,'function');
 const result=readPdfLinkAnnotations(index=>index===7?[{type:1,A:{S:6,URI:'https://example.com',Next:{S:1,page:3,Next:{S:14}}}}]:[],pages);
 assert.deepEqual(result,{version:1,sourcePageCount:2,links:[{pageIndex:0,kind:'uri',url:'https://example.com'},{pageIndex:0,kind:'page',targetPageIndex:1}],linkCount:3,unsupportedCount:1});
});

test('unknown page destinations and empty link actions are reported without executing them',()=>{
 const result=readPdfLinkAnnotations(()=>[{type:1,A:{S:1,page:99}},{type:1},{type:2,A:{S:6,URI:'https://ignored.example'}}],[{originIndex:0}]);
 assert.equal(result.linkCount,2);assert.equal(result.unsupportedCount,2);assert.deepEqual(result.links,[]);
});

test('cyclic, excessive and malformed native action metadata fail with bounded work',()=>{
 const cyclic={S:6,URI:'https://example.com'};cyclic.Next=cyclic;
 for(const entries of [[{type:1,A:cyclic}],[{type:1,A:{S:6,URI:'https://example.com',Next:[]}}],Array.from({length:10001},()=>({type:1,A:{S:14}}))])assert.throws(()=>readPdfLinkAnnotations(()=>entries,[{originIndex:0}]),error=>error.code==='PDF_LINKS_UNVERIFIED');
 assert.throws(()=>readPdfLinkAnnotations(()=>null,pages),error=>error.code==='PDF_LINKS_UNVERIFIED');
});
