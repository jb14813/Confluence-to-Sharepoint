// SharePoint REST for one site, from the browser page it runs in: every request goes to the page's own origin
// with its sign-in (same-origin, no redirects, no cache), checks that the page still shows that site, and may
// only be one the caller's `allow` accepts. Reads SharePoint was too busy for are made again after the wait it
// asks for; a write is never repeated here.
import { refusalDetail, withAnswer } from './refusal.js';

export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_JSON = 12 * 1024 * 1024;
const JSON_TYPE = 'application/json;odata=nometadata';
const TIMEOUT_MS = 20_000;
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

export const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
export const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
export const encodedPath = path => path.split('/').map(encode).join('/');
/**
 * A page's address as SharePoint writes it: each part of the path URL-encoded, keeping the characters SharePoint
 * keeps, such as the brackets of the "Page(78).aspx" it names pages without a title. SharePoint rewrites an address
 * with them encoded in place once the page loads.
 */
export const pageUrlFor = (origin, path) => `${origin}${path.split('/').map(encodeURIComponent).join('/')}`;

export function fail(code, message, status) {
  return Object.assign(new Error(message), { code }, status ? { status } : {});
}

export function checkedPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.length > 1500 ||
      value.slice(1).split('/').some(part => !part || part === '.' || part === '..' || /[\\\u0000-\u001f\u007f?*:|"<>]/.test(part) || /[. ]$/.test(part) || /%(?:2e|2f|5c)/i.test(part))) {
    throw fail('invalid-path', 'SharePoint returned an unsafe decoded path.');
  }
  return value;
}

export function decodedPath(value) {
  try { return value.split('/').map(decodeURIComponent).join('/').replace(/\/$/, ''); }
  catch { throw fail('invalid-path', 'The selected site path has invalid encoding.'); }
}

export function checkedSite(value) {
  let url;
  try { url = new URL(value); } catch { throw fail('invalid-site', 'Select a complete HTTPS SharePoint site URL.'); }
  // The host is not matched against a list: the site was identified by the tab's SharePoint detection, every
  // request is bound to the browser page's own origin, and inspectSite() confirms the web through REST.
  if (url.protocol !== 'https:' || url.port ||
      url.username || url.password || url.search || url.hash || /[\\\u0000- \u007f]/.test(value)) {
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

/**
 * Whether `href` is an address of the site `siteUrl` itself: the same origin and site, not another site or a
 * subsite. SharePoint changes a tab's address within its site on its own (Site Pages moves to its default view
 * after it loads), which a send accepts; a tab that leaves the site stops it.
 */
export function withinSite(href, siteUrl) {
  let current, site, path;
  try { current = new URL(href); site = checkedSite(siteUrl); path = decodedPath(current.pathname); } catch { return false; }
  if (current.origin !== site.origin) return false;
  if (site.path && !same(path, site.path) && !path.toLowerCase().startsWith(`${site.path.toLowerCase()}/`)) return false;
  if (!site.path && /^\/(?:sites|teams)\//i.test(path)) return false;
  const marker = path.search(/\/(?:SitePages|_layouts)\//i);
  return marker < 0 || marker === 0 && !site.path || same(path.slice(0, marker), site.path);
}

/** Whether a request's outcome is unknown: its answer was lost, the tab moved, or SharePoint was too busy to say. */
export function uncertain(error) {
  return ['request-network', 'request-timeout', 'unexpected-redirect', 'invalid-response', 'target-changed'].includes(error?.code) || TRANSIENT.has(error?.status);
}

// The request a refusal names, in plain words.
function purpose(resource, method) {
  if (resource === 'contextinfo') return 'to issue a request token';
  if (method === 'POST' && resource === 'sitepages/pages') return 'to create the page';
  if (resource.endsWith('/checkoutpage')) return 'to check out the page';
  if (resource.endsWith('/savepage')) return 'to save the page';
  if (/\/CheckIn\(/i.test(resource)) return 'to check in the page';
  if (/\/UndoCheckOut\(\)$/i.test(resource)) return 'to undo the page’s check-out';
  if (resource.endsWith('/ValidateUpdateListItem')) return 'to set the page’s title';
  if (/^sitepages\/pages\(\d+\)$/.test(resource)) return 'to read the page back';
  if (resource.startsWith('web/GetFileByServerRelativePath(') || resource.startsWith('web/GetFileById(')) return 'to read the page’s file';
  if (/^web\/siteusers\?/.test(resource)) return 'to look up the page’s author';
  if (/^web\/currentuser\?/.test(resource)) return 'to look up your account';
  return 'to read the site';
}

/** A REST session bound to one site and to the browser page it runs in. `allow(resource, method, body)` names the requests the caller may make. */
export function createSession({ siteUrl, fetchImpl = globalThis.fetch, allow }) {
  const site = checkedSite(siteUrl);
  if (typeof fetchImpl !== 'function') throw fail('fetch-unavailable', 'Browser requests are unavailable.');
  if (typeof allow !== 'function') throw fail('invalid-session', 'The requests the session may make are required.');
  // Dependency-injected Node tests have no browser location.
  const bound = Boolean(globalThis.location?.href);
  function assertTarget() {
    if (bound && !withinSite(globalThis.location.href, site.url)) throw fail('target-changed', 'The tab left the SharePoint site the send was for. Return to it, then send again.');
  }
  assertTarget();

  async function request(resource, options = {}) {
    for (let attempt = 0; ; attempt++) {
      try { return await requestOnce(resource, options); }
      catch (error) {
        // Reads are repeated after any passing failure; so is the request token, which writes nothing. A write is
        // repeated only when SharePoint said it was too busy to take it (429, 503), never when its answer was lost;
        // a page save is left to its client, which reads the page back and decides, and page creation is never
        // repeated, so no second page can come of it.
        const read = (options.method ?? 'GET') === 'GET' || resource === 'contextinfo';
        const again = attempt < READ_RETRIES && (read ? RETRIED.has(error.status) || ['request-network', 'request-timeout'].includes(error.code)
          : [429, 503].includes(error.status) && !/\/savepage$/.test(resource) && resource !== 'sitepages/pages');
        if (!again) throw error;
        await new Promise(resolve => setTimeout(resolve, error.retryAfter ?? 1000 * 2 ** attempt));
      }
    }
  }

  async function requestOnce(resource, { method = 'GET', body, digest, missing = false, ignoreBody = false } = {}) {
    if (!['GET', 'POST'].includes(method) || !allow(resource, method, body)) throw fail('forbidden-endpoint', 'Only the requests a send needs are allowed.');
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
      if (timedOut) throw fail('request-timeout', 'The SharePoint request timed out.');
      if (!error.code && error instanceof TypeError) throw fail('request-network', 'The SharePoint request could not reach the server.');
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

  return { site, request, freshDigest };
}
