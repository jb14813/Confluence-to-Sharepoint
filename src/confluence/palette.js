// Confluence's editor palettes. A page stores the color an author picked from an
// earlier palette, such as #97A0AF for grey text; Confluence now draws each such
// color as a design token, in its light theme #7D818A. These are the stored colors
// whose drawn color differs, with the light-theme color, as Confluence's editor maps
// them (read from its editor script, and checked against pages drawn in the light
// theme). A color not listed, such as a custom one, is drawn as stored.
// Text colors.
const TEXT={'#172B4D':'#292A2E','#97A0AF':'#7D818A','#4C9AFF':'#357DE8','#0747A6':'#1558BC','#00B8D9':'#2898BD','#008DA6':'#206A83','#36B37E':'#22A06B',
  '#006644':'#216E4E','#FF991F':'#E06C00','#FF5630':'#C9372C','#BF2600':'#AE2E24','#6554C0':'#AF59E1','#403294':'#803FA5'};
// Table cell and panel backgrounds.
const BACKGROUND={'#DEEBFF':'#E9F2FE','#B3D4FF':'#CFE1FD','#4C9AFF':'#669DF1','#E6FCFF':'#E7F9FF','#B3F5FF':'#C6EDFB','#79E2F2':'#6CC3E0',
  '#E3FCEF':'#DCFFF1','#ABF5D1':'#BAF3DB','#57D9A3':'#4BCE97','#FFFAE6':'#FEF7C8','#FFF0B3':'#F5E989','#FFC400':'#FCA700',
  '#FFEBE6':'#FFECEB','#FFBDAD':'#FFD5D2','#FF8F73':'#F87168','#EAE6FF':'#F8EEFE','#C0B6F2':'#EED7FC','#998DD9':'#C97CF4',
  '#F4F5F7':'#F0F1F2','#B3BAC5':'#8C8F97','#DCDFE4':'#DDDEE1','#F8E6A0':'#F5E989','#FEDEC8':'#FCE4A6','#DFD8FD':'#EED7FC'};
// Text highlights, whose palette draws the lightest purple one shade deeper.
const HIGHLIGHT={...BACKGROUND,'#EAE6FF':'#EED7FC'};
// A color as #RRGGBB, from #RRGGBB, #RGB or rgb(); null for anything else.
function hex(color){
  const value=String(color??'').trim();
  if(/^#[0-9a-f]{6}$/i.test(value))return value.toUpperCase();
  if(/^#[0-9a-f]{3}$/i.test(value))return `#${[...value.slice(1)].map(digit=>digit+digit).join('')}`.toUpperCase();
  const rgb=/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(?:1|1\.0+)\s*)?\)$/i.exec(value);
  return rgb&&rgb.slice(1).every(part=>Number(part)<=255)?`#${rgb.slice(1).map(part=>Number(part).toString(16).padStart(2,'0')).join('')}`.toUpperCase():null;
}
const drawn=map=>color=>{const key=hex(color);return key&&Object.hasOwn(map,key)?map[key]:color;};
/** The color Confluence draws for a stored text color. */
export const drawnTextColor=drawn(TEXT);
/** The color Confluence draws for a stored table cell or panel background. */
export const drawnBackground=drawn(BACKGROUND);
/** The color Confluence draws for a stored text highlight. */
export const drawnHighlight=drawn(HIGHLIGHT);
