"""Fix the pinned native overlap loop's stale paragraph reference."""
from pathlib import Path
import difflib,hashlib,sys
root=Path(sys.argv[1]);file=root/'core/DocxRenderer/src/logic/Page.cpp'
original=file.read_bytes()
if hashlib.sha256(original).hexdigest()!='816865185fa6084d9cb5145067ad3b6c72c57fb0b53e4f20bcaa9057dd67d1cd':
    raise ValueError('Unexpected pinned native paragraph source')
source=original.decode('utf-8')
start=source.index('\tstd::vector<CPage::ooxml_item_ptr_t> CPage::BuildOutputObjects()')
end=source.index('\n\tvoid CPage::CalcSelected()',start)
if hashlib.sha256(source[start:end].encode()).hexdigest()!='f3bd719be2ba6cbc73ac1d837b580b8995c22e0e0f58c1f453af34b05a44d98c':
    raise ValueError('Unexpected native paragraph overlap function')
before='\t\t\t\t\tauto& second_p = m_arParagraphs[second_index];\n\t\t\t\t\twhile (second_index < m_arParagraphs.size() && first_p->m_dBot > second_p->m_dTop)'
after='\t\t\t\t\twhile (second_index < m_arParagraphs.size() && first_p->m_dBot > m_arParagraphs[second_index]->m_dTop)'
if source.count(before)!=1:raise ValueError('Expected unique native overlap loop')
modified=source.replace(before,after);file.write_bytes(modified.encode())
(root/'pdf-paragraph-overlap.patch').write_text(''.join(difflib.unified_diff(source.splitlines(True),modified.splitlines(True),fromfile='a/core/DocxRenderer/src/logic/Page.cpp',tofile='b/core/DocxRenderer/src/logic/Page.cpp')),encoding='utf-8')
print('Patched stale paragraph overlap reference using current native index',flush=True)
