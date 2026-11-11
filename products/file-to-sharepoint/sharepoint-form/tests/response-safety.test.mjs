import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let createSharePointAdapter, mountForm;
before(async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://tenant.sharepoint.com/sites/review/' });
  for (const key of ['window', 'document', 'Document', 'ShadowRoot', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'getComputedStyle']) {
    globalThis[key] = key === 'getComputedStyle' ? dom.window[key].bind(dom.window) : dom.window[key];
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.ResizeObserver = window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  ({ createSharePointAdapter } = await import('../.artifacts/sharepoint.js'));
  ({ mountForm } = await import('../.artifacts/index.js'));
});

const formId = 'b'.repeat(64), fieldId = 'f_2222222222222222';
const definitionListId = 'bd8cfe5b-b531-46b9-8d3e-c12fb304d54d';
const responseListId = 'ab24f21c-89a1-4ae8-82d1-d404f5a620b2';
const submissionId = 'e298cf2f-02df-4a08-9cc3-d257dfd3312c';
const definition = { version: 1, id: formId, title: 'Permission review', fields: [{ id: fieldId, sourceName: 'name', kind: 'text', label: 'Name', value: '', required: true, readOnly: false }] };
const payload = { formId, definitionVersion: 1, submissionId, values: { [fieldId]: 'Retained value' } };
const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const definitionItem = () => ({ Id: 1, FormId: formId, DefinitionJson: JSON.stringify(definition) });
const responseItem = input => ({ Id: 2, SubmissionId: input.submissionId, FormId: input.formId, DefinitionVersion: 1, ResponseJson: JSON.stringify(input.values) });
const adapter = (request, webUrl = 'https://tenant.sharepoint.com/sites/review') => createSharePointAdapter({ webUrl, definitionListId, responseListId, request });

test('partial definition reads cannot load, confirm an existing definition, or authorize response writes', async () => {
  for (const continuation of ['odata.nextLink', '@odata.nextLink', '__next']) {
    const calls = [];
    const store = adapter(async (url, options) => {
      calls.push({ url, method: options.method });
      return reply(200, { value: [definitionItem()], [continuation]: 'https://other.sharepoint.com/_api/more' });
    });
    await assert.rejects(store.loadDefinition(formId), /incomplete|ambiguous/i);
    await assert.rejects(store.saveDefinition(definition), /incomplete|ambiguous/i);
    await assert.rejects(store.submit(payload), /incomplete|ambiguous/i);
    assert.equal(calls.length, 3, 'Continuation URLs must never be followed');
    assert.ok(calls.every(call => call.method === 'GET' && call.url.includes(definitionListId)));
  }
});

test('a matching nonce on an incomplete page cannot be acknowledged as saved or trigger a new POST', async () => {
  for (const continuation of ['odata.nextLink', '@odata.nextLink', '__next']) {
    let posts = 0;
    const store = adapter(async (url, options) => {
      if (options.method === 'POST') { posts++; return reply(201, { Id: 2 }); }
      return url.includes(definitionListId) ? reply(200, { value: [definitionItem()] }) :
        reply(200, { value: [responseItem(payload)], [continuation]: '/_api/more' });
    });
    await assert.rejects(store.submit(payload), /incomplete|ambiguous/i);
    assert.equal(posts, 0);
  }
});

test('permission loss after an unconfirmed commit retains values and nonce; explicit recovery reads the single saved item', async () => {
  const host = document.createElement('div'); document.body.append(host);
  let persisted, denied = false, posts = 0;
  const store = adapter(async (url, options) => {
    if (url.includes(definitionListId)) return reply(200, { value: [definitionItem()] });
    if (options.method === 'POST') {
      posts++; persisted = JSON.parse(options.body); denied = true;
      throw new TypeError('Connection lost after commit');
    }
    return denied ? reply(403, {}) : reply(200, { value: persisted ? [{ ...persisted, Id: 2 }] : [] });
  });
  const form = mountForm(host, definition, { submit: store.submit });
  try {
    form.model.setValue(fieldId, 'Retained value');
    assert.equal(await form.submit(), false);
    assert.equal(posts, 1);
    assert.equal(form.getValues()[fieldId], 'Retained value');
    assert.ok(host.textContent.includes(persisted.SubmissionId));
    assert.match(host.textContent, /not confirmed/i);
    assert.equal(await form.submit(), false, 'Another explicit check while denied cannot post again');
    assert.equal(posts, 1);
    denied = false;
    assert.equal(await form.submit(), true);
    assert.equal(posts, 1);
    assert.match(host.textContent, /response was saved/i);
  } finally { form.dispose(); host.remove(); }
});

test('an incomplete recovery page retains the original nonce until a complete explicit check succeeds', async () => {
  const host = document.createElement('div'); document.body.append(host);
  let persisted, incomplete = true, posts = 0;
  const store = adapter(async (url, options) => {
    if (url.includes(definitionListId)) return reply(200, { value: [definitionItem()] });
    if (options.method === 'POST') { posts++; persisted = JSON.parse(options.body); throw new TypeError('Lost commit confirmation'); }
    return reply(200, { value: persisted ? [{ ...persisted, Id: 2 }] : [], ...(persisted && incomplete ? { '@odata.nextLink': '/_api/more' } : {}) });
  });
  const form = mountForm(host, definition, { submit: store.submit });
  try {
    form.model.setValue(fieldId, 'Retained value');
    assert.equal(await form.submit(), false);
    const nonce = persisted.SubmissionId;
    assert.ok(host.textContent.includes(nonce));
    assert.equal(form.getValues()[fieldId], 'Retained value');
    assert.equal(posts, 1);
    incomplete = false;
    assert.equal(await form.submit(), true);
    assert.equal(persisted.SubmissionId, nonce);
    assert.equal(posts, 1);
  } finally { form.dispose(); host.remove(); }
});

test('separate selected webs with identical list IDs keep all definition and response requests on their own web', async () => {
  for (const webUrl of ['https://tenant.sharepoint.com/sites/review', 'https://tenant.sharepoint.com/sites/other', 'https://second.sharepoint.us/teams/review']) {
    const calls = [];
    const store = adapter(async (url, options) => {
      calls.push({ url, method: options.method });
      assert.ok(url.startsWith(`${webUrl}/_api/web/lists(`));
      assert.doesNotMatch(url, /roleassignments|breakroleinheritance|resetroleinheritance/i);
      return options.method === 'POST' ? reply(201, { Id: 2 }) : reply(200, { value: url.includes(definitionListId) ? [definitionItem()] : [] });
    }, webUrl);
    assert.deepEqual(await store.submit(payload), { status: 'saved', submissionId });
    assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  }
});
