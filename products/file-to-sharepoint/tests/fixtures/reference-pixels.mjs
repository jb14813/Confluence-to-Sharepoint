// Test/reference production only; never included in the installed extension.
// Decode the independent reference PNGs without running the converter.
import {chromium} from 'playwright';
import {readFile,writeFile,readdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=async file=>{try{await access(file);return true;}catch{return false;}};
const cache=process.env.PLAYWRIGHT_BROWSERS_PATH||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.cache'),'ms-playwright');
const candidates=[process.env.EXTENSION_CHROME_PATH,process.env.CHROME_PATH,chromium.executablePath()];
for(const revision of (await readdir(cache).catch(()=>[])).filter(name=>/^chromium-\d+$/.test(name)).sort((a,b)=>Number(b.slice(9))-Number(a.slice(9))))
  for(const suffix of ['chrome-win64/chrome.exe','chrome-win/chrome.exe','chrome-linux/chrome','chrome-linux64/chrome'])candidates.push(path.join(cache,revision,suffix));
let executablePath;for(const file of candidates)if(file&&await exists(file)){executablePath=file;break;}
if(!executablePath)throw Error('Set EXTENSION_CHROME_PATH to Chromium.');
const fixtures=JSON.parse(await readFile(new URL('./pdf-images.json',import.meta.url),'utf8'));
const browser=await chromium.launch({headless:true,executablePath,args:['--disable-background-networking','--disable-component-update','--no-first-run']});
try{
  const page=await browser.newPage();await page.route(/^https?:/,route=>route.abort());
  await page.goto(import.meta.url); // Local file is a secure context for SHA-256.
  const cases=[];
  for(const fixture of fixtures){
    const pixels=await page.evaluate(async base64=>{
      const image=await createImageBitmap(new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))]),{colorSpaceConversion:'none'});
      try{const canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
        const rgba=ctx.getImageData(0,0,image.width,image.height).data;
        return {width:image.width,height:image.height,rgbaSha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',rgba)),n=>n.toString(16).padStart(2,'0')).join('')};
      }finally{image.close();}
    },fixture.original);
    cases.push({name:fixture.name,referencePngSha256:sha(Buffer.from(fixture.original,'base64')),rawRgbaSha256:fixture.rgbaSha256,...pixels});
  }
  const record={schemaVersion:1,method:'independent reference PNG only; createImageBitmap colorSpaceConversion:none; Canvas2D drawImage/getImageData RGBA; alpha may normalize through premultiplication',browserVersion:browser.version(),cases};
  const output=new URL('../../vendor/provenance/converter/browser-reference-pixels.json',import.meta.url);
  await writeFile(output,JSON.stringify(record,null,2)+'\n');
  console.log(JSON.stringify(record,null,2));
}finally{await browser.close();}
