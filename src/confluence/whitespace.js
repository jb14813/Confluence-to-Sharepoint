// Confluence draws text as it is written: its reading view and editor keep every
// space and line break (CSS white-space: pre-wrap, measured on Confluence Cloud),
// so a template's line breaks make a cell or list item several lines tall and its
// leading spaces indent a line. HTML, and SharePoint with it, collapses white
// space, so text is given the lines Confluence draws in HTML's terms.

export const NBSP='\u00a0';

/**
 * The pieces one block's text becomes (a paragraph, heading, list item or cell,
 * or the text between blocks inside one), so SharePoint draws the lines
 * Confluence draws:
 * - a line break becomes a break (null);
 * - spaces before a line's first character become no-break spaces, a tab up to
 *   its next tab stop, as do all but the first of a run of spaces within a line;
 * - a line of only spaces keeps one no-break space, which keeps the line drawn;
 * - a block's final line break, which Confluence does not draw, is left out
 *   (SharePoint's editor would draw a line after it), and a blank line it leaves
 *   last keeps a no-break space.
 * Spaces ending a line are kept as they are: Confluence lets them hang unseen and
 * HTML collapses them. Text Confluence collapses itself is left as it is.
 *
 * @param {Array<{text:string,mode:'preserve'|'breaks'|'collapse',tabSize?:number}|'break'|'atom'|null>} tokens
 *   The block's content in reading order: text, with how Confluence treats its
 *   white space ('preserve' keeps spaces and line breaks, 'breaks' only line
 *   breaks); a line break element; anything else drawn in a line, such as a
 *   picture or a label; or null for something that draws nothing.
 * @returns {Array<Array<string|null>|null>} For each text token its pieces, text
 *   and null for a line break; null for the other tokens.
 */
export function displayedText(tokens) {
  const out=tokens.map(token=>token&&typeof token==='object'?[]:null);
  // Each character of text, and each line break or other piece, in reading order.
  const cells=[];
  tokens.forEach((token,index)=>{
    if(token==='break'||token==='atom'){cells.push({index,kind:token});return;}
    if(!token||typeof token!=='object')return;
    const tabSize=Number.isInteger(token.tabSize)&&token.tabSize>0?token.tabSize:8;
    for(const char of String(token.text).replace(/\r\n?/g,'\n')) {
      const space=char===' '||char==='\t';
      const kind=token.mode==='collapse'?(space||char==='\n'?'soft':'content')
        :char==='\n'?'newline':space?(token.mode==='preserve'?'space':'soft'):'content';
      cells.push({index,kind,char,tabSize});
    }
  });
  const emit=(cell,value)=>{if(out[cell.index])out[cell.index].push(value);};
  const lines=[];let current=[];
  for(const cell of cells) {
    if(cell.kind==='newline'||cell.kind==='break'){lines.push({cells:current,end:cell});current=[];}
    else current.push(cell);
  }
  lines.push({cells:current,end:null});
  // A final line break draws no line after it: it is left out, unless the line it ends is blank.
  let final=null;
  if(lines.length>1&&!lines.at(-1).cells.length&&lines.at(-2).end.kind==='newline'){final=lines.at(-2).end;lines.pop();}
  for(const line of lines) {
    const drawn=line.cells.map((cell,position)=>cell.kind==='content'||cell.kind==='atom'?position:-1).filter(position=>position>=0);
    const first=drawn.length?drawn[0]:-1,last=drawn.length?drawn.at(-1):-1;
    // The column reached, in characters from the line's start, for a tab's next stop.
    let column=0,held=false,inRun=false;
    line.cells.forEach((cell,position)=>{
      if(cell.kind!=='space'){
        if(cell.kind!=='atom'&&cell.kind!=='break')emit(cell,cell.char);
        if(cell.kind==='content'||cell.kind==='atom')column++;
        inRun=false;return;
      }
      // A line of only spaces: one no-break space keeps it drawn.
      if(first<0){emit(cell,held?'':NBSP);held=true;return;}
      const width=cell.char==='\t'?cell.tabSize-column%cell.tabSize:1;column+=width;
      // The line's indent.
      if(position<first){emit(cell,NBSP.repeat(width));return;}
      // Spaces ending the line hang unseen in Confluence; HTML collapses them.
      if(position>last){emit(cell,cell.char);return;}
      // Within the line the first space of a run stays an ordinary space, where the line may wrap.
      emit(cell,inRun?NBSP.repeat(width):' '+NBSP.repeat(width-1));inRun=true;
    });
    if(line.end?.kind==='newline')emit(line.end,line.end===final?(line.cells.length?'':NBSP):null);
  }
  // Adjacent text joined, empty text left out.
  return out.map(pieces=>pieces&&pieces.reduce((joined,piece)=>{
    if(piece==='')return joined;
    if(piece!==null&&typeof joined.at(-1)==='string')joined[joined.length-1]+=piece;else joined.push(piece);
    return joined;
  },[]));
}

// Displays whose text belongs to the lines of the block around them.
const INLINE=new Set(['inline','contents']);
// Parts of a line drawn as one piece, whose text is their own: labels, emoji, links shown as cards,
// pictures and controls. Code blocks keep their text in <pre> (see codeBlockHtml).
const WIDGETS='[data-testid="renderer-code-block"],pre,[data-node-type="status"],[data-node-type="date"],[data-mention-id],[data-inline-card],'+
  '[data-emoji-id],[data-emoji-short-name],[data-emoji-text],[data-node-type="media"],[data-node-type="mediaInline"],button,input,select,textarea,img,svg,video,canvas,iframe,object,embed';

/**
 * Gives `copy`, a copy of `original` made just now with nothing changed in
 * between, the lines Confluence draws for the text of `original`: where the
 * page's style keeps white space, line breaks become <br> and spaces follow
 * `displayedText`. `original` must be on the page, where its style can be read.
 * `ignore` selects what the caller removes from the copy, such as controls
 * Confluence shows only at times (a heading's link button): it draws nothing in
 * the copy's lines.
 */
export function keepWhitespace(original,copy,{ignore}={}) {
  const ignored=node=>Boolean(ignore)&&node.matches(ignore);
  const view=original.ownerDocument?.defaultView;
  if(!view?.getComputedStyle)return;
  const styles=new Map(),style=element=>{let value=styles.get(element);if(!value)styles.set(element,value=view.getComputedStyle(element));return value;};
  const mode=element=>{
    const value=style(element),collapse=value.whiteSpaceCollapse;
    if(collapse)return collapse==='collapse'?'collapse':collapse==='preserve-breaks'?'breaks':'preserve';
    return /^(?:pre|pre-wrap|break-spaces)$/.test(value.whiteSpace)?'preserve':value.whiteSpace==='pre-line'?'breaks':'collapse';
  };
  const tabSize=element=>{const value=Number(style(element).tabSize);return Number.isInteger(value)&&value>0?value:8;};
  const texts=root=>{const list=[],walker=root.ownerDocument.createTreeWalker(root,4);for(let node=walker.nextNode();node;node=walker.nextNode())list.push(node);return list;};
  const originals=texts(original),copies=texts(copy);
  if(originals.length!==copies.length)return;
  const pairs=new Map(originals.map((node,index)=>[node,copies[index]]));
  // The nearest element drawn as a block: the lines its text is laid out in.
  const blockOf=text=>{
    for(let element=text.parentElement;element;element=element.parentElement) {
      if(element===original)return element;
      const display=style(element).display;
      if(display==='none')return null;
      if(!INLINE.has(display))return element;
    }
    return null;
  };
  const blocks=new Set();
  for(const text of originals) {
    if(!/[\n\t]| {2}|^ | $/.test(text.data)||!text.parentElement||text.parentElement.closest(WIDGETS)||ignore&&text.parentElement.closest(ignore)||mode(text.parentElement)==='collapse')continue;
    const block=blockOf(text);if(block&&!block.closest(WIDGETS))blocks.add(block);
  }
  const changes=[];
  for(const block of blocks) {
    // The block's lines: its own text, broken where another block sits inside it.
    const runs=[[]];
    const walk=element=>{
      for(const child of element.childNodes) {
        if(child.nodeType===3){runs.at(-1).push({text:child.data,mode:mode(element),tabSize:tabSize(element),node:child});continue;}
        if(child.nodeType!==1||ignored(child))continue;
        const display=style(child).display;
        if(display==='none')continue;
        if(child.tagName==='BR')runs.at(-1).push('break');
        else if(child.matches(WIDGETS)||display.startsWith('inline')&&!INLINE.has(display))runs.at(-1).push('atom');
        else if(INLINE.has(display))walk(child);
        else runs.push([]);
      }
    };
    walk(block);
    for(const run of runs) {
      displayedText(run).forEach((pieces,index)=>{
        const token=run[index];
        if(pieces&&!(pieces.length===1&&pieces[0]===token.text))changes.push([pairs.get(token.node),pieces]);
      });
    }
  }
  for(const [node,pieces] of changes)node.replaceWith(...pieces.map(piece=>piece===null?copy.ownerDocument.createElement('br'):piece));
}
