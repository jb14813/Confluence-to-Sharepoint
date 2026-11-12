# File to SharePoint

The file-import module of **Confluence to SharePoint** imports local documents into editable, unpublished SharePoint pages. The standard extension opens a compact import window through **Import a file** on SharePoint, in its popup or on the dashboard. This directory contains the converter adapter, source build recipes and provenance.

## File import

Supported inputs: DOCX, legacy DOC, ODT, RTF, UTF-8 TXT and text-based PDF, up to 50 MiB. Packaged ONLYOFFICE/CryptPad WebAssembly and the existing Word SDK reconstruct the files inside Chrome. No conversion service, local helper, account token, CDN code, PDF script or macro is used. Converted content and embedded pictures stay local until the user chooses **Create draft**, **Add to bottom** or **Overwrite**.

MIME-wrapped Confluence Word exports use the packaged Proton MIME parser and the existing Word SDK HTML importer. Original bitmap resources are used directly when their display is supported; embedded or inline SVG becomes a local PNG. Images linked from a website require the user to choose **Load linked images** after reviewing the listed hosts. Downloads use HTTPS without cookies or a referring page address. Original bytes, recovered image hashes and converted PNG hashes are checked separately during validation. Source widgets become labeled editable snapshots or links rather than executable source application controls. Source unknown-attachment markers remain explicit unknown-attachment notes.

The compact window shows the file, page title, remembered site/page choices and conditional conversion notes. The generated content is reviewed and edited using SharePoint. The dashboard is the single full-page history view; file rows contain destination metadata and the last successful import date, with no original uploads, file watching or file revision comparisons. Positioned PDF textboxes become editable native table cells in document order; shapes without text use the existing SDK's PNG export. SharePoint reflows these elements. Exact PDF coordinates are retained in review metadata, not reproduced as a fixed page overlay. Formatting differences use the closest supported native representation with a conversion note. Missing or unreadable content still blocks sending. Image-only PDFs require OCR and cannot currently be sent as editable content; mixed scanned and text documents require careful review.

Word bullets and decimal, alphabetic and Roman lists become editable native SharePoint lists, using the existing SDK's effective styles and calculated starts, restarts and continuation. Verified custom/compound markers and counters that native lists cannot represent become editable literal markers; skipped levels use the available real items without invented parent content. Explicit marker-free Word entries become ordinary paragraphs. Vertical table-cell merges become native row spans, retaining combined horizontal spans, nested tables, row offsets and continuation content. Decorative borders/fills are simplified where needed, and oversized row heights use automatic sizing. Source text and images remain verified.

Headers and footers become labeled editable sections rather than repeating at page boundaries. Footnotes and endnotes become linked editable sections with consecutive reference numbers; custom source marks remain text links. Known content controls become ordinary editable content. Document fields retain their cached visible results as static editable text, with a note that automatic updates are not retained. Missing part definitions, malformed field boundaries, unverified markers and missing images remain blocking conditions. The native PDF reader identifies XFA and verifies form metadata before reconstruction; unsupported or unreadable form behavior cannot be silently flattened into ordinary content.

Original media is used directly where supported. Transformed or nonuniform views and very narrow graphics can use verified PNG derivatives, with conversion notes; transparent image padding preserves the original pixels and paint scale. PDF rasters keep their decoded dimensions and pixels through lossless PNG export; PDF decoding and color-space conversion are handled by the established upstream libraries. The selected original or derived media bytes are hashed and verified after upload. Browser rendering limits and layout/order adaptations are explicit in conversion notes. Ordinary SharePoint content and native editing are used, with no custom document viewer, editor or layout web part. This does not promise identical compressed JPEG bytes or identical color rendering across PDF viewers. The retained shared core handles folder-to-root fallback, verification, draft check-in and recovery. Missing libraries or refused images retain its marked-picture recovery behavior and explicit send notes. An interrupted send retains its attempt identity and destination; status reconciliation never blindly repeats page creation. No page is automatically published.

PDF fields become native editable table cells and text. Current answers, choice labels and checkbox/radio states are retained; absent values remain blank rather than using source defaults. Read-only and multiline values become ordinary page content, and password fields remain masked. Fields follow source-page order with native boxes. Source scripts do not execute, dynamic behavior and signature validity are not retained, and unreadable/XFA content is not silently invented.

## Build and checks

From the repository root, install the build tools and the file module's pinned XML dependency:

```powershell
npm ci
npm --prefix products/file-to-sharepoint ci
npm --prefix products/file-to-sharepoint run vendor:verify
npm run build
```

The standard build is generated from the repository root with `npm run build`. See the root README for installation, deployment and release validation.

## Branding and distribution

The file workflow uses original document artwork with the extension's JZB Apps branding. [Editable SVG and generation instructions](assets/README.md).

The combined distribution is AGPL-3.0-only, with the original MIT core attribution and upstream additional notices retained. The original ONLYOFFICE logo and applicable CC BY-SA graphical asset attribution appear in the combined import window and legal page. See the root [corresponding-source instructions](../../CORRESPONDING-SOURCE.md) and [release inventory](../../SOURCE-MANIFEST.json).

The converter is locally built from pinned CryptPad source with targeted lossless-image export patches and the existing IJG JPEG reader. A fresh source-only replay reproduced both outputs exactly; its package inventory and reused toolchain/cache limits are documented. The Word JavaScript SDK was rebuilt and independently reproduced from pinned upstream source. The PDF drawing runtime is built from pinned official core with the existing Xpdf hash branch, excluding the older OpenSSL implementation. The font runtime matches official SDK blobs linked to core source by the publisher's DocumentServer release tree; a local font-runtime build is not claimed. Complete source inputs, local modifications, build recipes and historical upstream evidence are retained; see [vendor provenance](vendor/NOTICE.md) and [corresponding source](../../CORRESPONDING-SOURCE.md).
