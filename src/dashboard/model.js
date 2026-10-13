import {linkKey,normalLink,normalSourceRevision} from '../background/links.js';
export const sourceId=source=>`${source.origin}|${source.pageId}`;

function sourceChange(link,metadata){
  if(metadata?.status==='unavailable')return {status:'unavailable',message:metadata.message};
  const current=normalSourceRevision(metadata);
  const uncertain='The last send was uncertain or did not capture the published source completely. Review the draft before sending again.';
  if(link.sourceUpdateUnknown)return current&&link.sentAt&&current.updatedAt>link.sentAt?{status:'changed',basis:'send-time'}:{status:'unknown',message:uncertain};
  if(!current)return link.sourceIncomplete?{status:'unknown',message:'The last send omitted content. Refresh to check for newer source edits.'}:{status:'unchecked'};
  const sent=link.sourceRevision;
  if(link.sourceIncomplete){
    const newer=sent?current.version>sent.version||current.updatedAt>sent.updatedAt:link.sentAt&&current.updatedAt>link.sentAt;
    return newer?{status:'changed',basis:sent?'revision':'send-time'}:{status:'unknown',message:'The last send omitted content. No newer source revision was found; review the draft and its notes.'};
  }
  if(sent){
    // A cached reading older than a just-sent revision needs another Refresh.
    if(current.updatedAt<sent.updatedAt&&current.version<=sent.version)return {status:'unchecked',message:'Refresh to compare the latest source.'};
    return {status:current.version===sent.version&&current.updatedAt===sent.updatedAt?'unchanged':'changed',basis:'revision'};
  }
  if(!link.sentAt)return {status:'unknown',message:'This older link has no send date or source revision to compare.'};
  return {status:current.updatedAt>link.sentAt?'changed':'unknown',basis:'send-time',message:'The captured source revision was not recorded. A later edit proves changes; an earlier edit cannot confirm the draft is current.'};
}

// Rows go by site, page and source, not by when they were sent, so a page's sources are listed together and an Update
// does not send its row to the front. A page goes by its newest link's title, which every link to it then shares.
const destinationKey=value=>`${value.siteUrl}|${value.uniqueId??value.path.toLowerCase()}`;
export function rowsFromLinks(links,{sites=[],sources={},checks={}}={}){
  const normal=links.map(normalLink).filter(Boolean),named=new Map();
  for(const link of normal){const key=destinationKey(link),known=named.get(key);if(!known||(link.sentAt??0)>known.sentAt)named.set(key,{title:link.title||'',sentAt:link.sentAt??0});}
  const title=row=>named.get(destinationKey(row.destination))?.title??'';
  const byPlace=(a,b)=>a.siteTitle.localeCompare(b.siteTitle)||a.destination.siteUrl.localeCompare(b.destination.siteUrl)||title(a).localeCompare(title(b))||
    destinationKey(a.destination).localeCompare(destinationKey(b.destination))||a.sourceLabel.localeCompare(b.sourceLabel)||a.id.localeCompare(b.id);
  return normal.map(link=>({
    id:linkKey(link),source:link.source,sourceLabel:sources[sourceId(link.source)]?.title||`Confluence page ${link.source.pageId}`,
    siteTitle:sites.find(site=>site.url===link.siteUrl)?.title||new URL(link.siteUrl).hostname+new URL(link.siteUrl).pathname,
    destination:{siteUrl:link.siteUrl,path:link.path,title:link.title,...(link.uniqueId?{uniqueId:link.uniqueId}:{})},
    sourceUpdatedAt:normalSourceRevision(sources[sourceId(link.source)])?.updatedAt??null,
    sourceChange:sourceChange(link,sources[sourceId(link.source)]),check:checks[linkKey(link)]??{status:'unchecked'}
  })).sort(byPlace);
}

export function filterRows(rows,{query='',siteUrl=''}={}){
  const needle=query.trim().toLocaleLowerCase();
  return rows.filter(row=>(!siteUrl||row.destination.siteUrl===siteUrl)&&(!needle||[row.sourceLabel,row.source.pageId,row.source.origin,row.destination.title,row.destination.path,row.destination.siteUrl].join(' ').toLocaleLowerCase().includes(needle)));
}
export function pageRows(rows,page=1,pageSize=50){
  const pageCount=Math.max(1,Math.ceil(rows.length/pageSize)),current=Math.max(1,Math.min(pageCount,Math.floor(page)||1));
  return {rows:rows.slice((current-1)*pageSize,current*pageSize),page:current,pageCount,total:rows.length};
}
export function groupRows(rows){
  const sites=new Map();
  for(const row of rows){
    const destination=row.destination,key=destination.siteUrl;
    if(!sites.has(key))sites.set(key,{siteUrl:key,title:row.siteTitle,pages:new Map()});
    const site=sites.get(key),id=destination.uniqueId??destination.path.toLowerCase();
    if(!site.pages.has(id))site.pages.set(id,{id,destination,rows:[]});site.pages.get(id).rows.push(row);
  }
  // In the order of the rows (rowsFromLinks sorts them), so the cards follow the pages of the list.
  return [...sites.values()].map(site=>({...site,pages:[...site.pages.values()]}));
}
