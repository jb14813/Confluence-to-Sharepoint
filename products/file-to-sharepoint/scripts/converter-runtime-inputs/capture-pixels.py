"""TEST ONLY: capture public IImageStorage input before upstream export.

Use with the original upstream ImageManager.cpp/h, not patch-images output.
The probe copies BGRA bytes; it contains no PDF/JPEG decoder or image encoder.
An Emscripten FS marker /capture-pixels enables it. Without the marker, the
original exporter runs unchanged, permitting a failing baseline comparison.
"""
from pathlib import Path
import hashlib
import sys

root = Path(sys.argv[1]) / 'core'
manager = root / 'DocxRenderer/src/logic/managers'
file = manager / 'ImageManager.cpp'
original = file.read_bytes()
if hashlib.sha256(original).hexdigest() != '46a7c8ee69ece0aef93aea3af55b7b057e22d6ef36365035abddb3fdcd7dc914':
    raise ValueError('Capture requires unchanged upstream exporter')
capture = r'''
// Test-only observer of the public storage boundary, before any encoding.
#include <cstdio>
namespace NSDocxRenderer
{
class CPixelCaptureStorage : public IImageStorage
{
    IImageStorage* delegate;
    unsigned int nextId = 0;
public:
    CPixelCaptureStorage() : delegate(CreateWasmImageStorage()) {}
    ~CPixelCaptureStorage() { delete delegate; }
    std::shared_ptr<CImageInfo> GenerateImageID(Aggplus::CImage* image) override
    {
        unsigned int id = ++nextId;
        long stride = image->GetStride();
        unsigned int width = image->GetWidth(), height = image->GetHeight();
        std::string base = "/captured-image-" + std::to_string(id);
        FILE* meta = std::fopen((base + ".json").c_str(), "wb");
        std::fprintf(meta, "{\"width\":%u,\"height\":%u,\"stride\":%ld}", width, height, stride);
        std::fclose(meta);
        FILE* raw = std::fopen((base + ".bgra").c_str(), "wb");
        std::fwrite(image->GetData(), 1, (stride < 0 ? -stride : stride) * height, raw);
        std::fclose(raw);
        return delegate->GenerateImageID(image);
    }
    std::string* GetBase64(const int& id) override { return delegate->GetBase64(id); }
};
IImageStorage* CreatePixelCaptureStorage() { return new CPixelCaptureStorage(); }
}
'''
file.write_bytes(original + capture.encode())
file = manager / 'ExternalImageStorage.h'
text = file.read_text().replace('IImageStorage* CreateWasmImageStorage();', 'IImageStorage* CreateWasmImageStorage();\n\tIImageStorage* CreatePixelCaptureStorage();')
file.write_bytes(text.encode())
file = root / 'X2tConverter/src/lib/pdf_image.h'
text = file.read_text()
needle = 'CDocxRenderer oDocxRenderer(pApplicationFonts);'
if text.count(needle) != 1:
    raise ValueError('Unexpected PDF-to-Docx renderer construction')
text = text.replace(needle, needle + '\n\t\t\t\t\tif (NSFile::CFileBinary::Exists(L"/capture-pixels"))\n\t\t\t\t\t\toDocxRenderer.SetExternalImageStorage(NSDocxRenderer::CreatePixelCaptureStorage());')
file.write_bytes(text.encode())
