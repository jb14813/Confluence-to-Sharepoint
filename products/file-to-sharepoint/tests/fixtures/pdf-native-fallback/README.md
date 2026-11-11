These public synthetic PDFs contain no private document content. Regenerate
them with `python generate.py` using ReportLab 4.4.5. `manifest.json` records
their independently checked bytes and the converter used when authored.

`crossing-cell.pdf` contains two adjacent stroked rectangles and three editable
paragraphs. One paragraph crosses the common cell edge. The real native065
strict request2 returns 2147216641 with no output because it cannot prove
exclusive table ownership. Request3 selects actual PlainParagraph4 and retains
the text and both source strokes. The browser test follows that real fallback
through the maintained worker, parent validation, SDK and SharePoint adapter.

`unsupported-blend.pdf` uses Multiply. Both native requests refuse it; it must
never acquire a successful paragraph profile or editable import result.

The browser regression observes native calls in a disposable extension copy
without replacing calls, output, metadata or flags. Native password-exit and
partial-file branches use explicitly labeled transport-only doubles in a
separate test. These tests do not establish tenant acceptance or release proof.
