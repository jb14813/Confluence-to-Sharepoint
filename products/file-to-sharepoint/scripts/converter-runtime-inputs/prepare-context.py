"""Prepare a pinned upstream build from verified preferred-source archives."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile

selection_file, context_arg = sys.argv[1:3]
capture_reference = sys.argv[3:] == ['--capture-reference']
if sys.argv[3:] and not capture_reference:
    raise ValueError('Unknown build variant')
selection = json.loads(Path(selection_file).read_text())
context = Path(context_arg).resolve()
context.mkdir(parents=True, exist_ok=False)
recipe = Path(__file__).resolve().parent
source = next(item for item in selection if item['input']['file'] == 'x2t-source-7debf5e.tar.gz')
for item in selection:
    archive = Path(item['archive'])
    digest = hashlib.sha256()
    with archive.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024), b''): digest.update(chunk)
    if archive.stat().st_size != item['selected']['bytes'] or digest.hexdigest() != item['selected']['sha256']:
        raise ValueError('Build source pin mismatch: ' + archive.name)
with tarfile.open(source['archive']) as archive:
    for original in archive:
        parts = Path(original.name).parts
        if len(parts) <= 1:
            continue
        member = copy.copy(original)
        member.name = str(Path(*parts[1:]))
        target = (context / member.name).resolve()
        if not target.is_relative_to(context):
            raise ValueError('Source member escapes build context')
        if member.issym() and not (target.parent / member.linkname).resolve().is_relative_to(context):
            raise ValueError('Source link escapes build context')
        if hasattr(tarfile, 'data_filter'):
            archive.extract(member, context, filter='data')
        else:
            archive.extract(member, context)
sources = context / '_sources'
sources.mkdir()
compilers=context/'_compilers'
compilers.mkdir()
compiler_names={
    'emscripten-4.0.11-wasm-binaries.tar.xz':'7033fec38817ec01909b044ea0193ddd5057255c-wasm-binaries.tar.xz',
    'node-v22.16.0-linux-x64.tar.xz':'node-v22.16.0-linux-x64.tar.xz',
}
pins = []
for item in selection:
    pin = item['input']
    if pin['file'] in compiler_names:
        shutil.copyfile(item['archive'],compilers/compiler_names[pin['file']])
    if (pin.get('repository') or pin['file']=='icu4c-68_2-src.zip') and pin['file'] not in ('x2t-source-7debf5e.tar.gz', 'emscripten-4182f94.tar.gz'):
        if item['selected']['sha256'] != pin['sha256']:
            raise ValueError('Dependency requires an explicit source-only mapping')
        shutil.copyfile(item['archive'], sources / pin['file'])
        pins.append(pin)
if set(path.name for path in compilers.iterdir()) != set(compiler_names.values()):
    raise ValueError('Pinned compiler binary archives are required')
(sources / 'inputs.json').write_bytes(json.dumps({'archives': pins}, indent=2).encode())
for name in ('Dockerfile', 'embuild.sh', 'pinned-git.py', 'seed-pinned-ports.py'):
    shutil.copyfile(recipe / name, context / name)
subprocess.run([sys.executable, str(recipe / ('capture-pixels.py' if capture_reference else 'patch-images.py')), str(context)], check=True)
if not capture_reference:
    subprocess.run([sys.executable, str(recipe / 'patch-image-identity.py'), str(context)], check=True)
subprocess.run([sys.executable, str(recipe / 'patch-jpeg-decoder.py'), str(context)], check=True)
subprocess.run([sys.executable, str(recipe / 'patch-pdf-native-runtime.py'), str(context), 'native-image-codecs'], check=True)
subprocess.run([sys.executable, str(recipe / 'patch-pdf-text.py'), str(context)], check=True)
subprocess.run([sys.executable, str(recipe / 'patch-pdf-form-body.py'), str(context)], check=True)
subprocess.run([sys.executable, str(recipe / 'patch-pdf-paragraph-overlap.py'), str(context)], check=True)
subprocess.run([sys.executable, str(recipe / 'patch-pdf-native-runtime.py'), str(context)], check=True)
subprocess.run([sys.executable, str(recipe / 'patch-graphics-blend.py'), str(context)], check=True)
subprocess.run([sys.executable, str(recipe / 'patch-pdf-text-shadow.py'), str(context)], check=True)
subprocess.run([sys.executable, str(recipe / 'patch-pdf-native-runtime.py'), str(context), 'pdf-native-layout'], check=True)
subprocess.run([sys.executable, str(recipe / 'patch-pdf-native-runtime.py'), str(context), 'pdf-native-drawings-v2'], check=True)
(context / 'source-selection.json').write_bytes(json.dumps(selection, indent=2).encode())
print(context, flush=True)
