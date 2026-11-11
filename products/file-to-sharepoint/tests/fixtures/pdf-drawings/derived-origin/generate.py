"""Independent, public test-only curved PDF; no private corpus content."""
from pathlib import Path
import hashlib,json
from reportlab.pdfgen import canvas
import fitz

root=Path(__file__).resolve().parent
source=root/'curve-control-min.source.pdf'
c=canvas.Canvas(str(source),pagesize=(200,220),invariant=1,pageCompression=0)
c.setFont('Helvetica',12);c.drawString(30,190,'Before')
c.setFillColorRGB(0.1,0.4,0.9)
p=c.beginPath();p.moveTo(100,110);p.curveTo(80,140,120,160,130,130);p.lineTo(130,100);p.close()
c.drawPath(p,stroke=0,fill=1,fillMode=0)
c.drawString(30,60,'After');c.showPage();c.save()
with fitz.open(source) as pdf:
    pix=pdf[0].get_pixmap(matrix=fitz.Matrix(192/72,192/72),alpha=True)
    pix.save(root/'curve-control-min.source192dpi.png')
(root/'source-manifest.json').write_text(json.dumps({'scope':'Own independently authored evenodd cubic, no table, editable Before and After. Original control minimum extends beyond sampled curve bounds.','cases':[{'name':'curve-control-min','sourcePdfSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sourceRgbaSha256':hashlib.sha256(pix.samples).hexdigest()}]},indent=2)+'\n')
