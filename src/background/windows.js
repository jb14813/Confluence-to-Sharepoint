import {fail} from './checks.js';

// Work stays in the dashboard's regular window while it exists. A closed
// window may fall back only to another regular, non-incognito window.
export async function workWindow(chromeApi,preferred){
  const windows=await chromeApi.windows.getAll({windowTypes:['normal']}).catch(()=>[]);
  const regular=windows.filter(window=>window.type==='normal'&&window.incognito!==true);
  const chosen=regular.find(window=>window.id===preferred)??regular.find(window=>window.focused)??regular[0];
  if(!Number.isInteger(chosen?.id))throw fail('work-window-unavailable','Open a regular browser window to continue.');
  return chosen.id;
}
