import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const definition = { version: 1, id: 'b'.repeat(64), title: 'Imported equipment request', fields: [
  { id: 'f_1111111111111111', sourceName: '__proto__', kind: 'text', label: 'Your name', value: '', required: true, readOnly: false },
  { id: 'f_2222222222222222', sourceName: 'consent', kind: 'checkbox', label: 'I confirm the details', value: false, required: true, readOnly: false, exportValue: 'Yes' },
  { id: 'f_3333333333333333', sourceName: 'device', kind: 'choice', label: 'Equipment', value: '', choices: [{ value: 'laptop', label: 'Laptop' }, { value: 'monitor', label: 'Monitor' }], required: true, readOnly: false },
  { id: 'f_4444444444444444', sourceName: 'urgency', kind: 'radio', label: 'Priority', value: 'normal', choices: [{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }], required: true, readOnly: false },
  { id: 'f_5555555555555555', sourceName: 'ref', kind: 'text', label: 'Reference (read only)', value: 'REQ-001', required: true, readOnly: true, geometry: { pageIndex: 1, rect: { x: 10, y: 15, width: 120, height: 20 } } }
] };
const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'"><link rel="stylesheet" href="/dist/portable-form.css"><title>Form runtime local acceptance</title></head><body style="margin:24px;background:#edf3f6"><main id="form" style="max-width:850px;margin:auto"></main><script type="module" src="/harness.js"></script></body></html>`;
const harness = `import {mountForm} from '/dist/portable-form.js'; window.attempts=[]; window.form=mountForm(document.querySelector('#form'), ${JSON.stringify(definition)}, {submit:async payload=>{window.attempts.push(payload);if(window.attempts.length===1)throw new Error('Simulated connection loss');return {status:'saved',submissionId:payload.submissionId};}});`;
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end(html); return; }
    if (path === '/harness.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(harness); return; }
    if (!['/dist/portable-form.js', '/dist/portable-form.css'].includes(path)) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : 'application/javascript'); response.end(await readFile(`.${path}`));
  } catch { response.writeHead(500).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
  page.setDefaultTimeout(10000);
  const errors = []; const external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { if (new URL(route.request().url()).hostname !== '127.0.0.1') { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole('button', { name: 'Submit response' }).click();
  assert.equal(await page.evaluate(() => window.attempts.length), 0);
  await page.getByRole('textbox', { name: 'Your name' }).fill('Éva Example');
  await page.getByRole('checkbox', { name: 'I confirm the details' }).press('Space');
  await page.getByRole('combobox', { name: 'Equipment' }).press('ArrowDown');
  await page.getByRole('option', { name: 'Monitor', exact: true }).click();
  await page.getByRole('radio', { name: 'High', exact: true }).press('Space');
  await page.getByRole('button', { name: 'Submit response' }).click();
  await page.getByRole('button', { name: 'Check and retry submission' }).waitFor();
  assert.match(await page.locator('[role=status]').last().textContent(), /not confirmed/i);
  assert.equal(await page.evaluate(() => window.form.getValues().f_1111111111111111), 'Éva Example');
  await page.getByRole('button', { name: 'Check and retry submission' }).click();
  await page.getByRole('button', { name: 'Response saved' }).waitFor();
  const attempts = await page.evaluate(() => window.attempts);
  assert.equal(attempts.length, 2); assert.equal(attempts[0].submissionId, attempts[1].submissionId);
  assert.deepEqual(attempts[1].values, { f_1111111111111111: 'Éva Example', f_2222222222222222: true, f_3333333333333333: 'monitor', f_4444444444444444: 'high', f_5555555555555555: 'REQ-001' });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await mkdir('.artifacts', { recursive: true });
  await page.screenshot({ path: '.artifacts/form-runtime.png', fullPage: true });
  await writeFile('.artifacts/browser-smoke.json', JSON.stringify({ browser: await browser.version(), controls: ['text', 'checkbox', 'choice', 'radio', 'readOnly'], attempts, externalRequests: external, errors }, null, 2));
  console.log('PASS: Real Chrome controls, required/read-only fields, explicit nonce-preserving retry, no external requests or browser errors.');
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
