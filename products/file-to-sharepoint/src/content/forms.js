import {sha256Hex} from '../../../../src/transfer/limits.js';

const fail=message=>{throw Object.assign(new Error(message),{code:'unsupported-form'});};
function text(value,label,max=32768){
  if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))fail(`The PDF ${label} is missing or exceeds the supported form limits.`);
  return value;
}
const hash=value=>sha256Hex(new TextEncoder().encode(value));
function refuseActions(value,depth=0){
  if(depth>40)fail('The PDF form metadata is too deeply nested.');
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
    if(/^(?:JS|JavaScript|AA|A|actions?|scripts?|calculate|calculation|keystroke|validate|format|XFA|signature|signed)$/i.test(key)&&item!=null&&item!==false&&item!==0&&item!=='')fail('PDF scripts, actions, signatures and XFA forms cannot be recreated as an interactive SharePoint form.');
    refuseActions(item,depth+1);
  }
}
function geometry(raw,pages){
  if(raw.page===undefined&&raw.rect===undefined)return undefined;
  const r=raw.rect;
  if(!Number.isInteger(raw.page)||raw.page<0||(pages.length&&raw.page>=pages.length)||!r||![r.x1,r.y1,r.x2,r.y2].every(Number.isFinite)||r.x2<r.x1||r.y2<r.y1)fail('A PDF form field has invalid page or rectangle metadata.');
  return {pageIndex:raw.page,rect:{x:r.x1,y:r.y1,width:Number((r.x2-r.x1).toFixed(8)),height:Number((r.y2-r.y1).toFixed(8))}};
}
function choices(raw){
  if(!Array.isArray(raw)||!raw.length||raw.length>500)fail('A PDF choice field has missing or unsupported options.');
  const seen=new Set();
  return raw.map(option=>{
    const label=Array.isArray(option)?option[0]:option,value=Array.isArray(option)?option[1]:option;
    text(label,'option label',4096);text(value,'option export value',4096);
    if(!value||seen.has(value))fail('A PDF choice field has empty or repeated export values.');
    seen.add(value);return {label,value};
  });
}

/** Adapt ONLYOFFICE's original-PDF field metadata; this does not decode PDF bytes. */
export async function adaptForms(input,{sourceHash,title}){
  if(input==null)return null;
  const raw=input.forms??input,pages=input.pages??raw.pages??[];
  if(!raw||!Array.isArray(raw.Fields)||!Array.isArray(raw.Parents??[])||!Array.isArray(pages))fail('Original PDF form metadata is incomplete.');
  refuseActions(raw);
  if(!raw.Fields.length)return null;
  if(raw.Fields.length>5000)fail('The PDF contains more form widgets than this importer supports.');
  const parents=new Map();
  for(const parent of raw.Parents??[]){
    if(!Number.isInteger(parent.i)||parents.has(parent.i))fail('PDF parent field identities are missing or duplicated.');
    parents.set(parent.i,parent);
  }
  function inherited(widget){
    const chain=[],seen=new Set();let current=widget;
    while(current.Parent!==undefined&&current.Parent!==null){
      if(seen.has(current.Parent)||!parents.has(current.Parent))fail('A PDF radio/widget references an unknown or cyclic parent field.');
      seen.add(current.Parent);current=parents.get(current.Parent);chain.unshift(current);
    }
    return Object.assign({},...chain,widget);
  }
  const groups=new Map();
  for(const widget of raw.Fields){
    if(!widget||![28,29,30,31].includes(widget.type))fail('The PDF contains an unsupported or signed field type.');
    const merged=inherited(widget),kind={28:'radio',29:'checkbox',30:'text',31:'choice'}[widget.type];
    if(kind==='radio'&&widget.Parent!==undefined){
      const parent=inherited(parents.get(widget.Parent));
      for(const key of ['name','required','readOnly','tooltip'])if(parent[key]!==undefined)merged[key]=parent[key];
    }
    if(merged.multipleSelection||merged.editable||merged.password||merged.fileSelect||merged.richText)fail('This PDF uses a multi-select, editable-choice, password, file-select or rich-text field that the form runtime cannot preserve.');
    const name=text(merged.name,'source field name',4096);
    if(!name)fail('A PDF field has no stable source name.');
    const key=JSON.stringify([kind,name]);
    if(kind!=='radio'&&groups.has(key))fail('Repeated non-radio PDF widgets require explicit adaptation before sending.');
    if(groups.has(key)&&groups.get(key).parent!==widget.Parent)fail('Distinct PDF radio parents share the same source name.');
    if(!groups.has(key))groups.set(key,{kind,name,parent:widget.Parent,merged,widgets:[]});
    groups.get(key).widgets.push(widget);
  }
  if(groups.size>500)fail('The form runtime supports at most 500 logical fields.');
  const fields=[];
  for(const [key,{kind,name,merged,widgets}] of groups){
    const field={id:`f_${(await hash(`file-to-sharepoint:field:v1:${sourceHash}:${key}`)).slice(0,16)}`,sourceName:name,kind,label:text(merged.tooltip||name,'field label',4096),value:'',required:!!merged.required,readOnly:!!merged.readOnly};
    const box=geometry(widgets[0],pages);if(box)field.geometry=box;
    if(kind==='checkbox'){
      field.exportValue=text(merged.ExportValue??'Yes','checkbox export value');
      if(!field.exportValue||field.exportValue==='Off')fail('A PDF checkbox has an ambiguous export value.');
      const value=merged.value??merged.defaultValue??'Off';
      if(![field.exportValue,'Off','',false,true].includes(value))fail('A PDF checkbox has an unknown selected export value.');
      field.value=value===true||value===field.exportValue;
    }else if(kind==='radio'){
      const options=[],seen=new Set();
      for(const widget of widgets){
        const value=text(widget.ExportValue,'radio export value',4096);
        if(!value||value==='Off'||seen.has(value))fail('A PDF radio group has missing or duplicate export values.');
        seen.add(value);options.push({value,label:value});
        geometry(widget,pages);
      }
      field.choices=options;
      const parent=widgets[0].Parent!==undefined?inherited(parents.get(widgets[0].Parent)):null;
      const selected=parent?.value??widgets.find(widget=>widget.value&&widget.value!=='Off')?.value??'';
      field.value=selected==='Off'?'':text(selected,'radio selection');
      if(field.value&&!seen.has(field.value))fail('A PDF radio selection does not match its export values.');
    }else{
      field.value=text(merged.value??merged.defaultValue??'','field value');
      if(kind==='text')field.multiline=!!merged.multiline;
      else{
        field.choices=choices(merged.opt);
        if(field.value&&!field.choices.some(option=>option.value===field.value))fail('A PDF choice selection does not match its export values.');
      }
    }
    fields.push(field);
  }
  // Content-address the immutable definition too: the same bytes under a new
  // filename, or a newer reconstruction, must not collide with a stored title
  // or field definition while retaining stable logical field keys.
  const body={version:1,title:text(title,'title',1024),fields};
  const definition={version:1,id:await hash(`file-to-sharepoint:form:v1:${sourceHash}:${JSON.stringify(body)}`),title:body.title,fields};
  if(JSON.stringify(definition).length>63999)fail('The form definition exceeds the SharePoint 63,999 character storage limit.');
  return definition;
}
