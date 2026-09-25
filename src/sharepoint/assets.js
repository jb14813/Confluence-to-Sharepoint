// Session-only SharePoint REST. ResourcePath arguments are decoded paths, then
// OData-escaped and URL-encoded once. No arbitrary request endpoint is exposed.
// https://learn.microsoft.com/en-us/sharepoint/dev/solution-guidance/supporting-and-in-file-and-folder-with-the-resourcepath-api
// https://pnp.github.io/pnpjs/sp/files/#adding-files
import { MAX_PICTURE_BYTES } from '../transfer/limits.js';
import { refusalDetail, withAnswer } from './refusal.js';

const JSON_TYPE = 'application/json;odata=nometadata';
const REQUEST_TIMEOUT_MS = 20_000;
// Requests that carry a picture also get time for its bytes at a slow 200 KB/s,
// so the timeout catches a stalled connection without limiting picture size.
const SLOW_BYTES_PER_SECOND = 200_000;
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(code, message, status) {
  const error = new Error(message);
  error.code = code;
  if (status) error.status = status;
  return error;
}

function encode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function odataPath(value) {
  return encode(value.replace(/'/g, "''"));
}

function safeSegment(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 &&
    value !== '.' && value !== '..' && !/[\\/\u0000-\u001f\u007f?*:|"<>]/.test(value) &&
    !/[. ]$/.test(value) && !/%(?:2e|2f|5c)/i.test(value);
}

function checkedPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') ||
      path.length > 1500 || !path.slice(1).split('/').every(safeSegment)) {
    throw fail('unsafe-path', 'A decoded server-relative asset path is required.');
  }
  return path;
}

function samePath(a, b) { return a.toLowerCase() === b.toLowerCase(); }
function below(path, root) { return path.toLowerCase().startsWith(`${root.toLowerCase()}/`); }
function decodedMetadataPath(item) { return item?.ServerRelativePath?.DecodedUrl ?? item?.ServerRelativeUrl; }
function unwrap(value) { return value?.d ?? value; }

function checkedSite(siteUrl) {
  let url;
  try { url = new URL(siteUrl); } catch { throw fail('invalid-site', 'A complete HTTPS SharePoint site URL is required.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw fail('invalid-site', 'The site URL must use HTTPS without credentials, query, or fragment.');
  }
  // URL normalizes dot segments; reject them in the original input as well.
  const rawPath = String(siteUrl).replace(/^https:\/\/[^/]+/i, '').replace(/\/$/, '');
  if (/[\\\u0000-\u0020\u007f]/.test(String(siteUrl))) {
    throw fail('invalid-site', 'The site URL contains an unsafe path.');
  }
  try {
    if (rawPath) checkedPath(rawPath.split('/').map(decodeURIComponent).join('/'));
  } catch { throw fail('invalid-site', 'The site URL contains an unsafe path.'); }
  let path;
  try { path = url.pathname.split('/').map(decodeURIComponent).join('/').replace(/\/$/, ''); }
  catch { throw fail('invalid-site', 'The site URL contains invalid path encoding.'); }
  if (path) checkedPath(path);
  if (path.split('/').some(part => /^(?:_api|_layouts|sitepages|pages)$/i.test(part) || /\.aspx$/i.test(part))) {
    throw fail('invalid-site', 'Supply the site URL, not a page or API path.');
  }
  return { origin: url.origin, path, url: `${url.origin}${path.split('/').map(encode).join('/')}` };
}

/** Uses only the selected page's browser session. Does not read or persist tokens. */
export function createAssetClient({ siteUrl, fetchImpl = globalThis.fetch } = {}) {
  const site = checkedSite(siteUrl);
  if (typeof fetchImpl !== 'function') throw fail('fetch-unavailable', 'Browser requests are unavailable.');
  const browserBound = Boolean(globalThis.location?.href);
  let library;
  const folders = new Set();

  function assertBrowserSite() {
    if (!browserBound) return; // Dependency-injected Node tests have no page location.
    let current;
    try { current = new URL(globalThis.location.href); } catch { throw fail('target-changed', 'The browser site changed.'); }
    let currentPath;
    try { currentPath = current.pathname.split('/').map(decodeURIComponent).join('/'); }
    catch { throw fail('target-changed', 'The browser site path is invalid.'); }
    if (current.origin !== site.origin || (site.path && !samePath(currentPath, site.path) && !below(currentPath, site.path))) {
      throw fail('target-changed', 'The browser origin or selected site changed. Return to the original SharePoint site.');
    }
  }
  assertBrowserSite();

  async function request(resource, { method = 'GET', body, digest, format = 'json', missing = false, size = 0 } = {}) {
    // Only private callers construct these resources. This allowlist is an
    // additional guard against accidentally adding page actions to this client.
    const allowedRead = /^web\/(?:lists\?|GetFolderByServerRelativePath\(|GetFileByServerRelativePath\()/;
    const allowedWrite = /^(?:web\/GetFolderByServerRelativePath\(.*\)\/Folders\/add\(|web\/GetFolderByServerRelativeUrl\(.*\)\/Files\/add\(|web\/lists\(guid'[0-9a-f-]{36}'\)\/RootFolder\/Files\/add\()/i;
    if (!(method === 'GET' && allowedRead.test(resource)) &&
        !(method === 'POST' && (resource === 'contextinfo' || allowedWrite.test(resource)))) {
      throw fail('forbidden-endpoint', 'Only asset file, folder, library metadata, and contextinfo requests are allowed.');
    }
    const url = `${site.url}/_api/${resource}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      assertBrowserSite();
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS + Math.ceil(size / SLOW_BYTES_PER_SECOND) * 1000);
      let retryDelay;
      try {
        const headers = { Accept: format === 'bytes' ? 'application/octet-stream' : JSON_TYPE };
        if (method === 'POST') headers['Content-Type'] = body ? 'application/octet-stream' : JSON_TYPE;
        if (digest) headers['X-RequestDigest'] = digest;
        const response = await fetchImpl(url, {
          method, headers, body, credentials: 'same-origin', mode: 'same-origin',
          redirect: 'error', cache: 'no-store', signal: controller.signal
        });
        if (response.redirected || (response.url && new URL(response.url).origin !== site.origin)) {
          throw fail('unexpected-redirect', 'SharePoint redirected the asset request. Check the current sign-in.');
        }
        if (missing && response.status === 404) return null;
        if (!response.ok) {
          const phase = resource === 'contextinfo' ? 'request digest' :
            resource.startsWith('web/lists?') ? 'asset library lookup' :
            /\/Folders\/add\(/.test(resource) ? 'import folder creation' :
            /\/Files\/add\(/.test(resource) ? 'picture upload' :
            resource.endsWith('/$value') ? 'picture byte verification' :
            resource.startsWith('web/GetFileByServerRelativePath(') ? 'picture metadata verification' :
            resource.startsWith('web/GetFolderByServerRelativePath(') ? 'import folder verification' : 'asset operation';
          const error = fail('sharepoint-http', withAnswer(`SharePoint ${phase} failed (HTTP ${response.status})`, await refusalDetail(response)), response.status);
          const retryAfter = response.headers.get('Retry-After');
          error.retryAfter = retryAfter === null ? 250 : Math.max(0, Math.min(2000, Number(retryAfter) * 1000 || 0));
          throw error;
        }
        if (format === 'none') return null;
        if (format === 'bytes') {
          if (Number(response.headers.get('Content-Length')) > MAX_PICTURE_BYTES) throw fail('asset-too-large', 'The existing picture is larger than SharePoint accepts in one upload.');
          const value = new Uint8Array(await response.arrayBuffer());
          if (value.length > MAX_PICTURE_BYTES) throw fail('asset-too-large', 'The existing picture is larger than SharePoint accepts in one upload.');
          return value;
        }
        try { return await response.json(); }
        catch (error) {
          if (controller.signal.aborted) throw error;
          throw fail('invalid-response', 'SharePoint returned invalid asset metadata. Check the current sign-in.');
        }
      } catch (error) {
        if (timedOut) throw fail('request-timeout', 'The SharePoint asset request timed out.');
        const network = !error.code && error instanceof TypeError;
        if (method === 'GET' && attempt === 0 && (network || TRANSIENT.has(error.status))) {
          retryDelay = error.retryAfter ?? 250;
        } else if (network) {
          throw fail('request-network', 'The SharePoint asset request could not reach the server.');
        } else {
          throw error;
        }
      } finally { clearTimeout(timer); }
      if (retryDelay) await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }

  async function freshDigest() {
    const result = unwrap(await request('contextinfo', { method: 'POST' }));
    const info = result?.GetContextWebInformation ?? result;
    if (typeof info?.FormDigestValue !== 'string' || !info.FormDigestValue ||
        !Number.isFinite(Number(info.FormDigestTimeoutSeconds)) || Number(info.FormDigestTimeoutSeconds) <= 0) {
      throw fail('invalid-digest', 'SharePoint did not supply a fresh request digest.');
    }
    return info.FormDigestValue;
  }

  function assertLibrary(path) {
    checkedPath(path);
    if (!library || !samePath(path, library.serverRelativeUrl)) {
      throw fail('unselected-library', 'Use the asset library discovered for the selected site.');
    }
  }

  function assertFolder(path) {
    checkedPath(path);
    if (!library || !below(path, library.serverRelativeUrl) || !folders.has(path)) {
      throw fail('unprepared-folder', 'The asset folder must be prepared by this import in the discovered library.');
    }
  }

  function verifyMetadataPath(item, expected) {
    const path = checkedPath(decodedMetadataPath(item));
    if (!samePath(path, expected)) throw fail('unexpected-path', 'SharePoint returned an asset path that does not match this import.');
    return path;
  }

  async function discoverLibrary() {
    assertBrowserSite();
    if (library) return { ...library };
    const result = await request('web/lists?$select=Id,Title,BaseTemplate,IsSiteAssetsLibrary,RootFolder/ServerRelativeUrl,RootFolder/ServerRelativePath&$expand=RootFolder&$filter=BaseTemplate%20eq%20101');
    const data = unwrap(result);
    if (data?.['odata.nextLink'] || data?.['@odata.nextLink'] || data?.__next) {
      throw fail('ambiguous-library', 'Asset library discovery was incomplete. This site needs a narrower supported library lookup.');
    }
    const lists = data?.value ?? data?.results;
    if (!Array.isArray(lists)) throw fail('invalid-response', 'SharePoint did not return asset library metadata.');
    const designated = lists.filter(item => item.BaseTemplate === 101 && item.IsSiteAssetsLibrary === true);
    const candidates = designated.length ? designated : lists.filter(item =>
      item.BaseTemplate === 101 && typeof decodedMetadataPath(item.RootFolder) === 'string' &&
      samePath(decodedMetadataPath(item.RootFolder), `${site.path}/SiteAssets`));
    if (candidates.length !== 1) {
      throw fail('ambiguous-library', 'A single existing site asset library could not be identified. No library was created.');
    }
    const selected = candidates[0];
    const path = checkedPath(decodedMetadataPath(selected.RootFolder));
    if (!below(path, site.path) || path.slice(site.path.length + 1).includes('/') || !GUID.test(selected.Id)) {
      throw fail('unsafe-library', 'The discovered asset library has an invalid identity or lies outside the selected site.');
    }
    library = { listId: selected.Id, title: String(selected.Title ?? 'Site Assets'), serverRelativeUrl: path };
    return { ...library };
  }

  async function readFolder(path) {
    const result = await request(`web/GetFolderByServerRelativePath(decodedUrl='${odataPath(path)}')?$select=ServerRelativeUrl,ServerRelativePath`, { missing: true });
    if (!result) return null;
    verifyMetadataPath(unwrap(result), path);
    return path;
  }

  async function ensureImportFolder(libraryPath, folderName) {
    assertBrowserSite();
    assertLibrary(libraryPath);
    if (!safeSegment(folderName)) throw fail('unsafe-folder', 'The import folder name must be one safe path segment.');
    const path = `${library.serverRelativeUrl}/${folderName}`;
    if (await readFolder(path)) { folders.add(path); return path; }
    const digest = await freshDigest();
    let writeError;
    try {
      // Generated import names are a single validated segment. Use the
      // parent FolderCollection's broadly supported Add action; this tenant
      // advertises AddUsingPath but returns HTTP 404 when it is invoked.
      await request(`web/GetFolderByServerRelativePath(decodedUrl='${odataPath(library.serverRelativeUrl)}')/Folders/add('${odataPath(folderName)}')`, { method: 'POST', digest, format: 'none' });
    } catch (error) {
      if (!uncertain(error)) throw error;
      writeError = error;
    }
    let confirmed;
    try { confirmed = await readFolder(path); }
    catch { throw fail('folder-unconfirmed', 'Import folder creation could not be confirmed. Inspect the asset library before retrying.'); }
    if (!confirmed) throw fail('folder-unconfirmed', writeError ? 'Import folder creation is uncertain. Inspect the asset library before retrying.' : 'SharePoint did not confirm the new import folder.');
    folders.add(path);
    return path;
  }

  function uncertain(error) {
    return ['request-network', 'request-timeout', 'unexpected-redirect'].includes(error.code) || error.status === 409 || TRANSIENT.has(error.status);
  }

  async function decodeAsset(asset) {
    if (!asset || !/^[a-f0-9]{64}$/i.test(asset.id ?? '')) throw fail('invalid-asset', 'The asset needs a SHA256 content hash.');
    if (!Object.hasOwn(EXTENSIONS, asset.mime)) throw fail('unsupported-image', 'Only PNG, JPEG, GIF, and WebP image assets are supported.');
    if (![asset.width, asset.height].every(value => Number.isInteger(value) && value > 0 && value <= 100_000)) {
      throw fail('invalid-asset', 'The image asset dimensions are invalid.');
    }
    const bytes = asset.bytes;
    if (!(bytes instanceof Uint8Array) || !bytes.length) throw fail('invalid-asset', 'The picture has no content.');
    if (bytes.length > MAX_PICTURE_BYTES) throw fail('asset-too-large', 'A picture is larger than 250 MB, the most SharePoint accepts in one upload.');
    const hash = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== asset.id.toLowerCase()) throw fail('hash-mismatch', 'The image content does not match its SHA256 hash.');
    return { bytes, hash, filename: `sha256-${hash}.${EXTENSIONS[asset.mime]}` };
  }

  async function verifiedFile(path, bytes, asset, hash) {
    const endpoint = `web/GetFileByServerRelativePath(decodedUrl='${odataPath(path)}')`;
    const response = await request(`${endpoint}?$select=ServerRelativeUrl,ServerRelativePath,UniqueId,Length`, { missing: true });
    if (!response) return null;
    const file = unwrap(response);
    const confirmedPath = verifyMetadataPath(file, path);
    if (!GUID.test(file.UniqueId)) throw fail('invalid-response', 'SharePoint did not return a valid image file identity.');
    if (Number(file.Length) !== bytes.length) throw fail('asset-collision', 'An existing asset has different content. No file was overwritten.');
    const existing = await request(`${endpoint}/$value`, { format: 'bytes', size: bytes.length });
    if (existing.length !== bytes.length || !existing.every((value, index) => value === bytes[index])) {
      throw fail('asset-collision', 'An existing asset has different content. No file was overwritten.');
    }
    return {
      assetId: hash, serverRelativeUrl: confirmedPath,
      absoluteUrl: `${site.origin}${confirmedPath.split('/').map(encode).join('/')}`,
      uniqueId: file.UniqueId, listId: library.listId, width: asset.width, height: asset.height
    };
  }

  async function uploadAsset(folderPath, asset) {
    assertBrowserSite();
    assertFolder(folderPath);
    const { bytes, hash, filename } = await decodeAsset(asset);
    const path = `${folderPath}/${filename}`;
    const existing = await verifiedFile(path, bytes, asset, hash);
    if (existing) return existing;
    const digest = await freshDigest();
    let writeError;
    let useLibraryRoot = false;
    try {
      // This tenant recognizes the legacy Files/add action when read through
      // ResourcePath but returns HTTP 404 for its binary POST. Select the
      // already verified folder through the classic URL accessor for upload;
      // metadata and byte verification continue to use ResourcePath.
      await request(`web/GetFolderByServerRelativeUrl('${odataPath(folderPath)}')/Files/add(url='${odataPath(filename)}',overwrite=false)`, {
        method: 'POST', digest, body: bytes, format: 'none', size: bytes.length
      });
    } catch (error) {
      if (error.status === 404) useLibraryRoot = true;
      else {
        if (!uncertain(error)) throw error;
        writeError = error;
      }
    }
    if (useLibraryRoot) {
      // A 404 is a definite non-write. Some SharePoint tenants can resolve a
      // freshly created Site Assets folder for reads but not for Files/add.
      // Fall back to the already verified library root using the immutable
      // content-hash filename. Other failures never take this second path.
      const rootPath = `${library.serverRelativeUrl}/${filename}`;
      const rootExisting = await verifiedFile(rootPath, bytes, asset, hash);
      if (rootExisting) return rootExisting;
      let rootWriteError;
      try {
        await request(`web/lists(guid'${library.listId}')/RootFolder/Files/add(url='${odataPath(filename)}',overwrite=false)`, {
          method: 'POST', digest, body: bytes, format: 'none', size: bytes.length
        });
      } catch (error) {
        if (!uncertain(error)) throw error;
        rootWriteError = error;
      }
      let rootConfirmed;
      try { rootConfirmed = await verifiedFile(rootPath, bytes, asset, hash); }
      catch (error) {
        if (error.code === 'asset-collision') throw error;
        throw fail('upload-unconfirmed', 'Image upload could not be confirmed. Inspect the asset library before retrying.');
      }
      if (!rootConfirmed) throw fail('upload-unconfirmed', rootWriteError ? 'Image upload is uncertain. Inspect the asset library before retrying.' : 'SharePoint did not confirm the uploaded image.');
      return rootConfirmed;
    }
    // Never repeat an ambiguous POST. Even a successful response must be read
    // back before publishing a receipt to the editor.
    let confirmed;
    try { confirmed = await verifiedFile(path, bytes, asset, hash); }
    catch (error) {
      if (error.code === 'asset-collision') throw error;
      throw fail('upload-unconfirmed', 'Image upload could not be confirmed. Inspect the asset library before retrying.');
    }
    if (!confirmed) throw fail('upload-unconfirmed', writeError ? 'Image upload is uncertain. Inspect the asset library before retrying.' : 'SharePoint did not confirm the uploaded image.');
    return confirmed;
  }

  return { discoverLibrary, ensureImportFolder, uploadAsset };
}
