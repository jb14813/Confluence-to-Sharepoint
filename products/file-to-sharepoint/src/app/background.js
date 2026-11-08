import {createSites,siteKey} from '../../../../src/background/sites.js';
import {createAssetRouteListener} from '../../../../src/sharepoint/route-cache.js';
const sites=createSites(),assetRoute=createAssetRouteListener();
for(const area of ['local','session'])chrome.storage[area].setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
chrome.action.onClicked.addListener(async()=>{
  const url=chrome.runtime.getURL('workspace.html');
  const found=(await chrome.tabs.query({url}))[0];
  if(found)await chrome.tabs.update(found.id,{active:true});else await chrome.tabs.create({url});
});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.channel==='asset-route')return assetRoute(message,sender,reply);
  if(message?.channel!=='site-memory'||message.action!=='site-visited'||sender?.id!==chrome.runtime.id||sender.frameId!==0||!Number.isInteger(sender.tab?.id)||typeof message.title!=='string')return false;
  const site=siteKey(message.url);let same=false;
  try{same=new URL(sender.url).origin===new URL(message.url).origin;}catch{/* Refuse below. */}
  if(!site||!same)return false;
  sites.visited(site,message.title).then(()=>reply({ok:true}),()=>reply({ok:false}));return true;
});
