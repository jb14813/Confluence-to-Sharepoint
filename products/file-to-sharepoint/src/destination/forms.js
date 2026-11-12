import { createSession, encode, fail, GUID, withinSite } from '../../../../src/sharepoint/session.js';
import { validateDefinition } from '../../sharepoint-form/src/runtime/definition.ts';

export const FORM_COMPONENT_ID = 'f104fa11-c9e8-43d6-8c5a-3f7b70f31ab1';
const COMMON = { Required: true, Hidden: false, ReadOnlyField: false, Indexed: false, EnforceUniqueValues: false };
const field = (InternalName, TypeAsString, FieldTypeKind, extra = {}) => ({ ...COMMON, InternalName, TypeAsString, FieldTypeKind, ...extra });
const LISTS = [
  { key: 'definitionListId', title: 'File to SharePoint Form Definitions', description: `File to SharePoint form definitions; schema v1; component ${FORM_COMPONENT_ID}.`, fields: [
    field('FormId', 'Text', 2, { MaxLength: 64, Indexed: true, EnforceUniqueValues: true }),
    field('DefinitionJson', 'Note', 3, { RichText: false, AppendOnly: false })
  ] },
  { key: 'responseListId', title: 'File to SharePoint Form Responses', description: `File to SharePoint form responses; schema v1; component ${FORM_COMPONENT_ID}.`, fields: [
    field('SubmissionId', 'Text', 2, { MaxLength: 36, Indexed: true, EnforceUniqueValues: true }),
    field('FormId', 'Text', 2, { MaxLength: 64, Indexed: true }),
    field('DefinitionVersion', 'Number', 9, { DisplayFormat: 0 }),
    field('ResponseJson', 'Note', 3, { RichText: false, AppendOnly: false })
  ] }
];
const metadataQuery = '$select=Id,Title,Description,BaseTemplate,Hidden,ItemCount';
const listPath = id => `web/lists(guid'${id}')`;
const schemaFailure = message => fail('form-schema-mismatch', `The form list schema is incompatible: ${message}`);

function collection(data, label) {
  const value = data?.value ?? data?.results;
  if (!Array.isArray(value) || data?.['odata.nextLink'] || data?.['@odata.nextLink'] || data?.__next) throw fail('form-read-unverified', `${label} discovery was incomplete or invalid.`);
  return value;
}

function client(options) {
  for (const key of ['definitionListId', 'responseListId']) if (options[key] !== undefined && (typeof options[key] !== 'string' || !GUID.test(options[key]))) throw fail('invalid-form-list', 'Invalid form list ID.');
  const fetchImpl = options.request ?? globalThis.fetch;
  const session = createSession({ siteUrl: options.siteUrl, fetchImpl, allow: (resource, method) => method === 'POST' ? resource === 'contextinfo' :
    resource === 'web/GetClientSideWebParts' || resource.startsWith('web/lists?') || /^web\/lists\(guid'[a-f0-9-]{36}'\)(?:\?|\/(?:fields|items)\?)/i.test(resource) });
  if (!/^[a-z0-9-]+\.sharepoint(?:\.com|\.us|\.cn|-mil\.us)$/i.test(new URL(session.site.url).hostname)) throw fail('invalid-site', 'Select a SharePoint Online site for the form.');
  const bound = Boolean(globalThis.location?.href);
  const assertTarget = () => { if (bound && !withinSite(globalThis.location.href, session.site.url)) throw fail('target-changed', 'The tab left the SharePoint site selected for this form.'); };
  async function writeOnce(resource, body, digest) {
    if (resource !== 'web/lists' && !/^web\/lists\(guid'[a-f0-9-]{36}'\)\/(?:fields\/createfieldasxml|items)$/i.test(resource)) throw fail('forbidden-endpoint', 'This form setup endpoint is not allowed.');
    assertTarget();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetchImpl(`${session.site.url}/_api/${resource}`, { method: 'POST', body: JSON.stringify(body),
        headers: { Accept: 'application/json;odata=nometadata', 'Content-Type': 'application/json;odata=nometadata', 'X-RequestDigest': digest },
        credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal });
      assertTarget();
      if (response.redirected || response.url && new URL(response.url).origin !== session.site.origin) throw fail('unexpected-redirect', 'SharePoint redirected the form setup request.');
      if (!response.ok) throw fail('form-write-refused', `SharePoint refused form setup (HTTP ${response.status}).`, response.status);
      // Success is established by a subsequent read, never by this response alone.
    } finally { clearTimeout(timer); }
  }
  async function createAndConfirm(resource, body, verify, label) {
    const digest = await session.freshDigest();
    let writeError;
    try { await writeOnce(resource, body, digest); } catch (error) { writeError = error; }
    try {
      const confirmed = await verify();
      if (confirmed) return confirmed;
    } catch (error) {
      if (error.code === 'form-schema-mismatch' || error.code === 'form-definition-conflict' || error.code === 'target-changed') throw error;
      throw fail('form-write-unconfirmed', `${label} creation is not confirmed. ${error.message} Review the existing form setup before explicitly retrying.`);
    }
    throw fail('form-write-unconfirmed', `${label} creation is not confirmed. ${writeError?.message ?? 'SharePoint did not return matching persisted data.'} Review the existing form setup before explicitly retrying.`);
  }
  async function checkRuntimeAsset(manifest) {
    const loader = manifest.loaderConfig, resource = loader?.scriptResources?.[loader.entryModuleId];
    let address;
    try {
      if (resource?.type !== 'path' || typeof resource.path !== 'string' || !resource.path || !Array.isArray(loader.internalModuleBaseUrls) || typeof loader.internalModuleBaseUrls[0] !== 'string') throw new Error();
      const base = loader.internalModuleBaseUrls[0].replace(/\/?$/, '/');
      address = new URL(resource.path, base);
      if (address.protocol !== 'https:' || address.username || address.password || address.hash) throw new Error();
    } catch { throw fail('form-runtime-invalid', 'The installed form runtime has an invalid script location.'); }
    // Catalog scripts use the current reader's permissions even when component
    // discovery succeeds. Check again on every Send. Public CDN script loading
    // remains SPFx's responsibility; it need not allow a CORS fetch probe.
    if (address.origin !== session.site.origin) return;
    assertTarget();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetchImpl(address.href, { credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal });
      assertTarget();
      try {
        if (!response.ok || response.redirected || response.url && response.url !== address.href || !/^(?:application|text)\/(?:javascript|ecmascript)(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')) throw new Error();
      } finally { await response.body?.cancel(); }
    } catch (error) {
      if (error.code === 'target-changed') throw error;
      throw fail('form-runtime-inaccessible', 'The installed form runtime script is unavailable to your account. Ask the site administrator to check access to its app assets, or retry after a temporary service error. No form setup was changed.');
    } finally { clearTimeout(timer); }
  }
  return { ...session, createAndConfirm, checkRuntimeAsset };
}

async function installedRuntime(connection) {
  const result = await connection.request('web/GetClientSideWebParts');
  const parts = collection(result?.GetClientSideWebParts ?? result, 'Form runtime');
  // SharePoint wraps custom (but not built-in) component IDs in GUID braces.
  // Accept that exact representation while retaining the manifest identity check.
  const componentId = value => {
    if (typeof value !== 'string') return null;
    const id = value.startsWith('{') && value.endsWith('}') ? value.slice(1, -1) : value;
    return GUID.test(id) ? id.toLowerCase() : null;
  };
  const matching = parts.filter(part => componentId(part?.Id) === FORM_COMPONENT_ID);
  if (matching.length !== 1) throw fail('form-runtime-missing', 'The imported form runtime must be installed on the selected SharePoint site before importing this form.');
  let manifest;
  try { manifest = JSON.parse(matching[0].Manifest); } catch { throw fail('form-runtime-invalid', 'The installed form runtime manifest is invalid.'); }
  if (typeof manifest?.id !== 'string' || manifest.id.toLowerCase() !== FORM_COMPONENT_ID || manifest.componentType !== 'WebPart' || manifest.manifestVersion !== 2) throw fail('form-runtime-invalid', 'The installed form runtime is incompatible.');
  await connection.checkRuntimeAsset(manifest);
}

function ownedList(value, specification, expectedId) {
  if (!value || !GUID.test(value.Id ?? '') || expectedId && value.Id.toLowerCase() !== expectedId.toLowerCase() || value.Title !== specification.title || value.Description !== specification.description || value.BaseTemplate !== 100 || value.Hidden !== false) throw schemaFailure(`${specification.title} is not an owned compatible list.`);
  return { ...value, Id: value.Id.toLowerCase() };
}

async function discoverList(connection, specification, id) {
  if (id !== undefined) return ownedList(await connection.request(`${listPath(id)}?${metadataQuery}`), specification, id);
  const found = collection(await connection.request(`web/lists?${metadataQuery}&$filter=${encode(`Title eq '${specification.title}'`)}&$top=2`), specification.title);
  if (found.length > 1) throw schemaFailure(`${specification.title} has multiple matching lists.`);
  return found.length ? ownedList(found[0], specification) : null;
}

async function inspectFields(connection, list, specification, allowMissing = false) {
  const fields = collection(await connection.request(`${listPath(list.Id)}/fields?$select=*`), `${specification.title} fields`);
  const byName = new Map();
  for (const value of fields) {
    if (typeof value?.InternalName !== 'string' || byName.has(value.InternalName)) throw schemaFailure('Field identities are missing or duplicated.');
    byName.set(value.InternalName, value);
  }
  const title = byName.get('Title');
  if (title?.TypeAsString !== 'Text' || title.FieldTypeKind !== 2 || title.MaxLength !== 255 || title.ReadOnlyField !== false || title.Hidden !== false) throw schemaFailure(`${specification.title} has an incompatible Title field.`);
  for (const expected of specification.fields) {
    const actual = byName.get(expected.InternalName);
    if (!actual && allowMissing) continue;
    if (!actual || Object.entries(expected).some(([key, value]) => actual[key] !== value)) throw schemaFailure(`${specification.title}.${expected.InternalName} has incompatible type, flags, limits or indexing.`);
  }
  return byName;
}

async function assertEmptyForSetup(connection, list, specification, refresh = true) {
  const current = refresh ? await discoverList(connection, specification, list.Id) : list;
  if (!Number.isInteger(current.ItemCount) || current.ItemCount < 0) throw fail('form-setup-unverified', `An empty owned ${specification.title} list could not be verified before adding required columns.`);
  if (current.ItemCount !== 0) throw fail('form-setup-nonempty', `${specification.title} contains existing items. Required missing columns cannot be added safely; review the list before retrying.`);
  // ItemCount guards against item-level permissions hiding records from this read.
  const visible = collection(await connection.request(`${listPath(list.Id)}/items?$select=Id&$top=1`), `${specification.title} items`);
  if (visible.length) throw fail('form-setup-nonempty', `${specification.title} contains existing items. Required missing columns cannot be added safely; review the list before retrying.`);
}

async function inspect(connection, options) {
  await installedRuntime(connection);
  const lists = new Map();
  // Validate BOTH existing schemas before provisioning either missing list.
  for (const specification of LISTS) {
    const list = await discoverList(connection, specification, options[specification.key]);
    if (list) {
      const fields = await inspectFields(connection, list, specification, true);
      list.missingColumns = specification.fields.filter(expected => !fields.has(expected.InternalName)).map(expected => expected.InternalName);
      if (list.missingColumns.length) await assertEmptyForSetup(connection, list, specification, false);
    }
    lists.set(specification.key, list);
  }
  return lists;
}

/** Read-only. With expectedDefinition, also requires the exact prepared immutable item to remain readable. */
export async function checkFormReadiness(options) {
  const expected = options.expectedDefinition === undefined ? null : validateDefinition(options.expectedDefinition);
  const connection = client(options);
  const lists = await inspect(connection, options);
  if (expected) {
    const list = lists.get('definitionListId');
    if (!list || list.missingColumns.length || !await storedDefinition(connection, list, expected, JSON.stringify(expected))) throw fail('form-definition-unavailable', 'The prepared immutable form definition is no longer available. Review the form before importing.');
  }
  return { componentId: FORM_COMPONENT_ID, definitionListId: lists.get('definitionListId')?.Id ?? null, responseListId: lists.get('responseListId')?.Id ?? null,
    needsSetup: LISTS.some(specification => !lists.get(specification.key) || lists.get(specification.key).missingColumns.length > 0) };
}

function fieldXml(expected) {
  const attributes = { Type: expected.TypeAsString, Name: expected.InternalName, StaticName: expected.InternalName, DisplayName: expected.InternalName,
    Required: 'TRUE', Hidden: 'FALSE', ReadOnly: 'FALSE', Indexed: expected.Indexed ? 'TRUE' : 'FALSE', EnforceUniqueValues: expected.EnforceUniqueValues ? 'TRUE' : 'FALSE' };
  if (expected.MaxLength !== undefined) attributes.MaxLength = String(expected.MaxLength);
  if (expected.TypeAsString === 'Note') Object.assign(attributes, { RichText: 'FALSE', AppendOnly: 'FALSE', NumLines: '6' });
  if (expected.TypeAsString === 'Number') attributes.Decimals = '0';
  // Attributes are fixed constants from LISTS, never document-controlled strings.
  return `<Field ${Object.entries(attributes).map(([key, value]) => `${key}="${value}"`).join(' ')} />`;
}

async function provision(connection, specification, existingList) {
  const list = existingList ?? await connection.createAndConfirm('web/lists', { Title: specification.title, Description: specification.description, BaseTemplate: 100 },
    () => discoverList(connection, specification), specification.title);
  let fields = await inspectFields(connection, list, specification, true);
  for (const expected of specification.fields) {
    if (fields.has(expected.InternalName)) continue;
    // Recheck immediately before each required column; never backfill existing records.
    await assertEmptyForSetup(connection, list, specification);
    fields = await connection.createAndConfirm(`${listPath(list.Id)}/fields/createfieldasxml`, { parameters: { SchemaXml: fieldXml(expected), Options: 0 } }, async () => {
      const current = await inspectFields(connection, list, specification, true);
      return current.has(expected.InternalName) ? current : null;
    }, `${specification.title}.${expected.InternalName}`);
  }
  await inspectFields(connection, list, specification);
  return { ...list, missingColumns: [] };
}

async function storedDefinition(connection, list, definition, serialized) {
  const matches = collection(await connection.request(`${listPath(list.Id)}/items?$select=Id,FormId,DefinitionJson&$filter=${encode(`FormId eq '${definition.id}'`)}&$top=2`), 'Form definition');
  if (!matches.length) return null;
  if (matches.length !== 1 || !Number.isInteger(matches[0].Id) || matches[0].Id <= 0 || matches[0].FormId !== definition.id || matches[0].DefinitionJson !== serialized) throw fail('form-definition-conflict', 'A different immutable definition already uses this form ID, or the saved definition does not match.');
  return matches[0];
}

/** May create lists, columns and an immutable definition; call only after the user's reviewed Send action. */
export async function prepareForm(options) {
  const definition = validateDefinition(options.definition);
  const serialized = JSON.stringify(definition);
  const connection = client(options);
  const lists = await inspect(connection, options);
  const existingList = lists.get('definitionListId');
  // An incomplete definition list was verified empty and cannot contain a valid immutable definition.
  if (existingList && !existingList.missingColumns.length) await storedDefinition(connection, existingList, definition, serialized);
  for (const specification of LISTS) {
    const list = lists.get(specification.key);
    if (!list || list.missingColumns.length) lists.set(specification.key, await provision(connection, specification, list));
  }
  const definitionList = lists.get('definitionListId');
  if (!await storedDefinition(connection, definitionList, definition, serialized)) {
    await connection.createAndConfirm(`${listPath(definitionList.Id)}/items`, { Title: definition.title.slice(0, 255), FormId: definition.id, DefinitionJson: serialized },
      () => storedDefinition(connection, definitionList, definition, serialized), 'Form definition');
  }
  return { formId: definition.id, definitionListId: definitionList.Id, responseListId: lists.get('responseListId').Id };
}
