// The extension's background: runs capture and send (src/background/jobs.js),
// keeps the remembered sites (src/background/sites.js) and which Confluence page went to which SharePoint page
// (src/background/links.js), and answers the popup,
// the button on Confluence pages and the SharePoint site memory.
import {createJobs} from './background/jobs.js';
import {createSites} from './background/sites.js';
import {createLinks} from './background/links.js';

const SHORTCUT='guide-shortcut',MEMORY='site-memory',POPUP='c2s-popup';
const tabId=Number.isInteger,text=value=>typeof value==='string';
// Each popup command and the fields it carries, with their checks.
const COMMANDS={state:{},inspect:{tabId},capture:{tabId},send:{siteUrl:text,windowId:value=>value==null||Number.isInteger(value)},
  'send-page':{siteUrl:text,pagePath:text,mode:value=>['add','overwrite','update'].includes(value),windowId:value=>value==null||Number.isInteger(value)},
  'update-page':{tabId,siteUrl:text,pagePath:text,windowId:value=>value==null||Number.isInteger(value)},clear:{},'show-tab':{tabId},
  pin:{url:text,pinned:value=>typeof value==='boolean'},remove:{url:text},'remove-page':{url:text,path:text},forget:{},'inject-open-pages':{}};
// The manifest's content scripts, for pages already open when the extension is installed or updated.
const PAGE_SCRIPTS=[{url:'https://*.atlassian.net/wiki/*',file:'content.js'},{url:'https://*.sharepoint.com/*',file:'memory.js',skip:/^https:\/\/[^/]*-(?:my|admin)\.sharepoint\.com\//i}];
const only=(value,keys)=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const fits=(payload,fields)=>only(payload,Object.keys(fields))&&Object.entries(fields).every(([key,valid])=>valid(payload[key]));

// Page messages come from this extension's content script in a real tab's top frame over HTTPS.
function pageSender(sender,runtimeId){
  if(sender?.id!==runtimeId||!Number.isInteger(sender?.tab?.id)||sender.frameId!==0)return null;
  try{const url=new URL(sender.url??sender.tab.url);return url.protocol==='https:'&&!url.username&&!url.password?url:null;}catch{return null;}
}
const extensionPage=(sender,runtimeId)=>sender?.id===runtimeId&&typeof sender.url==='string'&&sender.url.startsWith(`chrome-extension://${runtimeId}/`);

/** Opens the toolbar popup over the button's window, or the popup page in a small window when Chrome refuses. */
export async function openPopup(chromeApi,tab){
  // https://developer.chrome.com/docs/extensions/reference/api/action#method-openPopup
  try{await chromeApi.action.openPopup({windowId:tab.windowId});return {ok:true};}
  catch{
    try{await chromeApi.windows.create({url:chromeApi.runtime.getURL(`popup.html?tab=${tab.id}`),type:'popup',width:380,height:640});return {ok:true};}
    catch{return {ok:false,error:'popup-unavailable'};}
  }
}

export function configureBackground({chromeApi=globalThis.chrome,sites,links,jobs}={}){
  if(!chromeApi?.runtime?.onMessage)return null;
  // The remembered sites are for this extension's own pages and worker, not its content scripts.
  // https://developer.chrome.com/docs/extensions/reference/api/storage#method-StorageArea-setAccessLevel
  Promise.resolve(chromeApi.storage?.local?.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'})).catch(error=>console.error('Could not restrict local storage:',error?.message??error));
  // Chrome adds content scripts only to pages loaded after it installs the extension, and an
  // update disconnects the ones already running, so Confluence pages that are open get it again.
  // https://developer.chrome.com/docs/extensions/reference/api/runtime#event-onInstalled
  // A tab whose address Chrome hides is one whose access the user withheld; it is left alone,
  // as are OneDrive and the admin center, which the manifest leaves without the site memory.
  const injectOpenPages=()=>PAGE_SCRIPTS.reduce((done,{url,file,skip})=>done.then(()=>Promise.resolve(chromeApi.tabs?.query({url})).then(tabs=>Promise.all((tabs??[])
    .filter(tab=>Number.isInteger(tab.id)&&tab.url&&!skip?.test(tab.url))
    .map(tab=>Promise.resolve(chromeApi.scripting.executeScript({target:{tabId:tab.id},files:[file]})).catch(()=>{}))))).catch(()=>{}),Promise.resolve());
  chromeApi.runtime.onInstalled?.addListener(({reason}={})=>reason==='install'||reason==='update'?injectOpenPages():Promise.resolve());
  // Site access granted later (from the popup or Chrome's extensions page) reaches pages already open the same way.
  chromeApi.permissions?.onAdded?.addListener(()=>injectOpenPages());
  sites??=createSites({storage:chromeApi.storage.local});
  links??=createLinks({storage:chromeApi.storage.local});
  jobs??=createJobs({chromeApi,sites,links});
  const runtimeId=chromeApi.runtime.id;
  const commands={
    // The links go without what each send wrote, which only an update needs.
    state:async()=>({...await jobs.state(),sites:await sites.list(),links:(await links.list()).map(({source,siteUrl,path,title})=>({source,siteUrl,path,title}))}),
    inspect:({tabId})=>jobs.inspect(tabId),
    // A started job answers at once; its progress arrives through session storage.
    capture:({tabId})=>{jobs.capture(tabId);return {started:true};},
    send:({siteUrl,windowId})=>{jobs.send(siteUrl,windowId);return {started:true};},
    'send-page':({siteUrl,pagePath,mode,windowId})=>{jobs.sendToPage(siteUrl,pagePath,mode,windowId);return {started:true};},
    'update-page':({tabId,siteUrl,pagePath,windowId})=>{jobs.updatePage(tabId,siteUrl,pagePath,windowId);return {started:true};},
    clear:()=>jobs.clear(),
    'show-tab':({tabId})=>jobs.showTab(tabId),
    pin:({url,pinned})=>sites.pin(url,pinned),
    // A site or page the user removes, and everything on Forget all, takes its links with it.
    remove:async({url})=>{await sites.remove(url);await links.removeSite(url);},
    'remove-page':async({url,path})=>{await sites.removePage(url,path);await links.removePage(url,path);},
    forget:async()=>{await sites.forget();await links.forget();},
    // After the user grants site access, pages already open get their scripts, as after an install.
    'inject-open-pages':async()=>{await injectOpenPages();return null;}
  };
  chromeApi.runtime.onMessage.addListener((message,sender,reply)=>{
    if(message?.channel===SHORTCUT){
      if(message.action!=='open-popup'||Object.keys(message).length!==2||!pageSender(sender,runtimeId))return false;
      openPopup(chromeApi,sender.tab).then(reply);return true;
    }
    if(message?.channel===MEMORY){
      const from=pageSender(sender,runtimeId),page=message.page;let site=null;
      try{site=new URL(message.url);}catch{/* Refused below. */}
      if(message.action!=='site-visited'||!only(message,['channel','action','url','title','page'])||typeof message.title!=='string'||!from||!site||site.origin!==from.origin||
        page!==undefined&&!(only(page,['path','title'])&&typeof page.path==='string'&&typeof page.title==='string'))return false;
      // A tab a send is using is not the user's visit, and must not clear the problem the send notes.
      if(jobs.busyTab(sender.tab.id)){reply({ok:true});return true;}
      sites.visited(message.url,message.title,page).then(()=>reply({ok:true}),()=>reply({ok:false}));return true;
    }
    if(message?.channel===POPUP){
      const payload=message.payload??{};
      if(!extensionPage(sender,runtimeId)||!Object.hasOwn(COMMANDS,message.action)||!only(message,['channel','action','payload'])||!fits(payload,COMMANDS[message.action]))return false;
      Promise.resolve().then(()=>commands[message.action](payload)).then(result=>reply({ok:true,result:result??null}),
        error=>reply({ok:false,error:{code:typeof error?.code==='string'?error.code:'operation-failed',message:error?.message||'The request could not be completed.'}}));
      return true;
    }
    return false;
  });
  jobs.recover().catch(error=>console.error('Could not recover the last job:',error?.message??error));
  return {sites,jobs};
}

if(globalThis.chrome?.runtime?.onMessage)configureBackground();
