"""Own, test-only PDF inputs; ReportLab is not part of product conversion."""
from pathlib import Path
import hashlib,json,math
from reportlab.pdfgen import canvas
import fitz

root=Path(__file__).resolve().parent
rows=[]
def write(name,mode,clipped):
    filename=root/(name+('.source.pdf' if clipped else '.unclipped.pdf'))
    c=canvas.Canvas(str(filename),pagesize=(200,220),invariant=1,pageCompression=0)
    c.setFont('Helvetica',12);c.drawString(30,190,'Before')
    c.saveState()
    if clipped:
        p=c.beginPath();p.rect(70,90,80,70);c.clipPath(p,stroke=0,fill=0,fillMode=mode)
    c.setFillColorRGB(0.1,0.4,0.9)
    if name.startswith('alpha'):c.setFillAlpha(0.5)
    p=c.beginPath()
    if name.startswith('star'):
        points=[(105+25*math.sin(i*4*math.pi/5),122.5+22.5*math.cos(i*4*math.pi/5))for i in range(5)]
        p.moveTo(*points[0])
        for point in points[1:]:p.lineTo(*point)
        p.close()
    else:
        p.rect(80,100,50,35);p.rect(95,110,20,15)
    c.drawPath(p,stroke=0,fill=1,fillMode=0)
    c.restoreState();c.drawString(30,60,'After');c.showPage();c.save()
    return filename
for shape in ['hole','star','alpha']:
    for mode in [0,1]:
        name=f'{shape}-mode{mode}'
        source=write(name,mode,True);plain=write(name,mode,False)
        with fitz.open(source)as pdf:pix=pdf[0].get_pixmap(matrix=fitz.Matrix(192/72,192/72),alpha=True);rgba=pix.samples;pix.save(root/(name+'.source192dpi.png'))
        with fitz.open(plain)as pdf:baseline=pdf[0].get_pixmap(matrix=fitz.Matrix(192/72,192/72),alpha=True).samples
        assert rgba==baseline,name
        rows.append({'name':name,'sourcePdfSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'reportlabClipFillMode':mode,'clipNativeMode':1-mode,'sourceClipPixelsUnchanged':True,'sourceRgbaSha256':hashlib.sha256(rgba).hexdigest()})
(root/'source-manifest.json').write_text(json.dumps({'scope':'Own authored PDFs. Genuine native/Reader/SDK exports are separately pinned. No table, no private corpus content.','cases':rows},indent=2)+'\n')
