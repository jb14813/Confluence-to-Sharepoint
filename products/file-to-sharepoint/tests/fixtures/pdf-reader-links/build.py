"""Rebuild the small owned PDF annotation fixture with ReportLab."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image

output = Path(__file__).with_name('reader-links.pdf')
c = canvas.Canvas(str(output), pagesize=(420, 500), invariant=1)
c.setTitle('Native PDF link regression')
c.setAuthor('JZB Apps test fixtures')
c.setFont('Helvetica', 12)
c.drawString(30, 460, 'First page: editable PDF text.')
c.drawString(30, 420, 'External documentation')
c.linkURL('https://example.com/docs?one=1&two=2', (30, 416, 190, 434), relative=0)
c.drawString(30, 380, 'Go to the second page')
c.linkAbsolute('Second page', 'second', Rect=(30, 376, 190, 394))
c.drawString(30, 340, 'Unsupported action remains inert')
c.linkURL('javascript:alert(1)', (30, 336, 250, 354), relative=0)
c.showPage()
c.bookmarkPage('second')
c.setFont('Helvetica', 12)
c.drawString(30, 460, 'Second page target remains editable.')
c.save()

c = canvas.Canvas(str(output.with_name('image-only-link.pdf')), pagesize=(240, 200), invariant=1)
c.setTitle('Image-only PDF with a link')
c.setAuthor('JZB Apps test fixtures')
c.drawImage(ImageReader(Image.new('RGB', (2, 2), (32, 78, 140))), 30, 30, 180, 120)
c.linkURL('https://example.com/image-source', (30, 30, 210, 150), relative=0)
c.save()
