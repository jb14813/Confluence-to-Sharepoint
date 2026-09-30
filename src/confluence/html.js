// Markup conventions shared by the reading-view capture (rendered DOM) and the
// live-doc capture (Atlassian Document Format), so both produce the same
// SharePoint content. Output must stay within the HTML subset that
// src/sharepoint/canvas.js accepts.
import {emojiParts} from './emoji.js';
import {NBSP} from './whitespace.js';
// Confluence's panels in its light theme (measured): each type's background, and
// the emoji nearest its icon, the same emoji Confluence's "Using the editor"
// template uses to show them. A tip is drawn as a success panel.
export const PANEL_COLORS={info:'#E9F2FE',note:'#F8EEFE',success:'#DCFFF1',tip:'#DCFFF1',hint:'#DCFFF1',warning:'#FEF7C8',error:'#FFECEB'};
const PANEL_ICONS={info:'ℹ️',note:'📄',success:'✅',tip:'✅',hint:'✅',warning:'⚠️',error:'❌'};
/** A standard panel's icon as {text, html}, or null for a type without one. */
export const standardPanelIcon=type=>Object.hasOwn(PANEL_ICONS,type??'')?{text:PANEL_ICONS[type],html:escape(PANEL_ICONS[type])}:null;
export const SAFE_PANEL_COLOR=/^(?:#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d.,% ]+\))$/i;
export const compact=text=>String(text??'').normalize('NFC').replace(/[\u200b\ufeff]/gu,'').replace(/\s+/gu,' ').trim();
// SharePoint text accepts tabs and line breaks but no other control characters, which readers do not see either.
export const clean=value=>typeof value==='string'?value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,''):'';
/** Text of one line, such as a caption, as SharePoint takes it: its white space collapsed, without control characters. */
export const oneLine=value=>compact(clean(compact(value)));
// Names in a sentence: "a, b and c", naming at most three.
export const inWords=items=>{const named=[...items.slice(0,3),...(items.length>3?[`${items.length-3} more`]:[])];return named.length<2?named.join(''):`${named.slice(0,-1).join(', ')} and ${named.at(-1)}`;};
/** Names beginning a sentence, each once with how often it came: "2 “Jira” macros, a video and 3 synced blocks". */
export const namesInSentence=names=>{
  const counts=new Map();for(const name of names)counts.set(name,(counts.get(name)??0)+1);
  const text=inWords([...counts].map(([name,count])=>count===1?name:/^the (“.+”) macro$/.test(name)?`${count} ${name.slice(4)}s`:/^an? /.test(name)?`${count} ${name.replace(/^an? /,'')}s`:`${name} (${count} times)`));
  return text.charAt(0).toUpperCase()+text.slice(1);
};
/** A macro's title as its app gives it (Forge, then Connect and Confluence's own), else its key; never its content; null without one. */
export function macroTitle(node){
  const parameters=node?.attrs?.parameters,key=node?.attrs?.extensionKey;
  const title=[parameters?.extensionTitle,parameters?.macroMetadata?.title,node?.attrs?.text,/^[A-Za-z][\w.-]{0,59}$/.test(key??'')?key:null].find(value=>typeof value==='string'&&compact(value));
  return title&&compact(title).length<=60&&!badMetadata(title)?compact(title):null;
}
/** A macro as a note names it: the “Title” macro, or a synced block. */
export const macroName=node=>node?.type==='bodiedSyncBlock'||node?.type==='syncBlock'?'a synced block':(title=>title?`the “${title}” macro`:'a Confluence macro')(macroTitle(node));
/**
 * Whether markup draws something, as Confluence draws it: text, a line break, a
 * no-break space holding a blank line, a table's grid even with empty cells,
 * list items, whose numbers or bullets show even when the items are empty, or a
 * picture kept in its place (its slot, which has no text of its own).
 */
export const drawsSomething=(html,text)=>Boolean(compact(text))||html.includes(NBSP)||/<br>|<table[\s>]|<li[\s>]|<div class="c2sPicture"/.test(html);
/** An emoji ({text, id, shortName} as Confluence stores it) as its character, or '' when nothing similar exists. */
export const emojiText=emoji=>emojiParts(emoji)?.character??'';
/** An emoji as markup: its character, in its color when it has one (Atlassian's numbers and stars). */
export const emojiHtml=emoji=>{
  const parts=emojiParts(emoji);
  return !parts?'':parts.color?`<span style="color:${parts.color}">${escape(parts.character)}</span>`:escape(parts.character);
};
// Confluence's light theme, measured on its pages: the background of a table
// header cell, a numbered table's number cell and a date; a number cell's text;
// and each status color's label background and text. Purple was not on the test
// pages; it is the matching shade of the same palette.
export const HEADER_BACKGROUND='#F0F1F2',NUMBER_COLOR='#6B6E76';
// A numbered table's number column is 42 px wide on Confluence's 760 px page.
export const NUMBER_COLUMN_WIDTH=42;
const STATUS_COLORS={neutral:['#F0F1F2','#292A2E'],red:['#FFD5D2','#5D1F1A'],yellow:['#FCE4A6','#693200'],blue:['#CFE1FD','#123263'],green:['#D3F1A7','#37471F'],purple:['#DFD8FD','#352C63']};
/** A status color's [background, text] colors. */
export const statusColors=color=>Object.hasOwn(STATUS_COLORS,color??'')?STATUS_COLORS[color]:STATUS_COLORS.neutral;
/**
 * A label's text with the room Confluence gives it inside its color (4 px each
 * side, measured): SharePoint keeps no padding, so a no-break space each side.
 */
export const labelText=text=>`${NBSP}${text}${NBSP}`;
/** A Confluence status as the small colored label Confluence shows. */
export const statusHtml=(text,color)=>{
  const [background,foreground]=statusColors(color);
  return `<span style="background-color:${background};color:${foreground};font-size:12px">${escape(labelText(text))}</span>`;
};
/**
 * The marker a picture that could not be copied leaves where it was, "[Picture not copied: name]", linked to its
 * file when that address is known, and followed by its caption.
 */
export const pictureMarker=(name,href,caption='')=>{
  const label=`[Picture not copied${name?`: ${name}`:''}]`;
  return {html:`<p>${href?`<a href="${escape(href)}">${escape(label)}</a>`:escape(label)}</p>${caption?`<p>${escape(caption)}</p>`:''}`,text:` ${label} ${caption} `};
};
/** The note naming the pictures ({name, reason}) that were not copied, each marked in the draft. */
export const picturesNotCopiedNote=lost=>{
  const one=lost.length===1,entries=lost.map(({name,reason})=>name?`${name} (${reason})`:`an unnamed picture (${reason})`);
  return `${one?lost[0].name?`A picture was not copied: ${entries[0]}.`:`A picture was not copied (${lost[0].reason}).`:`${lost.length} pictures were not copied: ${inWords(entries)}.`} ${one?'It is':'Each is'} marked “[Picture not copied]” in the draft; add ${one?'it':'them'} in SharePoint if ${one?'it is':'they are'} needed.`;
};
/** A Confluence date as the grey label Confluence shows. */
export const dateHtml=text=>`<span style="background-color:${HEADER_BACKGROUND}">${escape(labelText(text))}</span>`;
/** A mention as the grey label Confluence shows for someone other than the reader. */
export const mentionHtml=dateHtml;
// A task's box and a decision's mark as the nearest characters, in Confluence's
// colors (measured): a checked box is blue, a decision's fork green, an open
// decision's grey. SharePoint's editor turns any list back into bullets, so a
// task list is kept as lines of one paragraph, like Confluence's list without bullets.
const MARKS={done:['☑','#1868DB'],todo:['☐',''],decided:['⑂','#6A9A23'],undecided:['⑂',NUMBER_COLOR]};
/** A task or decision mark ('done', 'todo', 'decided' or 'undecided') as [character, color]. */
export const taskMark=kind=>Object.hasOwn(MARKS,kind)?MARKS[kind]:MARKS.todo;
export const taskMarkHtml=kind=>{const [mark,color]=taskMark(kind);return color?`<span style="color:${color}">${mark}</span>`:mark;};
/** Nested items' indent: four spaces a level, which SharePoint keeps in a line. */
export const taskIndent=depth=>String.fromCharCode(0xA0).repeat(4*Math.max(0,Math.min(depth,20)));
/**
 * A custom panel's icon as {text, html}, from the icon's text or, where
 * Confluence gives only the emoji's id and name, from those, like any emoji;
 * null for an icon with nothing similar.
 */
export const panelIcon=({text,id,shortName}={})=>{
  const icon=emojiText({text,id,shortName});
  return icon&&Array.from(icon).length<=16&&!badMetadata(icon)&&!/[<>]/u.test(icon)?{text:icon,html:emojiHtml({text,id,shortName})}:null;
};
/**
 * Stored inline text, such as a mention, compacted but keeping one space
 * at an edge where the stored text has whitespace and the neighbouring text
 * does not, so it stays separate from the words beside it.
 */
export const inlineText=(value,before='',after='')=>{
  const text=compact(value),raw=String(value??'');
  if(!text)return '';
  return `${/^\s/.test(raw)&&before&&!/\s$/.test(before)?' ':''}${text}${/\s$/.test(raw)&&after&&!/^\s/.test(after)?' ':''}`;
};
export const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const badMetadata=value=>/[\u0000-\u001f\u007f]/u.test(value);
export const RULE_TEXT='────────────────';
/** Heading anchor base derived from the visible heading text; callers add numeric suffixes for duplicates. */
export const headingSlug=text=>Array.from(text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}\p{M}\p{Extended_Pictographic}\p{Regional_Indicator}\u200d]+/gu,'-').replace(/^-|-$/g,'')).slice(0,180).join('');
/**
 * A code block as preformatted text, which SharePoint draws in a grey block and
 * whose editor keeps every line and space; in any other markup its editor joins
 * the lines when the draft is opened for editing.
 * An empty one, as templates leave for their readers to fill, is still drawn by
 * Confluence, as many lines tall as it has: each line keeps a no-break space.
 */
export const codeBlockHtml=text=>`<pre>${escape(/\S/.test(text)?text:text.split('\n').map(()=>NBSP).join('\n'))}</pre>`;
/** Inline code on the grey Confluence gives it. */
export const inlineCodeHtml=html=>`<span style="background-color:${HEADER_BACKGROUND}"><code>${html}</code></span>`;
/**
 * A Confluence panel as an editable colored callout without borders, as
 * Confluence draws it, in SharePoint's own markup for a borderless table (its
 * editor writes the same); a quotation when it has
 * no known color.
 */
export const panelHtml=(html,color)=>color?`<div class="canvasRteResponsiveTable"><div class="tableCenterAlign tableWrapper"><table class="noBorderTableStyleNeutral" style="width:100%"><tbody><tr><td style="background-color:${color}">${html}</td></tr></tbody></table></div></div>`:`<blockquote>${html}</blockquote>`;
// A picture kept in a table cell, panel or quote is written as a slot where it goes, keyed while the page is read, then
// numbered in its text block's `pictures` once its file is in; canvas.js turns it into SharePoint's own inline picture.
export const pictureSlot=key=>`<div class="c2sPicture" data-picture="${key}"></div>`;
// SharePoint sizes such a picture as a share of the room its cell has (data-widthpercentage; measured 2026-09-28: at
// 100 it fills its cell, and without it is drawn about a quarter as wide). Its editor put a 239.79 px picture in a
// one-column table at 20.71 %, so its text is 1158 px wide there; a cell has that share of it the cell had of
// Confluence's page.
export const SHAREPOINT_TEXT_WIDTH=1158;
/** A picture's share of its SharePoint cell, for the width Confluence shows it at in a cell with `cellShare` of the page. */
export const pictureShare=(width,cellShare=1)=>Math.round(Math.min(100,Math.max(1,width/(SHAREPOINT_TEXT_WIDTH*Math.min(1,Math.max(0.01,cellShare)))*100))*10_000)/10_000;
const SLOT=/<div class="c2sPicture" data-picture="(\d{1,9})"><\/div>/g;
/**
 * Numbers each text block's picture slots in its `pictures`, from `settled(key)`: {picture} to keep, or {html, text}
 * to put in its place (the marker or link it would have been), in order.
 */
export function settlePictures(blocks,settled) {
  for(const block of blocks) {
    if(block.type!=='text'||!block.html.includes('c2sPicture'))continue;
    const pictures=[];let text=block.text??'';
    block.html=block.html.replace(SLOT,(slot,key)=>{
      const outcome=settled(Number(key));
      if(outcome?.picture){pictures.push(outcome.picture);return pictureSlot(pictures.length-1);}
      text=`${text} ${outcome?.text??''}`;return outcome?.html??'';
    });
    block.text=compact(text);
    if(pictures.length)block.pictures=pictures;else delete block.pictures;
  }
}
/**
 * Takes out of `assets` the pictures no block uses, and returns them: a picture whose place in the page was lost on
 * the way would make SharePoint refuse the whole send, so it is left out and named with the pictures not copied.
 */
export function withoutUnplaced(blocks,assets) {
  const used=new Set(blocks.flatMap(block=>block.type==='image'?[block.assetId]:(block.pictures??[]).map(picture=>picture.assetId)));
  const unplaced=assets.filter(asset=>!used.has(asset.id));
  for(const asset of unplaced)assets.splice(assets.indexOf(asset),1);
  return unplaced;
}
/** The note on pictures left out by withoutUnplaced, by their file names where known. */
export const unplacedNote=names=>{
  const known=names.filter(Boolean);
  return names.length===1?`A picture${known.length?` (${known[0]})`:''} was left out, because its place in the page was lost. Add it in SharePoint if it is needed.`
    :`${names.length} pictures${known.length?` (${inWords(known)})`:''} were left out, because their places in the page were lost. Add them in SharePoint if they are needed.`;
};
// Two text blocks as one, their pictures numbered in order.
function joinText(first,second) {
  const offset=first.pictures?.length??0,pictures=[...(first.pictures??[]),...(second.pictures??[])];
  const html=second.html.replace(SLOT,(slot,index)=>pictureSlot(Number(index)+offset));
  return {...first,html:first.html+html,text:compact(`${first.text} ${second.text}`),...(pictures.length?{pictures}:{})};
}

// The most blocks (runs of text, pictures and dividers) SharePoint page assembly places on one page (serializeCanvas in canvas.js).
export const MAX_BLOCKS=2000;
const TOO_MANY_BLOCKS='This page has more than the 2,000 parts (pictures, dividers and the runs of text between them) the extension places on one SharePoint page. Split it into shorter pages in Confluence and capture each.';
/**
 * Fits a capture's blocks into one SharePoint page: past MAX_BLOCKS, each divider becomes the line of text a
 * rule inside text is, joined with the text around it in its column. `warn` records the note; a page still
 * too long stops capture.
 */
export function fitBlocks(blocks,warn) {
  if(blocks.length<=MAX_BLOCKS)return;
  const samePlace=(a,b)=>a===b||Boolean(a&&b&&a.id===b.id&&a.column===b.column),fitted=[];
  for(const block of blocks) {
    const part=block.type==='divider'?{type:'text',html:`<p>${RULE_TEXT}</p>`,text:RULE_TEXT,...(block.section?{section:block.section}:{})}:block,last=fitted.at(-1);
    if(part.type==='text'&&last?.type==='text'&&samePlace(last.section,part.section))fitted[fitted.length-1]=joinText(last,part);
    else fitted.push(part);
  }
  blocks.splice(0,blocks.length,...fitted.map((block,index)=>({...block,id:`block-${index+1}`})));
  warn('dividers-as-text','This page has more parts than the extension places on one SharePoint page (2,000 pictures, dividers and runs of text between them), so its dividers became lines of text.');
  if(blocks.length>MAX_BLOCKS)throw Object.assign(new Error(TOO_MANY_BLOCKS),{code:'capture-limit'});
}
// SharePoint sections have one column, two (halves, or a third beside two
// thirds) or three equal columns, measured in twelfths. A Confluence layout
// gets the nearest; one with more columns is split into rows of up to three.
// `simplified` says the layout's columns were not kept as they were.
export function sharePointColumns(widths) {
  const near=(value,target)=>Math.abs(value-target)<=2,measured=widths.every(width=>width>0);
  if(widths.length===2) {
    const first=measured?widths[0]/(widths[0]+widths[1])*100:50;
    return {groups:[{factors:first<42?[4,8]:first>58?[8,4]:[6,6],columns:[0,1]}],simplified:![50,33.33,66.67].some(target=>near(first,target))};
  }
  if(widths.length===3)return {groups:[{factors:[4,4,4],columns:[0,1,2]}],simplified:measured&&!widths.every(width=>near(width,33.33))};
  const groups=[];
  for(let start=0;start<widths.length;) {
    const size=widths.length-start===4?2:Math.min(3,widths.length-start);
    groups.push({factors:size===3?[4,4,4]:[6,6],columns:Array.from({length:size},(unused,offset)=>start+offset)});
    start+=size;
  }
  return {groups,simplified:true};
}
