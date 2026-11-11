(() => {
  'use strict';
  const fail=()=>{const error=new Error('The original Office notes or document parts could not be verified.');error.code='NATIVE_NOTES_UNVERIFIED';throw error;};
  const validId=id=>typeof id==='string'&&id.length>0&&id.length<=256;
  window.ftsCaptureNativeNotes=function(writer){
    const kinds=new Map([[AscWord.CRunFootnoteReference.prototype.Type,['footnoteRef','footnotes','footnote']],[AscWord.CRunFootnoteRef.prototype.Type,['footnoteNum']],
      [AscWord.CRunEndnoteReference.prototype.Type,['endnoteRef','endnotes','endnote']],[AscWord.CRunEndnoteRef.prototype.Type,['endnoteNum']]]);
    const instructionType=AscWord.ParaInstrText.prototype.Type,isField=item=>item?.IsFieldChar?.()===true,
      isInstruction=item=>item?.IsInstrText?.()===true||item?.Type===instructionType;
    function fieldToken(item){
      const flags=[item.IsBegin?.(),item.IsSeparate?.(),item.IsEnd?.()];
      if(!Number.isInteger(item.Type)||item.Type!==item.constructor?.prototype?.Type||flags.some(flag=>typeof flag!=='boolean')||flags.filter(Boolean).length!==1)fail();
      return {type:'fldChar',fldCharType:['begin','separate','end'][flags.indexOf(true)]};
    }
    function instructionPoint(item){
      if(item.Type!==instructionType||item.constructor!==AscWord.ParaInstrText||typeof item.GetCodePoint!=='function')fail();
      const point=item.GetCodePoint();
      if(!Number.isInteger(point)||point<0||point>0x10ffff||point>=0xd800&&point<=0xdfff)fail();
      return String.fromCodePoint(point);
    }
    let items=0,parts=0,notes=0,referenceContext,currentNote;
    const activeNotes=new Set(),serializeNote=writer.SerFootEndnote;
    writer.SerFootEndnote=function(note,...args){
      if(!note||!validId(note.Id)||!Array.isArray(note.Content)||activeNotes.has(note)||++notes>4096)fail();
      activeNotes.add(note);
      const previous=currentNote;currentNote=referenceContext?.source===note?referenceContext:undefined;
      try{
        const output=serializeNote.call(this,note,...args);
        if(!output||output.id!==note.Id||!Array.isArray(output.content))fail();
        return output;
      }finally{currentNote=previous;activeNotes.delete(note);}
    };
    for(const name of ['SerHeader','SerFooter']){
      const serialize=writer[name];
      writer[name]=function(source,...args){
        const id=source?.Get_Id?.();
        if(source&&!validId(id))fail();
        const output=serialize.call(this,source,...args);
        if(source){if(output?.content?.type!=='docContent'||!Array.isArray(output.content.content))fail();output.ftsSourceId=id;}
        return output;
      };
    }
    const serialize=writer.SerParaRun;
    writer.SerParaRun=function(run,...args){
      if(!Array.isArray(run?.Content)||(items+=run.Content.length)>500000)fail();
      if(!run.Content.some(item=>kinds.has(item?.Type)||isField(item)||isInstruction(item)))return serialize.call(this,run,...args);
      // Exact native tokens remain available before layout has initialized
      // ComplexField objects. Capture their existing flags/codepoints rather
      // than the SDK's whole-run field shortcut, which can drop pictures and
      // notes or duplicate preceding text. Instructions are metadata only;
      // the adapter verifies balanced boundaries and retains cached results.
      if(args[0]!=null&&!Array.isArray(args[0]))fail();
      const callArgs=[args[0]??[],...args.slice(1)];
      let output,start=0;
      const append=(end,reference,directContent)=>{
        if(end===start)return;
        if(++parts>16384)fail();
        let capturedReference=reference;
        if(reference&&!reference.Footnote){
          const kind=kinds.get(reference.Type),parent=run.GetParagraph?.()?.GetParent?.(),owner=parent?.GetTopDocumentContent?.();
          // The native binary reader leaves number-marker Footnote null until
          // layout. Its actual containing note establishes this association;
          // a nearby reference, serialized id or note.type cannot establish it.
          if(kind[1]||!currentNote||owner!==currentNote.source||kind[0]!==`${currentNote.kind}Num`)fail();
          capturedReference=Object.create(reference);Object.defineProperty(capturedReference,'Footnote',{value:owner});
        }
        if(capturedReference&&(!validId(capturedReference.Footnote?.Id)||!Array.isArray(capturedReference.Footnote?.Content)))fail();
        const content=directContent?[]:run.Content.slice(start,end);if(capturedReference)content[0]=capturedReference;
        const facade=Object.create(run);Object.defineProperty(facade,'Content',{value:content});
        const previous=referenceContext,kind=reference&&kinds.get(reference.Type);
        if(kind?.[1])referenceContext={source:reference.Footnote,kind:kind[2]};
        let value;try{value=serialize.call(this,facade,...callArgs);}finally{referenceContext=previous;}
        if(!value||!Array.isArray(value.content)||!Array.isArray(value.footnotes)||!Array.isArray(value.endnotes))fail();
        if(directContent){if(value.content.length||value.footnotes.length||value.endnotes.length)fail();value.content=directContent;}
        if(reference){
          const id=capturedReference.Footnote.Id;
          if(value.content.length!==1||value.content[0]?.type!==kind[0]||value.content[0]?.footnote!==id)fail();
          for(const key of ['footnotes','endnotes']){
            const expected=key===kind[1]?1:0;
            if(value[key].length!==expected)fail();
            if(expected){if(value[key][0]?.id!==id||!Array.isArray(value[key][0]?.content))fail();value[key][0].type=kind[2];}
          }
        }
        if(!output)output={...value,content:[],footnotes:[],endnotes:[]};
        if(value.type==='endRun')output.type='endRun';
        for(const key of ['content','footnotes','endnotes'])for(const child of value[key])output[key].push(child);
        start=end;
      };
      for(let index=0;index<run.Content.length;index++){
        const item=run.Content[index];
        if(isInstruction(item)){
          append(index);let end=index,instr='';
          while(end<run.Content.length&&isInstruction(run.Content[end])){instr+=instructionPoint(run.Content[end++]);if(instr.length>65536)fail();}
          append(end,undefined,[{type:'instrText',instr}]);index=end-1;
        }else if(isField(item)){
          append(index);append(index+1,undefined,[fieldToken(item)]);
        }else if(kinds.has(item?.Type)){
          append(index);append(index+1,item);
        }
      }
      append(run.Content.length);
      return output;
    };
  };
})();
