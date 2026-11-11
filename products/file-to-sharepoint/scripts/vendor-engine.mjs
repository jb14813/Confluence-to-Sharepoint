// Build-time acquisition only. Runtime files are already packaged and offline.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import JSZip from 'jszip';

const vendor = new URL('../vendor/',import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json',vendor),'utf8'));
const download = process.argv.slice(2).includes('--fetch');
const archives = new Map();
let wordOutputs;
let drawingOutputs;
let converterOutputs;
let mimeOutputs;
if (process.argv.slice(2).some(arg => arg !== '--fetch')) throw new Error('Usage: node vendor-engine.mjs [--fetch]');
for (const file of manifest.files) {
  if (!/^[\w.@/-]+$/.test(file.file) || file.file.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Invalid vendor manifest filename.');
  const destination = new URL(file.file,vendor);
  let bytes;
  if (download && file.generator === 'mime-parser') {
    if (!mimeOutputs) mimeOutputs = (await import('./build-mime-parser.mjs')).buildMimeParser();
    bytes = (await mimeOutputs).get(file.file);
    if (!bytes) throw new Error(`Missing source-built MIME output: ${file.file}`);
  } else if (download && file.generator === 'converter-runtime') {
    if (!converterOutputs) converterOutputs = (await import('./build-converter-runtime.mjs')).buildConverterRuntime();
    bytes = (await converterOutputs).get(file.file);
    if (!bytes) throw new Error(`Missing source-built converter output: ${file.file}`);
  } else if (download && file.generator === 'drawing-runtime') {
    if (!drawingOutputs) drawingOutputs = (await import('./build-drawing-runtime.mjs')).buildDrawingRuntime();
    bytes = (await drawingOutputs).get(file.file);
    if (!bytes) throw new Error(`Missing source-built drawing output: ${file.file}`);
  } else if (download && file.generator === 'word-sdk') {
    if (!wordOutputs) wordOutputs = (await import('./build-word-sdk.mjs')).buildWordSdk();
    bytes = (await wordOutputs).get(file.file);
    if (!bytes) throw new Error(`Missing source-built SDK output: ${file.file}`);
  } else if (download && file.generator === 'xmldom') {
    const require = createRequire(new URL('../package.json',import.meta.url));
    const {build} = await import('esbuild');
    const result = await build({absWorkingDir:fileURLToPath(new URL('..',import.meta.url)),entryPoints:[require.resolve('@xmldom/xmldom')],bundle:true,format:'iife',globalName:'EngineXml',platform:'browser',target:'chrome120',legalComments:'eof',write:false});
    bytes = Buffer.from(result.outputFiles[0].contents);
  } else if (download) {
    if (file.sourceArchiveMember) {
      if (!archives.has(file.sourceUrl)) archives.set(file.sourceUrl,(async()=>{
        const response = await fetch(file.sourceUrl,{headers:{Accept:'application/octet-stream'},signal:AbortSignal.timeout(60000)});
        if (!response.ok) throw new Error(`Could not acquire converter archive: HTTP ${response.status}`);
        const archive = Buffer.from(await response.arrayBuffer());
        if (createHash('sha256').update(archive).digest('hex') !== file.sourceArchiveSha256 || createHash('sha512').update(archive).digest('hex') !== file.sourceArchiveSha512) throw new Error('Official converter archive checksum mismatch.');
        return JSZip.loadAsync(archive,{checkCRC32:true});
      })());
      const archive = await archives.get(file.sourceUrl);
      const entry = archive.file(file.sourceArchiveMember);
      if (!entry) throw new Error(`Missing converter archive member: ${file.sourceArchiveMember}`);
      bytes = await entry.async('nodebuffer');
    } else {
      const response = await fetch(file.sourceUrl,{signal:AbortSignal.timeout(60000)});
      if (!response.ok) throw new Error(`Could not acquire ${file.file}: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (file.sourceEncoding === 'brotli') bytes = brotliDecompressSync(bytes);
  } else bytes = await readFile(destination);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== file.sha256 || bytes.length !== file.bytes) throw new Error(`Pinned vendor verification failed: ${file.file}`);
  if (download) {await mkdir(new URL('.',destination),{recursive:true});await writeFile(destination,bytes);}
}
console.log(`Verified ${manifest.files.length} pinned engine assets and notices${download ? ' from recorded sources' : ' offline'}.`);
