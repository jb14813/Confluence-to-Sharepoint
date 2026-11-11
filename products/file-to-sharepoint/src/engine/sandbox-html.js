/* Glue around the packaged Word SDK's HTML importer and numbering model.
 * MIME/HTML is untrusted data. No source URL is fetched or used as a filename.
 */
(() => {
  'use strict';
  const fail=(message,code='HTML_CONTENT_BLOCKED')=>{throw Object.assign(new Error(message),{code});};
  const orderedTypes={'1':'decimal',a:'lower-alpha',A:'upper-alpha',i:'lower-roman',I:'upper-roman'};
  const formats={'decimal':'Decimal','lower-alpha':'LowerLetter','lower-latin':'LowerLetter','upper-alpha':'UpperLetter','upper-latin':'UpperLetter','lower-roman':'LowerRoman','upper-roman':'UpperRoman'};
  const cssGuard=css=>{
    // CSS escapes/imports/functions can conceal requests from a string URL
    // allowlist. Reject that capability before any stylesheet is attached.
    const plain=css.replace(/\/\*[\s\S]*?\*\//g,'');
    if(css.includes('\\')||/@(?:import|font-face|namespace)\b|(?:url|image-set|cross-fade|paint|element|expression)\s*\(|(?:behavior|-moz-binding)\s*:/i.test(plain))
      fail('The Word export contains CSS resources or active styles that cannot be imported offline.','HTML_CSS_BLOCKED');
  };
  function locationKey(value,base){
    if(typeof value!=='string'||!value||value.length>4096||/[\\\u0000-\u0020\u007f]/u.test(value)||/%(?:00|2f|5c)/i.test(value))fail('The Word export has an unsafe resource reference.','HTML_RESOURCE_BLOCKED');
    let decoded,url;
    try{decoded=decodeURIComponent(value);url=new URL(value,base);}catch{fail('The Word export has an invalid resource reference.','HTML_RESOURCE_BLOCKED');}
    if(decoded.split(/[/?#]/).some(part=>part==='.'||part==='..')||!['https:','http:','file:'].includes(url.protocol)||url.username||url.password||url.hash||url.protocol==='file:'&&url.hostname)
      fail('The Word export has an unsafe resource reference.','HTML_RESOURCE_BLOCKED');
    return url.href;
  }
  function imageMime(bytes){
    if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte))return 'image/png';
    if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
    const head=String.fromCharCode(...bytes.subarray(0,12));
    if(/^GIF8[79]a/.test(head))return 'image/gif';
    if(head.startsWith('RIFF')&&head.slice(8)==='WEBP')return 'image/webp';
    fail('The Word export contains an image type that the editable importer cannot preserve.','HTML_RESOURCE_BLOCKED');
  }
  const normalize=value=>value.replace(/\s+/gu,' ').trim();
  function figmaWidgetHref(target){
    // SharePoint stores this Figma numeric identifier with a literal colon.
    // Canonicalise only that known field before review; keep all other bytes,
    // including signed query values, exactly as supplied by the source URL.
    const ids=target.searchParams.getAll('node-id');
    if(ids.length!==1||!/^\d+:\d+$/.test(ids[0]))return target.href;
    return target.href.replace(/([?&]node-id=)(\d+)(?:%3a|:)(\d+)(?=&|#|$)/i,(_,key,left,right)=>key+left+':'+right);
  }
  function normalizeSourceWidgets(body,{passiveOnly=false}={}){
    const doc=body.ownerDocument,links=[],warnings=[],templateOrigins=new Set();let widgets=0,placeholders=0;
    const span=text=>{const node=doc.createElement('span');node.textContent=text;return node;};
    const staticButton=button=>{
      if(button.querySelector('input,select,textarea,form,iframe,button,object,embed'))fail('A source widget contains an unknown nested control.');
      const node=doc.createElement('span');node.append(...button.childNodes);button.replaceWith(node);return node;
    };
    // These are exporter UI signatures, not a general form sanitiser. Unknown
    // controls still reach the active-content blocker below. Never copy hidden
    // configuration, authentication tokens or source event handlers into output.
    if(!passiveOnly){
    for(const input of [...body.querySelectorAll('input[type="hidden"][name="reportParameters"]')]){
      if(!input.parentElement.matches('.table-wrapper')||!input.parentElement.querySelector('table.tasks-report'))continue;
      let value;try{value=JSON.parse(input.value);}catch{fail('The exported task-report configuration is malformed.');}
      const allowed=['columns','spaces','pages','duedateFrom','duedateTo','createdateFrom','createdateTo','assignees','creators','status','labels','pageSize','sortColumn','reverseSort'];
      if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(key=>!allowed.includes(key))||!Array.isArray(value.columns)||value.columns.some(column=>!['description','duedate','assignee','location'].includes(column)))fail('The exported task-report configuration is unsupported.');
      input.remove();widgets++;
    }
    for(const container of body.querySelectorAll('.plugin_attachments_container')){
      for(const input of [...container.querySelectorAll('.plugin_attachments_table_container > fieldset.hidden > input[type="hidden"]')]){
        const names=['pageId','pageSize','totalPages','upload'];
        if(!(input.classList.contains('plugin_attachments_macro_render_param')&&names.includes(input.name)||['deleteConfirmMessage','outputType'].includes(input.name)))continue;
        input.remove();widgets++;
      }
      for(const form of [...container.querySelectorAll('form.plugin_attachments_uploadform')]){
        if(!form.closest('.plugin_attachments_upload_container')||form.method.toLowerCase()!=='post'||form.getAttribute('enctype')!=='multipart/form-data'||!/^\/wiki\/pages\/plugins\/attachments\/doattachfile\.action\?pageId=[1-9][0-9]*$/.test(form.getAttribute('action')||''))continue;
        const controls=[...form.querySelectorAll('input,button,select,textarea,iframe,form')];
        if(controls.some(control=>control.localName==='iframe'?!control.matches('iframe.plugin_attachments_uploadiframe.hidden')||!!control.getAttribute('src')||!!normalize(control.textContent):control.localName!=='input'||!({hidden:['atl_token','labels'],file:['file_0'],text:['comment_0'],submit:['confirm']}[control.type]?.includes(control.name))))fail('The exported attachment uploader contains an unknown control.');
        if(controls.filter(control=>control.type==='file').length!==1||controls.filter(control=>control.type==='text').length!==1||controls.filter(control=>control.type==='submit').length!==1)fail('The exported attachment uploader has ambiguous fields.');
        for(const control of controls){
          if(control.localName==='iframe'||control.type==='hidden')control.remove();
          else control.replaceWith(span(control.type==='file'?'[No file selected]':control.type==='submit'?control.value:'['+(control.value||control.getAttribute('placeholder')||'File description')+']'));
        }
        const snapshot=doc.createElement('div');snapshot.append(...form.childNodes);form.replaceWith(snapshot);widgets++;
      }
    }
    for(const form of [...body.querySelectorAll('.search-macro form[name="livesearchForm"]')]){
      if(form.method.toLowerCase()!=='post'||form.getAttribute('action')!=='/wiki/dosearchsite.action')continue;
      const controls=[...form.querySelectorAll('input,button,select,textarea,iframe,form')],queries=controls.filter(control=>control.localName==='input'&&control.type==='text'&&control.name==='queryString'),buttons=controls.filter(control=>control.matches('button.search-macro-button[type="submit"]'));
      if(queries.length!==1||buttons.length!==1||controls.some(control=>!queries.includes(control)&&!buttons.includes(control)&&!(control.localName==='input'&&control.type==='hidden'&&['where','additional','labels','contentType'].includes(control.name))))fail('The exported search widget contains an unknown control.');
      for(const control of controls){if(queries.includes(control))control.replaceWith(span('['+(control.value||control.getAttribute('placeholder')||'Search')+']'));else if(buttons.includes(control))staticButton(control);else control.remove();}
      const snapshot=doc.createElement('div');snapshot.append(...form.childNodes);form.replaceWith(snapshot);widgets++;
    }
    for(const button of [...body.querySelectorAll('button.aui-button.create-from-template-button')]){
      let target;try{target=new URL(button.getAttribute('href'));}catch{fail('An exported template action has an invalid link.');}
      const key=button.getAttribute('data-space-key'),blueprint=button.getAttribute('data-content-blueprint-id');
      if(target.protocol!=='https:'||target.username||target.password||target.hash||target.pathname!=='/wiki'||!/^[A-Za-z0-9_~.-]{1,255}$/.test(key||'')||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(blueprint||'')||target.searchParams.size!==2||target.searchParams.get('createDialogSpaceKey')!==key||target.searchParams.get('createDialogBlueprintId')!==blueprint||!button.hasAttribute('disabled'))fail('An exported template action cannot be verified.');
      const node=staticButton(button),link=doc.createElement('a');link.href=target.href;link.append(...node.childNodes);node.replaceWith(link);links.push(target.href);templateOrigins.add(target.origin);widgets++;
    }
    for(const link of [...body.querySelectorAll('a.confluence-userlink[data-account-id][href^="/people/"]')]){
      const account=link.getAttribute('data-account-id');
      if(!/^[A-Za-z0-9:_-]{1,255}$/.test(account||'')||link.getAttribute('href')!=='/people/'+account+'?ref=confluence')fail('An exported user reference is malformed.');
      if(templateOrigins.size===1){link.href=[...templateOrigins][0]+link.getAttribute('href');links.push(link.href);}
      else{const label=doc.createElement('span');label.append(...link.childNodes);link.replaceWith(label);}
      widgets++;
    }
    for(const link of [...body.querySelectorAll('a.aui-button.sharelinks-urlmacro-button')]){
      if(templateOrigins.size!==1)fail('An exported bookmarklet has no verified source origin.');
      const origin=[...templateOrigins][0];
      // Compare the inert source to the known exporter bookmarklet. Its script
      // is never evaluated, retained as a URL, or applied to the current page.
      const expected="javascript:(function(){var screenWidth=screen.width,screenHeight=screen.height,popupWidth=640,popupHeight=580,popupLeft=0,popupTop=0; if(screenWidth>popupWidth){popupLeft=Math.round((screenWidth/2)-(popupWidth/2));}if(screenHeight>popupHeight){popupTop=Math.round((screenHeight/2)-(popupHeight/2));}window.open('"+origin+"/wiki/plugins/sharelinksbookmarklet/bookmarklet.action?bookmarkedURL='+encodeURIComponent(window.location.href), '','left='+popupLeft+',top='+popupTop+',width='+popupWidth+',height='+popupHeight+',personalbar=0,toolbar=0,scrollbars=1,resizable=1');}());";
      if(link.getAttribute('href')!==expected||link.querySelector('input,select,textarea,form,iframe,button,object,embed,svg'))fail('The exported bookmarklet is not a recognised static widget.');
      const snapshot=doc.createElement('span');snapshot.append('[Bookmarklet: ',...link.childNodes,']');link.replaceWith(snapshot);widgets++;
    }
    for(const button of [...body.querySelectorAll('.blog-post.macro-blank-experience > button.aui-button.create-post')]){staticButton(button);widgets++;}
    }
    for(const frame of [...body.querySelectorAll('iframe[src]')]){
      let embed,target;try{embed=new URL(frame.getAttribute('src'));target=new URL(embed.searchParams.get('url'));}catch{continue;}
      if(embed.protocol!=='https:'||embed.hostname!=='www.figma.com'||embed.port||embed.username||embed.password||embed.pathname!=='/embed'||embed.hash||[...embed.searchParams.keys()].some(key=>!['embed_host','url'].includes(key)))continue;
      if(target.protocol!=='https:'||target.hostname!=='www.figma.com'||target.port||target.username||target.password||!/^\/(?:file|design)\/[^/]+\//.test(target.pathname)||normalize(frame.textContent))fail('An exported Figma embed has no verified design link.');
      const href=figmaWidgetHref(target),link=doc.createElement('a');link.href=href;link.textContent='Figma design: '+href;frame.replaceWith(link);links.push(href);widgets++;
    }
    for(const img of [...body.querySelectorAll('span.confluence-embedded-file-wrapper > img.confluence-embedded-file.unknown-attachment')]){
      if(!/^\/wiki\/plugins\/servlet\/confluence\/placeholder\/unknown-attachment(?:\?locale=[A-Za-z_]+)?$/.test(img.getAttribute('src')||''))continue;
      img.replaceWith(span('[Unknown attachment]'));placeholders++;
    }
    if(widgets)warnings.push({code:'HTML_STATIC_WIDGETS',message:'Source widgets are preserved as editable snapshots or links.'});
    if(placeholders)warnings.push({code:'HTML_SOURCE_PLACEHOLDER',message:'The source unknown-attachment placeholder is preserved as editable text.'});
    return {links,warnings};
  }
  function normalizeDecisionLists(body){
    for(const list of [...body.querySelectorAll('ul.decision-list')]){
      if([...list.children].every(child=>child.localName==='li'))continue;
      if([...list.childNodes].some(child=>child.nodeType===Node.TEXT_NODE&&child.textContent.trim()||child.nodeType===Node.ELEMENT_NODE&&!child.matches('li,h1,h2,h3,h4,h5,h6,p')))
        fail('The exported decision list has an unsupported child.','HTML_LIST_UNSUPPORTED');
      const text=list.textContent,count=list.querySelectorAll('li').length,wrapper=body.ownerDocument.createElement('div');
      for(const attribute of list.attributes)wrapper.setAttribute(attribute.name,attribute.value);
      let group;
      for(const child of [...list.childNodes]){
        if(child.nodeType===Node.ELEMENT_NODE&&child.localName==='li'){
          if(!group){group=list.cloneNode(false);group.removeAttribute('id');wrapper.append(group);}group.append(child);
        }else{if(child.nodeType===Node.ELEMENT_NODE)group=null;(group||wrapper).append(child);}
      }
      if(wrapper.textContent!==text||wrapper.querySelectorAll('li').length!==count)fail('The exported decision-list order could not be verified.','HTML_SEMANTICS_UNVERIFIED');
      list.replaceWith(wrapper);
    }
  }
  function markerImport(source){
    const warnings=[];
    // Keep the browser's authored cascade and auto layout pristine. Temporary
    // marker paragraphs belong only to the detached SDK import clone.
    const context=source.parentElement;
    if(context?.localName!=='html')fail('The source document context is unavailable.','HTML_LAYOUT_UNVERIFIED');
    const walker=document.createTreeWalker(context,NodeFilter.SHOW_ALL);let sourceCount=1;
    while(walker.nextNode())if(++sourceCount>500000)fail('The source layout exceeds the local node limit.','DOCUMENT_TOO_LARGE');
    // The SDK also examines BODY's HTML/HEAD context when deciding paragraph
    // boundaries. Preserve that native context without attaching the copy.
    const copyContext=context.cloneNode(true),originals=new WeakMap(),pending=[[context,copyContext]];
    let count=0,body;
    while(pending.length){
      const [original,copy]=pending.pop();
      if(++count>500000||original.nodeType!==copy.nodeType||original.nodeName!==copy.nodeName||original.childNodes.length!==copy.childNodes.length)
        fail('The source layout could not be associated with its import copy.','HTML_LAYOUT_UNVERIFIED');
      originals.set(copy,original);
      if(original===source)body=copy;
      for(let i=0;i<original.childNodes.length;i++)pending.push([original.childNodes[i],copy.childNodes[i]]);
    }
    if(!body)fail('The source body could not be associated.','HTML_LAYOUT_UNVERIFIED');
    const styleOf=node=>{
      const original=originals.get(node);
      if(!original?.isConnected)fail('The original source layout is unavailable.','HTML_LAYOUT_UNVERIFIED');
      const style=getComputedStyle(original);
      // The SDK uses clientWidth only when computed width is unavailable.
      // A detached clone must never supply that geometry fallback.
      if(node.matches('td,th')&&!/^(?:\d+(?:\.\d+)?|\.\d+)px$/.test(style.getPropertyValue('width'))){
        const measured=original.getBoundingClientRect().width;
        if(!Number.isFinite(measured)||measured<0)fail('A source table cell has no readable browser geometry.','HTML_LAYOUT_UNVERIFIED');
        if(!warnings.length)warnings.push({code:'HTML_TABLE_LAYOUT_ADAPTED',message:'Some source table CSS uses measured browser widths for responsive native SharePoint cells.'});
        const width=measured+'px';
        return new Proxy(style,{get(target,key){
          if(key==='width')return width;
          if(key==='getPropertyValue')return property=>property==='width'?width:target.getPropertyValue(property);
          const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
        }});
      }
      return style;
    };
    return {body,styleOf,warnings,inheritEmpty(paragraph,owner){
      const original=originals.get(owner);
      if(owner.localName!=='li'||!original||paragraph.localName!=='p'||paragraph.textContent!=='\u00a0')
        fail('An empty list paragraph has no verified source owner.','HTML_LAYOUT_UNVERIFIED');
      // This synthetic paragraph represents the source's otherwise empty LI.
      // Its inherited color/font belong to that exact original list item.
      originals.set(paragraph,original);
    },install(){
      const proto=window.AscCommon?.PasteProcessor?.prototype,descriptor=proto&&Object.getOwnPropertyDescriptor(proto,'_getComputedStyle');
      if(typeof descriptor?.value!=='function'||!descriptor.configurable)
        fail('The Office source-style reader is unavailable.','HTML_LAYOUT_UNVERIFIED');
      // Only our boundary/empty-item elements were added after the exact clone.
      const internal=new WeakSet([...body.querySelectorAll('*')].filter(node=>!originals.has(node)));
      const replacement=function(node){
        if(originals.has(node)&&node.nodeType===Node.ELEMENT_NODE)return styleOf(node);
        if(node?.nodeType===Node.ELEMENT_NODE&&body.contains(node)&&!internal.has(node))
          fail('An imported element has no verified source style.','HTML_LAYOUT_UNVERIFIED');
        return descriptor.value.call(this,node);
      };
      Object.defineProperty(proto,'_getComputedStyle',{...descriptor,value:replacement});
      return ()=>{
        Object.defineProperty(proto,'_getComputedStyle',descriptor);
        const current=Object.getOwnPropertyDescriptor(proto,'_getComputedStyle');
        if(current.value!==descriptor.value||current.writable!==descriptor.writable||current.enumerable!==descriptor.enumerable||current.configurable!==descriptor.configurable)
          fail('The Office source-style reader could not be restored.','HTML_LAYOUT_UNVERIFIED');
      };
    }};
  }
  function annotateAnchors(body,plan,prefix){
    plan.links=new Map();plan.linkCount=0;
    const targets=new Map(),sourceIds=new Map();
    for(const element of body.querySelectorAll('[id]')){
      const id=element.getAttribute('id');if(sourceIds.has(id))sourceIds.set(id,null);else sourceIds.set(id,element);
    }
    for(const link of body.querySelectorAll('a[href^="#"]')){
      let id;try{id=decodeURIComponent(link.getAttribute('href').slice(1));}catch{fail('An internal source link is malformed.','HTML_SEMANTICS_UNVERIFIED');}
      const target=sourceIds.get(id);
      if(!target||!target.matches('h1,h2,h3,h4,h5,h6,p'))fail('An internal source link has no verified paragraph target.','HTML_SEMANTICS_UNVERIFIED');
      if(!targets.has(target)){
        const anchorId='file-source-anchor-'+(targets.size+1),key=prefix+'anchor-'+targets.size,marker=body.ownerDocument.createElement('p');
        marker.textContent=key;marker.setAttribute('style','mso-list:none');target.before(marker);
        plan.markers.set(key,{position:'anchor',anchorId});targets.set(target,anchorId);
      }
      const href='https://fts-local.invalid/'+prefix+'/'+targets.get(target);
      plan.links.set(href,'#'+targets.get(target));plan.linkCount++;link.setAttribute('href',href);
    }
  }
  function annotateLists(body,markerPrefix,styleOf=getComputedStyle,inheritEmpty=()=>{}){
    const items=[],markers=new Map();
    let listId=0;
    function visit(container,depth=0,parentId=null){
      for(const node of [...container.children]){
        if(node.matches('td,th')){visit(node,0,null);continue;}
        if(!node.matches('ol,ul')){visit(node,depth,parentId);continue;}
        if(depth>8||node.hasAttribute('reversed'))fail('This HTML list depth or direction cannot be preserved.','HTML_LIST_UNSUPPORTED');
        const ordered=node.localName==='ol',computed=styleOf(node).listStyleType,taskList=node.classList.contains('inline-task-list');
        const style=node.style.listStyleType||node.getAttribute('type')&&orderedTypes[node.getAttribute('type')]||computed||(ordered?'decimal':'disc');
        const tocNone=style==='none'&&!ordered&&(node.classList.contains('toc-indentation')||node.closest('.toc-macro'));
        const markerless=taskList||tocNone;
        if(!markerless&&(ordered?!formats[style]:!['disc','circle','square'].includes(style)))fail('This HTML list marker cannot be preserved as a native editable list.','HTML_LIST_UNSUPPORTED');
        if(ordered&&node.hasAttribute('start')&&!/^\+?[0-9]{1,16}$/.test(node.getAttribute('start')))fail('The HTML list start is invalid.','HTML_LIST_UNSUPPORTED');
        let value=ordered&&node.hasAttribute('start')?Number(node.getAttribute('start')):1;
        if(!Number.isSafeInteger(value)||value<0||value>9999999)fail('This HTML list start is outside the supported counter range.','HTML_LIST_UNSUPPORTED');
        let segment=++listId;
        for(const li of [...node.children]){
          if(li.localName!=='li')fail('The HTML list has a child that is not a list item.','HTML_LIST_UNSUPPORTED');
          if(!taskList&&styleOf(li).listStyleType!==style)fail('A per-item source list marker differs from its verified list definition.','HTML_LIST_UNSUPPORTED');
          if(taskList&&(!li.hasAttribute('data-inline-task-id')||li.classList.contains('unchecked')||['aria-checked','data-completed','data-task-status','data-inline-task-completed'].some(name=>li.hasAttribute(name)))||!taskList&&li.hasAttribute('data-inline-task-id'))
            fail('The Word export contains task state that cannot be verified.','HTML_LIST_UNSUPPORTED');
          if(items.length>=10000)fail('The Word export contains too many list items.','DOCUMENT_TOO_LARGE');
          if(ordered&&li.hasAttribute('value')){
            if(!/^\+?[0-9]{1,16}$/.test(li.getAttribute('value')))fail('The HTML list-item counter is invalid.','HTML_LIST_UNSUPPORTED');
            const explicit=Number(li.getAttribute('value'));
            if(!Number.isSafeInteger(explicit)||explicit<0||explicit>9999999)fail('An HTML list item has an unsupported counter.','HTML_LIST_UNSUPPORTED');
            if(explicit!==value){value=explicit;segment=++listId;}
          }
          const id=markerPrefix+items.length,item={id,segment,depth,parentId,value,style,ordered,markerless,kind:taskList?'task':tocNone?'toc':undefined,taskState:taskList?(li.classList.contains('checked')?'checked':'unchecked'):undefined};
          items.push(item);
          // A native Word list marker belongs to a paragraph. When source LI
          // begins with a table/nested list, retain its otherwise empty marker.
          const first=[...li.childNodes].find(child=>child.nodeType!==Node.TEXT_NODE||child.textContent.trim());
          const own=li.cloneNode(true);own.querySelectorAll('ol,ul').forEach(child=>child.remove());
          if(!first||!normalize(own.textContent)&&!own.querySelector('img,table')||first.nodeType===Node.ELEMENT_NODE&&first.matches('table,ol,ul')){
            // The SDK drops fully empty HTML blocks. NBSP preserves the native
            // empty item paragraph and adds no visible authored text.
            const empty=body.ownerDocument.createElement('p');empty.textContent='\u00a0';inheritEmpty(empty,li);li.prepend(empty);
          }
          visit(li,depth+1,id);
          for(const [position,key] of [['start',id+'-start'],['end',id+'-end']]){
            const marker=body.ownerDocument.createElement('p');marker.textContent=key;
            marker.setAttribute('style','mso-list:none');
            markers.set(key,{position,item});
            position==='start'?li.prepend(marker):li.append(marker);
          }
          value++;
        }
      }
    }
    visit(body);
    return {items,markers};
  }
  function applyNativeLists(logic,plan){
    const associations=new WeakMap(),anchors=new WeakMap(),firsts=new Map(),seen=new Set(),removals=[];
    function visit(parent,outerList=false){
      const stack=[],pendingAnchors=[];
      for(const node of parent.Content){
        const paragraph=typeof node.GetNumPr==='function',text=paragraph?node.GetText({Numbering:false,ParaSeparator:'',TableCellSeparator:'',TableRowSeparator:''}):'';
        const marker=plan.markers.get(text);
        if(marker){
          if(seen.has(text))fail('The SDK duplicated a source list boundary.','HTML_SEMANTICS_UNVERIFIED');
          seen.add(text);removals.push({parent,node});
          if(marker.position==='anchor'){pendingAnchors.push(marker.anchorId);continue;}
          if(marker.position==='start'){
            if((stack.at(-1)?.id??null)!==marker.item.parentId)fail('The SDK changed the source list hierarchy.','HTML_SEMANTICS_UNVERIFIED');
            stack.push(marker.item);
          }else{
            if(stack.at(-1)!==marker.item||!firsts.has(marker.item.id))fail('The SDK did not preserve a complete source list item.','HTML_SEMANTICS_UNVERIFIED');
            stack.pop();
          }
          continue;
        }
        if(pendingAnchors.length){if(!paragraph)fail('A source anchor lost its native paragraph.','HTML_SEMANTICS_UNVERIFIED');anchors.set(node,pendingAnchors.splice(0));}
        const item=stack.at(-1);
        if(paragraph&&(item||outerList))node.RemoveNumPr();
        if(item){
          const first=!firsts.has(item.id);
          if(first&&!paragraph)fail('A source list item lost its native paragraph anchor.','HTML_SEMANTICS_UNVERIFIED');
          if(first)firsts.set(item.id,node);
          associations.set(node,{id:item.id,first,markerless:item.markerless,kind:item.kind,taskState:item.taskState});
        }
        // Native table cells are independent content scopes. An enclosing
        // item associates the table itself, while cell-local lists start at 0.
        if(typeof node.GetRowsCount==='function')for(const row of node.Content)for(const cell of row.Content)visit(cell.Content,Boolean(item)||outerList);
      }
      if(stack.length||pendingAnchors.length)fail('The SDK split a source boundary across content scopes.','HTML_SEMANTICS_UNVERIFIED');
    }
    visit(logic);
    if(seen.size!==plan.markers.size)fail('The SDK omitted a source list boundary.','HTML_SEMANTICS_UNVERIFIED');
    for(const {parent,node} of removals.reverse()){
      const index=parent.Content.indexOf(node);
      if(index<0)fail('A source association is detached from its native document.','HTML_SEMANTICS_UNVERIFIED');
      parent.RemoveFromContent(index,1,false);
    }
    const numbering=logic.GetNumbering(),numbers=new Map();
    for(const item of plan.items){
      let num=numbers.get(item.segment);
      if(!num){
        num=numbering.CreateNum();
        num.CreateDefault(item.ordered?Asc.c_oAscMultiLevelNumbering.Numbered:Asc.c_oAscMultiLevelNumbering.Bullet);
        if(item.markerless){num.SetLvlByType(item.depth,Asc.c_oAscNumberingLevel.None);}
        else if(item.ordered){
          const preset={decimal:'DecimalDot_Left',LowerLetter:'LowerLetterDot_Left',UpperLetter:'UpperLetterDot_Left',LowerRoman:'LowerRomanDot_Right',UpperRoman:'UpperRomanDot_Right'}[formats[item.style]]||'DecimalDot_Left';
          num.SetLvlByType(item.depth,Asc.c_oAscNumberingLevel[preset]);num.SetLvlStart(item.depth,item.value);
        }else{
          const [glyph,font]={disc:['\u00b7','Symbol'],circle:['o','Courier New'],square:['\uf0a7','Wingdings']}[item.style],pr=new AscCommonWord.CTextPr();
          pr.RFonts.SetAll(font,-1);num.SetLvlByType(item.depth,Asc.c_oAscNumberingLevel.Bullet,glyph,pr);
        }
        numbers.set(item.segment,num);
      }
      firsts.get(item.id).SetNumPr(num.GetId(),item.depth);
      if(item.kind==='task'){
        const paragraph=firsts.get(item.id),prefix=new AscWord.ParaRun(paragraph,false);
        prefix.AddText((item.taskState==='checked'?'\u2611':'\u2610')+' ');paragraph.AddToContent(0,prefix);
      }
    }
    for(const item of plan.items){
      const paragraph=firsts.get(item.id),pr=paragraph.GetNumPr(),parent=paragraph.GetParent();
      if(!pr||pr.Lvl!==item.depth||item.ordered&&parent.CalculateNumberingValues(paragraph,pr)[pr.Lvl]!==item.value)
        fail('The SDK could not verify the original HTML list counter.','HTML_SEMANTICS_UNVERIFIED');
    }
    let restored=0;
    function restoreLinks(node){
      if(typeof node.GetValue==='function'&&typeof node.SetValue==='function'&&plan.links.has(node.GetValue())){node.SetValue(plan.links.get(node.GetValue()));restored++;}
      const content=Array.isArray(node.Content)?node.Content:node.Content?.Content;
      if(content)for(const child of content)restoreLinks(child);
    }
    restoreLinks(logic);
    if(restored!==plan.linkCount)fail('The SDK did not retain every internal source hyperlink.','HTML_SEMANTICS_UNVERIFIED');
    return {associations,anchors};
  }
  window.ftsInstallHtmlWriter=function(writer,state){
    if(!state)return;
    for(const method of ['SerParagraph','SerTable']){
      const serialize=writer[method];
      writer[method]=function(node,...args){
        const output=serialize.call(this,node,...args),association=state.associations.get(node);
        if(output&&association)output[association.first?'ftsListItem':'ftsListContinuation']={itemId:association.id,...(association.first&&association.markerless?{markerless:true,kind:association.kind,...(association.kind==='task'?{taskState:association.taskState}:{})}:{})};
        if(output&&state.anchors.has(node))output.ftsSourceAnchors=state.anchors.get(node);
        return output;
      };
    }
  };
  window.ftsRetainVerticalMergeAnchors=function(writer){
    const serialize=writer.SerTableCell;
    writer.SerTableCell=function(cell,...args){
      const output=serialize.call(this,cell,...args);
      if(!output||output.tcPr?.vMerge!==undefined||cell.GetVMerge()!==1)return output;
      const row=cell.GetRow(),table=cell.GetTable(),rowIndex=table.Content.indexOf(row),cellIndex=row.Content.indexOf(cell);
      if(rowIndex<0||cellIndex<0)throw new Error('SDK cell is detached from its native table.');
      const start=row.GetCellInfo(cellIndex).StartGridCol,span=table.Internal_GetVertMergeCount(rowIndex,start,cell.GetGridSpan());
      if(Number.isInteger(span)&&span>1)(output.tcPr??={}).vMerge='restart';
      return output;
    };
  };
  window.ftsRetainResolvedCellAlignment=function(writer){
    const serialize=writer.SerTableCell,alignments=['top','center','bottom'];
    writer.SerTableCell=function(cell,...args){
      const output=serialize.call(this,cell,...args);if(!output)return output;
      // The vendor property writer tests truthiness and omits numeric TOP=0.
      // Preserve the resolved getter, including direct top over a center style.
      const value=cell.Get_VAlign();
      if(!Number.isInteger(value)||value<0||value>=alignments.length)
        fail('The Office cell alignment could not be verified.','CELL_ALIGNMENT_UNVERIFIED');
      output.ftsVerticalAlign=alignments[value];return output;
    };
  };
  window.ftsPreserveNativeUnicode=function(writer){
    const serialize=writer.SerParaRun,isText=item=>item?.constructor===AscWord.CRunText;
    writer.SerParaRun=function(run,...args){
      const output=serialize.call(this,run,...args);
      if(!output||!run.Content.some(item=>isText(item)&&item.GetCodePoint()>0xffff))return output;
      const old=[],corrected=[];
      for(const item of run.Content){
        if(isText(item)){
          const point=item.GetCodePoint();
          if(!Number.isInteger(point)||point<0||point>0x10ffff)fail('The SDK returned an invalid Unicode codepoint.','UNICODE_SERIALIZATION_UNVERIFIED');
          old.push(String.fromCharCode(point));corrected.push(String.fromCodePoint(point));
        }else if(item.IsSpace?.()){old.push(' ');corrected.push(' ');}
      }
      // The pinned SDK's SerRun uses fromCharCode for native scalar values.
      // Only normalize a run whose complete serialized text is independently
      // accounted for by those exact native text/space objects. Fields with a
      // different generated textual representation remain fail closed.
      if(!Array.isArray(output.content)||output.content.filter(value=>typeof value==='string').join('')!==old.join(''))
        fail('The SDK Unicode serialization could not be verified.','UNICODE_SERIALIZATION_UNVERIFIED');
      let offset=0;
      output.content=output.content.map(value=>{
        if(typeof value!=='string')return value;
        const text=corrected.slice(offset,offset+value.length).join('');offset+=value.length;return text;
      });
      return output;
    };
  };
  window.ftsImportHtml=async function(api,payload){
    const registered=new Map(),blobs=[],blobNames=new Map(),sourceImages=[],sourceLoading=new Map();
    let host,typography,restoreStyleReader,silent=false,disposed=false;
    const previousNative=window.native,logic=api.WordControl.m_oLogicDocument;
    const active=()=>{if(disposed)throw new DOMException('The HTML import was cancelled.','AbortError');};
    const dispose=()=>{
      disposed=true;
      // Preparation promises can settle after pagehide. Cleanup remains safe
      // to repeat and drains anything returned by a reentrant native callback.
      let error;const release=work=>{try{work();}catch(failure){error??=failure;}};
      const reader=restoreStyleReader;restoreStyleReader=undefined;
      release(()=>reader?.());
      removeEventListener('pagehide',dispose);
      release(()=>{if(silent){silent=false;logic.End_SilentMode(false);}});
      release(()=>host?.remove());release(()=>typography?.dispose());
      for(const url of blobs.splice(0))release(()=>URL.revokeObjectURL(url));
      release(()=>{if(previousNative===undefined)delete window.native;else window.native=previousNative;});
      if(error)throw error;
    };
    addEventListener('pagehide',dispose,{once:true});
    try{
      active();
      if(typeof payload?.html!=='string'||!payload.html||payload.html.length>50*1024*1024||!Array.isArray(payload.resources)||payload.resources.length>4096)
        fail('The decoded Word HTML payload is invalid.');
      const rootLocation=locationKey(payload.rootLocation),byLocation=new Map(),byCid=new Map(),names=new Set();
      let total=payload.html.length*2;
      for(const resource of payload.resources){
        if(!(resource?.bytes instanceof Uint8Array)||!resource.bytes.length||!/^mhtml-resource-[1-9][0-9]{0,4}\.bin$/.test(resource.name)||names.has(resource.name))fail('The decoded Word resource payload is invalid.','HTML_RESOURCE_BLOCKED');
        if(resource.svgDensity!==undefined&&(typeof resource.svgDensity!=='number'||!Number.isFinite(resource.svgDensity)||resource.svgDensity<=0||resource.svgDensity>4096||resource.bytes.length<24||resource.mime!=='image/png'||imageMime(resource.bytes)!=='image/png'))fail('The SVG raster density is invalid.','HTML_RESOURCE_BLOCKED');
        names.add(resource.name);total+=resource.bytes.length;
        if(total>150*1024*1024)fail('The expanded document exceeds the 150 MiB limit.','DOCUMENT_TOO_LARGE');
        if(resource.location){const key=locationKey(resource.location,rootLocation);if(byLocation.has(key))fail('The Word export contains ambiguous resources.','HTML_RESOURCE_BLOCKED');byLocation.set(key,resource);}
        if(resource.contentId){if(typeof resource.contentId!=='string'||byCid.has(resource.contentId))fail('The Word export contains ambiguous content identities.','HTML_RESOURCE_BLOCKED');byCid.set(resource.contentId,resource);}
      }
      const parsed=new DOMParser().parseFromString(payload.html,'text/html');
      if(parsed.querySelectorAll('*').length>100000)fail('The decoded Word HTML contains too many elements.','DOCUMENT_TOO_LARGE');
      // Inspect the complete inert source before removing proven exporter metadata.
      // An otherwise recognised widget cannot conceal active attributes or CSS.
      for(const element of parsed.querySelectorAll('*')){
        for(const attribute of element.attributes){
          const name=attribute.name.toLowerCase();
          // A broken exporter quote tokenises "only" as an empty attribute on
          // this hidden deletion-confirmation string. It is not an event, and
          // the exact metadata input is removed by normalizeSourceWidgets.
          const literalOnly=name==='only'&&attribute.value===''&&element.matches('.plugin_attachments_container .plugin_attachments_table_container > fieldset.hidden > input[type="hidden"][name="deleteConfirmMessage"]')&&element.getAttribute('value')==='Are you sure you want to send the attached file ';
          if(name.startsWith('on')&&!literalOnly||['srcset','background','poster','srcdoc','formaction'].includes(name)||name==='xlink:href'&&!element.closest('svg'))fail('The Word export contains active or unresolved resource attributes.');
          if(name==='style'&&!element.closest('svg'))cssGuard(attribute.value);
          if(name==='src'&&!['img','iframe'].includes(element.localName))fail('The Word export contains an unsupported resource-bearing element.','HTML_RESOURCE_BLOCKED');
        }
        if(element.localName==='style'&&!element.closest('svg'))cssGuard(element.textContent);
      }
      if(parsed.querySelector('svg')&&typeof window.FtsSvg?.preflight!=='function')fail('The local SVG preparation helper is unavailable.','HTML_SVG_UNAVAILABLE');
      const svgPlan=parsed.querySelector('svg')?await FtsSvg.preflight(parsed.body,{resources:payload.resources,totalBytes:total,assertActive:active}):null;
      active();
      const preserveImageAncestors=!!svgPlan||!!parsed.body.querySelector('img');
      // Verify structural adaptation on a detached copy first. Preserve actual
      // button/form ancestor tags until their SVG descendants have a computed
      // cascade; no unverified control or resource is ever attached.
      const preview=parsed.body.cloneNode(true),widgets=normalizeSourceWidgets(preview);
      if(preview.querySelector('script,iframe,frame,frameset,object,embed,applet,portal,base,link,form,input,select,textarea,button,math,canvas,video,audio,source,track,template,noscript')||parsed.head.querySelector('script,iframe,frame,object,embed,base,link'))
        fail('The Word export contains active forms, embeds, vector content or controls that this document importer cannot preserve.');
      const elements=preview.querySelectorAll('*');
      if(elements.length>100000)fail('The decoded Word HTML contains too many elements.','DOCUMENT_TOO_LARGE');
      for(const element of elements){
        for(const attribute of element.attributes){
          const name=attribute.name.toLowerCase();
          if(name.startsWith('on')||['srcset','background','poster','srcdoc','formaction'].includes(name)||name==='xlink:href'&&!element.closest('svg'))fail('The Word export contains active or unresolved resource attributes.');
          if(name==='style'&&!element.closest('svg'))cssGuard(attribute.value);
          if(name==='src'&&element.localName!=='img')fail('The Word export contains an unsupported resource-bearing element.','HTML_RESOURCE_BLOCKED');
          if(name==='href'&&element.localName==='a'&&!/^(?:https?:|mailto:|#)/i.test(attribute.value))fail('The Word export contains an unsupported link target.','HTML_RESOURCE_BLOCKED');
        }
        if(element.localName==='style'&&!element.closest('svg'))cssGuard(element.textContent);
      }
      parsed.querySelectorAll('meta,head > title').forEach(node=>node.remove());
      const sourceTexts=[],imageCount=preview.querySelectorAll('img').length+(svgPlan?.entries.length||0),tableCount=preview.querySelectorAll('table').length;
      normalizeSourceWidgets(parsed.body,{passiveOnly:preserveImageAncestors});
      // Empty known upload frames and all recognised external embeds are removed
      // before attachment. Forms keep source classes/tags for CSS, with URLs
      // neutralised, submission prevented, and the complete host made inert.
      parsed.body.querySelectorAll('iframe.plugin_attachments_uploadiframe.hidden').forEach(frame=>frame.remove());
      const neutralized=[];
      for(const element of parsed.body.querySelectorAll('form,a[href^="javascript:"]')){
        for(const attribute of element.localName==='form'?['action','target']:['href'])if(element.hasAttribute(attribute)){neutralized.push({element,attribute,value:element.getAttribute(attribute)});element.removeAttribute(attribute);}
        if(element.localName==='form')element.addEventListener('submit',event=>event.preventDefault());
      }
      const register=resource=>{
        active();
        if(!registered.has(resource.name)){
          const mime=imageMime(resource.bytes),url=URL.createObjectURL(new Blob([resource.bytes],{type:mime}));
          blobs.push(url);active();blobNames.set(url,resource.name);registered.set(resource.name,url);AscCommon.g_oDocumentUrls.addImageUrl(resource.name,url);
        }
        return registered.get(resource.name);
      };
      for(const img of parsed.querySelectorAll('img')){
        const src=img.getAttribute('src')||'',resource=src.startsWith('cid:')?byCid.get(src.slice(4)):byLocation.get(locationKey(src,rootLocation));
        if(!resource)fail('A Word image is missing from the embedded archive. No external image was requested.','HTML_RESOURCE_BLOCKED');
        img.setAttribute('src',register(resource));
        // Raw source srcset was rejected above. Width descriptors avoid an
        // implicit 1x fallback from img.src, while preserving that same Blob
        // reference for the SDK. The browser resolves every sizing override.
        if(resource.svgDensity!==undefined){
          const pixels=new DataView(resource.bytes.buffer,resource.bytes.byteOffset,resource.bytes.byteLength).getUint32(16),intrinsic=pixels/resource.svgDensity;
          if(!pixels||pixels>4096||!Number.isFinite(intrinsic)||intrinsic<1||intrinsic>100000)fail('The SVG raster density is invalid.','HTML_RESOURCE_BLOCKED');
          img.setAttribute('srcset',registered.get(resource.name)+' '+pixels+'w');img.setAttribute('sizes',intrinsic+'px');
        }
        sourceLoading.set(img,img.getAttribute('loading'));img.loading='eager';sourceImages.push(img);
      }
      if(typeof window.FtsTypography?.connect!=='function')fail('The local source typography helper is unavailable.','HTML_STYLES_UNVERIFIED');
      typography=FtsTypography.connect(parsed);host=typography.host;
      active();
      const ready=Promise.all(sourceImages.map(img=>new Promise((resolve,reject)=>{
        if(img.complete&&img.naturalWidth>0){resolve();return;}
        const clean=()=>{img.removeEventListener('load',loaded);img.removeEventListener('error',failed);},loaded=()=>{clean();resolve();},failed=()=>{clean();reject(Object.assign(new Error('A Word image could not be loaded locally.'),{code:'HTML_RESOURCE_BLOCKED'}));};
        img.addEventListener('load',loaded,{once:true});img.addEventListener('error',failed,{once:true});
      })));
      const unique=[...new Map(sourceImages.map(img=>[img.src,img])).values()];let nextImage=0;
      await Promise.all([ready,...Array.from({length:Math.min(4,unique.length)},async()=>{
        while(nextImage<unique.length){active();const img=unique[nextImage++];try{await img.decode();}catch{active();fail('A Word image could not be decoded locally.','HTML_RESOURCE_BLOCKED');}active();}
      })]);
      active();
      // Loading is only a local scheduling hint. Restore the exact source
      // attribute before measuring selectors such as img[loading="lazy"].
      for(const[img,loading]of sourceLoading){if(loading===null)img.removeAttribute('loading');else img.setAttribute('loading',loading);}
      const sourceLayout=sourceImages.map(img=>({img,width:img.width,height:img.height}));
      if(sourceLayout.some(({width,height})=>!(width>0&&height>0)))fail('A Word image has no verified browser viewport.','HTML_IMAGE_UNVERIFIED');
      const body=host.querySelector('body'),inlineImages=svgPlan?(await FtsSvg.prepare(body,svgPlan,{register:image=>{
        active();
        if(names.has(image.name)||byCid.has(image.name))fail('An inline SVG image identity collides with the source archive.','HTML_RESOURCE_BLOCKED');names.add(image.name);return register(image);
      }})).inlineImages:[];
      active();
      // Give the SDK concrete browser-resolved viewports before static widget
      // ancestors change, without calculating width/height/CSS aspect-ratio
      // overrides or relying on responsive-image data surviving serialization.
      for(const{img,width,height}of sourceLayout){img.width=width;img.height=height;img.style.setProperty('width',width+'px','important');img.style.setProperty('height',height+'px','important');}
      host.remove();for(const{element,attribute,value}of neutralized)element.setAttribute(attribute,value);
      normalizeSourceWidgets(body);normalizeDecisionLists(body);active();document.body.append(host);
      const walker=body.ownerDocument.createTreeWalker(body,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()){if(walker.currentNode.parentElement.closest('style'))continue;const text=normalize(walker.currentNode.nodeValue);if(text)sourceTexts.push(text);}
      const input=markerImport(body),markerPrefix='fts-list-'+crypto.randomUUID()+'-',plan=annotateLists(input.body,markerPrefix,input.styleOf,input.inheritEmpty);
      annotateAnchors(input.body,plan,markerPrefix);
      if(AscCommon.g_clipboardBase.Api!==api)AscCommon.g_clipboardBase.Init(api);
      active();
      window.native={GetImageUrl:src=>{
        const name=blobNames.get(src)||(registered.has(src)?src:null);
        if(!name)fail('The Office importer requested an unregistered image.','HTML_RESOURCE_BLOCKED');
        return name;
      }};
      active();
      logic.Start_SilentMode();silent=true;
      active();
      restoreStyleReader=input.install();
      try{await new Promise((resolve,reject)=>{
        active();
        api.asc_PasteData(AscCommon.c_oAscClipboardDataFormat.HtmlElement,input.body,undefined,undefined,undefined,
          success=>success===false?reject(Object.assign(new Error('The Office HTML import was rejected.'),{code:'HTML_IMPORT_FAILED'})):resolve(),undefined,
          ()=>reject(Object.assign(new Error('The Office HTML import was rejected.'),{code:'HTML_IMPORT_FAILED'})));
      });}finally{restoreStyleReader?.();restoreStyleReader=undefined;}
      active();
      const {associations,anchors}=applyNativeLists(logic,plan);
      const warnings=[...widgets.warnings,...input.warnings,...(plan.items.some(item=>item.kind==='task')?[{code:'HTML_TASK_SYMBOLS',message:'Task checkboxes are preserved as editable symbols.'}]:[])];
      return {associations,anchors,warnings,inlineImages,markerPrefix,registered:registered.size,dispose,verifyModel(model){
        let images=0,tables=0,items=0,localLinks=0;const texts=[],taskStates=new Map(),anchorIds=new Set(),widgetLinks=new Map();
        function walk(value){
          if(!value||typeof value!=='object')return;
          if(value.type==='tab'||value.type==='break'){texts.push('\n');return;}
          if(value.type==='image')images++;if(value.type==='table')tables++;if(value.ftsListItem)items++;
          if(value.ftsListItem?.kind==='task'){
            const item=plan.items.find(item=>item.id===value.ftsListItem.itemId),prefix=value.content?.[0]?.content?.filter(child=>typeof child==='string').join('');
            if(!item||taskStates.has(item.id)||value.ftsListItem.taskState!==item.taskState||prefix!==(item.taskState==='checked'?'\u2611':'\u2610')+' '||value.ftsNumbering?.definition?.numFmt?.val!=='none'||value.ftsNumbering.label!=='')
              fail('A source task state did not retain its exact editable symbol.','HTML_SEMANTICS_UNVERIFIED');
            taskStates.set(item.id,item.taskState);
          }
          if(value.ftsSourceAnchors)for(const id of value.ftsSourceAnchors){if(anchorIds.has(id))fail('A source anchor was duplicated.','HTML_SEMANTICS_UNVERIFIED');anchorIds.add(id);}
          if(value.type==='hyperlink'&&[...plan.links.values()].includes(value.value))localLinks++;
          if(value.type==='hyperlink'&&widgets.links.includes(value.value))widgetLinks.set(value.value,(widgetLinks.get(value.value)||0)+1);
          if(value.type==='run'||value.type==='endRun')for(const child of value.content??[]){if(typeof child==='string')texts.push(child);else walk(child);}
          else for(const [key,child] of Object.entries(value))if(!['styles','theme','numbering','ftsNumbering'].includes(key))Array.isArray(child)?child.forEach(walk):walk(child);
          if(value.type==='paragraph')texts.push('\n');
        }
        walk(model);
        const nativeText=normalize(texts.join(''));let cursor=0;
        for(const text of sourceTexts){const found=nativeText.indexOf(text,cursor);if(found<0)fail('The Office importer did not retain all source text in reading order.','HTML_SEMANTICS_UNVERIFIED');cursor=found+text.length;}
        for(const link of new Set(widgets.links))if((widgetLinks.get(link)||0)<widgets.links.filter(value=>value===link).length)fail('The Office importer did not retain each source widget link.','HTML_SEMANTICS_UNVERIFIED');
        if(images!==imageCount||tables!==tableCount||items!==plan.items.length||taskStates.size!==plan.items.filter(item=>item.kind==='task').length||localLinks!==plan.linkCount||anchorIds.size!==new Set(plan.links.values()).size)fail('The Office importer did not retain every source image, table, list item or anchor.','HTML_SEMANTICS_UNVERIFIED');
      }};
    }catch(error){const cancelled=disposed;dispose();if(cancelled)active();throw error;}
  };
})();
