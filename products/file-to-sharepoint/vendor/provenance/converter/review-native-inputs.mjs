// Development review only: inspect WASM metadata without instantiating it.
// Generated Makefiles are the actual compiler/link inputs exported by the build.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [runtime, evidence, output] = process.argv.slice(2);
if (!runtime || !evidence || !output) throw Error('Usage: review-native-inputs.mjs runtime-directory build-evidence-directory output.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const requireThat = (value, message) => { if (!value) throw Error(message); };
const outputs = [];
for (const file of ['x2t.js', 'x2t.wasm']) {
  const bytes = await readFile(path.join(runtime, file));
  outputs.push({ file, bytes: bytes.length, sha256: sha(bytes) });
}
const javascript = (await readFile(path.join(runtime, 'x2t.js'))).toString('utf8');
const wasm = await readFile(path.join(runtime, 'x2t.wasm'));
const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm));
const functions = new Map();
for (const match of javascript.matchAll(/function ([$\w]+)\(\)\{abort\("missing function: ([^"]+)"\)\}\1\.stub=true/g)) functions.set(match[1], match[2]);
const table = /var wasmImports=\{([^}]+)\}/.exec(javascript);
requireThat(table, 'Cannot identify the generated WASM import table');
const bindings = new Map();
for (const pair of table[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',')) {
  const match = /^([$\w]+):([$\w]+)$/.exec(pair.trim());
  requireThat(match, 'Unsupported import-table expression');
  bindings.set(match[1], match[2]);
}
const abortImports = imports.filter(item => item.kind === 'function' && functions.has(bindings.get(item.name)))
  .map(item => ({ module: item.module, name: item.name, function: bindings.get(item.name), missingSymbol: functions.get(bindings.get(item.name)) }));
const crypto = /^(?:ASN1_|BIO_|BN_|CRYPTO_|ERR_|EVP_|HMAC_|OBJ_|OPENSSL_|OSSL_|PEM_|PKCS|RAND_|RSA_|SHA\d|SSL_|X509_|sk_|d2i_|i2d_)/;
const cryptoCount = abortImports.filter(item => crypto.test(item.missingSymbol)).length;
const heifCount = abortImports.filter(item => item.missingSymbol.startsWith('heif_')).length;
// The maintained Emscripten image profile disables the unsupported HEIF branch
// in ximacfg.h. Its former18 missing-function stubs are absent; the71 crypto
// abort imports and all remaining imports must retain their reviewed counts.
requireThat(imports.length === 155 && abortImports.length === 96 && cryptoCount === 71 && heifCount === 0, 'Native crypto/HEIF import set changed; review the new implementation/link inputs');
requireThat(!wasm.includes(Buffer.from('/capture-pixels')) && !wasm.includes(Buffer.from('captured-image-')), 'Test-only capture code appears in the production candidate');

const makefiles = [];
for (const file of ['x2t.Makefile', 'pdffile.Makefile', 'ooxmlsignature.Makefile', 'graphics.Makefile', 'docxrenderer.Makefile']) {
  const bytes = await readFile(path.join(evidence, file));
  const text = bytes.toString('utf8'), values = {};
  for (const line of text.replace(/\\\r?\n/g, ' ').split(/\r?\n/)) {
    const match = /^([\w.]+)\s*([+?]?=)\s*(.*)$/.exec(line);
    if (match) values[match[1]] = match[2] === '+=' ? `${values[match[1]] || ''} ${match[3]}` : match[3];
  }
  const sources = (values.SOURCES || '').split(/\s+/).filter(Boolean);
  const definitions = (values.DEFINES || '').split(/\s+/).filter(Boolean);
  requireThat(values.CXX === 'em++', `Unexpected native compiler: ${file}`);
  requireThat(!sources.some(source => /\/openssl\/openssl\/|\/gpc(?:[._]|\/)|\/agg-2\.4\/examples\//i.test(source)), `Excluded implementation source selected: ${file}`);
  requireThat(!definitions.includes('-DUSE_OPENSSL_HASH'), `Old OpenSSL PDF hash branch enabled: ${file}`);
  makefiles.push({ file: `provenance/converter/local-build/${file}`, bytes: bytes.length, sha256: sha(bytes),
    target: values.TARGET, compiler: values.CXX, linker: values.LINK || null, archiver: values.AR,
    definitions, sourceCount: sources.length,
    opensslWrapperSources: sources.filter(source => source.includes('/openssl/common/')),
    jpegSourceCount: sources.filter(source => source.includes('/cximage/jpeg/')).length,
    imageManagerSources: sources.filter(source => source.includes('ImageManager')),
    linkFlags: values.LFLAGS || null, linkLibraries: values.LIBS || null,
    linkOrArchiveCommands: text.split(/\r?\n/).filter(line => line.includes('$(AR)') || line.includes('$(LINK)')).map(line => line.trim()) });
}
const target = makefiles.find(file => file.file.endsWith('/x2t.Makefile'));
requireThat(target.linker === 'em++', 'Final converter is not linked by Emscripten');
requireThat(!/(?:-l(?:ssl|crypto|curl|vlc|heif|x265|de265)(?:\s|$)|lib(?:ssl|crypto)\.a)/i.test(`${target.linkFlags} ${target.linkLibraries}`), 'Unexpected platform/crypto implementation library in final link');
requireThat(makefiles.find(file => file.file.endsWith('/pdffile.Makefile')).definitions.includes('-DHAVE_JPEGLIB=1'), 'Reviewed existing IJG decoder branch not selected');
for (const file of makefiles.filter(file => !file.file.endsWith('/x2t.Makefile'))) requireThat(file.linkOrArchiveCommands.length === 1 && file.linkOrArchiveCommands[0] === '$(AR) $(DESTDIR)$(TARGET) $(OBJECTS)', `Static archive embeds additional libraries: ${file.file}`);
const report = { schemaVersion: 1, method: 'Actual staged JS abort bodies/import table correlated to actual WASM imports, plus actual generated compiler/link Makefiles; no WASM instantiation.',
  outputs, wasmImportCount: imports.length, abortImportCount: abortImports.length, cryptoAbortImportCount: cryptoCount, heifAbortImportCount: heifCount,
  abortImports, generatedMakefiles: makefiles,
  checks: { noOpenSSLImplementationTranslationUnitsInReviewedMakefiles: true, noOpenSSLHashDefine: true,
    noOpenSSLOrHEIFImplementationLibrariesInFinalLink: true, noGpcOrAggExamplesSelected: true,
    signatureAndGraphicsArchivesContainObjectInputsOnly: true, existingIjgDecoderSelected: true, noTestOnlyCaptureMarkerInProductionWasm: true },
  limits: 'The reviewed Makefiles retain ONLYOFFICE API wrapper/header dependencies. Abort-import evidence is not a claim that all repository OpenSSL headers or host tools are absent. Full fresh-source reproduction is recorded separately by converter-build-provenance.json.' };
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ outputs, imports: imports.length, abortImports: abortImports.length, cryptoCount, heifCount, makefiles: makefiles.length, checks: report.checks }, null, 2));
