# Reconstructed content adapter

`adaptDocument({name, bytes, result}, {measureImage?})` is asynchronous and returns:

- `model`: native SharePoint blocks, assets, headings, stats and review warnings.
- `pictures`: `Map<SHA256, Blob>` of the exact embedded image bytes and any SDK-rendered nontext decorations.
- `formDefinition`: `null` or a version 1 definition accepted by the bundled SharePoint form runtime.
- `preview`: page sizes and reconstructed drawing geometry, identified by block and asset IDs.

`result` comes from `engine/convertDocument`, including `officeDocument`, `media`, `pdfForms`, `warnings` and optional `decorations`. This module adapts the existing SDK's structured model; it never decodes PDF or Office source bytes. `sourceHash` is a File-product-specific identity derived from the SHA-256 of the original file. `sourceFileHash` is the original SHA-256 itself. Source filenames are sanitized and no source author/version is fabricated.

Native text, heading, table and picture-slot HTML passes the shared `checkCanvasBlock` before it leaves the adapter. Raster media references resolve only against the supplied local media map; external paths, missing images, ambiguous basenames, unsupported image signatures and undecodable images fail the operation. The default dimension measurement uses `createImageBitmap`, closing each bitmap after measurement. Tests may inject `measureImage(blob)` returning `{width,height}`.

Textboxes become editable grouped table regions. Text and image content follow the reconstruction engine's document order. SharePoint reflows anchored content; `positioned-content-reflow` explicitly identifies that limitation. `preview.drawings` retains the engine's shape properties and dimensions converted from EMU to CSS pixels, including each original horizontal and vertical reference. It does not invent a page number for paragraph-relative anchors. `readingOrder` is `engine`.

ONLYOFFICE can rasterize an otherwise nontext shape. When `result.decorations[graphic.id]` is present, its bytes are retained as an image asset. Text-bearing shapes always take the editable content path. Shapes without a supplied nontext decoration, unknown content nodes, unadapted list numbering, notes and headers/footers produce explicit blocking warnings. Verified Word vertical merges become native HTML row spans; malformed grids and orphan continuations fail adaptation. Callers must disable sending while `model.warnings.some(warning => warning.blocking)`. All material warnings must be visible before the user sends a document.

PDFs with no reconstructed editable text remain available in preview but receive the blocking `pdf-ocr-unavailable` warning. `stats.editableTextCharacters` counts only non-whitespace visible characters actually adapted from document content; image descriptions, captions and interactive form metadata cannot satisfy that gate. PDFs containing both editable text and original raster images receive `pdf-image-text-review`, because the structured model alone cannot determine whether some pages or words remain inside images. OCR is not included.

The expanded Confluence export corpus exposed Type 3 font reconstruction failures, including two substantially incomplete PDFs that pass the positive-text-count gate. This gate does not verify complete source text, reading order or layout. See `docs/reviews/2026-11-09-confluence-export-validation.md`; publication remains blocked pending conversion and source/output verification fixes.

Original PDF field metadata is separate from reconstructed text. Names and export values keep their case. Radio widgets combine into one logical field by their inherited parent identity/name, and PDF option tuples are `[displayLabel, exportValue]`. Runtime field IDs are deterministic hashes, so raw names such as `__proto__` never become object keys. Geometry preserves original PDF page coordinates. The adapter rejects scripts/actions, signatures, unsupported field types, rich text, password/file-select, editable or multi-select choices, invalid selected values, ambiguous repeated widgets and definitions beyond the runtime's field/text/storage limits. It never executes PDF actions.

The JSON fixtures are narrowed snapshots of public synthetic conversion evidence: `content-word.json` retains four Word table cells and an image; `content-pdf.json` retains positioned textboxes, source shape geometry and an image; `content-forms.json` retains the original PDF field metadata. Neither the adapter nor these tests claim pixel-equivalent responsive SharePoint layout.
