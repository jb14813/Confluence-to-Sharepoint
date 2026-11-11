"""Own deterministic ReportLab PDF inputs; MuPDF is an independent 192 dpi reference.

These are noncell figures, with real W/W* rectangular clips. The curve's
control minimum is outside its sampled painted bounds. Touching uses that exact
control minimum and can correctly leave visible pixels unchanged.
"""
from pathlib import Path
import hashlib,json
from reportlab.pdfgen import canvas
import fitz
root=Path(__file__).resolve().parent
rows=[]
def write(name,shape,relation,mode,clipped):
    filename=root/(name+('.source.pdf' if clipped else '.unclipped.pdf'))
    c=canvas.Canvas(str(filename),pagesize=(200,220),invariant=1,pageCompression=0)
    c.setFont('Helvetica',12);c.drawString(30,190,'Before');c.saveState()
    left=100 if relation=='crossing' else (60 if shape=='curve' else 80)
    if clipped:
        clip=c.beginPath();clip.rect(left,90,150-left,70);c.clipPath(clip,stroke=0,fill=0,fillMode=mode)
    c.setFillColorRGB(0.1,0.4,0.9)
    if shape=='alpha':c.setFillAlpha(0.5)
    p=c.beginPath()
    if shape=='curve':
        p.moveTo(80,100);p.curveTo(60,110,100,150,130,130);p.lineTo(130,100);p.close()
    elif shape=='star':
        p.moveTo(105,145)
        for point in [(120,100),(80,130),(130,130),(90,100)]:p.lineTo(*point)
        p.close()
    else:
        p.rect(80,100,50,35);p.rect(95,110,20,15)
    c.drawPath(p,stroke=0,fill=1,fillMode=0)
    c.restoreState();c.drawString(30,60,'After');c.showPage();c.save()
    return filename
for shape in ['hole','star','alpha','curve']:
    for relation in ['crossing','touching']:
        for mode in [0,1]:
            name=f'{shape}-{relation}-mode{mode}'
            source=write(name,shape,relation,mode,True);plain=write(name,shape,relation,mode,False)
            refs=[]
            for filename,suffix in [(source,'.source192dpi.png'),(plain,'.unclipped192dpi.png')]:
                with fitz.open(filename)as pdf:
                    pix=pdf[0].get_pixmap(matrix=fitz.Matrix(192/72,192/72),alpha=True)
                    pix.save(root/(name+suffix));refs.append(pix.samples)
            unchanged=refs[0]==refs[1]
            assert unchanged==(relation=='touching'),name
            rows.append({'name':name,'shape':shape,'relation':relation,'sourcePdfSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'reportlabClipFillMode':mode,'clipNativeMode':1-mode,'sourceClipPixelsUnchanged':unchanged,'sourceRgbaSha256':hashlib.sha256(refs[0]).hexdigest(),'unclippedRgbaSha256':hashlib.sha256(refs[1]).hexdigest()})
(root/'source-manifest.json').write_text(json.dumps({'scope':'Own authored noncell W/W* PDFs; no tenant or private corpus content. MuPDF independent source and unclipped renders at192dpi.','cases':rows},indent=2)+'\n')
