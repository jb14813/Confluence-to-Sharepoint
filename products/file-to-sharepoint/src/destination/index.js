import {createTransferHandler} from '../../../../src/transfer/handler.js';
import {detectSharePointSite} from '../../../../src/sharepoint/detect.js';
import {checkFormReadiness,prepareForm} from './forms.js';

// Injection is idempotent in this extension's isolated world. No source-page
// capture or browser/page messages can start an import.
if(!globalThis.__fileToSharePointDestination) {
  globalThis.__fileToSharePointDestination=true;
  const prepared=new Map();
  const handler=createTransferHandler({channel:'file-transfer',sourceKind:'file',sourceLabel:'the source file',importFolderPrefix:'file-import',
    beforeImport:async({siteUrl,model})=>{
      if(model.warnings?.some(w=>w.blocking))throw Error('This document contains content that requires adaptation.');
      for(const block of model.blocks.filter(b=>b.type==='form')) {
        const known=prepared.get(block.formId);
        if(!known||known.definitionListId!==block.definitionListId||known.responseListId!==block.responseListId)throw Error('The interactive form has not been prepared in this site tab.');
        const current=await checkFormReadiness({siteUrl,definitionListId:block.definitionListId,responseListId:block.responseListId});
        if(current.needsSetup||current.definitionListId!==block.definitionListId||current.responseListId!==block.responseListId)throw Error('The form installation changed. Check the site before importing.');
      }
    }
  });
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(sender?.id!==chrome.runtime.id)return false;
    if(message?.channel==='file-transfer'){handler(message,sender).then(reply);return true;}
    if(message?.channel!=='file-form'||message.action!=='prepare'||Object.keys(message).some(k=>!['channel','action','siteUrl','definition'].includes(k)))return false;
    (async()=>{
      const site=await detectSharePointSite({location:globalThis.location});
      if(!site.supported||site.kind!=='sharepoint'||site.siteUrl!==message.siteUrl)throw Error('Open and sign in to the selected SharePoint site.');
      const result=await prepareForm({siteUrl:site.siteUrl,definition:message.definition});
      prepared.set(result.formId,result);return result;
    })().then(result=>reply({ok:true,result}),error=>reply({ok:false,error:{code:'form-not-ready',message:String(error.message).slice(0,1200)}}));
    return true;
  });
}
