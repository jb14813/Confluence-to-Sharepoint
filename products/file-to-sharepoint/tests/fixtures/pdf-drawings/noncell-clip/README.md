# Noncell harmless clip regression

These six small PDFs were authored for this regression. They contain only
`Before`, one evenodd vector fill, and `After`, with no table or private corpus
content. Each hole, self-intersecting star, and alpha fill has one strictly
enclosing rectangular clip in each PDF clip mode. `mode0` and `mode1` in file
names are ReportLab's fill-mode arguments; the native modes are respectively
1 and 0, as recorded in the manifests and genuine XML.

`generate.py` uses ReportLab 4.4.5 and PyMuPDF 1.26.6 as test tooling. It also
renders the clipped source and proves its full 192-dpi RGBA matches an unclipped
source control. Product conversion remains inside Chrome.

The XML, original vector provenance, SDK document snapshots, and PNG bytes in
the JSON files are actual outputs from native060, Reader011, and the real
DOCX-to-BIN-to-SDK pipeline. They were not authored or relabeled to create a
noncell role. `manifest.json` pins the converter, Reader, SDK, inputs, and
snapshots. The browser regression accepts a candidate runtime through
`C2S_ENGINE_VENDOR_DIR`, records its actual hashes, and verifies the original
PNG remains byte-identical through DOCX, SDK media, and final model assets.

`verify-pixels.py` independently compares those native PNGs to the source
renders. All six have over 11,000 uniform interior samples including painted
and transparent areas, zero samples beyond a one-channel delta of 1, and a
maximum delta of 0 for the hole and star. Alpha has a maximum delta of 1.
Antialiased boundaries from different rasterizers are excluded from this
comparison. Full PNG/RGBA identities are pinned separately.

The exact original validator, SHA256
`5242dd5aec76081f5a93161515eeba667b02c7ba331857a52857c3765f9c98e4`,
refused all six in the same native060 browser pipeline. Only the validator
differed between frozen red and green runtime inventories. The repaired
validator admits these six and the actual adapter preserves three blocks in
the order Before / picture / After, 11 editable characters, and zero tables.

These fixtures establish this bounded noncell figure profile. Authored unit
tests separately cover under-text provenance; the surface compositor can
still refuse an underlay. Source-origin, line overlap, ownership, geometry,
resource, and budget guards remain applicable. Source/publication adoption
remains held.
