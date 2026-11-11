import {access,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';

const exists=async file=>{try{await access(file);return true;}catch{return false;}};

/** Prefer the pinned Playwright browser, with an explicit extension-capable
 * override or another installed full Chromium revision when necessary. */
export async function chromiumExecutable(){
  if(process.env.EXTENSION_CHROME_PATH){
    if(await exists(process.env.EXTENSION_CHROME_PATH))return process.env.EXTENSION_CHROME_PATH;
    throw Error('EXTENSION_CHROME_PATH does not point to an installed browser.');
  }
  const pinned=chromium.executablePath();if(await exists(pinned))return pinned;
  const cache=process.env.PLAYWRIGHT_BROWSERS_PATH||(process.platform==='win32'?path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'ms-playwright'):process.platform==='darwin'?path.join(os.homedir(),'Library','Caches','ms-playwright'):path.join(process.env.XDG_CACHE_HOME||path.join(os.homedir(),'.cache'),'ms-playwright'));
  const revisions=(await readdir(cache).catch(()=>[])).filter(name=>/^chromium-\d+$/.test(name)).sort((a,b)=>Number(b.slice(9))-Number(a.slice(9)));
  for(const revision of revisions)for(const layout of ['chrome-win64/chrome.exe','chrome-win/chrome.exe','chrome-linux64/chrome','chrome-linux/chrome','chrome-mac/Chromium.app/Contents/MacOS/Chromium']){
    const executable=path.join(cache,revision,layout);if(await exists(executable))return executable;
  }
  throw Error('Install Playwright Chromium or set EXTENSION_CHROME_PATH to an extension-capable Chromium executable.');
}
