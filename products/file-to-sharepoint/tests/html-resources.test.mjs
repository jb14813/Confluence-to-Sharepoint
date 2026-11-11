import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';

test('linked Word images require consent, preserve raster bytes, and rasterize SVG locally',{timeout:30000},async()=>{
  const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/engine/html-resources.js',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'HtmlResources',platform:'browser'});
  const browser=await chromium.launch({headless:true,executablePath:await chromiumExecutable()});
  try{
    const page=await browser.newPage(),network=[];
    await page.route('**/*',r=>{if(r.request().url()==='https://file-import.test/')return r.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});network.push(r.request().url());return r.abort();});
    await page.goto('https://file-import.test/');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const result=await page.evaluate(async()=>{
      const source=()=>({html:'<p>Badge</p><img src="https://images.example/badge.svg"><img src="https://images.example/badge.svg">',rootLocation:'file:///C:/exported.html',resources:[]});
      const svg='<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20"><rect width="80" height="20" fill="red"/><text x="2" y="15">Badge</text></svg>';
      const requests=[];
      const fetchImpl=async(url,options)=>{requests.push({url,credentials:options.credentials,referrerPolicy:options.referrerPolicy,redirect:options.redirect});return new Response(svg,{headers:{'content-type':'image/svg+xml'}});};
      let denied;try{await HtmlResources.prepareHtmlResources(source(),{fetchImpl});}catch(e){denied={code:e.code,urls:e.urls};}
      const before=requests.length,loaded=await HtmlResources.prepareHtmlResources(source(),{loadLinkedImages:true,fetchImpl});
      const resource=loaded.htmlImport.resources[0],bitmap=await createImageBitmap(new Blob([resource.bytes],{type:resource.mime}));
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
      const png=new Uint8Array(await(await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))).arrayBuffer());
      const raster={html:'<img src="https://images.example/photo.png">',rootLocation:'file:///C:/exported.html',resources:[]};
      const kept=await HtmlResources.prepareHtmlResources(raster,{loadLinkedImages:true,fetchImpl:async()=>new Response(png,{headers:{'content-type':'application/octet-stream'}})});
      const inline=await HtmlResources.prepareHtmlResources({html:svg,rootLocation:raster.rootLocation,resources:[]});
      const placeholder=await HtmlResources.prepareHtmlResources({html:'<p>Source missing <img class="confluence-embedded-file unknown-attachment" src="/wiki/plugins/servlet/confluence/placeholder/unknown-attachment?locale=en_US"></p>',rootLocation:raster.rootLocation,resources:[]});
      const styled=await HtmlResources.prepareHtmlResources({html:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40" style="width:20px;height:10px;vertical-align:middle"><rect width="80" height="40" fill="red"/></svg>',rootLocation:raster.rootLocation,resources:[{name:'mhtml-resource-1.bin',contentId:'mhtml-resource-2.bin',location:'',mime:'image/png',bytes:png}]});
      const styledDoc=new DOMParser().parseFromString(styled.htmlImport.html,'text/html');
      const depResults=[];for(const paint of ['fill="url(https://images.example/paint.svg#red)"','style="fill:u\\72l(https://images.example/paint.svg#red)"','style="fill:url(&quot;#paint&quot;)"']){
        try{await HtmlResources.prepareHtmlResources({html:`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><defs><linearGradient id="paint"><stop stop-color="red"/></linearGradient></defs><rect width="10" height="10" ${paint}/></svg>`,rootLocation:raster.rootLocation,resources:[]});depResults.push('accepted');}catch(e){depResults.push(e.code);}
      }
      let active;try{await HtmlResources.prepareHtmlResources({html:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="this.firstElementChild.setAttribute(\'fill\',\'red\')"><rect width="10" height="10" fill="none"/></svg>',rootLocation:raster.rootLocation,resources:[]});}catch(e){active=e.code;}
      let tooMany;try{await HtmlResources.prepareHtmlResources({html:'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'.repeat(4097),rootLocation:raster.rootLocation,resources:[]});}catch(e){tooMany=e.code;}
      const raceController=new AbortController(),originalDigest=crypto.subtle.digest.bind(crypto.subtle);let digestCalls=0,raceFetches=0,raceError;
      crypto.subtle.digest=async(...args)=>{if(++digestCalls===1)raceController.abort();return originalDigest(...args);};
      try{await HtmlResources.prepareHtmlResources({...raster,html:'<img src="https://images.example/one.png"><img src="https://images.example/two.png">'},{loadLinkedImages:true,signal:raceController.signal,fetchImpl:async()=>{raceFetches++;return new Response(png);}});}catch(e){raceError=e.name;}finally{crypto.subtle.digest=originalDigest;}
      let unsafe,redirect,abort;
      try{await HtmlResources.prepareHtmlResources({...raster,html:'<img src="http://images.example/a.png">'},{loadLinkedImages:true,fetchImpl});}catch(e){unsafe=e.code;}
      try{await HtmlResources.prepareHtmlResources(raster,{loadLinkedImages:true,fetchImpl:async()=>Object.assign(new Response(svg,{headers:{'content-type':'image/svg+xml'}}),{redirected:true})});}catch(e){redirect=e.code;}
      const controller=new AbortController();controller.abort();try{await HtmlResources.prepareHtmlResources(raster,{loadLinkedImages:true,fetchImpl,signal:controller.signal});}catch(e){abort=e.name;}
      return{denied,before,requests,sourceUnchanged:source().resources.length===0,count:loaded.htmlImport.resources.length,mime:resource.mime,width:canvas.width,height:canvas.height,retained:Array.from(kept.htmlImport.resources[0].bytes),original:Array.from(png),inlineCount:inline.htmlImport.resources.length,inlineHtml:inline.htmlImport.html,placeholder:placeholder.htmlImport.html,unsafe,redirect,abort,provenance:loaded.linkedImages,styledWidth:styledDoc.querySelector('svg').style.width,cids:styled.htmlImport.resources.map(r=>r.contentId),depResults,raceFetches,raceError,active,tooMany};
    });
    assert.equal(result.denied.code,'HTML_LINKED_IMAGES_REQUIRED');assert.deepEqual(result.denied.urls,['https://images.example/badge.svg']);assert.equal(result.before,0);
    assert.equal(result.count,1);assert.equal(result.mime,'image/png');assert.equal(result.width,160);assert.equal(result.height,40);
    assert.deepEqual(result.requests,[{url:'https://images.example/badge.svg',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error'}]);
    assert.deepEqual(result.retained,result.original);assert.ok(result.sourceUnchanged);assert.equal(result.inlineCount,0);assert.match(result.inlineHtml,/<svg\b/,'Inline SVG keeps its source cascade until the isolated HTML host renders it');
    assert.match(result.placeholder,/unknown-attachment/);
    assert.equal(result.styledWidth,'20px');assert.equal(new Set(result.cids).size,result.cids.length);assert.deepEqual(result.depResults,['HTML_RESOURCE_BLOCKED','HTML_RESOURCE_BLOCKED','accepted']);assert.equal(result.raceFetches,1);assert.equal(result.raceError,'AbortError');
    assert.equal(result.active,'HTML_RESOURCE_BLOCKED');
    assert.equal(result.tooMany,'DOCUMENT_TOO_LARGE');
    assert.equal(result.unsafe,'HTML_RESOURCE_BLOCKED');assert.equal(result.redirect,'HTML_LINKED_IMAGE_FAILED');assert.equal(result.abort,'AbortError');
    assert.equal(result.provenance[0].url,'https://images.example/badge.svg');assert.match(result.provenance[0].sourceHash,/^[a-f0-9]{64}$/);assert.match(result.provenance[0].outputHash,/^[a-f0-9]{64}$/);
    assert.deepEqual(network,[]);
  }finally{await browser.close();}
});
import {chromiumExecutable} from './chromium.mjs';
