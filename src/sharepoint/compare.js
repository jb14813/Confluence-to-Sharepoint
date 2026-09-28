// Reading a saved page back: its JSON parts, and whether what SharePoint kept is what was saved.
import { MAX_JSON, fail } from './session.js';

export function jsonArray(value, label) {
  if (typeof value !== 'string' || value.length > MAX_JSON) throw fail('invalid-content', `SharePoint ${label} must be a JSON array string.`);
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw fail('invalid-content', `SharePoint ${label} is invalid JSON.`); }
  if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw fail('invalid-content', `SharePoint ${label} must be a JSON array of controls.`);
  }
  return parsed;
}

export function canonicalRichText(value) {
  if (typeof value !== 'string') return value;
  // CK5 reparses HTML on save. In the browser, run both expected and returned
  // markup through the inert template parser so valid block content such as
  // native imagePlugin elements is compared in SharePoint's normalized tree.
  if(globalThis.document?.createElement) {
    const template=globalThis.document.createElement('template');template.innerHTML=value;value=template.innerHTML;
  }
  // SharePoint's rich-text save normalizes a numeric apostrophe entity to the
  // literal character and appends optional trailing semicolons to inline CSS.
  // Normalize only those representation changes; tags, attributes, styles,
  // text, control order and all other values remain exact.
  return value.replace(/&#(?:0*39|x0*27);/gi, "'").replace(/\sstyle=(?:"([^"]*)"|'([^']*)')/gi, (whole, doubleQuoted, singleQuoted) => {
    const quote=doubleQuoted===undefined?"'":'"',css=doubleQuoted??singleQuoted;
    const declarations = css.split(';').map(part => part.trim()).filter(Boolean).join(';');
    return ` style=${quote}${declarations}${quote}`;
  });
}

export function containsExpected(actual, expected, property) {
  if (property === 'innerHTML' && typeof actual === 'string' && typeof expected === 'string') return canonicalRichText(actual) === canonicalRichText(expected);
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, i) => containsExpected(actual[i], value));
  return actual !== null && typeof actual === 'object' && !Array.isArray(actual) && Object.keys(expected).every(key => Object.hasOwn(actual, key) && containsExpected(actual[key], expected[key], key));
}
