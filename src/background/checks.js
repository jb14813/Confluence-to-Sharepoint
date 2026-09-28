// Checks the background applies to a capture and to what SharePoint returns.
export const fail=(code,message)=>Object.assign(new Error(message),{code});

// A SharePoint site address as the extension keeps it: https, without port,
// credentials, query or fragment, and not a page, API or library path in a site.
export function siteAddress(value){
  let url;
  try{url=new URL(value);}catch{throw fail('invalid-destination','The SharePoint destination is invalid.');}
  const path=url.pathname.replace(/\/$/,'');
  if(url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash||
    /[\\\x00-\x20\x7f]/.test(value)||/%(?:2e|2f|5c)/i.test(path)||path.split('/').some(p=>p==='.'||p==='..'||/^(?:_api|_layouts|SitePages)$/i.test(p))){
    throw fail('invalid-destination','The SharePoint destination is invalid.');
  }
  return `${url.origin}${path}`;
}

/** The address of the page a verified send made or wrote in `attempt`'s site: a page in its Site Pages, without query. */
export function confirmedPageUrl(result,attempt){
  // A new draft is unpublished; a send to a page leaves a draft of it on top of what readers see.
  const expected=attempt.page?'draft':'unpublished';
  if(result?.verified!==true||result.publication!==expected||result.attemptId&&result.attemptId!==attempt.attemptId)throw fail('unverified-draft','The send could not be verified. Review the page in SharePoint.');
  const site=new URL(siteAddress(attempt.siteUrl));
  let url;
  try{url=new URL(result.pageUrl);}catch{throw fail('unverified-draft','SharePoint did not return a valid page address.');}
  const prefix=`${site.pathname.replace(/\/$/,'')}/SitePages/`.toLowerCase();
  let parts;
  try{parts=url.pathname.slice(prefix.length).split('/').map(decodeURIComponent);}catch{throw fail('unverified-draft','SharePoint did not return a valid page address.');}
  if(url.origin!==site.origin||url.username||url.password||url.hash||url.search||!url.pathname.toLowerCase().startsWith(prefix)||
    parts.some(part=>!part||part==='.'||part==='..'||/[\\\x00-\x1f?]/.test(part))||!/\.aspx$/i.test(parts.at(-1))||parts.at(-1).toLowerCase()==='.aspx'){
    throw fail('unverified-draft','SharePoint returned an unexpected page address. Review Site Pages before continuing.');
  }
  return url.href;
}

export function validateCapture(model){
  if(!model||typeof model.title!=='string'||!model.title.trim()||!(/^[a-f0-9]{64}$/i).test(model.sourceHash??'')||!Array.isArray(model.blocks)||!model.blocks.length||!Array.isArray(model.assets))throw fail('incomplete-capture','Capture a complete Confluence page before sending it.');
  const assets=new Map();
  for(const asset of model.assets){
    if(!asset||!/^[a-f0-9]{64}$/.test(asset.id??'')||assets.has(asset.id)||!Number.isSafeInteger(asset.size)||asset.size<1||
      !Number.isInteger(asset.width)||asset.width<1||!Number.isInteger(asset.height)||asset.height<1){
      throw fail('incomplete-capture','A picture is incomplete. Capture the page again.');
    }
    assets.set(asset.id,asset);
  }
  if(model.blocks.some(block=>block.type==='image'&&!assets.has(block.assetId)))throw fail('incomplete-capture','A source picture is missing from the capture.');
}

/** What a capture holds, such as "3 pictures · 2 tables"; picture files are listed only when a picture repeats. */
export function captureStats(model){
  const images=Number.isInteger(model.stats?.images)?model.stats.images:model.blocks.filter(block=>block.type==='image').length;
  const tables=Number.isInteger(model.stats?.tables)?model.stats.tables:model.blocks.reduce((n,b)=>n+(b.type==='text'?(b.html.match(/<table(?:\s|>)/gi)??[]).length:0),0);
  const files=model.assets.length,count=(n,word)=>`${n} ${word}${n===1?'':'s'}`,parts=[];
  if(images)parts.push(count(images,'picture'));
  if(tables)parts.push(count(tables,'table'));
  if(files!==images)parts.push(count(files,'picture file'));
  return parts.length?parts.join(' · '):'Text only';
}
