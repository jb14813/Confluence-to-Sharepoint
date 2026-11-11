// Index captured SDK content, not file bytes. Placement can change; missing or
// conflicting source definitions must never become empty decorations.
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\u0000-\u001f\u007f]/u.test(value);
const refKind=node=>/^(footnote|endnote)(Ref|Num)$/.exec(node?.type??'');

export function planDocumentParts(doc,warn){
  const headers=[],footers=[],notes=[],definitions=new Map(),parts=new Map(),references=new WeakMap(),pending=[],seen=new WeakSet();
  let visited=0,section=0,referenceIndex=0;
  const invalid=()=>warn('document-parts-unverified','A referenced header, footer or note has missing, conflicting or unreadable source content. Sending is blocked.',{blocking:true});
  const customFollows=node=>node.customMark===true||typeof node.customMark==='string'&&node.customMark.length>0;
  function bound(){if(parts.size+notes.length>2000)throw Object.assign(new Error('The document parts exceed the page limit.'),{code:'document-limit'});}
  function sectionParts(pr){
    if(!pr)return;const sectionIndex=++section;
    for(const [kind,key,type,list] of [['header','headerReference','hdr',headers],['footer','footerReference','ftr',footers]]){
      const refs=pr[key];if(!refs)continue;
      if(typeof refs!=='object'||Array.isArray(refs)){invalid();continue;}
      for(const [variant,part] of Object.entries(refs)){
        if(part==null)continue;
        if(!['first','default','even'].includes(variant)||part.type!==type||part.content?.type!=='docContent'||!Array.isArray(part.content.content)){invalid();continue;}
        if(part.ftsSourceId!=null&&!validId(part.ftsSourceId)){invalid();continue;}
        const sourceId=part.ftsSourceId??`${kind}-section-${sectionIndex}-${variant}`,key=kind+':'+sourceId;
        let known=parts.get(key);
        if(known){if(!same(known.content,part.content.content)){invalid();continue;}if(!known.variants.includes(variant))known.variants.push(variant);known.sections.push(sectionIndex);continue;}
        known={kind,sourceId,variants:[variant],sections:[sectionIndex],content:part.content.content};
        parts.set(key,known);list.push(known);bound();scan(known.content,false);
      }
    }
  }
  function scan(value,allowSections=true){
    if(!value||typeof value!=='object'||seen.has(value))return;
    seen.add(value);if(++visited>500000)throw Object.assign(new Error('The document parts exceed the processing limit.'),{code:'document-limit'});
    if(Array.isArray(value)){for(const child of value)scan(child,allowSections);return;}
    if(allowSections&&value.type==='paragraph')sectionParts(value.pPr?.sectPr);
    for(const kind of ['footnote','endnote']){
      const items=value[kind+'s'];if(items==null)continue;
      if(!Array.isArray(items)){invalid();continue;}
      for(const item of items){
        if(!item||!validId(item.id)||!Array.isArray(item.content)){invalid();continue;}
        const key=kind+':'+item.id,known=definitions.get(key);
        if(known){if(!same(known.content,item.content)||known.number!==item.number)invalid();continue;}
        const ordinal=notes.filter(note=>note.kind===kind).length+1;
        const note={kind,sourceId:item.id,key,ordinal,id:`file-${kind}-${ordinal}`,number:item.number,content:item.content,references:[]};
        definitions.set(key,note);notes.push(note);bound();scan(note.content,false);
      }
    }
    if(refKind(value)?.[2]==='Ref')pending.push(value);
    scan(value.content,allowSections);scan(value.sdtContent,allowSections);scan(value.graphic?.content,allowSections);
  }
  sectionParts(doc.sectPr);scan(doc.content);
  for(const node of pending){
    const kind=refKind(node)[1],note=validId(node.footnote)?definitions.get(kind+':'+node.footnote):null;
    if(!note){invalid();continue;}
    if(node.customMark!=null&&typeof node.customMark!=='boolean'&&typeof node.customMark!=='string'){invalid();continue;}
    const reference={note,label:String(note.ordinal),customFollows:customFollows(node),customMark:node.customMark,id:`file-note-reference-${++referenceIndex}`};
    references.set(node,reference);note.references.push(reference);
  }
  if(headers.length||footers.length)warn('header-footer-adapted','Headers and footers are preserved once as labeled editable sections. SharePoint does not repeat them at the original page boundaries.');
  if(notes.length)warn('notes-adapted','Footnotes and endnotes use linked editable note sections and consecutive reference numbers. Custom source marks are retained as text links.');
  return {headers,footers,notes,reference(node,currentNote){
    const match=refKind(node);if(!match)return null;
    if(match[2]==='Ref'){const value=references.get(node);if(!value)invalid();return value??null;}
    const note=validId(node.footnote)?definitions.get(match[1]+':'+node.footnote):null;
    if(!note||note!==currentNote){invalid();return null;}
    return {note,label:String(note.ordinal),numberOnly:true,customFollows:customFollows(node)||note.references.some(reference=>reference.customFollows)};
  }};
}
