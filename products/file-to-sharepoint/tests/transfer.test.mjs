import test from 'node:test';import assert from 'node:assert/strict';
import {createFileTransfer,FLIGHT_KEY} from '../src/app/transfer.js';
import {createTransferHandler} from '../../../src/transfer/handler.js';
const siteUrl='https://demo.sharepoint.com/sites/Files',hash='a'.repeat(64);
const model={title:'File',sourceHash:hash,blocks:[{id:'p',type:'text',html:'<p>Hello</p>'}],assets:[],warnings:[]};
function fixture({refuse=false,disconnect=false}={}) {
 let record={model,attempt:null},writes=0,claims=0;const durable={};
 const result={verified:true,publication:'unpublished',pageUrl:siteUrl+'/SitePages/file.aspx'};
 const store={load:async()=>record,picture:async()=>null,claimAttempt:async a=>{claims++;record.attempt=a;},releaseAttempt:async()=>{record.attempt=null;},completeAttempt:async r=>{record.attempt={...record.attempt,status:'complete',result:r};}};
 const chromeApi={storage:{local:{get:async key=>({[key]:durable[key]}),set:async values=>Object.assign(durable,values),remove:async key=>{delete durable[key];}}},tabs:{create:async()=>({id:9,status:'complete'}),get:async()=>({id:9,status:'complete',url:siteUrl}),update:async()=>{},sendMessage:async(id,m)=>{
 if(m.action==='inspect')return {ok:true,result:{supported:true,kind:'sharepoint',siteUrl}};
 if(m.action==='import'){if(refuse)return {ok:false,error:{code:'no-permission',message:'Refused before starting'}};writes++;if(disconnect)throw Error('Channel closed');return {ok:true,result:{started:true}};}
 if(m.action==='status')return {ok:true,result:{stage:'complete',attemptId:record.attempt.attemptId,result}};
 }},scripting:{executeScript:async()=>{}}};
 return {store,chromeApi,result,record:()=>record,writes:()=>writes,claims:()=>claims};
}
test('file send claims once and accepts only a verified unpublished draft',async()=>{const f=fixture();await createFileTransfer({...f,wait:async()=>{}}).send({model,siteUrl});assert.equal(f.writes(),1);assert.equal(f.claims(),1);assert.equal(f.record().attempt.status,'complete');});
test('a dropped import response reconciles the same attempt without repeating writes',async()=>{const f=fixture({disconnect:true});await createFileTransfer({...f,wait:async()=>{}}).send({model,siteUrl});assert.equal(f.writes(),1);assert.equal(f.record().attempt.status,'complete');});
test('a known before-start refusal releases the claim',async()=>{const f=fixture({refuse:true});await assert.rejects(createFileTransfer({...f,wait:async()=>{}}).send({model,siteUrl}),/Refused/);assert.equal(f.record().attempt,null);assert.equal(f.writes(),0);});
test('blocking reconstruction issues and a previous attempt stop before a new tab or write',async()=>{const f=fixture();const transfer=createFileTransfer({...f,wait:async()=>{}});await assert.rejects(transfer.send({model:{...model,warnings:[{blocking:true,message:'Missing content'}]},siteUrl}));f.record().attempt={status:'started'};await assert.rejects(transfer.send({model,siteUrl}));assert.equal(f.claims(),0);assert.equal(f.writes(),0);});
test('a browser-session loss keeps the durable send guard until explicit review',async()=>{const f=fixture();await f.chromeApi.storage.local.set({[FLIGHT_KEY]:{sourceHash:hash,siteUrl,attemptId:crypto.randomUUID()}});await assert.rejects(createFileTransfer({...f,wait:async()=>{}}).send({model,siteUrl}),/earlier send/);assert.equal(f.writes(),0);assert.equal(f.claims(),0);});
test('a missing form installation blocks before staging images or claiming a page send',async()=>{const f=fixture(),original=f.chromeApi.tabs.sendMessage;f.chromeApi.tabs.sendMessage=async(id,message)=>message.channel==='file-form'?{ok:false,error:{code:'form-not-ready',message:'Install the form runtime'}}:original(id,message);await assert.rejects(createFileTransfer({...f,wait:async()=>{}}).send({model,siteUrl,formDefinition:{fields:[{}]}}),/Install/);assert.equal(f.writes(),0);assert.equal(f.claims(),0);});
test('a status for a different attempt cannot confirm or release this send',async()=>{const f=fixture(),original=f.chromeApi.tabs.sendMessage;f.chromeApi.tabs.sendMessage=async(id,m)=>m.action==='status'?{ok:true,result:{attemptId:crypto.randomUUID(),stage:'complete',result:f.result}}:original(id,m);await assert.rejects(createFileTransfer({...f,wait:async()=>{}}).send({model,siteUrl}));assert.ok(f.record().attempt);assert.ok((await f.chromeApi.storage.local.get(FLIGHT_KEY))[FLIGHT_KEY]);});
test('published or cross-site completion receipts remain unconfirmed and cannot enable a resend',async()=>{for(const result of [{...fixture().result,publication:'published'},{...fixture().result,pageUrl:'https://other.sharepoint.com/SitePages/file.aspx'}]){const f=fixture(),original=f.chromeApi.tabs.sendMessage;f.chromeApi.tabs.sendMessage=async(id,m)=>m.action==='status'?{ok:true,result:{stage:'complete',attemptId:f.record().attempt.attemptId,result}}:original(id,m);await assert.rejects(createFileTransfer({...f,wait:async()=>{}}).send({model,siteUrl}));assert.ok(f.record().attempt);assert.equal(f.writes(),1);}});

async function stagedFixture({missing=1,refused=false}={}){
 const f=fixture(),bytes=new Uint8Array([1,2,3]),digest=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 const asset={id:digest,name:'fixture.png',mime:'image/png',width:1,height:1,size:bytes.length},source={...model,assets:[asset]};
 let pages=0,uploads=0;const delivered=[],acknowledged=[];
 f.store.picture=async()=>new Blob([bytes]);
 const destination=createTransferHandler({channel:'file-transfer',getRuntimeId:()=> 'ext',getLocation:()=>({href:siteUrl+'/SitePages/Home.aspx'}),inspectDestination:async()=>({supported:true,kind:'sharepoint',siteUrl}),createAssetClient:()=>({discoverLibrary:async()=>({serverRelativeUrl:'/sites/Files/SiteAssets'}),ensureImportFolder:async(library,name)=>library+'/'+name,uploadAsset:async(_folder,value)=>{uploads++;assert.deepEqual(value.bytes,bytes);return{assetId:value.id};},notes:()=>[]}),createDraftClient:async()=>({inspectSite:async()=>({}),createDraft:async()=>{pages++;return f.result;}})});
 f.chromeApi.tabs.sendMessage=async(_id,message)=>{
  if(message.action==='stage'){
   delivered.push(structuredClone(message.payload));if(refused)return{ok:false,error:{code:'invalid-picture',message:'Rejected piece'}};
   const result=await destination(message,{id:'ext'});acknowledged.push(result);return delivered.length<=missing?undefined:result;
  }
  return destination(message,{id:'ext'});
 };
 return {...f,source,delivered,acknowledged,pages:()=>pages,uploads:()=>uploads};
}
test('a missing local staging acknowledgement replays the identical piece, verifies its hash and creates one draft',async()=>{
 const f=await stagedFixture();await createFileTransfer({...f,wait:async()=>{}}).send({model:f.source,siteUrl});assert.equal(f.delivered.length,2);assert.deepEqual(f.delivered[0],f.delivered[1]);assert.ok(f.acknowledged.every(reply=>reply.ok&&reply.result.received===1));assert.equal(f.uploads(),1);assert.equal(f.pages(),1);assert.equal(f.claims(),1);assert.equal(f.record().attempt.status,'complete');
});
test('repeated missing staging acknowledgements stop before an attempt, upload or draft',async()=>{
 const f=await stagedFixture({missing:2});await assert.rejects(createFileTransfer({...f,wait:async()=>{}}).send({model:f.source,siteUrl}),/did not reach/);assert.equal(f.delivered.length,2);assert.equal(f.claims(),0);assert.equal(f.uploads(),0);assert.equal(f.pages(),0);assert.equal((await f.chromeApi.storage.local.get(FLIGHT_KEY))[FLIGHT_KEY],undefined);
});
test('an explicit staged-piece refusal is never retried',async()=>{
 const f=await stagedFixture({refused:true});await assert.rejects(createFileTransfer({...f,wait:async()=>{}}).send({model:f.source,siteUrl}),/did not reach/);assert.equal(f.delivered.length,1);assert.equal(f.claims(),0);assert.equal(f.uploads(),0);assert.equal(f.pages(),0);
});
