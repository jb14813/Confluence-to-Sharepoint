// Source-only build tool. The installed extension contains only the local ESM.
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify,isDeepStrictEqual} from 'node:util';
import {build,version as esbuildVersion} from 'esbuild';
import {availableSourceArchive,sourceDirectories} from './source-archive.mjs';

const execute=promisify(execFile),root=fileURLToPath(new URL('../../../',import.meta.url)),vendor=new URL('../vendor/',import.meta.url);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const expectedClosure=['entry.js','package/src/utils.ts',...['utils','textDecoders','structuredHeaders','headerParser','rawMimeParser'].map(name=>`package/src/jsmimeparser/${name}.js`)].sort();
// Preserve the actual compiler declarations used for the recorded build. The
// public root package files may omit unrelated maintainer scripts/test tools.
const compilerSnapshots=[
  {file:'vendor/provenance/mime-compiler/package.json',bytes:1205,sha256:'4c218d78e81aff1bf7a64994487a6720082d7a7219e41b0549baaf76abded461'},
  {file:'vendor/provenance/mime-compiler/package-lock.json',bytes:21707,sha256:'afdb3d23f31193a3a998b609002b1feeafece9359e13d1071131cd2f5e44545a'}
];

export async function compileMimeParser({archive,pin,workDirectory}){
  const source=await readFile(archive);
  if(source.length!==pin.bytes||digest(source)!==pin.sha256||pin.integrity&&'sha512-'+createHash('sha512').update(source).digest('base64')!==pin.integrity)throw Error('MIME source archive identity mismatch.');
  await mkdir(workDirectory,{recursive:true});
  const stage=await mkdtemp(path.join(path.resolve(workDirectory),'mime-source-'));
  await execute(process.platform==='win32'?'python':'python3',[fileURLToPath(new URL('./mime-parser-inputs/extract-source.py',import.meta.url)),archive,stage],{windowsHide:true});
  await writeFile(path.join(stage,'entry.js'),"export {default as MimeParser} from './package/src/jsmimeparser/rawMimeParser.js';\n");
  const result=await build({absWorkingDir:stage,entryPoints:['entry.js'],bundle:true,format:'esm',platform:'browser',target:'chrome127',legalComments:'eof',metafile:true,write:false});
  const inputs=Object.keys(result.metafile.inputs).sort();
  if(JSON.stringify(inputs)!==JSON.stringify(expectedClosure)||result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].imports.length)throw Error('Unrelated code entered the MIME source build.');
  const output=result.metafile.outputs[Object.keys(result.metafile.outputs)[0]];
  if(JSON.stringify(output.exports)!==JSON.stringify(['MimeParser']))throw Error('Unexpected MIME parser exports.');
  return {bytes:Buffer.from(result.outputFiles[0].contents),inputs,stage,audit:JSON.parse(await readFile(path.join(stage,'source-audit.json'),'utf8'))};
}

export async function buildMimeParser({cacheDirectory=path.join(root,'.artifacts/file-import-source-build'),sourceDirs,offline=false,evidenceFile}={}){
  const record=JSON.parse(await readFile(new URL('mime-parser-build-provenance.json',vendor),'utf8'));
  if(record.build.esbuild!=='0.25.9'||record.build.esbuild!==esbuildVersion||record.build.inputs.length!==3||!Array.isArray(record.build.toolchainInputs)||record.build.toolchainInputs.length!==compilerSnapshots.length)throw Error('MIME compiler/build input inventory differs.');
  for(const input of record.build.inputs){const bytes=await readFile(new URL('../'+input.file,import.meta.url));if(bytes.length!==input.bytes||digest(bytes)!==input.sha256)throw Error('MIME build input mismatch: '+input.file);}
  const snapshots=[];
  for(const expected of compilerSnapshots){
    const pins=record.build.toolchainInputs.filter(input=>input.file===expected.file);
    if(pins.length!==1||pins[0].bytes!==expected.bytes||pins[0].sha256!==expected.sha256)throw Error('MIME compiler snapshot pin differs: '+expected.file);
    const bytes=await readFile(new URL('../'+expected.file,import.meta.url));
    if(bytes.length!==expected.bytes||digest(bytes)!==expected.sha256)throw Error('MIME compiler snapshot mismatch: '+expected.file);
    snapshots.push(JSON.parse(bytes));
  }
  const [snapshotPackage,snapshotLock]=snapshots,compiler=snapshotLock.packages?.['node_modules/esbuild'];
  if(snapshotPackage.devDependencies?.esbuild!==record.build.esbuild||snapshotLock.packages?.['']?.devDependencies?.esbuild!==record.build.esbuild||compiler?.version!==record.build.esbuild||compiler.resolved!==`https://registry.npmjs.org/esbuild/-/esbuild-${record.build.esbuild}.tgz`||!/^sha512-[A-Za-z0-9+/]{86}==$/.test(compiler.integrity??''))throw Error('MIME historical compiler declaration differs.');
  const pkg=JSON.parse(await readFile(path.join(root,'package.json'))),lock=JSON.parse(await readFile(path.join(root,'package-lock.json')));
  if(pkg.devDependencies?.esbuild!==record.build.esbuild||lock.packages?.['']?.devDependencies?.esbuild!==record.build.esbuild||!isDeepStrictEqual(lock.packages?.['node_modules/esbuild'],compiler))throw Error('MIME current compiler dependency/lock differs from its snapshot.');
  const platformFiles=Object.keys(compiler.optionalDependencies).map(name=>'node_modules/'+name).sort();
  const platformInventory=packages=>Object.keys(packages??{}).filter(file=>file.startsWith('node_modules/@esbuild/')).sort();
  if(!isDeepStrictEqual(platformInventory(snapshotLock.packages),platformFiles))throw Error('MIME historical compiler platform inventory differs.');
  if(!isDeepStrictEqual(platformInventory(lock.packages),platformFiles))throw Error('MIME current compiler platform inventory differs from its snapshot.');
  for(const file of platformFiles){
    const expected=snapshotLock.packages[file],name=file.slice('node_modules/'.length),platform=name.slice('@esbuild/'.length);
    if(compiler.optionalDependencies[name]!==record.build.esbuild||expected?.version!==record.build.esbuild||expected.resolved!==`https://registry.npmjs.org/@esbuild/${platform}/-/${platform}-${record.build.esbuild}.tgz`||!/^sha512-[A-Za-z0-9+/]{86}==$/.test(expected.integrity??''))throw Error('MIME historical compiler platform dependency/lock differs: '+file);
    if(!isDeepStrictEqual(lock.packages[file],expected))throw Error('MIME current compiler platform dependency/lock differs from its snapshot: '+file);
  }
  await mkdir(cacheDirectory,{recursive:true});
  const pin=record.preferredSourceInputs[0],available=await availableSourceArchive(pin,{directories:sourceDirs??sourceDirectories(cacheDirectory)});
  let archive=available?.file;
  if(!archive){
    if(offline)throw Error('The pinned MIME source archive is unavailable offline.');
    const response=await fetch(pin.url,{signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error('MIME source acquisition failed: HTTP '+response.status);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length!==pin.bytes||digest(bytes)!==pin.sha256)throw Error('MIME source acquisition identity mismatch.');
    archive=path.join(cacheDirectory,pin.file);await writeFile(archive,bytes);
  }
  const result=await compileMimeParser({archive,pin,workDirectory:cacheDirectory}),expected=record.outputs[0];
  if(expected.file!=='mime-parser.js'||expected.bytes!==result.bytes.length||expected.sha256!==digest(result.bytes))throw Error('Source-built MIME output differs from its pin.');
  if(evidenceFile){
    const metadata=JSON.parse(await readFile(path.join(result.stage,'package/package.json'),'utf8'));
    const notice=await readFile(path.join(result.stage,'package/src/jsmimeparser/LICENSE')),mpl=await readFile(path.join(result.stage,'package/src/jsmimeparser/mailParser.js'));
    await writeFile(evidenceFile,JSON.stringify({schemaVersion:1,esbuild:esbuildVersion,format:'esm',platform:'browser',target:'chrome127',sourceArchive:{file:pin.file,bytes:pin.bytes,sha256:pin.sha256},sourceMetadata:{name:metadata.name,version:metadata.version,license:metadata.license},sourceClosure:result.inputs,sourceAudit:result.audit,sourceNotices:{mit:{bytes:notice.length,sha256:digest(notice)},unusedMpl:{file:'package/src/jsmimeparser/mailParser.js',bytes:mpl.length,sha256:digest(mpl),noticePresent:/This Source Code Form is subject to the terms of the Mozilla Public[\s\S]*?License, v\. 2\.0/.test(mpl.toString())}},outputs:[{file:'mime-parser.js',bytes:result.bytes.length,sha256:digest(result.bytes)}]},null,2)+'\n');
  }
  return new Map([['mime-parser.js',result.bytes]]);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),options={sourceDirs:[]};let outputDirectory;
  while(args.length){const option=args.shift();if(option==='--offline'){options.offline=true;continue;}if(!['--source-dir','--cache-dir','--output-dir'].includes(option)||!args.length)throw Error('Usage: build-mime-parser.mjs [--offline] [--source-dir DIR]... [--cache-dir DIR] [--output-dir DIR]');const value=path.resolve(args.shift());if(option==='--source-dir')options.sourceDirs.push(value);if(option==='--cache-dir')options.cacheDirectory=value;if(option==='--output-dir')outputDirectory=value;}
  if(!options.sourceDirs.length)delete options.sourceDirs;
  if(outputDirectory){await mkdir(outputDirectory,{recursive:true});options.evidenceFile=path.join(outputDirectory,'mime-parser-build-result.json');}
  for(const[file,bytes]of await buildMimeParser(options)){if(outputDirectory)await writeFile(path.join(outputDirectory,file),bytes);console.log(`${file}: ${bytes.length} bytes, SHA256 ${digest(bytes)}`);}
}
