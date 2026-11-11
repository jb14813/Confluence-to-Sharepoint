import {mergeInlineImages} from './inline-images.js';
import {planDecorationBudget} from './decoration-budget.js';
import {validatePdfNativeTables,validatePdfConversionProfile} from './pdf-native-layout.js';
import {validatePdfDrawings} from './pdf-drawings.js';
import {preparePdfDrawingAliases,verifyPdfDrawingAliases,verifyPdfDrawingAliasMedia} from './pdf-drawing-aliases.js';
import {reconcileNativeMedia} from './native-media.js';
import {imageViewResources,verifyImageViews} from './image-views.js';
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const extensions = new Set(['docx', 'doc', 'odt', 'rtf', 'txt', 'pdf']);

function failure(message, code) {
  return Object.assign(new Error(message), {code});
}

function readOfficeModel(json){
  if(typeof json!=='string'||json.length>50*1024*1024)throw failure('The Office model returned invalid or oversized data.','INVALID_OFFICE_MODEL');
  const model=JSON.parse(json);
  if(!model||model.type!=='document'||!Array.isArray(model.content)||model.content.length>100000)throw failure('The Office model returned invalid or oversized data.','INVALID_OFFICE_MODEL');
  return model;
}

/** Convert local source bytes; each call disposes its worker and opaque SDK frame.
 * pdfForms preserves ONLYOFFICE's raw Fields/Parents plus original page geometry.
 * officeDocument is the existing Word SDK's ToJSON model; media contains its
 * verified picture resources. Unchanged ZIP bytes stay exact; nativeImages
 * records native output names/bytes against the retained source DOCX hash.
 * decorations optionally maps nontext graphic ids to SDK-rendered PNG bytes.
 * warnings are {code,message}; consumers must present PDF reconstruction review.
 */
export async function convertDocument({name, bytes} = {}, {signal, timeoutMs = 90000, loadLinkedImages = false} = {}) {
  if (typeof name !== 'string' || !name || name.length > 255 || /[\x00-\x1f/\\]/.test(name))
    throw failure('A plain source filename is required.', 'INVALID_NAME');
  const extension = name.split('.').pop().toLowerCase();
  if (!extensions.has(extension)) throw failure('This document format is not supported.', 'UNSUPPORTED_FORMAT');
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength)
    throw failure('The document is empty or has no byte data.', 'INVALID_INPUT');
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw failure('The document exceeds the 50 MiB limit.', 'DOCUMENT_TOO_LARGE');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
    throw failure('Conversion timeout must be between 1 and 120000 milliseconds.', 'INVALID_TIMEOUT');
  if (signal?.aborted) throw new DOMException('Conversion cancelled.', 'AbortError');

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url));
    const resourceController=new AbortController();
    let settled = false, frame = null, receiveModel = null, processing = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      resourceController.abort();
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (receiveModel) window.removeEventListener('message',receiveModel);
      frame?.remove();
      worker.terminate();
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(new DOMException('Conversion cancelled.', 'AbortError'));
    const timer = setTimeout(() => finish(failure('Document conversion timed out.', 'ENGINE_TIMEOUT')), timeoutMs);
    signal?.addEventListener('abort', abort, {once:true});
    worker.onerror = event => {
      event.preventDefault();
      finish(failure('The local document engine could not run.', 'ENGINE_LOAD_FAILED'));
    };
    worker.onmessage = async ({data}) => {
      if(settled)return;
      if (data?.error) finish(failure(data.error.message, data.error.code || 'CONVERSION_FAILED'));
      else if (data?.result?.docxBytes instanceof Uint8Array && data.result.officeBin instanceof Uint8Array) {
        if(extension==='pdf'&&!data.result.pdfText)return finish(failure('The PDF source text could not be verified. No content was imported.','PDF_TEXT_UNVERIFIED'));
        if(extension==='pdf'){try{validatePdfConversionProfile(data.result.pdfLayout);}catch(error){return finish(error);}}
        if(extension!=='pdf'&&(data.result.pdfText||data.result.pdfLayout))return finish(failure('The engine returned unexpected PDF metadata.','INVALID_ENGINE_RESULT'));
        let pdfContext;
        if(extension==='pdf'){
          if(!Array.isArray(data.result.pdfForms?.pages)||data.result.pdfForms.pages.length!==data.result.pdfText.pages.length)return finish(failure('The PDF page geometry could not be verified.','PDF_ORDER_UNVERIFIED'));
          try{
            validatePdfNativeTables(data.result.pdfLayout.nativeTables,data.result.pdfForms.pages);
            validatePdfDrawings(data.result.pdfLayout.nativeDrawings,{pages:data.result.pdfForms.pages,pdfText:data.result.pdfText,nativeTables:data.result.pdfLayout.nativeTables});
          }
          catch(error){return finish(error);}
          pdfContext={pages:data.result.pdfForms.pages.map(({W,H,Dpi})=>({W,H,Dpi})),pdfLayout:data.result.pdfLayout,pdfText:data.result.pdfText};
        }
        if (processing) return finish(failure('The engine returned duplicate document data.', 'INVALID_ENGINE_RESULT'));
        processing = true;
        // The native conversion has finished. Release its WASM heap before
        // loading the SDK and any transformed image resources.
        worker.terminate();
        const {officeBin,nativeMedia,...result} = data.result;
        let pdfDerivedImages=[],pdfAliasContext=null;
        if(pdfContext){
          try{
            // Bind derived vector pictures to the original DOCX resources,
            // before native media aliases can replace a same-named picture.
            pdfAliasContext=await preparePdfDrawingAliases(result.pdfLayout.nativeDrawings,result.docxBytes,{originalMedia:result.media,signal:resourceController.signal});
            pdfDerivedImages=structuredClone(pdfAliasContext.receipts);
            if(settled)return;
            if(pdfDerivedImages.length)result.pdfDerivedImages=pdfDerivedImages;
          }catch(error){finish(error);return;}
        }
        if(nativeMedia!==undefined){
          try{
            const generated=await reconcileNativeMedia(result.media,nativeMedia,result.docxBytes);
            if(pdfAliasContext)await verifyPdfDrawingAliasMedia(pdfAliasContext,generated.media,{signal:resourceController.signal});
            const {verifySvgMedia}=await import('./html-resources.js');
            // Check originals before replacing resources: a native bitmap
            // must not hide active or animated source SVG content.
            await verifySvgMedia(result.media,{signal:resourceController.signal});
            if(settled)return;
            // Generated metafile SVGs cross the same boundary as originals.
            // Verify only new/replaced outputs here, before opening the SDK.
            const outputs=Object.fromEntries(generated.receipts.map(receipt=>[receipt.resourceName,generated.media[receipt.resourceName]]));
            await verifySvgMedia(outputs,{signal:resourceController.signal});
            if(settled)return;
            result.media=generated.media;result.nativeImages=generated.receipts;
          }catch(error){finish(error);return;}
        }
        if(result.htmlImport){
          try{
            const {prepareHtmlResources}=await import('./html-resources.js');
            const prepared=await prepareHtmlResources(result.htmlImport,{loadLinkedImages,signal:resourceController.signal});
            result.htmlImport=prepared.htmlImport;result.media=prepared.media;result.inlineSvgSources=prepared.inlineSvgSources;
            result.svgResourceNames=prepared.htmlImport.resources.filter(resource=>resource.svgDensity!==undefined).map(resource=>resource.name);
            if(prepared.linkedImages.length){result.linkedImages=prepared.linkedImages;result.warnings.push({code:'HTML_LINKED_IMAGES',message:'Linked pictures were downloaded from their source websites. Review them before sending.'});}
          }catch(error){finish(error);return;}
          if(settled)return;
        }
        const nonce = crypto.randomUUID(), channel = 'fts-office-model';
        frame = document.createElement('iframe');
        frame.title = 'Local document processing';
        frame.setAttribute('aria-hidden','true');
        frame.style.cssText = 'position:fixed;left:-100000px;top:0;width:1024px;height:768px;border:0;pointer-events:none';
        frame.src = new URL('./sandbox.html',import.meta.url).href + '#' + nonce;
        let sent = false,imageModelJson=null,imageModel=null,receivedResult=false;
        receiveModel = async event => {
          const response = event.data;
          if (settled||event.source !== frame?.contentWindow || response?.channel !== channel || response.nonce !== nonce) return;
          if (response.type === 'ready' && !sent) {
            sent = true;
            frame.contentWindow.postMessage({channel,nonce,type:'open',officeBin,...(pdfContext?{pdfContext}:{}),...(result.htmlImport?{htmlImport:result.htmlImport}:{})},'*',[officeBin.buffer]);
          } else if(response.type==='image-media'&&sent){
            try{
              if(imageModelJson!==null||receivedResult)throw new Error();
              imageModel=readOfficeModel(response.json);imageModelJson=response.json;
              if(pdfDerivedImages.length){
                const proof=await verifyPdfDrawingAliases(pdfAliasContext,imageModel,result.media,{signal:resourceController.signal});
                if(settled)return;result.pdfDrawingAliases=structuredClone(proof.receipts);
              }
              const references=[],stack=[imageModel];let visited=0;
              while(stack.length){const node=stack.pop();if(!node||typeof node!=='object')continue;if(++visited>500000)throw new Error();if(node.type==='image'&&typeof node.blipFill?.rasterImageId==='string')references.push(node.blipFill.rasterImageId.split('/').at(-1));for(const child of Object.values(node))if(child&&typeof child==='object')stack.push(child);}
              const inline=mergeInlineImages(result.media,response.inlineImages??[],{allowed:!!result.htmlImport,sourceInputs:result.inlineSvgSources??[],imageReferences:references});
              const media=imageViewResources(imageModel,inline.media);
              if(!Object.keys(media).length)throw new Error();
              const {imageResourceMime,verifyStaticSvg}=await import('./html-resources.js');
              if(settled)return;
              for(const[name,bytes]of Object.entries(media))if(imageResourceMime(bytes,/\.svg$/i.test(name)?'image/svg+xml':'')==='image/svg+xml')await verifyStaticSvg(bytes,{signal:resourceController.signal});
              if(settled)return;
              // Copy only the required resources. The adapter retains the
              // original ZIP bytes for its independent hash verification.
              frame.contentWindow.postMessage({channel,nonce,type:'image-media',media},'*');
            }catch(error){finish(error?.code==='PDF_DRAWINGS_UNVERIFIED'?error:error?.code==='HTML_RESOURCE_BLOCKED'?failure(error.message,'SVG_IMAGE_BLOCKED'):failure('The Office model requested invalid local image data.','INVALID_OFFICE_MODEL'));}
          } else if (response.type === 'error') finish(failure(response.message || 'The Office model could not be read.', typeof response.code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(response.code)?response.code:'OFFICE_MODEL_FAILED'));
          else if (response.type === 'result' && sent) {
            try {
              if(receivedResult||imageModelJson!==null&&response.json!==imageModelJson)throw new Error();receivedResult=true;
              const officeDocument=imageModel??readOfficeModel(response.json);
              if(pdfDerivedImages.length){
                const proof=await verifyPdfDrawingAliases(pdfAliasContext,officeDocument,result.media,{signal:resourceController.signal,expectedAliases:result.pdfDrawingAliases});
                if(settled)return;result.pdfDrawingAliases=structuredClone(proof.receipts);
              }
              const decorations = Object.create(null), eligibleIds = new Set(), imageReferences=[], stack = [officeDocument];
              let visited = 0, decorationBytes = 0;
              while (stack.length) {
                const value = stack.pop();
                if (!value || typeof value !== 'object') continue;
                if (++visited > 500000) throw new Error();
                if (value.type === 'shape' && value.content == null && typeof value.id === 'string') eligibleIds.add(value.id);
                if(value.type==='image'&&typeof value.blipFill?.rasterImageId==='string')imageReferences.push(value.blipFill.rasterImageId.split('/').at(-1));
                for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
              }
              const budget=planDecorationBudget(officeDocument,pdfContext),decorationPages=new Map();
              if (!response.decorations || typeof response.decorations !== 'object' || Array.isArray(response.decorations) || Object.keys(response.decorations).length > budget.maxTotal) throw new Error();
              for (const [id,value] of Object.entries(response.decorations)) {
                if (!eligibleIds.has(id) || !(value?.bytes instanceof Uint8Array) || value.mime !== 'image/png' || ![value.width,value.height].every(n=>Number.isInteger(n)&&n>0&&n<=4096) || value.width*value.height > 8*1024*1024) throw new Error();
                if(budget.pageForId){const pageIndex=budget.pageForId.get(id);if(pageIndex===undefined)throw new Error();const count=(decorationPages.get(pageIndex)||0)+1;if(count>budget.perPage)throw new Error();decorationPages.set(pageIndex,count);}
                decorationBytes += value.bytes.byteLength;
                if (decorationBytes > 32*1024*1024 || value.bytes.length < 8 || ![137,80,78,71,13,10,26,10].every((byte,index)=>value.bytes[index]===byte)) throw new Error();
                decorations[id] = value;
              }
              if (!Array.isArray(response.warnings) || response.warnings.length > 10000 || response.warnings.some(w=>w?.code!=='DECORATION_UNAVAILABLE'||typeof w.sourceId!=='string'||w.sourceId.length>128||typeof w.message!=='string'||w.message.length>1000)) throw new Error();
              const conversionWarnings=response.conversionWarnings??[];
              if(!Array.isArray(conversionWarnings)||conversionWarnings.length>8||conversionWarnings.some(w=>!['HTML_TASK_SYMBOLS','HTML_STATIC_WIDGETS','HTML_SOURCE_PLACEHOLDER','HTML_TABLE_LAYOUT_ADAPTED'].includes(w?.code)||typeof w.message!=='string'||w.message.length>1000||w.blocking===true))throw new Error();
              // Embedded HTML/resources are construction inputs, not a second
              // retained copy of the original document in the public result.
              const inline=mergeInlineImages(result.media,response.inlineImages??[],{allowed:!!result.htmlImport,sourceInputs:result.inlineSvgSources??[],imageReferences});
              const imageViews=await verifyImageViews(officeDocument,inline.media,response.imageViews??{},response.imageViewWarnings??[],budget);
              if(settled)return;
              const viewEntries=Object.entries(imageViews.imageViews);
              if(Object.keys(decorations).length+viewEntries.length>budget.maxTotal||decorationBytes+viewEntries.reduce((sum,[,view])=>sum+view.bytes.byteLength,0)>32*1024*1024)throw new Error();
              if(budget.pageForId){const counts=new Map();for(const id of [...Object.keys(decorations),...viewEntries.map(([id])=>id)]){const page=budget.pageForId.get(id),count=(counts.get(page)||0)+1;if(page===undefined||count>budget.perPage)throw new Error();counts.set(page,count);}}
              const {htmlImport,inlineSvgSources,...documentResult}=result;
              finish(null,{...documentResult,...(htmlImport?{sourceContainer:'mhtml'}:{}),media:inline.media,...(inline.images.length?{svgImages:inline.images}:{}),officeDocument,decorations,imageViews:imageViews.imageViews,warnings:[...result.warnings,...response.warnings,...imageViews.warnings,...conversionWarnings]});
            } catch(error) {finish(error?.code==='PDF_DRAWINGS_UNVERIFIED'?error:failure('The Office model returned invalid or oversized data.', 'INVALID_OFFICE_MODEL'));}
          }
        };
        window.addEventListener('message',receiveModel);
        (document.body || document.documentElement).append(frame);
      }
      else finish(failure('The local engine returned an invalid result.', 'INVALID_ENGINE_RESULT'));
    };
    // Copy so transfer never detaches the caller's source or unrelated views.
    const input = bytes.slice();
    worker.postMessage({extension, bytes:input}, [input.buffer]);
    if (signal?.aborted) abort();
  });
}
