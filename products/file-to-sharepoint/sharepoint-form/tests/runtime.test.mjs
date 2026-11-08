import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let runtime;
before(async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://tenant.sharepoint.com/sites/review/' });
  for (const key of ['window', 'document', 'Document', 'ShadowRoot', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'getComputedStyle']) {
    globalThis[key] = typeof dom.window[key] === 'function' && key === 'getComputedStyle' ? dom.window[key].bind(dom.window) : dom.window[key];
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.ResizeObserver = window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  runtime = await import('../.artifacts/index.js').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
});

const field = (digit, kind, extra = {}) => ({ id: `f_${digit.repeat(16)}`, sourceName: '__proto__', kind, label: `${kind} field`, value: kind === 'checkbox' ? false : '', required: false, readOnly: false, ...extra });
export const definition = () => ({ version: 1, id: 'a'.repeat(64), title: '<img src=x onerror=alert(1)> Application', fields: [
  field('1', 'text', { required: true, label: '<script>alert(1)</script> Name' }),
  field('2', 'checkbox', { value: false, exportValue: 'Yes' }),
  field('3', 'choice', { choices: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] }),
  field('4', 'radio', { choices: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], value: 'yes' }),
  field('5', 'text', { value: 'Fixed', readOnly: true, geometry: { pageIndex: 1, rect: { x: 12, y: 10, width: 90, height: 20 } } })
] });

test('strict definition validation rejects executable/custom types, unsafe keys, duplicates and malformed metadata', () => {
  assert.equal(typeof runtime.validateDefinition, 'function', 'A definition validator must exist');
  const good = definition();
  assert.deepEqual(runtime.validateDefinition(good), good);
  const invalid = [
    { ...good, version: 2 }, { ...good, id: 'anything' },
    { ...good, fields: [field('1', 'html')] },
    { ...good, fields: [field('1', 'text', { id: '__proto__' })] },
    { ...good, fields: [good.fields[0], good.fields[0]] },
    { ...good, fields: [field('1', 'choice', { choices: [{ value: 'x', label: 'A' }, { value: 'x', label: 'B' }] })] },
    { ...good, fields: [field('1', 'text', { value: false })] },
    { ...good, fields: [field('1', 'checkbox', { value: 'Yes' })] },
    { ...good, fields: [field('1', 'text', { geometry: { pageIndex: -1, rect: { x: 1, y: 2, width: 3, height: 4 } } })] },
    { ...good, fields: [field('1', 'text', { onValueChanged: 'alert(1)' })] },
    { ...good, completedHtml: '<script>alert(1)</script>' }
  ];
  for (const bad of invalid) assert.throws(() => runtime.validateDefinition(bad), /Invalid/);
});

test('rejects prototype-bearing definitions and JSON exceeding SharePoint multiline storage before submission', () => {
  const inherited = Object.assign(Object.create({ untrusted: true }), definition());
  assert.throws(() => runtime.validateDefinition(inherited), /Invalid/);
  const large = { ...definition(), fields: [field('1', 'text', { value: 'x'.repeat(32700) }), field('2', 'text', { value: 'x'.repeat(32700) })] };
  assert.throws(() => runtime.validateDefinition(large), /63,999|63999/);
  const form = { ...definition(), fields: [field('1', 'text'), field('2', 'text')] };
  assert.throws(() => runtime.validateValues(form, { f_1111111111111111: 'x'.repeat(32700), f_2222222222222222: 'x'.repeat(32700) }), /63,999|63999/);
});

test('real SurveyJS renders safe interactive controls and submits typed safe-key values', async () => {
  assert.equal(typeof runtime.mountForm, 'function', 'A real form renderer must exist');
  const host = document.createElement('div'); document.body.append(host);
  const submissions = [];
  const form = runtime.mountForm(host, definition(), { submit: async payload => { submissions.push(payload); return { status: 'saved', submissionId: payload.submissionId }; } });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(host.querySelectorAll('script,img').length, 0, 'Source labels must stay text');
  assert.match(host.textContent, /<script>alert\(1\)<\/script> Name/);
  assert.ok(host.querySelector('input[type=text]'));
  assert.ok(host.querySelector('input[type=checkbox]'));
  assert.ok(host.querySelector('input[type=radio]'));
  assert.ok(form.model.getQuestionByName('f_3333333333333333'));
  assert.equal(await form.submit(), false, 'Required text blocks writing');
  assert.equal(submissions.length, 0);
  const text = host.querySelector('input[type=text]');
  text.value = 'Éva'; text.dispatchEvent(new window.Event('input', { bubbles: true })); text.dispatchEvent(new window.Event('change', { bubbles: true }));
  form.model.setValue('f_2222222222222222', true);
  form.model.setValue('f_3333333333333333', 'b');
  form.model.setValue('f_4444444444444444', 'no');
  form.model.setValue('f_5555555555555555', 'tamper');
  assert.equal(await form.submit(), true);
  assert.deepEqual(submissions[0].values, { f_1111111111111111: 'Éva', f_2222222222222222: true, f_3333333333333333: 'b', f_4444444444444444: 'no', f_5555555555555555: 'Fixed' });
  assert.match(submissions[0].submissionId, /^[0-9a-f-]{36}$/);
  assert.equal(submissions[0].formId, 'a'.repeat(64));
  assert.match(host.textContent, /saved/i);
  form.dispose(); host.remove();
});

test('failed or uncertain submission retains values and nonce until explicit retry confirms saved', async () => {
  assert.equal(typeof runtime.mountForm, 'function');
  const host = document.createElement('div'); document.body.append(host);
  let calls = 0; const submissions = [];
  const form = runtime.mountForm(host, definition(), { submit: async payload => { calls++; submissions.push(payload); if (calls === 1) throw new Error('Connection lost; check submission'); return { status: 'saved', submissionId: payload.submissionId }; } });
  form.model.setValue('f_1111111111111111', 'Retained');
  assert.equal(await form.submit(), false);
  assert.equal(calls, 1);
  assert.equal(form.getValues().f_1111111111111111, 'Retained');
  assert.match(host.textContent, /not confirmed/i);
  assert.equal(await form.submit(), true);
  assert.equal(submissions[0].submissionId, submissions[1].submissionId);
  form.dispose(); host.remove();
});
