import {sourceKey,linkKey,normalSourceRevision} from './links.js';
import {rowsFromLinks,sourceId} from '../dashboard/model.js';
import {fail} from './checks.js';

const KEY='dashboardCatalog';
export function createDashboard({chromeApi=globalThis.chrome,session=chromeApi.storage.session,links,sites,account,jobs,fetchImpl=(...args)=>fetch(...args),now=()=>Date.now()}={}){
  let active=null,stop=false;
  const read=async()=>({sources:{},checks:{},refresh:{status:'idle',completed:0,total:0},...((await session.get(KEY))[KEY]??{})});
  const save=value=>session.set({[KEY]:value});
  async function state(){const catalog=await read();return {rows:rowsFromLinks(await links.list(),{sites:await sites.list(),...catalog}),account:await account.state(),refresh:catalog.refresh};}
  async function metadata(source){
    if(!sourceKey(source))throw fail('invalid-source','The source is not a supported Confluence page.');
    if(chromeApi.permissions?.contains&&!await chromeApi.permissions.contains({origins:[`${source.origin}/*`]}))throw fail('source-access','Allow access to the source site.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000);
    try{
      const response=await fetchImpl(`${source.origin}/wiki/rest/api/content/${source.pageId}?status=current&expand=version`,{credentials:'include',redirect:'error',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
      if(!response.ok)throw fail('source-unavailable',response.status===404?'The Confluence page is missing or your account cannot access it.':response.status===401||response.status===403?'Sign in to the source site and check your page access.':'The source site could not return its update information.');
      const limit=1_000_000,tooLarge=()=>fail('source-unavailable','The source metadata is too large.');
      if(Number(response.headers.get('Content-Length'))>limit){await response.body?.cancel().catch(()=>{});throw tooLarge();}
      if(!response.body)throw fail('source-unavailable','The source update information was unavailable.');
      const reader=response.body.getReader(),decoder=new TextDecoder();let text='',bytes=0;
      try{
        for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
          if(bytes>limit){await reader.cancel().catch(()=>{});throw tooLarge();}
          text+=decoder.decode(value,{stream:true});
        }
        text+=decoder.decode();
      }finally{reader.releaseLock();}
      const data=JSON.parse(text),title=data.title,when=data.version?.when;
      const revision=typeof when==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(when)?normalSourceRevision({version:data.version?.number,updatedAt:Date.parse(when)}):null;
      if(String(data.id)!==source.pageId||data.type!=='page'||data.status!=='current'||typeof title!=='string'||!title.trim()||!revision)throw fail('source-unavailable','The source update information was unavailable.');
      return {title:title.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,255),...revision,status:'available',checkedAt:now()};
    }finally{clearTimeout(timer);}
  }
  async function run({windowId}={}){
    const catalog=await read();catalog.refresh={status:'running',completed:0,total:0,message:'Reading saved history',startedAt:now()};await save(catalog);
    let steps=0,lastCheckpoint=now();
    const checkpoint=async()=>{if(++steps>=25||now()-lastCheckpoint>=2000){steps=0;lastCheckpoint=now();await save(catalog);}};
    try{
      const local=await links.list(),tabs=await chromeApi.tabs.query({});
      const origins=[...new Set([...local.map(link=>link.source.origin),...tabs.flatMap(tab=>{
        try{const url=new URL(tab.url);return sourceKey({origin:url.origin,pageId:'1'})&&url.pathname.startsWith('/wiki/')?[url.origin]:[];}catch{return [];}
      })])];
      const report=!(await account.state()).enabled||stop?{reports:[]}:await account.refreshCatalog({origins,shouldStop:()=>stop,onProgress:async({origin,completed,total})=>{
        catalog.refresh={...catalog.refresh,completed,total,message:`Reading history on ${new URL(origin).hostname}`};await checkpoint();
      }});
      catalog.refresh.reports=report.reports;
      const current=await links.list(),sources=[...new Map(current.map(link=>[sourceId(link.source),link.source])).values()];
      // Prune vanished identities to keep session metadata within the existing link budget.
      const ids=new Set(current.map(linkKey)),sourceIds=new Set(sources.map(sourceId));
      catalog.checks=Object.fromEntries(Object.entries(catalog.checks).filter(([id])=>ids.has(id)));
      catalog.sources=Object.fromEntries(Object.entries(catalog.sources).filter(([id])=>sourceIds.has(id)));
      catalog.refresh={...catalog.refresh,completed:0,total:sources.length+current.length,message:'Checking tracked pages'};await save(catalog);
      for(const source of sources){
        if(stop)break;
        try{catalog.sources[sourceId(source)]=await metadata(source);}catch(error){
          // Keep a known label or the page-ID fallback, with a visible bounded explanation.
          const message=(error?.message||'The source update information could not be read.').slice(0,400);
          catalog.sources[sourceId(source)]={...catalog.sources[sourceId(source)],status:'unavailable',message};
          const report=catalog.refresh.reports.find(report=>report.origin===source.origin&&report.status==='source-unavailable'&&report.reason===message);
          if(report){report.count++;report.message=`${report.count} Confluence pages: ${message}`;}
          else catalog.refresh.reports.push({origin:source.origin,status:'source-unavailable',reason:message,count:1,message:`1 Confluence page: ${message}`});
        }
        catalog.refresh.completed++;await checkpoint();
      }
      const bySite=new Map();for(const link of current){if(!bySite.has(link.siteUrl))bySite.set(link.siteUrl,[]);bySite.get(link.siteUrl).push(link);}
      for(const [siteUrl,entries] of bySite){
        if(stop)break;
        await jobs.inspectTrackedSite(siteUrl,entries,{windowId,shouldStop:()=>stop,onResult:async(link,found,error)=>{
          const check=error?{status:error.code==='page-missing'?'missing':'blocked',message:(error.message||'The destination could not be checked.').slice(0,500)}:
            {status:found.locked?'blocked':found.partPresent?'available':'part-missing',...(found.message?{message:found.message.slice(0,500)}:{})};
          catalog.checks[linkKey(link)]={...check,checkedAt:now()};catalog.refresh.completed++;await checkpoint();
        }});
      }
      catalog.refresh={...catalog.refresh,status:stop?'stopped':'complete',message:stop?'Refresh stopped. Completed checks are kept.':'Refresh complete',finishedAt:now()};await save(catalog);
    }catch(error){catalog.refresh={...catalog.refresh,status:'failed',message:(error?.message||'Refresh stopped. Your local list is still available.').slice(0,500)};await save(catalog);}
  }
  return {state,ownsWork:()=>Boolean(active),
    async refresh(options={}){if(active)throw fail('refresh-busy','A refresh is already running.');stop=false;active=run(options).finally(()=>{active=null;});return {started:true};},
    async stopRefresh(){stop=true;},
    async recover(){const catalog=await read();if(catalog.refresh.status==='running'){catalog.refresh={...catalog.refresh,status:'interrupted',message:'Refresh was interrupted. Refresh again to check the remaining pages.'};await save(catalog);}},
    idle:async()=>{await active;}
  };
}
