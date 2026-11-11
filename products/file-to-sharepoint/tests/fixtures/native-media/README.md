# Synthetic native image controls

The 24-bit and 32-bit BMPs contain authored 80 × 40 colored quadrants.
The wide BMP is 2,101 × 33 pixels and detects the converter's former 2,000-pixel
resize. PNG references were decoded independently with Windows System.Drawing.
They contain synthetic pixels only.

Tests wrap these original BMPs in the existing synthetic DOCX fixture and compare
full browser-decoded RGBA pixels against the PNG references. This verifies native
format conversion and transport without tolerating JPEG loss or silent resizing.

The wide RGB and RGBA TIFFs add high-frequency colored stripes, with partial
alpha in the RGBA case. They use uncompressed TIFF and independently encoded
Pillow PNG references, all 2,101 × 33 pixels. They detect opaque TIFF-to-JPEG
loss, resizing of either color mode, alpha loss and a second viewport resample.
Their deterministic generator is `generate-wide-tiff.py`; these are original
synthetic pixels, with encoded input/reference hashes pinned by the browser test.

The EMF contains the same authored quadrants, recorded with Windows GDI. Its
independent PNG reference comes from Windows System.Drawing. The browser test
requires the original EMF, the converter's verified SVG and its PNG view to
retain their source bindings. It compares every output pixel whose reference
has a uniform 5 × 5 neighborhood, covering all four colors. GDI/SVG antialiasing
at seams and borders is excluded explicitly; this is not a whole-image pixel
identity claim. Bitmap controls above continue to require full RGBA identity.

The WMF records the same synthetic EMF through Windows GDI's
[GetWinMetaFileBits](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-getwinmetafilebits)
with `MM_ANISOTROPIC`. Independently decoding that WMF through System.Drawing
produces the same pinned PNG reference. It receives the same source-binding and
uniform-interior checks as the EMF.
