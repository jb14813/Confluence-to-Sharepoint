import {siteKey} from '../background/sites.js';
import {withinSite} from './session.js';

// Session-only, exact destination/account/folder hint. A verified fresh root
// upload is the only caller allowed to remember; reads never renew the lease.
export function createAssetRouteListener({chromeApi=globalThis.chrome,now=()=>Date.now()}={}) {
  return (message,sender,reply)=>{
    if(message?.channel!=='asset-route'||sender?.id!==chromeApi.runtime.id||!Number.isInteger(sender?.tab?.id)||sender.frameId!==0)return false;
    let from;try{from=new URL(sender.url??sender.tab.url);}catch{return false;}
    const site=siteKey(message.siteUrl);
    if(from.protocol!=='https:'||from.username||from.password||!site||!withinSite(from.href,site)||
       Object.keys(message).some(k=>!['channel','action','siteUrl','listId','folderPath','loginName'].includes(k))||
       !['get','remember','forget'].includes(message.action)||typeof message.listId!=='string'||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(message.listId)||
       typeof message.folderPath!=='string'||!message.folderPath.startsWith('/')||message.folderPath.length>1500||
       typeof message.loginName!=='string'||!message.loginName.trim()||message.loginName.length>512)return false;
    const key=`asset-root:${JSON.stringify([site,message.listId,message.folderPath,message.loginName].map(v=>v.toLowerCase()))}`;
    (async()=>{
      const storage=chromeApi.storage.session;
      if(message.action==='remember'){await storage.set({[key]:now()});return false;}
      if(message.action==='forget'){await storage.remove(key);return false;}
      const stamp=(await storage.get(key))[key],at=now();
      return Number.isSafeInteger(stamp)&&stamp>0&&stamp<=at&&at-stamp<30*60_000;
    })().then(rootOnly=>reply({ok:true,rootOnly}),()=>reply({ok:false}));
    return true;
  };
}
