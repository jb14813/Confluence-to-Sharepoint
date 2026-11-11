import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFormReadiness, prepareForm, FORM_COMPONENT_ID } from '../src/destination/forms.js';

const SITE = 'https://tenant.sharepoint.com/sites/Review';
const definitionListId = '45bc5c89-20db-4890-93f0-bc91c36aed73';
const responseListId = 'a4b9d3d7-3fd5-437b-b071-bab06d358bc1';
const definition = { version: 1, id: 'c'.repeat(64), title: 'Access review', fields: [{ id: 'f_3333333333333333', sourceName: 'request', kind: 'text', label: 'Request', value: '', required: true, readOnly: false }] };
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json;odata=nometadata' } });
const common = { Required: true, Hidden: false, ReadOnlyField: false, Indexed: false, EnforceUniqueValues: false };
const text = (InternalName, MaxLength, extra = {}) => ({ ...common, InternalName, TypeAsString: 'Text', FieldTypeKind: 2, MaxLength, ...extra });
const note = InternalName => ({ ...common, InternalName, TypeAsString: 'Note', FieldTypeKind: 3, RichText: false, AppendOnly: false });
const installed = () => ({ Id: FORM_COMPONENT_ID, Manifest: JSON.stringify({ id: FORM_COMPONENT_ID, componentType: 'WebPart', manifestVersion: 2 }) });

// Owned lists are already provisioned; each explicit Send may store one immutable definition.
function fixture(siteUrl = SITE) {
  const calls = [], definitions = [];
  const state = { parts: [installed()], denyRead: undefined, denyDigest: false, denyWrite: false, loseCommit: false, denyAfterCommit: false };
  const lists = new Map([
    [definitionListId, { Id: definitionListId, Title: 'File to SharePoint Form Definitions', Description: `File to SharePoint form definitions; schema v1; component ${FORM_COMPONENT_ID}.`, BaseTemplate: 100, Hidden: false, ItemCount: 0,
      fields: [text('Title', 255), text('FormId', 64, { Indexed: true, EnforceUniqueValues: true }), note('DefinitionJson')] }],
    [responseListId, { Id: responseListId, Title: 'File to SharePoint Form Responses', Description: `File to SharePoint form responses; schema v1; component ${FORM_COMPONENT_ID}.`, BaseTemplate: 100, Hidden: false, ItemCount: 0,
      fields: [text('Title', 255), text('SubmissionId', 36, { Indexed: true, EnforceUniqueValues: true }), text('FormId', 64, { Indexed: true }), { ...common, InternalName: 'DefinitionVersion', TypeAsString: 'Number', FieldTypeKind: 9, DisplayFormat: 0 }, note('ResponseJson')] }]
  ]);
  const options = { siteUrl, definition, definitionListId, responseListId, request: async (address, init = {}) => {
    const url = new URL(address); assert.ok(address.startsWith(`${siteUrl}/_api/`));
    assert.equal(init.credentials, 'same-origin'); assert.equal(init.redirect, 'error');
    const resource = decodeURIComponent(url.pathname.slice(new URL(`${siteUrl}/_api/`).pathname.length));
    calls.push({ address, resource, method: init.method ?? 'GET' });
    if (state.denyRead?.test(resource) && init.method !== 'POST') return reply({}, 403);
    if (resource === 'web/GetClientSideWebParts') return reply({ value: state.parts });
    if (resource === 'contextinfo') return state.denyDigest ? reply({}, 403) : reply({ FormDigestValue: 'digest', FormDigestTimeoutSeconds: 1800 });
    const match = /^web\/lists\(guid'([^']+)'\)(.*)$/.exec(resource);
    assert.ok(match, `Unexpected request ${resource}`);
    const list = lists.get(match[1]); if (!list) return reply({}, 404);
    if (!match[2]) { const { fields, ...metadata } = list; return reply(metadata); }
    if (match[2] === '/fields') return reply({ value: list.fields });
    assert.equal(match[2], '/items');
    if (init.method !== 'POST') return reply({ value: definitions });
    if (state.denyWrite) return reply({}, 403);
    assert.equal(init.headers['X-RequestDigest'], 'digest');
    definitions.push({ Id: definitions.length + 1, ...JSON.parse(init.body) });
    if (state.loseCommit) { if (state.denyAfterCommit) state.denyRead = /\/items$/; throw new TypeError('Commit response lost'); }
    return reply({ Id: definitions.length }, 201);
  } };
  return { state, calls, definitions, options, writes: () => calls.filter(call => call.method === 'POST' && call.resource !== 'contextinfo') };
}

test('removed, duplicated or incompatible companions cannot reuse an earlier successful readiness check', async () => {
  for (const parts of [[], [installed(), installed()], [{ ...installed(), Manifest: '{invalid' }], [{ ...installed(), Manifest: JSON.stringify({ id: FORM_COMPONENT_ID, componentType: 'Library', manifestVersion: 2 }) }], [{ ...installed(), Manifest: JSON.stringify({ id: FORM_COMPONENT_ID, componentType: 'WebPart', manifestVersion: 1 }) }], [{ ...installed(), Manifest: JSON.stringify({ id: definitionListId, componentType: 'WebPart', manifestVersion: 2 }) }]]) {
    const f = fixture(); assert.equal((await checkFormReadiness(f.options)).needsSetup, false);
    f.state.parts = parts;
    await assert.rejects(prepareForm(f.options), /runtime|installed|incompatible|invalid/i);
    assert.equal(f.writes().length, 0);
    assert.equal(f.calls.some(call => call.resource === 'contextinfo'), false);
  }
});

test('revoked read permissions at runtime, list, field or definition lookup refuse Send before token or mutation', async () => {
  for (const denyRead of [/GetClientSideWebParts$/, /^web\/lists\(guid'[^']+'\)$/, /\/fields$/, /\/items$/]) {
    const f = fixture(); assert.equal((await checkFormReadiness(f.options)).needsSetup, false);
    f.state.denyRead = denyRead;
    await assert.rejects(prepareForm(f.options), /403/);
    assert.equal(f.writes().length, 0);
    assert.equal(f.calls.some(call => call.resource === 'contextinfo'), false);
  }
});

test('permission loss at request-token or definition POST stages cannot claim success or blindly retry writes', async () => {
  for (const deniedStage of ['denyDigest', 'denyWrite']) {
    const f = fixture(); await checkFormReadiness(f.options); f.state[deniedStage] = true;
    await assert.rejects(prepareForm(f.options), /403|not confirmed/i);
    assert.equal(f.writes().length, deniedStage === 'denyDigest' ? 0 : 1);
    assert.equal(f.definitions.length, 0);
    f.state[deniedStage] = false;
    assert.deepEqual(await prepareForm(f.options), { formId: definition.id, definitionListId, responseListId });
    assert.equal(f.definitions.length, 1);
  }
});

test('a committed definition whose confirmation is permission-blocked is reconciled by the next explicit Send without another POST', async () => {
  const f = fixture(); f.state.loseCommit = true; f.state.denyAfterCommit = true;
  await assert.rejects(prepareForm(f.options), /not confirmed/i);
  assert.equal(f.definitions.length, 1); assert.equal(f.writes().length, 1);
  await assert.rejects(prepareForm(f.options), /403/);
  assert.equal(f.writes().length, 1);
  f.state.denyRead = undefined;
  assert.deepEqual(await prepareForm(f.options), { formId: definition.id, definitionListId, responseListId });
  assert.equal(f.definitions.length, 1); assert.equal(f.writes().length, 1);
});

test('a tab moved to another web refuses old selected-site references before any request; explicit other-web setup stays on that web', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  try {
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: `${SITE}/SitePages/Home.aspx` } });
    const f = fixture(); await checkFormReadiness(f.options); f.calls.length = 0;
    globalThis.location.href = 'https://tenant.sharepoint.com/sites/Other/SitePages/Home.aspx';
    await assert.rejects(prepareForm(f.options), { code: 'target-changed' });
    assert.equal(f.calls.length, 0);
    const other = fixture('https://tenant.sharepoint.com/sites/Other');
    assert.deepEqual(await prepareForm(other.options), { formId: definition.id, definitionListId, responseListId });
    assert.ok(other.calls.every(call => call.address.startsWith('https://tenant.sharepoint.com/sites/Other/_api/')));
    assert.equal(other.writes().length, 1);
  } finally { if (original) Object.defineProperty(globalThis, 'location', original); else delete globalThis.location; }
});

test('a tab leaving during token acquisition stops before the first definition mutation', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  try {
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: `${SITE}/SitePages/Home.aspx` } });
    const f = fixture(), request = f.options.request;
    f.options.request = async (url, init) => {
      const result = await request(url, init);
      if (url.endsWith('/contextinfo')) globalThis.location.href = 'https://other.sharepoint.com/sites/Review/SitePages/Home.aspx';
      return result;
    };
    await assert.rejects(prepareForm(f.options), { code: 'target-changed' });
    assert.equal(f.writes().length, 0); assert.equal(f.definitions.length, 0);
  } finally { if (original) Object.defineProperty(globalThis, 'location', original); else delete globalThis.location; }
});
