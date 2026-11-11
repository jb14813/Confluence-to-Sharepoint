# Derived raster frame origin

This independently authored, public ReportLab PDF has editable `Before` and
`After` text around one evenodd filled cubic, without a table or a clip. It
contains no private corpus content. `generate.py` creates the source PDF and
an independent PyMuPDF 192-dpi reference image; both libraries are test-only.

The genuine native060 export retains sampled source bounds beginning at
`94.48000000000003, 75.41999999999997` displayed page points. The full PNG
frame begins at the original control minimum, exactly
`80, 59.99999999999998`. Original path and CTM provenance are preserved.
The resulting PNG is 134 by 161 pixels. DOCX uses that full viewport with
zero crop; the SDK expresses its full source rectangle as 0/0/100/100.
`operation-proof.json` records the original geometry and native DOCX frame.

The manifest pins the genuine native060, Reader011 and SDK context, source
and output bytes. The old guard (SHA-256 `9531aaa897cc66a8993a02c1dd1b265d807fc9cb500bd6eda907bc85c10e7a69`)
refused this PDF, and the exact-control-origin guard accepted it with every
staged runtime file identical except `src/engine/pdf-drawings.js`.
The approved font-ready sandbox was frozen at SHA-256
`0e98f65b32f5f10b21f0c93e56c55257addb70f80368c0823a05d5058d611bd0`.

`verify-pixels.py` compares source and native pixels at their physical frame
coordinates. Its 19,846 locally uniform interior samples match exactly,
including 11,851 transparent and 7,995 painted samples. Different
rasterizers' antialiased edge pixels are not asserted identical. Full PNG
bytes and native RGBA identity are separately pinned.

`pdf-derived-origin.test.mjs` validates immutable native provenance, actual
SDK binding, crop/resource/extent refusals and source-verified flow.
`pdf-derived-origin-browser.test.mjs` reruns the complete offline strict-MV3
native → DOCX → BIN → SDK → editable Before/image/After pipeline against a
supplied runtime (`C2S_ENGINE_VENDOR_DIR`). These are local verification
fixtures; native/source adoption and publication remain held.
