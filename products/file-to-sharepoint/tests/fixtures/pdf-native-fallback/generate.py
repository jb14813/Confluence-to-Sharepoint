"""Public authored fixtures; regenerate with ReportLab 4.4.5.

The crossing paragraph cannot belong to one closed native table cell. Strict
request2 must refuse; request3/native PlainParagraph4 keeps the editable text
and all original grid drawings. Multiply remains unsupported in both modes.
No real document, converted output, or private corpus is embedded here.
"""
from pathlib import Path
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent


def document(name):
    pdf = canvas.Canvas(str(ROOT / name), pagesize=(300, 240),
                        invariant=1, pageCompression=0)
    pdf.setTitle("Public native paragraph fallback regression")
    pdf.setAuthor("SharePoint Helper tests")
    pdf.setFont("Helvetica", 12)
    return pdf


pdf = document("crossing-cell.pdf")
pdf.drawString(20, 220, "Editable native fallback")
pdf.setLineWidth(1)
pdf.rect(30, 90, 120, 100, fill=0, stroke=1)
pdf.rect(150, 90, 120, 100, fill=0, stroke=1)
pdf.drawString(115, 165, "Crossing source cell boundary")
pdf.drawString(40, 115, "Lower editable paragraph")
pdf.save()

pdf = document("unsupported-blend.pdf")
pdf.drawString(20, 220, "Unsupported blend must remain refused")
pdf.setBlendMode("Multiply")
pdf.setFillColorRGB(0.2, 0.4, 0.8)
pdf.rect(40, 80, 160, 100, fill=1, stroke=0)
pdf.save()
