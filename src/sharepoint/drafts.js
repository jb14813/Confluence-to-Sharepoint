// New-page REST follows the explicit unpublished branch of PnPjs, not its
// default save argument: https://github.com/pnp/pnpjs/blob/version-4/packages/sp/clientside-pages/types.ts
// File levels: https://learn.microsoft.com/en-us/openspecs/sharepoint_protocols/ms-wssfo3/32f720b2-354b-4416-bb11-48a3eb8e2f0d
import { refusalDetail, sentence, withAnswer } from './refusal.js';

const JSON_TYPE = 'application/json;odata=nometadata';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TITLE_COMPONENT = 'cbe7b0a9-3504-44dd-a3a3-0e5cacd07788';
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
const TIMEOUT_MS = 20_000;
const MAX_JSON = 12 * 1024 * 1024;
const TRANSIENT = new Set([408, 409, 429, 500, 502, 503, 504]);
// A read SharePoint was too busy for (429, 503: throttled) or that failed on the way is made again, at most twice,
// after the wait SharePoint asks for in its Retry-After header, as Microsoft advises for throttled requests
// (https://learn.microsoft.com/sharepoint/dev/general-development/how-to-avoid-getting-throttled-or-blocked-in-sharepoint-online),
// else after 1 and then 2 seconds. A write is never repeated: whether it landed is read back instead.
const RETRIED = new Set([408, 429, 500, 502, 503, 504]);
const READ_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 30_000;
const retryWait = response => {
  const value = response.headers.get('Retry-After'), seconds = value === null || !/^\s*\d+\s*$/.test(value) ? NaN : Number(value);
  return Number.isFinite(seconds) ? Math.min(seconds * 1000, MAX_RETRY_WAIT_MS) : undefined;
};
const unpack = value => value?.d ?? value;
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const encodedPath = path => path.split('/').map(encode).join('/');

function fail(code, message, status) {
  return Object.assign(new Error(message), { code }, status ? { status } : {});
}

// What a content save left out when SharePoint refused part of it.
const BYLINE_NOTE = 'SharePoint refused to show the Confluence page’s author in the byline, so the draft shows you as its author.';
const PICTURES_NOTE = 'SharePoint refused the page’s pictures, so they are not on the draft: each is marked “[Picture not placed]” where it was, linked to its copy in the site’s Site Assets.';
const refused = error => error?.code === 'sharepoint-http' && error.status === 403;
// SharePoint names a page after the first title it is saved with by renaming its file, a move
// that needs Delete Items: "If you can't rename a page, contact your site administrator to make
// sure you have Delete Items permission." https://support.microsoft.com/en-US/SharePoint/pages-in-sharepoint/create-and-use-modern-pages-on-a-sharepoint-site
// Without it, the title is set on the page's list item first, which renames nothing, and the
// saves after it keep the page's name, as they do for any page that has a title.
const NAME_NOTE = 'Your permission on this site does not include deleting pages, which SharePoint needs to name a page after its title, so the draft keeps the page name SharePoint gave it.';
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

// The request a refusal names, in plain words.
function purpose(resource, method) {
  if (resource === 'contextinfo') return 'to issue a request token';
  if (method === 'POST' && resource === 'sitepages/pages') return 'to create the page';
  if (resource.endsWith('/checkoutpage')) return 'to check out the page';
  if (resource.endsWith('/savepage')) return 'to save the page';
  if (resource.endsWith('/ValidateUpdateListItem')) return 'to set the page’s title';
  if (/^sitepages\/pages\(\d+\)$/.test(resource)) return 'to read the page back';
  if (resource.startsWith('web/GetFileByServerRelativePath(')) return 'to read the page’s file';
  if (/^web\/(?:siteusers|currentuser)\?/.test(resource)) return 'to look up the page’s author';
  return 'to read the site';
}

function checkedPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.length > 1500 ||
      value.slice(1).split('/').some(part => !part || part === '.' || part === '..' || /[\\\u0000-\u001f\u007f?*:|"<>]/.test(part) || /[. ]$/.test(part) || /%(?:2e|2f|5c)/i.test(part))) {
    throw fail('invalid-path', 'SharePoint returned an unsafe decoded path.');
  }
  return value;
}

function decodedPath(value) {
  try { return value.split('/').map(decodeURIComponent).join('/').replace(/\/$/, ''); }
  catch { throw fail('invalid-path', 'The selected site path has invalid encoding.'); }
}

function checkedSite(value) {
  let url;
  try { url = new URL(value); } catch { throw fail('invalid-site', 'Select a complete HTTPS SharePoint site URL.'); }
  // The host is not matched against a list: the site was identified by the
  // tab's SharePoint detection, every request below is bound to the browser
  // page's own origin, and inspectSite() confirms the web through REST.
  if (url.protocol !== 'https:' || url.port ||
      url.username || url.password || url.search || url.hash || /[\\\u0000-\u0020\u007f]/.test(value)) {
    throw fail('invalid-site', 'Select an HTTPS SharePoint site without credentials, query, or fragment.');
  }
  const originalPath = decodedPath(String(value).replace(/^https:\/\/[^/]+/i, ''));
  if (originalPath) checkedPath(originalPath);
  const path = decodedPath(url.pathname);
  if (path) checkedPath(path);
  if (path.split('/').some(part => /^(?:_api|_layouts|sitepages|pages)$/i.test(part) || /\.aspx$/i.test(part))) {
    throw fail('invalid-site', 'Use the site URL, not a page or API URL.');
  }
  return { origin: url.origin, path, url: `${url.origin}${encodedPath(path)}` };
}

function jsonArray(value, label) {
  if (typeof value !== 'string' || value.length > MAX_JSON) throw fail('invalid-content', `SharePoint ${label} must be a JSON array string.`);
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw fail('invalid-content', `SharePoint ${label} is invalid JSON.`); }
  if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw fail('invalid-content', `SharePoint ${label} must be a JSON array of controls.`);
  }
  return parsed;
}

function canonicalRichText(value) {
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

function containsExpected(actual, expected, property) {
  if (property === 'innerHTML' && typeof actual === 'string' && typeof expected === 'string') return canonicalRichText(actual) === canonicalRichText(expected);
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, i) => containsExpected(actual[i], value));
  return actual !== null && typeof actual === 'object' && !Array.isArray(actual) && Object.keys(expected).every(key => Object.hasOwn(actual, key) && containsExpected(actual[key], expected[key], key));
}

function saveBody(page, title, canvasContent, attribution) {
  const layout = page.LayoutWebpartsContent === null ? [structuredClone(DEFAULT_TITLE_LAYOUT)] : jsonArray(page.LayoutWebpartsContent, 'title layout');
  const titles = layout.filter(part => same(part.id, TITLE_COMPONENT));
  if (titles.length !== 1 || !titles[0].properties || typeof titles[0].properties !== 'object' || Array.isArray(titles[0].properties)) {
    throw fail('unsupported-title-layout', 'The new page has an unrecognized title layout. The draft needs inspection before continuing.');
  }
  // Only change the known title-region text; preserve freshly allocated authors,
  // banner configuration and all other layout parts rather than copying a source page.
  titles[0].properties.title = title;
  let authorByline=page.AuthorByline??[],topicHeader=page.TopicHeader??'';
  if(attribution) {
    topicHeader=attribution.topicHeader;
    titles[0].properties.topicHeader=topicHeader;
    titles[0].properties.showTopicHeader=true;
    titles[0].properties.showPublishDate=false;
    if(attribution.user) {
      authorByline=[attribution.user.upn];
      titles[0].properties.authorByline=[attribution.user.upn];
      titles[0].properties.authors=[{id:attribution.user.loginName,name:attribution.user.title,role:'',upn:attribution.user.upn}];
    }
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

function sourceMetadata(model) {
  const value=model.sourceMetadata;
  if(value===undefined)return null;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['author','lastUpdatedAt','version'].includes(key))||
     !value.author||typeof value.author!=='object'||Array.isArray(value.author)||Object.keys(value.author).some(key=>!['displayName','email'].includes(key))) {
    throw fail('invalid-model','Confluence source metadata is invalid.');
  }
  const name=value.author.displayName,email=value.author.email,updated=value.lastUpdatedAt;
  if(typeof name!=='string'||!name.trim()||name.length>255||/[\u0000-\u001f\u007f]/.test(name)||
     email!==null&&(typeof email!=='string'||email.length>254||/[\u0000-\u0020\u007f]/.test(email)||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))||
     typeof updated!=='string'||updated.length>40||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(updated)||!Number.isFinite(Date.parse(updated))||
     !Number.isSafeInteger(value.version)||value.version<1) throw fail('invalid-model','Confluence source metadata is invalid.');
  return {author:{displayName:name.trim(),email},lastUpdatedAt:updated,version:value.version};
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
  const site = checkedSite(siteUrl);
  if (typeof fetchImpl !== 'function') throw fail('fetch-unavailable', 'Browser requests are unavailable.');
  if (serializeCanvasImpl !== undefined && typeof serializeCanvasImpl !== 'function') throw fail('invalid-serializer', 'The canvas serializer is unavailable.');
  const attempts = new Set();
  let busy = false;
  let owned;
  const browserUrl = globalThis.location?.href ? new URL(globalThis.location.href) : null;

  function assertTarget() {
    if (!browserUrl) return; // Dependency-injected Node tests have no browser location.
    let current;
    try { current = new URL(globalThis.location.href); } catch { throw fail('target-changed', 'The selected SharePoint page changed.'); }
    const path = decodedPath(current.pathname);
    const pageMarker = path.search(/\/(?:SitePages|_layouts)\//i);
    if (current.origin !== site.origin || current.origin !== browserUrl.origin || current.pathname !== browserUrl.pathname ||
        site.path && !same(path, site.path) && !path.toLowerCase().startsWith(`${site.path.toLowerCase()}/`) ||
        pageMarker >= 0 && !same(path.slice(0, pageMarker), site.path) ||
        !site.path && /^\/(?:sites|teams)\//i.test(path)) {
      throw fail('target-changed', 'Return to the original selected SharePoint site before importing.');
    }
  }
  assertTarget();

  async function request(resource, options = {}) {
    for (let attempt = 0; ; attempt++) {
      try { return await requestOnce(resource, options); }
      catch (error) {
        const again = (options.method ?? 'GET') === 'GET' && attempt < READ_RETRIES &&
          (RETRIED.has(error.status) || ['request-network', 'request-timeout'].includes(error.code));
        if (!again) throw error;
        await new Promise(resolve => setTimeout(resolve, error.retryAfter ?? 1000 * 2 ** attempt));
      }
    }
  }

  async function requestOnce(resource, { method = 'GET', body, digest, missing = false, ignoreBody = false } = {}) {
    const readAllowed = /^(?:site\?|web\?|web\/lists\?|web\/siteusers\?|web\/currentuser\?|web\/GetFileByServerRelativePath\()/.test(resource) || owned && resource === `sitepages/pages(${owned.pageId})`;
    // The one list item update is the title of the page this import created, and nothing else.
    const titleUpdate = Boolean(owned) && resource === `web/lists(guid'${owned.listId}')/items(${owned.pageId})/ValidateUpdateListItem` &&
      body?.bNewDocumentUpdate === false && Object.keys(body).length === 2 && Array.isArray(body.formValues) && body.formValues.length === 1 &&
      body.formValues[0]?.FieldName === 'Title' && typeof body.formValues[0].FieldValue === 'string' && Object.keys(body.formValues[0]).length === 2;
    const writeAllowed = resource === 'contextinfo' || resource === 'sitepages/pages' && !owned || titleUpdate ||
      owned && (resource === `sitepages/pages(${owned.pageId})/checkoutpage` || resource === `sitepages/pages(${owned.pageId})/savepage`);
    if (!(method === 'GET' && readAllowed || method === 'POST' && writeAllowed)) {
      throw fail('forbidden-endpoint', 'Only new-page allocation and draft saves for this import are allowed.');
    }
    assertTarget();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
    try {
      const headers = { Accept: JSON_TYPE };
      if (method === 'POST') headers['Content-Type'] = JSON_TYPE;
      if (digest) headers['X-RequestDigest'] = digest;
      if (resource.endsWith('/savepage')) headers['if-match'] = '*';
      const response = await fetchImpl(`${site.url}/_api/${resource}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal });
      assertTarget();
      if (response.redirected || response.url && new URL(response.url).origin !== site.origin) throw fail('unexpected-redirect', 'SharePoint redirected the request. Check the selected site and sign-in.');
      if (missing && response.status === 404) return null;
      if (!response.ok) {
        const answer = await refusalDetail(response), retryAfter = retryWait(response);
        throw Object.assign(fail('sharepoint-http', withAnswer(`SharePoint refused ${purpose(resource, method)} (HTTP ${response.status})`, answer), response.status), { answer }, retryAfter === undefined ? {} : { retryAfter });
      }
      if (ignoreBody) return null;
      if (Number(response.headers.get('Content-Length')) > MAX_JSON) throw fail('invalid-response', 'SharePoint returned oversized page metadata.');
      const text = await response.text();
      if (text.length > MAX_JSON) throw fail('invalid-response', 'SharePoint returned oversized page metadata.');
      try { return unpack(JSON.parse(text)); } catch { throw fail('invalid-response', 'SharePoint did not return valid page metadata.'); }
    } catch (error) {
      if (timedOut) throw fail('request-timeout', 'The SharePoint draft request timed out.');
      if (!error.code && error instanceof TypeError) throw fail('request-network', 'The SharePoint draft request could not reach the server.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function freshDigest() {
    const data = await request('contextinfo', { method: 'POST' });
    const info = data?.GetContextWebInformation ?? data;
    if (typeof info?.FormDigestValue !== 'string' || !info.FormDigestValue || !Number.isFinite(Number(info.FormDigestTimeoutSeconds)) || Number(info.FormDigestTimeoutSeconds) <= 0) {
      throw fail('invalid-digest', 'SharePoint did not supply a fresh request digest.');
    }
    return info.FormDigestValue;
  }

  async function inspectSite() {
    const siteData = await request('site?$select=Id');
    const web = await request('web?$select=Id,Url,ServerRelativeUrl');
    if (!GUID.test(siteData?.Id ?? '') || !GUID.test(web?.Id ?? '') || !same(web.Url?.replace(/\/$/, ''), site.url) ||
        !same(web.ServerRelativeUrl?.replace(/\/$/, ''), site.path)) throw fail('invalid-site', 'SharePoint returned identities for a different or unverified site.');
    const collection = await request('web/lists?$select=Id,Title,BaseTemplate,EnableVersioning,EnableMinorVersions,EnableModeration,EffectiveBasePermissions,RootFolder/ServerRelativeUrl,RootFolder/ServerRelativePath&$expand=RootFolder&$filter=BaseTemplate%20eq%20119');
    const lists = collection?.value ?? collection?.results;
    if (!Array.isArray(lists) || collection?.['odata.nextLink'] || collection?.['@odata.nextLink'] || collection?.__next) throw fail('invalid-library', 'Site Pages library discovery was incomplete.');
    const candidates = lists.filter(list => list.BaseTemplate === 119);
    if (candidates.length !== 1) throw fail('invalid-library', 'A single Site Pages library is required for new drafts.');
    const list = candidates[0];
    const path = checkedPath(list.RootFolder?.ServerRelativePath?.DecodedUrl ?? list.RootFolder?.ServerRelativeUrl);
    if (!GUID.test(list.Id ?? '') || typeof list.Title !== 'string' || !same(path.slice(0, path.lastIndexOf('/')), site.path)) {
      throw fail('invalid-library', 'The page library is outside the selected SharePoint site.');
    }
    if (list.EnableVersioning !== true || list.EnableMinorVersions !== true || typeof list.EnableModeration !== 'boolean') throw fail('draft-unavailable', 'The Site Pages library must confirm versioning and minor drafts before importing.');
    const low = String(list.EffectiveBasePermissions?.Low ?? '');
    if (!/^\d+$/.test(low) || Number(low) > 0xffffffff || (BigInt(low) & 7n) !== 7n) throw fail('permission-unverified', 'View, add and edit permissions for the Site Pages library could not be confirmed.');
    // Delete Items (8) lets SharePoint rename a page's file, as it does to name a new page after its first title.
    return { siteUrl: site.url, siteId: siteData.Id, webId: web.Id, pagesLibrary: { listId: list.Id, title: list.Title, serverRelativeUrl: path,
      enableVersioning: true, enableMinorVersions: true, enableModeration: list.EnableModeration, canRename: (BigInt(low) & 8n) === 8n } };
  }

  async function resolveAttribution(model) {
    const source=sourceMetadata(model);
    if(!source)return null;
    const filter=`Title eq '${source.author.displayName.replace(/'/g,"''")}'${source.author.email?` or Email eq '${source.author.email.replace(/'/g,"''")}' or UserPrincipalName eq '${source.author.email.replace(/'/g,"''")}'`:''}`;
    const collection=await request(`web/siteusers?$select=Id,Title,Email,LoginName,UserPrincipalName,IsHiddenInUI&$filter=${encodeURIComponent(filter)}`);
    const users=collection?.value??collection?.results;
    if(!Array.isArray(users)||collection?.['odata.nextLink']||collection?.['@odata.nextLink']||collection?.__next)throw fail('invalid-users','SharePoint returned incomplete site-user metadata.');
    const validUser=user=>Number.isSafeInteger(user?.Id)&&typeof user.Title==='string'&&user.Title.trim()&&typeof user.LoginName==='string'&&user.LoginName&&
      typeof user.UserPrincipalName==='string'&&user.UserPrincipalName&&[user.Email,user.UserPrincipalName].every(value=>value===null||typeof value==='string')&&user.IsHiddenInUI!==true?user:null;
    const valid=users.map(validUser).filter(Boolean);
    const email=source.author.email?.toLowerCase();
    const emailMatches=email?valid.filter(user=>[user.Email,user.UserPrincipalName].some(value=>typeof value==='string'&&value.toLowerCase()===email)):[];
    const nameMatches=valid.filter(user=>user.Title.trim().toLowerCase()===source.author.displayName.toLowerCase());
    let match=emailMatches.length===1?emailMatches[0]:emailMatches.length===0&&nameMatches.length===1?nameMatches[0]:null;
    if(!match) {
      match=validUser(await request('web/currentuser?$select=Id,Title,Email,LoginName,UserPrincipalName,IsHiddenInUI'));
      if(!match)throw fail('invalid-user','SharePoint did not return a valid signed-in user for the page byline.');
    }
    const date=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(source.lastUpdatedAt));
    return {topicHeader:date,user:{title:match.Title.trim(),loginName:match.LoginName,upn:match.UserPrincipalName}};
  }

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

  function uncertain(error) {
    return ['request-network', 'request-timeout', 'unexpected-redirect', 'invalid-response', 'target-changed'].includes(error.code) || TRANSIENT.has(error.status);
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
      try { return { confirmed: await attempt(canvas, byline), notes }; }
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
      if (writeError) throw fail('save-unconfirmed', 'The title may have been set, but readback could not confirm it. Inspect the draft before starting another import.');
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
        if (writeError) throw fail('save-unconfirmed', 'The draft save may have completed, but readback could not confirm it. Inspect the draft before starting another import.');
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

  // `onStep` hears 'page' as the page is about to be created and 'content' as its
  // content is about to be saved; it only reports progress, so its failure is ignored.
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
      const attribution=await resolveAttribution(input.model);
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
        if (uncertain(error)) throw fail('allocation-unconfirmed', 'Page creation is uncertain and will not be retried. A new draft may exist; inspect Site Pages before starting another import.');
        allocationStarted = false;
        throw error;
      }
      if (!Number.isSafeInteger(allocated?.Id) || allocated.Id <= 0 || !GUID.test(allocated?.UniqueId ?? '')) throw fail('allocation-unconfirmed', 'SharePoint created a page without a verifiable new identity. Inspect Site Pages before starting another import.');
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
      const notes = [...renames ? [] : [NAME_NOTE], ...saved.notes];
      return { attemptId, pageId: owned.pageId, uniqueId: owned.uniqueId, serverRelativeUrl: expectedPath,
        editUrl: `${site.origin}${encodedPath(expectedPath)}?Mode=Edit`, title: saved.confirmed.Title, version: saved.confirmed.Version, publication: 'unpublished', verified: true, ...(notes.length ? { notes } : {}) };
    } catch (error) {
      if (allocationStarted) Object.assign(error, { attemptId, draftMayExist: true }, owned ? { pageId: owned.pageId, uniqueId: owned.uniqueId, ...(owned.path ? { serverRelativeUrl: owned.path } : {}) } : {});
      throw error;
    } finally { busy = false; owned = null; }
  }

  return { inspectSite, createDraft };
}
