// Release-time verification only. The installed extension never fetches source
// or invokes this module. A verified label cannot replace the pinned evidence.
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const VENDOR='products/file-to-sharepoint/vendor/';
const RECORDS=['converter-provenance.json','sdk-build-provenance.json','sdk-runtime-provenance.json'];
const EXTRA='provenance/third-party-source-inputs.json';
const NATIVE='provenance/native-license-inputs.json';
const DELIVERY=VENDOR+'provenance/source-delivery.json';
const execute=promisify(execFile);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=message=>{throw new Error(`Corresponding source: ${message}`);};
const requireThat=(condition,message)=>{if(!condition)fail(message);};
const stable=value=>JSON.stringify(canonical(value));
function canonical(value){return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;}
function safeFile(file){return typeof file==='string'&&file.length<256&&/^[\w.+-]+$/.test(file)&&!file.startsWith('.')&&!file.endsWith('.')&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(file);}
function relative(file){requireThat(typeof file==='string'&&/^[\w.@/-]+$/.test(file)&&file.split('/').every(part=>part&&part!=='.'&&part!=='..'),`unsafe material path: ${file}`);return file;}
const read=(root,file)=>readFile(path.join(root,relative(file)));
async function json(root,file){try{return JSON.parse(await read(root,file));}catch(error){fail(`cannot read ${file}: ${error.message}`);}}
function checkInput(input){
 requireThat(input&&safeFile(input.file),`unsafe archive filename: ${input?.file}`);
 requireThat(Number.isSafeInteger(input.bytes)&&input.bytes>0&&/^[a-f0-9]{64}$/.test(input.sha256),`invalid archive size/hash: ${input.file}`);
 let url;try{url=new URL(input.url);}catch{fail(`invalid archive URL: ${input.file}`);}
 requireThat(url.protocol==='https:'&&!url.username&&!url.password,`unsafe archive URL: ${input.file}`);
 if(input.sha512!==undefined)requireThat(/^[a-f0-9]{128}$/.test(input.sha512),`invalid SHA512: ${input.file}`);
 if(input.integrity!==undefined)requireThat(/^sha512-[A-Za-z0-9+/]{86}==$/.test(input.integrity),`invalid source registry integrity: ${input.file}`);
}

/** Canonical source inventory: file-sorted, first descriptive record retained;
 * duplicate download/version pins must agree wherever both records supply one. */
export async function readSourceInputs(root=path.resolve('.')){
 const manifest=await json(root,VENDOR+'manifest.json'),inputs=new Map(),names=new Set();
 for(const name of RECORDS)requireThat(manifest.provenanceFiles?.includes(name),`missing manifest provenance: ${name}`);
 for(const name of [...RECORDS,...(manifest.provenanceFiles?.includes('drawing-build-provenance.json')?['drawing-build-provenance.json']:[]),EXTRA,NATIVE]){
  const record=await json(root,VENDOR+name);
  requireThat(record.schemaVersion===1,`unsupported provenance schema: ${name}`);
  const list=record.preferredSourceInputs??(name==='sdk-build-provenance.json'&&record.source?.archiveUrl?[{name:'ONLYOFFICE Word SDK source',file:record.source.archiveFile,url:record.source.archiveUrl,bytes:record.source.archiveBytes,sha256:record.source.archiveSha256}]:null);
  requireThat(Array.isArray(list)&&list.length>0,`missing preferred source inputs: ${name}`);
  for(const input of list){checkInput(input);const key=input.file.toLowerCase(),previous=inputs.get(key);
   if(previous){requireThat(['file','url','bytes','sha256'].every(field=>previous[field]===input[field])&&['sha512','integrity','repository','commit','version'].every(field=>previous[field]===undefined||input[field]===undefined||previous[field]===input[field]),`conflicting archive pin: ${input.file}`);if(!previous.sha512&&input.sha512)previous.sha512=input.sha512;}
   else {requireThat(!names.has(key),`conflicting archive filename: ${input.file}`);names.add(key);inputs.set(key,structuredClone(input));}
  }
 }
 return [...inputs.values()].sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0);
}

async function pinned(root,file,pin,label=file){
 const bytes=await read(root,file);
 requireThat(pin&&/^[a-f0-9]{64}$/.test(pin.sha256)&&sha(bytes)===pin.sha256&&(!('bytes'in pin)||bytes.length===pin.bytes),`hash/size mismatch for ${label}`);
 return bytes;
}
function sourceContains(inputs,repository,commit){return inputs.some(input=>input.repository===repository&&input.commit===commit);}
function sameOutput(pin,output){return pin&&pin.bytes===output.bytes&&pin.sha256===output.sha256;}
async function validateDrawingBuild(root,inputs,manifest,pins,component,publisher){
 requireThat(component.buildProvenanceFile==='drawing-build-provenance.json'&&manifest.provenanceFiles.includes(component.buildProvenanceFile),'compatible drawing source-build provenance missing');
 const drawing=await json(root,VENDOR+component.buildProvenanceFile);
 requireThat(drawing.status==='verified-local-source-build'&&manifest.pdfRuntimeSource.status===drawing.status&&drawing.source?.repository==='https://github.com/ONLYOFFICE/core'&&drawing.source.commit===publisher.gitlinks.core,'drawing local source-build association differs');
 requireThat(sourceContains(inputs,drawing.source.repository,drawing.source.commit),'drawing corresponding source absent');
 requireThat(drawing.validation?.compile==='passed'&&drawing.validation.opensslImplementationInputs===false&&drawing.validation.opensslImplementationSourceDirectoryPresent===false&&/^Both outputs reproduced exactly\b/.test(drawing.validation.freshSourceReproduction??''),'drawing compatible build/reproduction is not verified');
 requireThat(drawing.build?.emscripten==='3.1.48'&&drawing.build.existingHashBranch==='PdfFile/lib/xpdf/Decrypt.cc: SHA384=sha384; SHA512=sha512','drawing existing hash implementation differs');
 requireThat(Array.isArray(drawing.outputs)&&drawing.outputs.length===2&&['drawingfile.js','drawingfile.wasm'].every(file=>drawing.outputs.some(output=>output.file===file)),'drawing rebuilt JS/WASM pair missing');
 requireThat(stable(component.files)===stable(drawing.outputs),'drawing runtime/build output pins differ');
 for(const output of drawing.outputs)requireThat(sameOutput(pins.get(output.file),output)&&pins.get(output.file).generator==='drawing-runtime','drawing rebuilt vendor pin differs');
 requireThat(Array.isArray(drawing.build.inputs)&&['rebuild.sh','patch-drawing.py'].every(name=>drawing.build.inputs.some(input=>input.file==='scripts/drawing-runtime-inputs/'+name)),'drawing editable build recipe missing');
 for(const input of drawing.build.inputs)await pinned(root,'products/file-to-sharepoint/'+relative(input.file),input);
 requireThat(Array.isArray(drawing.localPreferredSourceMaterials)&&drawing.localPreferredSourceMaterials.length>=3,'drawing editable patches missing');
 for(const material of drawing.localPreferredSourceMaterials)await pinned(root,VENDOR+relative(material.path),material);
 const recipeFile=drawing.localPreferredSourceMaterials.find(material=>material.path.endsWith('/drawingfile-no-openssl.json'));
 requireThat(recipeFile,'drawing patched compiler recipe absent');
 const recipe=await json(root,VENDOR+recipeFile.path);
 requireThat(recipe.wasm===true&&recipe.asm===false&&Array.isArray(recipe.define)&&!recipe.define.includes('USE_OPENSSL_HASH')&&Array.isArray(recipe.include_path)&&recipe.include_path.every(file=>!file.includes('/openssl/')),'drawing compiler recipe includes incompatible OpenSSL path');
}

async function validateProvenance(root,inputs){
 const manifest=await json(root,VENDOR+'manifest.json'),pins=new Map();
 requireThat(Array.isArray(manifest.files)&&manifest.files.length>0,'missing vendor pins');
 for(const pin of manifest.files){relative(pin.file);requireThat(!pins.has(pin.file),`duplicate vendor pin: ${pin.file}`);pins.set(pin.file,pin);await pinned(root,VENDOR+pin.file,pin);}
 const converter=await json(root,VENDOR+RECORDS[0]);
 requireThat(converter.status==='verified-upstream-release'&&manifest.converterSource?.status===converter.status,'converter source is not verified');
 requireThat(converter.repository==='https://github.com/cryptpad/onlyoffice-x2t-wasm'&&converter.commit===manifest.converterSource.commit&&converter.release?.tag===manifest.converterSource.release,'converter source association differs');
 requireThat(converter.workflow?.headSha===converter.commit&&converter.workflow.conclusion==='success'&&converter.workflow.headBranch===converter.release.tag,'converter CI head/source/success differs');
 requireThat(sourceContains(inputs,converter.repository,converter.commit),'converter source archive absent');
 const runEvidence=await json(root,VENDOR+'provenance/converter/workflow-run.json');
 const run=runEvidence.workflow_runs?.find(run=>run.id===converter.workflow.runId);
 requireThat(run?.head_sha===converter.commit&&run.conclusion==='success'&&run.status==='completed'&&run.path===converter.workflow.file&&run.head_branch===converter.release.tag,'converter successful CI run evidence differs');
 const jobs=await json(root,VENDOR+'provenance/converter/workflow-jobs.json'),job=jobs.jobs?.find(job=>job.id===converter.workflow.jobId);
 requireThat(job?.head_sha===converter.commit&&job.run_id===run.id&&job.conclusion==='success','converter CI job evidence differs');
 const tag=await json(root,VENDOR+'provenance/converter/tag.json');
 requireThat(tag.object?.sha===converter.commit&&tag.ref==='refs/tags/'+converter.release.tag,'converter tag/source evidence differs');
 const release=await json(root,VENDOR+'provenance/converter/release.json'),archive=converter.release.archive,asset=release.assets?.find(asset=>asset.id===archive.assetId);
 requireThat(release.tag_name===converter.release.tag&&asset?.size===archive.bytes&&asset.digest==='sha256:'+archive.sha256,'converter official release archive evidence differs');
 requireThat(/^[a-f0-9]{128}$/.test(archive.sha512),'converter published SHA512 missing');
 requireThat(Array.isArray(converter.outputs)&&converter.outputs.length===2&&['x2t.js','x2t.wasm'].every(file=>converter.outputs.some(output=>output.file===file)),'converter output pins missing');
 for(const output of converter.outputs){const pin=pins.get(output.file);requireThat(sameOutput(pin,output)&&pin.sourceArchiveSha256===archive.sha256&&pin.sourceArchiveSha512===archive.sha512&&pin.sourceArchiveMember===output.file,'converter output/source archive pin differs');}
 requireThat(Array.isArray(converter.buildMaterials)&&converter.buildMaterials.length>0,'converter build materials missing');
 for(const material of converter.buildMaterials)await pinned(root,VENDOR+relative(material.file),material);
 await pinned(root,VENDOR+'provenance/converter/'+relative(converter.workflow.file),{sha256:converter.workflow.sha256},'converter workflow');

 const sdk=await json(root,VENDOR+RECORDS[1]);
 requireThat(sdk.status==='verified-local-source-build'&&manifest.editorSource?.wordBundles?.status===sdk.status&&sdk.source?.commit===manifest.editorSource.commit,'SDK source/build status differs');
 requireThat(sdk.source.repository==='https://github.com/ONLYOFFICE/sdkjs'&&sdk.source.repository===manifest.editorSource.repository&&sdk.source.tag===manifest.editorSource.release&&sdk.source.archiveUrl===`https://codeload.github.com/ONLYOFFICE/sdkjs/tar.gz/${sdk.source.commit}`,'SDK publisher/source association differs');
 requireThat(sdk.validation?.compile==='passed'&&/^Both outputs reproduced exactly\b/.test(sdk.validation.freshSourceReproduction??''),'SDK fresh source reproduction is not verified');
 requireThat(/^Both outputs reproduced exactly\b/.test(sdk.validation.filteredPreferredSourceReproduction??''),'SDK preferred-source reproduction is not verified');
 requireThat(/compile-word\b.*--level=SIMPLE\b/.test(sdk.build?.command??'')&&/^[a-f0-9]{64}$/.test(sdk.build.compilerExeSha256),'SDK pinned compiler/command missing');
 requireThat(inputs.some(input=>input.file===sdk.source.archiveFile&&input.sha256===sdk.source.archiveSha256&&input.bytes===sdk.source.archiveBytes&&input.url===sdk.source.archiveUrl),'SDK corresponding source archive differs');
 requireThat(Array.isArray(sdk.outputs)&&sdk.outputs.length===2&&['office/sdkjs/word/sdk-all.js','office/sdkjs/word/sdk-all-min.js'].every(file=>sdk.outputs.some(output=>output.file===file)),'SDK outputs absent');
 for(const output of sdk.outputs)requireThat(sameOutput(pins.get(output.file),output),`SDK output pin differs: ${output.file}`);
 requireThat(Array.isArray(sdk.build.inputs)&&['package.json','npm-shrinkwrap.json','rebuild-sdk.ps1'].every(name=>sdk.build.inputs.some(input=>input.file==='scripts/word-sdk-inputs/'+name)),'SDK complete build inputs missing');
 for(const input of sdk.build.inputs)await pinned(root,'products/file-to-sharepoint/'+relative(input.file),input);

 const runtime=await json(root,VENDOR+RECORDS[2]),publisher=runtime.publisherRelease,tree=await json(root,VENDOR+relative(publisher.sourceTreeEvidence));
 requireThat(publisher.repository==='https://github.com/ONLYOFFICE/DocumentServer'&&tree.sha===publisher.commit,'runtime publisher source association differs');
 for(const key of ['core','sdkjs'])requireThat(tree.tree?.some(entry=>entry.path===key&&entry.type==='commit'&&entry.sha===publisher.gitlinks[key]),`runtime publisher ${key} gitlink differs`);
 for(const [repository,commit] of [[publisher.repository,publisher.commit],['https://github.com/ONLYOFFICE/core',publisher.gitlinks.core],['https://github.com/ONLYOFFICE/sdkjs',publisher.gitlinks.sdkjs]])requireThat(sourceContains(inputs,repository,commit),'runtime associated source archive absent');
 requireThat(manifest.pdfRuntimeSource?.coreCommit===publisher.gitlinks.core&&manifest.pdfRuntimeSource.sdkjsCommit===publisher.gitlinks.sdkjs,'runtime manifest source association differs');
 requireThat(Array.isArray(runtime.components)&&runtime.components.length===2&&['drawingfile','fonts'].every(name=>runtime.components.some(component=>component.name===name)),'runtime components absent');
 for(const component of runtime.components){
  requireThat(component.sdkjsCommit===publisher.gitlinks.sdkjs&&component.sourceCoreCommit===publisher.gitlinks.core,'runtime component source association differs');
  if(component.name==='drawingfile'){await validateDrawingBuild(root,inputs,manifest,pins,component,publisher);continue;}
  const prefix=component.name==='drawingfile'?'pdf/src/engine/drawingfile':'common/libfont/engine/fonts';
  requireThat(Array.isArray(component.files)&&component.files.length===2&&['.js','.wasm'].every(ext=>component.files.some(file=>file.sourcePath===prefix+ext)),'runtime JS/WASM pair missing');
  for(const file of component.files){const name=component.name==='drawingfile'?path.posix.basename(file.sourcePath):'office/sdkjs/'+relative(file.sourcePath),pin=pins.get(name);requireThat(pin?.sha256===file.sha256&&pin.sourceUrl===`https://raw.githubusercontent.com/ONLYOFFICE/sdkjs/${publisher.gitlinks.sdkjs}/${file.sourcePath}`,'runtime source/output pin differs');const bytes=await read(root,VENDOR+name);requireThat(/^[a-f0-9]{40}$/.test(file.blob)&&createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')===file.blob,'runtime official git blob differs');}
 }
 requireThat(Array.isArray(runtime.localPreferredSourceMaterials)&&runtime.localPreferredSourceMaterials.some(material=>material.path.endsWith('/catalog-editable.json'))&&runtime.localPreferredSourceMaterials.some(material=>material.path.endsWith('/AllFonts-mirror-modifications.patch')),'runtime local editable source materials missing');
 for(const material of runtime.localPreferredSourceMaterials)await pinned(root,VENDOR+relative(material.path),material);
 const catalog=runtime.localPreferredSourceMaterials.find(material=>material.path.endsWith('/AllFonts.js'));
 requireThat(catalog?.sha256===pins.get('office/sdkjs/common/AllFonts.js')?.sha256,'editable catalog differs from runtime catalog');
 requireThat(Array.isArray(runtime.evidenceFiles)&&runtime.evidenceFiles.length>=5,'runtime source recipes missing');
 for(const file of runtime.evidenceFiles)requireThat((await read(root,VENDOR+relative(file))).length>0,`empty runtime recipe: ${file}`);
}

async function validateLegal(root,inputs){
 for(const file of ['LICENSE',VENDOR+'ONLYOFFICE-AGPL-3.0.txt'])requireThat(/GNU AFFERO GENERAL PUBLIC LICENSE/.test((await read(root,file)).toString()),`AGPL legal notice missing: ${file}`);
 const mit=(await read(root,'assets/licenses/MIT-CORE-LICENSE.txt')).toString();requireThat(/MIT License/.test(mit)&&/Copyright \(c\) 2026 The Confluence to SharePoint authors/.test(mit)&&/Permission is hereby granted/.test(mit),'retained MIT copyright/license missing');
 const logo=await read(root,'assets/licenses/ONLYOFFICE-logo.svg'),notice=(await read(root,'assets/licenses/ONLYOFFICE-LOGO-NOTICE.txt')).toString();
 requireThat(sha(logo)==='1454d2e49a2ad2765b344f89d7349264af90160dd59ad8604a20cd03b02824c9'&&notice.includes(sha(logo))&&/Ascensio System SIA/.test(notice),'original ONLYOFFICE logo/legal attribution differs');
 requireThat(/Creative Commons/.test((await read(root,VENDOR+'CC-BY-SA-4.0.txt')).toString()),'CC BY-SA legal notice missing');
 const legal=(await read(root,'extension/licenses.html')).toString();requireThat(['legal/ONLYOFFICE-logo.svg','legal/MIT-CORE-LICENSE.txt','vendor/ONLYOFFICE-AGPL-3.0.txt','source-download','source-status'].every(text=>legal.includes(text)),'visible logo/legal/source access missing');
 const engine=(await read(root,VENDOR+'NOTICE.md')).toString();requireThat(/corresponding source/i.test(engine)&&/AGPL/.test(engine)&&/does not adopt/.test(engine),'engine attribution/modification notice missing');
 const extra=await json(root,VENDOR+EXTRA);
 requireThat(typeof extra.attributionNoticeFile==='string','additional runtime attribution notice missing');
 const noticePath=file=>VENDOR+(file.startsWith('provenance/')?relative(file):'provenance/'+relative(file));
 const attribution=(await read(root,noticePath(extra.attributionNoticeFile))).toString();
 requireThat(['MIT License','SurveyJS','JSZip','Unicode'].every(text=>attribution.includes(text)),'additional runtime license notices incomplete');
 if(extra.attributionNotice)await pinned(root,noticePath(extra.attributionNotice.file),extra.attributionNotice,'additional runtime notices');
 if(extra.attributionNoticeSha256)await pinned(root,noticePath(extra.attributionNoticeFile),{sha256:extra.attributionNoticeSha256,...(extra.attributionNoticeBytes?{bytes:extra.attributionNoticeBytes}:{})},'additional runtime notices');
 for(const material of extra.localPreferredSourceMaterials??[])await pinned(root,VENDOR+relative(material.path??material.file),material);
 const native=await json(root,VENDOR+NATIVE);
 requireThat(native.status==='verified-native-source-and-notices'&&Array.isArray(native.remainingReleaseGate)&&native.remainingReleaseGate.length===0,'native license review is blocked or incomplete');
 for(const input of native.sourceArchiveInputs??[])requireThat(inputs.some(source=>source.file===input.file&&source.bytes===input.bytes&&source.sha256===input.sha256),`native license source input absent/different: ${input.file}`);
 requireThat(native.attributionNoticeFile&&native.attributionNoticeSha256&&native.attributionNoticeBytes,'native license notice pin missing');
 await pinned(root,noticePath(native.attributionNoticeFile),{sha256:native.attributionNoticeSha256,bytes:native.attributionNoticeBytes},'native runtime notices');
}

async function verifyArchive(input,dirs){
 let mismatch;
 for(const directory of dirs){const file=path.join(directory,input.file);let info;try{info=await stat(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}
  if(!info.isFile()||info.size!==input.bytes){mismatch='size';continue;}
  const hash=createHash('sha256'),hash512=input.sha512||input.integrity?createHash('sha512'):null;for await(const chunk of createReadStream(file)){hash.update(chunk);hash512?.update(chunk);}
  const digest512=hash512?.digest();
  if(hash.digest('hex')!==input.sha256||(input.sha512&&digest512.toString('hex')!==input.sha512)||(input.integrity&&'sha512-'+digest512.toString('base64')!==input.integrity)){mismatch='hash';continue;}return;
 }
 fail(`source archive ${mismatch?mismatch+' mismatch':'missing'}: ${input.file}`);
}

export async function readSourceDelivery(root,inputs){
 const record=await json(root,DELIVERY),policyFile=VENDOR+'provenance/source-filter-policy.json',generator='products/file-to-sharepoint/scripts/filter-source-archives.py';
 requireThat(record.schemaVersion===1&&record.status==='verified-preferred-source-delivery'&&record.archives?.length===4,'preferred source delivery proof is not verified');
 requireThat(record.policy?.file===policyFile&&record.generator?.file===generator,'source delivery generator/policy paths differ');
 await pinned(root,policyFile,record.policy);await pinned(root,generator,record.generator);
 const policy=await json(root,policyFile),seen=new Set();
 requireThat(policy.archives?.length===4&&policy.policyVersion===1,'source delivery removal policy differs');
 for(const archive of record.archives){const origin=archive.upstream,published=archive.published,audit=policy.archives.find(a=>a.upstream.file===origin.file),input=inputs.find(i=>i.file===origin.file);
  requireThat(input&&audit&&!seen.has(origin.file)&&['file','url','bytes','sha256'].every(key=>input[key]===origin[key])&&['file','bytes','sha256'].every(key=>audit.upstream[key]===origin[key]),'source delivery origin pin differs');seen.add(origin.file);
  checkInput({...published,url:origin.url});requireThat(published.file===origin.file.replace(/\.tar\.gz$/,'.source-only.tar.gz')&&published.file!==origin.file,'source delivery must replace raw acquisition archive');
  requireThat(archive.rules?.policyVersion===policy.policyVersion&&archive.retainedRegularFiles===audit.retainedRegularFiles&&archive.retainedMemberIndexSha256===audit.retainedRegularMemberIndexSha256&&/^[a-f0-9]{64}$/.test(archive.retainedNonRegularMemberIndexSha256),'source delivery retained code index differs');
  const sorted=entries=>[...entries].sort((a,b)=>a.member<b.member?-1:a.member>b.member?1:0);
  requireThat(stable(sorted(archive.removedMembers))===stable(sorted(audit.removedMembers)),'source delivery exclusions differ from exact audited pins');
 }
 return record;
}

/** Throws on any missing/tampered source, evidence, legal or release metadata. */
export async function validateSourceRelease({root=path.resolve('.'),sourceDirs,verifyArchives=true}={}){
 root=path.resolve(root);const manifest=await json(root,'SOURCE-MANIFEST.json'),pkg=await json(root,'package.json'),extension=await json(root,'extension/manifest.json');
 requireThat(manifest.schemaVersion===1&&manifest.status==='verified-corresponding-source','release status is not verified-corresponding-source');
 requireThat(manifest.version===pkg.version&&manifest.version===extension.version,'source release version differs');
 const file=`confluence-to-sharepoint-${manifest.version}-source.zip`,url=`https://github.com/jb14813/Confluence-to-Sharepoint/releases/download/v${manifest.version}/${file}`;
 requireThat(manifest.sourceArchive?.filename===file&&manifest.sourceArchive.downloadUrl===url&&manifest.sourceArchive.checksumUrl===url+'.sha256','source archive release filename/download/checksum differs');
 const inputs=await readSourceInputs(root),raw=await read(root,'SOURCE-INPUTS.json');let inventory;try{inventory=JSON.parse(raw);}catch{fail('invalid SOURCE-INPUTS inventory');}
 requireThat(inventory.schemaVersion===1&&stable(inventory.archives)===stable(inputs),'SOURCE-INPUTS inventory differs from required source records');
 const bytes=inputs.reduce((sum,input)=>sum+input.bytes,0),record=manifest.sourceInputs;
 requireThat(record?.file==='SOURCE-INPUTS.json'&&record.count===inputs.length&&record.bytes===bytes&&record.sha256===sha(raw),'SOURCE-INPUTS inventory count/bytes/hash differs');
 requireThat(manifest.sourceDelivery?.file===DELIVERY&&manifest.sourceDelivery.archives===4,'preferred source delivery manifest proof missing');
 await pinned(root,DELIVERY,manifest.sourceDelivery);
 const delivery=await readSourceDelivery(root,inputs),mapping=new Map(delivery.archives.map(a=>[a.upstream.file,a.published]));
 await validateProvenance(root,inputs);await validateLegal(root,inputs);
 if(verifyArchives){sourceDirs??=process.env.C2S_SOURCE_DIR?.split(path.delimiter).filter(Boolean)??['.artifacts/onlyoffice-eval/corresponding-source','.artifacts/combined-license-provenance/third-party-source','.artifacts/combined-license-provenance/native','.artifacts/preferred-source-delivery'];requireThat(Array.isArray(sourceDirs)&&sourceDirs.length>0,'explicit source archive directories required');const dirs=sourceDirs.map(dir=>path.resolve(root,dir));for(const input of inputs)await verifyArchive(mapping.get(input.file)??input,dirs);await execute(process.env.PYTHON??(process.platform==='win32'?'python':'python3'),[path.join(root,delivery.generator.file),'--verify',path.join(root,DELIVERY),...dirs.flatMap(dir=>['--source-dir',dir])],{maxBuffer:1024*1024,windowsHide:true});}
 return {manifest,inputs,delivery,archiveCount:inputs.length,archiveBytes:bytes,deliveryArchiveBytes:inputs.reduce((sum,input)=>sum+(mapping.get(input.file)?.bytes??input.bytes),0)};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),sourceDirs=[];requireThat(args.shift()==='--check','usage: source-release.mjs --check [--source-dir DIR]...');
 while(args.length){requireThat(args.shift()==='--source-dir'&&args.length>0,'usage: source-release.mjs --check [--source-dir DIR]...');sourceDirs.push(args.shift());}
 const result=await validateSourceRelease({sourceDirs:sourceDirs.length?sourceDirs:undefined});console.log(`Verified corresponding source: ${result.archiveCount} acquisition pins, ${result.delivery.archives.length} source-only substitutions (${result.deliveryArchiveBytes} delivered bytes).`);
}
