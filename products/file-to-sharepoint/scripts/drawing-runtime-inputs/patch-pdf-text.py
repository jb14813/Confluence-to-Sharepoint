"""Add fail-closed source Unicode metadata using the existing native PDF reader."""
from pathlib import Path
import hashlib, shutil, sys, difflib, subprocess

root=Path(sys.argv[1])
recipe=Path(__file__).resolve().parent
subprocess.run([sys.executable,str(recipe/'patch-graphics-blend.py'),str(root)],check=True)
originals={}
def patch(relative,expected,anchor,replacement):
    file=root/'core'/relative
    original=file.read_bytes()
    if hashlib.sha256(original).hexdigest()!=expected:raise ValueError('Unexpected pinned PDF source: '+relative)
    text=original.decode('utf-8')
    originals[relative]=text
    if text.count(anchor)!=1:raise ValueError('Expected unique native capability insertion: '+relative)
    modified=text.replace(anchor,replacement);file.write_bytes(modified.encode('utf-8'))

patch('DesktopEditor/common/CalculatorCRC32.h','fa91df7b2fbdd3c23b27f4d6bb81f09f0c874dba8ee7c30f8acf07c6b193d199',
      'm_arCRCTable[255]','m_arCRCTable[256]')
patch('PdfFile/lib/xpdf/Gfx.cc','69e18426eb46f0374342ce04c3e99178e08756b5f160e8ad775d4a739234caca',
      '  while (markedContentStack->getLength() > 0) {\n    opEndMarkedContent(NULL, 0);',
      '  while (markedContentStack->getLength() > 0) {\n    GfxMarkedContent* pending = (GfxMarkedContent*)markedContentStack->get(markedContentStack->getLength() - 1);\n    if (pending->kind == gfxMCActualText) out->unclosedActualText(state);\n    opEndMarkedContent(NULL, 0);')
patch('PdfFile/lib/xpdf/OutputDev.h','cb54fa4b3b61d9b41f43f0fcb9b7202ed2d17de2fe109e494c8a5d243e350746',
      'class GString;','class Annot;\nclass GString;')
file=root/'core/PdfFile/lib/xpdf/OutputDev.h';text=file.read_text(encoding='utf-8')
anchor='  virtual GBool needNonText() { return gTrue; }'
assert text.count(anchor)==1
text=text.replace(anchor,anchor+'\n\n  // A reader may exclude annotation appearances without changing visual defaults.\n  virtual GBool shouldDrawAnnotation(Annot *annotation) { return gTrue; }')
anchor='  virtual void endActualText(GfxState *state) {}'
assert text.count(anchor)==1
text=text.replace(anchor,anchor+'\n  // Notify observers before native repair closes an unterminated source span.\n  virtual void unclosedActualText(GfxState *state) {}')
file.write_bytes(text.encode('utf-8'))
patch('PdfFile/lib/xpdf/CharCodeToUnicode.h','6c19b1d5c1b9a2e93a9987ad191e4e713ecb88a2294b930d031ca62912b4b299',
      '  int mapToUnicode(CharCode c, Unicode *u, int size);',
      '''  int mapToUnicode(CharCode c, Unicode *u, int size);

  // Audit only: preserve the original native decoder and visual mapping.
  GBool hasComplete8BitMappingSequence(CharCode c) const
    { return c < 256 && !incomplete8BitSequences[c]; }''')
file=root/'core/PdfFile/lib/xpdf/CharCodeToUnicode.h';text=file.read_text(encoding='utf-8')
anchor='  GString *tag;'
assert text.count(anchor)==1
text=text.replace(anchor,'  GBool incomplete8BitSequences[256] = {};\n'+anchor)
file.write_bytes(text.encode('utf-8'))
patch('PdfFile/lib/xpdf/CharCodeToUnicode.cc','c2a2056ff5c9adc08d9c7e096e106c414b5043cbb5a7cb0f989f15ab7707b01b',
      '#endif\n\n  if (code > 0xffffff) {\n    // This is an arbitrary limit',
      '''#endif

  // Mark incomplete UTF-16 code units without changing native decoding.
  if (code < 256 && (n <= 0 || n % 4 != 0)) incomplete8BitSequences[code] = gTrue;

  if (code > 0xffffff) {
    // This is an arbitrary limit''')
patch('PdfFile/lib/xpdf/Page.cc','a640abcadb589fd20b8f2f61ba52a96255b11787e24c5d85842d4bd3bf9bbaa4',
      '\tsType = annotList->getAnnot(i)->getType();',
      '\tif (!out->shouldDrawAnnotation(annotList->getAnnot(i))) continue;\n\tsType = annotList->getAnnot(i)->getType();')
reader=root/'core/PdfFile/PdfReader.cpp'
original=reader.read_bytes()
if hashlib.sha256(original).hexdigest()!='3710ed1dddcdec297cc689bce372f3c18b943c62071d423e42d816170cb50818':
    raise ValueError('Expected exact existing XFA/AcroForm capability patch before source-text patch')
source=original.decode('utf-8')
originals['PdfFile/PdfReader.cpp']=source
anchor='#include "lib/xpdf/TextOutputDev.h"'
assert source.count(anchor)==1
modified=source.replace(anchor,anchor+'\n#include "SrcReader/PdfTextCapabilities.h"')
anchor='\tstd::wstring version = std::to_wstring(pDoc->getPDFVersion());'
assert modified.count(anchor)==1
capabilities='''\tPdfReader::SourceText::Result sourceText;
\tif (bHasXFA || nAcroFormFieldCount < 0)
\t\tsourceText.complete = false;
\telse
\t{
\t\tPdfReader::SourceText::ScopedSettings settings(globalParams);
\t\tfor (CPdfReaderContext* context : m_vPDFContext)
\t\t{
\t\t\tPdfReader::SourceText::ScanDocument(context ? context->m_pDocument : NULL, sourceText);
\t\t\tif (sourceText.truncated) break;
\t\t}
\t\tif (sourceText.pages.size() != static_cast<size_t>(GetNumPages())) sourceText.complete = false;
\t}
\tsRes += sourceText.JsonFields();

'''+anchor
modified=modified.replace(anchor,capabilities)
reader.write_bytes(modified.encode('utf-8'))
shutil.copyfile(recipe/'pdf-text-capabilities.h',root/'core/PdfFile/SrcReader/PdfTextCapabilities.h')
shutil.copyfile(recipe/'pdf-text-order.h',root/'core/PdfFile/SrcReader/PdfTextOrder.h')
shutil.copyfile(recipe/'pdf-capture-raster-density.h',root/'core/PdfFile/SrcReader/PdfCaptureRasterDensity.h')
shutil.copyfile(recipe/'pdf-actual-text-run.h',root/'core/PdfFile/SrcReader/PdfActualTextRun.h')
changes=[]
for relative,original in originals.items():
    modified=(root/'core'/relative).read_text(encoding='utf-8')
    changes.extend(difflib.unified_diff(original.splitlines(True),modified.splitlines(True),fromfile='a/core/'+relative,tofile='b/core/'+relative))
changes.extend(difflib.unified_diff([], (recipe/'pdf-text-capabilities.h').read_text(encoding='utf-8').splitlines(True),fromfile='/dev/null',tofile='b/core/PdfFile/SrcReader/PdfTextCapabilities.h'))
changes.extend(difflib.unified_diff([], (recipe/'pdf-text-order.h').read_text(encoding='utf-8').splitlines(True),fromfile='/dev/null',tofile='b/core/PdfFile/SrcReader/PdfTextOrder.h'))
changes.extend(difflib.unified_diff([], (recipe/'pdf-capture-raster-density.h').read_text(encoding='utf-8').splitlines(True),fromfile='/dev/null',tofile='b/core/PdfFile/SrcReader/PdfCaptureRasterDensity.h'))
changes.extend(difflib.unified_diff([], (recipe/'pdf-actual-text-run.h').read_text(encoding='utf-8').splitlines(True),fromfile='/dev/null',tofile='b/core/PdfFile/SrcReader/PdfActualTextRun.h'))
(root/'pdf-text-capabilities.patch').write_text(''.join(changes),encoding='utf-8')
print('Patched native source-text capability; existing XFA/AcroForm metadata retained',flush=True)
