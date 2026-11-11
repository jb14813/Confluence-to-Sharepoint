"""Apply exact guarded patches to the established pinned native converter.

This handles build-source hunks only. The native engine owns PDF interpretation.
Every input and complete output is hashed before any generated source is written.
"""
from pathlib import Path
import hashlib,json,re,shutil,sys

root=Path(sys.argv[1]).resolve();core=(root/'core').resolve();recipe=Path(__file__).resolve().parent
bundle=sys.argv[2] if len(sys.argv)>2 else 'pdf-native-runtime'
if bundle not in ('pdf-native-runtime','pdf-native-layout','native-image-codecs','pdf-native-drawings-v2'):
    raise ValueError('Unsupported native source patch bundle')
manifest=json.loads((recipe/(bundle+'.json')).read_text(encoding='utf-8'))
outputs=[]
for item in manifest['files']:
    target=(core/item['file']).resolve()
    if not target.is_relative_to(core):raise ValueError('Native patch path escapes generated context')
    before=target.read_bytes()if target.exists()else None
    if (hashlib.sha256(before).hexdigest()if before is not None else None)!=item['before']:
        raise ValueError('Unexpected pinned native source: '+item['file'])
    lines=before.decode('utf-8').splitlines(True)if before is not None else []
    hunks=item['hunks'];result=[];cursor=0;i=0
    while i<len(hunks):
        match=re.fullmatch(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*\n?',hunks[i])
        if not match:raise ValueError('Malformed exact source hunk: '+item['file'])
        start=int(match[1])-1 if int(match[1]) else 0
        old_count=int(match[2])if match[2]is not None else 1
        new_count=int(match[4])if match[4]is not None else 1
        if start<cursor or start>len(lines):raise ValueError('Overlapping native source hunk')
        result.extend(lines[cursor:start]);position=start;removed=added=0;i+=1
        while i<len(hunks)and not hunks[i].startswith('@@ '):
            line=hunks[i];prefix=line[:1];value=line[1:]
            if prefix not in [' ','-','+']:raise ValueError('Unsupported source patch marker')
            if prefix in [' ','-']:
                if position>=len(lines)or lines[position]!=value:raise ValueError('Native source hunk mismatch: '+item['file'])
                position+=1;removed+=1
            if prefix in [' ','+']:result.append(value);added+=1
            i+=1
        if removed!=old_count or added!=new_count:raise ValueError('Native source hunk length mismatch')
        cursor=position
    result.extend(lines[cursor:]);after=''.join(result).encode('utf-8')
    if hashlib.sha256(after).hexdigest()!=item['after']:raise ValueError('Native patch output hash mismatch: '+item['file'])
    outputs.append((target,after))
for target,after in outputs:
    target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(after)
shutil.copyfile(recipe/(bundle+'.patch'),root/(bundle+'.patch'))
print('Patched pinned native source bundle '+bundle+'; all source/output hashes verified',flush=True)
