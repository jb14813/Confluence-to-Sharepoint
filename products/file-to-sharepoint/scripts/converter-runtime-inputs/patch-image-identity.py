"""Verify dimensions and immutable decoded pixels before reusing native assets."""
from pathlib import Path
import difflib,hashlib,shutil,sys
root=Path(sys.argv[1]);recipe=Path(__file__).resolve().parent
pins={
    'DocxRenderer/src/logic/managers/ImageManager.cpp':'32f6a502558b4e6f19987cbf0d91031d62772e4b2643eb8615a792665172e9e1',
    'DocxRenderer/src/logic/managers/ImageManager.h':'f627a41842c611e94c12ccc5bf4ea3384e56bfb99dcd7daea513c21dc1e5ebf6',
    'DesktopEditor/common/CalculatorCRC32.h':'42dbe345415f1843356bbd7d10d700590f21beaea40a749539ccea0b5a111946',
}
originals={}
for name,pin in pins.items():
    value=(root/'core'/name).read_bytes()
    if hashlib.sha256(value).hexdigest()!=pin:raise ValueError('Unexpected pinned native image identity source: '+name)
    originals[name]=value.decode('utf-8')
modified=dict(originals)
def replace(name,before,after,count=1):
    if modified[name].count(before)!=count:raise ValueError('Unexpected image identity anchor: '+name)
    modified[name]=modified[name].replace(before,after)
header='DocxRenderer/src/logic/managers/ImageManager.h';cpp='DocxRenderer/src/logic/managers/ImageManager.cpp'
replace(header,'#include <map>','#include <map>\n#include "PixelIdentityCache.h"')
replace(header,'\t\tCCalculatorCRC32 m_oCRC;',
        '\t\tCCalculatorCRC32 m_oCRC;\n\t\tCPixelIdentityCache<std::shared_ptr<CImageInfo>> m_pixelCache;')
replace(cpp,'\t\tCCalculatorCRC32 m_oCRC;',
        '\t\tCCalculatorCRC32 m_oCRC;\n\t\tCPixelIdentityCache<std::shared_ptr<CImageInfo>> m_pixelCache;')
replace(cpp,'\t\t\tauto find = m_mapImageData.find(dwSum);\n\t\t\tif (find != m_mapImageData.end())\n\t\t\t\treturn find->second;',
        '\t\t\tauto cached = m_pixelCache.Find(dwSum, nWidth, nHeight, nStride, pData, nSize);\n\t\t\tif (cached) return cached;')
replace(cpp,'\t\tauto find = m_mapImageData.find(sum);\n\t\tif (find != m_mapImageData.end())\n\t\t\treturn find->second;',
        '\t\tauto cached = m_pixelCache.Find(sum, width, height, stride, data, size);\n\t\tif (cached) return cached;')
replace(cpp,'\t\t\tm_mapImageData.insert(std::pair<DWORD, std::shared_ptr<CImageInfo>>(dwSum, pInfo));',
        '\t\t\tm_mapImageData.insert(std::pair<DWORD, std::shared_ptr<CImageInfo>>(static_cast<DWORD>(pInfo->m_nId), pInfo));\n\t\t\tm_pixelCache.Remember(dwSum, nWidth, nHeight, nStride, pData, nSize, pInfo);')
replace(cpp,'\t\tm_mapImageData.insert(std::pair<DWORD, std::shared_ptr<CImageInfo>>(sum, pInfo));',
        '\t\tm_mapImageData.insert(std::pair<DWORD, std::shared_ptr<CImageInfo>>(static_cast<DWORD>(pInfo->m_nId), pInfo));\n\t\tm_pixelCache.Remember(sum, width, height, stride, data, size, pInfo);')
replace(cpp,'\t\tm_mapImageData.clear();','\t\tm_mapImageData.clear();\n\t\tm_pixelCache.clear();')
replace('DesktopEditor/common/CalculatorCRC32.h','m_arCRCTable[255]','m_arCRCTable[256]')
changes=[]
for name,source in modified.items():
    (root/'core'/name).write_bytes(source.encode('utf-8'))
    changes.extend(difflib.unified_diff(originals[name].splitlines(True),source.splitlines(True),fromfile='a/core/'+name,tofile='b/core/'+name))
shutil.copyfile(recipe/'pixel-identity-cache.h',root/'core/DocxRenderer/src/logic/managers/PixelIdentityCache.h')
changes.extend(difflib.unified_diff([], (recipe/'pixel-identity-cache.h').read_text(encoding='utf-8').splitlines(True),fromfile='/dev/null',tofile='b/core/DocxRenderer/src/logic/managers/PixelIdentityCache.h'))
(root/'pixel-identity-cache.patch').write_text(''.join(changes),encoding='utf-8')
print('Patched CRC table and verified native image cache identity; filenames retain unique generated IDs',flush=True)
