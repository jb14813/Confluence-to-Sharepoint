// Puts a capture's canvas into an existing page's: below the page's content (add), in place of it (overwrite), or in
// place of the part an earlier send of the same Confluence page wrote (update). Pages made in SharePoint's editor
// keep their title area in the canvas too, as its first section; overwrite keeps that and the page-level controls
// (the page settings), and replaces the rest.
import { isTitleArea } from './title-area.js';
import { fail } from './session.js';

const MODES = new Set(['add', 'overwrite', 'update']);
const positioned = control => Boolean(control) && typeof control.position === 'object' && control.position !== null;
// The page's own column of sections; a vertical section beside it is layout 2.
const inFlow = control => positioned(control) && (control.position.layoutIndex ?? 1) === 1;
const key = control => String(control?.id ?? '').toLowerCase();
const zoneOf = control => Number(control.position.zoneIndex);
const inZone = (control, zone) => ({ ...control, position: { ...control.position, zoneIndex: zone } });
const last = controls => Math.floor(Math.max(0, ...controls.filter(inFlow).map(zoneOf).filter(Number.isFinite)));
// An empty column, as SharePoint and PnPjs keep one: a place in a section with nothing in it.
const emptyColumn = control => positioned(control) && !key(control) && ['controlType', 'webPartId', 'webPartData', 'innerHTML'].every(field => control[field] === undefined);
// An empty column where `control` was, in its section as it is numbered now.
function emptied(control, zoneIndex) {
  const { controlIndex, ...position } = control.position;
  return { displayMode: 2, emphasis: control.emphasis ?? {}, ...(control.zoneGroupMetadata ? { zoneGroupMetadata: control.zoneGroupMetadata } : {}),
    ...(control.zoneAudiences ? { zoneAudiences: control.zoneAudiences } : {}), position: { ...position, zoneIndex } };
}
// The look a section was given in SharePoint, as one comparable value: its background, collapsible heading and audiences.
const lookOf = control => JSON.stringify([Number(control?.emphasis?.zoneEmphasis) || 0, control?.zoneGroupMetadata ?? null, control?.zoneAudiences ?? null]);

// The part an update replaces: the controls it names, wherever they are now, and the sections holding them in the
// page's flow. The new content takes the place of the part's first section; what follows it, including what SharePoint
// added inside the part's sections, keeps its order after the new content. A section left with nothing else goes
// whole, its empty columns too; one that keeps what SharePoint added keeps its columns, and a column the part leaves
// with nothing in it becomes an empty column, as does the vertical section if the part was all it held.
function replacing(existing, part, placed) {
  const ours = new Set(part.map(id => String(id).toLowerCase()));
  const mine = existing.filter(control => positioned(control) && ours.has(key(control)));
  if (!mine.length) throw fail('part-missing', 'None of the content sent from this Confluence page is on the page any more.');
  if (existing.filter(inFlow).some(control => typeof control.position.zoneIndex !== 'number' || !Number.isFinite(control.position.zoneIndex))) {
    throw fail('invalid-canvas', 'A section of the page has no number, so the new content could not take the part’s place.');
  }
  const zones = new Set(mine.filter(inFlow).map(zoneOf));
  const keeps = zone => existing.some(control => inFlow(control) && zoneOf(control) === zone && !mine.includes(control) && !emptyColumn(control));
  const removed = existing.filter(control => mine.includes(control) || emptyColumn(control) && inFlow(control) && zones.has(zoneOf(control)) && !keeps(zoneOf(control)));
  const stay = existing.filter(control => positioned(control) && !removed.includes(control));
  // A part with no section in the page's column (all of it moved to the vertical section) is replaced last.
  const anchor = Math.min(Infinity, ...zones);
  // The look the part's first section was given in SharePoint: its background, collapsible heading and audiences.
  const first = mine.find(control => inFlow(control) && zoneOf(control) === anchor) ?? null;
  const style = first ? { emphasis: first.emphasis, zoneGroupMetadata: first.zoneGroupMetadata, zoneAudiences: first.zoneAudiences } : null;
  // A different look on another of the part's sections is not carried (the same look on every section is, since the
  // first section's goes on every new one); a heading shared with what SharePoint added inside the first section stays
  // over that too.
  const otherLooks = Boolean(first) && mine.some(control => inFlow(control) && zoneOf(control) !== anchor && lookOf(control) !== lookOf(first));
  const sharedGroup = Boolean(first?.zoneGroupMetadata) && keeps(anchor);
  const after = last(stay.filter(control => zoneOf(control) < anchor));
  const following = stay.filter(control => inFlow(control) && zoneOf(control) >= anchor);
  const later = [...new Set(following.map(zoneOf))].sort((a, b) => a - b), end = after + Math.max(0, ...placed.map(zoneOf));
  const number = new Map(later.map((zone, index) => [zone, end + 1 + index]));
  const place = control => following.includes(control) ? inZone(control, number.get(zoneOf(control))) : control;
  const fill = [];
  for (const zone of later.filter(zone => zones.has(zone))) {
    const columns = new Set(existing.filter(control => inFlow(control) && zoneOf(control) === zone).map(control => control.position.sectionIndex));
    for (const column of columns) {
      if (following.some(control => zoneOf(control) === zone && control.position.sectionIndex === column)) continue;
      fill.push(emptied(mine.find(control => inFlow(control) && zoneOf(control) === zone && control.position.sectionIndex === column), number.get(zone)));
    }
  }
  const aside = removed.filter(control => !inFlow(control));
  if (aside.length && !stay.some(control => !inFlow(control))) fill.push(emptied(aside[0], aside[0].position.zoneIndex));
  return { removed, stay, place, after, fill, style, otherLooks, sharedGroup, following: following.map(place) };
}

/**
 * The page's new canvas, from its controls and a capture's as serializeCanvas writes them (sections numbered from
 * 1, then its page settings). `kept` are the page's controls that stay, as placed; `added` the capture's as placed;
 * `removed` the page's controls that go; `following` the kept controls placed after the capture; `notes` what an
 * update could not keep, in plain sentences.
 */
export function mergeCanvas(existing, capture, mode, part) {
  if (!Array.isArray(existing) || !Array.isArray(capture) || !MODES.has(mode)) throw fail('invalid-canvas', 'A page canvas, a capture canvas, and add, overwrite or update are required.');
  if ([...existing, ...capture].some(control => !control || typeof control !== 'object' || Array.isArray(control))) throw fail('invalid-canvas', 'A canvas holds something other than controls.');
  if (mode === 'update' && (!Array.isArray(part) || !part.length)) throw fail('invalid-canvas', 'An update names the controls it replaces.');
  const taken = new Set(existing.map(key).filter(Boolean)), placed = capture.filter(positioned);
  for (const control of placed) {
    if (taken.has(key(control))) throw fail('invalid-canvas', 'A new control would reuse an identity already on the page.');
    if (!Number.isInteger(control.position.zoneIndex) || control.position.zoneIndex < 1) throw fail('invalid-canvas', 'The capture’s sections must be numbered from 1.');
  }
  let body, kept, removed = [], following = [], added;
  const notes = [];
  if (mode === 'update') {
    const replaced = replacing(existing, part, placed);
    ({ removed, following } = replaced);
    // The new content keeps the look the part's section had in SharePoint: its background, and its collapsible
    // heading when the content is one section (a heading on each of several sections would make several groups).
    const look = replaced.style, sections = new Set(placed.filter(inFlow).map(zoneOf)).size, grouped = Boolean(look?.zoneGroupMetadata) && sections === 1;
    if (look?.zoneGroupMetadata && !grouped) notes.push('The section’s collapsible heading was not kept, because the new content has more than one section.');
    if (grouped && replaced.sharedGroup) notes.push('The section’s collapsible heading now appears twice: over the new content, and over what was added inside the section in SharePoint.');
    if (replaced.otherLooks) notes.push('A background, collapsible heading or audience given to another of the part’s sections was not kept.');
    const styled = control => !look || !inFlow(control) ? control
      : { ...control, ...(look.emphasis !== undefined ? { emphasis: look.emphasis } : {}), ...(grouped ? { zoneGroupMetadata: look.zoneGroupMetadata } : {}),
        ...(look.zoneAudiences ? { zoneAudiences: look.zoneAudiences } : {}) };
    added = placed.map(control => styled(inZone(control, replaced.after + control.position.zoneIndex)));
    kept = replaced.stay.map(replaced.place);
    // The kept controls in their places, and the new content where the part began.
    body = existing.filter(positioned).flatMap(control => removed.includes(control) ? control === removed[0] ? [...added, ...replaced.fill] : [] : [replaced.place(control)]);
  } else {
    kept = existing.filter(control => positioned(control) && (mode === 'add' || isTitleArea(control)));
    removed = existing.filter(control => positioned(control) && !kept.includes(control));
    // The capture's sections follow the last section that stays.
    const after = last(kept);
    added = placed.map(control => inZone(control, after + control.position.zoneIndex));
    body = [...kept, ...added];
  }
  // The page's settings, marked as written for SharePoint's current editor as its editor marks a page on every
  // save (without it the page view draws every table with borders); a page without settings takes the capture's.
  const pageLevel = existing.filter(control => !positioned(control));
  const settings = pageLevel.find(control => control.controlType === 0 && control.pageSettingsSlice && typeof control.pageSettingsSlice === 'object');
  const others = pageLevel.filter(control => control !== settings);
  const captureSettings = capture.find(control => !positioned(control) && control.controlType === 0 && control.pageSettingsSlice);
  const pageSettings = settings ? { ...settings, pageSettingsSlice: { ...settings.pageSettingsSlice, rtePageSettings: { ...(settings.pageSettingsSlice.rtePageSettings ?? {}), contentVersion: 5 } } } : captureSettings;
  return { controls: [...body, ...others, ...pageSettings ? [pageSettings] : []], kept, added, removed, following, notes };
}
