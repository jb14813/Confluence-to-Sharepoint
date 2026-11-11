These three `cell-figure-*` fixtures are synthetic project-owned controls: a
triangle, a translucent triangle and a filled curve between the editable words
Before and After in the left cell of a two-cell table. The right cell says Right.

The XML is the unchanged native039 `word/fts-pdf-drawings.xml`. Each JSON records
the original PDF, native DOCX, private-part and actual SDK capture SHA-256 values.
Its source context comes from the independently loaded original PDF through
Reader011 (`readPdfTextCapabilities`), including original Unicode occurrence
boxes. Source text and boxes were not synthesized from the converted output.
The SDK model is the unmodified ordinary BIN capture from the same native DOCX.

Native039 is an isolated QA candidate with the guarded fill-only, solid-brush,
single-cell vector path. These fixtures do not establish adoption, complete PDF
support, stroke/texture support, tenant behavior or a clean release build. Their
consumer rejects clips, strokes, cross-cell ownership, rotations, text overlap
and missing provenance instead of treating such content as an inline picture.
