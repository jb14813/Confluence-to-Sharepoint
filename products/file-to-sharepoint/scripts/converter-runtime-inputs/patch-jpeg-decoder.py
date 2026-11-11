"""Select Xpdf's existing vendored IJG JPEG decoder branch.

The PNG-only regression independently exposed differences in Xpdf's separate
built-in DCT decoder. This uses existing upstream code and JPEG sources.
"""
import hashlib
from pathlib import Path
import sys

file = Path(sys.argv[1]) / "core/PdfFile/PdfFile.pro"
if hashlib.sha256(file.read_bytes()).hexdigest() != "8784ca3e10f0d3dd3807ec3fde936d74a787dcc349f001ce70b4668609fe028e":
    raise ValueError("Unexpected upstream PDF-reader build recipe")
text = file.read_text(encoding="utf-8")
text += "\n# Use the existing IJG decoder; avoid another implementation's DCT/upsampling changes.\nDEFINES += HAVE_JPEGLIB=1\nINCLUDEPATH += $$PWD/../DesktopEditor/cximage/jpeg\n"
file.write_bytes(text.encode("utf-8"))
file = Path(sys.argv[1]) / "core/PdfFile/lib/xpdf/Stream.h"
if hashlib.sha256(file.read_bytes()).hexdigest() != "b2bff229aec5fcd62a9b271dc072f37cddbcaa351d0094c1189e729a78eebb9f":
    raise ValueError("Unexpected upstream JPEG-reader header")
text = file.read_text(encoding="utf-8")
# IJG's private long typedef collides with the application's int INT32 name.
# A scoped alias preserves the original IJG type/ABI without a global guard.
text = text.replace("#include <jpeglib.h>", "#define INT32 JPEG_INT32\n#include <jpeglib.h>\n#undef INT32")
file.write_bytes(text.encode("utf-8"))
