from pathlib import Path
import io,json,hashlib
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image
from pypdf import PdfReader,PdfWriter
base=Path(__file__).resolve().parent;base.mkdir(parents=True,exist_ok=True)
source=base.parent/'native056-v2/alpha-gap.source.pdf';page=PdfReader(source).pages[0];w=float(page.mediabox.width);h=float(page.mediabox.height)
png=io.BytesIO();im=Image.new('RGB',(32,16),(20,90,200));im.paste((245,190,25),(16,0,32,16));im.save(png,format='PNG');overlay=io.BytesIO();c=canvas.Canvas(overlay,pagesize=(w,h),invariant=1,pageCompression=0);c.drawImage(ImageReader(io.BytesIO(png.getvalue())),250,100,32,16);c.showPage();c.save();first=PdfReader(io.BytesIO(overlay.getvalue())).pages[0];page.merge_page(first);writer=PdfWriter();writer.add_page(page)
out=base/'bitmap-right-cell.source.pdf'
with out.open('wb')as f:writer.write(f)
(base/'source-origin.json').write_text(json.dumps({'scope':'Authored public source: existing public alpha-gap PDF merged before a new bitmap inside its right cell after its label; no private corpus. No SDK/native metadata edits.','original':'../native056-v2/alpha-gap.source.pdf','originalSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'outputSha256':hashlib.sha256(out.read_bytes()).hexdigest(),'bitmapPlacement':[250,100,32,16]},indent=2))
print('Generated authored public PDF',w,h)
