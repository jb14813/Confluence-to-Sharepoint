# Engine source and build materials

These records distinguish official release/source association from a local rebuild. All executable conversion remains inside the installed Chrome extension; these commands run only during development/release acquisition.

From the repository root:

```
node products/file-to-sharepoint/scripts/vendor-engine.mjs
node products/file-to-sharepoint/scripts/vendor-engine.mjs --fetch
node products/file-to-sharepoint/scripts/collect-engine-source.mjs --output SOURCE_DIRECTORY
```

--fetch downloads the pinned official CryptPad archive, verifies its published SHA256/SHA512 and each extracted output, fetches exact pinned upstream files, and builds the two Word bundles. Word rebuilding requires PowerShell 7, tar, Node/npm and access to the pinned source/npm registry. The recorded Windows/Node/compiler environment produced the distributed hashes; other environments must still pass exact hash checks. The complete npm shrinkwrap includes transitive package integrity values. build-word-sdk.mjs uses a fresh build directory, verified source tarball, fixed environment values and upstream Grunt SIMPLE compilation. It refuses mismatching outputs. SDK source and Grunt logic are unchanged. ADVANCED changes private SDK names and is incompatible with this integration.

collect-engine-source.mjs streams/verifies all source archives listed by the manifest provenance files. Optional --reuse-dir CACHE reuses verified archives. It emits corresponding-source-manifest.json; no source bytes are fetched by the installed extension. Include the verified delivery archives (using all four source-only substitutions) plus application source, licenses, lockfiles, these provenance records and build recipes in the release corresponding-source bundle. Publish the source bytes, not merely links.

For x2t, converter-provenance.json ties exact archive members to the successful maintainer GitHub Actions release and tagged source. converter/ contains the workflow, Dockerfile, build script and exact source/dependency recipes. The converter source archive contains vendored core; source dependencies and Emscripten linked runtimes/ports are separately pinned. Rebuilding can start from recorded Dockerfile/build.sh with those inputs. Historical CI Ubuntu image digest/APT versions were not recoverable; unpinned dependencies inferred from public history are labeled. No local x2t rebuild or byte reproducibility is claimed.

sdk-runtime-provenance.json supplies official DocumentServer release gitlinks associating the font runtime and drawing source with SDK/core source. The font WASM is unchanged and is not claimed locally reproducible. The drawing WASM is rebuilt with the existing non-OpenSSL hash branch; drawing-build-provenance.json records exact source/patch/compiler inputs and output hashes. Run node products/file-to-sharepoint/scripts/build-drawing-runtime.mjs from the repository root, using Linux or WSL with Python 3, tar and ordinary build tools. Set C2S_WSL_DISTRO only when a nondefault WSL distribution is needed. Pinned compiler archives are cached and verified before extraction; no global package installation or Docker is required. The source-build recipe retains readable JS instead of the upstream final WHITESPACE_ONLY Closure pass and only builds WASM. It makes no document parsing or hash implementation changes. sdk/catalog-source/ contains modified catalog literal source, editable selection data, baseline/patch and codecs, with upstream notices; it contains no font glyph files.

After acquisition run actual offline MV3 tests:

```
node --test products/file-to-sharepoint/tests/engine-vendor.test.mjs products/file-to-sharepoint/tests/engine.test.mjs products/file-to-sharepoint/tests/engine-content.test.mjs
```

## Preferred public source delivery

SOURCE-INPUTS.json pins original acquisition archives. Four of those originals contain unused prebuilt objects or unused noncommercial examples and must not be embedded in the public source ZIP. provenance/source-delivery.json maps them to exact .source-only.tar.gz deliveries, recording every omitted member and the complete retained regular-file index. provenance/source-filter-policy.json supplies the independently audited member pins. filter-source-archives.py reserializes only the audited retained entries with deterministic gzip metadata; --verify checks every delivered source/data byte and exclusion. No selected renderer source, font/cmap data, native/manual wrapper or build input is removed.

The Word and drawing build helpers automatically select and hash-check preferred source archives in C2S_SOURCE_DIR, C2S_SOURCE_DELIVERY_DIR, the local preferred-source cache or the public bundle sibling upstream-sources directory. Original pins remain acquisition evidence. Both Word and drawing outputs were actually reproduced from the filtered deliveries. Python 3.12+ is required for Unicode-safe SDK extraction and preferred-source filtering/verification; Windows bsdtar cannot read one retained Unicode PAX filename correctly. Unchanged dependency archives can also be supplied in upstream-sources for local builds.
