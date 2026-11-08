// Renders every File to SharePoint icon from assets/logo.svg,
// with Chrome's own SVG rasterizer. Each size is drawn from the vector rather
// than scaled from one bitmap, so small icons stay sharp.
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'assets','logo.svg');
// `padding` is the transparent margin on each side in output pixels. The Chrome
// Web Store asks for 96x96 artwork centred in the 128x128 icon; toolbar and
// favicon sizes run the artwork almost edge to edge so it stays legible.
const EXTENSION_ICONS=[{size:16,padding:0},{size:32,padding:1},{size:48,padding:2},{size:128,padding:16}];
const WEB_LOGO={size:512,padding:16};

const svg=await readFile(source,'utf8');
const candidates=process.platform==='win32'
  ? [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean).map(base=>path.join(base,'Google','Chrome','Application','chrome.exe'))
  : ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const executablePath=process.env.CHROME_PATH||candidates.find(candidate=>existsSync(candidate));
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
let rendered;
try{
  const page=await browser.newPage();
  rendered=await page.evaluate(async({svg,requests})=>{
    const encode=markup=>`data:image/svg+xml;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(markup)))}`;
    const load=async markup=>{const image=new Image();image.src=encode(markup);await image.decode();return image;};
    const view=/<svg\b[^>]*\bviewBox="\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)\s*"/.exec(svg)?.slice(1).map(Number);
    if(!view||view[2]!==view[3])throw new Error('The logo needs a square viewBox.');
    const [vx,vy,side]=view;
    // Measure the opaque artwork inside the view box so every crop centres it.
    const probe=1000,canvas=document.createElement('canvas');canvas.width=canvas.height=probe;
    const context=canvas.getContext('2d');context.drawImage(await load(svg),0,0,probe,probe);
    const alpha=context.getImageData(0,0,probe,probe).data;
    let minX=probe,minY=probe,maxX=-1,maxY=-1;
    for(let y=0;y<probe;y++)for(let x=0;x<probe;x++)if(alpha[(y*probe+x)*4+3]>8){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    const unit=side/probe,art={x:vx+minX*unit,y:vy+minY*unit,width:(maxX-minX+1)*unit,height:(maxY-minY+1)*unit};
    const results=[];
    for(const {size,padding} of requests){
      const scale=(size-2*padding)/Math.max(art.width,art.height),crop=size/scale;
      const x=art.x+art.width/2-crop/2,y=art.y+art.height/2-crop/2;
      const markup=svg.replace(/<svg\b[^>]*>/,tag=>tag.replace(/\bviewBox="[^"]*"/,`viewBox="${x} ${y} ${crop} ${crop}"`)
        .replace(/\bwidth="[^"]*"/,`width="${size}"`).replace(/\bheight="[^"]*"/,`height="${size}"`));
      const output=document.createElement('canvas');output.width=output.height=size;
      output.getContext('2d').drawImage(await load(markup),0,0,size,size);
      results.push({size,padding,png:output.toDataURL('image/png').split(',')[1]});
    }
    return results;
  },{svg,requests:[...EXTENSION_ICONS,WEB_LOGO]});
}finally{await browser.close();}

const take=({size,padding})=>Buffer.from(rendered.find(item=>item.size===size&&item.padding===padding).png,'base64');
await mkdir(path.join(root,'assets','icons'),{recursive:true});
for(const icon of EXTENSION_ICONS)await writeFile(path.join(root,'assets','icons',`icon${icon.size}.png`),take(icon));
await copyFile(source,path.join(root,'assets','icons','logo.svg'));
await writeFile(path.join(root,'assets','logo-512.png'),take(WEB_LOGO));
console.log('Rendered File to SharePoint icons 16/32/48/128 and logo-512.png from assets/logo.svg.');
