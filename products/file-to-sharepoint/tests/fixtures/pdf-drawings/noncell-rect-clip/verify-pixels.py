"""Independent source-uniform RGBA/transparency proof at the native 192 dpi scale.

Only source and unclipped-reference 5x5 neighborhoods select samples. Native
pixels never select/exclude themselves: missing paint or a missing clip is a
failure. The source/PDF and native/PNG edge antialiasing rules are not asserted
identical. Complete native PNG and straight-alpha RGBA hashes are pinned too.
"""
from pathlib import Path
import base64,hashlib,io,json
import xml.etree.ElementTree as E
from PIL import Image
root=Path(__file__).resolve().parent
ns={'p':'urn:fts:pdf-drawings:2'};rows=[]
def uniform(image,x,y):
    value=image.getpixel((x,y))
    return value if all(image.getpixel((x+ox,y+oy))==value for ox in range(-2,3)for oy in range(-2,3))else None
for item in json.loads((root/'source-manifest.json').read_text())['cases']:
    name=item['name'];data=json.loads((root/(name+'.json')).read_text())
    png=base64.b64decode(data['media'][0]['bytesBase64']);image=Image.open(io.BytesIO(png)).convert('RGBA')
    reference=Image.open(root/(name+'.source192dpi.png')).convert('RGBA')
    baseline=Image.open(root/(name+'.unclipped192dpi.png')).convert('RGBA')
    drawing=E.fromstring((root/(name+'.drawings.xml')).read_bytes()).find('p:page/p:drawing',ns)
    left,top,right,bottom=[float(drawing.attrib[k])for k in ['leftPt','topPt','rightPt','bottomPt']]
    assert abs((right-left)*192/72-image.width)<1e-10 and abs((bottom-top)*192/72-image.height)<1e-10
    samples=bad=maximum=transparent=painted=masked=hole=excluded=0;examples={}
    for y in range(image.height):
        for x in range(image.width):
            sx=int((left+(x+.5)*72/192)*192/72);sy=int((top+(y+.5)*72/192)*192/72)
            a=uniform(reference,sx,sy);plain=uniform(baseline,sx,sy)
            if a is None or plain is None:excluded+=1;continue
            b=image.getpixel((x,y));delta=max(abs(v-w)for v,w in zip(a,b))
            # Transparent RGB is unobservable; native and reference both encode zero.
            if a[3]==0:assert a==(0,0,0,0)
            samples+=1;maximum=max(maximum,delta);bad+=delta>1
            transparent+=a[3]==0;painted+=a[3]>0
            category='painted' if a[3]>0 else 'masked' if plain[3]>0 else 'transparent'
            masked+=category=='masked';hole+=category=='transparent'
            examples.setdefault(category,{'nativeXY':[x,y],'sourceXY':[sx,sy],'sourceRGBA':a,'unclippedRGBA':plain,'nativeRGBA':b})
    assert samples>200 and transparent>20 and painted>20 and bad==0,(name,samples,bad,maximum)
    assert (masked>20) if item['relation']=='crossing' else masked==0,(name,masked)
    if item['shape']in ['hole','alpha']:assert hole>20,(name,hole)
    rows.append({'name':name,'nativePngSha256':hashlib.sha256(png).hexdigest(),'nativeRgbaSha256':hashlib.sha256(image.tobytes()).hexdigest(),'width':image.width,'height':image.height,'uniformSamples':samples,'transparentSamples':transparent,'paintedSamples':painted,'clipMaskedSamples':masked,'unclippedTransparentSamples':hole,'sourceEdgeSamplesExcluded':excluded,'mismatchedUniformSamples':bad,'maxChannelDelta':maximum,'examples':examples})
(root/'pixel-proof.json').write_text(json.dumps({'scope':'Independent MuPDF192dpi source vs actual native060 noncell PNG. Source-only uniform5x5 selection, full PNG/RGBA pinned; edge antialiasing excluded. Crossing requires both visible and clip-masked samples. Touching can be a no-effect clip.','rows':rows},indent=2)+'\n')
print(json.dumps(rows,indent=2))
