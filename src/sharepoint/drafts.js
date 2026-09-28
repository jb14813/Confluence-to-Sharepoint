// New-page REST follows the explicit unpublished branch of PnPjs, not its
// default save argument: https://github.com/pnp/pnpjs/blob/version-4/packages/sp/clientside-pages/types.ts
// File levels: https://learn.microsoft.com/en-us/openspecs/sharepoint_protocols/ms-wssfo3/32f720b2-354b-4416-bb11-48a3eb8e2f0d
import { sentence, withAnswer } from './refusal.js';
import { GUID, checkedPath, createSession, decodedPath, encode, encodedPath, fail, pageUrlFor, same, uncertain } from './session.js';
import { inspectSite as inspectLibrary } from './library.js';
import { resolveAttribution, sourceMetadata } from './attribution.js';
import { TITLE_COMPONENT, applyTitle } from './title-area.js';
import { containsExpected, jsonArray } from './compare.js';
import { CHECK_IN, checkInMinor, fileResource } from './files.js';

// Matches the default title region initialized by PnPjs when SharePoint's new
// page response has LayoutWebpartsContent=null.
const DEFAULT_TITLE_LAYOUT = Object.freeze({
  dataVersion: '1.4', description: 'Title Region Description', id: TITLE_COMPONENT, instanceId: TITLE_COMPONENT,
  properties: { authorByline: [], authors: [], layoutType: 'FullWidthImage', showPublishDate: false,
    showTopicHeader: false, textAlignment: 'Left', title: '', topicHeader: '', enableGradientEffect: true },
  reservedHeight: 280,
  serverProcessedContent: { htmlStrings: {}, searchablePlainTexts: {}, imageSources: {}, links: {} },
  title: 'Title area'
});

// What a content save left out when SharePoint refused part of it.
const BYLINE_NOTE = 'SharePoint refused to show the Confluence page’s author in the byline, so the draft shows you as its author.';
const PICTURES_NOTE = 'SharePoint refused the page’s pictures, so they are not on the draft: each is marked “[Picture not placed]” where it was, linked to its copy in the site’s Site Assets.';
const refused = error => error?.code === 'sharepoint-http' && error.status === 403;
// SharePoint names a page after the first title it is saved with by renaming its file, a move
// that needs Delete Items: "If you can't rename a page, contact your site administrator to make
// sure you have Delete Items permission." https://support.microsoft.com/en-US/SharePoint/pages-in-sharepoint/create-and-use-modern-pages-on-a-sharepoint-site
// Without it, the title is set on the page's list item first, which renames nothing, and the
// saves after it keep the page's name, as they do for any page that has a title.
const NAME_NOTE = 'Your permission on this site does not include deleting pages, which SharePoint needs to name a page’s file after its title, so the draft keeps the file name SharePoint gave it (as in its address, such as Page(3).aspx). Its title is the Confluence page’s.';
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

// The document with each picture replaced by a marker, linked to the picture's uploaded copy on the site.
function withoutPictures(model, receipts, origin) {
  const copies = new Map((receipts ?? []).map(receipt => [String(receipt?.assetId ?? '').toLowerCase(), receipt]));
  const names = new Map((model.assets ?? []).map(asset => [String(asset?.id ?? '').toLowerCase(), asset?.name]));
  return { ...model, blocks: model.blocks.map(block => {
    if (block.type !== 'image') return block;
    const key = String(block.assetId ?? '').toLowerCase(), name = names.get(key), address = copies.get(key)?.absoluteUrl;
    const label = escapeHtml(`[Picture not placed${typeof name === 'string' && name.trim() ? `: ${name.trim()}` : ''}]`);
    const link = typeof address === 'string' && address.startsWith(`${origin}/`) ? address : null;
    const caption = typeof block.caption === 'string' && block.caption.trim() ? `<p>${escapeHtml(block.caption.trim())}</p>` : '';
    return { id: block.id, type: 'text', html: `<p>${link ? `<a href="${escapeHtml(link)}">${label}</a>` : label}</p>${caption}`, ...(block.section ? { section: block.section } : {}) };
  }) };
}

function saveBody(page, title, canvasContent, attribution) {
  const layout = page.LayoutWebpartsContent === null ? [structuredClone(DEFAULT_TITLE_LAYOUT)] : jsonArray(page.LayoutWebpartsContent, 'title layout');
  const titles = layout.filter(part => same(part.id, TITLE_COMPONENT));
  if (titles.length !== 1 || !titles[0].properties || typeof titles[0].properties !== 'object' || Array.isArray(titles[0].properties)) {
    throw fail('unsupported-title-layout', 'The new page has an unrecognized title layout.');
  }
  // Only change the known title-region text; preserve freshly allocated authors,
  // banner configuration and all other layout parts rather than copying a source page.
  applyTitle(titles[0].properties, title, attribution);
  let authorByline=page.AuthorByline??[],topicHeader=page.TopicHeader??'';
  if(attribution) {
    topicHeader=attribution.topicHeader;
    if(attribution.user)authorByline=[attribution.user.upn];
  }
  jsonArray(canvasContent, 'canvas');
  if (page.AuthorByline !== null && (!Array.isArray(page.AuthorByline) || page.AuthorByline.some(value => typeof value !== 'string')) ||
      page.Description !== null && typeof page.Description !== 'string' || page.BannerImageUrl !== null && typeof page.BannerImageUrl !== 'string' ||
      page.TopicHeader !== null && typeof page.TopicHeader !== 'string') {
    throw fail('invalid-page', 'SharePoint omitted initial fields needed to preserve the new page.');
  }
  return { AuthorByline: authorByline, CanvasContent1: canvasContent, Description: page.Description,
    LayoutWebpartsContent: JSON.stringify(layout), Title: title, TopicHeader: topicHeader, BannerImageUrl: page.BannerImageUrl };
}

function validatedInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['attemptId', 'filenameStem', 'model', 'assetReceipts'].includes(key))) {
    throw fail('invalid-input', 'Only attemptId, filenameStem, model and assetReceipts arguments are accepted.');
  }
  if (!GUID.test(value.attemptId ?? '') || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.filenameStem ?? '') || value.filenameStem.length > 80) {
    throw fail('invalid-input', 'Use an import attempt UUID and a filename stem of at most 80 lowercase letters, digits, or hyphens.');
  }
  if (typeof value.model?.title !== 'string' || !value.model.title.trim() || value.model.title.length > 255 || /[\u0000-\u001f\u007f]/.test(value.model.title) ||
      !Array.isArray(value.model.blocks) || !value.model.blocks.length || !Array.isArray(value.model.assets) || !Array.isArray(value.assetReceipts)) {
    throw fail('invalid-model', 'A complete reviewed document with a title, blocks, assets and upload receipts is required.');
  }
  sourceMetadata(value.model);
  try { return structuredClone(value); } catch { throw fail('invalid-model', 'The reviewed document must contain serializable data.'); }
}

/** Creates only new unpublished pages using the current same-site browser session. */
export function createDraftClient({ siteUrl, fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto, serializeCanvasImpl } = {}) {
  if (serializeCanvasImpl !== undefined && typeof serializeCanvasImpl !== 'function') throw fail('invalid-serializer', 'The canvas serializer is unavailable.');
  const attempts = new Set();
  let busy = false;
  let owned;
  // Only this import's requests: reading the site and its users, creating one page, and that page's check-out,
  // saves, title and minor check-in.
  function allow(resource, method, body) {
    if (method === 'GET') return /^(?:site\?|web\?|web\/lists\?|web\/siteusers\?|web\/currentuser\?|web\/GetFileByServerRelativePath\()/.test(resource) || Boolean(owned) && resource === `sitepages/pages(${owned.pageId})`;
    // The one list item update is the title of the page this import created, and nothing else.
    const titleUpdate = Boolean(owned) && resource === `web/lists(guid'${owned.listId}')/items(${owned.pageId})/ValidateUpdateListItem` &&
      body?.bNewDocumentUpdate === false && Object.keys(body).length === 2 && Array.isArray(body.formValues) && body.formValues.length === 1 &&
      body.formValues[0]?.FieldName === 'Title' && typeof body.formValues[0].FieldValue === 'string' && Object.keys(body.formValues[0]).length === 2;
    return resource === 'contextinfo' || resource === 'sitepages/pages' && !owned || titleUpdate ||
      Boolean(owned) && (resource === `sitepages/pages(${owned.pageId})/checkoutpage` || resource === `sitepages/pages(${owned.pageId})/savepage` ||
        Boolean(owned.path) && resource === `${fileResource(owned.path)}/${CHECK_IN}`);
  }
  const { site, request, freshDigest } = createSession({ siteUrl, fetchImpl, allow });
  const inspectSite = () => inspectLibrary({ request, site });

  function pagePath(page, metadata) {
    // Site Pages reports a page's Path.DecodedUrl without a leading slash,
    // relative to its web ("SitePages/Page.aspx" in a /sites/ site), while file
    // metadata uses the server-relative form. A slashless path is read relative
    // to the selected web, or as server-relative when that is the reading that
    // lies in the library; at the tenant root the two readings are the same.
    // The library, filename and URL identity checks below then apply to it.
    const decoded = page?.Path?.DecodedUrl;
    const readings = typeof decoded === 'string' && !decoded.startsWith('/') ? [`${site.path}/${decoded}`, `/${decoded}`] : [decoded];
    const inLibrary = value => typeof value === 'string' && same(value.slice(0, value.lastIndexOf('/')), metadata.pagesLibrary.serverRelativeUrl);
    const path = checkedPath(readings.find(inLibrary) ?? readings[0]);
    if (!same(path.slice(0, path.lastIndexOf('/')), metadata.pagesLibrary.serverRelativeUrl) || !/\.aspx$/i.test(path) ||
        !same(page.FileName, path.slice(path.lastIndexOf('/') + 1))) throw fail('page-identity-mismatch', 'SharePoint returned an unexpected page filename or library path.');
    if (page.AbsoluteUrl !== undefined && page.AbsoluteUrl !== `${site.origin}${encodedPath(path)}` && page.AbsoluteUrl !== `${site.origin}${path}`) throw fail('page-identity-mismatch', 'SharePoint returned a different page URL.');
    if (page.Url !== undefined) {
      let url;
      try {
        const raw = String(page.Url);
        // A slashless Url may itself be server-relative (including the site
        // prefix) or may be relative to the selected web. Prefer the former
        // only when it exactly agrees with the already-validated page path.
        url = !raw.startsWith('/') && same(`/${raw}`, path) ? new URL(`/${raw}`, site.origin) : new URL(raw, `${site.url}/`);
      } catch { throw fail('page-identity-mismatch', 'SharePoint returned an invalid page URL.'); }
      if (url.origin !== site.origin || url.username || url.password || url.search || url.hash || !same(decodedPath(url.pathname), path)) {
        throw fail('page-identity-mismatch', 'SharePoint returned a different relative page URL.');
      }
    }
    return path;
  }

  function verifyPage(page, metadata, expectedPath) {
    if (!page || page.Id !== owned.pageId || !same(page.UniqueId, owned.uniqueId) || page.PageLayoutType !== 'Article' ||
        page.PromotedState !== 0 || page.IsWebWelcomePage === true || page.DoesUserHaveEditPermission !== true || typeof page.IsPageCheckedOutToCurrentUser !== 'boolean') {
      throw fail('page-identity-mismatch', 'The new draft identity, article type, or edit permission could not be confirmed.');
    }
    const path = pagePath(page, metadata);
    if (expectedPath && !same(path, expectedPath)) throw fail('page-identity-mismatch', 'The new page did not keep its expected file name.');
    if (typeof page.Version !== 'string' || !/^0\.[1-9]\d*$/.test(page.Version)) throw fail('publication-unverified', 'The page does not have a confirmed unpublished minor version.');
    if (page.FirstPublished !== undefined && page.FirstPublished !== null && page.FirstPublished !== '') {
      const date = new Date(page.FirstPublished);
      if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() >= 2000) throw fail('publication-unverified', 'The new page reports a publication date.');
    }
    return path;
  }

  async function readFile(path, missing = false) {
    checkedPath(path);
    const argument = encode(path.replace(/'/g, "''"));
    return request(`web/GetFileByServerRelativePath(decodedUrl='${argument}')?$select=Exists,UniqueId,ListId,SiteId,WebId,Name,ServerRelativeUrl,ServerRelativePath,MajorVersion,MinorVersion,UIVersionLabel,Level,ListItemAllFields/Id&$expand=ListItemAllFields`, { missing });
  }

  async function verifyFile(page, metadata, expectedPath) {
    const path = verifyPage(page, metadata, expectedPath);
    const file = await readFile(path);
    const actualPath = checkedPath(file?.ServerRelativePath?.DecodedUrl ?? file?.ServerRelativeUrl);
    if (file.Exists !== true || !same(actualPath, path) || !same(file.Name, page.FileName) || !same(file.UniqueId, owned.uniqueId) ||
        !same(file.ListId, metadata.pagesLibrary.listId) || !same(file.SiteId, metadata.siteId) || !same(file.WebId, metadata.webId) || file.ListItemAllFields?.Id !== owned.pageId) {
      throw fail('file-identity-mismatch', 'The draft file identity does not match the newly allocated page.');
    }
    if (file.MajorVersion !== 0 || !Number.isInteger(file.MinorVersion) || file.MinorVersion < 1 || ![2, 255].includes(file.Level) ||
        file.UIVersionLabel !== `0.${file.MinorVersion}` || page.Version !== file.UIVersionLabel) throw fail('publication-unverified', 'SharePoint did not confirm an unpublished draft file version.');
    return page;
  }

  async function readOwned(metadata, expectedPath) {
    const page = await request(`sitepages/pages(${owned.pageId})`);
    return verifyFile(page, metadata, expectedPath);
  }

  // The content save. When SharePoint refuses it outright (403, so nothing was saved), the
  // parts it may be refusing are left out in turn: the byline, then the pictures, then both;
  // what was left out is noted. A title-only save then tells refused text from a page
  // SharePoint no longer lets be changed, which the error names.
  async function saveContent(ready, { title, canvasContent, attribution, model, receipts, serializer, metadata, expectedPath }) {
    const attempt = (canvas, byline) => save(ready, saveBody(ready, title, canvas, byline), metadata, expectedPath);
    const tries = [{ canvas: canvasContent, byline: attribution, notes: [] }];
    const bylineOff = attribution?.user ? { ...attribution, user: null } : null;
    if (bylineOff) tries.push({ canvas: canvasContent, byline: bylineOff, notes: [BYLINE_NOTE] });
    if (model.blocks.some(block => block.type === 'image')) {
      const marked = (await serializer(withoutPictures(model, receipts, site.origin), [], metadata, { idFactory: () => cryptoImpl.randomUUID() })).CanvasContent1;
      tries.push({ canvas: marked, byline: attribution, notes: [PICTURES_NOTE] });
      if (bylineOff) tries.push({ canvas: marked, byline: bylineOff, notes: [BYLINE_NOTE, PICTURES_NOTE] });
    }
    let refusal;
    for (const { canvas, byline, notes } of tries) {
      try { return { confirmed: await attempt(canvas, byline), notes, canvas }; }
      catch (error) { if (!refused(error)) throw error; refusal ??= error; }
    }
    let titled = true;
    try { await attempt(ready.CanvasContent1, null); }
    catch (error) { if (!refused(error)) throw error; titled = false; }
    throw Object.assign(fail('content-refused', withAnswer(titled ? 'SharePoint refused the page’s text (HTTP 403)' : 'SharePoint refused any change to the page after creating it (HTTP 403)', refusal.answer), 403), { answer: refusal.answer });
  }

  async function checkedOut(page, metadata) {
    if (page.IsPageCheckedOutToCurrentUser) return page;
    const digest = await freshDigest();
    try { await request(`sitepages/pages(${owned.pageId})/checkoutpage`, { method: 'POST', digest, ignoreBody: true }); }
    catch (error) { if (!uncertain(error)) throw error; }
    const current = await readOwned(metadata, pagePath(page, metadata));
    if (!current.IsPageCheckedOutToCurrentUser) throw fail('checkout-unconfirmed', 'The new page checkout could not be confirmed.');
    return current;
  }

  // Sets the new page's title on its list item, which renames nothing; see NAME_NOTE.
  async function setTitle(page, title, metadata, path) {
    page = await checkedOut(page, metadata);
    const digest = await freshDigest();
    let answer, writeError;
    try { answer = await request(`web/lists(guid'${owned.listId}')/items(${owned.pageId})/ValidateUpdateListItem`, { method: 'POST', body: { formValues: [{ FieldName: 'Title', FieldValue: title }], bNewDocumentUpdate: false }, digest }); }
    catch (error) { if (!uncertain(error)) throw error; writeError = error; }
    if (!writeError) {
      const values = answer?.value ?? answer?.ValidateUpdateListItem?.results ?? answer?.results;
      const field = Array.isArray(values) ? values.find(value => value?.FieldName === 'Title') : null;
      if (!field || field.HasException !== false) {
        const said = sentence(String(field?.ErrorMessage ?? ''));
        throw fail('title-refused', said ? `SharePoint did not accept the page’s title: ${said}` : 'SharePoint did not confirm the page’s title.');
      }
    }
    let confirmed;
    try { confirmed = await readOwned(metadata, path); }
    catch (error) {
      if (writeError) throw fail('save-unconfirmed', 'The title may have been set, but reading it back could not confirm it.');
      throw error;
    }
    if (confirmed.Title !== title) throw fail(writeError ? 'save-unconfirmed' : 'content-unconfirmed', 'SharePoint did not keep the page’s title. No change was repeated.');
    return confirmed;
  }

  // A save sets the whole page, and the page is this import's own, so the same save may safely be made again. One
  // SharePoint was too busy for, or whose answer was lost, is read back, and made once more if it did not land.
  async function save(page, body, metadata, expectedPath) {
    page = await checkedOut(page, metadata);
    const digest = await freshDigest();
    for (let attempt = 0; ; attempt++) {
      let writeError;
      try { await request(`sitepages/pages(${owned.pageId})/savepage`, { method: 'POST', body, digest, ignoreBody: true }); }
      catch (error) { if (!uncertain(error)) throw error; writeError = error; }
      let confirmed;
      try { confirmed = await readOwned(metadata, expectedPath); }
      catch (error) {
        if (writeError) throw fail('save-unconfirmed', 'The draft may have been saved, but reading it back could not confirm it.');
        throw error;
      }
      if (confirmed.Title === body.Title && containsExpected(jsonArray(confirmed.CanvasContent1, 'canvas'), jsonArray(body.CanvasContent1, 'canvas')) &&
          containsExpected(jsonArray(confirmed.LayoutWebpartsContent, 'title layout'), jsonArray(body.LayoutWebpartsContent, 'title layout'))) {
        owned.path = expectedPath;
        return confirmed;
      }
      if (!writeError) throw fail('content-unconfirmed', 'The draft readback differs from the reviewed content or title layout. No save was repeated.');
      if (attempt) throw fail('content-unconfirmed', 'The draft readback differs from the reviewed content or title layout, also after saving it again.');
      await new Promise(resolve => setTimeout(resolve, writeError.retryAfter ?? 1000));
    }
  }

  // `onStep` hears 'page' as the page is about to be created, 'content' as its content is about to be saved and
  // 'checkin' as it is about to be checked in; it only reports progress, so its failure is ignored.
  async function createDraft(value, { onStep } = {}) {
    const report = step => { try { onStep?.(step); } catch { /* Progress only. */ } };
    const input = validatedInput(value);
    const attemptId = input.attemptId.toLowerCase();
    if (busy) throw fail('draft-busy', 'A new draft is already being created.');
    if (attempts.has(attemptId)) throw fail('attempt-used', 'This import attempt was already started. Inspect its result before starting another import.');
    busy = true;
    owned = null;
    let allocationStarted = false;
    try {
      const metadata = await inspectSite();
      const serializer = serializeCanvasImpl ?? (await import('./canvas.js')).serializeCanvas;
      const serialized = await serializer(input.model, input.assetReceipts, metadata, { idFactory: () => cryptoImpl.randomUUID() });
      jsonArray(serialized?.CanvasContent1, 'canvas');
      const canvasContent = serialized.CanvasContent1;
      const attribution=await resolveAttribution(request, input.model);
      // With Delete Items, a first save names the page after a unique title; without it, see NAME_NOTE.
      const renames = metadata.pagesLibrary.canRename === true;
      const filename = `${input.filenameStem}-${attemptId}`;
      const uniquePath = renames ? checkedPath(`${metadata.pagesLibrary.serverRelativeUrl}/${filename}.aspx`) : null;
      if (renames && await readFile(uniquePath, true) !== null) throw fail('page-exists', 'The selected draft filename already exists. No existing page was changed.');
      attempts.add(attemptId);
      report('page');
      const digest = await freshDigest();
      allocationStarted = true;
      let allocated;
      try { allocated = await request('sitepages/pages', { method: 'POST', body: { PageLayoutType: 'Article', PromotedState: 0 }, digest }); }
      catch (error) {
        if (uncertain(error)) throw fail('allocation-unconfirmed', 'SharePoint did not answer when the page was created, and a new draft may exist.');
        allocationStarted = false;
        throw error;
      }
      if (!Number.isSafeInteger(allocated?.Id) || allocated.Id <= 0 || !GUID.test(allocated?.UniqueId ?? '')) throw fail('allocation-unconfirmed', 'SharePoint created a page without a verifiable new identity.');
      owned = { pageId: allocated.Id, uniqueId: allocated.UniqueId, listId: metadata.pagesLibrary.listId };
      const path = verifyPage(allocated, metadata);
      owned.path = path;
      const namingBody = renames ? saveBody(allocated, filename, allocated.CanvasContent1) : null;
      // Prepare the complete final content body before the page is first changed.
      saveBody(allocated, input.model.title, canvasContent);
      await verifyFile(allocated, metadata, path);
      report('content');
      const expectedPath = renames ? uniquePath : path;
      const ready = renames ? await save(allocated, namingBody, metadata, expectedPath) : await setTitle(allocated, input.model.title, metadata, path);
      const saved = await saveContent(ready, { title: input.model.title, canvasContent, attribution, model: input.model, receipts: input.assetReceipts, serializer, metadata, expectedPath });
      // Checked in as a minor version: still unpublished and, like a draft made in SharePoint's editor, one others
      // can co-author, on which an open editor holds a lock that stops a later send instead of writing over it.
      report('checkin');
      const checkin = await checkInMinor({ request, freshDigest }, expectedPath, 'draft');
      const notes = [...renames ? [] : [NAME_NOTE], ...saved.notes, ...checkin.note ? [checkin.note] : []];
      // The controls the draft was saved with, which a later update from the same Confluence page replaces.
      const part = jsonArray(saved.canvas, 'canvas').filter(control => control?.position && typeof control.id === 'string').map(control => control.id.toLowerCase());
      return { attemptId, pageId: owned.pageId, uniqueId: owned.uniqueId, serverRelativeUrl: expectedPath,
        pageUrl: pageUrlFor(site.origin, expectedPath), title: saved.confirmed.Title, version: checkin.version ?? saved.confirmed.Version, publication: 'unpublished', verified: true, checkedIn: checkin.checkedIn, part, ...(notes.length ? { notes } : {}) };
    } catch (error) {
      if (allocationStarted) {
        Object.assign(error, { attemptId, draftMayExist: true }, owned ? { pageId: owned.pageId, uniqueId: owned.uniqueId, ...(owned.path ? { serverRelativeUrl: owned.path } : {}) } : {});
        // A page SharePoint made stays checked out to its maker until it is checked in, which a stop before then leaves undone.
        if (owned && !/checked out to you/.test(error.message ?? '')) error.message = `${error.message} SharePoint made the new page; it may be checked out to you.`;
      }
      throw error;
    } finally { busy = false; owned = null; }
  }

  return { inspectSite, createDraft };
}
