# PDF combined evenOdd fill and stroke regression

These synthetic ReportLab PDFs contain public test data. The form has a readonly reference, required multiline notes, two filled/stroked field boxes and an outer stroked rectangle. `generate-readonly.py` records its source construction; generation timestamps may change bytes. `manifest.json` identifies the frozen regression inputs. The minimized `fill-stroke.pdf` retains one combined rectangle and editable text.

The tests execute the actual pinned native converter and full MV3 conversion/adapter. Both paint sources must remain verified; field flags and source-image verification are not bypassed.
