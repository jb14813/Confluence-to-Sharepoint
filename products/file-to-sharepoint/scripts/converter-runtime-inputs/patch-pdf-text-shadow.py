"""Recognize vertical translucent neutral text shadows through native effects."""
from pathlib import Path
import hashlib,difflib,sys
root=Path(sys.argv[1]);file=root/'core/DocxRenderer/src/logic/elements/ContText.cpp'
original=file.read_bytes()
if hashlib.sha256(original).hexdigest()!='8ebdcdd731fe6ef6e1c04ea569f678ab197ef1d455e56543cedd872994f480b9':
    raise ValueError('Unexpected pinned native text effects source')
source=original.decode('utf-8')
anchor='\t\tif (bIf5 && bIf6)\n\t\t{\n\t\t\tif (bIf12 && pFirstCont->m_bIsEmbossPresent)'
replacement='''		if (bIf5 && bIf6)
		{
			// Match the established Xpdf duplicate bounds in the same point units.
			// An SVG shadow can be vertical only and use translucent #000/#010101.
			const double xDelta = 0.1 * pFirstCont->m_pFontStyle->dFontSize * c_dPtToMM;
			const double yDelta = 0.2 * pFirstCont->m_pFontStyle->dFontSize * c_dPtToMM;
			const bool sameBounds =
				fabs(pFirstCont->m_dLeft - pSecondCont->m_dLeft) < xDelta &&
				fabs(pFirstCont->m_dRight - pSecondCont->m_dRight) < xDelta &&
				fabs(pFirstCont->m_dTop - pSecondCont->m_dTop) < yDelta &&
				fabs(pFirstCont->m_dBot - pSecondCont->m_dBot) < yDelta;
			const bool sameFace = pFirstCont->m_pFontStyle->wsFontName == pSecondCont->m_pFontStyle->wsFontName &&
				pFirstCont->m_wsOriginFontName == pSecondCont->m_wsOriginFontName &&
				pFirstCont->m_nOriginFontFaceIndex == pSecondCont->m_nOriginFontFaceIndex;
			const auto& firstBrush = pFirstCont->m_pFontStyle->oBrush;
			const auto& secondBrush = pSecondCont->m_pFontStyle->oBrush;
			const bool firstShadow = (firstBrush.Color1 == 0 || firstBrush.Color1 == 0x010101) &&
				firstBrush.Alpha1 > 0 && firstBrush.Alpha1 < secondBrush.Alpha1;
			const bool secondShadow = (secondBrush.Color1 == 0 || secondBrush.Color1 == 0x010101) &&
				secondBrush.Alpha1 > 0 && secondBrush.Alpha1 < firstBrush.Alpha1;
			if (sameBounds && sameFace && firstShadow)
			{
				pSecondCont->m_bIsShadowPresent = true;
				pFirstCont = nullptr;
				return true;
			}
			if (sameBounds && sameFace && secondShadow)
			{
				pFirstCont->m_bIsShadowPresent = true;
				pSecondCont = nullptr;
				return true;
			}
			if (bIf12 && pFirstCont->m_bIsEmbossPresent)'''
if source.count(anchor)!=1:raise ValueError('Expected unique native font effects insertion')
modified=source.replace(anchor,replacement);file.write_bytes(modified.encode('utf-8'))
(root/'pdf-text-shadow.patch').write_text(''.join(difflib.unified_diff(source.splitlines(True),modified.splitlines(True),fromfile='a/core/DocxRenderer/src/logic/elements/ContText.cpp',tofile='b/core/DocxRenderer/src/logic/elements/ContText.cpp')),encoding='utf-8')
print('Patched existing native text shadow recognition with reader-compatible duplicate bounds',flush=True)
