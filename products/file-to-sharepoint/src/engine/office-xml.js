const fail=()=>{throw Object.assign(new Error('The Word document XML is invalid.'),{code:'INVALID_DOCUMENT'});};
const invalidCharacters=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u;

/** A literal U+FFFD is valid XML. Verify the original UTF-8 bytes first so the
 * parser's diagnostic cannot conceal replacement of an invalid byte sequence.
 * No other repair warning is accepted from the pinned XML parser.
 */
export function parseOfficeXml(bytes,Parser){
  if(!(bytes instanceof Uint8Array))fail();
  try{
    const xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if(invalidCharacters.test(xml))fail();
    const document=new Parser({onError(level,message){
      if(level==='warning'&&message==='Unicode replacement character detected, source encoding issues?'&&xml.includes('\ufffd'))return;
      fail();
    }}).parseFromString(xml,'application/xml');
    // Numeric references also must resolve to valid XML characters. The pinned
    // parser accepts some invalid control references without a diagnostic.
    const pending=[document];let visited=0;
    while(pending.length){
      const node=pending.pop();if(++visited>500000||typeof node.nodeValue==='string'&&invalidCharacters.test(node.nodeValue))fail();
      for(let i=0;i<(node.attributes?.length??0);i++)if(invalidCharacters.test(node.attributes.item(i).value))fail();
      for(let i=0;i<node.childNodes.length;i++)pending.push(node.childNodes.item(i));
    }
    return document;
  }catch{fail();}
}
