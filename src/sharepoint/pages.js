// Sends a capture into an existing SharePoint page through the page API, as new drafts are made: added below the
// page's content, in place of it with the Confluence page's title, byline and date, or in place of what an earlier
// send of the same Confluence page wrote there (an update). The page is checked out
// before it is read, so nothing changes between the read and the save, and checked back in as a minor version
// afterwards: the change is an unpublished draft of the page, readers keep the published version until it is
// published, and the earlier content stays in the page's version history.
import { GUID, checkedPath, createSession, fail, pageUrlFor, same, uncertain } from './session.js';
import { inspectSite as inspectLibrary } from './library.js';
import { resolveAttribution, sourceMetadata } from './attribution.js';
import { applyTitle, isTitleArea } from './title-area.js';
import { containsExpected, jsonArray } from './compare.js';
import { CHECK_IN, checkInMinor, fileResource, undoCheckOut } from './files.js';
import { mergeCanvas } from './merge.js';

const MODES = new Set(['add', 'overwrite', 'update']);
// After an editor closes, SharePoint holds the page for the editing account, then for its own app account while it
// finishes the session, and lets it go after about a minute. A page held that way is checked every 5 seconds, for
// at most 2 minutes.
const LOCK_CHECK_MS = 5_000, LOCK_WAIT_MS = 120_000;
// SharePoint's own account, which holds a page while it finishes an editing session.
const SHAREPOINT_APP = /(?:^|\|)app@sharepoint$/i;
const FILE_FIELDS = '$select=Exists,UniqueId,ListId,Name,ServerRelativeUrl,ServerRelativePath,UIVersionLabel,Level,CheckOutType,ListItemAllFields/Id,CheckedOutByUser/Title,CheckedOutByUser/LoginName,LockedByUser/Title,LockedByUser/LoginName&$expand=ListItemAllFields,CheckedOutByUser,LockedByUser';
const UNSUPPORTED = 'This is not a page Confluence content can go into, so it was removed from the list. Choose another page.';
const MISSING = 'This page is no longer at its address (deleted, renamed or moved), so it was removed from the list. If it still exists, open it in SharePoint to list it again.';
const PART_MISSING = 'The content this Confluence page sent is no longer on the page, so there is nothing to replace. To send it there again, choose the page under Send to; if it isn’t listed, open it in SharePoint first.';
const LOCKED = 'This page is still open in SharePoint’s editor, perhaps in another window or on another computer. Close the editor, then send again.';
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const nameOf = user => String(user?.Title ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100) || 'Someone';
// A stop that left the page as it was, so the capture can be sent again; and a failure after the page may have been saved.
const unchanged = error => Object.assign(error, { pageUnchanged: true });
const mayHaveChanged = error => Object.assign(error, { pageMayHaveChanged: true });
// A save that could not be confirmed, undone with the send's own check-out: the page is as it was.
const RESTORED = { 'save-unconfirmed': 'SharePoint did not confirm the save, so the page was put back as it was. Send again.',
  'content-unconfirmed': 'The page read back was not what was saved, so it was put back as it was. Send again.' };
const restored = error => Object.hasOwn(RESTORED, error.code) ? Object.assign(error, { message: RESTORED[error.code] }) : error;

// What an update replaces: the controls an earlier send of the same Confluence page wrote (with those a send whose
// outcome was unknown may have written); whether the page takes its title, byline and date from that Confluence page
// (it was made from it, with Create draft or Overwrite); and whether the part starts with the Confluence title as a
// heading (it was added with Add to bottom).
function checkedPart(part) {
  if (!part || typeof part !== 'object' || Array.isArray(part) || Object.keys(part).sort().join() !== 'controls,headed,titled' || typeof part.titled !== 'boolean' ||
      typeof part.headed !== 'boolean' || !Array.isArray(part.controls) || !part.controls.length || part.controls.length > 4000 || !part.controls.every(id => typeof id === 'string' && GUID.test(id))) {
    throw fail('invalid-input', 'An update names the controls it replaces, whether the page takes its title from Confluence, and whether the part starts with a heading.');
  }
  return { controls: part.controls.map(id => id.toLowerCase()), titled: part.titled, headed: part.headed };
}
// The controls a send writes, by the identities it gave them.
const written = merged => merged.added.filter(control => typeof control.id === 'string').map(control => control.id.toLowerCase());
// Whether any of the part's controls is on the page.
const holds = (page, part) => jsonArray(page.CanvasContent1 == null || page.CanvasContent1 === '' ? '[]' : page.CanvasContent1, 'canvas')
  .some(control => typeof control?.id === 'string' && part.controls.includes(control.id.toLowerCase()));

function validatedInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['attemptId', 'pagePath', 'mode', 'model', 'assetReceipts', 'part'].includes(key))) {
    throw fail('invalid-input', 'Only attemptId, pagePath, mode, model, assetReceipts and part arguments are accepted.');
  }
  if (!GUID.test(value.attemptId ?? '') || !MODES.has(value.mode)) throw fail('invalid-input', 'Use a send attempt UUID, and add, overwrite or update.');
  if (value.mode === 'update') checkedPart(value.part);
  else if (value.part !== undefined) throw fail('invalid-input', 'Only an update names a part to replace.');
  try { checkedPath(value.pagePath); } catch { throw fail('invalid-input', 'The page must be given by its server-relative path.'); }
  if (typeof value.model?.title !== 'string' || !value.model.title.trim() || value.model.title.length > 255 || /[\u0000-\u001f\u007f]/.test(value.model.title) ||
      !Array.isArray(value.model.blocks) || !value.model.blocks.length || !Array.isArray(value.model.assets) || !Array.isArray(value.assetReceipts)) {
    throw fail('invalid-model', 'A complete reviewed document with a title, blocks, assets and upload receipts is required.');
  }
  sourceMetadata(value.model);
  let copy;
  try { copy = structuredClone(value); } catch { throw fail('invalid-model', 'The reviewed document must contain serializable data.'); }
  return value.mode === 'update' ? { ...copy, part: checkedPart(value.part) } : copy;
}

// Every field read is sent back as it was; overwrite changes the title, byline and date, in the page's fields and in its title area.
function saveBody(page, controls, overwrite) {
  for (const [field, value] of [['AuthorByline', page.AuthorByline], ['Description', page.Description], ['BannerImageUrl', page.BannerImageUrl], ['TopicHeader', page.TopicHeader], ['Title', page.Title]]) {
    const valid = value === null || value === undefined || (field === 'AuthorByline' ? Array.isArray(value) && value.every(entry => typeof entry === 'string') : typeof value === 'string');
    if (!valid) throw fail('invalid-page', 'SharePoint returned page fields the send could not keep.');
  }
  const layout = typeof page.LayoutWebpartsContent === 'string' && page.LayoutWebpartsContent.trim() ? jsonArray(page.LayoutWebpartsContent, 'title layout') : null;
  let title = page.Title ?? '', authorByline = page.AuthorByline ?? [], topicHeader = page.TopicHeader ?? '';
  if (overwrite) {
    title = overwrite.title;
    for (const properties of [...(layout ?? []).filter(isTitleArea).map(part => part.properties), ...controls.filter(isTitleArea).map(control => control.webPartData?.properties)])
      if (properties && typeof properties === 'object' && !Array.isArray(properties)) applyTitle(properties, title, overwrite.attribution);
    if (overwrite.attribution) {
      topicHeader = overwrite.attribution.topicHeader;
      if (overwrite.attribution.user) authorByline = [overwrite.attribution.user.upn];
    }
  }
  return { AuthorByline: authorByline, CanvasContent1: JSON.stringify(controls), Description: page.Description ?? null,
    LayoutWebpartsContent: layout ? JSON.stringify(layout) : page.LayoutWebpartsContent ?? null, Title: title, TopicHeader: topicHeader, BannerImageUrl: page.BannerImageUrl ?? null };
}

/** Writes captures into existing pages of one site, from a browser page on that site. */
export function createPageClient({ siteUrl, fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto, serializeCanvasImpl,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now() } = {}) {
  if (serializeCanvasImpl !== undefined && typeof serializeCanvasImpl !== 'function') throw fail('invalid-serializer', 'The canvas serializer is unavailable.');
  const attempts = new Set();
  let busy = false, target = null, me = null;
  // Only what a send to one page needs: reading the site, its users and the page, then that page's check-out,
  // save, title and check-in, or undoing its check-out.
  function allow(resource, method, body) {
    if (method === 'GET') return /^(?:site\?|web\?|web\/lists\?|web\/siteusers\?|web\/currentuser\?|web\/GetFileByServerRelativePath\()/.test(resource) || Boolean(target) && resource === `sitepages/pages(${target.pageId})`;
    if (resource === 'contextinfo') return true;
    if (!target) return false;
    const titleUpdate = resource === `web/lists(guid'${target.listId}')/items(${target.pageId})/ValidateUpdateListItem` &&
      body?.bNewDocumentUpdate === false && Object.keys(body).length === 2 && Array.isArray(body.formValues) && body.formValues.length === 1 &&
      body.formValues[0]?.FieldName === 'Title' && typeof body.formValues[0].FieldValue === 'string' && Object.keys(body.formValues[0]).length === 2;
    const file = fileResource(target.path);
    return titleUpdate || [`sitepages/pages(${target.pageId})/checkoutpage`, `sitepages/pages(${target.pageId})/savepage`, `${file}/${CHECK_IN}`, `${file}/UndoCheckOut()`].includes(resource);
  }
  const { site, request, freshDigest } = createSession({ siteUrl, fetchImpl, allow });
  const inspectSite = () => inspectLibrary({ request, site });
  const readFile = path => request(`${fileResource(path)}?${FILE_FIELDS}`, { missing: true });
  const readPage = () => request(`sitepages/pages(${target.pageId})`);

  // The page at `pagePath`: one of this site's Site Pages that content can go into and the signed-in user may edit.
  async function findPage(pagePath, metadata) {
    target = null;
    const path = checkedPath(pagePath), library = metadata.pagesLibrary.serverRelativeUrl;
    if (!path.toLowerCase().startsWith(`${library.toLowerCase()}/`) || !/\.aspx$/i.test(path) || /^(?:forms|templates)\//i.test(path.slice(library.length + 1))) throw unchanged(fail('page-unsupported', UNSUPPORTED));
    const file = await readFile(path);
    if (!file || file.Exists === false) throw unchanged(fail('page-missing', MISSING));
    const pageId = file.ListItemAllFields?.Id;
    let actual = null;
    try { actual = checkedPath(file.ServerRelativePath?.DecodedUrl ?? file.ServerRelativeUrl); } catch { /* Refused below. */ }
    if (!same(file.ListId, metadata.pagesLibrary.listId) || !Number.isSafeInteger(pageId) || pageId < 1 || !actual || !same(actual, path)) throw unchanged(fail('page-unsupported', UNSUPPORTED));
    target = { path: actual, pageId, listId: metadata.pagesLibrary.listId };
    const page = await readPage();
    if (page?.Id !== pageId || page.PageLayoutType !== 'Article') throw unchanged(fail('page-unsupported', UNSUPPORTED));
    if (page.IsWebWelcomePage === true) throw unchanged(fail('page-home', 'This is the site’s home page, which Confluence content does not go into, so it was removed from the list. Choose another page.'));
    if (page.DoesUserHaveEditPermission === false) throw unchanged(fail('page-no-edit', 'Your account can’t edit this page. Choose another page, or ask its owner for edit access.'));
    return { file, page };
  }

  // Who holds the page: someone else's editor or check-out stops the send; the user's own editor, or SharePoint
  // finishing an editing session, is waited out; nobody, or the user's own check-out, lets it go on.
  async function holder(file) {
    me ??= await request('web/currentuser?$select=Id,Title,LoginName');
    const mine = person => same(person?.LoginName, me?.LoginName);
    const outBy = file.CheckedOutByUser?.LoginName ? file.CheckedOutByUser : null, lockBy = file.LockedByUser?.LoginName ? file.LockedByUser : null;
    if (outBy && !mine(outBy)) throw unchanged(fail('page-checked-out', `This page is checked out to ${nameOf(outBy)}. Send again once they check it in.`));
    if (lockBy && !mine(lockBy) && !SHAREPOINT_APP.test(lockBy.LoginName)) throw unchanged(fail('page-editing', `${nameOf(lockBy)} is editing this page. Send again when they have finished.`));
    return { waiting: Boolean(lockBy), checkedOutToMe: Boolean(outBy) };
  }
  async function available(file, report) {
    for (const deadline = now() + LOCK_WAIT_MS; ;) {
      const held = await holder(file);
      if (!held.waiting) return held;
      if (now() >= deadline) throw unchanged(fail('page-locked', LOCKED));
      report('waiting');
      await sleep(LOCK_CHECK_MS);
      file = await readFile(target.path);
      if (!file || file.Exists === false) throw unchanged(fail('page-missing', MISSING));
    }
  }

  /**
   * Read-only: whether the page can take the capture now, waiting while the user's own closed editor still holds it;
   * for an update, also whether what it replaces is still on the page.
   */
  async function checkPage(pagePath, { onStep, part } = {}) {
    const report = step => { try { onStep?.(step); } catch { /* Progress only. */ } };
    if (busy) throw fail('page-busy', 'A page is already being written.');
    busy = true;
    try {
      const replacing = part === undefined ? null : checkedPart(part);
      const { file, page } = await findPage(pagePath, await inspectSite());
      if (replacing && !holds(page, replacing)) throw fail('part-missing', PART_MISSING);
      await available(file, report);
      return { title: page.Title ?? '' };
    } catch (error) { throw unchanged(error); }
    finally { busy = false; }
  }

  // What SharePoint kept: the title; every kept control, in order; none of the replaced ones; the capture's controls
  // as saved (their section numbers aside), after every kept section before them and before every one after them;
  // the title area's new title when the send retitles the page; the title layout as saved.
  function keeps(page, body, merged, titled) {
    // SharePoint reads an empty title back as null.
    if (page?.Id !== target.pageId || (page.Title ?? '') !== body.Title) return false;
    let actual;
    try { actual = jsonArray(page.CanvasContent1, 'canvas'); } catch { return false; }
    const key = control => String(control?.id ?? '').toLowerCase();
    const order = actual.map(key), byId = new Map(actual.filter(control => key(control)).map(control => [key(control), control]));
    let last = -1;
    for (const control of merged.kept.filter(key)) { const at = order.indexOf(key(control)); if (at <= last) return false; last = at; }
    if (merged.removed.some(control => key(control) && byId.has(key(control)))) return false;
    const flowing = merged.kept.filter(control => key(control) && (control.position?.layoutIndex ?? 1) === 1), after = new Set(merged.following.map(key));
    const zoneOf = control => byId.get(key(control))?.position?.zoneIndex;
    const floor = Math.max(-Infinity, ...flowing.filter(control => !after.has(key(control))).map(zoneOf).filter(Number.isFinite));
    const ceiling = Math.min(Infinity, ...flowing.filter(control => after.has(key(control))).map(zoneOf).filter(Number.isFinite));
    let previous = -Infinity;
    for (const expected of merged.added) {
      const found = key(expected) ? byId.get(key(expected)) : actual.find(control => !key(control) && same(control?.position?.zoneId, expected.position.zoneId) && control.position.sectionIndex === expected.position.sectionIndex);
      const { zoneIndex, ...position } = expected.position;
      if (!found || !containsExpected(found, { ...expected, position })) return false;
      const zone = found.position?.zoneIndex;
      if (!Number.isFinite(zone) || zone <= floor || zone >= ceiling || zone < previous) return false;
      previous = zone;
    }
    if (titled && actual.filter(isTitleArea).some(area => area.webPartData?.properties && area.webPartData.properties.title !== body.Title)) return false;
    if (typeof body.LayoutWebpartsContent === 'string' && body.LayoutWebpartsContent.trim() && body.LayoutWebpartsContent !== '[]') {
      try { if (!containsExpected(jsonArray(page.LayoutWebpartsContent, 'title layout'), jsonArray(body.LayoutWebpartsContent, 'title layout'))) return false; } catch { return false; }
    }
    return true;
  }

  // A save sets the whole page, so the same save may safely be made again: one SharePoint was too busy for, or whose
  // answer was lost, is read back, and made once more if it did not land.
  async function save(body, merged, titled, done) {
    const digest = await freshDigest();
    for (let attempt = 0; ; attempt++) {
      let writeError;
      try { await request(`sitepages/pages(${target.pageId})/savepage`, { method: 'POST', body, digest, ignoreBody: true }); done.wrote = true; }
      catch (error) { if (!uncertain(error)) throw error; writeError = error; done.wrote = true; }
      let confirmed;
      try { confirmed = await readPage(); }
      catch (error) {
        if (writeError) throw fail('save-unconfirmed', 'The page may have been saved, but reading it back failed.');
        throw error;
      }
      if (keeps(confirmed, body, merged, titled)) return confirmed;
      if (!writeError) throw fail('content-unconfirmed', 'The page read back differs from what was saved. No save was repeated.');
      if (attempt) throw fail('content-unconfirmed', 'The page read back differs from what was saved, also after saving it again.');
      await sleep(writeError.retryAfter ?? 1000);
    }
  }

  /** Writes the capture into the page: checked out, read, merged, saved, read back, checked in as a minor version. */
  async function sendToPage(value, { onStep } = {}) {
    const report = step => { try { onStep?.(step); } catch { /* Progress only. */ } };
    // Refused before SharePoint is asked anything, so the page is as it was.
    let input, attemptId;
    try {
      input = validatedInput(value); attemptId = input.attemptId.toLowerCase();
      if (busy) throw fail('page-busy', 'A page is already being written.');
      if (attempts.has(attemptId)) throw fail('attempt-used', 'This send was already started. Review the page before sending again.');
    } catch (error) { throw unchanged(error); }
    busy = true; attempts.add(attemptId);
    // Whether this send checked the page out, may have written it, and has a verified save.
    const done = { checkedOut: false, wrote: false, saved: false };
    let merged;
    try {
      const metadata = await inspectSite();
      const { file, page: found } = await findPage(input.pagePath, metadata);
      if (input.part && !holds(found, input.part)) throw fail('part-missing', PART_MISSING);
      const held = await available(file, report);
      // Overwrite, and an update of a page made from the Confluence page, give it the Confluence title, byline and
      // date; content added below a page, and an update of it, starts with the Confluence title as a heading.
      const titled = input.mode === 'overwrite' || input.mode === 'update' && input.part.titled;
      const headed = input.mode === 'add' || input.mode === 'update' && input.part.headed;
      // The capture's canvas and its attribution are ready before the page is first touched.
      const serializer = serializeCanvasImpl ?? (await import('./canvas.js')).serializeCanvas;
      const blocks = headed ? [{ id: `title-${cryptoImpl.randomUUID()}`, type: 'text', html: `<h1>${escapeHtml(input.model.title)}</h1>` }, ...input.model.blocks] : input.model.blocks;
      const capture = jsonArray((await serializer({ ...input.model, blocks }, input.assetReceipts, metadata, { idFactory: () => cryptoImpl.randomUUID() }))?.CanvasContent1, 'canvas');
      const attribution = titled ? await resolveAttribution(request, input.model) : null;
      report('page');
      if (!held.checkedOutToMe) {
        const digest = await freshDigest();
        done.checkedOut = true;
        try { await request(`sitepages/pages(${target.pageId})/checkoutpage`, { method: 'POST', digest, ignoreBody: true }); }
        catch (error) {
          if (!uncertain(error)) done.checkedOut = false;
          // An editor opened after the check: its holder decides the message.
          if (error.status === 423) { const latest = await readFile(target.path); if (latest) await holder(latest); throw unchanged(fail('page-locked', LOCKED)); }
          if (!done.checkedOut) throw error;
        }
      }
      const page = await readPage();
      if (page?.IsPageCheckedOutToCurrentUser !== true) throw fail('checkout-unconfirmed', 'SharePoint did not confirm the page’s check-out.');
      try { merged = mergeCanvas(page.CanvasContent1 == null || page.CanvasContent1 === '' ? [] : jsonArray(page.CanvasContent1, 'canvas'), capture, input.mode, input.part?.controls); }
      catch (error) { throw error.code === 'part-missing' ? fail('part-missing', PART_MISSING) : error; }
      const body = saveBody(page, merged.controls, titled ? { title: input.model.title, attribution } : null);
      // A page without a title is named on its list item first, which renames nothing, as for drafts (0.3.8):
      // SharePoint renames a page's file on the first save that gives it a title.
      if (titled && !String(page.Title ?? '').trim()) {
        done.wrote = true;
        const answer = await request(`web/lists(guid'${target.listId}')/items(${target.pageId})/ValidateUpdateListItem`, { method: 'POST', body: { formValues: [{ FieldName: 'Title', FieldValue: body.Title }], bNewDocumentUpdate: false }, digest: await freshDigest() });
        const values = answer?.value ?? answer?.ValidateUpdateListItem?.results ?? answer?.results;
        const field = Array.isArray(values) ? values.find(entry => entry?.FieldName === 'Title') : null;
        if (!field || field.HasException !== false) throw fail('title-refused', 'SharePoint did not accept the page’s title.');
      }
      report('content');
      const confirmed = await save(body, merged, titled, done);
      done.saved = true;
      report('checkin');
      const checkin = await checkInMinor({ request, freshDigest }, target.path);
      return { attemptId, kind: 'page', mode: input.mode, pageId: target.pageId, serverRelativeUrl: target.path, pageUrl: pageUrlFor(site.origin, target.path),
        title: confirmed.Title, version: checkin.version ?? confirmed.Version, publication: 'draft', verified: true, checkedIn: checkin.checkedIn,
        // The controls this send wrote, which a later update of the same Confluence page replaces.
        part: written(merged), ...([...merged.notes, checkin.note].some(Boolean) ? { notes: [...merged.notes, checkin.note].filter(Boolean) } : {}) };
    } catch (error) {
      if (error.pageUnchanged || error.pageMayHaveChanged) throw error;
      // A check-out this send made is undone, so the page is exactly as it was; a check-out the user already had
      // never is. Only one the file shows as the user's is undone: a check-out whose answer was lost may have met
      // someone else's, which undoing (as a site owner may) would throw away.
      if (done.checkedOut && !done.saved) {
        const file = await readFile(target.path).catch(() => null);
        const mine = Boolean(file) && same(file.CheckedOutByUser?.LoginName, me?.LoginName);
        if (mine && await undoCheckOut({ request, freshDigest }, target.path)) throw unchanged(restored(error));
        if (file && !mine && !done.wrote) throw unchanged(error);
        // The check-out this send made could not be undone (or the file could not be read), so the page may still be held.
        if (!file || mine) error.message = `${error.message} The page may still be checked out to you.`;
      }
      if (!done.wrote && !done.checkedOut) throw unchanged(error);
      // What the page may now hold, so a later update can still find this Confluence page's part.
      throw Object.assign(mayHaveChanged(error), merged ? { part: written(merged) } : {});
    } finally { busy = false; }
  }

  return { inspectSite, checkPage, sendToPage };
}
