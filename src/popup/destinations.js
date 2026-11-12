const decoded=value=>String(value).split('/').map(part=>{try{return decodeURIComponent(part);}catch{return part;}}).join('/').toLowerCase();
const place=(origin,path)=>`${origin}${decoded(path)}`.toLowerCase();
export function siteOfTab(sites,tabUrl){
  let url;try{url=new URL(tabUrl);}catch{return null;}
  const path=decoded(url.pathname);
  return sites.map(site=>{
    let at;try{at=new URL(site.url);}catch{return null;}
    const base=decoded(at.pathname.replace(/\/$/,''));
    return at.origin===url.origin&&(base?path===base||path.startsWith(`${base}/`):!/^\/(?:sites|teams)\//.test(path))?{site,base}:null;
  }).filter(Boolean).sort((a,b)=>b.base.length-a.base.length)[0]?.site??null;
}
/** The same pinned/open/current destinations are offered by both source flows. */
export function destinationChoices(sites,{open=[],chosen=null,page=null}={}){
  const openSites=new Set(open.map(url=>siteOfTab(sites,url)?.url).filter(Boolean));
  const openPages=new Set(open.map(value=>{try{const url=new URL(value);return place(url.origin,url.pathname);}catch{return null;}}).filter(Boolean));
  return sites.filter(site=>site.pinned||openSites.has(site.url)||site.url===chosen).map(site=>({...site,
    pages:(site.pages??[]).filter(entry=>openPages.has(place(new URL(site.url).origin,entry.path))||site.url===chosen&&entry.path===page)}));
}
