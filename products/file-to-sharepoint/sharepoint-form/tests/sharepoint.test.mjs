import { test, before } from 'node:test';
import assert from 'node:assert/strict';

let api;
before(async () => { api = await import('../.artifacts/sharepoint.js').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; }); });
const formId = 'a'.repeat(64);
const submissionId = 'e298cf2f-02df-4a08-9cc3-d257dfd3312c';
const definitionListId = 'bd8cfe5b-b531-46b9-8d3e-c12fb304d54d';
const responseListId = 'ab24f21c-89a1-4ae8-82d1-d404f5a620b2';
const definition = { version: 1, id: formId, title: 'Request', fields: [{ id: 'f_1111111111111111', sourceName: 'name', kind: 'text', label: 'Name', value: '', required: true, readOnly: false }] };
const payload = { formId, definitionVersion: 1, submissionId, values: { f_1111111111111111: 'Éva' } };
const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const adapter = request => api.createSharePointAdapter({ webUrl: 'https://tenant.sharepoint.com/sites/review', definitionListId, responseListId, request });

test('loads only selected-site definition and saves response under the current user without permission changes', async () => {
  assert.equal(typeof api.createSharePointAdapter, 'function', 'A SharePoint persistence adapter must exist');
  const writes = [];
  const store = adapter(async (url, options) => {
    assert.ok(url.startsWith('https://tenant.sharepoint.com/sites/review/_api/web/lists('));
    if (options.method === 'POST') { writes.push(JSON.parse(options.body)); return reply(201, { Id: 3 }); }
    if (url.includes(definitionListId)) return reply(200, { value: [{ Id: 1, FormId: formId, DefinitionJson: JSON.stringify(definition) }] });
    return reply(200, { value: [] });
  });
  assert.deepEqual(await store.loadDefinition(formId), definition);
  assert.deepEqual(await store.submit(payload), { status: 'saved', submissionId });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { Title: submissionId, SubmissionId: submissionId, FormId: formId, DefinitionVersion: 1, ResponseJson: JSON.stringify(payload.values) });
});

test('ambiguous POST is reconciled by nonce and repeat submission never duplicates a persisted response', async () => {
  assert.equal(typeof api.createSharePointAdapter, 'function');
  let persisted; let posts = 0;
  const store = adapter(async (url, options) => {
    if (url.includes(definitionListId)) return reply(200, { value: [{ FormId: formId, DefinitionJson: JSON.stringify(definition) }] });
    if (options.method === 'POST') { posts++; persisted = JSON.parse(options.body); throw new Error('Lost response after server committed'); }
    return reply(200, { value: persisted ? [persisted] : [] });
  });
  assert.deepEqual(await store.submit(payload), { status: 'saved', submissionId });
  assert.deepEqual(await store.submit(payload), { status: 'saved', submissionId });
  assert.equal(posts, 1);
});

test('permissions, malformed values, nonce collision and unreconciled writes never report success or auto-retry', async () => {
  assert.equal(typeof api.createSharePointAdapter, 'function');
  let posts = 0;
  const store = adapter(async (url, options) => {
    if (url.includes(definitionListId)) return reply(200, { value: [{ FormId: formId, DefinitionJson: JSON.stringify(definition) }] });
    if (options.method === 'POST') { posts++; return reply(403, {}); }
    return reply(200, { value: [] });
  });
  await assert.rejects(store.submit({ ...payload, values: { f_1111111111111111: '' } }), /required/i);
  await assert.rejects(store.submit({ ...payload, values: { __proto__: 'unsafe' } }), /Invalid|required/);
  await assert.rejects(store.submit(payload), /403/);
  assert.equal(posts, 1);
  const uncertain = adapter(async (url, options) => {
    if (url.includes(definitionListId)) return reply(200, { value: [{ FormId: formId, DefinitionJson: JSON.stringify(definition) }] });
    if (options.method === 'POST') { posts++; throw new Error('Lost'); }
    return reply(200, { value: [] });
  });
  await assert.rejects(uncertain.submit(payload), /not confirmed/i);
  assert.equal(posts, 2, 'Exactly one POST per explicit submit');
  const collision = adapter(async (url) => reply(200, { value: url.includes(definitionListId) ? [{ FormId: formId, DefinitionJson: JSON.stringify(definition) }] : [{ SubmissionId: submissionId, FormId: formId, DefinitionVersion: 1, ResponseJson: '{"f_1111111111111111":"Other"}' }] }));
  await assert.rejects(collision.submit(payload), /different|collision/i);
});

test('rejects URL and list injection before issuing requests', () => {
  assert.equal(typeof api.createSharePointAdapter, 'function');
  const base = { webUrl: 'https://tenant.sharepoint.com/sites/review', definitionListId, responseListId, request: async () => { throw new Error('Must not call'); } };
  for (const webUrl of ['https://evil.example/sites/review', 'https://tenant.sharepoint.com/sites/review?next=x', 'http://tenant.sharepoint.com', 'https://tenant.sharepoint.com/sites/../other']) assert.throws(() => api.createSharePointAdapter({ ...base, webUrl }), /Invalid/);
  assert.throws(() => api.createSharePointAdapter({ ...base, responseListId: "x')/roleassignments" }), /Invalid/);
});

test('an OK response with no created item cannot produce false success', async () => {
  let posts = 0;
  const store = adapter(async (url, options) => {
    if (url.includes(definitionListId)) return reply(200, { value: [{ FormId: formId, DefinitionJson: JSON.stringify(definition) }] });
    if (options.method === 'POST') { posts++; return reply(200, { login: true }); }
    return reply(200, { value: [] });
  });
  await assert.rejects(store.submit(payload), /not confirmed/i);
  assert.equal(posts, 1);
});

test('definition save is idempotent and never overwrites a changed definition', async () => {
  let persisted; let writes = 0;
  const store = adapter(async (_url, options) => {
    if (options.method === 'POST') { writes++; persisted = JSON.parse(options.body); return reply(201, { Id: 1 }); }
    return reply(200, { value: persisted ? [persisted] : [] });
  });
  await store.saveDefinition(definition);
  await store.saveDefinition(definition);
  await assert.rejects(store.saveDefinition({ ...definition, title: 'Changed' }), /different/i);
  assert.equal(writes, 1);
});

test('definition creation requires a created item or a matching persisted definition', async () => {
  const store = adapter(async (_url, options) => options.method === 'POST' ? reply(200, { login: true }) : reply(200, { value: [] }));
  await assert.rejects(store.saveDefinition(definition), /not confirmed/i);
});
