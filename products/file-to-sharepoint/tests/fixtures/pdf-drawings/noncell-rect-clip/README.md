# Own noncell rectangular clip regression

These 16 small PDFs are authored test inputs, not tenant or vendor samples:
`hole`, `star`, `alpha`, and `curve`, each crossing or touching a real rectangle,
with both PDF clip winding modes (`W` / `W*`). Every figure sits between editable
`Before` and `After`; there is no table. The curve uses a control minimum outside
its sampled painted bounds, and its touching clip meets that control minimum.

The original clipped and unclipped PDFs, independent MuPDF 192 dpi RGBA renders,
genuine native060 V2 ledger, actual DOCX -> BIN -> SDK JSON, and full native PNG
are retained. `manifest.json` hashes every per-case artifact and pins the Reader,
SDK, original strict validator, and proof runtime identities. Supplied converter
hashes are recorded by the browser test; no converter adoption is implied.

`generate.py` uses ReportLab only to author inputs and MuPDF only for independent
reference images. `verify-pixels.py` compares reference-selected uniform 5x5
interiors against all corresponding native pixels. Native output never decides
which samples count. Every crossing case must have both visible paint and paint
made transparent by the clip. Touching correctly leaves source pixels unchanged.
The hole/alpha cases also retain transparency present in the original shape.
Straight RGBA channel deltas are at most one; edge antialiasing is excluded from
cross-rasterizer equality. Entire encoded PNGs and decoded RGBA hashes are pinned
and rechecked through real DOCX -> BIN -> SDK conversion in
`pdf-rect-clip-browser.test.mjs`.

The isolated offline MV3 browser regression uses shipping CSP and opaque SDK
sandbox messages, preserves all 11 editable characters and the full image
viewport, records each staged runtime file, and closes its own context, workers,
and frames. Existing cell/plain-vector rules, arbitrary clip refusals, source,
origin, resource budgets, full PNG decode, and SDK identity/viewport guards remain
separate negative assertions in the focused tests.

Private RED/GREEN proof lives under `.artifacts/derived-rect-clip-contract`.
The original strict validator refuses all 16 cases; only
`src/engine/pdf-drawings.js` differs between the staged runtime inventories.
The updated consumer imports all 16. This proves the bounded noncell rectangular
clip contract locally; it does not establish SharePoint import, private document
acceptance, native source adoption, publication, or package/release readiness.
