import {createTransferHandler as createCoreHandler} from './handler.js';
import {confluenceRoute,confluenceSite,waitForConfluencePage} from '../confluence/detect.js';
import {logoElement} from '../brand/logo.js';
const CHANNEL='guide-transfer';
const SHORTCUT_CHANNEL='guide-shortcut';
const SHORTCUT_ID='guide-to-sharepoint-shortcut';
// The buttons this copy of the script made. An extension update disconnects the
// copy already running in an open page but leaves its button, which the copy
// the update brings replaces.
const OWN_SHORTCUTS=globalThis.__C2S_OWN_SHORTCUTS__??=new WeakSet();

export function installConfluenceShortcut({document=globalThis.document,location=globalThis.location,chromeApi=globalThis.chrome}={}){
  const existing=document?.getElementById?.(SHORTCUT_ID);if(existing&&OWN_SHORTCUTS.has(existing))return {host:existing,destroy() {}};
  if(!document?.body||typeof chromeApi?.runtime?.sendMessage!=='function'||!confluenceSite({document,location}))return null;
  // Hidden and renamed rather than removed: copies before 0.3.0 keep following the page
  // after an update disconnects them, and would put a removed button back.
  if(existing){existing.id=`${SHORTCUT_ID}-replaced`;existing.style.setProperty('display','none','important');existing.setAttribute('aria-hidden','true');}
  const host=document.createElement('div');host.id=SHORTCUT_ID;OWN_SHORTCUTS.add(host);const root=host.attachShadow({mode:'open'});
  // Chrome disconnects this copy of the script when the extension is updated: its runtime loses its id.
  const connected=()=>Boolean(chromeApi?.runtime?.id);
  // Confluence's stylesheet lays out its toolbar's children, and page rules outrank a shadow root's
  // :host rules, so the host's own layout, including the gap before Share, is set on the element.
  host.style.cssText='display:inline-flex !important;align-items:center !important;flex:0 0 auto !important;margin:0 8px 0 4px !important';
  // Teal with the logo on a white tile, so it is not taken for one of Confluence's own neutral buttons.
  const style=document.createElement('style');style.textContent=':host{all:initial}button{position:static;display:inline-flex;align-items:center;gap:7px;height:32px;border:1px solid #0e6680;border-radius:6px;padding:0 12px 0 4px;background:#0e6680;color:#fff;font:600 14px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 1px 2px rgba(9,30,66,.3);white-space:nowrap;cursor:pointer}button:hover{background:#084d64;border-color:#084d64}button:active{background:#063f52;border-color:#063f52}button:focus-visible{outline:2px solid #0c66e4;outline-offset:2px}button:disabled{opacity:.6;cursor:wait}button[data-state=error]{background:#fff;border-color:#ae2e24;color:#ae2e24;box-shadow:none;cursor:pointer}.mark{display:inline-grid;place-items:center;flex:none;width:24px;height:24px;border-radius:5px;background:#fff}svg{flex:none;display:block}';
  // The extension's logo and "SharePoint": the button opens the toolbar popup.
  const button=document.createElement('button');button.type='button';button.setAttribute('aria-label','Copy this page to SharePoint');
  const label=document.createElement('span');label.textContent='SharePoint';
  const mark=document.createElement('span');mark.className='mark';mark.append(logoElement(document,18));
  button.append(mark,label);
  const fallback=()=>{button.disabled=false;button.dataset.state='error';label.textContent='Use the extension icon';button.title='The popup could not be opened. Use the extension icon in the toolbar.'};
  // Only a person's click asks for the popup; a page script's click is ignored.
  button.addEventListener('click',async event=>{if(!event.isTrusted)return;
    if(!connected()){observer.disconnect();button.dataset.state='error';label.textContent='Reload this page';button.title='The extension was updated. Reload this page to use it here, or use the extension icon.';return;}
    button.disabled=true;button.dataset.state='';try{const result=await chromeApi.runtime.sendMessage({channel:SHORTCUT_CHANNEL,action:'open-popup'});if(result?.ok!==true)throw Error();label.textContent='SharePoint';button.title='';}catch{fallback()}finally{if(button.dataset.state!=='error')button.disabled=false}});
  root.append(style,button);
  const mount=()=>{
    // Confluence Cloud changes pages in place, so follow the current address:
    // the shortcut belongs beside the Share action of a document page only.
    const site=confluenceSite({document,location});
    const share=site?.cloud&&confluenceRoute(site)?document.querySelector('[data-testid="controlled-share-button"]'):null;
    if(!share){host.remove();return false;}
    const view=document.defaultView;
    // A replaced button stays directly before the anchor, where its earlier copy keeps
    // putting it; this one goes in front of it, or the two copies would move their buttons endlessly.
    const place=(parent,anchor)=>{
      let before=anchor;
      while(before.previousElementSibling&&before.previousElementSibling!==host&&before.previousElementSibling.id.startsWith(`${SHORTCUT_ID}-replaced`))before=before.previousElementSibling;
      if(host.parentElement!==parent||host.nextElementSibling!==before)parent.insertBefore(host,before);
      return true;
    };
    // Confluence draws one frame around Share and its copy-link button; the button goes
    // before that group, inside the container Confluence marks for the Share action.
    const container=share.closest('[data-testid^="share-action-container"]');
    const group=container&&view?.getComputedStyle(container).display.includes('flex')?[...container.children].find(child=>child!==host&&child.contains(share)):null;
    if(group)return place(container,group);
    // Otherwise, beside Share in its nearest row.
    let anchor=share,parent=share.parentElement;
    while(parent&&parent!==document.body){
      if(view?.getComputedStyle(parent).display.includes('flex'))return place(parent,anchor);
      anchor=parent;parent=parent.parentElement;
    }
    host.remove();
    return false;
  };
  // A disconnected copy stops following the page, so it cannot put its button back.
  mount();const observer=new MutationObserver(()=>{if(connected())mount();else observer.disconnect();});observer.observe(document.body,{childList:true,subtree:true});
  return {host,destroy(){observer.disconnect();host.remove()}};
}

// The Confluence page an address shows: its site, its route and its page (the id in its path, or the pageId of the
// older route), as the background compares a capture's page (jobs.js). A link to a heading (#Steps), a comment opened
// (?focusedCommentId=) or the page's title rewritten in its address leaves the tab on the same page.
function pageOf(href){
  try{
    const url=new URL(href);
    return `${url.origin}${url.pathname.replace(/(\/pages\/(?:edit-v2\/)?\d{1,20})(?:\/.*)?$/,'$1')}?${url.searchParams.get('pageId')??''}`;
  }catch{return null;}
}

export function createTransferHandler(options={}){
  const getLocation=options.getLocation??(()=>globalThis.location);
  return createCoreHandler({...options,getLocation,
    inspectSource:options.inspectSource??(()=>waitForConfluencePage({location:getLocation()})),
    captureSource:options.captureSource??(async settings=>(await import('../confluence/capture.js')).captureConfluencePage(settings)),
    sourceKind:'confluence',sourceLabel:'Confluence',capturePrompt:'Open a Confluence page before capturing.',
    pageIdentity:pageOf,importFolderPrefix:'confluence-import'});
}
if(typeof document!=='undefined'&&globalThis.chrome?.runtime?.onMessage&&!globalThis.__GUIDE_TRANSFER_V2__){
  globalThis.__GUIDE_TRANSFER_V2__=true;
  const handler=createTransferHandler();
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(message?.channel!==CHANNEL)return false;
    handler(message,sender).then(reply,()=>reply({ok:false,error:{code:'operation-failed',message:'The transfer stopped.'}}));return true;
  });
}
if(typeof document!=='undefined'&&globalThis.chrome?.runtime&&!globalThis.__GUIDE_TO_SHAREPOINT_SHORTCUT__){
  globalThis.__GUIDE_TO_SHAREPOINT_SHORTCUT__=installConfluenceShortcut()??true;
}
