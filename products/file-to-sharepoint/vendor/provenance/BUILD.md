# Engine source and build materials

These records distinguish official release/source association from a local rebuild. All executable conversion remains inside the installed Chrome extension; these commands run only during development/release acquisition.

From the repository root:

```
node products/file-to-sharepoint/scripts/vendor-engine.mjs
node products/file-to-sharepoint/scripts/vendor-engine.mjs --fetch
node products/file-to-sharepoint/scripts/collect-engine-source.mjs --output SOURCE_DIRECTORY
```

--fetch fetches exact pinned upstream files and builds the converter, drawing runtime and two Word bundles. Word rebuilding requires PowerShell 7, tar, Node/npm and access to the pinned source/npm registry. The recorded Windows/Node/compiler environment produced the distributed hashes; other environments must still pass exact hash checks. The complete npm shrinkwrap includes transitive package integrity values. build-word-sdk.mjs uses a fresh build directory, verified source tarball, fixed environment values and upstream Grunt SIMPLE compilation. It refuses mismatching outputs. SDK source and Grunt logic are unchanged. ADVANCED changes private SDK names and is incompatible with this integration.

collect-engine-source.mjs streams/verifies all source archives listed by the manifest provenance files. Optional --reuse-dir CACHE reuses verified archives. It emits corresponding-source-manifest.json; no source bytes are fetched by the installed extension. Include the verified delivery archives (using all four source-only substitutions) plus application source, licenses, lockfiles, these provenance records and build recipes in the release corresponding-source bundle. Publish the source bytes, not merely links.

For the upstream x2t baseline, converter-provenance.json ties exact official archive members to the successful maintainer GitHub Actions release and tagged source. It remains unchanged evidence of that baseline. converter-build-provenance.json records this project's separate lossless-image build and measured output pins. The source archive contains vendored core; source dependencies, Emscripten runtime/ports and compiler distributions are separately pinned. The local build status and reproduction.method report actual verification, including whether objects were reused; do not infer historical byte reproducibility from the upstream version label.

Build the current converter with Node and a Linux/WSL environment containing Docker plus buildx, Python 3.12+, and a running task-selected Docker daemon:

```
node products/file-to-sharepoint/scripts/build-converter-runtime.mjs --offline
```

Supply all recorded archives through C2S_SOURCE_DIR and the preferred source-only archives through C2S_SOURCE_DELIVERY_DIR (platform path delimiter separates directories). Without --offline, missing pinned archives may be acquired and hash-checked. General Ubuntu build packages and Emscripten's pinned port recipes may use network or an existing Docker build cache; --offline forbids missing recorded archive acquisition, not Docker base/APT acquisition. The pinned Ubuntu base digest, actual host package inventory, compiler hashes and generated Makefiles are retained as build evidence. Docker requires roughly 15GiB RAM, several GiB of disk/cache and minutes of native compilation. The recipe uses four jobs. It does not change host Docker configuration or start a daemon. Set C2S_WSL_DISTRO for a nondefault WSL distribution; use a configured Docker context/DOCKER_HOST for the desired daemon. Preserved task build directories are printed so failed builds can be inspected. The installed extension does not need Docker, WSL, Node or any helper.

Editable modifications are under ../scripts/converter-runtime-inputs: patch-images.py changes only export policy in both ImageManager paths; patch-jpeg-decoder.py selects existing HAVE_JPEGLIB and scopes the pre-existing INT32 typedef collision. The new PNG export retains the full decoded dimensions and alpha. Decoding already allocated the full raster before the old 1200-pixel resize; removing that resize increases encoder/output memory. Existing source-size, expanded-Office-container, isolated-worker time/abort limits remain, and real large-image cancellation/recovery is tested. No image is silently resampled to satisfy a new cap.

The complete current converter recipe inventory is shared by the rebuild helper and release validator in converter-recipe-inputs.mjs: all31 maintained recipe files plus the three build/source-selection drivers must be pinned exactly once. The guarded native-image-codecs and pdf-native-runtime bundles carry the additional editable native patches; pdf-native-drawings-v2 and pdf-native-layout retain their earlier source foundations. The cumulative patch verifies every expected input before changing any source. Native text/ActualText, font, page, drawing, clip and asset associations remain checked. The established table profile and normal paragraph fallback are reported by the native sidecar itself. Native SharePoint layout may reflow; a successful source/content verification does not establish identical page geometry.

The same directory contains test-only reference producers. rebuild.sh accepts --capture-reference to build the unchanged upstream exporter with an IImageStorage observer, plus the same IJG decoder flag. capture-reference.mjs runs that observer; --baseline instead exercises the unchanged exporter. build-djpeg.py compiles the upstream IJG8c CLI, enabling only its existing disabled main. freeze-references.py checks exact original PNG calibration and independent CLI agreement, updates only the subsampled JPEG/CMYK reference PNGs, and records source/stream/dictionary/raw/producer hashes. It requires Pillow and a Linux djpeg executable; its final optional arguments are an unchanged-exporter output directory and extracted source directory. These probes never ship in the extension and do not parse or implement a PDF/JPEG codec. Pixel identity is evaluated against PDF-native decoded colors, not an unrelated viewer's DeviceCMYK conversion or re-encoded pypdf JPEG output.

The historical image-reference capture used earlier versions of Dockerfile, embuild.sh, prepare-context.py and rebuild.sh. Their original bytes and hashes are retained under provenance/converter/reference-inputs/original-image-capture, and pixel-reference-provenance.json points to those preserved inputs. They are historical producer evidence, not a claim that the current native recipe generated the old captures. Other unchanged producer inputs continue to point to their maintained source files.

sdk-runtime-provenance.json supplies official DocumentServer release gitlinks associating the font runtime and drawing source with SDK/core source. The font WASM is unchanged and is not claimed locally reproducible. The drawing WASM is rebuilt with the existing non-OpenSSL hash branch; drawing-build-provenance.json records exact source/patch/compiler inputs and output hashes. Run node products/file-to-sharepoint/scripts/build-drawing-runtime.mjs from the repository root, using Linux or WSL with Python 3, tar and ordinary build tools. Set C2S_WSL_DISTRO only when a nondefault WSL distribution is needed. Pinned compiler archives are cached and verified before extraction; every recipe invocation extracts a fresh source/compiler tree and compiles its objects. No global package installation or Docker is required. The source-build recipe retains readable JS instead of the upstream final WHITESPACE_ONLY Closure pass and only builds WASM. Its guarded CPdfReader::GetInfo patch exposes HasXFA and AcroFormFieldCount from the existing parsed catalog: a non-null XFA entry sets HasXFA; no AcroForm or an empty Fields array counts as zero; a Fields array reports its root length; missing or malformed form metadata reports -1. No parser or hash implementation is added. The generated source diff and metadata contract are retained under drawing/. sdk/catalog-source/ contains modified catalog literal source, editable selection data, baseline/patch and codecs, with upstream notices; it contains no font glyph files.

The maintained reader recipe also invokes patch-pdf-text.py and patch-pdf-font-metrics.py. Their source helpers expose bounded source Unicode/ActualText, text order, parsed font and graphics capabilities, and the existing native page-capture path. patch-graphics-blend.py retains the native alpha conventions. The guarded Type3 correction preserves parsed font size. All13 reader recipe files and the three build/source-selection/inventory drivers are bound exactly once in drawing-build-provenance.json through drawing-recipe-inputs.mjs; fresh-source closure evidence distinguishes these changes from the older form-only runtime. QA metrics observers and alternate order scans are excluded.

After acquisition run actual offline MV3 tests:

```
node --test products/file-to-sharepoint/tests/engine-vendor.test.mjs products/file-to-sharepoint/tests/engine.test.mjs products/file-to-sharepoint/tests/engine-content.test.mjs
```

## Preferred public source delivery

SOURCE-INPUTS.json pins original acquisition archives. Four of those originals contain unused prebuilt objects or unused noncommercial examples and must not be embedded in the public source ZIP. provenance/source-delivery.json maps them to exact .source-only.tar.gz deliveries, recording every omitted member and the complete retained regular-file index. provenance/source-filter-policy.json supplies the independently audited member pins. filter-source-archives.py reserializes only the audited retained entries with deterministic gzip metadata; --verify checks every delivered source/data byte and exclusion. No selected renderer source, font/cmap data, native/manual wrapper or build input is removed.

The Word and drawing build helpers automatically select and hash-check preferred source archives in C2S_SOURCE_DIR, C2S_SOURCE_DELIVERY_DIR, the local preferred-source cache or the public bundle sibling upstream-sources directory. Original pins remain acquisition evidence. Both Word and drawing outputs were actually reproduced from the filtered deliveries. Python 3.12+ is required for Unicode-safe SDK extraction and preferred-source filtering/verification; Windows bsdtar cannot read one retained Unicode PAX filename correctly. Unchanged dependency archives can also be supplied in upstream-sources for local builds.

## Maintained MIME source build

The browser MIME bundle uses six unmodified source files from the complete `@protontech/crypto` 2.2.0 source archive, plus one generated export entry. It does not install that package or bundle its unrelated cryptography modules. The source package declares GPL-3.0; its MIME subtree retains Joshua Cranmer's MIT license. The complete source archive also retains the unused `mailParser.js` MPL-2.0 notice. All three full license texts are distributed under `provenance/PROTON-*.txt` and pinned with the runtime in `mime-parser-build-provenance.json` and `manifest.json`.

From an exported application source root, install the exact build dependencies with `npm ci`, then use Node, Python 3 and the lock-pinned esbuild 0.25.9:

```
node products/file-to-sharepoint/scripts/build-mime-parser.mjs --offline --source-dir ../upstream-sources --cache-dir .artifacts/mime-build --output-dir .artifacts/mime-output
```

The command verifies the complete archive's size, SHA-256 and registry integrity; extracts a fresh source tree; rejects native binary and unsafe archive members; and verifies the actual compiler input closure and sole `MimeParser` export. The output directory receives the exact `mime-parser.js` and a machine-readable `mime-parser-build-result.json` containing source identity, package and license metadata, selected-source hashes and output hashes. No runtime file is replaced by this command.

The release validator executes this CLI from the provided source root in a fresh directory and checks its written output against the shipped bundle. It also binds the transitive source-archive helper, root package and lockfile, full license texts, and attribution notice. `validateMimeSource` accepts an explicit `workDirectory` outside an exported source tree so verification can retain its build audit without adding generated files to the source release. Calling `validateMimeSource` or the combined gate with `verifyArchives:false` checks these file and metadata bindings only; its result explicitly reports `reproduced:false` and is not a current source-rebuild claim.
