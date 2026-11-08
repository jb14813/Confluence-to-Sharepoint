# Corresponding source for 0.7.0

The release distributes the combined Confluence and file importer under GNU AGPL version 3, with the original MIT core notice retained. Unchanged upstream additional notices, the original ONLYOFFICE logo, CC BY-SA graphical asset terms and dependency licenses accompany the extension. No trademark endorsement is implied.

The source download is named in [SOURCE-MANIFEST.json](SOURCE-MANIFEST.json), with a SHA-256 sidecar beside the archive. It contains `application/` (this application's editable source, modifications, build recipes, lockfiles, provenance and notices) and `upstream-sources/` (the preferred source and required toolchain archives). [SOURCE-INPUTS.json](SOURCE-INPUTS.json) records original acquisition identities. The root `SOURCE-DELIVERY.json` and its copy under `application/products/file-to-sharepoint/vendor/provenance/` record the delivered hashes. Four archives are source-only derivations: obsolete compiled programs and unrelated GPC/example code are removed while editable source, font/CMap data and build inputs remain byte-identical. Source is supplied as actual bytes alongside the binary release. There is no paid source service or written-offer dependency.

## Build the standard extension

Use Node 26 and npm 11. The checked-in engine files are verified before bundling; installed extensions never download code, fonts or conversion binaries.

```powershell
cd application
npm ci
npm --prefix products/file-to-sharepoint ci
npm --prefix products/file-to-sharepoint/sharepoint-form ci
npm run build
```

Load `dist/sharepoint-helper` as an unpacked Chrome extension. The normal Confluence toolbar remains; **Import a file** opens the local reconstruction workspace. These build tools run on the developer's machine only. The installed product converts entirely inside Chrome.

## Engine source and modifications

- **x2t:** official CryptPad `v9.3.2+3`, commit `7debf5e6d6d4f19874d764cd34446f7e63c6bc32`. The upstream release archive, tagged successful CI run and extracted output hashes are recorded in `products/file-to-sharepoint/vendor/converter-provenance.json`. The archive includes the converter's vendored core source; dependencies, linked Emscripten runtimes/ports, Dockerfile and build script are supplied separately. This project has not reproduced the C++ binary. Historical Ubuntu image/APT versions were not published, and inferred historical Hyphen/x265 commits are explicitly labeled in the record.
- **Word SDK:** official `sdkjs` commit `679a6d70ccb5487924f034cea089ff30daeeb7fd` (`v9.3.0.133`). Both Word bundles were compiled with the upstream-supported `SIMPLE` setting using the supplied shrinkwrap and compiler, then independently reproduced from a fresh extraction. SDK JavaScript and Grunt logic are unchanged. See `sdk-build-provenance.json`, `scripts/build-word-sdk.mjs` and `scripts/word-sdk-inputs/rebuild-sdk.ps1` under the file module. Rebuilding uses PowerShell 7, Python 3, Node/npm and the exact pinned compiler. The Unicode-safe Python archive extractor is included and hashed with the build inputs. `ADVANCED` compilation changes private SDK names and is incompatible with this integration.
- **PDF drawing runtime:** built from official core `d54f0326cd67ef0d59b87af1c3ff51d678f77a39` using the upstream builder and its existing Xpdf hash branch. The patch removes `USE_OPENSSL_HASH`, OpenSSL include paths and OpenSSL-specific source preparation, so the older OpenSSL implementation is excluded. Readable generated bootstrap, exact source patch, toolchain archives, dependency inputs, build recipe and output hashes are retained in `drawing-build-provenance.json` and `scripts/drawing-runtime-inputs/`. This replaces the formerly selected official drawing binary whose copied OpenSSL implementation had incompatible terms. No custom PDF parser or cryptographic algorithm was written.
- **Font runtime:** exact official SDK blobs from `1b1c0fd7f886a00cf7c9e7eaef43704a53d20a59`, associated with the matching core by the official DocumentServer `v9.3.0` release tree. Sources, dependencies and deployment recipes are included. A local font-WASM rebuild is not claimed. See `sdk-runtime-provenance.json`.
- **Font catalog:** modified readable registry, decoded editable data, original baseline, exact patch, codecs, generator and instructions are retained in `vendor/provenance/sdk/catalog-source`. The AllFonts catalog does not bundle or download external font glyph files. The PDF WASM engine contains embedded base fonts, whose source and notices are retained. The retained mirror notice does not replace this project's original-logo and upstream-notice obligations.
- **Other dependencies:** `vendor/provenance/third-party-source-inputs.json` identifies the actual embedded versions and preferred sources, including dependencies inside JSZip and SurveyJS. Their complete runtime licenses are retained. Application adapters, sandbox setup, extraction mappings and the SharePoint form component are editable source in this repository.

See `products/file-to-sharepoint/vendor/provenance/BUILD.md` for acquisition and rebuild commands. The acquisition inventory pins original source and build inputs. The delivery record pins the four derived source-only archives, every excluded member and the retained-source index. Required compiler/tool archives are retained with their licenses. Generated/minified vendor files alone are not the corresponding source.

## Preferred-source delivery

The SDK/core acquisition archives include unrelated cached programs and superseded drawing WASM/asm.js. Those objects are not included in this source download. `scripts/filter-source-archives.py` and its pinned policy under the file module produce the four `.source-only.tar.gz` archives. The delivery record binds each original archive, exact removed-member hashes, unchanged retained-member index and delivered archive hash. The source-build helpers accept these verified preferred archives, so the supplied source can be used without reacquiring excluded objects.

## Interactive SharePoint forms

Ordinary editable drafts need no SharePoint component. Forms need the companion app installed on the selected site; see `products/file-to-sharepoint/sharepoint-form/README.md`. The release includes the `.sppkg` and its complete project source. To build it:

```powershell
npm --prefix products/file-to-sharepoint/sharepoint-form run build
```

The component runs with the reader's current SharePoint permissions and does not request extra API permissions or grant access to response lists. Imports create unpublished drafts.

## Release verification

The maintainer release gate verifies every source archive's size and SHA-256, official source/build associations, exact runtime hashes, editable catalog material, retained notices, full regression tests and an offline installation of the Store ZIP. `node scripts/source-release.mjs --check --source-dir DIR` checks collected source inputs; repeat `--source-dir` for multiple directories. The installed extension links to the same public source archive through **Licenses and source**.

Fresh-source byte-for-byte reproduction is established for the Word JavaScript bundles. The PDF drawing engine is locally source-built with the recorded compatibility patch. Official origin and publisher-associated source are established for the remaining converter/font WASM components; a locally reproducible build of those two components is not claimed.
