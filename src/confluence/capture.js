import {attachmentInfo,attachmentLink,fetchConfluenceImage,fetchExternalImage,isPicture,fail,pictureFileName,unsupportedPicture} from './images.js';
import {inspectConfluencePage,topLevelArticles} from './detect.js';
import {captureStoredDocument} from './stored.js';
import {captureHash,readAttachmentListing,readSourceMetadata} from './rest.js';
import {HEADER_BACKGROUND,NUMBER_COLOR,NUMBER_COLUMN_WIDTH,PANEL_COLORS,SAFE_PANEL_COLOR,RULE_TEXT,badMetadata,codeBlockHtml,compact,drawsSomething,emojiHtml,emojiText,escape,headingSlug,inlineCodeHtml,labelText,panelHtml,panelIcon,sharePointColumns,standardPanelIcon,statusColors,taskIndent,taskMark} from './html.js';
import {emojiName,omittedEmojiNote} from './emoji.js';
import {drawnBackground,drawnHighlight,drawnTextColor} from './palette.js';
import {NBSP,keepWhitespace} from './whitespace.js';
import {roadmapHtml,roadmapSource} from './roadmap.js';

export {inspectConfluencePage};
const SKIP='button,input,textarea,select,script,style,noscript,nav,footer,[data-testid="visually-hidden-heading-anchor"],.ds-line-number,.ak-editor-panel__icon';
// What SKIP removes, left out of the lines text is drawn in (keepWhitespace): Confluence shows some of it only
// at times, such as a heading's link button. A mention's profile button stays: it becomes the mention's label.
const SKIP_IN_LINES=SKIP.split(',').map(selector=>selector==='button'?'button:not([data-testid="user-profile-card-trigger-wrapper"])':selector).join(',');
const TAGS=new Set('P H1 H2 H3 H4 H5 H6 SPAN STRONG B EM I U S SUP SUB BR OL UL LI TABLE THEAD TBODY TFOOT TR TD TH A BLOCKQUOTE PRE CODE'.split(' '));
const BLOCKS=new Set('P H1 H2 H3 H4 H5 H6 OL UL TABLE BLOCKQUOTE PRE'.split(' '));
const STYLES=['color','background-color','font-family','font-size','text-align','font-weight','font-style','vertical-align'];
// How a passage begins, for a note: whole up to 50 characters, else cut at a word near 45.
const excerpt=value=>{if(value.length<=50)return value;const cut=value.lastIndexOf(' ',45);return `${(cut>0?value.slice(0,cut):value.slice(0,45)).replace(/[\s,;:.]+$/,'')}…`;};
// Names in a sentence: "a, b and c", naming at most three.
const inWords=items=>{const named=[...items.slice(0,3),...(items.length>3?[`${items.length-3} more`]:[])];return named.length<2?named.join(''):`${named.slice(0,-1).join(', ')} and ${named.at(-1)}`;};
const alignment=node=>['left','center','right','justify'].find(value=>value===(node.getAttribute('data-align') || node.style?.textAlign));
// Confluence draws an emoji as a picture, a sprite or, when its site cannot
// draw it, a replacement character, inside an element carrying the emoji's
// stored text, id and short name; the emoji is read from those, not the drawing.
const EMOJI='[data-emoji-id],[data-emoji-short-name],[data-emoji-text]';
const outerEmoji=root=>[...root.querySelectorAll(EMOJI)].filter(node=>!node.parentElement?.closest(EMOJI));
const emojiOf=node=>{
  const read=name=>node.getAttribute(name)??node.querySelector(`[${name}]`)?.getAttribute(name)??null;
  return {text:read('data-emoji-text'),id:read('data-emoji-id'),shortName:read('data-emoji-short-name')};
};
// The light-theme color in a Confluence style variable, var(--ds-token, #light), or null.
const tokenColor=value=>/^var\(--[a-z0-9-]+,\s*(#[0-9a-f]{3,8})\)$/i.exec(String(value??'').trim())?.[1]??null;
// A custom panel's color as Confluence draws it: its style variable, else its stored color in today's palette.
const customPanelColor=panel=>tokenColor(panel.style?.getPropertyValue('--ak-renderer-panel-custom-bg-color'))??
  [panel.getAttribute('data-panel-color'),panel.getAttribute('data-panel-bg-color'),panel.style?.backgroundColor].map(drawnBackground).find(value=>SAFE_PANEL_COLOR.test(value||''))??null;
// Column layouts, as Confluence renders them now and as it did before.
const LAYOUT_SECTION='[data-layout-section],[data-node-type="layoutSection"]',LAYOUT_COLUMN='[data-layout-column],[data-node-type="layoutColumn"]';

async function hydrateDeferredText(article,expectedText,onProgress){
  if(!expectedText.length||!article.lastElementChild)return;
  const missing=()=>{
    const visible=compact(article.textContent);
    return expectedText.filter(value=>!visible.includes(value)).length;
  };
  let remaining=missing();if(!remaining)return;
  const positions=new Map(),remember=node=>{if(node&&!positions.has(node))positions.set(node,{left:node.scrollLeft,top:node.scrollTop})};
  remember(document.scrollingElement);
  for(let parent=article.parentElement;parent;parent=parent.parentElement)if(parent.scrollHeight>parent.clientHeight||parent.scrollWidth>parent.clientWidth)remember(parent);
  try{
    if(typeof onProgress==='function')onProgress({phase:'capture',completed:0,total:1,message:'Preparing deferred Confluence text.'});
    article.lastElementChild.scrollIntoView({block:'end',inline:'nearest'});
    const deadline=Date.now()+15000;
    let lastChange=Date.now();
    while(remaining&&Date.now()<deadline&&Date.now()-lastChange<5000){
      const deferred=[...article.querySelectorAll('.ak-renderer-sticky-safe-breakout-inner')].filter(node=>!node.childElementCount&&!compact(node.textContent));
      (deferred[0]||article.lastElementChild)?.scrollIntoView({block:'center',inline:'nearest'});
      await new Promise(resolve=>setTimeout(resolve,250));
      const current=missing();
      if(current!==remaining){remaining=current;lastChange=Date.now();}
    }
  }finally{for(const [node,position] of positions){node.scrollLeft=position.left;node.scrollTop=position.top;}}
}

// Opens every collapsed section, so what it holds is captured; returns how many would not open.
async function openCollapsedExpansions(article,opened){
  const stuck=new Set();
  for(let index=0;index<200;index++){
    const next=[...article.querySelectorAll('[data-node-type="expand"][data-expanded="false"]')]
      .find(node=>!stuck.has(node)&&node.querySelector(':scope > button[aria-expanded="false"]')?.getClientRects().length);
    if(!next)return stuck.size;
    const button=next.querySelector(':scope > button[aria-expanded="false"]');
    button.click();
    for(let attempt=0;attempt<30&&next.getAttribute('data-expanded')!=='true';attempt++)
      await new Promise(resolve=>setTimeout(resolve,100));
    if(next.getAttribute('data-expanded')!=='true'){stuck.add(next);continue;}
    opened.push(next);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  fail('capture-limit','This Confluence page contains too many nested sections to capture safely.');
}

function restoreCollapsedExpansions(opened){
  for(const node of [...opened].reverse())if(node.isConnected&&node.getAttribute('data-expanded')==='true')
    node.querySelector(':scope > button[aria-expanded="true"]')?.click();
}

// A picture capture can place: one media item, no picture inside it, and at most one image. While
// Confluence draws a picture it briefly shows both the preview it drew on the server and its own
// picture card (seen live for about 60 ms, after the picture is scrolled into view).
const placeablePicture=wrapper=>wrapper.querySelectorAll('[data-node-type="media"]').length===1&&
  !wrapper.querySelector('[data-node-type="mediaSingle"]')&&wrapper.querySelectorAll('img').length<=1;

// The snapshot is taken once every picture can be placed; a picture that stays in another form
// after a few seconds is taken as it is, and is marked as not copied.
async function settledCopy(original) {
  const deadline=Date.now()+5_000;
  while(true) {
    // The check and the copy run together, so no change to the page comes between them. The copy is not
    // laid out, so the lines Confluence draws its text in are read from the page as it is copied.
    if([...original.querySelectorAll('[data-node-type="mediaSingle"]')].every(placeablePicture)||Date.now()>=deadline) {
      const copy=original.cloneNode(true);
      // Should the page's lines not be readable, its text is copied as HTML would lay it out.
      try{keepWhitespace(original,copy,{ignore:SKIP_IN_LINES});}catch{/* The text itself is unchanged. */}
      return copy;
    }
    await new Promise(resolve=>setTimeout(resolve,50));
  }
}

async function hydrateLazyMedia(article,onProgress,expectedMediaCount=null) {
  const positions=new Map(),remember=node=>{if(node&&!positions.has(node))positions.set(node,{left:node.scrollLeft,top:node.scrollTop})};
  remember(document.scrollingElement);
  for(let parent=article.parentElement;parent;parent=parent.parentElement)if(parent.scrollHeight>parent.clientHeight||parent.scrollWidth>parent.clientWidth)remember(parent);
  const deadline=Date.now()+15_000;
  try {
    let completed=0;
    while(true) {
      const wrappers=[...article.querySelectorAll('[data-node-type="mediaSingle"]')];
      if(expectedMediaCount!==null&&wrappers.length>expectedMediaCount)fail('capture-changed','The Confluence page changed while it was being captured. Try again after the page finishes updating.');
      for(let index=0;index<wrappers.length;index++) {
        const wrapper=wrappers[index],media=wrapper.querySelector('[data-node-type="media"]');
        for(let parent=wrapper.parentElement;parent;parent=parent.parentElement)if(parent.scrollHeight>parent.clientHeight||parent.scrollWidth>parent.clientWidth)remember(parent);
        if(media?.querySelector('img[src]'))continue;
        if(typeof onProgress==='function')onProgress({phase:'capture',completed,total:expectedMediaCount??wrappers.length,message:`Preparing image ${index+1} of ${expectedMediaCount??wrappers.length}.`});
        wrapper.scrollIntoView({block:'center',inline:'nearest'});
        for(let attempt=0;attempt<40&&!media?.querySelector('img[src]');attempt++)await new Promise(resolve=>setTimeout(resolve,100));
        completed++;
      }
      if(expectedMediaCount===null||wrappers.length===expectedMediaCount)return null;
      // Pictures the page never shows cannot be captured; the caller notes them.
      if(Date.now()>=deadline)return {shown:wrappers.length,expected:expectedMediaCount};
      article.lastElementChild?.scrollIntoView({block:'end',inline:'nearest'});
      await new Promise(resolve=>setTimeout(resolve,250));
    }
  } finally {
    for(const [node,position] of positions){node.scrollLeft=position.left;node.scrollTop=position.top;}
  }
}

async function hydrateLiveCards(article,expectedCount,onProgress) {
  if(!expectedCount)return;
  const scroll=document.scrollingElement,position=scroll?{left:scroll.scrollLeft,top:scroll.scrollTop}:null,deadline=Date.now()+15_000;
  try {
    while(Date.now()<deadline) {
      const tables=article.querySelectorAll('table[data-testid="datasource-table-view"]');
      if(tables.length>=expectedCount)return;
      if(typeof onProgress==='function')onProgress({phase:'capture',completed:tables.length,total:expectedCount,message:'Preparing live Confluence data for a static snapshot.'});
      const targets=[...article.querySelectorAll('[data-testid="renderer-datasource-table"],[data-testid="issue-like-table-container"],.ak-renderer-block-card-datasource-center-wrapper')];
      (targets[0]||article.lastElementChild)?.scrollIntoView({block:'center',inline:'nearest'});
      await new Promise(resolve=>setTimeout(resolve,250));
    }
  } finally {if(scroll&&position){scroll.scrollLeft=position.left;scroll.scrollTop=position.top}}
}

export async function captureConfluencePage({document=globalThis.document,location=globalThis.location,fetchImpl=globalThis.fetch,metadataFetchImpl=globalThis.fetch,onProgress}={}) {
  const info=await inspectConfluencePage({document,location,fetchImpl:metadataFetchImpl});
  if(!info.supported) fail('unsupported-confluence-page',info.reason);
  // Live docs and pages open in the editor have no reading view: their stored document is copied.
  if(info.live||info.editing)return captureStoredDocument({document,info,fetchImpl,metadataFetchImpl,onProgress});
  const original=topLevelArticles(document)[0];
  const articleWidth=original.getBoundingClientRect().width;
  const {sourceMetadata,expectedMediaCount,featureInventory,expectedText,macroText,textPlaces,externalPictures,adf}=await readSourceMetadata(info,metadataFetchImpl);
  const opened=[],shownWidths=new WeakMap(),boxWidths=new WeakMap();
  // Notes shown with the capture. One marked `lost` names something that was not copied: capture
  // keeps going when a piece cannot be read, verified or placed, and says so instead.
  const warnings=[];
  const warn=(code,message,lost=false)=>{if(!warnings.some(w=>w.code===code))warnings.push({code,message,...(lost?{lost:true}:{})})};
  let article;
  try{
    const stuck=await openCollapsedExpansions(original,opened);
    if(stuck)warn('section-not-opened',stuck===1?'A collapsed section of the page could not be opened, so what it holds may not have been copied. Open it on the Confluence page and compare it with the draft.'
      :`${stuck} collapsed sections of the page could not be opened, so what they hold may not have been copied. Open them on the Confluence page and compare them with the draft.`,true);
    await hydrateDeferredText(original,expectedText,onProgress);
    const unshown=await hydrateLazyMedia(original,onProgress,expectedMediaCount);
    if(unshown){const other=unshown.expected-unshown.shown;
      warn('pictures-not-shown',`Confluence showed ${unshown.shown} of this page’s ${unshown.expected} pictures; ${other===1?'the other was':`the other ${other} were`} not copied. Scroll through the page so it shows them all and capture again, or add them in SharePoint.`,true);}
    await hydrateLiveCards(original,featureInventory?.datasourceTableCount||0,onProgress);
    // A detached snapshot prevents asynchronous image downloads from mixing two page revisions.
    article=await settledCopy(original);
    // The snapshot is not laid out, so the width Confluence shows each picture at is read from the page now.
    const live=[...original.querySelectorAll('[data-node-type="mediaSingle"]')];
    [...article.querySelectorAll('[data-node-type="mediaSingle"]')].forEach((copy,index)=>{
      const width=Math.round((live[index]?.querySelector('img')??live[index])?.getBoundingClientRect().width??0);
      if(width>0)shownWidths.set(copy,width);
      // The space Confluence gives the picture: its author's width, narrowed to fit a column or the page.
      const box=Math.round(live[index]?.getBoundingClientRect().width??0);
      if(box>0)boxWidths.set(copy,box);
    });
  }finally{restoreCollapsedExpansions(opened);}

  // Convert structures whose rendered DOM is richer than SharePoint's Text part.
  // Static content remains editable; genuinely live widgets are reduced to a
  // normal source link when one exists, otherwise omitted. A form, such as the
  // Live Search macro's box, is such a widget: its labels are not page text.
  for(const live of article.querySelectorAll('iframe,object,embed,video,audio,canvas,form')) {
    live.remove();warn('live-embed-omitted','Live embedded content was omitted because SharePoint cannot preserve its behavior.');
  }
  // An inline smart link shows the linked page's icon, its title, and a
  // hover-only "Preview" label. The link keeps the title, after the page's
  // emoji where that emoji has a character; other icons are left out.
  for(const card of [...article.querySelectorAll('[data-inline-card]')]) {
    const source=card.querySelector('a[href]');
    if(!source)continue;
    const label=source.cloneNode(true);
    for(const emoji of outerEmoji(label)) {
      const character=emojiText(emojiOf(emoji));
      if(character)emoji.replaceWith(document.createTextNode(`${character} `));else emoji.remove();
    }
    for(const decoration of label.querySelectorAll('img,svg,[aria-hidden="true"]'))decoration.remove();
    const title=compact(label.textContent);
    if(!title)continue;
    const link=document.createElement('a');link.setAttribute('href',source.getAttribute('href'));link.textContent=title;
    card.replaceWith(link);
  }
  for(const card of article.querySelectorAll('[data-node-type="blockCard"],[data-node-type="embedCard"]')) {
    const source=card.querySelector('a[href]');
    if(source) {
      const paragraph=document.createElement('p'),link=document.createElement('a');
      link.setAttribute('href',source.getAttribute('href'));link.textContent=compact(source.textContent)||compact(source.getAttribute('aria-label'))||'Open linked content';
      paragraph.append(link);card.replaceWith(paragraph);
    } else card.remove();
    warn('live-embed-omitted','Live embedded content was omitted; its source link was retained when available.');
  }
  for(const table of [...article.querySelectorAll('table[data-testid="datasource-table-view"]')]) {
    const snapshot=document.createElement('table'),head=document.createElement('thead'),body=document.createElement('tbody');
    for(const [rowIndex,row] of [...table.querySelectorAll('tr')].entries()) {
      const cleanRow=document.createElement('tr');
      for(const cell of row.children) {
        if(!['TH','TD'].includes(cell.tagName))continue;
        const clean=document.createElement(rowIndex===0?'th':'td');
        if(rowIndex===0) {
          clean.setAttribute('scope','col');clean.textContent=compact(cell.querySelector('[id^="datasource-header-title-"]')?.textContent||cell.textContent.replace(/^Sort by\s+/i,''));
        } else {
          for(const child of [...cell.childNodes])clean.append(child.cloneNode(true));
          for(const control of clean.querySelectorAll('button,input,select,textarea'))control.remove();
          for(const note of [...clean.querySelectorAll('span')])if(/^\s*\(opens in a new tab\)\s*$/i.test(note.textContent))note.remove();
        }
        cleanRow.append(clean);
      }
      if(cleanRow.children.length)(rowIndex===0?head:body).append(cleanRow);
    }
    snapshot.dataset.confluenceStaticSnapshot='table';if(head.children.length)snapshot.append(head);if(body.children.length)snapshot.append(body);
    const widget=table.closest('[data-testid="renderer-datasource-table"]')||table.closest('[data-testid="issue-like-table-container"]')||table;
    widget.replaceWith(snapshot);warn('live-data-snapshot','A live Confluence data table was captured as its current editable snapshot; refresh and sync controls were omitted.');
  }
  for(const group of [...article.querySelectorAll('.MediaGroup,[data-node-type="mediaGroup"]')]
    .filter(candidate=>!candidate.parentElement?.closest('.MediaGroup,[data-node-type="mediaGroup"]'))) {
    const fragment=document.createDocumentFragment();
    for(const media of group.querySelectorAll('[data-node-type="media"]')) {
      const name=compact(media.getAttribute('data-file-name'));
      if(!name||name.length>255||/[\\/\u0000-\u001f\u007f]/u.test(name))continue;
      const paragraph=document.createElement('p'),link=document.createElement('a');
      link.setAttribute('href',`${info.baseUrl}/download/attachments/${encodeURIComponent(info.pageId)}/${encodeURIComponent(name)}`);
      link.textContent=name;paragraph.append(link);fragment.append(paragraph);
    }
    if(!fragment.childNodes.length) {
      const visible=compact(group.textContent);
      if(visible){const paragraph=document.createElement('p');paragraph.textContent=visible;fragment.append(paragraph)}
    }
    group.replaceWith(fragment);
    warn('media-group-simplified','A Confluence attachment group was preserved as ordinary authenticated file links. Card controls and dates were omitted.');
  }
  for(const duplicate of [...article.querySelectorAll('.pm-table-sticky-wrapper')])if(duplicate.querySelector('table[data-testid="renderer-table"]'))duplicate.remove();
  // A status and a date become the small labels Confluence shows.
  const labelSpan=(text,colors)=>{
    const span=document.createElement('span');
    for(const [property,value] of Object.entries(colors))span.style.setProperty(property,value);
    span.textContent=text;return span;
  };
  for(const status of [...article.querySelectorAll('[data-node-type="status"]')].filter(node=>!node.parentElement?.closest('[data-node-type="status"]'))) {
    const text=compact(status.textContent),[background,color]=statusColors(status.getAttribute('data-color'));
    status.replaceWith(text?labelSpan(labelText(text),{'background-color':background,color,'font-size':'12px'}):'');
  }
  for(const date of [...article.querySelectorAll('[data-node-type="date"]')]) {
    const text=compact(date.textContent);
    date.replaceWith(text?labelSpan(labelText(text),{'background-color':HEADER_BACKGROUND}):'');
  }
  // A task or decision list becomes lines of one paragraph, each item's box or
  // mark first and nested items indented (see taskMark in html.js). A list whose
  // items hold a list, table or other block keeps list items instead.
  let taskLines=0;
  const TASK_LIST='[data-node-type="taskList"],[data-node-type="decisionList"],[data-task-list-local-id][role="group"],[role="group"][aria-label="Action Item List"]';
  const TASK_ITEM='[data-node-type="taskItem"],[data-node-type="decisionItem"],[data-node-type="blockTaskItem"],[data-task-local-id],[data-decision-local-id]';
  const markOf=item=>{
    if(item.matches('[data-node-type="decisionItem"],[data-decision-local-id]'))return item.getAttribute('data-decision-state')==='DECIDED'?'decided':'undecided';
    return item.getAttribute('data-task-state')==='DONE'||item.getAttribute('data-state')==='DONE'||item.querySelector('input[type="checkbox"]')?.checked||item.querySelector('[aria-checked="true"]')?'done':'todo';
  };
  const markElement=kind=>{const [mark,color]=taskMark(kind);return color?labelSpan(mark,{color}):document.createTextNode(mark);};
  // An item's own content, without its box and without task lists nested in it.
  const itemContent=item=>{
    const content=item.querySelector(':scope > [data-component="content"],:scope > * > [data-component="content"]');
    return [...(content?content.childNodes:item.childNodes)].filter(child=>!(child.nodeType===1&&(child.matches(`input,button,svg,${TASK_LIST}`))));
  };
  // Inline copies of nodes, paragraphs joined by line breaks; null when a node is a block that cannot sit in a line.
  const inlineCopies=nodes=>{
    const copies=[];
    for(const node of nodes) {
      if(node.nodeType!==1){copies.push(node.cloneNode(true));continue;}
      if(node.matches('p,h1,h2,h3,h4,h5,h6,div:not([data-node-type]):not([class*="panel"])')) {
        const inner=inlineCopies([...node.childNodes]);if(!inner)return null;
        if(inner.length&&copies.length)copies.push(document.createElement('br'));
        copies.push(...inner);continue;
      }
      if(node.matches('ul,ol,table,blockquote,pre,div[data-node-type],[data-testid="renderer-code-block"],.ak-editor-panel'))return null;
      copies.push(node.cloneNode(true));
    }
    return copies;
  };
  for(const taskList of [...article.querySelectorAll(TASK_LIST)].filter(node=>!node.parentElement?.closest(TASK_LIST))) {
    const items=[...taskList.querySelectorAll(TASK_ITEM)].filter(item=>!item.parentElement?.closest(TASK_ITEM)||item.parentElement.closest(TASK_LIST)!==taskList);
    if(!items.length)continue;
    const lines=items.map(item=>{
      let depth=0;for(let parent=item.parentElement;parent&&parent!==taskList;parent=parent.parentElement)if(parent.matches(TASK_LIST))depth++;
      return {mark:markOf(item),depth,content:inlineCopies(itemContent(item))};
    });
    if(lines.every(line=>line.content)) {
      const paragraph=document.createElement('p');
      lines.forEach((line,index)=>{
        if(index)paragraph.append(document.createElement('br'));
        if(line.depth)paragraph.append(taskIndent(line.depth));
        paragraph.append(markElement(line.mark),' ',...line.content);
        taskLines++;
      });
      // Confluence draws decisions in a grey box: a grey panel of their own.
      if(!lines.every(line=>line.mark==='decided'||line.mark==='undecided')){taskList.replaceWith(paragraph);continue;}
      const box=document.createElement('div');
      box.className='ak-editor-panel';box.setAttribute('data-panel-type','custom');box.setAttribute('data-panel-color',HEADER_BACKGROUND);box.setAttribute('data-decision-box','');
      box.append(paragraph);taskList.replaceWith(box);continue;
    }
    const list=document.createElement('ul');
    for(const item of items) {
      const li=document.createElement('li');
      li.append(markElement(markOf(item)),' ');
      for(const child of itemContent(item))li.append(child.cloneNode(true));
      list.append(li);
    }
    taskList.replaceWith(list);
  }
  // A column layout becomes a SharePoint section with the nearest columns (see
  // `collect`); an expand's content is part of the page's flow, so a layout in
  // it does too. A layout inside a table, panel, list or quote, which become
  // text, keeps its columns side by side in a table.
  const sectionPlans=new Map();
  for(const section of [...article.querySelectorAll(LAYOUT_SECTION)]) {
    // The snapshot is detached from the page; a layout an outer one replaced is no longer in it.
    if(!article.contains(section))continue;
    const columns=[...section.querySelectorAll(LAYOUT_COLUMN)].filter(column=>column.parentElement?.closest(LAYOUT_SECTION)===section);
    if(columns.length<2)continue;
    if(section.parentElement?.closest(`table,li,blockquote,.ak-editor-panel,${LAYOUT_COLUMN}`)) {
      const table=document.createElement('table'),body=document.createElement('tbody'),row=document.createElement('tr');
      for(const column of columns){const cell=document.createElement('td');for(const child of [...column.childNodes])cell.append(child.cloneNode(true));row.append(cell)}
      body.append(row);table.append(body);section.replaceWith(table);
      warn('layout-mapped','A Confluence column layout inside a table, panel, list or quote was kept side by side in a table, because SharePoint columns cannot be placed there.');
      continue;
    }
    const plan=sharePointColumns(columns.map(column=>Number(column.getAttribute('data-column-width'))));
    if(plan.simplified)warn('layout-simplified','A Confluence column layout SharePoint has no match for was given the nearest SharePoint columns: SharePoint sections have one, two or three columns. Check its layout in SharePoint.');
    sectionPlans.set(section,{columns,groups:plan.groups});
  }
  // A roadmap is drawn in a picture SharePoint text cannot hold; it becomes a table drawn from the data the page
  // stores for it (roadmap.js), paired with the page's roadmap by its local id, else by its place among them.
  // Content already drawn as SharePoint markup ({html, text}) in place of an element; see `render`.
  const prepared=new WeakMap(),storedRoadmaps=[];
  (function stored(node){
    if(!node||typeof node!=='object')return;
    if(node.attrs?.extensionKey==='roadmap')storedRoadmaps.push({localId:node.attrs.localId,params:node.attrs.parameters?.macroParams});
    for(const child of Array.isArray(node.content)?node.content:[])stored(child);
  })(adf);
  const shownRoadmaps=[...article.querySelectorAll('[data-macro-name="roadmap"]')];
  shownRoadmaps.forEach((macro,index)=>{
    const localId=macro.getAttribute('data-local-id');
    const params=(storedRoadmaps.find(item=>localId&&item.localId===localId)??(storedRoadmaps.length===shownRoadmaps.length?storedRoadmaps[index]:null))?.params;
    const table=roadmapHtml(roadmapSource(params));
    if(!table)return;
    const holder=document.createElement('div');prepared.set(holder,table);macro.replaceWith(holder);
    warn('roadmap-table','A Confluence roadmap became a table: its months as columns and each lane’s bars in the months they cover.');
  });
  // A rule in the page's flow becomes SharePoint's Divider (see `collect`); one inside a table, panel, list or
  // quote, where SharePoint has no divider, stays a line of text.
  for(const rule of [...article.querySelectorAll('[data-node-type="rule"],hr')]) {
    if(rule.parentElement?.closest('td,th,li,blockquote,.ak-editor-panel')){const p=document.createElement('p');p.textContent=RULE_TEXT;rule.replaceWith(p);}
    else if(rule.tagName!=='HR')rule.replaceWith(document.createElement('hr'));
  }
  for(const svg of [...article.querySelectorAll('svg')]) {
    if(svg.getAttribute('role')==='presentation'||svg.closest('.ak-editor-panel__icon')||svg.parentElement?.querySelector('img'))svg.remove();
  }
  // A mention becomes the grey label Confluence draws for someone other than the reader.
  const mentionLabel=mention=>{const name=compact(mention?.textContent);return name&&name.length<=255&&!badMetadata(name)?labelSpan(labelText(name),{'background-color':HEADER_BACKGROUND}):null;};
  for(const profile of [...article.querySelectorAll('button[data-testid="user-profile-card-trigger-wrapper"]')]) {
    const label=mentionLabel(profile.querySelector('[data-mention-id]'));
    if(label)profile.replaceWith(label);
  }
  for(const mention of [...article.querySelectorAll('[data-mention-id]')].filter(node=>!node.parentElement?.closest('[data-mention-id]'))) {
    const label=mentionLabel(mention);
    if(label)mention.replaceWith(label);
  }
  // An expand's title is on its toggle button, which goes with the other controls; it
  // becomes a bold paragraph before the expand's content, as in a live doc.
  for(const expand of [...article.querySelectorAll('[data-node-type="expand"],[data-node-type="nestedExpand"]')]) {
    const button=expand.querySelector(':scope > button');
    const title=compact(expand.getAttribute('data-title')??button?.textContent);
    if(!title||title.length>1000||badMetadata(title))continue;
    const paragraph=document.createElement('p'),strong=document.createElement('strong');
    strong.textContent=title;paragraph.append(strong);
    if(button)button.replaceWith(paragraph);else expand.prepend(paragraph);
  }
  for(const control of article.querySelectorAll(SKIP))control.remove();
  if(article.querySelectorAll('*').length>150000 || article.textContent.length>2000000) fail('capture-limit','This Confluence page exceeds the supported capture size.');
  // The labels removed with a table of contents; the text check accepts their stored text, and only theirs.
  let omittedToc=false;const omittedLabels=new Set();
  for(const macro of [...article.querySelectorAll('[data-macro-name="toc"]')]) {
    const wrapper=macro.closest('[data-node-type="extension"]');
    const cell=macro.closest('td,th'),row=cell?.closest('tr');
    const label=(wrapper??macro).previousElementSibling;
    if(label?.tagName==='P'&&/^(?:table of )?contents$/i.test(compact(label.textContent))&&!label.querySelector('a,img,br')){omittedLabels.add(compact(label.textContent));label.remove();}
    macro.remove();omittedToc=true;
    const cells=row?[...row.children].filter(node=>['TD','TH'].includes(node.tagName)):[];
    const other=cells.length===2?cells.find(node=>node!==cell):null;
    if(other&&/^(?:on this page|(?:table of )?contents)$/i.test(compact(other.textContent))&&
       !other.querySelector('a,img,table')&&!compact(cell.textContent)&&!cell.querySelector('a,img,table,[data-macro-name]')){
      omittedLabels.add(compact(other.textContent));
      const table=row.closest('table');row.remove();
      if(table&&!table.querySelector('tr'))table.remove();
      continue;
    }
    // An extension may contain authored text alongside the macro. Keep that
    // text, but remove the now-empty wrapper when it held only the TOC.
    if(wrapper&&!compact(wrapper.textContent)&&!wrapper.querySelector('img,a,table,[data-macro-name]'))wrapper.remove();
  }
  // A legacy TOC can show its links before Confluence attaches the macro
  // marker. The exact label plus a link-only numbered cell identifies that
  // transient rendering without dropping nearby authored table rows.
  for(const row of [...article.querySelectorAll('tr')]){
    const cells=[...row.children].filter(node=>['TD','TH'].includes(node.tagName));
    if(cells.length!==2||!/^(?:on this page|(?:table of )?contents)$/i.test(compact(cells[0].textContent))||cells[0].querySelector('a,img,table'))continue;
    const links=[...cells[1].querySelectorAll('a[href]')];
    if(!links.length||links.some(link=>!/^#[^\s]+$/.test(link.getAttribute('href')||''))||cells[1].querySelector('img,table'))continue;
    const remainder=cells[1].cloneNode(true);for(const link of remainder.querySelectorAll('a[href]'))link.remove();
    if(!/^(?:\d+(?:\.\d+)*\s*)*$/.test(compact(remainder.textContent)))continue;
    omittedLabels.add(compact(cells[0].textContent));
    const table=row.closest('table');row.remove();
    if(table&&!table.querySelector('tr'))table.remove();
    omittedToc=true;
  }
  for(const svg of [...article.querySelectorAll('svg')]) {svg.remove();warn('static-vector-omitted','A vector decoration without a safe static picture was omitted.');}
  if(article.querySelector('[data-macro-name],[data-macro-id]'))warn('macro-static-content','Static visible macro content was retained. Live macro behavior was not copied.');
  for(const panel of article.querySelectorAll('.ak-editor-panel')) {
    const type=panel.getAttribute('data-panel-type'),custom=customPanelColor(panel);
    if((!Object.hasOwn(PANEL_COLORS,type)&&!(type==='custom'&&custom))||panel.querySelector('.ak-editor-panel:not([data-decision-box])')) {
      warn('panel-simplified','An unfamiliar Confluence panel was retained as editable text without its special presentation.');
    }
  }
  if(featureInventory?.markTypes?.border||article.querySelector('[data-mark-type="border"]'))warn('media-border-simplified','A Confluence media border was simplified because SharePoint image controls do not preserve that border style.');
  if(featureInventory?.unknownNodeTypes?.length||featureInventory?.unknownMarkTypes?.length)warn('unknown-adf-feature','Unrecognized future Confluence features were captured from their visible static content where possible.');
  const mediaWrappers=[...article.querySelectorAll('[data-node-type="mediaSingle"]')];
  if([...article.querySelectorAll('[data-node-type="media"]')].some(media=>!media.closest('[data-node-type="mediaSingle"]')))warn('media-simplified','A nonstandard Confluence media item was retained from its visible static content where possible.');
  // Confluence first shows a picture with placeholder details (file name
  // "file", no type) and fills them in later. Until then the page's attachment
  // listing identifies the file; it is read once per page, only when needed.
  const undescribed=media=>{
    const fileId=(media.getAttribute('data-id')||'').toLowerCase();
    const contextId=media.getAttribute('data-context-id')||/^contentId-(\d{1,20})$/.exec(media.getAttribute('data-collection')||'')?.[1]||info.pageId;
    return media.getAttribute('data-file-mime-type')||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(fileId)||!/^\d{1,20}$/.test(contextId)?null:{fileId,contextId};
  };
  const wanted=new Map(),unplaceable=new Set();
  for(const wrapper of mediaWrappers) {
    if(!placeablePicture(wrapper)){unplaceable.add(wrapper);continue;}
    const file=undescribed(wrapper.querySelector('[data-node-type="media"]'));
    if(file){if(!wanted.has(file.contextId))wanted.set(file.contextId,new Set());wanted.get(file.contextId).add(file.fileId);}
  }
  const listed=new Map();
  for(const [contextId,ids] of wanted) {
    try { for(const [id,file] of await readAttachmentListing(info,contextId,metadataFetchImpl,ids))listed.set(id,file); }
    catch {/* The rendered-picture checks below still apply. */}
  }
  // A picture shown from another website is no attachment: it is shown from
  // the address the stored page gives it.
  const externalAddress=media=>{
    if(media.hasAttribute('data-context-id')||media.hasAttribute('data-file-name'))return null;
    let address=null;
    try{address=new URL(media.querySelector('img[src]')?.getAttribute('src'),document.baseURI).href;}catch{/* No picture shown. */}
    return address&&externalPictures.has(address)?address:null;
  };
  // A problem with a picture's file stops capture only where the picture is
  // placed as a picture; inside text it becomes a link (see `linkedPicture`).
  const attachments=new Map();
  for(const wrapper of mediaWrappers) {
    if(unplaceable.has(wrapper)){attachments.set(wrapper,{error:{code:'unsupported-media'}});continue;}
    const media=wrapper.querySelector('[data-node-type="media"]'),external=externalAddress(media),file=listed.get(undescribed(media)?.fileId);
    try {
      if(file&&!isPicture(file.mime))unsupportedPicture(file.name);
      attachments.set(wrapper,external?{external}:file?{name:file.name,mime:file.mime,url:file.url}:attachmentInfo(media,info.baseUrl));
    } catch(error) {attachments.set(wrapper,{error,...(file?{name:file.name,url:file.url}:{})});}
  }
  if(omittedToc)warn('toc-omitted','The Confluence table of contents was omitted because its links do not become a functional SharePoint table of contents.');
  const model={title:info.title,sourceName:`${info.title} (Confluence)`.slice(0,255),sourceHash:'',sourceMetadata,featureInventory,blocks:[],assets:[],headings:[],warnings,stats:{images:0,headings1:0,headings2:0,bullets:taskLines,numbered:0,tables:0}};
  const progress=value=>{if(typeof onProgress==='function')onProgress(value)};
  const headingMap=new Map(),sourceIds=new Map(),usedIds=new Set();
  for(const heading of article.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    if(heading.closest('[data-node-type="mediaSingle"],[data-testid="renderer-code-block"]'))continue;
    const visible=heading.cloneNode(true);
    for(const emoji of outerEmoji(visible))emoji.replaceWith(document.createTextNode(emojiText(emojiOf(emoji))));
    for(const lineBreak of visible.querySelectorAll('br'))lineBreak.replaceWith(' ');
    const text=compact(visible.textContent);if(!text)continue;
    const sourceId=heading.getAttribute('id');
    let base=headingSlug(text);
    if(!base)base='section-heading';
    let id=base;for(let suffix=2;usedIds.has(id);suffix++)id=`${base}-${suffix}`;
    usedIds.add(id);if(sourceId&&!sourceIds.has(sourceId))sourceIds.set(sourceId,id);
    const item={id,level:Number(heading.tagName[1]),text};headingMap.set(heading,item);model.headings.push(item);
    if(item.level===1)model.stats.headings1++;if(item.level===2)model.stats.headings2++;
  }
  function safeLink(value) {
    try {
      if(!value || /[\u0000-\u0020\u007f\\]/.test(value))throw new Error();
      if(value.startsWith('#')) {
        const originalId=decodeURIComponent(value.slice(1)),id=sourceIds.get(originalId)||originalId;
        if(!usedIds.has(id)&&!/^[A-Za-z][A-Za-z0-9_-]{0,200}$/.test(id))throw new Error();
        if(!usedIds.has(id))warn('unresolved-link','An internal link has no matching captured heading. Review the link after import.');
        return `#${encodeURIComponent(id)}`;
      }
      const url=new URL(value,info.pageUrl);
      if(!['https:','http:','mailto:'].includes(url.protocol) || url.username || url.password || url.protocol==='mailto:'&&!url.pathname)throw new Error();
      return url.href;
    }catch{warn('unsafe-link','An unsafe or invalid article link was preserved as ordinary text.');return null;}
  }
  // A cell's width as Confluence stores it, in pixels of its 760 px page: a
  // numbered table's number cell has none and is drawn 42 px wide; null when unknown.
  const NUMBER_CELL='ak-renderer-table-number-column';
  function cellWidth(cell) {
    if(cell.classList.contains(NUMBER_CELL))return NUMBER_COLUMN_WIDTH;
    const raw=cell.getAttribute('data-colwidth');
    return raw&&/^[1-9]\d*(?:,[1-9]\d*)*$/.test(raw)?raw.split(',').reduce((sum,value)=>sum+Number(value),0):null;
  }
  function styles(node,inheritedAlign) {
    const values=new Map();const probe=document.createElement('span');
    const add=(property,value)=>{
      if(!value || value.length>500 || /[{}@\\]|url\s*\(|expression\s*\(/i.test(value))return;
      // Atlassian design tokens are not defined on SharePoint pages. Use the
      // authored static fallback so highlighted cells keep their color.
      const token=/^var\(--[a-z0-9-]+,\s*(#[0-9a-f]{3,8}|rgba?\([\d.,%\s]+\))\)$/i.exec(value.trim());
      if(token)value=token[1];
      probe.style.cssText='';probe.style.setProperty(property,value);
      const safe=probe.style.getPropertyValue(property);if(safe)values.set(property,safe.trim());
    };
    for(const property of STYLES)add(property,node.style?.getPropertyValue(property));
    // A picked text color or highlight is drawn from a variable holding today's color,
    // var(--ds-token, #light), and stored as the earlier palette's color (palette.js).
    const palette=tokenColor(node.style?.getPropertyValue('--custom-palette-color'));
    if(node.matches?.('.fabric-background-color-mark,[data-background-custom-color]'))add('background-color',palette??drawnHighlight(node.getAttribute('data-background-custom-color')));
    else if(palette&&!values.has('color'))add('color',palette);
    if(node.hasAttribute('data-text-custom-color')&&!values.has('color'))add('color',drawnTextColor(node.getAttribute('data-text-custom-color')));
    const numberCell=node.classList?.contains(NUMBER_CELL);
    if(['TD','TH'].includes(node.tagName)) {
      add('background-color',node.getAttribute('data-cell-background'));
      // A cell keeps its stored color; Confluence draws it from its current palette.
      if(values.has('background-color'))values.set('background-color',drawnBackground(values.get('background-color')));
      // Header cells and a numbered table's number cells are shaded unless the author colored them.
      if((node.tagName==='TH'||numberCell)&&!values.has('background-color'))values.set('background-color',HEADER_BACKGROUND);
      if(numberCell&&!values.has('color'))values.set('color',NUMBER_COLOR);
      if(node.hasAttribute('data-colwidth')||numberCell) {
        warn('table-width-review','Table text, cell formatting, and source column proportions were captured; review responsive widths in SharePoint.');
        const cells=[...node.parentElement.children].filter(cell=>['TD','TH'].includes(cell.tagName)),widths=cells.map(cellWidth);
        const total=widths.reduce((sum,value)=>sum+(value??0),0),index=cells.indexOf(node);
        if(widths.every(Number.isFinite)&&total>0&&index>=0)values.set('width',`${Math.round(widths[index]/total*1_000_000)/10_000}%`);
      }
    }
    if(node.tagName==='TABLE'){
      values.set('width','100%');
      const firstRow=node.querySelector('tr');
      const cells=[...firstRow?.children||[]].filter(cell=>['TD','TH'].includes(cell.tagName));
      if(cells.length>1&&cells.every(cell=>Number.isFinite(cellWidth(cell))))values.set('table-layout','fixed');
    }
    if(['UL','OL'].includes(node.tagName)&&node.closest('td,th'))values.set('overflow','visible');
    const align=alignment(node)||inheritedAlign;
    if(align&&BLOCKS.has(node.tagName))values.set('text-align',align);
    if(node.tagName==='TH')values.set('text-align',align||'left');
    if(node.tagName==='TD'&&align)values.set('text-align',align);
    if(numberCell)values.set('text-align','center');
    // Confluence draws a cell's content from its top (measured); SharePoint centers it unless told.
    if(['TD','TH'].includes(node.tagName)&&!values.has('vertical-align'))values.set('vertical-align','top');
    return [...values].map(([property,value])=>`${property}:${value}`).join(';');
  }
  function codeItem(node) {
    const code=node.querySelector('code');
    // A code block drawn without its code element keeps the text it shows.
    if(!code){
      const text=node.textContent.replace(/\r\n?/g,'\n').replace(/\n$/,'');if(!text.trim())return {html:codeBlockHtml(''),text:''};
      warn('code-simplified','A code block was copied from the text it shows, because its code could not be read directly; check it in SharePoint.');
      return {html:codeBlockHtml(text),text};
    }
    const rows=[...code.querySelectorAll('[data-ds--code--row]')];
    const text=rows.length?rows.map(row=>row.textContent.replace(/\r\n?/g,'\n').replace(/\n$/,'')).join('\n'):code.textContent.replace(/\r\n?/g,'\n').replace(/\n$/,'');
    return {html:codeBlockHtml(text),text};
  }
  function panelItem(node,inheritedAlign) {
    const type=node.getAttribute('data-panel-type'),children=[...node.childNodes].map(child=>render(child,inheritedAlign));
    let html=children.map(child=>child.html).join(''),text=children.map(child=>child.text).join('');
    // An empty panel is still drawn: its color and icon, one line tall.
    if(!drawsSomething(html,text))html=`<p>${NBSP}</p>`;
    const icon=type==='custom'?panelIcon({text:node.getAttribute('data-panel-icon-text'),id:node.getAttribute('data-panel-icon-id'),shortName:node.getAttribute('data-panel-icon')}):standardPanelIcon(type);
    if(icon&&!compact(text).startsWith(icon.text)) {
      const decorated=html.replace(/<(p|h[1-6])([^>]*)>/i,`<$1$2>${icon.html} `);
      html=decorated===html?`${icon.html} ${html}`:decorated;text=`${icon.text} ${text}`;
    }
    model.stats.tables++;
    const color=PANEL_COLORS[type]||(type==='custom'?customPanelColor(node):null);
    return color?{html:panelHtml(html,color),text:` ${text} `}:{html:panelHtml(html,null),text:` ${text} `};
  }
  function inlineMediaItem(node) {
    const failed=/^UNKNOWN_/i.test(node.getAttribute('data-id')||'')||!!node.querySelector('[aria-label="error"],[data-testid*="error" i]')||/\bwe couldn['’]t load (?:the )?file\b/i.test(node.textContent||'');
    const candidates=[node.getAttribute('data-file-name'),node.getAttribute('data-filename'),node.getAttribute('aria-label'),node.getAttribute('title'),node.querySelector('img[alt]')?.getAttribute('alt')];
    const label=candidates.map(compact).find(value=>value&&value.length<=255&&!badMetadata(value)&&!/^(?:file|image|attachment|media|error)$/i.test(value));
    warn('inline-media-simplified','An inline Confluence file or media item was retained as concise editable text when a useful label was available.');
    if(!label)return {html:'',text:''};
    const href=safeLink(node.querySelector('a[href]')?.getAttribute('href'));
    if(href&&!failed)return {html:`<a href="${escape(href)}">${escape(label)}</a>`,text:label};
    return failed?{html:'',text:''}:{html:`<span>${escape(label)}</span>`,text:label};
  }
  // A picture that cannot be copied (its file not found, not downloaded, not a
  // readable picture, too large, or shown in a way capture cannot place) leaves
  // a marker where it was, linked to its file when that address is known and
  // safe, and is named in one note. Only verified pictures are ever kept.
  const lostPictures=[];
  // Custom emoji no standard emoji is similar to, by name (emojiName), for one note.
  const omittedEmoji=[];
  const LOST_REASONS={'invalid-attachment':'file not found','attachment-fetch-failed':'download failed','unsupported-image':'not a readable PNG, JPEG, GIF, WebP or SVG',
    'asset-too-large':'larger than SharePoint’s 250 MB limit','image-dimensions':'no width or height','unsupported-media':'shown in a way capture cannot place'};
  function pictureNotCopied(node,attachment,error) {
    const media=node.matches('[data-node-type="media"]')?node:node.querySelector('[data-node-type="media"]');
    const name=pictureFileName(media?.getAttribute('data-file-name'))??pictureFileName(attachment?.name);
    const address=safeLink(attachment?.url??attachmentLink(media,info.baseUrl));
    lostPictures.push({name,reason:LOST_REASONS[error?.code]??'could not be copied'});
    const label=`[Picture not copied${name?`: ${name}`:''}]`;
    const caption=compact(node.querySelector('[data-media-caption="true"],[data-testid="media-caption"]')?.textContent);
    return {html:`<p>${address?`<a href="${escape(address)}">${escape(label)}</a>`:escape(label)}</p>${caption?`<p>${escape(caption)}</p>`:''}`,text:` ${label} ${caption} `};
  }
  // A picture inside text, such as a table cell, a panel or a list, becomes a
  // link to its file followed by its caption, as in a live doc, because
  // capture places pictures only as their own SharePoint image controls.
  const linkedPictures=new Set();
  function linkedPicture(wrapper) {
    linkedPictures.add(wrapper);
    const media=wrapper.querySelector('[data-node-type="media"]'),attachment=attachments.get(wrapper)??{};
    const name=compact(media?.getAttribute('data-file-name')),context=media?.getAttribute('data-context-id')||info.pageId;
    const file=attachment.external?{name:'',url:attachment.external}:attachment.url?attachment
      :name&&name!=='file'&&name.length<=255&&!/[\\/\x00-\x1f\x7f]/.test(name)&&/^\d{1,20}$/.test(context)
        ?{name,url:`${info.baseUrl}/download/attachments/${encodeURIComponent(context)}/${encodeURIComponent(name)}`}:{};
    // Without a file to link to, the picture is marked as not copied.
    if(!file.url)return pictureNotCopied(wrapper,attachment,attachment.error??{code:'invalid-attachment'});
    const alt=compact(media?.querySelector('img')?.getAttribute('alt')),label=alt||file.name||file.url;
    const caption=compact(wrapper.querySelector('[data-media-caption="true"],[data-testid="media-caption"]')?.textContent);
    const href=file.url?safeLink(file.url):null;
    warn('nested-image-linked','A picture inside a table, panel, list, or column became a link to its file, because capture places pictures only as their own SharePoint image controls.');
    return {html:`<p>${href?`<a href="${escape(href)}">${escape(label)}</a>`:escape(label)}</p>${caption?`<p>${escape(caption)}</p>`:''}`,text:` ${label} ${caption} `};
  }
  function render(node,inheritedAlign) {
    if(node.nodeType===3)return {html:escape(node.textContent),text:node.textContent};
    if(prepared.has(node)){model.stats.tables++;return prepared.get(node);}
    if(node.nodeType!==1)return {html:'',text:''};
    if(node.matches(SKIP))return {html:'',text:''};
    if(node.matches('[data-testid="renderer-code-block"]'))return codeItem(node);
    if(node.matches('.ak-editor-panel'))return panelItem(node,inheritedAlign);
    if(node.matches('[data-node-type="mediaInline"]'))return inlineMediaItem(node);
    if(node.matches(EMOJI)) {
      const emoji=emojiOf(node),html=emojiHtml(emoji);
      if(html)return {html,text:emojiText(emoji)};
      omittedEmoji.push(emojiName(emoji));
      return {html:'',text:''};
    }
    if(node.matches('img')) {
      const alt=compact(node.getAttribute('alt'));
      if(alt&&node.closest('table[data-confluence-static-snapshot="table"]'))return {html:`<span>${escape(alt)}</span>`,text:alt};
      if(alt&&!node.closest('a[href]'))return {html:`<span>${escape(alt)}</span>`,text:alt};
      return {html:'',text:''};
    }
    if(node.matches('[data-node-type="mediaSingle"]'))return linkedPicture(node);
    if(node.matches('[data-node-type="media"]'))return pictureNotCopied(node,null,{code:'unsupported-media'});
    const align=alignment(node)||inheritedAlign;
    const children=[...node.childNodes].map(child=>render(child,align));
    const html=children.map(child=>child.html).join('');
    const boundary=BLOCKS.has(node.tagName)||['LI','TR','TD','TH'].includes(node.tagName);
    const text=children.map(child=>child.text).join('');
    if(!TAGS.has(node.tagName)) {
      if(!['DIV'].includes(node.tagName))warn('unsupported-format','Some Confluence presentation markup was simplified while retaining its text.');
      return {html,text};
    }
    const tag=node.tagName.toLowerCase(),attributes=[];
    if(headingMap.has(node))attributes.push(`id="${headingMap.get(node).id}"`);
    if(tag==='a') {const href=safeLink(node.getAttribute('href'));if(!href)return {html,text};attributes.push(`href="${escape(href)}"`);}
    // Numbering, merges and header settings SharePoint cannot take are left out, keeping the text.
    const listSimplified=()=>warn('list-simplified','A list’s unusual numbering was replaced with standard numbering; check it in SharePoint.');
    const tableSimplified=()=>warn('table-simplified','A table’s unusual merged cells or header settings were simplified; check the table in SharePoint.');
    if(tag==='ol') {
      if(node.hasAttribute('start')) {const start=node.getAttribute('start');if(/^\d{1,7}$/.test(start))attributes.push(`start="${start}"`);else listSimplified();}
      if(node.hasAttribute('type')) {const type=node.getAttribute('type');if(/^[1aAiI]$/.test(type))attributes.push(`type="${type}"`);else listSimplified();}
    }
    if(tag==='td'||tag==='th') {
      for(const attribute of ['colspan','rowspan'])if(node.hasAttribute(attribute)) {const value=node.getAttribute(attribute);if(/^\d{1,4}$/.test(value)&&Number(value)>=1)attributes.push(`${attribute}="${value}"`);else tableSimplified();}
      if(tag==='th') {let scope=node.getAttribute('scope')||'col';if(!['col','row'].includes(scope)){tableSimplified();scope='col';}attributes.push(`scope="${scope}"`);}
    }
    const css=styles(node,inheritedAlign);if(css)attributes.push(`style="${escape(css)}"`);
    if(tag==='table')model.stats.tables++;
    if(tag==='li'&&node.parentElement?.tagName==='UL')model.stats.bullets++;
    if(tag==='li'&&node.parentElement?.tagName==='OL')model.stats.numbered++;
    if(tag==='br')return {html:'<br>',text:'\n'};
    // An empty span, such as where Confluence hides a template hint, shows nothing.
    if(tag==='span'&&!html)return {html:'',text:''};
    // Inline code, outside preformatted text, keeps the grey Confluence gives it.
    if(tag==='code'&&!node.closest('pre'))return {html:inlineCodeHtml(html),text};
    // An empty list item still shows its number or bullet; a no-break space keeps it in SharePoint's editor.
    const inner=tag==='li'&&!drawsSomething(html,text)?NBSP:html;
    return {html:`<${tag}${attributes.length?' '+attributes.join(' '):''}>${inner}</${tag}>`,text:boundary?` ${text} `:text};
  }
  // Each item's `place` is the SharePoint section column it goes in ({id, factors, column}),
  // or undefined for the page's own column.
  const items=[];let sectionCount=0;
  function collect(node,inheritedAlign,place) {
    if(node.nodeType===3) {if(compact(node.textContent))items.push({kind:'text',node,align:inheritedAlign,place});return;}
    if(node.nodeType!==1||node.matches(SKIP))return;
    const plan=sectionPlans.get(node);
    if(plan) {
      for(const group of plan.groups) {
        const id=++sectionCount;
        group.columns.forEach((index,position)=>{
          const column=plan.columns[index],columnPlace={id,factors:group.factors,column:position+1};
          for(const child of column.childNodes)collect(child,alignment(column)||inheritedAlign,columnPlace);
        });
      }
      return;
    }
    const align=alignment(node)||inheritedAlign,push=kind=>items.push({kind,node,align,place});
    if(node.matches('[data-node-type="mediaSingle"]')) {push('image');return;}
    if(node.tagName==='HR') {push('divider');return;}
    if(prepared.has(node)) {push('text');return;}
    if(node.matches('img')) {push('text');return;}
    if(node.matches('.ak-editor-panel')) {push('text');return;}
    if(BLOCKS.has(node.tagName)||node.matches('[data-testid="renderer-code-block"]')) {push('text');return;}
    if(TAGS.has(node.tagName)&&node.tagName!=='SPAN') {push('text');return;}
    for(const child of node.childNodes)collect(child,align,place);
  }
  for(const child of article.childNodes)collect(child);
  const samePlace=(a,b)=>a===b||Boolean(a&&b&&a.id===b.id&&a.column===b.column);
  // Pictures inside text become links, so only pictures in the page flow are downloaded.
  const placedPictures=items.filter(item=>item.kind==='image').length;
  progress({phase:'capture',completed:0,total:placedPictures,message:'Reading the Confluence article.'});
  function isCaption(item) {
    const text=compact(item?.node?.textContent);
    return item?.kind==='text'&&item.node.tagName==='P'&&item.align==='center'&&!!text&&text.length<=1000;
  }
  // A step's text with each line break element as STEP_BREAK: a line break Confluence draws (whitespace.js)
  // separates a step's number from its text like a space does, but is no text to remove with the number.
  const STEP_BREAK=String.fromCharCode(0xe000);
  const stepText=node=>{
    let text='';const walker=document.createTreeWalker(node,5);
    for(let next=walker.nextNode();next;next=walker.nextNode())text+=next.nodeType===3?next.data:next.tagName==='BR'?STEP_BREAK:'';
    return text;
  };
  const STEP_NUMBER=new RegExp(`^[\\s${STEP_BREAK}]*(\\d{1,3})\\.(?:\\s+|(?=${STEP_BREAK}))`);
  function manualStep(item) {
    if(item?.kind!=='text'||item.node.tagName!=='P'||item.align==='center')return null;
    const match=STEP_NUMBER.exec(stepText(item.node));
    if(!match||Number(match[1])<1)return null;
    // The number's length in text, leaving out the line breaks it passed.
    return {number:Number(match[1]),prefixLength:match[0].length-(match[0].split(STEP_BREAK).length-1)};
  }
  function stepContents(item,step) {
    const clone=item.node.cloneNode(true),walker=document.createTreeWalker(clone,4);let remaining=step.prefixLength,node;
    while(remaining>0&&(node=walker.nextNode())) {
      const used=Math.min(remaining,node.data.length);node.data=node.data.slice(used);remaining-=used;
    }
    if(remaining)fail('unsupported-list','A manually numbered Confluence step has an unreadable number prefix.');
    for(const element of [...clone.querySelectorAll('span,strong,b,em,i')].reverse())if(!compact(element.textContent)&&!element.querySelector('br'))element.remove();
    const rendered=[...clone.childNodes].map(child=>render(child,item.align));
    const html=rendered.map(value=>value.html).join(''),text=rendered.map(value=>value.text).join('');
    if(!compact(text))fail('unsupported-list','A manually numbered Confluence step has no readable content.');
    return {html,text};
  }
  // A manually numbered step's number becomes its list numbering; `numberedSteps`
  // restores each number before its item's text for the check that no stored
  // text was lost.
  const sequencedManualSteps=new Set(),numberedSteps=[];let candidateSteps=[];
  const commitCandidateSteps=()=>{if(candidateSteps.length>=2)for(const candidate of candidateSteps)sequencedManualSteps.add(candidate.index);candidateSteps=[];};
  for(let index=0;index<items.length;index++) {
    const item=items[index],step=manualStep(item);
    if(step) {
      if(candidateSteps.length&&(step.number!==candidateSteps.at(-1).step.number+1||!samePlace(items[candidateSteps.at(-1).index].place,item.place)))commitCandidateSteps();
      candidateSteps.push({index,step});
      continue;
    }
    if(item.kind==='text'&&item.node.nodeType===1&&/^H[1-6]$/.test(item.node.tagName))commitCandidateSteps();
  }
  commitCandidateSteps();
  const assets=new Map(),downloads=new Map(),stalledHosts=new Set();let completed=0,pending=[],pendingPlace,previousTextWasList=false;
  const add=block=>model.blocks.push({id:`block-${model.blocks.length+1}`,...block});
  const placed=place=>place?{section:{id:place.id,factors:[...place.factors],column:place.column}}:{};
  const flush=()=>{if(pending.length)add({type:'text',html:pending.map(item=>item.html).join(''),text:compact(pending.map(item=>item.text).join(' ')),...placed(pendingPlace)});pending=[];};
  for(let index=0;index<items.length;index++) {
    const item=items[index];
    // Text never runs from one column into another.
    if(!samePlace(item.place,pendingPlace)){flush();pendingPlace=item.place;previousTextWasList=false;}
    if(item.kind==='text') {
      const first=manualStep(item);
      if(first&&sequencedManualSteps.has(index)) {
        const group=[{item,step:first}];
        for(let next=index+1;next<items.length;next++) {
          const step=manualStep(items[next]);
          if(!sequencedManualSteps.has(next)||!step||step.number!==group.at(-1).step.number+1||!samePlace(items[next].place,item.place))break;
          group.push({item:items[next],step});
        }
        let values=null;
        try{values=group.map(({item:entry,step})=>stepContents(entry,step));}
        catch{
          // Steps that cannot be read as a list stay the paragraphs they were written as.
          for(let position=0;position<group.length;position++)sequencedManualSteps.delete(index+position);
          warn('steps-simplified','Some manually numbered steps were kept as the paragraphs they were written as, because they could not be read as a list.');
        }
        if(values){
          numberedSteps.push(...group.map(({item:entry,step},position)=>`${entry.node.textContent.slice(0,step.prefixLength)}${values[position].text}`));
          pending.push({html:`<ol${first.number===1?'':` start="${first.number}"`}>${values.map(value=>`<li>${value.html}</li>`).join('')}</ol>`,text:values.map(value=>value.text).join(' ')});
          model.stats.numbered+=group.length;index+=group.length-1;previousTextWasList=true;continue;
        }
      }
      const rendered=render(item.node,item.align);
      // Kept whenever it draws something, as in a template to fill in: a table's grid with empty cells,
      // a list's numbers with empty items, a blank line.
      if(drawsSomething(rendered.html,rendered.text)) {
        if(previousTextWasList&&item.node.nodeType===1&&item.node.tagName==='P')rendered.html=rendered.html.replace(/^<p(\s[^>]*)?>/,match=>`${match}<br>`);
        pending.push(item.node.nodeType===3?{html:`<p>${rendered.html}</p>`,text:rendered.text}:rendered);
      }
      previousTextWasList=item.node.nodeType===1&&['OL','UL'].includes(item.node.tagName);
      continue;
    }
    // A rule is SharePoint's Divider between the text around it.
    if(item.kind==='divider'){flush();add({type:'divider',...placed(item.place)});previousTextWasList=false;continue;}
    previousTextWasList=false;const attachment=attachments.get(item.node);
    if(!attachment||attachment.error){pending.push(pictureNotCopied(item.node,attachment,attachment?.error??{code:'invalid-attachment'}));completed++;continue;}
    progress({phase:'images',completed,total:placedPictures,message:`Downloading image ${completed+1} of ${placedPictures}.`});
    // The width Confluence shows the picture at: the author's pixel width within the space the page gives it, else as laid out on the page.
    const declared=item.node.getAttribute('data-width-type')==='pixel'?Math.round(Number(item.node.getAttribute('data-width'))):0;
    const key=attachment.external?`external ${attachment.external}`:`file ${attachment.url??attachment.fallbackUrl} ${attachment.mime}`,displayWidth=declared>0?Math.min(declared,boxWidths.get(item.node)||declared):shownWidths.get(item.node);
    if(!downloads.has(key))downloads.set(key,attachment.external
      ?await fetchExternalImage({url:attachment.external,displayWidth},{fetchImpl,stalledHosts}).catch(()=>null)
      :await fetchConfluenceImage({...attachment,displayWidth},{fetchImpl}).catch(error=>({error})));
    const asset=downloads.get(key);
    if(asset?.error){pending.push(pictureNotCopied(item.node,attachment,asset.error));completed++;continue;}
    const alt=compact(item.node.querySelector('img')?.getAttribute('alt'));
    const nativeCaption=item.node.querySelector('[data-media-caption="true"],[data-testid="media-caption"]');
    if(!asset) {
      // A picture another website does not let capture copy becomes a link to it, followed by its caption.
      const href=safeLink(attachment.external),label=alt||attachment.external,captionText=compact(nativeCaption?.textContent);
      pending.push({html:`<p>${href?`<a href="${escape(href)}">${escape(label)}</a>`:escape(label)}</p>${captionText?`<p>${escape(captionText)}</p>`:''}`,text:` ${label} ${captionText} `});
      warn('external-image-linked','A picture shown from another website became a link to it, because it could not be copied from that website.');
      completed++;continue;
    }
    flush();
    if(!assets.has(asset.id)){assets.set(asset.id,asset);model.assets.push(asset)}
    if(asset.scaledFrom)warn('picture-scaled','Pictures wider than SharePoint can show were scaled to 2,408 pixels wide, twice the width of a SharePoint column, before upload.');
    if(attachment.external)warn('external-image-copied','A picture shown from another website was copied into SharePoint. Check that you may reuse it.');
    if(!alt)warn('missing-alt','Some images have no authored alternative text. Review their captions and add alternative text in SharePoint.');
    let caption=compact(nativeCaption?.textContent);
    if(caption.length>1000)caption='';
    if(isCaption(items[index+1])&&samePlace(items[index+1].place,item.place)) {
      const adjacent=compact(render(items[++index].node).text);
      if(!caption)caption=adjacent;
    }
    if(!caption)warn('missing-caption','One or more images have no immediately following centered caption.');
    let widthRatio=1;
    const declaredWidth=Number(item.node.getAttribute('data-width'));
    if(displayWidth&&articleWidth>0)widthRatio=Math.min(1,displayWidth/articleWidth);
    else if(item.node.getAttribute('data-width-type')==='pixel'&&declaredWidth>0&&articleWidth>0)widthRatio=Math.min(1,declaredWidth/articleWidth);
    else if(item.node.hasAttribute('data-width'))warn('image-width-review','An image width could not be mapped to the article width. Review its width in SharePoint.');
    add({type:'image',assetId:asset.id,caption,alt,widthRatio,...(displayWidth?{displayWidth}:{}),...placed(item.place)});model.stats.images++;completed++;
  }
  flush();
  if(!model.blocks.length)fail('empty-document','The Confluence article contains no supported body content.');
  if(lostPictures.length){
    const one=lostPictures.length===1,entries=lostPictures.map(({name,reason})=>name?`${name} (${reason})`:`an unnamed picture (${reason})`);
    warn('pictures-not-copied',`${one?lostPictures[0].name?`A picture was not copied: ${entries[0]}.`:`A picture was not copied (${lostPictures[0].reason}).`:`${lostPictures.length} pictures were not copied: ${inWords(entries)}.`} ${one?'It is':'Each is'} marked “[Picture not copied]” in the draft; add ${one?'it':'them'} in SharePoint if ${one?'it is':'they are'} needed.`,true);
  }
  if(omittedEmoji.length)warn('emoji-omitted',omittedEmojiNote(omittedEmoji),true);
  if(completed+linkedPictures.size!==mediaWrappers.length)warn('pictures-not-placed','Not every picture on the page could be placed in the draft. Compare the draft with the Confluence page.',true);
  const capturedText=compact([...model.blocks.map(block=>{
    if(block.type==='image')return `${block.caption??''} ${block.alt??''}`;
    if(block.type==='divider')return '';
    // A line break separates the words either side of it, as a stored line break does.
    const wrapper=document.createElement('div');wrapper.innerHTML=block.html;
    for(const lineBreak of wrapper.querySelectorAll('br'))lineBreak.replaceWith(' ');
    return wrapper.textContent;
  }),...numberedSteps].join(' '));
  const shown=value=>!value||capturedText.includes(value)||omittedLabels.has(value);
  // Text in a macro's body that Confluence does not show as page text cannot be captured from the page; it is noted.
  const macros=[...new Set(macroText.filter(({value})=>!shown(value)).map(({macro})=>macro))];
  if(macros.length)warn('macro-content-omitted',`Content inside ${inWords(macros)} was not captured, because Confluence does not show it as page text. Review the draft and add it in SharePoint if it is needed.`,true);
  // Stored text the capture does not hold is named in a note, with where it is and how each passage begins, so it can be found on the page.
  const missing=expectedText.filter(value=>!shown(value));
  if(missing.length){
    const places=inWords([...new Set(missing.map(value=>textPlaces.get(value)??'the body of the page'))]),quotes=missing.map(value=>`“${excerpt(value)}”`);
    warn('text-not-copied',missing.length===1
      ?`One passage of the page’s text was not copied: ${quotes[0]}, in ${places}. Compare the draft with the Confluence page and add it in SharePoint if it is needed.`
      :`${missing.length} passages of the page’s text were not copied, beginning ${inWords(quotes)}, in ${places}. Compare the draft with the Confluence page and add them in SharePoint if they are needed.`,true);
  }
  model.sourceHash=await captureHash(info,model);
  progress({phase:'ready',completed,total:completed,message:'Confluence article and all original images are ready.'});
  return model;
}
