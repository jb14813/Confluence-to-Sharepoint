// Pictures inside a list's items (a screenshot under each step of a guide) are placed as SharePoint picture parts of
// their own, like pictures in the page's flow: the list is cut at each one, and each piece of it goes on with the
// number the next step has. Chosen on 2026-09-28 over SharePoint's own picture inside a text part: a picture part is
// the standard one the author can move, resize or replace alone, while the inline format is internal to SharePoint.
// Both capture paths use this, each with an adapter for its nodes (the reading view's elements, the stored document's
// nodes): list(node) → null or {ordered, start, items}; children(item) → its nodes; isPicture(node): a picture to
// place; inline(node): text that needs a paragraph of its own outside a list item; render(node) → {html, text} for
// anything else (a list without pictures is rendered whole); open(node, {start, fresh, depth}) → a list's opening
// tag: `fresh` as the page has it, else going on at `start`, with the numbering style of `depth` when the list is
// opened outside the step it belongs to; counted(list), once for each item.
import {drawsSomething} from './html.js';
import {NBSP} from './whitespace.js';

/**
 * The numbering style of a list at `depth` (1: not inside another list), as Confluence and SharePoint draw them and as
 * SharePoint's editor stores one (`list-style-type`; measured 2026-09-28: SharePoint draws a list's `type` attribute
 * as numbers, and `start` on a list inside another as its first letter).
 */
export const numberingStyle=(ordered,depth)=>(ordered?['decimal','lower-latin','lower-roman']:['disc','circle','square'])[(depth-1)%3];

/** The note when something after a picture inside a step went on outside its list. */
export const LIST_CONTINUED='Some steps go on after their pictures without their list’s indentation, because SharePoint places pictures between pieces of text. Check those steps in SharePoint.';

// A piece of text that is only blank lines draws nothing a reader needs between two pictures.
const BLANK=/^(?:<p(?:\s[^>]*)?>(?:\s|&nbsp;| |<br\s*\/?>)*<\/p>)+$/;

/** Whether a list has a picture directly in one of its items, at any depth of nested lists, so it is to be cut. */
export function listPictures(node,adapter){
  const list=adapter.list(node);
  return Boolean(list)&&list.items.some(item=>adapter.children(item).some(child=>adapter.isPicture(child)||listPictures(child,adapter)));
}

/** How many pictures cutting a list places. */
export function listPictureCount(node,adapter){
  const list=adapter.list(node);
  return list?list.items.reduce((count,item)=>adapter.children(item).reduce((sum,child)=>sum+(adapter.isPicture(child)?1:listPictureCount(child,adapter)),count),0):0;
}

/**
 * A list cut at its pictures, in reading order: {kind:'html', html, text, continued} pieces of the list and
 * {kind:'picture', node} pictures. Before a picture the open items and lists close; after it each list goes on with
 * the next number. What follows a picture inside a step whose number is already shown goes on without the number,
 * outside the list (`continued`): blocks as they are, later sub-steps as a list of their own keeping their numbers and
 * numbering style. A blank line left after a picture is dropped.
 */
export function cutList(root,adapter){
  // The list in reading order: where each item begins, its blocks and its pictures, each with the items it is in.
  const atoms=[];
  (function walk(node,path){
    const list=adapter.list(node);
    list.items.forEach((item,index)=>{
      const here=[...path,{node,list,item,number:list.start+index,first:index===0}];
      atoms.push({kind:'item',path:here});
      // Every list inside is walked too, pictures or not, so one that ends up after a picture keeps its numbering style.
      for(const child of adapter.children(item)){
        if(adapter.isPicture(child))atoms.push({kind:'picture',node:child,path:here});
        else if(adapter.list(child))walk(child,here);
        else atoms.push({kind:'block',node:child,path:here});
      }
    });
  })(root,[]);
  // `open`: the lists open in `html`, outermost first, each with its item open ({level, at: the level's place in its
  // atom's path, empty}); `shown`: the items whose number has been drawn, never drawn again.
  const pieces=[],shown=new Set(),opened=new Set();
  let html='',text='',open=[],continued=false;
  const closeItem=frame=>{html+=`${frame.empty?NBSP:''}</li>`;};
  const closeList=frame=>{html+=frame.level.list.ordered?'</ol>':'</ul>';};
  const startItem=frame=>{html+='<li>';frame.empty=true;shown.add(frame.level.item);adapter.counted?.(frame.level.list);};
  // Opens what an atom's path needs and closes what it does not; returns whether its own item was drawn before.
  function reach(path){
    let kept=0;
    while(kept<open.length&&path[open[kept].at]?.item===open[kept].level.item)kept++;
    let reused=null;
    while(open.length>kept){
      const frame=open.at(-1);closeItem(frame);
      // The next item of the same list goes on in it.
      if(open.length-1===kept&&path[frame.at]?.node===frame.level.node){reused=frame;break;}
      closeList(frame);open.pop();
    }
    let from=kept?open[kept-1].at+1:0;
    if(reused){reused.level=path[reused.at];startItem(reused);from=reused.at+1;}
    let skipped=false;
    for(let at=from;at<path.length;at++){
      const level=path[at];
      if(shown.has(level.item)){skipped=at===path.length-1;continue;}
      if(open.length)open.at(-1).empty=false;
      // A list opened less deep than it was goes on outside the step it belongs to.
      const depth=open.length+1<at+1?at+1:null;
      if(depth&&!open.length)continued=true;
      html+=adapter.open(level.node,{start:level.number,fresh:level.first&&!opened.has(level.node),depth});
      opened.add(level.node);
      const frame={level,at};open.push(frame);startItem(frame);
    }
    return skipped;
  }
  function flush(){
    if(drawsSomething(html,text)&&!BLANK.test(html))pieces.push({kind:'html',html,text,...(continued?{continued:true}:{})});
    html='';text='';continued=false;
  }
  for(const atom of atoms){
    const outside=reach(atom.path);
    if(atom.kind==='picture'){
      while(open.length){const frame=open.pop();closeItem(frame);closeList(frame);}
      flush();pieces.push({kind:'picture',node:atom.node});
      continue;
    }
    if(atom.kind!=='block')continue;
    const part=adapter.render(atom.node);
    if(!part.html||outside&&BLANK.test(part.html))continue;
    if(outside)continued=true;
    html+=!open.length&&adapter.inline(atom.node)?`<p>${part.html}</p>`:part.html;
    text+=` ${part.text} `;
    if(open.length&&drawsSomething(part.html,part.text))open.at(-1).empty=false;
  }
  while(open.length){const frame=open.pop();closeItem(frame);closeList(frame);}
  flush();
  return pieces;
}
