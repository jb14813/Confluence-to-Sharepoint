const status=document.getElementById('source-status'),download=document.getElementById('source-download');
let navigationError;
for(const [href,action]of [['dashboard.html','open-dashboard'],['file-workspace.html','open-file-import']]){
 document.querySelector(`a[href="${href}"]`)?.addEventListener('click',async event=>{
  event.preventDefault();try{const reply=await chrome.runtime.sendMessage({channel:'c2s-popup',action,payload:{}});if(!reply?.ok)throw Error('Reopen the extension and try again.');navigationError?.remove();}
  catch{navigationError??=document.createElement('p');navigationError.setAttribute('role','alert');navigationError.textContent='The view could not be opened. Reopen the extension and try again.';document.querySelector('footer').append(navigationError);}
 });
}
(async()=>{
 const response=await fetch('SOURCE-MANIFEST.json',{cache:'no-store'});if(!response.ok)throw Error('Source information could not be loaded.');
 const manifest=await response.json();
 if(manifest.status!=='verified-corresponding-source'){status.textContent='Development build: corresponding-source verification is in progress. This package is not cleared for public release.';return;}
 const url=new URL(manifest.sourceArchive?.downloadUrl);
 const repository=new URL('https://github.com/jb14813/Confluence-to-Sharepoint');
 if(url.protocol!=='https:'||url.hostname!==repository.hostname||!url.pathname.startsWith(repository.pathname+'/releases/download/')||url.username||url.password)throw Error('The source download reference is invalid.');
 status.textContent=`Corresponding-source inventory verified for version ${manifest.version}. The download includes the extension source, upstream source archives, pinned build inputs and instructions.`;
 download.href=url.href;download.hidden=false;
})().catch(error=>{status.textContent=`Source information unavailable. ${error.message}`;});
