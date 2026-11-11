// Keep the SDK's cached visible field result. Field instructions are metadata,
// never executable SharePoint content; malformed or unfinished fields block.
export function createStaticFieldState(warn,receipt){
  const stack=[];
  const invalid=()=>warn('field-content-unverified','A document field has incomplete or inconsistent source boundaries. Its visible result could not be verified; sending is blocked.',{blocking:true});
  return {
    visible:()=>stack.every(field=>field.result),
    control(node){
      if(node.type==='instrText'){
        if(!stack.length||stack.at(-1).result||typeof node.instr!=='string'||node.instr.length>65536)invalid();
        return true;
      }
      if(node.type!=='fldChar')return false;
      if(node.fldCharType==='begin'){
        if(stack.length>=32)throw Object.assign(new Error('The nested document fields exceed the processing limit.'),{code:'document-limit'});
        stack.push({result:false});
      }else if(node.fldCharType==='separate'){
        if(!stack.length||stack.at(-1).result)invalid();else stack.at(-1).result=true;
      }else if(node.fldCharType==='end'){
        if(!stack.length||!stack.pop().result)invalid();
        else{receipt.count++;warn('static-field-adapted','Document fields are preserved as editable static results. Automatic updates and field instructions are not retained in SharePoint.');}
      }else invalid();
      return true;
    },
    finish(){if(stack.length)invalid();}
  };
}
