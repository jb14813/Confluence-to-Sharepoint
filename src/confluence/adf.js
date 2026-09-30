// Converts a page's Atlassian Document Format (ADF) into the ordered text and
// picture parts of the capture model. Confluence live docs have no reading
// view, only the editor, so their content is read from ADF, Atlassian's
// documented page format, instead of from rendered markup:
// https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
// Output follows the same markup conventions as the reading-view capture.
import {HEADER_BACKGROUND,NUMBER_COLOR,NUMBER_COLUMN_WIDTH,PANEL_COLORS,SAFE_PANEL_COLOR,RULE_TEXT,badMetadata,clean,codeBlockHtml,compact,dateHtml,drawsSomething,emojiHtml,mentionHtml,emojiText,escape,headingSlug,inlineText,inlineCodeHtml,macroName,macroTitle,namesInSentence,panelHtml,panelIcon,pictureMarker,pictureShare,pictureSlot,sharePointColumns,standardPanelIcon,statusHtml,taskIndent,taskMarkHtml} from './html.js';
import {emojiName,omittedEmojiNote} from './emoji.js';
import {drawnBackground,drawnHighlight,drawnTextColor} from './palette.js';
import {isPicture,lossReason,pictureFileName} from './images.js';
import {NBSP,displayedText} from './whitespace.js';
import {LIST_CONTINUED,cutList,listPictures,numberingStyle} from './lists.js';
import {roadmapCutNote,roadmapHtml,roadmapSource} from './roadmap.js';

const EMPTY=Object.freeze({html:'',text:''});
// Confluence's default content width, which pixel-sized pictures are measured against.
export const CONTENT_WIDTH=760;
// The space between Confluence's layout columns: in a 760 px page, thirds are 221 px wide and halves 356 px (measured).
const COLUMN_GAP=48;
const ALIGN={center:'center',end:'right',right:'right',start:'left',left:'left',justify:'justify'};
const TOC_LABEL=/^(?:on this page|(?:table of )?contents)$/i;
const dateFormat=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const dateText=value=>{const date=new Date(Number(value));return Number.isFinite(date.getTime())?dateFormat.format(date):'';};
const children=node=>Array.isArray(node?.content)?node.content:[];
const isToc=node=>node?.type==='extension'&&node.attrs?.extensionKey==='toc';
const NESTED_LINKED='A picture inside a table, panel, quote or list became a link to its file, because capture could not place it there as a picture.';
const FORMAT_LINKED='A picture in a format other than PNG, JPEG, GIF, WebP or SVG became a link to its Confluence attachment.';
const EXTERNAL_LINKED='A picture shown from another website became a link to it, because it could not be copied from that website.';

const emojiOf=node=>({text:clean(node.attrs?.text),id:node.attrs?.id,shortName:clean(node.attrs?.shortName)});
/** Visible text of a node, as the reader sees it. */
function plain(node){
  if(!node||typeof node!=='object')return '';
  switch(node.type){
    case 'text':return clean(node.text);
    case 'emoji':return emojiText(emojiOf(node));
    case 'mention':case 'status':return clean(node.attrs?.text);
    // A template hint shows only while editing; readers see nothing there.
    case 'placeholder':return '';
    case 'date':return dateText(node.attrs?.timestamp);
    case 'inlineCard':return clean(node.attrs?.url);
    case 'hardBreak':return ' ';
    default:return children(node).map(plain).join('');
  }
}
// A "Contents" label directly above a table of contents goes with the omitted macro.
const withoutTocLabels=nodes=>nodes.filter((node,index)=>!(node?.type==='paragraph'&&isToc(nodes[index+1])&&TOC_LABEL.test(compact(plain(node)))));

/**
 * @param {object} doc Parsed ADF document.
 * @param {object} options
 * @param {string} options.pageUrl Page address, for resolving relative links.
 * @param {(fileId:string)=>({name:string,mime:string,url:string}|null)} options.attachment The page attachment holding a media file.
 * @param {(code:string,message:string,lost?:boolean)=>void} options.warn Records a conversion note once per code; `lost` marks content left out.
 * @returns {{parts:Array<{kind:'html',html:string,text:string}|{kind:'divider'}|{kind:'image',fileId?:string,url?:string,link?:{html:string,text:string},alt:string,caption:string,widthRatio:number,displayWidth?:number}>,headings:Array<{id:string,level:number,text:string}>,stats:object,lostPictures:Array<{name:string|null,reason:string}>}}
 */
export function convertAdf(doc,{pageUrl,attachment,warn}){
  if(doc?.type!=='doc'||!Array.isArray(doc.content))throw Object.assign(new Error('Confluence returned an invalid page document.'),{code:'metadata-invalid'});
  const stats={images:0,headings1:0,headings2:0,bullets:0,numbered:0,tables:0};
  const headings=[],headingIds=new Map(),used=new Set();
  // Custom emoji no standard emoji is similar to, by name (emojiName), for one note.
  const omittedEmoji=[];
  // Pictures marked as not copied ({name, reason}), for the note the capture writes with its own.
  const lostPictures=[];
  // Macros and synced blocks left out, by name (macroName), for one note, and mentions without a stored name.
  const omittedMacros=[];let unnamedMentions=0;
  let cellDepth=0,panelDepth=0,quoteDepth=0;
  // Pictures kept in table cells, panels and quotes, by the key of their slot, and the room each cell being read has, in
  // Confluence's pixels: its stored column widths, else its share of the room its table has.
  const slotted=[],cellRooms=[];
  // The room a picture has in the text being read: its cell's, else its page column's, else the page's.
  const roomHere=()=>cellRooms.at(-1)??columnWidth??CONTENT_WIDTH;

  // Heading anchors first, so internal links can point at any heading.
  (function collect(nodes){
    for(const node of nodes){
      if(node?.type==='heading'){
        const text=compact(plain(node));
        if(text){
          const level=Number.isInteger(node.attrs?.level)&&node.attrs.level>=1&&node.attrs.level<=6?node.attrs.level:2;
          const base=headingSlug(text)||'section-heading';let id=base;
          for(let suffix=2;used.has(id);suffix++)id=`${base}-${suffix}`;
          used.add(id);headingIds.set(node,{id,level});headings.push({id,level,text});
          if(level===1)stats.headings1++;if(level===2)stats.headings2++;
        }
      }
      collect(children(node));
    }
  })(doc.content);

  // A missing address is not worth a note; an unusable one is.
  function safeHref(value){
    if(typeof value!=='string'||!value)return null;
    try{
      if(badMetadata(value)||/\s/.test(value)||value.includes('\\'))throw new Error();
      if(value.startsWith('#')){
        const id=headingSlug(decodeURIComponent(value.slice(1)));
        if(id&&used.has(id))return `#${encodeURIComponent(id)}`;
        warn('unresolved-link','An internal link pointed to a heading that is not on this page; its text was kept without the link.');
        return null;
      }
      const url=new URL(value,pageUrl);
      if(!['https:','http:','mailto:'].includes(url.protocol)||url.username||url.password||url.protocol==='mailto:'&&!url.pathname)throw new Error();
      return url.href;
    }catch{warn('unsafe-link','An unsafe or invalid article link was preserved as ordinary text.');return null;}
  }
  const alignStyle=node=>{const value=node.marks?.find(mark=>mark?.type==='alignment')?.attrs?.align,align=Object.hasOwn(ALIGN,value??'')?ALIGN[value]:null;return align?` style="text-align:${align}"`:'';};
  const listStyle=()=>cellDepth?' style="overflow:visible"':'';
  // Numbering may start at 0, as a list continuing a count can.
  const listOrder=node=>Number.isInteger(node.attrs?.order)&&node.attrs.order>=0&&node.attrs.order<10_000_000?node.attrs.order:1;
  const link=(href,label)=>href?`<a href="${escape(href)}">${escape(label)}</a>`:escape(label);

  // `lines` are the pieces the text is drawn in (whitespace.js), null for a line break.
  function text(node,lines){
    const value=clean(node.text);
    const mark=type=>node.marks?.find(item=>item?.type===type);
    let html=lines?lines.map(piece=>piece===null?'<br>':escape(piece)).join(''):escape(value);
    if(mark('code'))html=inlineCodeHtml(html);
    const script=mark('subsup')?.attrs?.type;
    if(script==='sub'||script==='sup')html=`<${script}>${html}</${script}>`;
    if(mark('strike'))html=`<s>${html}</s>`;
    if(mark('underline'))html=`<u>${html}</u>`;
    if(mark('em'))html=`<em>${html}</em>`;
    if(mark('strong'))html=`<strong>${html}</strong>`;
    const color=mark('textColor')?.attrs?.color;
    // Stored colors come from Confluence's earlier palette; it draws them in its current one (palette.js).
    if(SAFE_PANEL_COLOR.test(color||''))html=`<span style="color:${drawnTextColor(color)}">${html}</span>`;
    const background=mark('backgroundColor')?.attrs?.color;
    if(SAFE_PANEL_COLOR.test(background||''))html=`<span style="background-color:${drawnHighlight(background)}">${html}</span>`;
    const target=mark('link');
    if(target){const href=safeHref(target.attrs?.href);if(href)html=`<a href="${escape(href)}">${html}</a>`;}
    return {html,text:value};
  }
  const words=(value,before,after)=>{const label=inlineText(value,plain(before),plain(after));return label?{html:escape(label),text:label}:EMPTY;};

  // Confluence draws text as written, so each text's lines are read from everything Confluence draws
  // around it (whitespace.js): anything but a template hint, which it shows only while editing.
  function inline(nodes){
    const parts=nodes.map((node,index)=>node?.type==='text'||node?.type==='hardBreak'?null:inlineNode(node,nodes[index-1],nodes[index+1]));
    const lines=displayedText(nodes.map(node=>node?.type==='text'?{text:clean(node.text),mode:'preserve'}:node?.type==='hardBreak'?'break':node?.type==='placeholder'?null:'atom'));
    let html='',value='';
    nodes.forEach((node,index)=>{
      const part=node?.type==='text'?text(node,lines[index]):node?.type==='hardBreak'?{html:'<br>',text:'\n'}:parts[index];
      html+=part.html;value+=part.text;
    });
    return {html,text:value};
  }
  function inlineNode(node,before,after){
    switch(node?.type){
      case 'text':return text(node);
      case 'hardBreak':return {html:'<br>',text:'\n'};
      case 'emoji':{
        const emoji=emojiOf(node),html=emojiHtml(emoji);
        if(html)return {html,text:emojiText(emoji)};
        omittedEmoji.push(emojiName(emoji));
        return EMPTY;
      }
      case 'placeholder':return EMPTY;
      case 'status':{const label=compact(plain(node));return label?{html:statusHtml(label,node.attrs?.color),text:label}:EMPTY;}
      case 'date':{const label=plain(node);return label?{html:dateHtml(label),text:label}:EMPTY;}
      case 'mention':{
        const label=compact(plain(node));if(label)return {html:mentionHtml(label),text:label};
        // A mention whose name the page does not store keeps its place as "@", and is noted.
        unnamedMentions++;return {html:mentionHtml('@'),text:'@'};
      }
      case 'inlineCard':{const href=safeHref(node.attrs?.url);return href?{html:link(href,href),text:href}:EMPTY;}
      case 'mediaInline':{
        warn('inline-media-simplified','An inline Confluence file or media item was retained as concise editable text when a useful label was available.');
        const file=typeof node.attrs?.id==='string'?attachment(node.attrs.id):null;
        return file?{html:link(file.url,file.name),text:file.name}:EMPTY;
      }
      case 'inlineExtension':return omittedMacro(node,true);
      default:
        warn('unknown-adf-feature','Unrecognized future Confluence features were captured from their visible static content where possible.');
        return node?.content?inline(children(node)):words(clean(node?.attrs?.text),before,after);
    }
  }

  function blocks(nodes){
    let html='',value='';
    for(const node of withoutTocLabels(nodes)){const part=block(node);html+=part.html;value+=` ${part.text} `;}
    return {html,text:value};
  }
  // A macro or synced block whose content the page does not store is marked where it was (inline, within a
  // line of text) and named in one note; a table of contents is left out, as is an anchor, which draws nothing.
  function omittedMacro(node,inline=false){
    if(isToc(node)){warn('toc-omitted','The Confluence table of contents was omitted because its links do not become a functional SharePoint table of contents.');return EMPTY;}
    if(node?.attrs?.extensionKey==='anchor')return EMPTY;
    omittedMacros.push(macroName(node));
    const title=macroTitle(node),label=node?.type==='syncBlock'?'[Synced block not copied]':`[Macro not copied${title?`: ${title}`:''}]`;
    return inline?{html:escape(label),text:label}:{html:`<p>${escape(label)}</p>`,text:label};
  }
  function listItems(list,counter){
    let html='',value='';
    for(const item of children(list)){
      if(item?.type!=='listItem')continue;
      stats[counter]++;
      // An empty item still shows its number or bullet; a no-break space keeps it in SharePoint's editor.
      const part=blocks(children(item));html+=`<li>${drawsSomething(part.html,part.text)?part.html:NBSP}</li>`;value+=` ${part.text} `;
    }
    return {html,text:value};
  }
  const markOf=item=>item.type==='decisionItem'?(item.attrs?.state==='DECIDED'?'decided':'undecided'):item.attrs?.state==='DONE'?'done':'todo';
  // A task or decision list's items as lines ({mark, depth, html, text}), nested
  // lists' items one level deeper; null when an item holds a block other than
  // text, which cannot sit in a line.
  function checklistLines(list,depth){
    const lines=[];
    for(const item of children(list)){
      if(item?.type==='taskList'||item?.type==='decisionList'){const nested=checklistLines(item,depth+1);if(!nested)return null;lines.push(...nested);continue;}
      if(!['taskItem','blockTaskItem','decisionItem'].includes(item?.type))continue;
      if(item.type!=='blockTaskItem'){lines.push({mark:markOf(item),depth,...inline(children(item))});continue;}
      const nested=[],pieces=[];
      for(const child of children(item)){
        if(child?.type==='taskList'||child?.type==='decisionList'){const inner=checklistLines(child,depth+1);if(!inner)return null;nested.push(...inner);}
        else if(child?.type==='paragraph'||child?.type==='heading'){const piece=inline(children(child));if(drawsSomething(piece.html,piece.text))pieces.push(piece);}
        else return null;
      }
      lines.push({mark:markOf(item),depth,html:pieces.map(piece=>piece.html).join('<br>'),text:pieces.map(piece=>piece.text).join(' ')},...nested);
    }
    return lines;
  }
  // The list items of a task list whose items hold other blocks.
  function checklist(list){
    let html='',value='';
    for(const item of children(list)){
      if(item?.type==='taskList'||item?.type==='decisionList'){const nested=checklist(item);html+=nested.html;value+=nested.text;continue;}
      if(!['taskItem','blockTaskItem','decisionItem'].includes(item?.type))continue;
      const part=item.type==='blockTaskItem'?blocks(children(item)):inline(children(item));
      stats.bullets++;
      html+=`<li>${taskMarkHtml(markOf(item))} ${part.html}</li>`;value+=` ${part.text} `;
    }
    return {html,text:value};
  }
  // Pictures and files that cannot become SharePoint Image controls link to
  // their source instead, followed by any caption; `note` explains why, given
  // the Confluence attachment or, for a picture from another website, `{external}`.
  // A picture (`picture`, a mediaSingle's) whose attachment is not found is marked where it was.
  function mediaLinks(node,note,picture=false){
    let html='',value='';
    for(const media of children(node).filter(child=>child?.type==='media')){
      let href=null,label=compact(clean(media.attrs?.alt));
      if(media.attrs?.type==='external'){
        href=safeHref(media.attrs.url);label=label||href||'';note({external:href});
      }else{
        const file=typeof media.attrs?.id==='string'?attachment(media.attrs.id):null;
        if(file){href=file.url;label=file.name;note(file);}
        else if(picture){
          // Named by its description, the nearest to a name the stored page gives it.
          const name=pictureFileName(label),marker=pictureMarker(name,null);
          lostPictures.push({name,reason:lossReason({code:'invalid-attachment'})});html+=marker.html;value+=marker.text;continue;
        }
        else warn('missing-attachment','A file in an attachment group was not copied, because its Confluence attachment could not be found; its description was kept when it had one. Add it in SharePoint if it is needed.',true);
      }
      if(label){html+=`<p>${link(href,label)}</p>`;value+=` ${label} `;}
    }
    const caption=compact(plain(children(node).find(child=>child?.type==='caption')));
    if(caption){html+=`<p>${escape(caption)}</p>`;value+=` ${caption} `;}
    return {html,text:value};
  }
  // Why a picture capture cannot copy became a link: the website it is shown from, or its format.
  const unplaced=file=>'external' in file?warn('external-image-linked',EXTERNAL_LINKED):warn('image-format-linked',FORMAT_LINKED);
  function table(node){
    const rows=children(node).filter(row=>row?.type==='tableRow');
    const cellsOf=row=>children(row).filter(cell=>cell?.type==='tableHeader'||cell?.type==='tableCell');
    const widthOf=cell=>Array.isArray(cell.attrs?.colwidth)&&cell.attrs.colwidth.length&&cell.attrs.colwidth.every(width=>Number.isFinite(width)&&width>0&&width<=100_000)
      ?cell.attrs.colwidth.reduce((sum,width)=>sum+width,0):null;
    // A numbered table shows a number before each row that is not a header row, in a 42 px column.
    const numbered=node.attrs?.isNumberColumnEnabled===true;let number=0;
    const firstRow=rows.length?cellsOf(rows[0]):[];
    const fixed=firstRow.length+(numbered?1:0)>1&&firstRow.every(cell=>widthOf(cell)!==null);
    let html='',value='';
    for(const row of rows){
      const cells=cellsOf(row);
      // A row that only labels a table of contents disappears with the omitted macro.
      if(cells.length===2){
        const macroOnly=cells.findIndex(cell=>children(cell).some(isToc)&&children(cell).every(child=>isToc(child)||child?.type==='paragraph'&&!compact(plain(child))));
        if(macroOnly>=0&&TOC_LABEL.test(compact(plain(cells[1-macroOnly])))){omittedMacro(children(cells[macroOnly]).find(isToc));continue;}
      }
      const widths=cells.map(widthOf),total=widths.every(width=>width!==null)?widths.reduce((sum,width)=>sum+width,numbered?NUMBER_COLUMN_WIDTH:0):0;
      // Without stored widths a row's columns share the room the table has, by how many each cell spans.
      const spans=cells.map(cell=>Number.isInteger(cell.attrs?.colspan)&&cell.attrs.colspan>1?cell.attrs.colspan:1),columns=spans.reduce((sum,span)=>sum+span,0)||1,tableRoom=roomHere();
      if(total)warn('table-width-review','Table text, cell formatting, and source column proportions were captured; review responsive widths in SharePoint.');
      let cellsHtml='';
      if(numbered&&cells.length){
        const header=cells.every(cell=>cell.type==='tableHeader'),label=header?'':String(++number);
        cellsHtml+=`<td style="background-color:${HEADER_BACKGROUND};color:${NUMBER_COLOR}${total?`;width:${Math.round(NUMBER_COLUMN_WIDTH/total*1_000_000)/10_000}%`:''};text-align:center;vertical-align:top">${label}</td>`;
        if(label)value+=` ${label} `;
      }
      cells.forEach((cell,index)=>{
        const header=cell.type==='tableHeader',attributes=header?['scope="col"']:[],styles=[];
        for(const name of ['colspan','rowspan'])if(Number.isInteger(cell.attrs?.[name])&&cell.attrs[name]>1&&cell.attrs[name]<=1000)attributes.push(`${name}="${cell.attrs[name]}"`);
        if(SAFE_PANEL_COLOR.test(cell.attrs?.background||''))styles.push(`background-color:${drawnBackground(cell.attrs.background)}`);
        else if(header)styles.push(`background-color:${HEADER_BACKGROUND}`);
        if(total)styles.push(`width:${Math.round(widths[index]/total*1_000_000)/10_000}%`);
        if(header)styles.push('text-align:left');
        // Confluence draws a cell's content from its top (measured); SharePoint centers it unless told.
        styles.push('vertical-align:top');
        attributes.push(`style="${styles.join(';')}"`);
        cellDepth++;cellRooms.push(widths[index]??tableRoom*spans[index]/columns);const part=blocks(children(cell));cellRooms.pop();cellDepth--;
        const tag=header?'th':'td';
        cellsHtml+=`<${tag}${attributes.length?' '+attributes.join(' '):''}>${part.html}</${tag}>`;
        value+=` ${part.text} `;
      });
      if(cellsHtml)html+=`<tr>${cellsHtml}</tr>`;
    }
    if(!html)return EMPTY;
    stats.tables++;
    return {html:`<table style="width:100%${fixed?';table-layout:fixed':''}"><tbody>${html}</tbody></table>`,text:value};
  }

  function block(node){
    switch(node?.type){
      case 'paragraph':{
        const part=inline(children(node));
        return drawsSomething(part.html,part.text)?{html:`<p${alignStyle(node)}>${part.html}</p>`,text:part.text}:EMPTY;
      }
      case 'heading':{
        const heading=headingIds.get(node);if(!heading)return EMPTY;
        const part=inline(children(node));
        return {html:`<h${heading.level} id="${heading.id}"${alignStyle(node)}>${part.html}</h${heading.level}>`,text:part.text};
      }
      case 'bulletList':{const part=listItems(node,'bullets');return part.html?{html:`<ul${listStyle()}>${part.html}</ul>`,text:part.text}:EMPTY;}
      case 'orderedList':{
        const order=listOrder(node),part=listItems(node,'numbered');
        return part.html?{html:`<ol${order!==1?` start="${order}"`:''}${listStyle()}>${part.html}</ol>`,text:part.text}:EMPTY;
      }
      case 'taskList':case 'decisionList':{
        const lines=checklistLines(node,0);
        if(lines){
          if(!lines.length)return EMPTY;
          stats.bullets+=lines.length;
          const paragraph=`<p>${lines.map(line=>`${taskIndent(line.depth)}${taskMarkHtml(line.mark)} ${line.html}`).join('<br>')}</p>`,value=lines.map(line=>line.text).join(' ');
          // Confluence draws decisions in a grey box, as a one-cell table draws in SharePoint.
          if(!lines.every(line=>line.mark==='decided'||line.mark==='undecided'))return {html:paragraph,text:value};
          stats.tables++;
          return {html:panelHtml(paragraph,HEADER_BACKGROUND),text:value};
        }
        const part=checklist(node);return part.html?{html:`<ul${listStyle()}>${part.html}</ul>`,text:part.text}:EMPTY;
      }
      case 'blockquote':{quoteDepth++;const part=blocks(children(node));quoteDepth--;return part.html?{html:`<blockquote>${part.html}</blockquote>`,text:part.text}:EMPTY;}
      case 'codeBlock':{const code=children(node).map(child=>clean(child?.text)).join('');return {html:codeBlockHtml(code),text:code};}
      case 'rule':return {html:`<p>${RULE_TEXT}</p>`,text:RULE_TEXT};
      case 'panel':{
        panelDepth++;const type=node.attrs?.panelType,part=blocks(children(node));panelDepth--;
        // An empty panel is still drawn: its color and icon, one line tall.
        let html=drawsSomething(part.html,part.text)?part.html:`<p>${NBSP}</p>`,value=part.text;
        const icon=type==='custom'?panelIcon({text:node.attrs?.panelIconText,id:node.attrs?.panelIconId,shortName:node.attrs?.panelIcon}):standardPanelIcon(type);
        if(icon&&!compact(value).startsWith(icon.text)){
          const decorated=html.replace(/<(p|h[1-6])([^>]*)>/i,`<$1$2>${icon.html} `);
          html=decorated===html?`${icon.html} ${html}`:decorated;value=`${icon.text} ${value}`;
        }
        const custom=SAFE_PANEL_COLOR.test(node.attrs?.panelColor||'')?drawnBackground(node.attrs.panelColor):null;
        const color=(Object.hasOwn(PANEL_COLORS,type??'')?PANEL_COLORS[type]:null)||(type==='custom'?custom:null);
        if(!color)warn('panel-simplified','An unfamiliar Confluence panel was retained as editable text without its special presentation.');
        stats.tables++;
        return {html:panelHtml(html,color),text:` ${value} `};
      }
      case 'table':return table(node);
      case 'expand':case 'nestedExpand':{
        const title=compact(clean(node.attrs?.title)),part=blocks(children(node));
        return {html:`${title?`<p><strong>${escape(title)}</strong></p>`:''}${part.html}`,text:`${title} ${part.text}`};
      }
      case 'layoutSection':{
        const columns=children(node).filter(column=>column?.type==='layoutColumn');
        if(columns.length<2)return blocks(columns.flatMap(children));
        // Reached only inside a table, panel, list or quote: SharePoint columns cannot be placed there.
        warn('layout-mapped','A Confluence column layout inside a table, panel, list or quote was kept side by side in a table, because SharePoint columns cannot be placed there.');
        let html='',value='';
        cellDepth++;
        for(const column of columns){
          const width=Number(column.attrs?.width);cellRooms.push(roomHere()*(width>0&&width<100?width/100:1/columns.length));const part=blocks(children(column));cellRooms.pop();
          html+=`<td style="${width>0&&width<100?`width:${Math.round(width*10_000)/10_000}%;`:''}vertical-align:top">${part.html}</td>`;value+=` ${part.text} `;
        }
        cellDepth--;
        stats.tables++;
        return {html:`<table style="width:100%"><tbody><tr>${html}</tr></tbody></table>`,text:value};
      }
      case 'extension':case 'syncBlock':{
        // A roadmap's stored data draws it as a table (roadmap.js); other macros store only their settings.
        const table=node.type==='extension'&&node.attrs?.extensionKey==='roadmap'?roadmapHtml(roadmapSource(node.attrs?.parameters?.macroParams)):null;
        if(!table)return omittedMacro(node);
        warn('roadmap-table','A Confluence roadmap became a table: its months as columns and each lane’s bars in the months they cover.');
        const cut=roadmapCutNote(table.cut);if(cut)warn('roadmap-cut',cut,true);
        stats.tables++;
        return table;
      }
      case 'bodiedExtension':case 'bodiedSyncBlock':case 'extensionFrame':
        warn('macro-static-content','Static visible macro content was retained. Live macro behavior was not copied.');
        return blocks(children(node));
      case 'multiBodiedExtension':return blocks(children(node));
      case 'blockCard':case 'embedCard':{
        warn('live-embed-omitted','Live embedded content was omitted; its source link was retained when available.');
        const href=safeHref(node.attrs?.url);
        return href?{html:`<p>${link(href,href)}</p>`,text:href}:EMPTY;
      }
      case 'mediaGroup':
        return mediaLinks(node,()=>warn('media-group-simplified','A Confluence attachment group was preserved as ordinary authenticated file links. Card controls and dates were omitted.'));
      // Reached only inside text: `flow` places or links pictures in the page flow.
      case 'mediaSingle':{
        // In a table cell, a panel or a quote, a picture capture can place stays there, as SharePoint's own inline
        // picture: a slot here, its file copied with the page's pictures (stored.js). Otherwise it is a link, its note
        // saying why: where it is, or, as in the page's flow, where it is shown from or its format.
        const kept=cellDepth||panelDepth||quoteDepth?inlinePicture(node):null;
        if(kept){slotted.push(kept);return {html:pictureSlot(slotted.length-1),text:''};}
        const placeable=pictureSource(node).placeable;
        return mediaLinks(node,file=>placeable?warn('nested-image-linked',NESTED_LINKED):unplaced(file),true);
      }
      default:
        warn('unknown-adf-feature','Unrecognized future Confluence features were captured from their visible static content where possible.');
        return node?.content?blocks(children(node)):EMPTY;
    }
  }
  // A picture in the page flow becomes its own image part, like the
  // reading-view capture. Null leaves it to be linked by `block`. A picture
  // shown from another website carries its address, and the link that
  // replaces it if that website does not let capture copy it.
  // What a picture shows: its media, and its file or its (made safe) address on another website; placeable when capture
  // can make it a picture part: a picture file, or an address over https.
  function pictureSource(node){
    const media=children(node).find(child=>child?.type==='media');
    const file=media?.attrs?.type==='file'&&typeof media.attrs.id==='string'?attachment(media.attrs.id):null;
    const external=media?.attrs?.type==='external'?safeHref(media.attrs.url):null;
    return {media,file,external,placeable:Boolean(external?.startsWith('https:')||file&&isPicture(file.mime))};
  }
  // A picture kept in a table cell, panel or quote, to be copied with the page's pictures: its file or address, its text,
  // the width Confluence shows it at and that share of the room it has (null when only its file tells), and that room.
  function inlinePicture(node){
    const {media,file,external,placeable}=pictureSource(node);
    if(!placeable)return null;
    const alt=Array.from(compact(clean(media.attrs.alt))).slice(0,1000).join(''),caption=compact(plain(children(node).find(child=>child?.type==='caption'))).slice(0,1000);
    if(file&&!alt)warn('missing-alt','Some images have no authored alternative text. Review their captions and add alternative text in SharePoint.');
    const width=Number(node.attrs?.width),room=roomHere();
    const href=safeHref(media.marks?.find(mark=>mark?.type==='link')?.attrs?.href);
    // The width Confluence shows it at, no wider than the room it has: set in pixels, or as a share of that room; with
    // none, its file's own, once copied (stored.js). SharePoint shows it at that share of the room it gives (html.js).
    const displayWidth=width>0?Math.max(1,Math.round(Math.min(room,node.attrs?.widthType==='pixel'?width:width<=100?width/100*room:room))):null;
    return {...(file?{fileId:media.attrs.id}:{url:external,link:{html:`<p>${link(external,alt||external)}</p>${caption?`<p>${escape(caption)}</p>`:''}`,text:compact(`${alt||external} ${caption}`)}}),
      alt,caption,displayWidth,share:displayWidth?pictureShare(displayWidth,room/CONTENT_WIDTH):null,room,
      ...(href&&/^https?:/i.test(href)?{href}:{})};
  }
  function picture(node){
    const {media,file,external,placeable}=pictureSource(node);
    if(!placeable)return null;
    const alt=Array.from(compact(clean(media.attrs.alt))).slice(0,1000).join(''),caption=compact(plain(children(node).find(child=>child?.type==='caption')));
    const notes=[];
    if(media.marks?.some(mark=>mark?.type==='border'))notes.push(['media-border-simplified','A Confluence media border was simplified because SharePoint image controls do not preserve that border style.']);
    if(!alt)notes.push(['missing-alt','Some images have no authored alternative text. Review their captions and add alternative text in SharePoint.']);
    if(!caption)notes.push(['missing-caption','One or more images have no immediately following centered caption.']);
    // A picture from another website may become a link instead, so its notes wait for its download.
    if(file)for(const [code,message] of notes)warn(code,message);
    const width=Number(node.attrs?.width);
    const widthRatio=node.attrs?.widthType==='pixel'&&width>0?Math.min(1,width/CONTENT_WIDTH):width>0&&width<=100?width/100:1;
    // The width Confluence shows the picture at: set in pixels, or as a share of its content width, and no wider than its column.
    const set=node.attrs?.widthType==='pixel'&&width>0?Math.round(width):width>0&&width<=100?Math.round(width/100*CONTENT_WIDTH):null;
    const displayWidth=set&&columnWidth?Math.min(set,columnWidth):set;
    const source=file?{fileId:media.attrs.id}:{url:external,link:{html:`<p>${link(external,alt||external)}</p>${caption?`<p>${escape(caption)}</p>`:''}`,text:compact(`${alt||external} ${caption}`)},notes};
    // The picture's own link, kept on its Image web part when it is a web address.
    const href=safeHref(media.marks?.find(mark=>mark?.type==='link')?.attrs?.href);
    return {kind:'image',...source,alt,caption:caption.length<=1000?caption:'',widthRatio,...(displayWidth?{displayWidth}:{}),...(href&&/^https?:/i.test(href)?{href}:{})};
  }

  // `place` is the SharePoint section column the parts being read go in ({id, factors, column}), as in the reading-view capture.
  const parts=[];let pending={html:'',text:''},afterList=false,place,columnWidth=null,sectionCount=0;
  const placed=()=>place?{place}:{};
  // Kept whenever it draws something, as in a template to fill in: a table's grid with empty cells,
  // a list's numbers with empty items, a blank line.
  const flush=()=>{if(drawsSomething(pending.html,pending.text))parts.push({kind:'html',html:pending.html,text:compact(pending.text),...placed()});pending={html:'',text:''};};
  const append=(part,type)=>{
    if(!part.html)return;
    // A paragraph right after a list keeps a visual break, like the reading-view capture.
    pending.html+=afterList&&type==='paragraph'?part.html.replace(/^<p(\s[^>]*)?>/,match=>`${match}<br>`):part.html;
    pending.text+=` ${part.text} `;
    afterList=/^<(?:ul|ol)[\s>]/.test(part.html);
  };
  const placePicture=node=>{
    const image=picture(node);
    if(image){flush();parts.push({...image,...placed()});afterList=false;}
    // A picture capture cannot place: another format, or an address that is not secure.
    else append(mediaLinks(node,unplaced,true),node.type);
  };
  // A list with pictures in its steps is cut at them (lists.js), as the reading-view capture cuts it; a picture
  // `picture` cannot place stays in its step as a link.
  const listItemsOf=node=>children(node).filter(item=>item?.type==='listItem');
  const lists={
    list:node=>node?.type==='orderedList'?{ordered:true,start:listOrder(node),items:listItemsOf(node)}:node?.type==='bulletList'?{ordered:false,start:1,items:listItemsOf(node)}:null,
    children:item=>withoutTocLabels(children(item)),
    isPicture:node=>node?.type==='mediaSingle'&&pictureSource(node).placeable,
    inline:()=>false,
    render:node=>block(node),
    open(node,{start,fresh,depth}){
      const ordered=node.type==='orderedList',from=fresh?listOrder(node):start,style=depth?` style="list-style-type:${numberingStyle(ordered,depth)}"`:'';
      // SharePoint takes a start of at most seven digits; past it the piece restarts.
      if(from>9_999_999)warn('list-simplified','A list’s unusual numbering was replaced with standard numbering; check it in SharePoint.');
      return ordered?`<ol${from!==1&&from<=9_999_999?` start="${from}"`:''}${style}>`:`<ul${style}>`;
    },
    counted:list=>{stats[list.ordered?'numbered':'bullets']++;},
  };
  (function flow(nodes){
    for(const node of withoutTocLabels(nodes)){
      // A rule in the page's flow is SharePoint's Divider; inside text (`block`) it stays a line of text.
      if(node?.type==='rule'){flush();parts.push({kind:'divider',...placed()});afterList=false;continue;}
      if(node?.type==='mediaSingle'){placePicture(node);continue;}
      if(listPictures(node,lists)){
        for(const piece of cutList(node,lists)){
          if(piece.kind==='picture'){placePicture(piece.node);continue;}
          if(piece.continued)warn('list-steps-continued',LIST_CONTINUED);
          append(piece,'list');afterList=/<\/(?:ul|ol)>$/.test(piece.html);
        }
        continue;
      }
      // A macro's body, as an excerpt's, is in the page's flow, as the reading view shows it, so its pictures remain pictures.
      if(['bodiedExtension','bodiedSyncBlock','extensionFrame','multiBodiedExtension'].includes(node?.type)){
        if(node.type!=='multiBodiedExtension')warn('macro-static-content','Static visible macro content was retained. Live macro behavior was not copied.');
        flow(children(node));continue;
      }
      // Expanded sections and single columns stay in the page flow, so their pictures remain pictures.
      if(node?.type==='expand'){
        const title=compact(clean(node.attrs?.title));
        if(title)append({html:`<p><strong>${escape(title)}</strong></p>`,text:title},'paragraph');
        flow(children(node));continue;
      }
      const columns=node?.type==='layoutSection'?children(node).filter(column=>column?.type==='layoutColumn'):null;
      if(columns&&columns.length<2){flow(columns.flatMap(children));continue;}
      // A column layout becomes a SharePoint section with the nearest columns, its pictures and text in their columns.
      if(columns&&!place){
        const widths=columns.map(column=>Number(column.attrs?.width)),plan=sharePointColumns(widths);
        if(plan.simplified)warn('layout-simplified','A Confluence column layout SharePoint has no match for was given the nearest SharePoint columns: SharePoint sections have one, two or three columns. Check its layout in SharePoint.');
        for(const group of plan.groups){
          const id=++sectionCount;
          group.columns.forEach((index,position)=>{
            flush();place={id,factors:group.factors,column:position+1};afterList=false;
            columnWidth=Math.round((CONTENT_WIDTH-(columns.length-1)*COLUMN_GAP)*(widths[index]>0?widths[index]/100:1/columns.length));
            flow(children(columns[index]));flush();
          });
        }
        place=undefined;columnWidth=null;afterList=false;continue;
      }
      append(block(node),node?.type);
    }
  })(doc.content);
  flush();
  if(omittedEmoji.length)warn('emoji-omitted',omittedEmojiNote(omittedEmoji),true);
  if(unnamedMentions)warn('mention-unnamed',unnamedMentions===1?'A mention whose name the page does not store was kept as “@”; add the person’s name in SharePoint.'
    :`${unnamedMentions} mentions whose names the page does not store were kept as “@”; add the people’s names in SharePoint.`,true);
  if(omittedMacros.length){const one=omittedMacros.length===1;
    warn('macro-omitted',`${namesInSentence(omittedMacros)} ${one?'was':'were'} not copied, because the page does not store what ${one?'it shows':'they show'}. ${one?'It is':'Each is'} marked where it was in the draft; add ${one?'an equivalent':'equivalents'} in SharePoint if ${one?'it is':'they are'} needed.`,true);}
  return {parts,headings,stats,lostPictures,inline:slotted};
}
