import JSZip from 'jszip';
import {fixtures} from './engine-fixtures.mjs';

// Genuine authored OOXML, with a reference between text in the same run and
// independent linked/image-bearing header, footer, footnote and endnote parts.
export async function nativeNotesFixture(){
  const zip=await JSZip.loadAsync(Buffer.from(fixtures['sample-rich.docx'],'base64'));
  const original=await zip.file('word/document.xml').async('string'),picture=original.match(/<w:drawing>[\s\S]*?<\/w:drawing>/)?.[0]?.replace(/r:embed="[^"]+"/g,'r:embed="rIdPic"');
  if(!picture)throw Error('The genuine source picture fixture is missing.');
  const media=Object.keys(zip.files).find(name=>/^word\/media\/.+\.png$/.test(name));
  const ns='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const relationship=(id,type,target,external=false)=>`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${external?' TargetMode="External"':''}/>`;
  const relationships=items=>`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join('')}</Relationships>`;
  const partRels=relationships([relationship('rIdPic','image',media.slice(5)),relationship('rIdLink','hyperlink','https://example.com/native-notes',true)]);
  zip.file('word/document.xml',`<w:document ${ns}><w:body><w:p><w:r><w:t>Before😀</w:t><w:footnoteReference w:id="2"/><w:t>Middle</w:t>${picture}<w:endnoteReference w:id="3"/><w:t>After</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:headerReference w:type="first" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:titlePg/></w:sectPr></w:body></w:document>`);
  zip.file('word/_rels/document.xml.rels',relationships([relationship('rIdPic','image',media.slice(5)),relationship('rIdHeader','header','header1.xml'),relationship('rIdFooter','footer','footer1.xml'),relationship('rIdFoot','footnotes','footnotes.xml'),relationship('rIdEnd','endnotes','endnotes.xml')]));
  const paragraph=(label,marker='')=>`<w:p><w:r><w:t>${label} lead</w:t>${marker}<w:t>${label} text😀</w:t></w:r><w:hyperlink r:id="rIdLink"><w:r><w:t>${label} link</w:t></w:r></w:hyperlink><w:r>${picture}</w:r></w:p>`;
  zip.file('word/header1.xml',`<w:hdr ${ns}>${paragraph('Header')}</w:hdr>`);
  zip.file('word/footer1.xml',`<w:ftr ${ns}>${paragraph('Footer')}</w:ftr>`);
  zip.file('word/footnotes.xml',`<w:footnotes ${ns}><w:footnote w:id="2">${paragraph('Foot','<w:footnoteRef/>')}</w:footnote></w:footnotes>`);
  zip.file('word/endnotes.xml',`<w:endnotes ${ns}><w:endnote w:id="3">${paragraph('End','<w:endnoteRef/>')}</w:endnote></w:endnotes>`);
  for(const part of ['header1','footer1','footnotes','endnotes'])zip.file(`word/_rels/${part}.xml.rels`,partRels);
  let types=await zip.file('[Content_Types].xml').async('string');
  for(const[part,type]of[['header1','header'],['footer1','footer'],['footnotes','footnotes'],['endnotes','endnotes']])types=types.replace('</Types>',`<Override PartName="/word/${part}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/></Types>`);
  zip.file('[Content_Types].xml',types);
  return zip.generateAsync({type:'nodebuffer'});
}

// Review controls: native-open leaves ordinary Number values at one; custom
// note marks are existing following source text; fields have genuine balanced
// OOXML controls and a cached visible result that includes a note reference.
export async function nativeNotesReviewFixture(){
  const zip=await JSZip.loadAsync(await nativeNotesFixture());
  const field='<w:p><w:r><w:t>Field lead</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> QUOTE "cached field" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/><w:t>Cached prefix</w:t><w:footnoteReference w:id="4"/><w:t>Cached suffix</w:t><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>Field final</w:t></w:r></w:p>';
  const custom='<w:p><w:r><w:t>Custom before</w:t><w:footnoteReference w:id="5" w:customMarkFollows="1"/><w:t>*Custom after</w:t></w:r></w:p>';
  const controls='<w:sdt><w:sdtPr><w:alias w:val="Source block control"/><w:id w:val="2001"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Block control content</w:t></w:r></w:p></w:sdtContent></w:sdt><w:p><w:r><w:t>Inline control before</w:t></w:r><w:sdt><w:sdtPr><w:alias w:val="Source inline control"/><w:id w:val="2002"/></w:sdtPr><w:sdtContent><w:r><w:t>Inline control content</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t>Inline control after</w:t></w:r></w:p>';
  const document=await zip.file('word/document.xml').async('string');zip.file('word/document.xml',document.replace('<w:sectPr>',field+custom+controls+'<w:sectPr>'));
  const footnotes=await zip.file('word/footnotes.xml').async('string'),original=footnotes.match(/<w:footnote w:id="2">[\s\S]*?<\/w:footnote>/)?.[0];
  if(!original)throw Error('The original ordinary note fixture is missing.');
  const second=original.replace('w:id="2"','w:id="4"').replaceAll('Foot','Second');
  const marked=original.replace('w:id="2"','w:id="5"').replaceAll('Foot','Custom').replace('<w:t>Custom text😀</w:t>','<w:t>*Custom note text😀</w:t>');
  zip.file('word/footnotes.xml',footnotes.replace('</w:footnotes>',second+marked+'</w:footnotes>'));
  return zip.generateAsync({type:'nodebuffer'});
}
