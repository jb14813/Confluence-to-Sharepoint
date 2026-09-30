// The extension's background: runs capture and send (src/background/jobs.js),
// keeps the remembered sites (src/background/sites.js) and which Confluence page went to which SharePoint page
// (src/background/links.js), with their copy in the user's Confluence account when the user turns it on
// (src/background/account.js); the pinned sites and that setting follow Chrome sync (src/background/pins.js); and
// answers the popup, the button on Confluence pages and the SharePoint site memory.
import {createJobs} from './background/jobs.js';
import {createSites,siteKey} from './background/sites.js';
import {createLinks} from './background/links.js';
import {createAccount} from './background/account.js';
import {createPins} from './background/pins.js';

const SHORTCUT='guide-shortcut',MEMORY='site-memory',POPUP='c2s-popup';
const tabId=Number.isInteger,text=value=>typeof value==='string',textOrNull=value=>value===null||typeof value==='string';
// Each popup command and the fields it carries, with their checks.
const COMMANDS={state:{},inspect:{tabId},capture:{tabId},send:{siteUrl:text,windowId:value=>value==null||Number.isInteger(value)},
  'send-page':{siteUrl:text,pagePath:text,mode:value=>['add','overwrite','update'].includes(value),windowId:value=>value==null||Number.isInteger(value)},
  'update-page':{tabId,siteUrl:text,pagePath:text,windowId:value=>value==null||Number.isInteger(value)},clear:{},'show-tab':{tabId},
  pin:{url:text,pinned:value=>typeof value==='boolean'},remove:{url:text},'remove-page':{url:text,path:text},forget:{},'inject-open-pages':{},
  'account-sync':{enabled:value=>typeof value==='boolean',origin:textOrNull,pageId:textOrNull},'account-refresh':{origin:text,pageId:text}};
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

export function configureBackground({chromeApi=globalThis.chrome,sites,links,account,pins,jobs}={}){
  if(!chromeApi?.runtime?.onMessage)return null;
  // The remembered sites, and the synced setting and pins, are for this extension's own pages and worker, not its
  // content scripts, which use neither.
  // https://developer.chrome.com/docs/extensions/reference/api/storage#method-StorageArea-setAccessLevel
  for(const area of ['local','sync'])Promise.resolve(chromeApi.storage?.[area]?.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'})).catch(error=>console.error(`Could not restrict ${area} storage:`,error?.message??error));
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
  account??=createAccount({storage:chromeApi.storage?.local,sync:chromeApi.storage?.sync,permissions:chromeApi.permissions,links});
  pins??=createPins({sync:chromeApi.storage?.sync,sites});
  // Every change of the sent list made in this browser goes to the account copy when the setting is on.
  links.watch?.(report=>account.changed(report));
  // What Chrome sync brings from the user's other Chrome browsers (and this one's own changes): the pins, and the setting.
  // https://developer.chrome.com/docs/extensions/reference/api/storage#event-onChanged
  chromeApi.storage?.onChanged?.addListener((changes,area)=>{
    if(area!=='sync')return;
    void Promise.resolve(pins.changed(changes)).catch(()=>{});
    if(changes?.accountCopy)void Promise.resolve(account.synced(changes.accountCopy.newValue)).catch(()=>{});
  });
  jobs??=createJobs({chromeApi,sites,links,account});
  const runtimeId=chromeApi.runtime.id;
  const commands={
    // The links go without what each send wrote, which only an update needs. Opening the popup also sends what
    // waits for the user's Confluence account.
    state:async()=>{account.retry();return {...await jobs.state(),sites:await sites.list(),links:(await links.list()).map(({source,siteUrl,path,title})=>({source,siteUrl,path,title})),account:await account.state()};},
    inspect:({tabId})=>jobs.inspect(tabId),
    // A started job answers at once; its progress arrives through session storage.
    capture:({tabId})=>{jobs.capture(tabId);return {started:true};},
    send:({siteUrl,windowId})=>{jobs.send(siteUrl,windowId);return {started:true};},
    'send-page':({siteUrl,pagePath,mode,windowId})=>{jobs.sendToPage(siteUrl,pagePath,mode,windowId);return {started:true};},
    'update-page':({tabId,siteUrl,pagePath,windowId})=>{jobs.updatePage(tabId,siteUrl,pagePath,windowId);return {started:true};},
    clear:()=>jobs.clear(),
    'show-tab':({tabId})=>jobs.showTab(tabId),
    // A pin or unpin goes to the user's other Chrome browsers through Chrome sync.
    pin:async({url,pinned})=>{
      await sites.pin(url,pinned);
      const key=siteKey(url),site=(await sites.list()).find(entry=>entry.url===key);
      if(key)await pins.record(key,site?.title??'',pinned);
    },
    // A site or page the user removes takes its links with it, in the account too (a dated mark, so the other
    // computers' copies go as well), and a removed site's pin with it. Forget all clears this browser's lists, unpins
    // the synced pins, and turns Keep in my Confluence account off, which removes the account's copy.
    remove:async({url})=>{
      const key=siteKey(url),site=(await sites.list()).find(entry=>entry.url===key);
      await sites.remove(url);await links.removeSite(url);
      if(key)await account.queue([{op:'forget',kind:'site',siteUrl:key}]);
      if(key&&site?.pinned)await pins.record(key,site.title??'',false);
    },
    'remove-page':async({url,path})=>{
      const key=siteKey(url),ids=key?(await links.list()).filter(link=>link.siteUrl===key&&link.path.toLowerCase()===path.toLowerCase()&&link.uniqueId).map(link=>link.uniqueId):[];
      await sites.removePage(url,path);await links.removePage(url,path);
      if(key)await account.queue([{op:'forget',kind:'page',siteUrl:key,path,...(ids.length?{uniqueIds:[...new Set(ids)]}:{})}]);
    },
    forget:async()=>{await sites.forget();await links.forget();await pins.forget();await account.disable();},
    // Keep in my Confluence account: on, with the Confluence page in the tab if there is one, or off.
    'account-sync':async({enabled,origin,pageId})=>{if(enabled)await account.enable({origin,pageId});else await account.disable();return account.state();},
    // The popup, open over a Confluence page, takes that page's entries from the account; the list redraws when they arrive.
    'account-refresh':({origin,pageId})=>{void account.refresh({origin,pageId});return null;},
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
  // Chrome starts the worker at browser start only for a listener of it: recover() then discards the capture a previous
  // browser session left, at once rather than when the extension is next used.
  // https://developer.chrome.com/docs/extensions/reference/api/runtime#event-onStartup
  chromeApi.runtime.onStartup?.addListener(()=>{});
  jobs.recover().catch(error=>console.error('Could not recover the last job:',error?.message??error));
  // Pins from before 0.4.9 go to Chrome sync, and the synced pins and setting are followed.
  Promise.resolve().then(()=>pins.start()).catch(error=>console.error('Could not read the synced pins:',error?.message??error));
  Promise.resolve().then(()=>account.start()).catch(error=>console.error('Could not read the synced setting:',error?.message??error));
  return {sites,jobs,account,pins};
}

if(globalThis.chrome?.runtime?.onMessage)configureBackground();
