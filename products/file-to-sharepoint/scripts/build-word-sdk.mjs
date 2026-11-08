// Regenerate release SDK bundles from verified source and a complete dependency
// shrinkwrap. This is a build-time tool; the installed extension stays offline.
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {preferredSourceArchive,sourceDirectories} from './source-archive.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../',import.meta.url));
const vendor = new URL('../vendor/',import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function buildWordSdk({cacheDirectory = path.join(root,'.artifacts','file-import-source-build')} = {}) {
  const record = JSON.parse(await readFile(new URL('sdk-build-provenance.json',vendor),'utf8'));
  for (const input of record.build.inputs) {
    const file = new URL('../'+input.file,import.meta.url);
    if (digest(await readFile(file)) !== input.sha256) throw new Error(`SDK build input mismatch: ${input.file}`);
  }
  await mkdir(cacheDirectory,{recursive:true});
  const preferred=await preferredSourceArchive({file:record.source.archiveFile,bytes:record.source.archiveBytes,sha256:record.source.archiveSha256},{directories:sourceDirectories(cacheDirectory)});
  const archive = preferred?.file??path.join(cacheDirectory,record.source.archiveFile);
  let bytes;
  try {bytes = await readFile(archive);} catch { /* Download exact immutable source below. */ }
  const archiveHash=preferred?.pin.sha256??record.source.archiveSha256;
  if (!bytes || digest(bytes) !== archiveHash) {
    const response = await fetch(record.source.archiveUrl,{signal:AbortSignal.timeout(120000)});
    if (!response.ok) throw new Error(`SDK source download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== record.source.archiveSha256) throw new Error('SDK source archive hash mismatch.');
    await writeFile(archive,bytes);
  }
  const parent = await mkdtemp(path.join(cacheDirectory,'sdk-build-'));
  const buildRoot = path.join(parent,'source');
  const recipe = fileURLToPath(new URL('./word-sdk-inputs/rebuild-sdk.ps1',import.meta.url));
  const result = await execute(process.platform === 'win32' ? 'pwsh.exe' : 'pwsh', ['-NoProfile','-File',recipe,'-SourceArchive',archive,'-SourceSha256',archiveHash,'-BuildRoot',buildRoot],{maxBuffer:20*1024*1024,windowsHide:true});
  await writeFile(path.join(parent,'build.log'),result.stdout + result.stderr);
  const outputs = new Map();
  for (const expected of record.outputs) {
    const name = path.basename(expected.file);
    const output = await readFile(path.join(buildRoot,'deploy','sdkjs','word',name));
    if (output.length !== expected.bytes || digest(output) !== expected.sha256) throw new Error(`Source-built SDK output mismatch: ${name}`);
    outputs.set(expected.file,output);
  }
  return outputs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputs = await buildWordSdk();
  for (const [file,bytes] of outputs) console.log(`${file}: ${bytes.length} bytes, SHA256 ${digest(bytes)}`);
}
