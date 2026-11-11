"""Compare native PNG to independent source pixels at the native physical scale.

Only locally uniform 3x3 interiors are compared across rasterizer edge rules.
Full native RGBA and PNG identities are separately pinned in manifest.json.
"""
from pathlib import Path
import base64,hashlib,io,json
import xml.etree.ElementTree as E
from PIL import Image

root=Path(__file__).resolve().parent
ns={'p':'urn:fts:pdf-drawings:2'}
rows=[]
for item in json.loads((root/'source-manifest.json').read_text())['cases']:
    name=item['name'];data=json.loads((root/(name+'.json')).read_text())
    image=Image.open(io.BytesIO(base64.b64decode(data['media'][0]['bytesBase64']))).convert('RGBA')
    reference=Image.open(root/(name+'.source192dpi.png')).convert('RGBA')
    drawing=E.fromstring((root/(name+'.drawings.xml')).read_bytes()).find('p:page/p:drawing',ns)
    left,top,right,bottom=[float(drawing.attrib[k])for k in ['leftPt','topPt','rightPt','bottomPt']]
    dx=image.width*72/(right-left);dy=image.height*72/(bottom-top)
    samples=bad=maximum=transparent=painted=0
    for y in range(1,image.height-1):
        for x in range(1,image.width-1):
            sx=int((left+(x+.5)*72/dx)*192/72);sy=int((top+(y+.5)*72/dy)*192/72)
            a=reference.getpixel((sx,sy));b=image.getpixel((x,y))
            if any(reference.getpixel((sx+ox,sy+oy))!=a for ox in [-1,0,1]for oy in [-1,0,1]):continue
            if any(image.getpixel((x+ox,y+oy))!=b for ox in [-1,0,1]for oy in [-1,0,1]):continue
            delta=max(abs(v-w)for v,w in zip(a,b));samples+=1;maximum=max(maximum,delta);bad+=delta>1
            transparent+=a[3]==0;painted+=a[3]>0
    assert samples>200 and transparent>20 and painted>20 and bad==0,(name,samples,bad,maximum)
    rows.append({'name':name,'nativeRgbaSha256':hashlib.sha256(image.tobytes()).hexdigest(),'uniformSamples':samples,'transparentSamples':transparent,'paintedSamples':painted,'mismatchedUniformSamples':bad,'maxChannelDelta':maximum})
(root/'pixel-proof.json').write_text(json.dumps({'scope':'Independent source PNG vs actual native060 derived PNG at192dpi. Uniform interiors only; edge antialiasing is not asserted identical.','rows':rows},indent=2)+'\n')
print(json.dumps(rows,indent=2))
