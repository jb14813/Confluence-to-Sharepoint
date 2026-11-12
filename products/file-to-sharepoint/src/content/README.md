# Reconstructed content adapter

`adaptDocument({name, bytes, result}, {measureImage?})` is asynchronous and returns:

- `model`: native SharePoint blocks, assets, headings, stats and review warnings.
- `pictures`: `Map<SHA256, Blob>` of the exact embedded image bytes and any SDK-rendered nontext decorations.
- `formDefinition`: always `null`; supported PDF fields are part of the native content model.
- `preview`: page sizes and reconstructed drawing geometry, identified by block and asset IDs.

`result` comes from `engine/convertDocument`, including `officeDocument`, `media`, `pdfForms`, `warnings` and optional `decorations`. This module adapts the existing SDK's structured model; it never decodes PDF or Office source bytes. `sourceHash` is a File-product-specific identity derived from the SHA-256 of the original file. `sourceFileHash` is the original SHA-256 itself. Source filenames are sanitized and no source author/version is fabricated.

Native text, heading, table and picture-slot HTML passes the shared `checkCanvasBlock` before it leaves the adapter. Raster media references resolve only against the supplied local media map; external paths, missing images, ambiguous basenames, unsupported image signatures and undecodable images fail the operation. The default dimension measurement uses `createImageBitmap`, closing each bitmap after measurement. Tests may inject `measureImage(blob)` returning `{width,height}`.

Textboxes become editable grouped table regions. Text and image content follow the reconstruction engine's document order. SharePoint reflows anchored content; `positioned-content-reflow` explicitly identifies that limitation. `preview.drawings` retains the engine's shape properties and dimensions converted from EMU to CSS pixels, including each original horizontal and vertical reference. It does not invent a page number for paragraph-relative anchors. `readingOrder` is `engine`.

ONLYOFFICE can rasterize an otherwise nontext shape. When `result.decorations[graphic.id]` is present, its bytes are retained as an image asset. Text-bearing shapes always take the editable content path. Shapes without a supplied nontext decoration, unknown content nodes, unadapted list numbering, notes and headers/footers produce explicit blocking warnings. Verified Word vertical merges become native HTML row spans; malformed grids and orphan continuations fail adaptation. Callers must disable sending while `model.warnings.some(warning => warning.blocking)`. All material warnings must be visible before the user sends a document.

PDF body text is checked against the native reader's complete text and source paint coverage before form values are added. Image descriptions, captions and field values cannot conceal missing body text. A verified visible form-only PDF can have an empty body; an image-only scan receives the blocking `pdf-ocr-unavailable` warning. PDFs containing text and original raster images receive a review note because words may remain inside images. OCR is not included.

Original PDF fields become ordinary native text and bordered table cells in source widget order. Current text and choice values, repeated widgets, radio and checkbox states are retained; empty current values stay blank even when a default or stale appearance exists. Read-only and rich-text values become static editable content, while password values remain masked. Hidden widgets are omitted before labels or values are processed. Visibility is per widget, not inherited from field parents. PDF actions are never executed. Unsupported XFA and unreadable or inconsistent field metadata remain protected by explicit conversion errors.

The JSON fixtures are narrowed snapshots of public synthetic conversion evidence: `content-word.json` retains four Word table cells and an image; `content-pdf.json` retains positioned textboxes, source shape geometry and an image; `content-forms.json` retains the original PDF field metadata. Neither the adapter nor these tests claim pixel-equivalent responsive SharePoint layout.
