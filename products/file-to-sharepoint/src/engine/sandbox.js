(() => {
  'use strict';
  const nonce = location.hash.slice(1), channel = 'fts-office-model';
  if (!/^[0-9a-f-]{36}$/.test(nonce) || parent === window) return;
  const send = (value,transfers=[]) => parent.postMessage({channel,nonce,...value},'*',transfers);
  let used = false, api;
  try {
    api = new Asc.asc_docs_api({'id-view':'editor_sdk'});
    api.disableAutostartMacros = true;
    api.isSpellCheckEnable = false;
    api.isCoAuthoringEnable = false;
  } catch {send({type:'error',message:'The packaged Office model could not initialize.'});return;}
  const ready = setInterval(() => {
    if (api.isLoadFullApi && api.WordControl) {clearInterval(ready);send({type:'ready'});}
  },10);
  addEventListener('message',event => {
    const data = event.data;
    if (event.source !== parent || data?.channel !== channel || data.nonce !== nonce || data.type !== 'open' || used) return;
    used = true;
    try {
      if (!(data.officeBin instanceof Uint8Array) || data.officeBin.byteLength > 150 * 1024 * 1024 || new TextDecoder().decode(data.officeBin.subarray(0,4)) !== 'DOCY') throw new Error();
      api.asc_nativeOpenFile(data.officeBin);
      const documentApi = AscBuilder.Word.Api.GetDocument();
      const json = documentApi.ToJSON(true,true,true,true,true,true);
      if (typeof json !== 'string' || json.length > 50 * 1024 * 1024) throw new Error();
      const {decorations,warnings} = ftsExportDecorations(documentApi,JSON.parse(json));
      send({type:'result',json,decorations,warnings},Object.values(decorations).map(value=>value.bytes.buffer));
    } catch {send({type:'error',message:'The editable Office document model could not be read.'});}
  });
})();
