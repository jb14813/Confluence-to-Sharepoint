import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('pinned engine assets match hashes and the offline acquisition verifier',async()=>{
 const base=new URL('../vendor/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
 assert.equal(manifest.assetMirror.commit,'d1c9b03263aabe14789297f5c717fefff2fe4f0d');
 assert.equal(manifest.editorSource.release,'v9.3.0.133');
 assert.equal(manifest.pdfRuntimeSource.status,'verified-local-source-build');
 const drawing=JSON.parse(await readFile(new URL('drawing-build-provenance.json',base),'utf8'));
 assert.equal(drawing.status,'verified-local-source-build');
 assert.equal(drawing.validation.opensslImplementationInputs,false);
 assert.equal(drawing.build.existingHashBranch,'PdfFile/lib/xpdf/Decrypt.cc: SHA384=sha384; SHA512=sha512');
 for(const file of drawing.outputs){assert.equal(createHash('sha256').update(await readFile(new URL(file.file,base))).digest('hex'),file.sha256);}
 assert.equal(manifest.converterSource.status,'verified-upstream-release');
 assert.equal(manifest.converterSource.commit,'7debf5e6d6d4f19874d764cd34446f7e63c6bc32');
 const provenance=JSON.parse(await readFile(new URL('converter-provenance.json',base),'utf8'));
 assert.equal(provenance.workflow.headSha,manifest.converterSource.commit);
 assert.equal(provenance.workflow.conclusion,'success');
 assert.equal(provenance.workflow.runId,36864484234);
 assert.equal(provenance.release.archive.sha256,'9fee31b60964d8145396bf1fb992f38ea3bf099a1c64e949fa4976c5c4fdd290');
 for(const file of provenance.outputs){assert.equal(createHash('sha256').update(await readFile(new URL(file.file,base))).digest('hex'),file.sha256);}
 assert.equal(provenance.reproducibility.localBuildPerformed,false);
 const sdk=JSON.parse(await readFile(new URL('sdk-build-provenance.json',base),'utf8'));
 assert.equal(sdk.status,'verified-local-source-build');
 assert.match(sdk.build.command,/--level=SIMPLE/);
 for(const file of sdk.outputs){assert.equal(createHash('sha256').update(await readFile(new URL(file.file,base))).digest('hex'),file.sha256);}
 for(const file of sdk.build.inputs){assert.equal(createHash('sha256').update(await readFile(new URL('../'+file.file,base))).digest('hex'),file.sha256);}
 const runtime=JSON.parse(await readFile(new URL('sdk-runtime-provenance.json',base),'utf8'));
 assert.equal(runtime.publisherRelease.gitlinks.core,'d54f0326cd67ef0d59b87af1c3ff51d678f77a39');
 assert.equal(runtime.publisherRelease.gitlinks.sdkjs,manifest.pdfRuntimeSource.sdkjsCommit);
 for(const component of runtime.components)for(const file of component.files){const vendorFile=component.name==='drawingfile'?file.file:'office/sdkjs/'+file.sourcePath;assert.equal(createHash('sha256').update(await readFile(new URL(vendorFile,base))).digest('hex'),file.sha256);}
 const catalog=await readFile(new URL('office/sdkjs/common/AllFonts.js',base));
 assert.deepEqual(catalog,await readFile(new URL('provenance/sdk/catalog-source/AllFonts.js',base)));
 for(const file of manifest.files){const bytes=await readFile(new URL(file.file,base));assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256)}
 const output=execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/vendor-engine.mjs',import.meta.url))],{encoding:'utf8'});assert.match(output,/Verified/);
});
