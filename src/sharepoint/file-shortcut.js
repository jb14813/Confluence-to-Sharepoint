import {pageSite,sharePointMarkers} from './detect.js';
import {siteKey} from '../background/sites.js';
import {logoElement} from '../brand/logo.js';

const ID='c2s-file-import-shortcut';
const owned=globalThis.__C2S_FILE_SHORTCUTS__??=new WeakMap();
const pageKey=location=>{try{const url=new URL(location.href);return `${url.origin}${url.pathname}`;}catch{return null;}};

/** Open the existing extension workspace from a confirmed SharePoint web. */
export function installSharePointFileShortcut({document=globalThis.document,location=globalThis.location,navigation=globalThis.navigation,chromeApi=globalThis.chrome}={}){
  const existing=document?.getElementById(ID);
  if(existing&&owned.has(existing))return owned.get(existing);
  const view=document?.defaultView;
  if(!document?.body||!view||view.top!==view||!chromeApi?.runtime?.id||typeof chromeApi.runtime.sendMessage!=='function')return null;
  existing?.remove();
  const host=document.createElement('div');host.id=ID;
  const root=host.attachShadow({mode:'open'}),style=document.createElement('style');
  style.textContent=':host{all:initial}button{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px 0 4px;border:1px solid #0e6680;border-radius:6px;background:#0e6680;color:#fff;font:600 14px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;cursor:pointer;box-shadow:0 1px 3px #0003}button:hover{background:#084d64}button:focus-visible{outline:2px solid #0c66e4;outline-offset:2px}button:disabled{opacity:.65;cursor:wait}button[data-error]{background:#fff;border-color:#ae2e24;color:#ae2e24}.mark{display:inline-grid;place-items:center;width:24px;height:24px;background:#fff;border-radius:5px;flex:none}svg{display:block}';
  const button=document.createElement('button');button.type='button';button.setAttribute('aria-label','Import a file to SharePoint');button.title='Import a local document with Confluence to SharePoint';
  const mark=document.createElement('span');mark.className='mark';mark.append(logoElement(document,18));
  const label=document.createElement('span');label.textContent='Import a file';button.append(mark,label);root.append(style,button);
  const known=new Map();let site=null,confirmedPage=null,checkingPage=null,attemptedPage=null,turn=0,disposed=false;
  function stop(){navigation?.removeEventListener('currententrychange',check);view.removeEventListener('resize',mount);observer.disconnect();}
  function mount(){
    if(disposed||!site||pageKey(location)!==confirmedPage){host.remove();return;}
    const anchor=view.innerWidth>=640?document.querySelector('[data-automation-id="pageCommandBarNewButton"]')?.closest('.ms-OverflowSet-item'):null;
    if(anchor?.parentElement){
      host.style.cssText='all:initial !important;display:inline-flex !important;align-items:center !important;flex:0 0 auto !important;margin:0 8px 0 0 !important';
      if(host.parentElement!==anchor.parentElement||host.nextElementSibling!==anchor)anchor.parentElement.insertBefore(host,anchor);
    }else{
      host.style.cssText='all:initial !important;display:inline-flex !important;position:fixed !important;right:16px !important;bottom:16px !important;max-width:calc(100vw - 32px) !important;z-index:1000 !important';
      if(host.parentElement!==document.body)document.body.append(host);
    }
  }
  async function check(){
    if(disposed)return;
    if(!chromeApi.runtime?.id){stop();return;}
    const key=pageKey(location);
    if(key===confirmedPage&&site){mount();return;}
    if(key===checkingPage||key===attemptedPage)return;
    if(!sharePointMarkers(document).product)return;
    attemptedPage=key;
    checkingPage=key;site=null;confirmedPage=null;host.remove();const mine=++turn;
    const found=await pageSite({document,location,known}).catch(()=>null);
    if(disposed||mine!==turn||key!==pageKey(location))return;
    checkingPage=null;
    const address=found&&siteKey(found.url);
    if(!address)return;
    site=address;confirmedPage=key;mount();
  }
  button.addEventListener('click',async event=>{
    if(!event.isTrusted||button.disabled)return;
    if(!chromeApi.runtime?.id){stop();button.setAttribute('data-error','');label.textContent='Reload this page';button.title='The extension was updated. Reload this page or use the extension icon.';return;}
    if(!site||confirmedPage!==pageKey(location)){void check();return;}
    button.disabled=true;button.removeAttribute('data-error');
    try{
      const response=await chromeApi.runtime.sendMessage({channel:'file-import-shortcut',action:'open-file-import',siteUrl:site});
      if(response?.ok!==true)throw Error();label.textContent='Import a file';button.title='Import a local document with Confluence to SharePoint';
    }catch{button.setAttribute('data-error','');label.textContent='Use the extension icon';button.title='File import could not be opened. Use the extension icon in Chrome.';}
    finally{button.disabled=false;}
  });
  const observer=new MutationObserver(()=>{if(!chromeApi.runtime?.id){stop();return;}void check();});
  observer.observe(document.body,{subtree:true,childList:true});navigation?.addEventListener('currententrychange',check);view.addEventListener('resize',mount);
  const control={host,ready:check(),destroy(){disposed=true;++turn;stop();host.remove();owned.delete(host);}};
  owned.set(host,control);return control;
}
