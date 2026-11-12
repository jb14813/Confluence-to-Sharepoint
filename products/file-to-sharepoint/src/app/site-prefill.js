import {siteKey,pageKey} from '../../../../src/background/sites.js';

/** A shortcut may suggest a destination; it never replaces an existing review. */
export function installFileSitePrefill({input,location=globalThis.location,events=globalThis,canApply=()=>true,onChange=()=>{},onPage=()=>{}}){
  let supplied=null;
  function apply(){
    const hash=location.hash??'';
    if(hash.length>5000||!canApply()||input.value&&input.value!==supplied)return;
    const params=new URLSearchParams(hash.replace(/^#/,''));
    if([...params.keys()].some(key=>!['site','page'].includes(key))||params.getAll('site').length!==1||params.getAll('page').length>1)return;
    const site=siteKey(params.get('site'));
    const page=params.get('page');if(!site||page!==null&&!pageKey(site,page))return;
    input.value=site;supplied=site;onPage(page);onChange();
  }
  events.addEventListener('hashchange',apply);apply();
  return {apply,destroy(){events.removeEventListener('hashchange',apply);}};
}
