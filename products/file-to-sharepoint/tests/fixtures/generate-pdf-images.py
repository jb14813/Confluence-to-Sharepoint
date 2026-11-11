"""Regenerate synthetic image/PDF regression fixtures; no user documents.

Reference environment: Pillow 12.0.0, pypdf 4.2.0, ReportLab 4.4.5.
Generated JSON is committed; Python is not a runtime/test-suite dependency.
ReportLab embeds source image data, then pypdf independently extracts its image
and soft mask for the reference. No PDF parsing is implemented by this project.
"""

import base64,io,json,hashlib
from pathlib import Path
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader
out=Path(__file__).resolve().parent
records=[]
for name,size,alpha,jpeg in [('opaque',(100,50),False,False),('large',(1601,1237),False,False),('alpha',(128,64),True,False),('jpeg',(160,96),False,True),('jpeg-subsampled',(160,96),False,True),('jpeg-progressive',(160,96),False,True),('jpeg-gray',(160,96),False,True),('jpeg-cmyk',(160,96),False,True)]:
 w,h=size
 image=Image.new('RGBA' if alpha else 'RGB',size)
 pixels=image.load()
 for y in range(h):
  for x in range(w):
   if alpha:
    # Primary colours and four alpha levels exercise an actual PDF soft mask.
    rgb=((255 if x%4<2 else 0),(255 if y%4<2 else 0),128)
    pixels[x,y]=rgb+((0,85,170,255)[(x//16+y//16)%4],)
   else:
    pixels[x,y]=((x//7*31+y//11*17)%256,(x//13*71+y//5*19)%256,(x//17*13+y//3*43)%256)
 if name=='jpeg-gray':image=image.convert('L')
 elif name=='jpeg-cmyk':image=image.convert('CMYK')
 options={'quality':86,'subsampling':2 if name=='jpeg-subsampled' else 0} if jpeg else {}
 if name=='jpeg-progressive':options['progressive']=True
 buf=io.BytesIO();image.save(buf,format='JPEG' if jpeg else 'PNG',**options);image_bytes=buf.getvalue()
 pdf=io.BytesIO();c=canvas.Canvas(pdf,pagesize=(600,800),invariant=1,pageCompression=1);c.setFont('Helvetica',12);c.drawString(32,760,'Editable PDF image fidelity: '+name);c.drawImage(ImageReader(io.BytesIO(image_bytes)),32,350,width=500,height=350,mask='auto');c.save();pdf_bytes=pdf.getvalue()
 # pypdf's high-level ImageFile.data/image serializes JPEG again. Using those
 # would make a degraded reference! Its stream API leaves the DCT bytes intact.
 page=PdfReader(io.BytesIO(pdf_bytes)).pages[0]
 objects=[ref.get_object() for ref in page['/Resources']['/XObject'].values()]
 objects=[obj for obj in objects if obj['/Subtype']=='/Image'];assert len(objects)==1
 if jpeg:
  stream=objects[0].get_data();assert stream==image_bytes
  original=Image.open(io.BytesIO(stream)).convert('RGBA')
 else:
  embedded=list(page.images);assert len(embedded)==1
  original=Image.open(io.BytesIO(embedded[0].data)).convert('RGBA')
 assert original.size==size
 expected=io.BytesIO();original.save(expected,format='PNG')
 record={'name':'image-'+name+'.pdf','pdf':base64.b64encode(pdf_bytes).decode(),'original':base64.b64encode(expected.getvalue()).decode(),'compressedOriginal':base64.b64encode(image_bytes).decode(),'originalMime':'image/jpeg' if jpeg else 'image/png','width':w,'height':h,'rgbaSha256':hashlib.sha256(original.tobytes()).hexdigest(),'sourceImage':{'streamSha256':hashlib.sha256(objects[0].get_data()).hexdigest(),'colorSpace':str(objects[0]['/ColorSpace']),'decode':list(objects[0].get('/Decode',[]))}}
 if name in ('opaque','jpeg-cmyk'):
  raster=io.BytesIO();rc=canvas.Canvas(raster,pagesize=size,invariant=1,pageCompression=1);rc.drawImage(ImageReader(io.BytesIO(image_bytes)),0,0,width=w,height=h,mask='auto');rc.save();raster_bytes=raster.getvalue()
  reference_page=PdfReader(io.BytesIO(raster_bytes)).pages[0]
  reference_object=next(ref.get_object() for ref in reference_page['/Resources']['/XObject'].values() if ref.get_object()['/Subtype']=='/Image')
  assert reference_object.get_data()==objects[0].get_data()
  assert reference_object['/ColorSpace']==objects[0]['/ColorSpace'] and reference_object.get('/Decode')==objects[0].get('/Decode')
  record['imageOnlyPdf']=base64.b64encode(raster_bytes).decode()
 if name=='jpeg-cmyk':record['referencePolicy']='pdf-display-pending'
 records.append(record)
(out/'pdf-images.json').write_text(json.dumps(records,indent=2)+'\n',encoding='utf-8')
print([(r['name'],len(r['pdf']),r['width'],r['height']) for r in records])
