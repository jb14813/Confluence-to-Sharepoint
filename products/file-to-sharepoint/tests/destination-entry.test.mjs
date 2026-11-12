import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SITE = 'https://tenant.sharepoint.com/sites/Review', OTHER = 'https://tenant.sharepoint.com/sites/Other';
const componentId = 'f104fa11-c9e8-43d6-8c5a-3f7b70f31ab1';
const runtimeAsset='https://tenant.sharepoint.com/sites/appcatalog/ClientSideAssets/form/form.js';
const definitionListId = '45bc5c89-20db-4890-93f0-bc91c36aed73', responseListId = 'a4b9d3d7-3fd5-437b-b071-bab06d358bc1';
const definition = { version: 1, id: 'd'.repeat(64), title: 'Prepared form', fields: [{ id: 'f_4444444444444444', sourceName: 'request', kind: 'text', label: 'Request', value: '', required: true, readOnly: false }] };
const formBlock = () => ({ type: 'form', formId: definition.id, definitionListId, responseListId });
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json;odata=nometadata' } });
const common = { Required: true, Hidden: false, ReadOnlyField: false, Indexed: false, EnforceUniqueValues: false };
const text = (InternalName, MaxLength, extra = {}) => ({ ...common, InternalName, TypeAsString: 'Text', FieldTypeKind: 2, MaxLength, ...extra });
const note = InternalName => ({ ...common, InternalName, TypeAsString: 'Note', FieldTypeKind: 3, RichText: false, AppendOnly: false });
let bundled;
before(async () => {
  // Capture the actual entry's pre-write hook. Forms/session validation and its transport stay real.
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/destination/index.js', import.meta.url))], bundle: true, write: false, format: 'iife', platform: 'browser', plugins: [{ name: 'outer-handler-harness', setup(builder) {
    builder.onResolve({ filter: /src\/transfer\/handler\.js$/ }, () => ({ path: 'handler', namespace: 'harness' }));
    builder.onResolve({ filter: /src\/sharepoint\/detect\.js$/ }, () => ({ path: 'detect', namespace: 'harness' }));
    builder.onLoad({ filter: /.*/, namespace: 'harness' }, args => ({ contents: args.path === 'handler' ?
      'export function createTransferHandler(options){globalThis.beforeImport=options.beforeImport;return async()=>({ok:true});}' :
      'export async function detectSharePointSite(){return {supported:true,kind:"sharepoint",siteUrl:globalThis.selectedSite};}' }));
  } }] });
  bundled = result.outputFiles[0].text;
});

function fixture() {
  const definitions = new Map([[SITE, []], [OTHER, []]]), calls = [];
  let listener, denyDefinitionReads = false, runtimePresent = true, denyAsset = false;
  const context = vm.createContext({ URL, AbortController, setTimeout, clearTimeout,
    location: { href: `${SITE}/SitePages/Home.aspx` }, selectedSite: SITE,
    chrome: { runtime: { id: 'extension', onMessage: { addListener(value) { listener = value; } } } },
    fetch: async (address, init = {}) => {
      if(address===runtimeAsset)return new Response('/* form runtime */',{status:denyAsset?403:200,headers:{'Content-Type':'application/javascript'}});
      const site = [SITE, OTHER].find(value => address.startsWith(`${value}/_api/`)); assert.ok(site, address);
      const url = new URL(address), resource = decodeURIComponent(url.pathname.slice(new URL(`${site}/_api/`).pathname.length));
      calls.push({ site, resource, method: init.method ?? 'GET' });
      if (resource === 'web/GetClientSideWebParts') return reply({ value: runtimePresent ? [{ Id: componentId, Manifest: JSON.stringify({ id: componentId, componentType: 'WebPart', manifestVersion: 2, loaderConfig:{internalModuleBaseUrls:[runtimeAsset.slice(0,runtimeAsset.lastIndexOf('/'))],entryModuleId:'form',scriptResources:{form:{type:'path',path:'form.js'}}} }) }] : [] });
      if (resource === 'contextinfo') return reply({ FormDigestValue: 'digest', FormDigestTimeoutSeconds: 1800 });
      const kind = resource.includes(definitionListId) ? 'definitions' : resource.includes(responseListId) ? 'responses' : null;
      if (resource === 'web/lists') {
        const selected = url.searchParams.get('$filter').includes('Definitions') ? 'definitions' : 'responses';
        return reply({ value: [metadata(selected)] });
      }
      assert.ok(kind, resource);
      if (resource.endsWith('/fields')) return reply({ value: fields(kind) });
      if (resource.endsWith('/items')) {
        if (init.method !== 'POST') return denyDefinitionReads ? reply({}, 403) : reply({ value: definitions.get(site) });
        definitions.get(site).push({ Id: 1, ...JSON.parse(init.body) }); return reply({ Id: 1 }, 201);
      }
      return reply(metadata(kind));
    }
  });
  function metadata(kind) {
    return { Id: kind === 'definitions' ? definitionListId : responseListId, Title: `File to SharePoint Form ${kind === 'definitions' ? 'Definitions' : 'Responses'}`, Description: `File to SharePoint form ${kind}; schema v1; component ${componentId}.`, BaseTemplate: 100, Hidden: false, ItemCount: 0 };
  }
  function fields(kind) {
    return [text('Title', 255), ...(kind === 'definitions' ? [text('FormId', 64, { Indexed: true, EnforceUniqueValues: true }), note('DefinitionJson')] : [text('SubmissionId', 36, { Indexed: true, EnforceUniqueValues: true }), text('FormId', 64, { Indexed: true }), { ...common, InternalName: 'DefinitionVersion', TypeAsString: 'Number', FieldTypeKind: 9, DisplayFormat: 0 }, note('ResponseJson')])];
  }
  vm.runInContext(bundled, context);
  return { context, calls, definitions, denyReads: () => { denyDefinitionReads = true; }, removeRuntime: () => { runtimePresent = false; }, revokeAsset: () => { denyAsset = true; },
    move: site => { context.selectedSite = site; context.location.href = `${site}/SitePages/Home.aspx`; },
    prepare: async () => {
      context.messageJson = JSON.stringify({ channel: 'file-form', action: 'prepare', siteUrl: context.selectedSite, definition });
      const message = vm.runInContext('globalThis.originalMessage=JSON.parse(messageJson)', context);
      const result = await new Promise(resolve => { assert.equal(listener(message, { id: 'extension' }, resolve), true); });
      assert.equal(result.ok, true, result.error?.message); return result.result;
    },
    before: (siteUrl, block = formBlock()) => context.beforeImport({ siteUrl, model: { blocks: [block] } }),
    writes: () => calls.filter(call => call.method === 'POST' && call.resource !== 'contextinfo') };
}

test('the prepared definition must still exist unchanged before the pre-write hook admits page or image work', async t => {
  for (const change of ['mutated', 'deleted', 'read-permission-lost']) {
    await t.test(change, async () => {
      const f = fixture(); await f.prepare(); assert.equal(f.writes().length, 1);
      if (change === 'mutated') f.definitions.get(SITE)[0].DefinitionJson = JSON.stringify({ ...definition, title: 'Unexpected edit' });
      if (change === 'deleted') f.definitions.set(SITE, []);
      if (change === 'read-permission-lost') f.denyReads();
      await assert.rejects(f.before(SITE), /definition|403|unavailable|match|immutable/i);
      assert.equal(f.writes().length, 1, 'The check itself cannot repair or overwrite a definition');
    });
  }
});

test('prepared context cannot cross webs even when cloned lists and immutable definition happen to have identical IDs', async () => {
  const f = fixture(); await f.prepare(); f.definitions.set(OTHER, structuredClone(f.definitions.get(SITE))); f.move(OTHER); f.calls.length = 0;
  await assert.rejects(f.before(OTHER), /prepared|site|selected/i);
  assert.equal(f.calls.length, 0, 'Reject stale prepared context before any request on the newly selected web');
});

test('a separately reviewed preparation on a second site binds there and does not permit reusing its context on the first site', async () => {
  const f = fixture(); await f.prepare(); f.move(OTHER); await f.prepare();
  await assert.doesNotReject(f.before(OTHER));
  assert.equal(f.writes().length, 2);
  f.move(SITE); f.calls.length = 0;
  await assert.rejects(f.before(SITE), /prepared|site|selected/i);
  assert.equal(f.calls.length, 0);
});

test('the reviewed definition snapshot is unaffected by later mutation of the preparation message', async () => {
  const f = fixture(); await f.prepare();
  vm.runInContext('originalMessage.definition.title="Changed after preparation"', f.context);
  await assert.doesNotReject(f.before(SITE));
  assert.equal(f.writes().length, 1);
});

test('removing the companion after preparation blocks the pre-write hook without repairing the site', async () => {
  const f = fixture(); await f.prepare(); f.removeRuntime();
  await assert.rejects(f.before(SITE), /runtime|installed/i);
  assert.equal(f.writes().length, 1);
});

test('changed form list references cannot reuse the prepared context', async () => {
  const f = fixture(); await f.prepare(); f.calls.length = 0;
  await assert.rejects(f.before(SITE, { ...formBlock(), responseListId: 'd4d4ae83-75db-4d4e-ab93-c63429999b47' }), /prepared/i);
  assert.equal(f.calls.length, 0);
});

test('revoked catalog script access after preparation stops the pre-write hook without repairing permissions',async()=>{
 const f=fixture();await f.prepare();assert.equal(f.writes().length,1);f.revokeAsset();
 await assert.rejects(f.before(SITE),{code:'form-runtime-inaccessible'});assert.equal(f.writes().length,1);
});
