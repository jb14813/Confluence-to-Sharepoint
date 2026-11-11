"""Select upstream lossless PNG output without resizing reconstructed rasters.

This patches only the pinned renderer's export policy. Existing PDF decoders,
orientation/alpha handling, PNG encoder and application resource limits remain.
"""
import hashlib
from pathlib import Path
import sys

root = Path(sys.argv[1])
directory = root / "core/DocxRenderer/src/logic/managers"
pins = {"ImageManager.cpp": "46a7c8ee69ece0aef93aea3af55b7b057e22d6ef36365035abddb3fdcd7dc914", "ImageManager.h": "31a9419cd7ab91faf438f5d015c4ff3f00296cc08f592dbf70d4fa419c64f24d"}
for name, pin in pins.items():
    if hashlib.sha256((directory / name).read_bytes()).hexdigest() != pin:
        raise ValueError("Unexpected upstream renderer source: " + name)

file = directory / "ImageManager.cpp"
text = file.read_text(encoding="utf-8")
text = text.replace("\t\tint m_lMaxSizeImage{1200};\n", "")
text = text.replace("\t\tm_lMaxSizeImage = 1200;\n", "")
start = text.index("\t\t\tbool bIsResized = false;")
end = text.index("\t\t\tBYTE* pEncodeBuffer", start)
text = text[:start] + text[end:]
text = text.replace("\t\t\tif (!bIsResized)\n\t\t\t\toBgraFrame.put_Data(NULL);", "\t\t\toBgraFrame.put_Data(NULL);")
start = text.index("\t\tif (width <= m_lMaxSizeImage")
end = text.index("\t\tm_mapImageData.insert", start)
text = text[:start] + "\t\tpImage->SaveFile(saved_file, format);\n" + text[end:]
start = text.index("\tCImageInfo::ImageType CImageManager::GetImageType(")
end = text.index("\n\tvoid CImageManager::FlipY", start)
text = text[:start] + "\tCImageInfo::ImageType CImageManager::GetImageType(Aggplus::CImage* pFrame)\n\t{\n\t\t// Preserve decoded pixels for opaque and transparent PDF rasters alike.\n\t\t(void)pFrame;\n\t\treturn CImageInfo::itPNG;\n\t}\n" + text[end:]
if "m_lMaxSizeImage" in text or "bIsResized" in text or ".Resize(" in text:
    raise ValueError("Unexpected remaining renderer resampling policy")
file.write_bytes(text.encode("utf-8"))
file = directory / "ImageManager.h"
text = file.read_text(encoding="utf-8").replace("\t\tint m_lMaxSizeImage {1200};\n", "")
if "m_lMaxSizeImage" in text:
    raise ValueError("Unexpected remaining renderer size cap")
file.write_bytes(text.encode("utf-8"))
