import test from 'node:test';
import assert from 'node:assert/strict';
const implementation=await import('../src/content/pdf-links.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return{};throw error;});
const info=links=>({version:1,sourcePageCount:3,links,linkCount:links.length,unsupportedCount:0});
const section=(value,existingHrefs=[])=>{assert.equal(typeof implementation.createPdfLinkSection,'function');return implementation.createPdfLinkSection(value,existingHrefs);};
test('PDF annotation URLs become safe native links without fetching them',()=>{
 const r=section(info([{pageIndex:0,kind:'uri',url:'https://example.com/docs?a=1&b=2'}]));assert.match(r.html,/href="https:\/\/example.com\/docs\?a=1&amp;b=2"/);assert.match(r.html,/source page 1/);assert.equal(r.links,1);assert.deepEqual(r.targetPages,[]);
});
test('internal PDF links use bounded source-page anchors with explicit page-level adaptation',()=>{
 const r=section(info([{pageIndex:0,kind:'page',targetPageIndex:2}]));assert.match(r.html,/href="#file-pdf-page-3"/);assert.match(r.html,/Source page 3/);assert.deepEqual(r.targetPages,[2]);assert.equal(r.pageLinks,true);
});
test('repeated annotations and already retained native links do not duplicate the appendix',()=>{
 const data=info([{pageIndex:0,kind:'uri',url:'https://example.com/docs'},{pageIndex:1,kind:'uri',url:'https://example.com/docs'}]),r=section(data);assert.equal(r.links,1);assert.match(r.html,/source pages 1, 2/);assert.equal(section(data,['https://example.com/docs']).html,'');
});
test('unsafe actions and credential-bearing addresses stay inert and are counted',()=>{
 const data=info([{pageIndex:0,kind:'uri',url:'javascript:alert(1)'},{pageIndex:0,kind:'uri',url:'https://user:password@example.com/'}]);data.unsupportedCount=1;data.linkCount++;const r=section(data);assert.equal(r.html,'');assert.equal(r.unsupported,3);
});
test('partial, out-of-range and excessive annotation metadata is never accepted as complete',()=>{
 for(const value of [{...info([]),version:2},info([{pageIndex:3,kind:'uri',url:'https://example.com/'}]),info([{pageIndex:0,kind:'page',targetPageIndex:-1}]),info([{pageIndex:0,kind:'uri',url:5}]),{...info([]),links:Array(10001).fill({pageIndex:0,kind:'page',targetPageIndex:1})}])assert.throws(()=>section(value),{code:'PDF_LINKS_UNVERIFIED'});
});
