import {createAssetClient as defaultAssets} from '../sharepoint/assets.js';
import {detectSharePointSite} from '../sharepoint/detect.js';
import {checkCanvasBlock} from '../sharepoint/canvas.js';
import {sourceMetadata as checkSourceMetadata} from '../sharepoint/attribution.js';
import {MAX_BLOCKS,MAX_PICTURE_BYTES,MAX_TEXT_HTML,PICTURE_PIECE_BYTES,base64ToBytes,bytesToBase64,sha256Hex} from './limits.js';
import {withinSite} from '../sharepoint/session.js';
const CHANNEL='guide-transfer';
const fail=(code,message)=>Object.assign(new Error(message),{code});
const clone=value=>structuredClone(value);
const GUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// A captured picture as it travels with the page model: identity and size, not its bytes.
const pictureInfo=({id,name,mime,width,height,size})=>({id,name,mime,width,height,size});
const PICTURE_ID=/^[a-f0-9]{64}$/;
function validateModel(model,sourceLabel){
  if(!model||typeof model.title!=='string'||!model.title.trim()||model.title.length>255||!(/^[a-f0-9]{64}$/i).test(model.sourceHash??'')||
    !Array.isArray(model.blocks)||!model.blocks.length||!Array.isArray(model.assets))throw fail('invalid-capture','Capture a complete page before sending.');
  checkSourceMetadata(model);
  if(model.sourceEditing!==undefined&&typeof model.sourceEditing!=='boolean')throw fail('invalid-capture','The capture’s source view is invalid. Capture the page again.');
  // The most blocks SharePoint page assembly places (serializeCanvas); capture turns a longer page's dividers into text to fit.
  if(model.blocks.length>MAX_BLOCKS)throw fail('capture-limit',`This page has more than the 2,000 parts (pictures, dividers and the runs of text between them) the extension places on one SharePoint page. Split it into shorter pages in ${sourceLabel} and capture each.`);
  const pictures=new Set();
  for(const asset of model.assets){
    if(!PICTURE_ID.test(asset?.id??'')||pictures.has(asset.id)||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>MAX_PICTURE_BYTES||
       !Number.isInteger(asset.width)||asset.width<1||!Number.isInteger(asset.height)||asset.height<1||typeof asset.mime!=='string'||typeof asset.name!=='string'||'base64' in asset||'bytes' in asset)
      throw fail('invalid-capture','A captured picture is incomplete. Capture the page again.');
    pictures.add(asset.id);
  }
  if(model.blocks.some(block=>block.type==='image'&&!pictures.has(block.assetId)||block.type==='text'&&Array.isArray(block.pictures)&&block.pictures.some(picture=>!pictures.has(picture?.assetId))))
    throw fail('invalid-capture','A captured picture is missing. Capture the page again.');
  if(JSON.stringify(model.blocks).length>8_000_000)throw fail('capture-too-large','This page exceeds the capture size limit.');
  // The same rules SharePoint page assembly applies, checked before anything is uploaded. The size of a text part is the
  // extension's own limit (safeHtml in canvas.js), which capture splits its runs of text to fit (fitBlocks).
  if(model.blocks.some(block=>block?.type==='text'&&typeof block.html==='string'&&block.html.length>MAX_TEXT_HTML))
    throw fail('capture-limit',`Part of this capture is larger than the extension writes as one part of a SharePoint page (2,000,000 characters with its formatting). Break that part of the ${sourceLabel} page into smaller ones and capture it again.`);
  for(const block of model.blocks){
    try{checkCanvasBlock(block);}
    catch(error){throw fail('unsupported-content',`Part of this page could not be converted into content SharePoint accepts. ${error.message}`);}
  }
}
function publicError(error){
  const code=/^[a-z0-9-]{1,80}$/.test(error?.code??'')?error.code:'operation-failed';
  const message=typeof error?.message==='string'&&error.message.length<1500&&!/https?:|token=|signature=/i.test(error.message)?error.message:'The operation stopped. No automatic retry was made. Check the source images or review SharePoint before trying again.';
  return {code,message,...(error?.draftMayExist?{draftMayExist:true}:{}),...(error?.pageUnchanged?{pageUnchanged:true}:{}),...(error?.pageMayHaveChanged?{pageMayHaveChanged:true}:{}),
    ...(GUID.test(error?.attemptId??'')?{attemptId:error.attemptId}:{}),
    // The draft SharePoint made before the stop, by its server-relative path, so the popup can link to it; not after a
    // save whose outcome is unknown, since the naming save may have moved the file.
    ...(error?.draftMayExist&&!['save-unconfirmed','allocation-unconfirmed'].includes(code)&&typeof error.serverRelativeUrl==='string'&&/^\/[^?#]{1,1000}\.aspx$/i.test(error.serverRelativeUrl)&&!error.serverRelativeUrl.split('/').some(part=>part==='..')?{serverRelativeUrl:error.serverRelativeUrl}:{}),
    // An update's page gone (`page-missing`): whether another page now answers at the address it had.
    ...(typeof error?.addressTaken==='boolean'?{addressTaken:error.addressTaken}:{}),
    // The address an update found its page at, when it stopped after that: the review and the sent list use it.
    ...(typeof error?.movedTo==='string'&&/^\/[^?\u0000-\u001f\u007f]{1,1000}\.aspx$/i.test(error.movedTo)&&!error.movedTo.split('/').some(part=>part==='..')?{movedTo:error.movedTo}:{}),
    // The controls a page send whose outcome is unknown may have written.
    ...(error?.pageMayHaveChanged&&Array.isArray(error.part)&&error.part.length&&error.part.length<=4000&&error.part.every(id=>typeof id==='string'&&GUID.test(id))?{part:[...error.part]}:{})};
}
// The page a send writes when it writes an existing page: its server-relative path; add, overwrite, or update
// with the part an earlier send of the same Confluence page wrote (its controls, whether it titles the page, and
// whether it starts with a heading), and the page's permanent ID when the sent list has it, by which the page is
// found again after a rename or a move within Site Pages. An add may name the IDs of the pages the same Confluence
// page was sent to on the site (`sentIds`), so a page renamed since is not given a second copy of it.
function checkedTarget(page){
  if(page===undefined)return null;
  const part=page?.part,sent=page?.sentIds;
  if(!page||typeof page!=='object'||Array.isArray(page)||Object.keys(page).some(key=>!['path','mode','part','uniqueId','sentIds'].includes(key))||typeof page.path!=='string'||
    !/^\/[^\u0000-\u001f\u007f]{1,1499}$/.test(page.path)||!['add','overwrite','update'].includes(page.mode)||(page.mode==='update')!==(part!==undefined)||
    page.uniqueId!==undefined&&(page.mode!=='update'||typeof page.uniqueId!=='string'||!GUID.test(page.uniqueId))||
    sent!==undefined&&(page.mode!=='add'||!Array.isArray(sent)||sent.length>200||!sent.every(id=>typeof id==='string'&&GUID.test(id)&&id===id.toLowerCase()))||
    part!==undefined&&(!part||typeof part!=='object'||Array.isArray(part)||Object.keys(part).sort().join()!=='controls,headed,titled'||typeof part.titled!=='boolean'||typeof part.headed!=='boolean'||
      !Array.isArray(part.controls)||!part.controls.length||part.controls.length>4000||!part.controls.every(id=>typeof id==='string'&&GUID.test(id))))throw fail('invalid-message','Unsupported transfer fields.');
  return {path:page.path,mode:page.mode,...(part?{part:{controls:[...part.controls],titled:part.titled,headed:part.headed}}:{}),...(page.uniqueId?{uniqueId:page.uniqueId.toLowerCase()}:{}),...(sent?{sentIds:[...sent]}:{})};
}
// Why pictures are not on the draft or page: the site has no Site Assets library for them, or it refused the user's files.
function picturesLost(reason,some,where){
  return reason==='library'?`This site has no Site Assets library the pictures can go to, so they are not on the ${where}: each is marked “[Picture not placed]” where it was.`
    :`Your permission on this site does not include adding files to its Site Assets library, so ${some?'some of the pictures are':'the pictures are'} not on the ${where}: each is marked “[Picture not placed]” where it was.`;
}

/** Isolated-world entry point. Only extension messages initiate a complete capture, a new draft or a send to a page. */
export function createTransferHandler({
  channel=CHANNEL,
  getRuntimeId=()=>globalThis.chrome?.runtime?.id,getLocation=()=>globalThis.location,
  inspectSource=()=>({supported:false}),
  inspectDestination=()=>detectSharePointSite({location:getLocation()}),
  captureSource=async()=>{throw fail('unsupported-source','This source does not provide page capture.');},
  sourceKind='source',sourceLabel='the source',capturePrompt='Open a source page before capturing.',
  pageIdentity=href=>{try{return new URL(href).href;}catch{return null;}},
  importFolderPrefix='page-import',beforeImport=null,
  createAssetClient=defaultAssets,
  createDraftClient=async options=>(await import('../sharepoint/drafts.js')).createDraftClient(options),
  createPageClient=async options=>(await import('../sharepoint/pages.js')).createPageClient(options),
  fetchImpl=(...args)=>globalThis.fetch(...args)
}={}){
  if(typeof channel!=='string'||!/^[a-z][a-z0-9-]{0,40}$/.test(channel))throw fail('invalid-transfer-channel','The transfer protocol is invalid.');
  if(!/^[a-z][a-z0-9-]{0,40}$/.test(importFolderPrefix))throw fail('invalid-import-prefix','The import namespace is invalid.');
  // `step` is how far creating a draft has got (preparing, page, content, checkin), or writing a page (waiting, page, content, checkin).
  // `source`: the page this tab checked before capturing it (its address and id), which the background compares with its own check.
  const state={stage:'idle',step:null,completedImages:0,totalImages:0,attemptId:null,result:null,error:null,source:null};
  let busy=false,attempted=false,inspectionClient=null,inspectionLocation=null;
  // Pictures travel between this tab and the extension's background in pieces,
  // because Chrome limits each extension message to 64 MiB: the background reads
  // a capture's pictures from here, and sends them to the site's tab before a send.
  let captured=null,capturedModel=null,staged=new Map();
  // With `detach`, capture and send answer at once and carry on here; `status`
  // follows them and `captured` hands over the finished capture. Chrome stops an
  // extension service worker whose single request lasts more than five minutes.
  const PAYLOAD={capture:['detach'],import:['model','attemptId','siteUrl','detach','page'],picture:['id','offset'],stage:['id','size','offset','data'],'inspect-tracked-page':['page']};
  function picturePiece({id,offset}){
    const bytes=captured?.get(id);
    if(!bytes||!Number.isSafeInteger(offset)||offset<0||offset>=bytes.length||offset%PICTURE_PIECE_BYTES)throw fail('picture-unavailable','The captured picture is no longer available in this tab. Capture the page again.');
    const end=Math.min(bytes.length,offset+PICTURE_PIECE_BYTES);
    return {data:bytesToBase64(bytes.subarray(offset,end)),next:end<bytes.length?end:null};
  }
  function stagePiece({id,size,offset,data}){
    const piece=base64ToBytes(data);
    if(!PICTURE_ID.test(id??'')||!Number.isSafeInteger(size)||size<1||size>MAX_PICTURE_BYTES||!piece?.length||piece.length>PICTURE_PIECE_BYTES||
       !Number.isSafeInteger(offset)||offset<0||offset%PICTURE_PIECE_BYTES||offset+piece.length>size)throw fail('invalid-picture','A staged picture is invalid.');
    let entry=staged.get(id);
    if(!entry||entry.bytes.length!==size){entry={bytes:new Uint8Array(size),pieces:new Set()};staged.set(id,entry);}
    entry.bytes.set(piece,offset);entry.pieces.add(offset);
    return {received:entry.pieces.size};
  }
  // Every picture of the model must have arrived whole, and be the file that was captured.
  async function stagedPictures(model){
    const pictures=new Map();
    for(const asset of model.assets){
      const entry=staged.get(asset.id);
      if(!entry||entry.bytes.length!==asset.size||entry.pieces.size!==Math.ceil(asset.size/PICTURE_PIECE_BYTES)||await sha256Hex(entry.bytes)!==asset.id)
        throw fail('picture-incomplete','A picture did not arrive intact. Nothing was uploaded. Send again.');
      pictures.set(asset.id,entry.bytes);
    }
    return pictures;
  }
  async function inspect(){
    const source=await inspectSource();
    if(source.supported)return {kind:sourceKind,title:source.title,pageUrl:source.pageUrl,pageId:source.pageId};
    // A recognized Confluence page that cannot be captured explains why,
    // rather than being checked again as a possible SharePoint destination.
    if(source.product===sourceKind)return {supported:false,kind:'unsupported',product:sourceKind,reason:source.reason};
    return inspectDestination();
  }
  return async function handle(message,sender){
    if(!getRuntimeId()||sender?.id!==getRuntimeId())return {ok:false,error:{code:'unauthorized-sender',message:'Only this extension can start a transfer.'}};
    try{
      if(!message||message.channel!==channel||!['inspect','inspect-tracked-page','capture','captured','import','status','picture','stage'].includes(message.action)||Object.keys(message).some(k=>!['channel','action','payload'].includes(k)))throw fail('unsupported-action','Unsupported transfer action.');
      const payload=message.payload??{};
      if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!(PAYLOAD[message.action]??[]).includes(k)))throw fail('invalid-message','Unsupported transfer fields.');
      if(payload.detach!==undefined&&payload.detach!==true)throw fail('invalid-message','Unsupported transfer fields.');
      if(message.action==='status')return {ok:true,result:clone(state)};
      if(message.action==='inspect')return {ok:true,result:await inspect()};
      if(message.action==='captured'){
        if(state.stage!=='ready'||!capturedModel)throw fail('capture-unavailable','The capture is no longer available in this tab. Capture the page again.');
        return {ok:true,result:clone(capturedModel)};
      }
      if(busy)throw fail('operation-busy','A transfer operation is already running.');
      if(message.action==='inspect-tracked-page'){
        const page=payload.page;
        if(!page||Object.keys(page).some(key=>!['path','part','parts','uniqueId'].includes(key))||page.parts!==undefined&&(!Array.isArray(page.parts)||!page.parts.length||page.parts.length>2000||page.part!==undefined))throw fail('invalid-message','Unsupported inspection fields.');
        const parts=page.parts??[page.part];
        const target=checkedTarget({path:page.path,part:parts[0],uniqueId:page.uniqueId,mode:'update'});
        for(const part of parts)checkedTarget({path:page.path,part,mode:'update'});
        const destination=await inspectDestination();
        if(!destination?.supported||destination.kind!=='sharepoint'||!withinSite(getLocation().href,destination.siteUrl)||!withinSite(`${new URL(destination.siteUrl).origin}${target.path}`,destination.siteUrl))throw fail('target-changed','Open the linked SharePoint site to check this page.');
        const location=getLocation().href,assertTarget=()=>{if(getLocation().href!==location)throw fail('target-changed','The site tab moved during inspection.');};
        busy=true;
        try{
          if(!inspectionClient||inspectionLocation!==location){
            inspectionClient=await createPageClient({siteUrl:destination.siteUrl,readOnly:true,fetchImpl:(url,init)=>{assertTarget();if((init?.method??'GET')!=='GET')throw fail('read-only','Inspection only reads SharePoint.');return fetchImpl(url,init);}});
            inspectionLocation=location;
          }
          const result=await inspectionClient.inspectTrackedPage(target.path,{...(page.parts?{parts}:{part:target.part}),uniqueId:target.uniqueId});assertTarget();return {ok:true,result};
        }finally{busy=false;}
      }
      if(message.action==='picture')return {ok:true,result:picturePiece(payload)};
      if(message.action==='stage'){
        if(attempted)throw fail('import-already-attempted','A send was already started in this tab. Review the page before starting another.');
        return {ok:true,result:stagePiece(payload)};
      }
      if(message.action==='capture'){
        // The page captured is the page checked here: one left while it was being checked, or during the capture, stops it.
        const source=await inspectSource(),sourceHref=getLocation().href;
        if(!source.supported)throw fail('unsupported-source',capturePrompt);
        if(pageIdentity(sourceHref)!==pageIdentity(source.pageUrl))throw fail('source-changed','The page changed during capture. Open the page you want and capture it again.');
        busy=true;state.stage='capture';state.completedImages=0;state.totalImages=0;state.error=null;state.source={pageUrl:source.pageUrl,pageId:source.pageId};
        const running=(async()=>{
          try{
            captured=null;capturedModel=null;
            const model=await captureSource({onProgress:progress=>{state.stage=progress.phase;state.completedImages=progress.completed;state.totalImages=progress.total;}});
            if(pageIdentity(getLocation().href)!==pageIdentity(sourceHref))throw fail('source-changed','The page changed during capture. Open the page you want and capture it again.');
            const pictures=new Map(model.assets.map(asset=>[asset.id,asset.bytes]));
            model.assets=model.assets.map(pictureInfo);
            validateModel(model,sourceLabel);captured=pictures;capturedModel=model;state.stage='ready';return model;
          }catch(error){state.stage='failed';state.error=publicError(error);throw error;}finally{busy=false;}
        })();
        if(payload.detach){running.catch(()=>{});return {ok:true,result:{started:true}};}
        return {ok:true,result:await running};
      }
      if(attempted)throw fail('import-already-attempted','A send was already started in this tab. Review the page before starting another.');
      const destination=await inspectDestination();
      if(!destination?.supported||destination.kind!=='sharepoint'||destination.siteUrl!==payload.siteUrl)throw fail('target-changed','The SharePoint site changed before the send was started. Send again.');
      if(!GUID.test(payload.attemptId??''))throw fail('invalid-attempt','The send’s attempt identity is missing.');
      const target=checkedTarget(payload.page);
      validateModel(payload.model,sourceLabel);
      const pictures=await stagedPictures(payload.model);
      if(beforeImport)await beforeImport({siteUrl:destination.siteUrl,model:payload.model,target});
      attempted=true;busy=true;state.attemptId=payload.attemptId;state.stage='checking';state.step=null;state.completedImages=0;state.totalImages=0;state.result=null;state.error=null;
      // SharePoint changes the tab's address within the site on its own (Site Pages moves to its default view
      // after it loads); a tab that leaves the site stops the send.
      const assertTarget=()=>{if(!withinSite(getLocation().href,destination.siteUrl))throw fail('target-changed','The SharePoint tab left the site during the send. Review the site before sending again.');};
      const guardedFetch=(...args)=>{assertTarget();return fetchImpl(...args);};
      const onStep=step=>{state.step=step;};
      // The pictures go to the site's Site Assets before any page is written. A site with no Site Assets library for them
      // (none is created), or whose library refuses the user's files (403), gets the page without the pictures it did
      // not take, each marked where it was. `notes`: why pictures were left out, and what readers still need before they
      // see the others there (checked in, published or approved), which go with the result before the client's own.
      let notes=[];
      async function upload(){
        const receipts=[];state.totalImages=payload.model.assets.length;state.completedImages=0;
        if(!state.totalImages)return {receipts,model:payload.model};
        state.stage='uploading';
        const assets=createAssetClient({siteUrl:destination.siteUrl,fetchImpl:guardedFetch});
        let lost=null;
        try{
          const library=await assets.discoverLibrary();assertTarget();
          const folder=await assets.ensureImportFolder(library.serverRelativeUrl,`${importFolderPrefix}-${payload.model.sourceHash.toLowerCase()}`);
          for(const asset of payload.model.assets){assertTarget();receipts.push(await assets.uploadAsset(folder,{...asset,bytes:pictures.get(asset.id)}));state.completedImages++;}
        }catch(error){
          lost=error?.code==='ambiguous-library'?'library':error?.code==='sharepoint-http'&&error.status===403?'permission':null;
          if(!lost)throw error;
        }
        notes=[...(lost?[picturesLost(lost,receipts.length>0,target?'page':'draft')]:[]),...assets.notes()];
        if(!lost)return {receipts,model:payload.model};
        const {withoutPictures}=await import('../sharepoint/drafts.js');
        return {receipts,model:withoutPictures(payload.model,receipts,new URL(destination.siteUrl).origin,new Set(receipts.map(receipt=>String(receipt.assetId).toLowerCase())))};
      }
      let writing=false,pagePath=null,addressTaken=false;
      const running=(async()=>{try{
        let result;
        if(target){
          const client=await createPageClient({siteUrl:destination.siteUrl,fetchImpl:guardedFetch});
          await client.inspectSite();assertTarget();
          // An update knowing its page's ID finds the page wherever it now is in Site Pages; the send writes it there.
          const checked=await client.checkPage(target.path,{onStep,...(target.part?{part:target.part}:{}),...(target.uniqueId?{uniqueId:target.uniqueId}:{}),...(target.sentIds?{sentIds:target.sentIds}:{})});state.step=null;
          pagePath=target.uniqueId&&typeof checked?.path==='string'?checked.path:target.path;addressTaken=checked?.addressTaken===true;
          const {receipts,model}=await upload();
          assertTarget();state.stage='writing';state.step=null;writing=true;
          result=await client.sendToPage({attemptId:payload.attemptId,pagePath,mode:target.mode,model,assetReceipts:receipts,...(target.part?{part:target.part}:{}),...(target.uniqueId?{uniqueId:target.uniqueId}:{}),
            ...(target.sentIds?{sentIds:target.sentIds}:{})},{onStep});
          if(result?.verified!==true||result?.publication!=='draft')throw Object.assign(fail('unverified-page','SharePoint did not confirm the page’s new content.'),{pageMayHaveChanged:true});
          // The address the page was sent to, when it was found elsewhere, so the sent list can follow it, and whether
          // another page now has that address, whose place in the site's list then stays.
          if(pagePath!==target.path)result={...result,movedFrom:target.path,...(addressTaken?{addressTaken:true}:{})};
        }else{
          const client=await createDraftClient({siteUrl:destination.siteUrl,fetchImpl:guardedFetch});
          await client.inspectSite();assertTarget();
          const {receipts,model}=await upload();
          assertTarget();state.stage='creating';state.step='preparing';
          const slug=payload.model.title.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,55).replace(/-+$/,'')||'page';
          result=await client.createDraft({attemptId:payload.attemptId,filenameStem:slug,model,assetReceipts:receipts},{onStep});
          if(result?.verified!==true||result?.publication!=='unpublished')throw Object.assign(fail('unverified-draft','SharePoint did not confirm an unpublished draft.'),{draftMayExist:true});
        }
        if(notes.length)result={...result,notes:[...notes,...(Array.isArray(result.notes)?result.notes:[])]};
        state.result=clone(result);state.stage='complete';return result;
      }catch(error){
        // Before the page is written, nothing on it has changed.
        if(target&&!writing&&error&&typeof error==='object'&&!error.pageMayHaveChanged)error.pageUnchanged=true;
        if(target&&pagePath&&pagePath!==target.path&&error&&typeof error==='object')error.movedTo=pagePath;
        state.stage='failed';state.error=publicError(error);throw error;
      }finally{busy=false;staged=new Map();}})();
      if(payload.detach){running.catch(()=>{});return {ok:true,result:{started:true,attemptId:payload.attemptId}};}
      return {ok:true,result:await running};
    }catch(error){return {ok:false,error:publicError(error)};}
  };
}
