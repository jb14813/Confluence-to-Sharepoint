"""Regenerate two decoder-dependent references from independent pre-export inputs.

Usage: freeze-references.py fixtures.json capture-directory djpeg output-record
The capture build uses original ImageManager source and observes IImageStorage
before encoding. The djpeg CLI independently verifies IJG chroma reconstruction.
All remaining fixture PNG references stay anchored to their original source.
"""
import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import zipfile
from PIL import Image, ImageChops

fixture_path, captured, djpeg, record_path = map(Path, sys.argv[1:5])
baseline = Path(sys.argv[5]) if len(sys.argv)>5 else None
cases = json.loads(fixture_path.read_text())
capture_record = json.loads((captured/'capture-evidence.json').read_text())
sha = lambda data: hashlib.sha256(data).hexdigest()
def compare(a,b):
    if a.size != b.size: return {'dimensionsMatch':False}
    delta=ImageChops.difference(a,b)
    return {'dimensionsMatch':True,'changedPixels':sum(any(pixel) for pixel in delta.getdata()),'maxChannelDifference':max(high for low,high in delta.getextrema())}
proof=[]
for case in cases:
    name=case['name']
    meta_path=captured/(name+'.captured-image-1.json')
    meta=json.loads(meta_path.read_text())
    raw=(captured/(name+'.captured-image-1.bgra')).read_bytes()
    image=Image.frombytes('RGBA',(meta['width'],meta['height']),raw,'raw','BGRA',abs(meta['stride']),-1 if meta['stride']<0 else 1)
    reference=image
    entry={'name':name,'pdfSha256':sha(base64.b64decode(case['pdf'])),'sourceImage':case.get('sourceImage'),
           'capture':{'metadata':meta,'metadataSha256':sha(meta_path.read_bytes()),'rawBgraSha256':sha(raw),'rgbaSha256':sha(image.tobytes())}}
    if name in ('image-opaque.pdf','image-large.pdf','image-alpha.pdf'):
        comparison=compare(image,Image.open(io.BytesIO(base64.b64decode(case['original']))).convert('RGBA'))
        if comparison.get('changedPixels') != 0: raise ValueError('Capture calibration failed: '+name)
        entry['independentSourceCalibration']=comparison
        case['referencePolicy']='original-source-png-rgba'
    if 'jpeg' in name and 'cmyk' not in name:
        jpeg=base64.b64decode(case['compressedOriginal'])
        if sha(jpeg) != case['sourceImage']['streamSha256']:
            raise ValueError('Reference JPEG does not match original PDF stream')
        jpeg_path=captured/(name+'.original.jpg');jpeg_path.write_bytes(jpeg)
        ppm_path=captured/(name+'.ijg.ppm')
        subprocess.run([str(djpeg),'-outfile',str(ppm_path),str(jpeg_path)],check=True)
        comparison=compare(image,Image.open(ppm_path).convert('RGBA'))
        if comparison.get('changedPixels') != 0: raise ValueError('Independent IJG CLI comparison failed: '+name)
        entry['independentIjgCli']=comparison
        entry['ppmSha256']=sha(ppm_path.read_bytes())
        entry['djpegCommand']=['djpeg','-outfile','<fixture>.ijg.ppm','<original-pdf-dct-stream>.jpg']
        if 'subsampled' in name: reference=Image.open(ppm_path).convert('RGBA')
        else: case['referencePolicy']='original-dct-stream-pillow-rgba'
    if name in ('image-jpeg-subsampled.pdf','image-jpeg-cmyk.pdf'):
        png=io.BytesIO();reference.save(png,format='PNG')
        case.update(original=base64.b64encode(png.getvalue()).decode(),width=reference.width,height=reference.height,rgbaSha256=sha(reference.tobytes()),
                    referencePolicy='upstream-ijg8c-cli' if 'subsampled' in name else 'upstream-pdf-pre-export-storage-boundary')
        case['referenceProducer']={'record':'vendor/provenance/converter/pixel-reference-provenance.json','case':name}
    entry['referencePngSha256']=sha(base64.b64decode(case['original']))
    if baseline:
        document=(baseline/(name+'.docx')).read_bytes()
        archive=zipfile.ZipFile(io.BytesIO(document))
        media=next(member for member in archive.namelist() if member.startswith('word/media/image1.'))
        encoded=archive.read(media)
        previous=Image.open(io.BytesIO(encoded)).convert('RGBA')
        entry['unchangedExporterBaseline']={'docxSha256':sha(document),'mediaSha256':sha(encoded),'width':previous.width,'height':previous.height,**compare(image,previous)}
    proof.append(entry)
fixture_path.write_bytes((json.dumps(cases,indent=2)+'\n').encode())
record={'schemaVersion':1,'method':'test-only public IImageStorage observer before unchanged upstream ImageManager export; independent IJG8c djpeg CLI and original PNG calibrations',
        'captureRuntime':capture_record['runtime'],'djpegExecutableSha256':sha(djpeg.read_bytes()),'cases':proof}
recipe=Path(__file__).resolve().parent
record['producerInputs']=[{'file':'scripts/converter-runtime-inputs/'+name,'bytes':(recipe/name).stat().st_size,'sha256':sha((recipe/name).read_bytes())} for name in ('capture-pixels.py','capture-reference.mjs','build-djpeg.py','freeze-references.py','patch-jpeg-decoder.py','Dockerfile','embuild.sh','pinned-git.py','prepare-context.py','rebuild.sh')]
record['sourceAssociation']={'repository':'https://github.com/cryptpad/onlyoffice-x2t-wasm','commit':'7debf5e6d6d4f19874d764cd34446f7e63c6bc32','archiveFile':'x2t-source-7debf5e.tar.gz','delivery':'provenance/source-delivery.json'}
record['captureConfiguration']={'storageInterface':'NSDocxRenderer::IImageStorage::GenerateImageID(Aggplus::CImage*)','exporter':'original ImageManager.cpp SHA256 46a7c8ee69ece0aef93aea3af55b7b057e22d6ef36365035abddb3fdcd7dc914','reader':'existing HAVE_JPEGLIB branch; scoped JPEG_INT32 alias; do_fancy_upsampling=true; do_block_smoothing=true; default JDCT_ISLOW','rawNormalization':'BGRA to RGBA; negative stride is bottom-up; calibrated against independent opaque/large/alpha source PNGs'}
if len(sys.argv)>6:
    jpeg_source=Path(sys.argv[6])/'core/DesktopEditor/cximage/jpeg'
    record['decoderSources']=[{'file':'core/DesktopEditor/cximage/jpeg/'+file.name,'bytes':file.stat().st_size,'sha256':sha(file.read_bytes())} for file in sorted(jpeg_source.iterdir()) if file.is_file() and file.suffix in ('.c','.h')]
    record['djpeg']={'version':'Independent JPEG Group 8c, 16-Jan-2011','command':['cc','-O2','-I<upstream-jpeg>','-o','djpeg','<pinned upstream IJG library and existing djpeg CLI sources>','-lm'],'sourceModification':'Only enable upstream djpeg.c CLI main (#if 0 to #if 1); no decoder source modification.'}
record_path.parent.mkdir(parents=True,exist_ok=True)
record_path.write_bytes((json.dumps(record,indent=2)+'\n').encode())
