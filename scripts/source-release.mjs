// Release-time verification only. The installed extension never fetches source
// or invokes this module. A verified label cannot replace the pinned evidence.
import {readFile,stat,mkdir,mkdtemp} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {converterRecipeInputsComplete} from '../products/file-to-sharepoint/scripts/converter-recipe-inputs.mjs';
import {drawingRecipeInputsComplete} from '../products/file-to-sharepoint/scripts/drawing-recipe-inputs.mjs';

const VENDOR='products/file-to-sharepoint/vendor/';
const RECORDS=['converter-provenance.json','sdk-build-provenance.json','sdk-runtime-provenance.json'];
const EXTRA='provenance/third-party-source-inputs.json';
const NATIVE='provenance/native-license-inputs.json';
const DELIVERY=VENDOR+'provenance/source-delivery.json';
const SOURCE_DIRS=['.artifacts/onlyoffice-eval/corresponding-source','.artifacts/combined-license-provenance/third-party-source','.artifacts/combined-license-provenance/native','.artifacts/preferred-source-delivery','../upstream-sources'];
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
 for(const name of [...RECORDS,...['drawing-build-provenance.json','converter-build-provenance.json','mime-parser-build-provenance.json'].filter(name=>manifest.provenanceFiles?.includes(name)),EXTRA,NATIVE]){
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
const MIME_RECORD='mime-parser-build-provenance.json';
const MIME_SOURCE={file:'protontech-crypto-2.2.0.tgz',url:'https://registry.npmjs.org/@protontech/crypto/-/crypto-2.2.0.tgz',bytes:115874,sha256:'6b523327ed72c6173f86c0ece970996174c6c81be5aa2f8ff8bd1c3da6ddeae4',integrity:'sha512-WjoNBMn07LxnYE6QLgniEnNfP0Apmvqgi8P48udFtvAxhSnVwiHqmXxMaVHJxBRaJev/DlOKJ67OGYj+3yGYPA==',repository:'https://github.com/ProtonMail/WebPackages',version:'2.2.0',role:'mime-parser-source'};
const MIME_CLOSURE=['entry.js','package/src/jsmimeparser/headerParser.js','package/src/jsmimeparser/rawMimeParser.js','package/src/jsmimeparser/structuredHeaders.js','package/src/jsmimeparser/textDecoders.js','package/src/jsmimeparser/utils.js','package/src/utils.ts'];
const MIME_LICENSES=[
 {file:'provenance/PROTON-GPL-3.0.txt',bytes:32473,sha256:'1b3782ccad7b8614100cda30d3faf42fc39f2e97932908c543005053b654ca68'},
 {file:'provenance/PROTON-MIME-MIT.txt',bytes:1058,sha256:'d7cc10b09e57053b82df0c5533b7c3e28e011746af67e4915353b8f6a2d7cb96'},
 {file:'provenance/PROTON-MPL-2.0.txt',bytes:16726,sha256:'3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04'}
];

/** Independent MIME-component gate. Archive-disabled calls verify bindings only;
 * full release checks execute this provided source tree's offline build CLI in a
 * fresh directory and compare its actual output, rather than trusting a stamp.
 */
export async function validateMimeSource({root=path.resolve('.'),inputs,sourceDirs,verifyArchives=true,workDirectory}={}){
 try{
  root=path.resolve(root);
  const manifest=await json(root,VENDOR+'manifest.json'),component=manifest.mimeParserSource;
  requireThat(component?.package==='@protontech/crypto'&&component.version==='2.2.0'&&component.repository===MIME_SOURCE.repository&&component.status==='verified-local-source-build'&&component.buildProvenanceFile===MIME_RECORD,'MIME component/source association missing or different');
  requireThat(manifest.provenanceFiles?.filter(file=>file===MIME_RECORD).length===1,'MIME build provenance must be inventoried exactly once');
  const record=await json(root,VENDOR+MIME_RECORD),source=record.preferredSourceInputs?.[0];
  requireThat(record.schemaVersion===1&&record.status===component.status&&record.preferredSourceInputs?.length===1&&Object.entries(MIME_SOURCE).every(([key,value])=>source?.[key]===value),'MIME preferred source archive association differs');
  checkInput(source);
  if(inputs)requireThat(inputs.filter(input=>input.file===source.file&&Object.entries(MIME_SOURCE).every(([key,value])=>input[key]===value)).length===1,'MIME preferred archive absent from the release source inventory');
  const build=record.build;
  requireThat(build?.command==='node scripts/build-mime-parser.mjs --offline'&&build.esbuild==='0.25.9'&&build.format==='esm'&&build.platform==='browser'&&build.target==='chrome127'&&build.unrelatedCryptoCode===false&&stable(build.sourceClosure)===stable(MIME_CLOSURE),'MIME compiler command, format or literal source closure differs');
  requireThat(record.validation?.compile==='passed'&&record.validation.sourceModified===false&&stable(record.validation.licenses)===stable({package:'GPL-3.0',mimeSubtree:'MIT',unusedMailParserSource:'MPL-2.0'}),'MIME compilation/source/license classification is incomplete');
  const recipeFiles=['scripts/build-mime-parser.mjs','scripts/mime-parser-inputs/extract-source.py','scripts/source-archive.mjs'];
  requireThat(Array.isArray(build.inputs)&&build.inputs.length===recipeFiles.length&&recipeFiles.every(file=>build.inputs.filter(input=>input.file===file).length===1),'MIME complete editable recipe/helper inventory missing');
  for(const input of build.inputs)await pinned(root,'products/file-to-sharepoint/'+relative(input.file),input,'MIME build input '+input.file);
  const compilerSnapshots=[
   {file:'vendor/provenance/mime-compiler/package.json',bytes:1205,sha256:'4c218d78e81aff1bf7a64994487a6720082d7a7219e41b0549baaf76abded461'},
   {file:'vendor/provenance/mime-compiler/package-lock.json',bytes:21707,sha256:'afdb3d23f31193a3a998b609002b1feeafece9359e13d1071131cd2f5e44545a'}
  ];
  requireThat(Array.isArray(build.toolchainInputs)&&build.toolchainInputs.length===compilerSnapshots.length&&compilerSnapshots.every(expected=>build.toolchainInputs.filter(input=>input.file===expected.file&&sameOutput(input,expected)).length===1),'MIME historical compiler snapshot inventory/pins differ');
  const snapshots=[];
  for(const expected of compilerSnapshots)snapshots.push(JSON.parse(await pinned(root,'products/file-to-sharepoint/'+expected.file,expected,'MIME compiler snapshot '+expected.file)));
  const [snapshotPackage,snapshotLock]=snapshots,compiler=snapshotLock.packages?.['node_modules/esbuild'];
  requireThat(snapshotPackage.devDependencies?.esbuild===build.esbuild&&snapshotLock.packages?.['']?.devDependencies?.esbuild===build.esbuild&&compiler?.version===build.esbuild&&compiler.resolved===`https://registry.npmjs.org/esbuild/-/esbuild-${build.esbuild}.tgz`&&/^sha512-[A-Za-z0-9+/]{86}==$/.test(compiler.integrity??''),'MIME historical compiler dependency/lock differs');
  const pkg=await json(root,'package.json'),lock=await json(root,'package-lock.json');
  requireThat(pkg.devDependencies?.esbuild===build.esbuild&&lock.packages?.['']?.devDependencies?.esbuild===build.esbuild&&stable(lock.packages?.['node_modules/esbuild'])===stable(compiler),'MIME current compiler dependency/lock differs from its snapshot');
  const platformFiles=Object.keys(compiler.optionalDependencies).map(name=>'node_modules/'+name).sort();
  const platformInventory=packages=>Object.keys(packages??{}).filter(file=>file.startsWith('node_modules/@esbuild/')).sort();
  requireThat(stable(platformInventory(snapshotLock.packages))===stable(platformFiles),'MIME historical compiler platform inventory differs');
  requireThat(stable(platformInventory(lock.packages))===stable(platformFiles),'MIME current compiler platform inventory differs from its snapshot');
  for(const file of platformFiles){
   const expected=snapshotLock.packages[file],name=file.slice('node_modules/'.length),platform=name.slice('@esbuild/'.length);
   requireThat(compiler.optionalDependencies[name]===build.esbuild&&expected?.version===build.esbuild&&expected.resolved===`https://registry.npmjs.org/@esbuild/${platform}/-/${platform}-${build.esbuild}.tgz`&&/^sha512-[A-Za-z0-9+/]{86}==$/.test(expected.integrity??''),'MIME historical compiler platform dependency/lock differs: '+file);
   requireThat(stable(lock.packages[file])===stable(expected),'MIME current compiler platform dependency/lock differs from its snapshot: '+file);
  }
  requireThat(Array.isArray(record.outputs)&&record.outputs.length===1&&record.outputs[0].file==='mime-parser.js','MIME runtime output inventory differs');
  const output=record.outputs[0],runtimePins=manifest.files?.filter(pin=>pin.file===output.file);
  requireThat(runtimePins?.length===1&&runtimePins[0].generator==='mime-parser'&&sameOutput(runtimePins[0],output),'MIME runtime/build output association differs');
  await pinned(root,VENDOR+output.file,output,'MIME runtime');
  requireThat(Array.isArray(record.licenseFiles)&&record.licenseFiles.length===MIME_LICENSES.length,'MIME full license inventory missing');
  for(const license of MIME_LICENSES){
   const proof=record.licenseFiles.filter(pin=>pin.file===license.file),vendorPins=manifest.files.filter(pin=>pin.file===license.file);
   requireThat(proof.length===1&&vendorPins.length===1&&sameOutput(proof[0],license)&&sameOutput(vendorPins[0],license),'MIME full license text/pins differ: '+license.file);
   await pinned(root,VENDOR+license.file,license,'MIME full license '+license.file);
  }
  const notice=(await read(root,VENDOR+'NOTICE.md')).toString();
  requireThat(['@protontech/crypto 2.2.0','Joshua Cranmer','GPL-3.0','MIT','MPL-2.0','mailParser.js',...MIME_LICENSES.map(file=>file.file)].every(text=>notice.includes(text)),'MIME source attribution/license references incomplete');
  const result={status:'verified-runtime-source-bindings',reproduced:false,source,output,licenses:MIME_LICENSES,sourceClosure:MIME_CLOSURE};
  if(!verifyArchives)return result;
  sourceDirs??=process.env.C2S_SOURCE_DIR?.split(path.delimiter).filter(Boolean)??SOURCE_DIRS;
  requireThat(Array.isArray(sourceDirs)&&sourceDirs.length>0,'MIME explicit source archive directories required');
  const archive=await verifyArchive(source,sourceDirs.map(dir=>path.resolve(root,dir))),parent=workDirectory?path.resolve(workDirectory):path.join(root,'.artifacts/mime-source-validation');
  await mkdir(parent,{recursive:true});const work=await mkdtemp(path.join(parent,'rebuild-')),outputDir=path.join(work,'output');
  try{await execute(process.execPath,[path.join(root,'products/file-to-sharepoint/scripts/build-mime-parser.mjs'),'--offline','--source-dir',path.dirname(archive),'--cache-dir',path.join(work,'cache'),'--output-dir',outputDir],{cwd:root,windowsHide:true,maxBuffer:2*1024*1024,timeout:120000});}
  catch(error){fail('MIME source rebuild failed: '+(error.stderr||error.message));}
  const rebuilt=await readFile(path.join(outputDir,'mime-parser.js')),audit=JSON.parse(await readFile(path.join(outputDir,'mime-parser-build-result.json'),'utf8'));
  requireThat(rebuilt.length===output.bytes&&sha(rebuilt)===output.sha256,'MIME source reproduction output differs');
  requireThat(audit.schemaVersion===1&&audit.esbuild===build.esbuild&&audit.format===build.format&&audit.platform===build.platform&&audit.target===build.target&&stable(audit.sourceClosure)===stable(MIME_CLOSURE)&&stable(audit.outputs)===stable(record.outputs),'MIME source build output/closure audit differs');
  requireThat(stable(audit.sourceArchive)===stable({file:source.file,bytes:source.bytes,sha256:source.sha256})&&stable(audit.sourceMetadata)===stable({name:component.package,version:component.version,license:'GPL-3.0'}),'MIME actual source package identity differs');
  requireThat(audit.sourceAudit?.sourceOnly===true&&Number.isSafeInteger(audit.sourceAudit.regularFiles)&&audit.sourceAudit.regularFiles>7&&audit.sourceNotices?.mit?.sha256===MIME_LICENSES[1].sha256&&audit.sourceNotices.mit.bytes===MIME_LICENSES[1].bytes&&audit.sourceNotices.unusedMpl?.file==='package/src/jsmimeparser/mailParser.js'&&audit.sourceNotices.unusedMpl.noticePresent===true,'MIME source-only/license-member audit incomplete');
  return {...result,status:'verified-source-reproduction',reproduced:true,sourceMetadata:audit.sourceMetadata,sourceAudit:audit.sourceAudit,evidenceDirectory:work};
 }catch(error){if(error.message?.startsWith('Corresponding source: MIME'))throw error;fail('MIME '+error.message);}
}
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
 requireThat(drawingRecipeInputsComplete(drawing.build.inputs),'drawing editable build recipe missing or duplicated');
 for(const input of drawing.build.inputs)await pinned(root,'products/file-to-sharepoint/'+relative(input.file),input);
 requireThat(Array.isArray(drawing.localPreferredSourceMaterials)&&drawing.localPreferredSourceMaterials.length>=3,'drawing editable patches missing');
 for(const material of drawing.localPreferredSourceMaterials)await pinned(root,VENDOR+relative(material.path),material);
 const recipeFile=drawing.localPreferredSourceMaterials.find(material=>material.path.endsWith('/drawingfile-no-openssl.json'));
 requireThat(recipeFile,'drawing patched compiler recipe absent');
 const recipe=await json(root,VENDOR+recipeFile.path);
 requireThat(recipe.wasm===true&&recipe.asm===false&&Array.isArray(recipe.define)&&!recipe.define.includes('USE_OPENSSL_HASH')&&Array.isArray(recipe.include_path)&&recipe.include_path.every(file=>!file.includes('/openssl/')),'drawing compiler recipe includes incompatible OpenSSL path');
}

async function validateConverterBuild(root,inputs,manifest,pins,upstream){
 const file='converter-build-provenance.json';
 requireThat(manifest.converterSource.buildProvenanceFile===file&&manifest.provenanceFiles.includes(file),'converter local build proof missing');
 const record=await json(root,VENDOR+file);
 requireThat(record.status==='verified-local-source-build'&&record.source?.repository===upstream.repository&&record.source.commit===upstream.commit&&record.source.coreGitTree===upstream.coreGitTree,'converter local source-build association differs');
 requireThat(record.upstream?.provenanceFile==='converter-provenance.json'&&record.upstream.repository===upstream.repository&&record.upstream.commit===upstream.commit&&record.upstream.release===upstream.release.tag&&record.upstream.archiveSha256===upstream.release.archive.sha256,'converter upstream baseline association differs');
 requireThat(inputs.some(input=>input.file===record.source.archiveFile&&input.repository===upstream.repository&&input.commit===upstream.commit),'converter local source archive absent');
 requireThat(record.validation?.compile==='passed','converter local compilation is not verified');
 requireThat(record.build?.emscripten==='4.0.11'&&typeof record.build.command==='string'&&record.build.command.length>0&&/^sha256:[a-f0-9]{64}$/.test(record.build.baseImage?.digest??''),'converter pinned compiler/build environment missing');
 for(const [repository,commit] of [['https://github.com/emscripten-core/emsdk',record.build.emsdkCommit],['https://github.com/ONLYOFFICE/build_tools',record.build.buildToolsCommit]])requireThat(sourceContains(inputs,repository,commit),'converter compiler/build source association absent');
 requireThat(converterRecipeInputsComplete(record.build.inputs)&&['tests/engine.test.mjs','tests/fixtures/pdf-images.json'].every(file=>record.build.inputs.some(input=>input.file===file)),'converter editable recipe or image verification inputs missing or duplicated');
 for(const input of record.build.inputs)await pinned(root,'products/file-to-sharepoint/'+relative(input.file),input);
 requireThat(Array.isArray(record.outputs)&&record.outputs.length===2&&['x2t.js','x2t.wasm'].every(file=>record.outputs.some(output=>output.file===file)),'converter rebuilt JS/WASM pair missing');
 for(const output of record.outputs)requireThat(sameOutput(pins.get(output.file),output)&&pins.get(output.file).generator==='converter-runtime','converter rebuilt output pin differs');
 const regression=record.validation.pixelRegression;
 requireThat(regression?.passed===true&&typeof regression.evidenceFile==='string'&&Array.isArray(regression.cases),'converter image regression is not verified');
 const evidence=JSON.parse((await pinned(root,VENDOR+relative(regression.evidenceFile),{sha256:regression.evidenceSha256},'converter image regression evidence')).toString());
 requireThat(stable(evidence.cases)===stable(regression.cases),'converter image regression evidence differs');
 const references=await json(root,'products/file-to-sharepoint/tests/fixtures/pdf-images.json');
 const required=['image-opaque.pdf','image-large.pdf','image-alpha.pdf','image-jpeg.pdf','image-jpeg-subsampled.pdf','image-jpeg-progressive.pdf','image-jpeg-gray.pdf','image-jpeg-cmyk.pdf'];
 requireThat(Array.isArray(references)&&required.every(name=>references.filter(reference=>reference.name===name).length===1)&&regression.cases.length===references.length,'converter image fixture coverage differs');
 const browserProof=record.validation.browserReference;
 requireThat(browserProof?.file==='provenance/converter/browser-reference-pixels.json'&&browserProof.generator?.file==='tests/fixtures/reference-pixels.mjs','converter browser reference proof missing');
 for(const input of [{file:'vendor/'+browserProof.file,sha256:browserProof.sha256},browserProof.generator])requireThat(record.build.inputs.some(pin=>pin.file===input.file&&pin.sha256===input.sha256),'converter browser reference inputs not bound');
 await pinned(root,'products/file-to-sharepoint/'+browserProof.generator.file,browserProof.generator);
 const browserReferences=JSON.parse((await pinned(root,VENDOR+browserProof.file,browserProof,'converter browser reference')).toString());
 requireThat(browserReferences.schemaVersion===1&&typeof browserReferences.browserVersion==='string'&&browserReferences.method?.includes('independent reference PNG only')&&browserReferences.cases?.length===references.length,'converter browser reference method/coverage differs');
 for(const reference of references){
  const name=reference.name,matches=regression.cases.filter(item=>item.name===name),item=matches[0],source=item?.source;
  requireThat(matches.length===1&&item.passed===true&&Number.isSafeInteger(source?.width)&&source.width>0&&Number.isSafeInteger(source.height)&&source.height>0&&Array.isArray(item.candidates)&&item.candidates.some(candidate=>candidate.width===source.width&&candidate.height===source.height&&candidate.changedPixels===0&&candidate.maxChannelDifference===0&&/^[a-f0-9]{64}$/.test(source.rgbaSha256??'')&&candidate.rgbaSha256===source.rgbaSha256),`converter source image fidelity not verified: ${name}`);
  requireThat(source.width===reference.width&&source.height===reference.height&&typeof reference.original==='string'&&source.referencePngSha256===sha(Buffer.from(reference.original,'base64')),`converter image fixture/reference differs: ${name}`);
  const browserMatches=browserReferences.cases.filter(item=>item.name===name),browser=browserMatches[0];
  requireThat(browserMatches.length===1&&browser.referencePngSha256===source.referencePngSha256&&browser.rawRgbaSha256===reference.rgbaSha256&&browser.width===reference.width&&browser.height===reference.height&&/^[a-f0-9]{64}$/.test(browser.rgbaSha256??''),`converter reference pixel identity differs: ${name}`);
  // Canvas may round premultiplied alpha. Its reference is independently
  // decoded from the original PNG, never from candidate converter output.
  const expectedRgba=name==='image-alpha.pdf'?browser.rgbaSha256:reference.rgbaSha256;
  requireThat(source.rgbaSha256===expectedRgba&&browser.rgbaSha256===expectedRgba,`converter reference RGBA pixels differ: ${name}`);
  if(name==='image-large.pdf')requireThat(source.width>1200&&source.height>1200,'converter large-image regression does not cover the old resize cap');
 }
 await validateImageReferences(root,record,references);
 // Reproduction is reported separately from compilation; a cached recipe replay
 // must not be mislabeled as a fresh full-source rebuild.
 const reproduction=record.validation.reproduction;
 requireThat(reproduction&&['outputs-reproduced','not-performed'].includes(reproduction.status)&&typeof reproduction.method==='string'&&reproduction.method.length>0,'converter reproduction method/status missing');
 if(reproduction.status==='outputs-reproduced')requireThat(stable(reproduction.outputs)===stable(record.outputs),'converter reproduced outputs differ');
}

async function validateImageReferences(root,record,references){
 const policies=new Map([
  ...['image-opaque.pdf','image-large.pdf','image-alpha.pdf'].map(name=>[name,'original-source-png-rgba']),
  ...['image-jpeg.pdf','image-jpeg-progressive.pdf','image-jpeg-gray.pdf'].map(name=>[name,'original-dct-stream-pillow-rgba']),
  ['image-jpeg-subsampled.pdf','upstream-ijg8c-cli'],['image-jpeg-cmyk.pdf','upstream-pdf-pre-export-storage-boundary']
 ]);
 for(const reference of references)requireThat(reference.referencePolicy===policies.get(reference.name),`image reference policy/oracle differs: ${reference.name}`);
 const proof=record.validation.referenceProducer;
 requireThat(proof?.file==='provenance/converter/pixel-reference-provenance.json'&&record.build.inputs.some(input=>input.file==='vendor/'+proof.file&&input.sha256===proof.sha256),'converter reference producer proof missing');
 const producer=JSON.parse((await pinned(root,VENDOR+proof.file,proof,'converter reference producer')).toString());
 requireThat(producer.schemaVersion===1&&producer.sourceAssociation?.repository===record.source.repository&&producer.sourceAssociation.commit===record.source.commit&&producer.sourceAssociation.archiveFile===record.source.archiveFile,'converter reference producer source association differs');
 requireThat(/^[a-f0-9]{64}$/.test(producer.captureRuntime?.jsSha256??'')&&/^[a-f0-9]{64}$/.test(producer.captureRuntime?.wasmSha256??'')&&/^[a-f0-9]{64}$/.test(producer.djpegExecutableSha256??'')&&/^Independent JPEG Group 8c\b/.test(producer.djpeg?.version??''),'converter reference decoder/capture identity missing');
 requireThat(Array.isArray(producer.producerInputs)&&['capture-pixels.py','capture-reference.mjs','build-djpeg.py','freeze-references.py'].every(name=>producer.producerInputs.some(input=>input.file==='scripts/converter-runtime-inputs/'+name)),'converter reference producer recipes missing');
 for(const input of producer.producerInputs){requireThat(record.build.inputs.some(pin=>pin.file===input.file&&pin.sha256===input.sha256),'converter reference recipe is not bound to build proof');await pinned(root,'products/file-to-sharepoint/'+relative(input.file),input);}
 for(const reference of references){
  const matches=producer.cases?.filter(item=>item.name===reference.name),item=matches?.[0];
  requireThat(matches?.length===1&&item.pdfSha256===sha(Buffer.from(reference.pdf,'base64'))&&stable(item.sourceImage)===stable(reference.sourceImage)&&item.referencePngSha256===sha(Buffer.from(reference.original,'base64'))&&item.capture?.metadata?.width===reference.width&&item.capture.metadata.height===reference.height&&item.capture.rgbaSha256===reference.rgbaSha256,`converter reference original PDF/capture differs: ${reference.name}`);
  if(reference.referencePolicy==='original-source-png-rgba')requireThat(item.independentSourceCalibration?.dimensionsMatch===true&&item.independentSourceCalibration.changedPixels===0&&item.independentSourceCalibration.maxChannelDifference===0,'converter source PNG calibration differs');
  if(reference.name.startsWith('image-jpeg')&&reference.name!=='image-jpeg-cmyk.pdf')requireThat(item.independentIjgCli?.dimensionsMatch===true&&item.independentIjgCli.changedPixels===0&&item.independentIjgCli.maxChannelDifference===0&&reference.sourceImage.streamSha256===sha(Buffer.from(reference.compressedOriginal,'base64')),'converter original JPEG/independent decoder calibration differs');
  if(reference.name==='image-jpeg-cmyk.pdf')requireThat(reference.sourceImage.colorSpace==='/DeviceCMYK'&&stable(reference.sourceImage.decode)===stable([1,0,1,0,1,0,1,0]),'converter CMYK reference color-space policy differs');
  const baseline=item.unchangedExporterBaseline;
  if(reference.name==='image-large.pdf')requireThat(baseline?.dimensionsMatch===false&&baseline.width===1200,'converter unchanged-export resize failure control missing');
  else if(reference.name!=='image-alpha.pdf')requireThat(baseline?.dimensionsMatch===true&&baseline.changedPixels>0&&baseline.maxChannelDifference>0,'converter unchanged-export loss failure control missing');
 }
}

async function validateProvenance(root,inputs){
 const manifest=await json(root,VENDOR+'manifest.json'),pins=new Map();
 requireThat(Array.isArray(manifest.files)&&manifest.files.length>0,'missing vendor pins');
 for(const pin of manifest.files){relative(pin.file);requireThat(!pins.has(pin.file),`duplicate vendor pin: ${pin.file}`);pins.set(pin.file,pin);await pinned(root,VENDOR+pin.file,pin);}
 const converter=await json(root,VENDOR+RECORDS[0]);
 const localConverter=manifest.converterSource?.status==='verified-local-source-build';
 requireThat(converter.status==='verified-upstream-release'&&(localConverter||manifest.converterSource?.status===converter.status),'converter source is not verified');
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
 if(!localConverter)for(const output of converter.outputs){const pin=pins.get(output.file);requireThat(sameOutput(pin,output)&&pin.sourceArchiveSha256===archive.sha256&&pin.sourceArchiveSha512===archive.sha512&&pin.sourceArchiveMember===output.file,'converter output/source archive pin differs');}
 requireThat(Array.isArray(converter.buildMaterials)&&converter.buildMaterials.length>0,'converter build materials missing');
 for(const material of converter.buildMaterials)await pinned(root,VENDOR+relative(material.file),material);
 await pinned(root,VENDOR+'provenance/converter/'+relative(converter.workflow.file),{sha256:converter.workflow.sha256},'converter workflow');
 if(localConverter)await validateConverterBuild(root,inputs,manifest,pins,converter);

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
 const assets=await json(root,VENDOR+'manifest.json');
 if(assets.pdfRuntimeSource?.status==='verified-local-source-build'){
  const reviewed=native.drawingRuntimeVerification;
  requireThat(reviewed?.status==='verified-local-source-build'&&reviewed.provenanceFile===assets.pdfRuntimeSource.drawingBuildProvenanceFile&&reviewed.sourceCommit===assets.pdfRuntimeSource.coreCommit&&reviewed.outputs?.length===2,'native drawing runtime review association differs');
  for(const name of ['drawingfile.js','drawingfile.wasm']){
   const matches=reviewed.outputs.filter(output=>output.file===name),pin=assets.files.find(file=>file.file===name);
   requireThat(matches.length===1&&sameOutput(pin,matches[0]),`native drawing runtime binary review differs: ${name}`);
  }
  if(native.historicalReleaseFinding?.currentDrawingWasmSha256!==undefined)requireThat(native.historicalReleaseFinding.currentDrawingWasmSha256===assets.files.find(file=>file.file==='drawingfile.wasm')?.sha256,'native drawing current runtime pointer differs');
 }
 if(assets.converterSource?.status==='verified-local-source-build')for(const name of ['x2t.js','x2t.wasm']){
  const reviewed=native.runtimeImportEvidence?.artifacts?.filter(artifact=>artifact.file===name),pin=assets.files.find(file=>file.file===name);
  requireThat(reviewed?.length===1&&sameOutput(pin,reviewed[0]),`native runtime binary review differs: ${name}`);
 }
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
  if(hash.digest('hex')!==input.sha256||(input.sha512&&digest512.toString('hex')!==input.sha512)||(input.integrity&&'sha512-'+digest512.toString('base64')!==input.integrity)){mismatch='hash';continue;}return file;
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
 const mimeSource=await validateMimeSource({root,inputs,sourceDirs,verifyArchives});
 await validateProvenance(root,inputs);await validateLegal(root,inputs);
 if(verifyArchives){sourceDirs??=process.env.C2S_SOURCE_DIR?.split(path.delimiter).filter(Boolean)??SOURCE_DIRS;requireThat(Array.isArray(sourceDirs)&&sourceDirs.length>0,'explicit source archive directories required');const dirs=sourceDirs.map(dir=>path.resolve(root,dir));for(const input of inputs)await verifyArchive(mapping.get(input.file)??input,dirs);await execute(process.env.PYTHON??(process.platform==='win32'?'python':'python3'),[path.join(root,delivery.generator.file),'--verify',path.join(root,DELIVERY),...dirs.flatMap(dir=>['--source-dir',dir])],{maxBuffer:1024*1024,windowsHide:true});}
 return {manifest,inputs,delivery,mimeSource,archiveCount:inputs.length,archiveBytes:bytes,deliveryArchiveBytes:inputs.reduce((sum,input)=>sum+(mapping.get(input.file)?.bytes??input.bytes),0)};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),sourceDirs=[];requireThat(args.shift()==='--check','usage: source-release.mjs --check [--source-dir DIR]...');
 while(args.length){requireThat(args.shift()==='--source-dir'&&args.length>0,'usage: source-release.mjs --check [--source-dir DIR]...');sourceDirs.push(args.shift());}
 const result=await validateSourceRelease({sourceDirs:sourceDirs.length?sourceDirs:undefined});console.log(`Verified corresponding source: ${result.archiveCount} acquisition pins, ${result.delivery.archives.length} source-only substitutions (${result.deliveryArchiveBytes} delivered bytes).`);
}
