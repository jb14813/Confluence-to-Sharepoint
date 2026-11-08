import test from 'node:test';
import assert from 'node:assert/strict';

const api = await import('../src/destination/forms.js').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
const SITE = 'https://contoso.sharepoint.com/sites/Docs';
const COMPONENT = 'f104fa11-c9e8-43d6-8c5a-3f7b70f31ab1';
const DEFINITION_LIST = '45bc5c89-20db-4890-93f0-bc91c36aed73';
const RESPONSE_LIST = 'a4b9d3d7-3fd5-437b-b071-bab06d358bc1';
const TITLE = { definitions: 'File to SharePoint Form Definitions', responses: 'File to SharePoint Form Responses' };
const DESCRIPTION = { definitions: `File to SharePoint form definitions; schema v1; component ${COMPONENT}.`, responses: `File to SharePoint form responses; schema v1; component ${COMPONENT}.` };
const definition = () => ({ version: 1, id: 'a'.repeat(64), title: 'Equipment request', fields: [{ id: 'f_1111111111111111', sourceName: '__proto__', kind: 'text', label: 'Name', value: '', required: true, readOnly: false }] });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json;odata=nometadata' } });
const common = { Hidden: false, ReadOnlyField: false, Required: true, Indexed: false, EnforceUniqueValues: false };
const text = (InternalName, MaxLength, options = {}) => ({ ...common, InternalName, TypeAsString: 'Text', FieldTypeKind: 2, MaxLength, ...options });
const note = InternalName => ({ ...common, InternalName, TypeAsString: 'Note', FieldTypeKind: 3, RichText: false, AppendOnly: false });
function fields(kind) {
  return [text('Title', 255), ...(kind === 'definitions' ? [text('FormId', 64, { Indexed: true, EnforceUniqueValues: true }), note('DefinitionJson')] : [text('SubmissionId', 36, { Indexed: true, EnforceUniqueValues: true }), text('FormId', 64, { Indexed: true }), { ...common, InternalName: 'DefinitionVersion', TypeAsString: 'Number', FieldTypeKind: 9, DisplayFormat: 0 }, note('ResponseJson')])];
}

// A stateful in-memory SharePoint transport: tests assert persisted data and actual mutation counts.
function service({ installed = true, definitions = false, responses = false, lose, persist = true, failureStatus = 503 } = {}) {
  const calls = []; const lists = new Map(); let lost = false;
  for (const [kind, present] of [['definitions', definitions], ['responses', responses]]) if (present) {
    const Id = kind === 'definitions' ? DEFINITION_LIST : RESPONSE_LIST;
    lists.set(Id, { Id, Title: TITLE[kind], Description: DESCRIPTION[kind], BaseTemplate: 100, Hidden: false, fields: fields(kind), items: [] });
  }
  async function request(address, options = {}) {
    const url = new URL(address), resource = decodeURIComponent(url.pathname.slice(`${new URL(SITE).pathname}/_api/`.length));
    assert.equal(url.origin, 'https://contoso.sharepoint.com');
    assert.equal(options.credentials, 'same-origin'); assert.equal(options.redirect, 'error');
    calls.push({ resource, method: options.method ?? 'GET', body: options.body });
    if (resource === 'web/GetClientSideWebParts') return json({ value: installed ? [{ Id: COMPONENT, Manifest: JSON.stringify({ id: COMPONENT, componentType: 'WebPart', manifestVersion: 2 }) }] : [] });
    if (resource === 'contextinfo') return json({ FormDigestValue: 'digest-1', FormDigestTimeoutSeconds: 1800 });
    const body = options.body ? JSON.parse(options.body) : undefined;
    if (options.method === 'POST') assert.equal(options.headers['X-RequestDigest'], 'digest-1');
    if (resource === 'web/lists') {
      if (options.method !== 'POST') {
        const expected = /^Title eq '([^']+)'$/.exec(url.searchParams.get('$filter'))?.[1];
        assert.ok(expected);
        return json({ value: [...lists.values()].filter(list => list.Title === expected).map(({ fields, items, ...metadata }) => ({ ...metadata, ItemCount: items.length })) });
      }
      const kind = body.Title === TITLE.definitions ? 'definitions' : 'responses';
      const Id = kind === 'definitions' ? DEFINITION_LIST : RESPONSE_LIST;
      const mutation = () => lists.set(Id, { Id, Title: body.Title, Description: body.Description, BaseTemplate: body.BaseTemplate, Hidden: false, fields: [text('Title', 255)], items: [] });
      if (lose === 'list' && !lost) { lost = true; if (persist) mutation(); if (failureStatus === 'network') throw new TypeError('Lost response'); return json({}, failureStatus); }
      mutation(); return json({ Id }, 201);
    }
    const match = /^web\/lists\(guid'([a-f0-9-]+)'\)(.*)$/.exec(resource);
    assert.ok(match, `Unexpected endpoint: ${resource}`);
    const [, id, suffix] = match, list = lists.get(id);
    if (!list) return json({}, 404);
    if (!suffix) { const { fields, items, ...metadata } = list; return json({ ...metadata, ItemCount: items.length }); }
    if (suffix === '/fields') return json({ value: list.fields });
    if (suffix === '/fields/createfieldasxml') {
      const attrs = Object.fromEntries([...body.parameters.SchemaXml.matchAll(/([A-Za-z]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));
      const template = fields(list.Title === TITLE.definitions ? 'definitions' : 'responses').find(field => field.InternalName === attrs.Name);
      assert.ok(template, `Unknown field XML: ${attrs.Name}`);
      assert.equal(attrs.Type, template.TypeAsString);
      assert.equal(attrs.Required, 'TRUE');
      assert.equal(attrs.Indexed, template.Indexed ? 'TRUE' : 'FALSE');
      assert.equal(attrs.EnforceUniqueValues, template.EnforceUniqueValues ? 'TRUE' : 'FALSE');
      if (template.MaxLength) assert.equal(attrs.MaxLength, String(template.MaxLength));
      if (template.TypeAsString === 'Note') { assert.equal(attrs.RichText, 'FALSE'); assert.equal(attrs.AppendOnly, 'FALSE'); }
      if (template.TypeAsString === 'Number') assert.equal(attrs.Decimals, '0');
      const mutation = () => list.fields.push(structuredClone(template));
      if (lose === 'field' && !lost) { lost = true; if (persist) mutation(); if (failureStatus === 'network') throw new TypeError('Lost field response'); return json({}, failureStatus); }
      mutation(); return json({ Id: '4c728573-a96a-4fc1-9fd8-0662dc5918fe' }, 201);
    }
    if (suffix === '/items') {
      if (options.method !== 'POST') return json({ value: url.searchParams.has('$filter') ? list.items.filter(item => item.FormId === /^FormId eq '([^']+)'$/.exec(url.searchParams.get('$filter'))?.[1]) : list.items.slice(0, Number(url.searchParams.get('$top') ?? list.items.length)) });
      const mutation = () => list.items.push({ ...body, Id: list.items.length + 1 });
      if (lose === 'item' && !lost) { lost = true; if (persist) mutation(); if (failureStatus === 'network') throw new TypeError('Lost item response'); return json({}, failureStatus); }
      mutation(); return json({ Id: list.items.length }, 201);
    }
    assert.fail(`Unknown endpoint ${resource}`);
  }
  return { request, lists, calls, writes: () => calls.filter(call => call.method === 'POST' && call.resource !== 'contextinfo') };
}
const options = (transport, overrides = {}) => ({ siteUrl: SITE, definition: definition(), request: transport.request, ...overrides });

test('readiness recognizes SharePoint custom component GUIDs enclosed in braces without relaxing component identity', async () => {
  for (const Id of [COMPONENT, COMPONENT.toUpperCase(), `{${COMPONENT.toUpperCase()}}`]) {
    const transport = service({ definitions: true, responses: true });
    const request = (url, init) => url.endsWith('/web/GetClientSideWebParts') ? Promise.resolve(json({ value: [{ Id, Manifest: JSON.stringify({ id: COMPONENT, componentType: 'WebPart', manifestVersion: 2 }) }] })) : transport.request(url, init);
    const ready = await api.checkFormReadiness(options(transport, { request }));
    assert.equal(ready.needsSetup, false); assert.equal(ready.componentId, COMPONENT); assert.equal(transport.writes().length, 0);
  }
  for (const Id of [`{${COMPONENT}`, `${COMPONENT}}`, `{{${COMPONENT}}}`, '{00000000-0000-4000-8000-000000000001}']) {
    const transport = service({ definitions: true, responses: true });
    const request = (url, init) => url.endsWith('/web/GetClientSideWebParts') ? Promise.resolve(json({ value: [{ Id, Manifest: JSON.stringify({ id: COMPONENT, componentType: 'WebPart', manifestVersion: 2 }) }] })) : transport.request(url, init);
    await assert.rejects(api.checkFormReadiness(options(transport, { request })), { code: 'form-runtime-missing' });
    assert.equal(transport.writes().length, 0);
  }
});

test('missing installed form component refuses before any SharePoint mutation or request token', async () => {
  assert.equal(typeof api.prepareForm, 'function', 'A form setup function must exist');
  const transport = service({ installed: false });
  await assert.rejects(api.prepareForm(options(transport)), /runtime|installed/i);
  assert.deepEqual(transport.calls.map(call => call.method), ['GET']);
});

test('read-only readiness reports missing lists without provisioning', async () => {
  assert.equal(typeof api.checkFormReadiness, 'function');
  const transport = service();
  const readiness = await api.checkFormReadiness(options(transport));
  assert.equal(readiness.componentId, COMPONENT); assert.equal(readiness.needsSetup, true);
  assert.equal(readiness.definitionListId, null); assert.equal(readiness.responseListId, null);
  assert.equal(transport.writes().length, 0);
});

test('schema/ownership mismatch on either existing list causes zero writes, including when the other list is missing', async () => {
  assert.equal(typeof api.prepareForm, 'function');
  for (const corrupt of [
    list => { list.Description = 'Unrelated existing list'; },
    list => { list.BaseTemplate = 101; },
    list => { list.fields.find(field => field.InternalName === 'SubmissionId').Indexed = false; },
    list => { list.fields.find(field => field.InternalName === 'SubmissionId').EnforceUniqueValues = false; },
    list => { list.fields.find(field => field.InternalName === 'ResponseJson').RichText = true; },
    list => { list.fields.find(field => field.InternalName === 'DefinitionVersion').DisplayFormat = 2; },
    list => { list.fields.find(field => field.InternalName === 'FormId').TypeAsString = 'Note'; }
  ]) {
    const transport = service({ responses: true }); corrupt(transport.lists.get(RESPONSE_LIST));
    await assert.rejects(api.prepareForm(options(transport)), /schema|owned|ownership|compatible|list/i);
    assert.equal(transport.writes().length, 0);
  }
});

test('provisions owned lists after Send and stores exact immutable definition; repeated setup performs no additional writes', async () => {
  assert.equal(typeof api.prepareForm, 'function');
  const transport = service();
  assert.deepEqual(await api.prepareForm(options(transport)), { formId: 'a'.repeat(64), definitionListId: DEFINITION_LIST, responseListId: RESPONSE_LIST });
  assert.equal(transport.writes().length, 9, 'Two lists, six custom fields, one definition item');
  assert.equal(transport.lists.get(DEFINITION_LIST).items[0].DefinitionJson, JSON.stringify(definition()));
  await api.prepareForm(options(transport));
  assert.equal(transport.writes().length, 9);
  const ready = await api.checkFormReadiness(options(transport)); assert.equal(ready.needsSetup, false);
  assert.equal(transport.writes().some(call => /role|permission|inheritance/i.test(call.resource)), false);
});

test('lost list, field and item creation responses reconcile persisted state without duplicate POSTs', async () => {
  assert.equal(typeof api.prepareForm, 'function');
  for (const lose of ['list', 'field', 'item']) {
    const transport = service({ lose, failureStatus: 'network' });
    await api.prepareForm(options(transport));
    assert.equal(transport.writes().length, 9, lose);
    assert.equal(transport.lists.size, 2);
    assert.equal(transport.lists.get(DEFINITION_LIST).items.length, 1);
  }
});

test('unconfirmed list, field or item creation fails with no blind mutation retry', async () => {
  assert.equal(typeof api.prepareForm, 'function');
  for (const lose of ['list', 'field', 'item']) {
    const transport = service({ lose, persist: false, failureStatus: 503 });
    await assert.rejects(api.prepareForm(options(transport)), /not confirmed|unconfirmed/i);
    const writes = transport.writes();
    assert.equal(writes.length, { list: 1, field: 2, item: 9 }[lose]);
    assert.equal(writes.filter(call => call.resource === writes.at(-1).resource && call.body === writes.at(-1).body).length, 1);
  }
});

test('existing hash cannot be overwritten and changed persisted JSON cannot produce success', async () => {
  assert.equal(typeof api.prepareForm, 'function');
  const transport = service({ definitions: true, responses: true });
  transport.lists.get(DEFINITION_LIST).items.push({ Id: 1, FormId: 'a'.repeat(64), DefinitionJson: JSON.stringify({ ...definition(), title: 'Other definition' }) });
  await assert.rejects(api.prepareForm(options(transport)), /different|immutable|match/i);
  assert.equal(transport.writes().length, 0);
  const tampered = service({ definitions: true, responses: true });
  const request = async (...args) => {
    const reply = await tampered.request(...args);
    if (args[1]?.method === 'POST' && args[0].includes('/items')) tampered.lists.get(DEFINITION_LIST).items[0].DefinitionJson = '{}';
    return reply;
  };
  await assert.rejects(api.prepareForm(options(tampered, { request })), /different|immutable|match|confirmed/i);
  assert.equal(tampered.writes().length, 1);
});

test('invalid definitions and list IDs fail before requests; explicit list GUIDs remain bound to owned lists on selected web', async () => {
  assert.equal(typeof api.prepareForm, 'function');
  const transport = service({ definitions: true, responses: true });
  await assert.rejects(api.prepareForm(options(transport, { definition: { ...definition(), completedHtml: '<script>bad</script>' } })), /Invalid/);
  for (const definitionListId of ["x')/roleassignments", 123, {}, { toString: () => DEFINITION_LIST }]) {
    await assert.rejects(api.prepareForm(options(transport, { definitionListId })), /invalid/i);
  }
  assert.equal(transport.calls.length, 0);
  assert.deepEqual(await api.prepareForm(options(transport, { definitionListId: DEFINITION_LIST, responseListId: RESPONSE_LIST })), { formId: 'a'.repeat(64), definitionListId: DEFINITION_LIST, responseListId: RESPONSE_LIST });
  assert.equal(transport.writes().length, 1);
});

test('an interrupted required-column create can be resumed on the next reviewed Send without recreating its owned list', async () => {
  const transport = service({ lose: 'field', persist: false, failureStatus: 503 });
  await assert.rejects(api.prepareForm(options(transport)), /not confirmed/i);
  assert.equal(transport.writes().length, 2);
  assert.equal(transport.lists.size, 1);
  const readiness = await api.checkFormReadiness(options(transport));
  assert.equal(readiness.needsSetup, true);
  assert.equal(readiness.definitionListId, DEFINITION_LIST);
  assert.equal(readiness.responseListId, null);
  assert.equal(transport.writes().length, 2, 'Readiness must not finish setup itself');
  assert.deepEqual(await api.prepareForm(options(transport)), { formId: 'a'.repeat(64), definitionListId: DEFINITION_LIST, responseListId: RESPONSE_LIST });
  assert.equal(transport.writes().filter(call => call.resource === 'web/lists').length, 2);
  assert.equal(transport.lists.get(DEFINITION_LIST).items.length, 1);
  assert.equal(transport.writes().length, 10, 'Only the failed explicit prior attempt adds an extra mutation');
  assert.equal((await api.checkFormReadiness(options(transport))).needsSetup, false);
  await api.prepareForm(options(transport));
  assert.equal(transport.writes().length, 10);
});

test('required missing columns on a list containing items are refused without writes or automatic backfill', async () => {
  for (const [listId, column] of [[DEFINITION_LIST, 'DefinitionJson'], [RESPONSE_LIST, 'ResponseJson']]) {
    const transport = service({ definitions: true, responses: true });
    const partial = transport.lists.get(listId);
    partial.fields = partial.fields.filter(field => field.InternalName !== column);
    partial.items.push({ Id: 1, Title: 'Existing record' });
    await assert.rejects(api.checkFormReadiness(options(transport)), /existing items|contains items|empty/i);
    await assert.rejects(api.prepareForm(options(transport)), /existing items|contains items|empty/i);
    assert.equal(transport.writes().length, 0);
  }
});

test('compatible missing columns never excuse an incompatible present field or an immutable definition conflict', async () => {
  const incompatible = service({ definitions: true, responses: true });
  const response = incompatible.lists.get(RESPONSE_LIST);
  response.fields = response.fields.filter(field => field.InternalName !== 'ResponseJson');
  response.fields.find(field => field.InternalName === 'SubmissionId').EnforceUniqueValues = false;
  await assert.rejects(api.prepareForm(options(incompatible)), /schema|incompatible/i);
  assert.equal(incompatible.writes().length, 0);
  const conflict = service({ definitions: true, responses: true });
  conflict.lists.get(RESPONSE_LIST).fields = conflict.lists.get(RESPONSE_LIST).fields.filter(field => field.InternalName !== 'ResponseJson');
  conflict.lists.get(DEFINITION_LIST).items.push({ Id: 1, FormId: 'a'.repeat(64), DefinitionJson: JSON.stringify({ ...definition(), title: 'Different immutable form' }) });
  await assert.rejects(api.prepareForm(options(conflict)), /different|immutable|match/i);
  assert.equal(conflict.writes().length, 0);
});

test('required-column recovery cannot infer an empty list from permission-filtered items or missing count metadata', async () => {
  for (const hideCount of [false, true]) {
    const transport = service({ definitions: true, responses: true });
    const partial = transport.lists.get(RESPONSE_LIST);
    partial.fields = partial.fields.filter(field => field.InternalName !== 'ResponseJson');
    if (!hideCount) partial.items.push({ Id: 1, Title: 'Hidden from respondent' });
    const request = async (...args) => {
      const response = await transport.request(...args);
      if (!args[0].includes(RESPONSE_LIST) && !args[0].includes(encodeURIComponent(TITLE.responses))) return response;
      const body = await response.json();
      if (hideCount) {
        if (body.value) for (const item of body.value) delete item.ItemCount;
        else delete body.ItemCount;
      }
      if (args[0].includes('/items?')) body.value = [];
      return json(body);
    };
    await assert.rejects(api.prepareForm(options(transport, { request })), /existing items|empty/i);
    assert.equal(transport.writes().length, 0);
  }
});

test('a record inserted after readiness inspection prevents adding the missing required column', async () => {
  const transport = service({ definitions: true, responses: true });
  const partial = transport.lists.get(RESPONSE_LIST);
  partial.fields = partial.fields.filter(field => field.InternalName !== 'ResponseJson');
  let inserted = false;
  const request = async (...args) => {
    const response = await transport.request(...args);
    if (!inserted && args[0].includes(RESPONSE_LIST) && args[0].includes('/items?')) {
      inserted = true;
      partial.items.push({ Id: 1, Title: 'Arrived after initial empty read' });
    }
    return response;
  };
  await assert.rejects(api.prepareForm(options(transport, { request })), /existing items/i);
  assert.equal(inserted, true);
  assert.equal(transport.writes().length, 0);
});
