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
/**
 * Whether markup draws something, as Confluence draws it: text, a line break, a
 * no-break space holding a blank line, a table's grid even with empty cells, or
 * list items, whose numbers or bullets show even when the items are empty.
 */
export const drawsSomething=(html,text)=>Boolean(compact(text))||html.includes(NBSP)||/<br>|<table[\s>]|<li[\s>]/.test(html);
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
