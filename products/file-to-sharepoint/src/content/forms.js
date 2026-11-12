const fail=message=>{throw Object.assign(new Error(message),{code:'unsupported-form'});};
const escape=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function text(value,label,max=32768){
  if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))fail(`The PDF ${label} is unreadable or exceeds the supported limits.`);
  return value;
}
function geometry(raw,pages){
  if(raw.page===undefined&&raw.rect===undefined)return {pageIndex:0};
  const r=raw.rect;
  if(!Number.isInteger(raw.page)||raw.page<0||(pages.length&&raw.page>=pages.length)||!r||![r.x1,r.y1,r.x2,r.y2].every(Number.isFinite)||r.x2<r.x1||r.y2<r.y1)fail('A PDF form field has invalid page or rectangle metadata.');
  return {pageIndex:raw.page,x:r.x1,y:r.y1,height:Math.max(16,Math.min(4096,r.y2-r.y1))};
}
function options(raw){
  if(!Array.isArray(raw)||raw.length>500)fail('A PDF choice field has unreadable options.');
  return raw.map(option=>({label:text(Array.isArray(option)?option[0]:option,'option label',4096),value:text(Array.isArray(option)?option[1]:option,'option value',4096)}));
}
const paragraphs=value=>value.split(/\r\n?|\n/).map(line=>escape(line)||'<br>').join('<br>');
// Retained drawingfile.js readAnnot: display 0=visible, 1=hidden,
// 2=noPrint (still visible), 3=noView. Also honor raw Invisible/Hidden/NoView
// bits because readAnnot maps NoView without Print back to display 0.
// SDK pdf/src/forms/base/base.js GetDisplay returns the widget's own _display;
// annotation visibility is not an inheritable logical-field property.
const hiddenWidget=widget=>Number.isInteger(widget?.annotflag)&&(widget.annotflag&35)!==0||widget?.display===1||widget?.display===3;

/** Reuse original-PDF metadata as static native content. Never interpret actions or PDF bytes. */
export async function adaptForms(input){
  if(input==null)return null;
  const raw=input.forms??input,pages=input.pages??raw.pages??[];
  if(!raw||!Array.isArray(raw.Fields)||!Array.isArray(raw.Parents??[])||!Array.isArray(pages))fail('Original PDF form metadata is incomplete.');
  if(raw.XFA)fail('XFA requires verified static field metadata that this importer does not provide.');
  if(!raw.Fields.length)return null;
  if(raw.Fields.length>5000)fail('The PDF contains more form widgets than this importer supports.');
  const parents=new Map();
  for(const parent of raw.Parents??[]){
    if(!Number.isInteger(parent.i)||parents.has(parent.i))fail('PDF parent field identities are missing or duplicated.');
    parents.set(parent.i,parent);
  }
  function inherited(widget){
    const chain=[widget],seen=new Set();let current=widget;
    while(current.Parent!==undefined&&current.Parent!==null){
      if(seen.has(current.Parent)||!parents.has(current.Parent))fail('A PDF widget references an unknown or cyclic parent field.');
      seen.add(current.Parent);current=parents.get(current.Parent);chain.unshift(current);
    }
    const merged=Object.assign({},...chain);
    // The logical field can carry the password flag while a widget exposes a
    // default false. Preserve masking whenever either declares it.
    merged.password=chain.some(item=>item.password===true||item.password===1);
    // Widgets expose appearance state; a logical parent's current value wins,
    // including Off, an empty string, or null. Defaults are never current values.
    const parentOwner=chain.slice(0,-1).reverse().find(item=>Object.hasOwn(item,'value'));
    const owner=parentOwner??widget;
    // A child button's value can be its appearance state rather than /V.
    // An absent logical selection therefore stays blank as well.
    merged.value=chain.length>1&&[28,29].includes(widget.type)?parentOwner?.value??'':Object.hasOwn(owner,'value')?owner.value:'';
    if(chain.length>1)for(const key of ['name','tooltip']){
      const owner=chain.slice(0,-1).reverse().find(item=>item[key]!==undefined);
      if(owner)merged[key]=owner[key];
    }
    return merged;
  }
  const identities=new Set(),widgets=[];let omittedHidden=false;
  for(const [index,widget] of raw.Fields.entries()){
    if(hiddenWidget(widget)){omittedHidden=true;continue;}
    if(!widget||![28,29,30,31].includes(widget.type))fail('The PDF contains a field without a verified static value.');
    const merged=inherited(widget),kind=widget.type,box=geometry(widget,pages);
    const name=text(merged.name??'','source field name',4096),label=text(merged.tooltip||name,'field label',4096);
    if(!label)fail('A PDF field has no readable source label.');
    identities.add(JSON.stringify([kind,name,widget.Parent??null]));
    let value=merged.value??'',rendered;
    if(kind===28||kind===29){
      const exported=text(widget.ExportValue??merged.ExportValue??(kind===29?'Yes':''),'selection export value',4096);
      if(!exported||exported==='Off')fail('A PDF selection has no verified export value.');
      if(!['string','boolean'].includes(typeof value))fail('A PDF selection value is unreadable.');
      if(kind===29&&![exported,'Off','',false,true].includes(value))fail('A PDF checkbox value does not match its export value.');
      if(kind===28&&value&&value!=='Off'&&!raw.Fields.some(other=>other.type===28&&other.Parent===widget.Parent&&other.ExportValue===value))fail('A PDF radio selection does not match its export values.');
      const selected=value===exported||kind===29&&value===true;
      rendered=kind===29?(selected?'☑':'☐'):`${selected?'◉':'○'} ${escape(exported)}`;
    }else{
      const values=Array.isArray(value)?value:[value];
      if(kind===30&&Array.isArray(value))fail('A PDF text value is unreadable.');
      const choices=kind===31?options(merged.opt??[]):[];
      rendered=values.map(value=>{
        text(value,'field value');
        if(kind===30&&merged.password)return '•'.repeat(Array.from(value).length)||'<br>';
        if(kind===31&&value){
          const matching=choices.filter(option=>option.value===value),choice=matching[0];
          if(matching.some(option=>option.label!==choice.label))fail('A PDF choice has ambiguous display labels for its current value.');
          if(!choice&&!merged.editable)fail('A PDF choice selection does not match its export values.');
          return paragraphs(choice?.label??value);
        }
        return paragraphs(value);
      }).join('<br>')||'<br>';
    }
    const cell='border:0.5pt solid #000000;padding:4pt';
    widgets.push({index,...box,row:`<tr><th scope="row" style="${cell};width:35%;"><p>${escape(label)}</p></th><td style="${cell};width:65%;height:${Number((box.height??20).toFixed(4))}pt;"><p>${rendered}</p></td></tr>`});
  }
  widgets.sort((a,b)=>a.pageIndex-b.pageIndex||(a.y??Infinity)-(b.y??Infinity)||(a.x??Infinity)-(b.x??Infinity)||a.index-b.index);
  const pageRows=new Map();for(const widget of widgets){if(!pageRows.has(widget.pageIndex))pageRows.set(widget.pageIndex,[]);pageRows.get(widget.pageIndex).push(widget.row);}
  const blocks=[...pageRows].map(([pageIndex,rows])=>({pageIndex,html:`<figure class="table" style="width:100%;"><table style="width:100%;border-collapse:collapse;table-layout:fixed;"><tbody>${rows.join('')}</tbody></table></figure>`}));
  return {blocks,fieldCount:identities.size,widgetCount:widgets.length,...(omittedHidden?{omittedHidden:true}:{})};
}
