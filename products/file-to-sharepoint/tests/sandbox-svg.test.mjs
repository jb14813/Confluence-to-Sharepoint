import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';

test('inline SVG freezes the browser cascade before becoming an isolated PNG',{timeout:30000},async()=>{
  const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/engine/sandbox-svg.js',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'FtsSvg',platform:'browser'});
  const browser=await chromium.launch({headless:true,executablePath:await chromiumExecutable()});
  try{
    const page=await browser.newPage(),requests=[];
    await page.route('**/*',route=>{if(route.request().url()==='https://inline-svg.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'});requests.push(route.request().url());return route.abort();});
    await page.goto('https://inline-svg.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});
    const result=await page.evaluate(async()=>{
      const run=async(html,options={})=>{
        const source=new DOMParser().parseFromString(html,'text/html');
        const plan=await FtsSvg.preflight(source.body,{resources:[],totalBytes:html.length*2,maxBytes:150*1024*1024,...options});
        const host=document.createElement('html');host.inert=true;host.append(document.importNode(source.head,true),document.importNode(source.body,true));document.body.append(host);
        const urls=[];
        try{
          const prepared=await FtsSvg.prepare(host.querySelector('body'),plan,{register:file=>{const url=URL.createObjectURL(new Blob([file.bytes],{type:file.mime}));urls.push(url);return url;}}),image=host.querySelector('img'),pixels=[];
          for(const file of prepared.inlineImages){const bitmap=await createImageBitmap(new Blob([file.bytes],{type:file.mime})),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();pixels.push([...ctx.getImageData(canvas.width/2,canvas.height/2,1,1).data]);}
          return{images:prepared.inlineImages.map(({bytes,...metadata})=>metadata),pixels,styleWidth:image?.style.width,styleHeight:image?.style.height,remaining:host.querySelectorAll('svg').length};
        }finally{host.remove();urls.forEach(url=>URL.revokeObjectURL(url));}
      };
      const icon='<svg xmlns="http://www.w3.org/2000/svg" class="icon" width="80" height="40" viewBox="0 0 80 40"><rect width="80" height="40" fill="currentColor"/></svg>';
      const color=await run('<style>svg.icon{width:20px;height:10px}</style><div style="color:red">'+icon+'</div>');
      const variable=await run('<style>svg.icon{width:20px;height:10px;fill:var(--ink)} rect{fill:inherit}</style><div style="--ink:rgb(0,192,0)">'+icon+'</div>');
      const descendant=await run('<style>.search-macro button svg.icon{width:20px;height:10px}.search-macro button svg.icon rect{fill:rgb(0,128,255)}</style><div class="search-macro"><button>'+icon+'</button></div>');
      const gradient=await run('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><style>rect{fill:url("#paint")}</style><defs><linearGradient id="paint"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="red"/></linearGradient></defs><rect width="20" height="10"/></svg>');
      const errors={};
      for(const[name,html,options]of [
        ['event','<svg xmlns="http://www.w3.org/2000/svg" onload="window.executed=true"/>',{}],
        ['budget',icon,{maxBytes:1}],
        ['missing','<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="url(#missing)"/></svg>',{}],
        ['outside','<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="shared"><stop stop-color="red"/></linearGradient></defs></svg><svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="url(#shared)"/></svg>',{}],
        ['duplicate','<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><defs><linearGradient id="paint"><stop stop-color="red"/></linearGradient></defs><rect width="20" height="10" fill="url(#paint)"/></svg><svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><defs><linearGradient id="paint"><stop stop-color="green"/></linearGradient></defs><rect width="20" height="10" fill="url(#paint)"/></svg>',{}],
        ['animation','<style>@keyframes fade{from{opacity:0}to{opacity:1}}svg{animation:fade 1s infinite}</style>'+icon,{}]
      ])try{await run(html,options);errors[name]='accepted';}catch(error){errors[name]=error.code;}
      return{color,variable,descendant,gradient,errors,executed:window.executed===true};
    });
    for(const key of ['color','variable','descendant']){assert.equal(result[key].styleWidth,'20px');assert.equal(result[key].styleHeight,'10px');assert.equal(result[key].images[0].width,40);assert.equal(result[key].images[0].height,20);assert.equal(result[key].remaining,0);}
    assert.deepEqual(result.color.pixels,[[255,0,0,255]]);assert.deepEqual(result.variable.pixels,[[0,192,0,255]]);assert.deepEqual(result.descendant.pixels,[[0,128,255,255]]);assert.deepEqual(result.gradient.pixels,[[255,0,0,255]]);
    assert.ok(Object.values(result.errors).every(code=>/^HTML_SVG_|HTML_RESOURCE_BLOCKED|DOCUMENT_TOO_LARGE/.test(code)),JSON.stringify(result.errors));assert.equal(result.executed,false);assert.deepEqual(requests,[]);
  }finally{await browser.close();}
});
import {chromiumExecutable} from './chromium.mjs';
