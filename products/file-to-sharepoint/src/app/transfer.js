import {siteKey} from '../../../../src/background/sites.js';
import {confirmedPageUrl} from '../../../../src/background/checks.js';
import {bytesToBase64,PICTURE_PIECE_BYTES} from '../../../../src/transfer/limits.js';
export const FLIGHT_KEY='file-send-in-flight-v1';
const failure=(code,message)=>Object.assign(new Error(message),{code});

/** The destination tab owns a detached send. Persist its identity before asking
 * it to write; reconnect to that identity after a lost message or workspace close. */
export function createFileTransfer({chromeApi=globalThis.chrome,store,destinationScript='destination.js',wait=ms=>new Promise(r=>setTimeout(r,ms)),onProgress=()=>{}}) {
  if(!['destination.js','file-destination.js'].includes(destinationScript))throw failure('invalid-destination-script','The file destination script is invalid.');
  const local=chromeApi.storage?.local;
  const message=(tabId,action,payload={})=>chromeApi.tabs.sendMessage(tabId,{channel:'file-transfer',action,payload});
  async function release(attempt) {
    await store.releaseAttempt(attempt.attemptId);
    if(local)await local.remove(FLIGHT_KEY);
  }
  async function follow(attempt,{once=false}={}) {
    for(let i=0;i<(once?1:600);i++) {
      let response;try{response=await message(attempt.tabId,'status');}catch{throw failure('send-unconfirmed','The destination tab cannot be reached. Review Site Pages before starting another import.');}
      const state=response?.ok&&response.result;
      if(!state||state.attemptId!==attempt.attemptId)throw failure('send-unconfirmed','The destination no longer knows this send. Review Site Pages before starting another import.');
      onProgress(state);
      if(state.stage==='complete') {
        const url=confirmedPageUrl(state.result,attempt);
        await store.completeAttempt(state.result);
        if(local)await local.remove(FLIGHT_KEY);
        // Saving succeeds even if opening its tab is refused; never resend it.
        await chromeApi.tabs.update(attempt.tabId,{url,active:true}).catch(()=>{});
        return state.result;
      }
      if(state.stage==='failed') {
        if(state.error?.draftMayExist!==true)await release(attempt);
        throw Object.assign(failure(state.error?.code??'send-stopped',state.error?.message??'The send stopped. Review SharePoint.'),{draftMayExist:state.error?.draftMayExist===true});
      }
      if(once)return null;
      await wait(1000);
    }
    throw failure('send-unconfirmed','This send is still unconfirmed. Keep its SharePoint tab open and check its status again.');
  }
  return {
    follow,
    async send({model,siteUrl,formDefinition=null}) {
      const destination=siteKey(siteUrl);
      if(!destination||destination!==siteUrl)throw failure('invalid-site','Enter the SharePoint site address, such as https://company.sharepoint.com/sites/Team (the site address).');
      if(model.warnings?.some(w=>w.blocking))throw failure('content-needs-adaptation','This document contains content that needs adaptation before it can be sent.');
      const existing=await store.load();
      if(existing?.attempt||(local&&(await local.get(FLIGHT_KEY))[FLIGHT_KEY]))throw failure('already-attempted','An earlier send needs review before starting another import.');
      const tab=await chromeApi.tabs.create({url:destination,active:false});
      for(let i=0;i<120;i++) {
        const current=await chromeApi.tabs.get(tab.id);
        if(current.status==='complete')break;
        if(i===119)throw failure('site-not-ready','The SharePoint site is still loading. Open its tab and finish signing in.');
        await wait(500);
      }
      await chromeApi.scripting.executeScript({target:{tabId:tab.id},files:[destinationScript]});
      const inspected=await message(tab.id,'inspect');
      if(!inspected?.ok||inspected.result?.kind!=='sharepoint'||!inspected.result.supported||inspected.result.siteUrl!==destination)
        throw failure('site-not-ready',inspected?.result?.reason??'Open the SharePoint tab and sign in to a site that can create draft pages.');
      const sent=structuredClone(model);delete sent.fileReview;
      if(formDefinition) {
        onProgress({stage:'forms'});
        const prepared=await chromeApi.tabs.sendMessage(tab.id,{channel:'file-form',action:'prepare',siteUrl:destination,definition:formDefinition});
        if(!prepared?.ok)throw failure(prepared?.error?.code??'form-not-ready',prepared?.error?.message??'Install the File to SharePoint form package before importing interactive forms.');
        const {formId,definitionListId,responseListId}=prepared.result;
        sent.blocks.push({id:'file-interactive-form',type:'form',formId,definitionListId,responseListId,fieldCount:formDefinition.fields.length});
      }
      for(const asset of sent.assets) {
        const file=await store.picture(asset.id);
        if(!(file instanceof Blob)||file.size!==asset.size)throw failure('missing-image','A local image is no longer available. Choose the source file again.');
        const bytes=new Uint8Array(await file.arrayBuffer());
        for(let offset=0;offset<bytes.length;offset+=PICTURE_PIECE_BYTES) {
          const response=await message(tab.id,'stage',{id:asset.id,size:bytes.length,offset,data:bytesToBase64(bytes.subarray(offset,offset+PICTURE_PIECE_BYTES))});
          if(!response?.ok)throw failure('staging-failed','An image did not reach the destination intact. Nothing was sent.');
        }
      }
      const attempt={sourceHash:sent.sourceHash,attemptId:crypto.randomUUID(),siteUrl:destination,tabId:tab.id,startedAt:Date.now()};
      if(local)await local.set({[FLIGHT_KEY]:attempt});
      try{await store.claimAttempt(attempt);}catch(error){if(local)await local.remove(FLIGHT_KEY);throw error;}
      let response;
      try{response=await message(tab.id,'import',{model:sent,siteUrl:destination,attemptId:attempt.attemptId,detach:true});}
      catch{/* The tab may already be writing. Status of this exact attempt is the only recovery. */}
      if(response?.ok===false){await release(attempt);throw failure(response.error?.code??'send-refused',response.error?.message??'The destination refused before starting.');}
      return follow(attempt);
    }
  };
}
