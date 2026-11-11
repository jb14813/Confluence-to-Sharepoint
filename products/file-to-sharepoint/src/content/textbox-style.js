// Adapt the existing SDK's explicit shape styles. This does not interpret
// DrawingML paths or invent a border when the source says noFill.
export function textboxStyles(shape,color,warn){
  const css=['border:0pt solid #000000'];
  const review=()=>warn('textbox-style-adapted','Some textbox decoration was simplified to native SharePoint styles. Editable text is preserved; unsupported backgrounds are omitted and borders use the closest supported stroke.');
  function fill(value){
    const source=value?.fill;
    if(['none','noFill'].includes(source?.type)||value?.transparent===0)return {none:true};
    if(source?.type!=='solid'){review();return null;}
    // Native-open serialization can carry the uncalculated black RGBA cache
    // beside the declared sRGB value. Use the explicit value; theme colors or
    // modifiers require an effective SDK style instead of trusting that cache.
    const declared=source.color?.color;
    if(declared&&(declared.type!=='srgb'||source.color.mods?.length)){review();return null;}
    const rgba=declared?.rgba??source.color?.rgba??source.color;
    const alpha=rgba?.a??rgba?.alpha;
    if(alpha===0)return {none:true};
    let resolved=color(rgba);
    if(!resolved||alpha!=null&&(!Number.isFinite(alpha)||alpha<0||alpha>255)||value.transparent!=null&&(!Number.isFinite(value.transparent)||value.transparent<0||value.transparent>255)){review();return null;}
    const opacity=(alpha??255)/255*(value.transparent??255)/255;
    if(opacity<1){
      review();
      resolved='#'+[rgba.r??rgba.red,rgba.g??rgba.green,rgba.b??rgba.blue].map(channel=>Math.round(channel*opacity+255*(1-opacity)).toString(16).padStart(2,'0')).join('');
    }
    return {color:resolved};
  }
  const background=fill(shape.spPr?.fill);
  if(background?.color)css.push(`background-color:${background.color}`);
  const line=shape.spPr?.ln,stroke=fill(line?.fill);
  if(stroke?.color){
    const sourceWidth=line.w/12700,width=Number.isFinite(line.w)&&sourceWidth>=0?Math.min(12,sourceWidth):0.5;
    const nativeDash=new Map([['solid','solid'],['dash','dashed'],['dot','dotted']]);
    const approximateDash=new Map([['dashDot','dashed'],['lgDash','dashed'],['lgDashDot','dashed'],['lgDashDotDot','dashed'],['sysDash','dashed'],['sysDashDot','dashed'],['sysDashDotDot','dashed'],['sysDot','dotted']]);
    const compound=line.cmpd!=null&&line.cmpd!=='sng';
    const style=compound?'double':nativeDash.get(line.prstDash??'solid')??approximateDash.get(line.prstDash)??'solid';
    if(!Number.isFinite(line.w)||sourceWidth<0||sourceWidth>12||compound&&(line.cmpd!=='dbl'||line.prstDash!=null&&line.prstDash!=='solid')||!compound&&!nativeDash.has(line.prstDash??'solid'))review();
    css[0]=`border:${Number(width.toFixed(6))}pt ${style} ${stroke.color}`;
  }
  return css;
}
