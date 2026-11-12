import {createTransferHandler} from '../../../../src/transfer/handler.js';

// Injection is idempotent in this extension's isolated world. No source-page
// capture or browser/page messages can start an import.
if(!globalThis.__fileToSharePointDestination) {
  globalThis.__fileToSharePointDestination=true;
  const handler=createTransferHandler({channel:'file-transfer',sourceKind:'file',sourceLabel:'the source file',importFolderPrefix:'file-import',
    beforeImport:async({model})=>{
      if(model.warnings?.some(w=>w.blocking))throw Error('This document contains content that requires adaptation.');
    }
  });
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(sender?.id!==chrome.runtime.id)return false;
    if(message?.channel==='file-transfer'){handler(message,sender).then(reply);return true;}
    return false;
  });
}
