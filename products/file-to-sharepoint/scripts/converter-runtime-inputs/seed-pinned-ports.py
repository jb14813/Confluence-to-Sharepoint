"""Stage the declared ICU port source for the pinned offline Emscripten build."""
from pathlib import Path
import hashlib,json,re,shutil,sys,zipfile

emscripten=Path('/emsdk/upstream/emscripten')
sys.path.insert(0,str(emscripten))
from tools import config

inputs=json.loads(Path('/sources/inputs.json').read_text())['archives']
pin=next(item for item in inputs if item['file']=='icu4c-68_2-src.zip')
source=Path('/sources')/pin['file'];data=source.read_bytes()
if len(data)!=pin['bytes'] or hashlib.sha256(data).hexdigest()!=pin['sha256'] or hashlib.sha512(data).hexdigest()!=pin['sha512']:
    raise ValueError('Pinned ICU source archive differs')
recipe=(emscripten/'tools/ports/icu.py').read_text()
literal=lambda name:re.search(r"^"+name+r" = '([^']+)'$",recipe,re.M).group(1)
if literal('HASH')!=pin['sha512']:
    raise ValueError('Pinned Emscripten ICU recipe differs from source input')
url='https://github.com/unicode-org/icu/releases/download/'+literal('TAG')+'/icu4c-'+literal('VERSION')+'-src.zip'
ports=Path(config.PORTS).resolve();target=ports/'icu';archive=ports/'icu.zip';marker=target/'.emscripten_url'
ports.mkdir(parents=True,exist_ok=True)
if marker.exists():
    if marker.read_text().strip()!=url or not archive.is_file() or hashlib.sha256(archive.read_bytes()).hexdigest()!=pin['sha256'] or not (target/'icu/source').is_dir():
        raise ValueError('Existing ICU source cache differs from its exact pinned archive')
else:
    if target.exists() or archive.exists():
        raise ValueError('Incomplete ICU source cache requires a fresh build cache')
    with zipfile.ZipFile(source) as zipped:
        for item in zipped.infolist():
            if not (target/item.filename).resolve().is_relative_to(target):
                raise ValueError('ICU source archive escapes its port directory')
        target.mkdir();zipped.extractall(target)
    shutil.copyfile(source,archive)
    marker.write_text(url+'\n')
print('Verified pinned offline ICU port source '+pin['sha256'],flush=True)
