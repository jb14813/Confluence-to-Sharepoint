from pathlib import Path
import json,sys,difflib
root=Path(sys.argv[1]);work=root/'core/DesktopEditor/graphics/pro/js'
recipe=json.loads((work/'drawingfile.json').read_text())
assert 'USE_OPENSSL_HASH' in recipe['define']
recipe['define'].remove('USE_OPENSSL_HASH')
recipe['include_path']=[p for p in recipe['include_path'] if '/openssl/' not in p]
recipe['asm']=False
recipe['run_before']='before-no-openssl.py'
recipe['run_after']='after-no-openssl.py'
(work/'drawingfile-no-openssl.json').write_text(json.dumps(recipe,indent=2)+'\n')
before=(work/'before.py').read_text()
lines=before.splitlines(keepends=True)
assert sum('/openssl/' in line for line in lines)==1
(work/'before-no-openssl.py').write_text(''.join(line for line in lines if '/openssl/' not in line))
after=(work/'after.py').read_text().split('content_native_files =')[0]
after=''.join(line for line in after.splitlines(keepends=True) if '/openssl/' not in line and 'drawingfile_ie.js' not in line and 'base.cmd_in_dir' not in line)
# The original final Closure invocation is WHITESPACE_ONLY. Retain readable
# generated JS and its upstream legal header instead of requiring Java.
after+='\nbase.writeFile("./deploy/drawingfile.js", base.readFile("../../../../Common/license/header.license") + base.readFile("./deploy/drawingfile.js"))\n'
(work/'after-no-openssl.py').write_text(after)
