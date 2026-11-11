(() => {
  'use strict';
  const attributes=['class','id','style','dir','lang'];
  const properties=['font-size','font-family','font-style','font-weight','font-stretch','font-variant','font-feature-settings','font-kerning','font-optical-sizing','line-height','letter-spacing','word-spacing','text-align','text-indent','text-transform','color','direction','writing-mode','white-space','tab-size','text-rendering'];
  const fail=message=>{throw Object.assign(new Error(message),{code:'HTML_STYLES_UNVERIFIED'});};
  function countRules(rules,budget){
    for(const rule of rules){
      if(++budget.rules>100000)fail('The source stylesheet exceeds the local rule limit.');
      for(const name of rule.style??[])if(name.startsWith('--'))budget.custom.add(name);
      if(rule.cssRules)countRules(rule.cssRules,budget);
    }
  }
  // The caller has already checked every source element, attribute, stylesheet,
  // resource and known widget. No source content is attached before that gate.
  function connect(parsed){
    if(typeof CSS?.registerProperty!=='function')fail('The browser cannot preserve the source typography safely.');
    const sourceStyles=[...parsed.querySelectorAll('style')],budget={rules:0,bytes:0,custom:new Set()};
    for(const style of sourceStyles){
      budget.bytes+=style.textContent.length*2;if(budget.bytes>50*1024*1024)fail('The source styles exceed the local byte limit.');
      const sheet=new CSSStyleSheet();sheet.replaceSync(style.textContent);countRules(sheet.cssRules,budget);
    }
    for(const name of parsed.documentElement.style)if(name.startsWith('--'))budget.custom.add(name);
    if(budget.custom.size>4096)fail('The source stylesheet has too many custom properties.');
    const root=document.documentElement,sdkBody=document.body,snapshot=attributes.map(name=>[name,root.getAttribute(name)]),host=document.createElement('html');host.inert=true;
    const marker='data-fts-source-'+crypto.randomUUID(),sdkMarker='data-fts-sdk-'+crypto.randomUUID(),keys=['--fts-size-'+crypto.randomUUID(),'--fts-family-'+crypto.randomUUID()];
    let disposed=false;
    function dispose(){
      if(disposed)return;disposed=true;host.remove();sdkBody.removeAttribute(sdkMarker);
      for(const[name,value]of snapshot){if(value===null)root.removeAttribute(name);else root.setAttribute(name,value);}
      removeEventListener('pagehide',dispose);
    }
    try{
      for(const name of keys)CSS.registerProperty({name,syntax:'*',inherits:false});
      host.setAttribute(marker,'');sdkBody.setAttribute(sdkMarker,'');
      for(const name of attributes){const value=parsed.documentElement.getAttribute(name);if(value===null)root.removeAttribute(name);else{root.setAttribute(name,value);host.setAttribute(name,value);}}
      // Chrome injects a body75% font rule into extension documents. Match its
      // body specificity while deriving the value from SOURCE declarations.
      // Noninheriting private properties let the browser retain the authored
      // selector, media, layer and importance cascade, including universal rules.
      const sdkDefaults=[...properties,...budget.custom].map(name=>`${name}:initial!important`).join(';');
      const baseline=document.createElement('style');baseline.textContent=`body[${sdkMarker}]{${sdkDefaults}}html[${marker}]{}body:where([${marker}] > body){font-size:var(${keys[0]},inherit);font-family:var(${keys[1]},inherit)}`;
      parsed.head.prepend(baseline);host.append(parsed.head,parsed.body);document.body.append(host);
      const body=host.querySelector('body'),typography=getComputedStyle(root),custom=[...typography].filter(name=>name.startsWith('--'));
      if(custom.length>4096)fail('The source stylesheet has too many root custom properties.');
      const frozen=[...properties,...custom].map(name=>[name,typography.getPropertyValue(name)]),hostRule=baseline.sheet.cssRules[1];
      for(const[name,value]of frozen)hostRule.style.setProperty(name,value||'initial','important');
      const baselineRule=baseline.sheet.cssRules[2];
      function copy(style){
        let resolved;
        for(const[property,key,initial]of [['font-size',keys[0],'medium'],['font-family',keys[1],'serif']]){
          let value=style.getPropertyValue(property),priority=style.getPropertyPriority(property);
          if(!value&&style.getPropertyValue('font')){
            if(!resolved){
              // Native CSS resolves font:var(...), system fonts and shorthand
              // values. A temporary RULE avoids changing source [style] matches.
              const previous=baselineRule.style.cssText;
              try{baselineRule.style.setProperty('font',style.getPropertyValue('font'),'important');const computed=getComputedStyle(body);resolved={'font-size':computed.fontSize,'font-family':computed.fontFamily};}
              finally{baselineRule.style.cssText=previous;}
            }
            value=resolved[property];priority=style.getPropertyPriority('font');
          }
          if(!value&&style.getPropertyValue('all')){value=style.getPropertyValue('all');priority=style.getPropertyPriority('all');}
          if(!value)continue;
          if(['inherit','unset','revert'].includes(value))value='initial';else if(value==='initial')value=initial;
          style.setProperty(key,value,priority);
        }
      }
      function bridge(rules){for(const rule of rules){if(rule.style)copy(rule.style);if(rule.cssRules)bridge(rule.cssRules);}}
      for(const style of sourceStyles){
        bridge(style.sheet.cssRules);
        const text=[...style.sheet.cssRules].map(rule=>rule.cssText).join('\n');budget.bytes+=text.length*2;
        if(budget.bytes>100*1024*1024)fail('The prepared source styles exceed the local byte limit.');
        // The host is detached during static-widget adaptation. Persist the
        // native CSSOM changes so reconnection cannot reconstruct old rules.
        style.textContent=text;
      }
      // Source inline declarations already outrank both the injected rule and
      // the bridge. Preserve the EXACT html/body style attributes and selectors.
      baseline.textContent=[...baseline.sheet.cssRules].map(rule=>rule.cssText).join('\n');
      budget.bytes+=baseline.textContent.length*2;if(budget.bytes>100*1024*1024)fail('The prepared source styles exceed the local byte limit.');
      const actual=getComputedStyle(host);
      if(frozen.some(([name,value])=>actual.getPropertyValue(name)!==value))fail('An authored root style cannot retain its original browser typography.');
      addEventListener('pagehide',dispose,{once:true});
      return{host,dispose};
    }catch(error){dispose();if(typeof error.code==='string')throw error;fail('The source typography could not be verified by the browser.');}
  }
  window.FtsTypography={connect};
})();
