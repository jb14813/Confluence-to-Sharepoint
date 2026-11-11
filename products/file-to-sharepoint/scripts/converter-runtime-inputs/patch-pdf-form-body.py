"""Keep Widget appearances out of DOCX body when fields are reconstructed separately."""
from pathlib import Path
import difflib, hashlib, sys

root=Path(sys.argv[1])
pins={
    'PdfFile/lib/xpdf/OutputDev.h':{'cb54fa4b3b61d9b41f43f0fcb9b7202ed2d17de2fe109e494c8a5d243e350746'},
    'PdfFile/lib/xpdf/Page.cc':{'a640abcadb589fd20b8f2f61ba52a96255b11787e24c5d85842d4bd3bf9bbaa4'},
    'PdfFile/SrcReader/RendererOutputDev.h':{
        'ce1086c85a793a1b173450881a6d8b8052612b55f4b38a520e8daac20eaf1bb1',
        'd94f36a91e34c49cbdc1909aa56f171cc8e1a41096ee82b738955c5ec94da7f3',
        '5f4f48054ee96786d72fda219023f04686d9ced8d78945924ea357c0c805e82d'},
    'PdfFile/SrcReader/RendererOutputDev.cpp':{
        '9872c4b17552f3119a3caee89449670d8fc4af3da69b1fb134d2a2966172c147',
        '823c28fc8999b7898031f9918f229856c0a0cc7a64b20417965a673337c09a42',
        '2cdd17469051d1b5d43b733af77ae49e9eb116a3d17cabd148c4159f9a2f2143'},
}
originals={};hashes={}
for name,expected in pins.items():
    value=(root/'core'/name).read_bytes()
    hashes[name]=hashlib.sha256(value).hexdigest()
    if hashes[name]not in expected:raise ValueError('Unexpected pinned Widget body source: '+name)
    originals[name]=value.decode('utf-8')
rendererPair=(hashes['PdfFile/SrcReader/RendererOutputDev.h'],hashes['PdfFile/SrcReader/RendererOutputDev.cpp'])
if rendererPair not in {
    ('ce1086c85a793a1b173450881a6d8b8052612b55f4b38a520e8daac20eaf1bb1','9872c4b17552f3119a3caee89449670d8fc4af3da69b1fb134d2a2966172c147'),
    ('d94f36a91e34c49cbdc1909aa56f171cc8e1a41096ee82b738955c5ec94da7f3','823c28fc8999b7898031f9918f229856c0a0cc7a64b20417965a673337c09a42'),
    ('5f4f48054ee96786d72fda219023f04686d9ced8d78945924ea357c0c805e82d','2cdd17469051d1b5d43b733af77ae49e9eb116a3d17cabd148c4159f9a2f2143')}:
    raise ValueError('Mixed native RendererOutputDev source variants')
modified=dict(originals)
def replace(name,before,after):
    if modified[name].count(before)!=1:raise ValueError('Expected unique Widget body source anchor: '+name)
    modified[name]=modified[name].replace(before,after)

output='PdfFile/lib/xpdf/OutputDev.h'
replace(output,'class GString;','class Annot;\nclass GString;')
anchor='  virtual GBool needNonText() { return gTrue; }'
replace(output,anchor,anchor+'''

  // Default visual rendering remains unchanged.
  virtual GBool shouldDrawAnnotation(Annot *annotation) { return gTrue; }
  virtual GBool shouldDrawFormFields() { return gTrue; }''')
page='PdfFile/lib/xpdf/Page.cc'
replace(page,'\tsType = annotList->getAnnot(i)->getType();',
        '\tif (!out->shouldDrawAnnotation(annotList->getAnnot(i))) continue;\n\tsType = annotList->getAnnot(i)->getType();')
replace(page,'  if (globalParams->getDrawFormFields()) {',
        '  if (globalParams->getDrawFormFields() && out->shouldDrawFormFields()) {')
header='PdfFile/SrcReader/RendererOutputDev.h'
visual='!m_bDrawOnlyText && c_nDocxWriter != m_lRendererType'
if 'm_pDocxTransparencyTarget' in modified[header]:visual+=' && NULL == m_pDocxTransparencyTarget'
anchor='\t\tvirtual GBool interpretType3Chars() override'
replace(header,anchor,'''		GBool shouldDrawAnnotation(Annot* annotation) override;
		GBool shouldDrawFormFields() override
		{
			return VISUAL_BODY_RENDERER;
		}

'''.replace('VISUAL_BODY_RENDERER',visual)+anchor)
cpp='PdfFile/SrcReader/RendererOutputDev.cpp'
replace(cpp,'#include "../lib/xpdf/Page.h"','#include "../lib/xpdf/Page.h"\n#include "../lib/xpdf/Annot.h"')
anchor='\tGBool RendererOutputDev::beginType3Char('
replace(cpp,anchor,'''	GBool RendererOutputDev::shouldDrawAnnotation(Annot* annotation)
	{
		if (VISUAL_BODY_RENDERER) return gTrue;
		GString* type = annotation ? annotation->getType() : NULL;
		return type && type->cmp("Widget") != 0;
	}

'''.replace('VISUAL_BODY_RENDERER',visual)+anchor)
changes=[]
for name,source in modified.items():
    (root/'core'/name).write_bytes(source.encode('utf-8'))
    changes.extend(difflib.unified_diff(originals[name].splitlines(True),source.splitlines(True),fromfile='a/core/'+name,tofile='b/core/'+name))
(root/'pdf-widget-body.patch').write_text(''.join(changes),encoding='utf-8')
print('Patched text/DOCX Widget body rendering; FreeText and visual defaults retained',flush=True)
