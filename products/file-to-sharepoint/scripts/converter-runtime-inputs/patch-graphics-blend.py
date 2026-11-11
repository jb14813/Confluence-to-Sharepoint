"""Bridge existing native custom blend operators to straight RGBA buffers."""
from pathlib import Path
import hashlib,shutil,sys,difflib
root=Path(sys.argv[1]);recipe=Path(__file__).resolve().parent
file=root/'core/DesktopEditor/graphics/Graphics.h';raw=file.read_bytes()
if hashlib.sha256(raw).hexdigest() not in {
    '4ee6af4f987cab8607093b396525bd88d84b0bfc68176d86c1ea0aed4fab558e',
    '0bb59eab04c69b0c5249941abf4c1d70cd221cdfdbd1d6212bf57ece5d37ae38'}:
    raise ValueError('Unexpected pinned native graphics blend source')
source=raw.decode('utf-8');modified=source
for before,after in [
    ('#include "GraphicsPath.h"','#include "GraphicsPath.h"\n#include "StraightBlendAdaptor.h"'),
    ('typedef agg::comp_op_adaptor_rgba< agg::svg::color_type, agg::svg::component_order >               blender_type_comp;',
     'typedef CUnpremultipliedBlend< agg::svg::color_type, agg::svg::component_order >                  blender_type_comp;')]:
    if modified.count(before)!=1:raise ValueError('Expected unique native blend insertion')
    modified=modified.replace(before,after)
file.write_bytes(modified.encode('utf-8'))
helper=recipe/'straight-blend-adaptor.h'
if hashlib.sha256(helper.read_bytes()).hexdigest()!='0b67cbe3c87292733edf33b4174f28d01d73c93b1bd03aca3112ee6d731c8f78':
    raise ValueError('Unexpected straight blend helper')
shutil.copyfile(helper,file.parent/'StraightBlendAdaptor.h')
changes=list(difflib.unified_diff(source.splitlines(True),modified.splitlines(True),fromfile='a/core/DesktopEditor/graphics/Graphics.h',tofile='b/core/DesktopEditor/graphics/Graphics.h'))
changes.extend(difflib.unified_diff([],helper.read_text().splitlines(True),fromfile='/dev/null',tofile='b/core/DesktopEditor/graphics/StraightBlendAdaptor.h'))
(root/'native-straight-blend.patch').write_text(''.join(changes),encoding='utf-8')
print('Patched native custom blend straight/premultiplied bridge',flush=True)
