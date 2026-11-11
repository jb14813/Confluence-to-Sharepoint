"""Preserve the native font size for a verified parsed Type3 coordinate profile."""
from pathlib import Path
import hashlib
import json
import sys

recipe = Path(__file__).resolve().parent
target = Path(sys.argv[1]) / 'core/PdfFile/lib/xpdf/TextOutputDev.cc'
spec = json.loads((recipe / 'pdf-font-metrics.json').read_text(encoding='utf-8'))
before = target.read_bytes()
if hashlib.sha256(before).hexdigest() != spec['before']:
    raise ValueError('Unsupported pinned Xpdf TextOutputDev source for Type3 font metrics')
source = before.decode('utf-8')
for hunk in spec['hunks']:
    if source.count(hunk['before']) != 1:
        raise ValueError('Pinned Type3 font-metrics hunk is not unique')
    source = source.replace(hunk['before'], hunk['after'], 1)
after = source.encode('utf-8')
if hashlib.sha256(after).hexdigest() != spec['after']:
    raise ValueError('Unexpected Type3 font-metrics source result')
target.write_bytes(after)
print('Preserved parsed Type3 font size; original typography and ordering algorithms retained', flush=True)
