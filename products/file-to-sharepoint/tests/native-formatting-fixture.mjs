import JSZip from 'jszip';
import {nativeNotesFixture} from './native-notes-fixture.mjs';

// Genuine OOXML acceptance input: the native converter and SDK must capture
// every marker/style before the adapter may choose an editable equivalent.
export async function nativeFormattingFixture(){
  const zip=await JSZip.loadAsync(await nativeNotesFixture());
  const paragraph=(text,numId,level)=>`<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const lists=paragraph('Initial skipped list level',88,2)+paragraph('Custom marker item',89,0)+paragraph('Compound parent',90,0)+paragraph('Compound marker item',90,1);
  const level=(index,pattern,start=1)=>`<w:lvl w:ilvl="${index}"><w:start w:val="${start}"/><w:numFmt w:val="decimal"/><w:lvlText w:val="${pattern}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="${720*(index+1)}"/></w:tabs><w:ind w:left="${720*(index+1)}" w:hanging="360"/></w:pPr></w:lvl>`;
  zip.file('word/numbering.xml',`<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="88"><w:multiLevelType w:val="multilevel"/>${level(0,'%1.')}${level(1,'%2.')}${level(2,'%3.')}</w:abstractNum><w:abstractNum w:abstractNumId="89">${level(0,'Phase %1:',7)}</w:abstractNum><w:abstractNum w:abstractNumId="90"><w:multiLevelType w:val="multilevel"/>${level(0,'%1.',2)}${level(1,'%1.%2)',3)}</w:abstractNum>${[88,89,90].map(id=>`<w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`).join('')}</w:numbering>`);
  const relationships=await zip.file('word/_rels/document.xml.rels').async('string');
  zip.file('word/_rels/document.xml.rels',relationships.replace('</Relationships>','<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>'));
  let types=await zip.file('[Content_Types].xml').async('string');
  if(!types.includes('PartName="/word/numbering.xml"'))types=types.replace('</Types>','<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>');
  zip.file('[Content_Types].xml',types);
  const cell=(text,properties='')=>`<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>${properties}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const table=`<w:tbl><w:tblPr><w:tblW w:w="4800" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="100000" w:hRule="exact"/></w:trPr>${cell('Merged anchor','<w:vMerge w:val="restart"/><w:tcBorders><w:left w:val="nil"/></w:tcBorders>')}${cell('Tall right cell')}</w:tr><w:tr>${cell('Merged continuation','<w:vMerge/><w:tcBorders><w:left w:val="single" w:sz="8" w:color="FF0000"/><w:bottom w:val="single" w:sz="8" w:color="800000"/></w:tcBorders>')}${cell('Second right cell')}</w:tr></w:tbl>`;
  const textbox='<w:p><w:r><w:drawing><wp:inline><wp:extent cx="2743200" cy="914400"/><wp:docPr id="1001" name="Decorative source textbox"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="123456"/></a:gs><a:gs pos="100000"><a:srgbClr val="AABBCC"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="1"/></a:gradFill><a:ln w="25400" cmpd="tri"><a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:prstDash val="dashDot"/></a:ln></wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>Decorative textbox text</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr wrap="square"><a:spAutoFit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  const document=await zip.file('word/document.xml').async('string');
  zip.file('word/document.xml',document.replace('<w:body>','<w:body>'+lists).replace('<w:sectPr>',table+textbox+'<w:sectPr>'));
  return zip.generateAsync({type:'nodebuffer'});
}
