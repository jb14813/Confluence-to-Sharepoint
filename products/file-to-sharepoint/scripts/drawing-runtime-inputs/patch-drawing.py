from pathlib import Path
import json,sys,difflib,hashlib,subprocess
root=Path(sys.argv[1]);work=root/'core/DesktopEditor/graphics/pro/js'
recipe=json.loads((work/'drawingfile.json').read_text())
assert 'USE_OPENSSL_HASH' in recipe['define']
recipe['define'].remove('USE_OPENSSL_HASH')
recipe['include_path']=[p for p in recipe['include_path'] if '/openssl/' not in p]
recipe['asm']=False
recipe['run_before']='before-no-openssl.py'
recipe['run_after']='after-no-openssl.py'
(work/'drawingfile-no-openssl.json').write_text(json.dumps(recipe,indent=2)+'\n')
before=(work/'before.py').read_text()
lines=before.splitlines(keepends=True)
assert sum('/openssl/' in line for line in lines)==1
(work/'before-no-openssl.py').write_text(''.join(line for line in lines if '/openssl/' not in line))
after=(work/'after.py').read_text().split('content_native_files =')[0]
after=''.join(line for line in after.splitlines(keepends=True) if '/openssl/' not in line and 'drawingfile_ie.js' not in line and 'base.cmd_in_dir' not in line)
# The original final Closure invocation is WHITESPACE_ONLY. Retain readable
# generated JS and its upstream legal header instead of requiring Java.
after+='\nbase.writeFile("./deploy/drawingfile.js", base.readFile("../../../../Common/license/header.license") + base.readFile("./deploy/drawingfile.js"))\n'
(work/'after-no-openssl.py').write_text(after)

# Report form capabilities from the existing parsed PDF catalog. Guard the
# publisher source so a source update cannot silently move this insertion.
reader=root/'core/PdfFile/PdfReader.cpp'
original=reader.read_bytes()
assert hashlib.sha256(original).hexdigest() == '0efe8a3f1bc9a8a7d88ae85f98ea8a44a8c12d945e86ee870325be1a80b25136'
source=original.decode('utf-8')
anchor='\toInfo.free();\n\n\tstd::wstring version = std::to_wstring(pDoc->getPDFVersion());'
capabilities='''\toInfo.free();

\tbool bHasXFA = false;
\tint nAcroFormFieldCount = -1;
\tCatalog* pCatalog = pDoc->getCatalog();
\tObject* pAcroForm = pCatalog ? pCatalog->getAcroForm() : NULL;
\tif (pAcroForm && pAcroForm->isNull())
\t\tnAcroFormFieldCount = 0;
\telse if (pAcroForm && pAcroForm->isDict())
\t{
\t\tObject oXFA, oFields;
\t\tpAcroForm->dictLookup("XFA", &oXFA);
\t\tbHasXFA = !oXFA.isNull();
\t\tif (pAcroForm->dictLookup("Fields", &oFields)->isArray())
\t\t\tnAcroFormFieldCount = oFields.arrayGetLength();
\t\toFields.free();
\t\toXFA.free();
\t}
\tsRes += L"\\"HasXFA\\":";
\tsRes += bHasXFA ? L"true" : L"false";
\tsRes += L",\\"AcroFormFieldCount\\":";
\tsRes += std::to_wstring(nAcroFormFieldCount);
\tsRes += L",";

\tstd::wstring version = std::to_wstring(pDoc->getPDFVersion());'''
assert source.count(anchor) == 1
modified=source.replace(anchor,capabilities)
reader.write_bytes(modified.encode('utf-8'))
(root/'pdf-capabilities.patch').write_bytes(''.join(difflib.unified_diff(
    source.splitlines(keepends=True),modified.splitlines(keepends=True),
    fromfile='a/core/PdfFile/PdfReader.cpp',tofile='b/core/PdfFile/PdfReader.cpp')).encode('utf-8'))

# The source-text observer uses the same established reader and preserves the
# form-capability insertion above byte-for-byte before adding separate metadata.
subprocess.run([sys.executable,str(Path(__file__).with_name('patch-pdf-text.py')),str(root)],check=True)
subprocess.run([sys.executable,str(Path(__file__).with_name('patch-pdf-font-metrics.py')),str(root)],check=True)
