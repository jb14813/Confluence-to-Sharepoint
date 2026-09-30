// The pinned sites, synced by Chrome to every Chrome browser the user is signed in to with Chrome sync on; with it
// off, Chrome keeps them as local storage (https://developer.chrome.com/docs/extensions/reference/api/storage). One
// item per site, `pin <site address>`: {t: title, on: 1 pinned or 0 unpinned, at: when}; the newer state of a site
// wins, and every browser pins the sites whose item is on, the newest first, at most 29 (as sites.js allows).
// Chrome sync allows 8,192 bytes an item, 512 items and 120 writes a minute: one small item a site, written when the
// user pins, unpins or removes a site, fits them.
import {siteKey} from './sites.js';

const PREFIX='pin ',LIMIT=29,MAX_UNPINNED=50;
const text=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,255):'';

export function createPins({sync=globalThis.chrome?.storage?.sync,sites,now=()=>Date.now()}={}){
  // Without Chrome's synced storage (not the case in Chrome), pins are this browser's own, as sites.js keeps them.
  if(!sync?.get||!sync?.set)return {start:async()=>{},apply:async()=>{},record:async()=>{},changed:async()=>{},forget:async()=>{}};
  // Every pin item, rebuilt field by field: only a SharePoint site's address, a title, a state and a date.
  async function read(){
    const all=await sync.get(null);
    return Object.entries(all??{}).filter(([key])=>key.startsWith(PREFIX)).map(([key,value])=>{
      const url=siteKey(key.slice(PREFIX.length));
      return url&&url===key.slice(PREFIX.length)&&value&&typeof value==='object'?{url,t:text(value.t),on:value.on===1?1:0,at:Number.isSafeInteger(value.at)&&value.at>=0?value.at:0}:null;
    }).filter(Boolean);
  }
  // The sites whose item is on are the pinned ones, the newest first; the rest are not pinned.
  async function apply(){
    const on=(await read()).filter(pin=>pin.on).sort((a,b)=>b.at-a.at).slice(0,LIMIT);
    await sites.applyPins(on.map(pin=>({url:pin.url,title:pin.t})));
  }
  // Unpinned states are kept only to outdate older pins elsewhere: the newest 50 stay.
  async function trim(){
    const off=(await read()).filter(pin=>!pin.on).sort((a,b)=>b.at-a.at);
    if(off.length>MAX_UNPINNED)await sync.remove(off.slice(MAX_UNPINNED).map(pin=>PREFIX+pin.url));
  }
  return {
    /**
     * At the background's start: pins this browser had from before 0.4.9, which Chrome sync does not know, go there
     * undated, so a dated state from another browser wins; then the synced pins are shown.
     */
    async start(){
      const known=new Set((await read()).map(pin=>pin.url));
      const only=(await sites.list()).filter(site=>site.pinned&&!known.has(site.url));
      if(only.length)await sync.set(Object.fromEntries(only.map(site=>[PREFIX+site.url,{t:text(site.title),on:1,at:0}])));
      await apply();
    },
    /** The user's own Pin or Unpin (or Remove site) of `url`, dated now, for every browser. */
    async record(url,title,pinned){
      const key=siteKey(url);
      if(!key)return;
      await sync.set({[PREFIX+key]:{t:text(title),on:pinned?1:0,at:now()}});
      if(!pinned)await trim();
    },
    /** A change Chrome sync brought (or this browser made): the pins are shown again when a pin item changed. */
    async changed(changes){
      if(Object.keys(changes??{}).some(key=>key.startsWith(PREFIX)))await apply();
    },
    /** Forget all: every synced pin is unpinned, dated now, so the pins do not come back from another browser. */
    async forget(){
      const on=(await read()).filter(pin=>pin.on),at=now();
      if(on.length)await sync.set(Object.fromEntries(on.map(pin=>[PREFIX+pin.url,{t:pin.t,on:0,at}])));
      await trim();
    }
  };
}
