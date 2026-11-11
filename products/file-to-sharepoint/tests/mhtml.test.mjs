import test from 'node:test';
import assert from 'node:assert/strict';

const mhtml=(html='<p>Crème &amp; editable</p>',extra='',headers='')=>new TextEncoder().encode(
  'MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="local-archive"\r\n\r\n'+
  '--local-archive\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\nContent-Location: file:///C:/exported.html\r\n'+headers+'\r\n'+html+'\r\n'+extra+'--local-archive--\r\n');
const image='--local-archive\r\nContent-Type: application/octet-stream\r\nContent-Transfer-Encoding: base64\r\nContent-Location: file:///C:/pictures/exact.bin\r\nContent-ID: <local-picture>\r\n\r\niVBORw0KGgo=\r\n';
const load=()=>import('../src/engine/mhtml.js');

test('native Word MHTML retains decoded Unicode, original resource identities and exact binary bytes',async()=>{
  const {parseMhtml,isMhtmlDocument}=await load(),source=mhtml(undefined,image);
  assert.equal(isMhtmlDocument(source),true);
  const result=parseMhtml(source);
  assert.equal(result.html,'<p>Crème &amp; editable</p>');
  assert.equal(result.rootLocation,'file:///C:/exported.html');
  assert.equal(result.resources.length,1);
  assert.deepEqual(result.resources[0],{name:'mhtml-resource-1.bin',location:'file:///C:/pictures/exact.bin',contentId:'local-picture',mime:'application/octet-stream',bytes:Uint8Array.of(137,80,78,71,13,10,26,10)});
  assert.equal(result.media['word/media/mhtml-resource-1.bin'],result.resources[0].bytes);
  assert.equal(result.expandedBytes>result.resources[0].bytes.length,true);
});

test('MHTML sniffing leaves genuine OLE DOC and other native formats on their existing converter path',async()=>{
  const {isMhtmlDocument}=await load();
  for(const bytes of [Uint8Array.of(208,207,17,224,161,177,26,225),new TextEncoder().encode('{\\rtf1 example}'),new TextEncoder().encode('<html><p>not MIME</p></html>')])assert.equal(isMhtmlDocument(bytes),false);
});

test('MHTML refuses truncated, ambiguous, nested or non-related containers instead of joining source bodies',async()=>{
  const {parseMhtml}=await load();
  const valid=new TextDecoder().decode(mhtml());
  const invalid=[
    valid.replace('--local-archive--\r\n',''),
    valid.replace('multipart/related','multipart/mixed'),
    valid.replace('--local-archive--','--local-archive\r\nContent-Type: text/html\r\nContent-Location: file:///C:/second.html\r\n\r\n<p>Second</p>\r\n--local-archive--'),
    new TextDecoder().decode(mhtml(undefined,'--local-archive\r\nContent-Type: multipart/related; boundary="nested"\r\n\r\n--nested\r\nContent-Type: text/plain\r\n\r\nno\r\n--nested--\r\n')),
    new TextDecoder().decode(mhtml(undefined,'','Content-Location: file:///C:/other.html\r\n')),
    valid.replace('Content-Location: file:///C:/exported.html\r\n',''),
  ];
  for(const source of invalid)assert.throws(()=>parseMhtml(new TextEncoder().encode(source)),{code:'INVALID_MHTML'});
});

test('MHTML rejects resource identity collisions and unsafe paths before any HTML is attached',async()=>{
  const {parseMhtml}=await load();
  for(const path of ['file:///C:/pictures/../exact.bin','file:///C:/pictures/%2e%2e/exact.bin','file:///C:/pictures/%2fexact.bin','javascript:alert(1)']){
    assert.throws(()=>parseMhtml(mhtml(undefined,image.replace('file:///C:/pictures/exact.bin',path))),{code:'UNSAFE_MHTML_RESOURCE'});
  }
  assert.throws(()=>parseMhtml(mhtml(undefined,image+image)),{code:'AMBIGUOUS_MHTML_RESOURCE'});
});

test('MHTML enforces source and header limits before the untrusted MIME tree can expand',async()=>{
  const {parseMhtml}=await load();
  assert.throws(()=>parseMhtml(new Uint8Array(50*1024*1024+1)),{code:'DOCUMENT_TOO_LARGE'});
  assert.throws(()=>parseMhtml(mhtml(undefined,'','X-Oversized: '+ 'x'.repeat(65536)+'\r\n')),{code:'DOCUMENT_TOO_LARGE'});
});

test('invalid declared UTF-8 cannot silently become replacement characters in editable content',async()=>{
  const {parseMhtml}=await load(),source=mhtml('<p>editable</p>');
  source[new TextDecoder().decode(source).indexOf('<p>editable')+3]=255;
  assert.throws(()=>parseMhtml(source),{code:'INVALID_MHTML'});
});
