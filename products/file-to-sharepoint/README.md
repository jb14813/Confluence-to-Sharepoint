# File to SharePoint

The file-import module of **Confluence to SharePoint** imports local documents into editable, unpublished SharePoint pages. The standard extension opens this workspace through **Import a file**. This directory retains its independent development harness, icon, fixtures and build scripts; the harness is not a second Store product.

## File import

Supported inputs: DOCX, legacy DOC, ODT, RTF, UTF-8 TXT and text-based PDF, up to 50 MiB. Packaged ONLYOFFICE/CryptPad WebAssembly and the existing Word SDK reconstruct the files inside Chrome. No conversion service, local helper, account token, CDN code, PDF script or macro is used. Converted content and embedded pictures stay local until the user chooses **Create SharePoint draft**.

MIME-wrapped Confluence Word exports use the packaged Proton MIME parser and the existing Word SDK HTML importer. Original bitmap resources are used directly when their display is supported; embedded or inline SVG becomes a local PNG. Images linked from a website require the user to choose **Load linked images** after reviewing the listed hosts. Downloads use HTTPS without cookies or a referring page address. Original bytes, recovered image hashes and converted PNG hashes are checked separately during validation. Source widgets become labeled editable snapshots or links rather than executable source application controls. Source unknown-attachment markers remain explicit unknown-attachment notes.

The workspace shows reconstructed editable text, formatting, tables, pictures and conversion notes. Positioned PDF textboxes become editable native table cells in document order; shapes without text use the existing SDK's PNG export. SharePoint reflows these elements. Exact PDF coordinates are retained in review metadata, not reproduced as a fixed page overlay. Formatting differences use the closest supported native representation with a preview note. Missing or unreadable content still blocks sending. Image-only PDFs require OCR and cannot currently be sent as editable content; mixed scanned and text documents require careful review.

Word bullets and decimal, alphabetic and Roman lists become editable native SharePoint lists, using the existing SDK's effective styles and calculated starts, restarts and continuation. Verified custom/compound markers and counters that native lists cannot represent become editable literal markers; skipped levels use the available real items without invented parent content. Explicit marker-free Word entries become ordinary paragraphs. Vertical table-cell merges become native row spans, retaining combined horizontal spans, nested tables, row offsets and continuation content. Decorative borders/fills are simplified where needed, and oversized row heights use automatic sizing. Source text and images remain verified.

Headers and footers become labeled editable sections rather than repeating at page boundaries. Footnotes and endnotes become linked editable sections with consecutive reference numbers; custom source marks remain text links. Known content controls become ordinary editable content. Document fields retain their cached visible results as static editable text, with a note that automatic updates are not retained. Missing part definitions, malformed field boundaries, unverified markers and missing images remain blocking conditions. The native PDF reader identifies XFA and verifies form metadata before reconstruction; unsupported or unreadable form behavior cannot be silently flattened into ordinary content.

Original media is used directly where supported. Transformed or nonuniform views and very narrow graphics can use verified PNG derivatives, with preview notes; transparent image padding preserves the original pixels and paint scale. PDF rasters keep their decoded dimensions and pixels through lossless PNG export; PDF decoding and color-space conversion are handled by the established upstream libraries. The selected original or derived media bytes are hashed and verified after upload. Browser rendering limits and layout/order adaptations are explicit in the preview. Ordinary SharePoint content and native editing are used, with no custom document viewer, editor or layout web part. This does not promise identical compressed JPEG bytes or identical color rendering across PDF viewers. The retained shared core handles folder-to-root fallback, verification, draft check-in and recovery. Missing libraries or refused images retain its marked-picture recovery behavior and explicit send notes. An interrupted send retains its attempt identity and destination; status reconciliation never blindly repeats page creation. No page is automatically published.

PDF AcroForm fields become interactive text, multiline, checkbox, dropdown and radio controls using the included SPFx component and MIT-licensed SurveyJS Form Library. Controls are grouped by source page in boxed panels. XFA, signatures, calculations, scripts, unsupported controls and unsupported choice semantics block a misleading form import. Scanned-page OCR and exact positioned form overlays are not implemented.

## Build and checks

From the repository root, install the root build/test tools, then this product's pinned XML dependency:

```powershell
npm ci
npm --prefix products/file-to-sharepoint ci
npm --prefix products/file-to-sharepoint/sharepoint-form ci
npm --prefix products/file-to-sharepoint/sharepoint-form run build
npm --prefix products/file-to-sharepoint run vendor:verify
npm --prefix products/file-to-sharepoint run build
npm --prefix products/file-to-sharepoint test
```

`npm --prefix products/file-to-sharepoint run package` creates a development review ZIP and SHA-256 file below this product's `dist` folder. It does not publish or upload anything.

Load `dist/file-to-sharepoint` below this product directory through Chrome's **Load unpacked**. The toolbar button opens its document workspace. `EXTENSION_CHROME_PATH` can select an extension-capable Chromium for browser tests. `FTS_BUILD_DIR` can select a separate generated build folder.

Tests use actual Word/PDF/Office fixtures in a strict offline MV3 extension, native image decoding, the existing form runtime, schema/readiness/reconciliation transports and the packaged review workspace. Synthetic transport tests do not establish live tenant permissions or deployment. The private maintainer checkout also runs the shared Confluence regression gate. Browser tests require Playwright 1.55.1 as a development tool; the public build does not install that test-only dependency.

Authorized installation and live form acceptance completed on 2026-11-08; see [validation evidence and limits](VALIDATION.md).

## SharePoint form installation

Ordinary document imports need no custom SharePoint component. Interactive form imports need an administrator-reviewed installation of the included `sharepoint-form/sharepoint/solution/file-to-sharepoint-form.sppkg` in the selected site's app catalog. See [runtime installation and schema documentation](sharepoint-form/README.md).

Before any form data, images or page writes, the importer checks for the installed component. After the user chooses Send, it creates or validates two owned generic lists: **File to SharePoint Form Definitions** and **File to SharePoint Form Responses**. It preserves existing site permissions and verifies an immutable definition by read-back. Site owners must select appropriate response-list permissions for their audience; the extension does not grant access or elevate respondents. Compatible, empty lists left by an interrupted setup can resume missing columns. Existing data, conflicting schemas and uncertain writes are never silently repaired or overwritten.

The form renderer runs inside SharePoint in the current user's browser. It is not a conversion server. It stores responses through that user's SharePoint permissions, validates supported values and keeps the same unique submission ID for explicit uncertain-outcome retries.

## Branding and distribution

The file workflow uses original document artwork. The standard Confluence extension toolbar and branding remain unchanged. The earlier OpenOffice composite was replaced during the license review because its reuse permission was unclear. [Editable SVG and generation instructions](assets/README.md).

The combined distribution is AGPL-3.0-only, with the original MIT core attribution and upstream additional notices retained. The original ONLYOFFICE logo and applicable CC BY-SA graphical asset attribution appear in the combined workspace and legal page. See the root [corresponding-source instructions](../../CORRESPONDING-SOURCE.md) and [release inventory](../../SOURCE-MANIFEST.json).

The converter is locally built from pinned CryptPad source with targeted lossless-image export patches and the existing IJG JPEG reader. A fresh source-only replay reproduced both outputs exactly; its package inventory and reused toolchain/cache limits are documented. The Word JavaScript SDK was rebuilt and independently reproduced from pinned upstream source. The PDF drawing runtime is built from pinned official core with the existing Xpdf hash branch, excluding the older OpenSSL implementation. The font runtime matches official SDK blobs linked to core source by the publisher's DocumentServer release tree; a local font-runtime build is not claimed. Complete source inputs, local modifications, build recipes and historical upstream evidence are retained; see [vendor provenance](vendor/NOTICE.md) and [corresponding source](../../CORRESPONDING-SOURCE.md).
