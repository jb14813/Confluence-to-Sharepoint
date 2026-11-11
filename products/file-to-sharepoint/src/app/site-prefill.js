import {siteKey} from '../../../../src/background/sites.js';

/** A shortcut may suggest a destination; it never replaces an existing review. */
export function installFileSitePrefill({input,location=globalThis.location,events=globalThis,canApply=()=>true,onChange=()=>{}}){
  let supplied=null;
  function apply(){
    const hash=location.hash??'';
    if(hash.length>5000||!canApply()||input.value&&input.value!==supplied)return;
    const params=new URLSearchParams(hash.replace(/^#/,''));
    if([...params.keys()].some(key=>key!=='site')||params.getAll('site').length!==1)return;
    const site=siteKey(params.get('site'));
    if(!site)return;
    input.value=site;supplied=site;onChange();
  }
  events.addEventListener('hashchange',apply);apply();
  return {apply,destroy(){events.removeEventListener('hashchange',apply);}};
}
