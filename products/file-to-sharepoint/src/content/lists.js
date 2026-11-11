// Calculated values come from the packaged Word SDK, including inherited
// styles and list-instance overrides. Exact counters use native HTML lists;
// other verified markers remain literal text in editable paragraphs.
const formats={decimal:'decimal',lowerLetter:'lower-latin',upperLetter:'upper-latin',lowerRoman:'lower-roman',upperRoman:'upper-roman'};
export const cancelsNumbering=pr=>pr?.numId==='0'||pr?.numId===0;
export const isListParagraph=node=>node?.type==='paragraph'&&Boolean(node.ftsNumbering||node.pPr?.numPr&&!cancelsNumbering(node.pPr.numPr));
const validItemId=id=>typeof id==='string'&&/^[a-z0-9-]{1,100}$/i.test(id);
const hasVisibleMarker=text=>typeof text==='string'&&/[^\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(text);
const listNode=node=>isListParagraph(node)||node&&Object.hasOwn(node,'ftsListContinuation');

// Verify the engine's literal marker against HTML's counter representation.
// Word's alphabetic sequence after aa differs from CSS (bb versus ab).
function nativeMarker(style,value){
  if(style==='decimal')return String(value)+'.';
  if(style.endsWith('latin'))return value>=1&&value<=27?(value===27?'aa':String.fromCharCode(96+value))[style==='upper-latin'?'toUpperCase':'toLowerCase']()+'.':null;
  if(value<1||value>3999)return null;
  let text='',left=value;
  for(const [amount,symbol] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']])while(left>=amount){text+=symbol;left-=amount;}
  return (style==='lower-roman'?text.toLowerCase():text)+'.';
}

export function listInfo(node,warn){
  if(node?.type!=='paragraph')return null;
  const n=node.ftsNumbering;
  if(!n){
    if(node.pPr?.numPr&&!cancelsNumbering(node.pPr.numPr))warn('list-numbering-unverified','The Word engine did not verify this paragraph’s list numbering. Sending is blocked.',{blocking:true});
    return null;
  }
  const fmt=n.definition?.numFmt?.val,bullet=fmt==='bullet',markerless=fmt==='none';
  const valid=Number.isInteger(n.level)&&n.level>=0&&n.level<=8&&
    typeof n.numId==='string'&&n.numId.length>0&&n.numId.length<128&&
    typeof n.scopeId==='string'&&n.scopeId.length>0&&n.scopeId.length<128&&
    typeof fmt==='string'&&fmt.length>0&&fmt.length<=128&&
    typeof n.definition.lvlText==='string'&&n.definition.lvlText.length<=256&&(markerless||hasVisibleMarker(n.definition.lvlText))&&
    typeof n.label==='string'&&n.label.length<=256&&!/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(n.label)&&
    (n.font===undefined||typeof n.font==='string'&&n.font.length<=256);
  let style=markerless?'none':Object.hasOwn(formats,fmt)?formats[fmt]:null;
  const font=typeof n.font==='string'?n.font.trim().toLowerCase():'';
  if(bullet){
    const mark=n.definition.lvlText;
    // Symbol/wingding codepoints identify glyphs only together with the font.
    // For example, Wingdings F0B7 is a clock, not Symbol's bullet.
    // Symbol's B7 and F0B7 select the same bullet in the packaged SDK.
    style=['•','●'].includes(mark)||['\u00b7','\uf0b7'].includes(mark)&&font==='symbol'?'disc':
      ['◦','○'].includes(mark)||mark==='o'&&font==='courier new'?'circle':
      ['▪','■'].includes(mark)||mark==='\uf0a7'&&font==='wingdings'?'square':null;
  }
  const source=node.ftsListItem;
  const verifiedMarkerless=source?.markerless===true&&['task','toc'].includes(source.kind)&&n.label===''&&(n.definition.lvlText??'')===''&&(source.kind!=='task'||['checked','unchecked'].includes(source.taskState));
  const plainMarkerless=markerless&&source===undefined&&n.label===''&&n.definition.lvlText==='';
  const exact=markerless||bullet&&!!style||!!style&&n.definition.lvlText===`%${n.level+1}.`&&nativeMarker(style,n.value)===n.label;
  // A private-use or legacy font codepoint has no verified Unicode meaning.
  // Only the conventional mappings above can safely turn it into a marker.
  const unresolvedGlyph=!exact&&(/\p{Co}/u.test(n.label)||/^(?:symbol|wingdings(?: [1-3])?|webdings)$/.test(font));
  if(!valid||source?.markerless===true&&!markerless||markerless&&!verifiedMarkerless&&!plainMarkerless||
    !markerless&&(!hasVisibleMarker(n.label)||unresolvedGlyph)||bullet&&n.label!==n.definition.lvlText||
    !bullet&&!markerless&&(!Number.isInteger(n.value)||n.value<0||n.value>9999999)){
    warn('unsupported-list-numbering','This list’s source marker or numbering metadata could not be verified. Its text is available for review; sending is blocked.',{blocking:true});
    return null;
  }
  if(node.ftsListItem!==undefined&&!validItemId(node.ftsListItem?.itemId)){
    warn('list-continuation-unverified','The source list-item association could not be verified. Sending is blocked.',{blocking:true});return null;
  }
  if(markerless){
    style='disc';
    warn('markerless-list-adapted',plainMarkerless?'Intentionally marker-free Word entries use editable paragraphs. List indentation may differ in SharePoint.':'Markerless entries use SharePoint bullet lists so they remain stable during native editing. Task checkbox symbols remain editable text.');
  }
  const literalLabel=plainMarkerless?'':exact?undefined:n.label;
  if(literalLabel)warn('list-marker-adapted','Some verified list markers are preserved as editable text. Automatic numbering becomes text, and list indentation may differ in SharePoint.');
  return {...n,style,ordered:!bullet&&!markerless,key:JSON.stringify([n.scopeId,n.numId,n.level,style,fmt]),sourceItemId:source?.itemId,literalLabel};
}

export async function renderListContent(content,render,warn,count){
  let html='';const stack=[],sourceItems=new Set();
  // Literal items still have a source frame so their continuations cannot be
  // detached or mistaken for a child item's paragraphs, tables or pictures.
  const close=()=>{const item=stack.pop();if(item.info.literalLabel===undefined)html+=`</li></${item.info.ordered?'ol':'ul'}>`;};
  for(const node of content){
    if(node&&Object.hasOwn(node,'ftsListContinuation')){
      const id=node.ftsListContinuation?.itemId,index=validItemId(id)?stack.findIndex(item=>item.info.sourceItemId===id):-1;
      if(index>=0&&!node.ftsNumbering&&(!node.pPr?.numPr||cancelsNumbering(node.pPr.numPr))){
        while(stack.length>index+1)close();
        html+=await render(node);continue;
      }
      warn('list-continuation-unverified','A source list continuation has no verified preceding item or still carries a counter. Sending is blocked.',{blocking:true});
    }
    const info=listInfo(node,warn);
    if(!info){while(stack.length)close();html+=await render(node);continue;}
    if(info.sourceItemId){
      if(sourceItems.has(info.sourceItemId))warn('list-continuation-unverified','More than one source list item has the same identity. Continuation ownership is ambiguous; sending is blocked.',{blocking:true});
      sourceItems.add(info.sourceItemId);
    }
    while(stack.length&&stack.at(-1).info.level>info.level)close();
    if(info.literalLabel!==undefined){
      if(stack.at(-1)?.info.level===info.level)close();
      if(info.level!==(stack.length?stack.at(-1).info.level+1:0))warn('list-depth-review','Missing list levels were normalized around the available source items. No empty parent items were added.');
      stack.push({info,value:info.value});if(info.literalLabel)count(info.ordered);
      // Render through the normal paragraph path so escaping, source anchors,
      // inline formatting and block drawings keep their existing guarantees.
      html+=await render({...node,content:[...(info.literalLabel?[{type:'run',content:[info.literalLabel+' ']}]:[]),...(node.content??[])]});
      continue;
    }
    let current=stack.at(-1);
    if(current?.info.level===info.level){
      if(current.info.literalLabel===undefined&&current.info.key===info.key&&(!info.ordered||info.value===current.value+1)){
        html+='</li><li>';current.value=info.value;current.info=info;
      }else{close();current=null;}
    }else current=null;
    if(!current){
      if(info.level!==(stack.length?stack.at(-1).info.level+1:0))warn('list-depth-review','Missing list levels were normalized around the available source items. No empty parent items were added.');
      const tag=info.ordered?'ol':'ul';
      html+=`<${tag}${info.ordered?` start="${info.value}"`:''} style="list-style-type:${info.style}"><li>`;
      stack.push({info,value:info.value});
    }
    count(info.ordered);html+=await render(node);
  }
  while(stack.length)close();return html;
}

export function contentGroups(content){
  const groups=[];
  for(const node of content){
    if(listNode(node)&&listNode(groups.at(-1)?.[0]))groups.at(-1).push(node);
    else groups.push([node]);
  }
  return groups;
}
