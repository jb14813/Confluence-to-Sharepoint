"""Route semantic Type3 through existing Xpdf text and native Base14 font APIs."""
from pathlib import Path
import hashlib, difflib, sys

root=Path(sys.argv[1])
header=root/'core/PdfFile/SrcReader/RendererOutputDev.h'
cpp=root/'core/PdfFile/SrcReader/RendererOutputDev.cpp'
originals={header:header.read_bytes(),cpp:cpp.read_bytes()}
expected={header:'144cf291ba946563294802071697b7dc1b358a460f4ba466643706884904286b',cpp:'0a1f3ac5b2b21f6ef748f261fd2e29485096e5c763809a5d226df7e54ecdb0cf'}
for file,original in originals.items():
    if hashlib.sha256(original).hexdigest()!=expected[file]:raise ValueError('Unexpected pinned Type3 source: '+str(file))
headerText=originals[header].decode('utf-8')
headerAnchor='\t\tvirtual GBool interpretType3Chars() override\n\t\t{\n\t\t\treturn true;\n\t\t}'
if headerText.count(headerAnchor)!=1:raise ValueError('Type3 routing source changed')
headerText=headerText.replace(headerAnchor,'\t\tvirtual GBool interpretType3Chars() override\n\t\t{\n\t\t\treturn !m_bDrawOnlyText && c_nDocxWriter != m_lRendererType;\n\t\t}')
cppText=originals[cpp].decode('utf-8')
anchor='\t\tGetFont(m_pXref, m_pFontManager, m_pFontList, pFont, wsFileName, wsFontName, false);\n\n\t\tif (!wsFileName.empty())'
if cppText.count(anchor)!=1:raise ValueError('Type3 font update source changed')
replacement='''		GetFont(m_pXref, m_pFontManager, m_pFontList, pFont, wsFileName, wsFontName, false);

		// Semantic Type3 has Unicode but no ordinary font file.
		// Reuse the existing built-in Base14 bytes for text reconstruction only.
		// Leave the normal visual Type3 path and raw Unicode/GID arrays unchanged.
		if (fontType3 == pFont->getType() &&
			(m_bDrawOnlyText || c_nDocxWriter == m_lRendererType) && wsFileName.empty())
		{
			const BYTE* pData14 = NULL;
			unsigned int nSize14 = 0;
			if (PdfReader::GetBaseFont(L"Helvetica", pData14, nSize14))
			{
#ifndef FONTS_USE_ONLY_MEMORY_STREAMS
				std::wstring wsTempFileName;
				FILE* pFile = NULL;
				if (NSFile::CFileBinary::OpenTempFile(&wsTempFileName, &pFile, L"wb", L".base",
					(wchar_t*)((GlobalParamsAdaptor*)globalParams)->GetTempFolder().c_str(), NULL))
				{
					fclose(pFile);
					NSFile::CFileBinary oFile;
					if (oFile.CreateFileW(wsTempFileName))
					{
						oFile.WriteFile((BYTE*)pData14, nSize14);
						oFile.CloseFile();
						wsFileName = wsTempFileName;
					}
				}
#else
				CMemoryFontStream oMemoryFontStream;
				oMemoryFontStream.fromBuffer((BYTE*)pData14, nSize14);
				wsFileName = L"Helvetica";
				NSFonts::NSApplicationFontStream::GetGlobalMemoryStorage()->Add(wsFileName,
					oMemoryFontStream.m_pData, (LONG)oMemoryFontStream.m_nSize, true);
#endif
				if (!wsFileName.empty())
				{
					wsFontName = L"Helvetica";
					TFontEntry* pEntry = NULL;
					if (m_pFontList->Find2(*pFont->getID(), &pEntry) && pEntry)
					{
						pEntry->wsFilePath = wsFileName;
						pEntry->wsFontName = wsFontName;
						pEntry->bFontSubstitution = true;
					}
				}
			}
		}

		if (!wsFileName.empty())'''
cppText=cppText.replace(anchor,replacement)
header.write_bytes(headerText.encode('utf-8'));cpp.write_bytes(cppText.encode('utf-8'))
changes=[]
for file,original in originals.items():
    relative=file.relative_to(root).as_posix()
    changes.extend(difflib.unified_diff(original.decode('utf-8').splitlines(True),file.read_text(encoding='utf-8').splitlines(True),fromfile='a/'+relative,tofile='b/'+relative))
(root/'type3-editable-text.patch').write_text(''.join(changes),encoding='utf-8')
print('Patched existing native Type3 text routing and Base14 fallback',flush=True)
