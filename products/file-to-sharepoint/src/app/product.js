const DEFAULT=Object.freeze({productName:'File to SharePoint',isCombined:false,homePath:'workspace.html',brandIcon:'icons/logo.svg',featureIcon:'icons/icon32.png',licensesPath:'THIRD-PARTY-NOTICES.txt',destinationScript:'destination.js'});
const LOCAL_PATH=/^[a-z0-9][a-z0-9._/-]{0,250}$/i;
function localPath(value){
  if(typeof value!=='string'||!LOCAL_PATH.test(value)||value.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Product navigation requires a local extension path.');
  return value;
}
/** Package presentation and its allowlisted destination entry; storage identities are unchanged. */
export function readProductConfig(input){
  if(input===undefined)return {...DEFAULT};
  if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.isCombined!=='boolean')throw Error('Invalid workspace product configuration.');
  const productName=input.isCombined?'Confluence to SharePoint':'File to SharePoint';
  if(input.productName!==productName)throw Error('Invalid workspace product name.');
  const config={productName,isCombined:input.isCombined};
  for(const key of ['homePath','brandIcon','featureIcon','licensesPath'])config[key]=localPath(input[key]??DEFAULT[key]);
  config.destinationScript=input.destinationScript??(input.isCombined?'file-destination.js':'destination.js');
  if(!['destination.js','file-destination.js'].includes(config.destinationScript))throw Error('Invalid workspace destination script.');
  return config;
}
export async function loadProductConfig({runtime=globalThis.chrome?.runtime,fetchImpl=globalThis.fetch}={}){
  let response;
  try{response=await fetchImpl(runtime?.getURL?.('file-product.json')??'file-product.json',{cache:'no-store'});}
  catch{return readProductConfig();}
  if(response.status===404)return readProductConfig();
  if(!response.ok)throw Error('The workspace product configuration could not be loaded.');
  return readProductConfig(await response.json());
}
export function applyProductConfig(document,input,{version}={}){
  const config=readProductConfig(input),el=id=>document.getElementById(id);
  document.title=config.isCombined?`Import a file · ${config.productName}`:config.productName;
  document.body.dataset.product=config.isCombined?'combined':'standalone';
  el('product-name').textContent=config.productName;
  el('product-brand').setAttribute('href',config.homePath);
  el('product-logo').setAttribute('src',config.brandIcon);
  el('product-favicon').setAttribute('href',config.featureIcon);
  el('product-licenses').setAttribute('href',config.licensesPath);
  const credit=el('conversion-credit');
  if(credit){credit.hidden=!config.isCombined;if(config.isCombined){credit.setAttribute('href',config.licensesPath);credit.querySelector('img').setAttribute('src','legal/ONLYOFFICE-logo.svg');}}
  el('workspace-dashboard').hidden=!config.isCombined;
  if(config.isCombined)el('workspace-dashboard').setAttribute('href',config.homePath);
  el('product-version').textContent=typeof version==='string'&&/^\d+\.\d+(?:\.\d+){0,2}$/.test(version)?`Version ${version}`:'Preview';
  return config;
}
