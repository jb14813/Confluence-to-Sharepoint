"""Build the pinned upstream IJG8c reference CLI; no new decoder code."""
from pathlib import Path
import subprocess
import sys

source = Path(sys.argv[1]).resolve() / 'core/DesktopEditor/cximage/jpeg'
output = Path(sys.argv[2]).resolve()
output.mkdir(parents=True, exist_ok=True)
cli = output / 'djpeg-enabled.c'
text = (source / 'djpeg.c').read_text()
needle = '#if 0\n\n/*\n * The main program.'
if text.count(needle) != 1:
    raise ValueError('Unexpected upstream reference CLI')
cli.write_bytes(text.replace(needle, '#if 1\n\n/*\n * The main program.').encode())
skip = {'jpegtran.c', 'jmemansi.c', 'jmemdos.c', 'jmemmac.c', 'jmemname.c'}
files = sorted(str(file) for file in source.glob('j*.c') if file.name not in skip)
files += [str(cli)] + [str(source/name) for name in ('cdjpeg.c','rdcolmap.c','rdswitch.c','wrppm.c','wrbmp.c','wrgif.c','wrrle.c','wrtarga.c')]
subprocess.run(['cc','-O2','-I'+str(source),'-o',str(output/'djpeg'),*files,'-lm'],check=True)
