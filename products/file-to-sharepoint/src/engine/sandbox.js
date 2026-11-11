(() => {
  'use strict';
  const nonce = location.hash.slice(1), channel = 'fts-office-model';
  if (!/^[0-9a-f-]{36}$/.test(nonce) || parent === window) return;
  const send = (value,transfers=[]) => {if(!disposed)parent.postMessage({channel,nonce,...value},'*',transfers);};
  function readDocument(documentApi,htmlState){
    // Same composition as the pinned SDK's ApiDocument.ToJSON. A local writer
    // associates each serialized paragraph with its effective SDK numbering,
    // including styles, table cells and textboxes. No global/prototype patch.
    const writer=new AscJsonConverter.WriterToJSON(),serialize=writer.SerParagraph;
    writer.SerParagraph=function(paragraph,...args){
      const output=serialize.call(this,paragraph,...args),pr=paragraph.GetNumPr();
      if(pr){
        const parent=paragraph.GetParent(),num=parent.GetNumbering().GetNum(pr.NumId);
        output.ftsNumbering={numId:String(pr.NumId),scopeId:String(parent.GetTopDocumentContent().Get_Id()),level:pr.Lvl,
          value:parent.CalculateNumberingValues(paragraph,pr)[pr.Lvl],label:paragraph.GetNumberingText(false),
          definition:num.GetLvl(pr.Lvl).ToJson(pr.Lvl),font:paragraph.GetNumberingTextPr().FontFamily?.Name};
      }
      return output;
    };
    ftsRetainVerticalMergeAnchors(writer);
    ftsRetainResolvedCellAlignment(writer);
    ftsPreserveNativeUnicode(writer);
    ftsCaptureNativeNotes(writer);
    ftsInstallHtmlWriter(writer,htmlState);
    return JSON.stringify({type:'document',textPr:writer.SerTextPr(documentApi.GetDefaultTextPr().TextPr),
      paraPr:writer.SerParaPr(documentApi.GetDefaultParaPr().ParaPr),theme:writer.SerTheme(documentApi.Document.GetTheme()),
      sectPr:writer.SerSectionPr(documentApi.Document.SectPr),content:writer.SerContent(documentApi.Document.Content,undefined,undefined,undefined,true),
      numbering:writer.jsonWordNumberings,styles:writer.SerWordStylesForWrite()});
  }
  let used = false, api, disposed = false, readyForOpen = false;
  function imageMedia(json,inlineImages){
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);removeEventListener('message',receive);};
      const receive=event=>{const value=event.data;if(event.source!==parent||value?.channel!==channel||value.nonce!==nonce||value.type!=='image-media')return;cleanup();resolve(value.media);};
      const timer=setTimeout(()=>{cleanup();reject(new Error('The local image resources could not be loaded.'));},12000);
      addEventListener('message',receive);send({type:'image-media',json,inlineImages});
    });
  }
  try {
    api = new Asc.asc_docs_api({'id-view':'editor_sdk'});
    api.disableAutostartMacros = true;
    api.isSpellCheckEnable = false;
    api.isCoAuthoringEnable = false;
  } catch {send({type:'error',message:'The packaged Office model could not initialize.'});return;}
  const ready = setInterval(() => {
    if (!disposed && api.isLoadFullApi && api.WordControl && window.AscFonts?.isEngineReady === true) {clearInterval(ready);readyForOpen=true;send({type:'ready'});}
  },10);
  addEventListener('pagehide',()=>{disposed=true;clearInterval(ready);},{once:true});
  addEventListener('message',async event => {
    const data = event.data;
    if (event.source !== parent || data?.channel !== channel || data.nonce !== nonce || data.type !== 'open' || used || disposed || !readyForOpen) return;
    used = true;
    let htmlState;
    try {
      if (!(data.officeBin instanceof Uint8Array) || data.officeBin.byteLength > 150 * 1024 * 1024 || new TextDecoder().decode(data.officeBin.subarray(0,4)) !== 'DOCY') throw new Error();
      api.asc_nativeOpenFile(data.officeBin);
      if(data.htmlImport!==undefined)htmlState=await ftsImportHtml(api,data.htmlImport);
      const documentApi = AscBuilder.Word.Api.GetDocument();
      const json = readDocument(documentApi,htmlState);
      if (typeof json !== 'string' || json.length > 50 * 1024 * 1024) throw new Error();
      const model=JSON.parse(json);
      htmlState?.verifyModel(model);
      const budget=FtsSvg.planDecorationBudget(model,data.pdfContext);
      const {decorations,warnings} = ftsExportDecorations(documentApi,model,budget);
      const needsViews=FtsSvg.imageViewGraphics(model).size>0;
      const media=needsViews?await imageMedia(json,htmlState?.inlineImages??[]):undefined;
      const views=await ftsExportImageViews(documentApi,model,budget,{media});
      send({type:'result',json,decorations,warnings,imageViews:views.imageViews,imageViewWarnings:views.warnings,conversionWarnings:htmlState?.warnings??[],inlineImages:htmlState?.inlineImages??[]},[...Object.values(decorations).map(value=>value.bytes.buffer),...Object.values(views.imageViews).map(value=>value.bytes.buffer),...(htmlState?.inlineImages??[]).map(value=>value.bytes.buffer)]);
    } catch(error) {send({type:'error',code:error?.code||'OFFICE_MODEL_FAILED',message:error?.code?error.message:'The editable Office document model could not be read.'});}
    finally{htmlState?.dispose();}
  });
})();
