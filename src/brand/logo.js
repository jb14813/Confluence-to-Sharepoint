// The brand logo as SVG elements, built node by node from the generated tree.
import {LOGO} from './logo-tree.js';

const SVG='http://www.w3.org/2000/svg',XLINK='http://www.w3.org/1999/xlink';
/** A decorative copy of the logo, `size` pixels square. */
export function logoElement(document,size){
  const build=([name,attributes,children])=>{
    const node=document.createElementNS(SVG,name);
    for(const [key,value] of Object.entries(attributes)){if(key.startsWith('xlink:'))node.setAttributeNS(XLINK,key,value);else node.setAttribute(key,value);}
    for(const child of children)node.append(build(child));
    return node;
  };
  const svg=build(LOGO);
  svg.setAttribute('width',String(size));svg.setAttribute('height',String(size));svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
  return svg;
}
