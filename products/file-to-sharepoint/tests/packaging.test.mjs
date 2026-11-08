import test from 'node:test';import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {readFile,stat} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url)),out=path.join(root,'.artifacts/file-package-test');
test('standalone File extension packages only local executable assets and source-independent SharePoint modules',async()=>{
 await promisify(execFile)(process.execPath,['products/file-to-sharepoint/scripts/build.mjs'],{cwd:root,env:{...process.env,FTS_BUILD_DIR:out},maxBuffer:1024*1024});
 const manifest=JSON.parse(await readFile(path.join(out,'manifest.json'),'utf8'));
 assert.equal(manifest.name,'File to SharePoint');assert.deepEqual(manifest.host_permissions,['https://*.sharepoint.com/*']);assert.deepEqual(manifest.permissions,['scripting','storage']);assert.deepEqual(manifest.sandbox.pages,['src/engine/sandbox.html']);
 assert.match(manifest.content_security_policy.extension_pages,/'wasm-unsafe-eval'/);assert.doesNotMatch(manifest.content_security_policy.extension_pages,/'unsafe-eval'/);
 for(const file of ['workspace.html','workspace.css','src/app/workspace.js','src/engine/index.js','src/engine/worker.js','src/engine/sandbox.html','destination.js','background.js','memory.js','vendor/x2t.wasm','vendor/drawingfile.wasm','form/portable-form.js','icons/icon16.png','icons/icon128.png','icons/logo.svg','LICENSE.txt','THIRD-PARTY-NOTICES.txt'])assert.ok((await stat(path.join(out,file))).size>0,file);
 const meta=JSON.parse(await readFile(path.join(out,'build-inputs.json'),'utf8'));
 for(const input of meta.inputs)assert.doesNotMatch(input,/(?:src\/confluence\/|src\/background\/(?:account|links|bulk-updates|jobs)\.js)/,input);
 const html=await readFile(path.join(out,'workspace.html'),'utf8');assert.doesNotMatch(html,/<(?:script|link)\b[^>]*(?:src|href)="https?:/);assert.match(html,/File to SharePoint/);
});
