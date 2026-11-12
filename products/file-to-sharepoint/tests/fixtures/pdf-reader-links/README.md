These small PDF fixtures are original JZB Apps regression inputs. Rebuild them
with `python build.py` using ReportLab and Pillow. The generator uses invariant
PDF output; the browser test pins both resulting SHA-256 hashes.

`reader-links.pdf` contains editable text, an external URI, an internal page
destination and an inert unsupported URI. `image-only-link.pdf` checks that link
metadata cannot make a PDF without editable body text pass the OCR requirement.
