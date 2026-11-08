'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { build } = require('../build.cjs');

const origin = 'https://nhi-workflow.example';
const extension = 'a'.repeat(32);
function worker() {
  const state = { auth: { token: 'synthetic-secret-in-worker-only', expiresAt: Date.now() + 60000 },
    clinicId: 'clinic-a' };
  const requests = [];
  const chrome = {
    storage: { session: {
      get: async key => key === null ? { ...state } : { [key]: state[key] },
      set: async values => Object.assign(state, values),
      clear: async () => { for (const key of Object.keys(state)) delete state[key]; },
      remove: async keys => { for (const key of keys) delete state[key]; }
    } },
    runtime: { id: extension, getURL: file => 'chrome-extension://' + extension + '/' + file,
      onMessage: { addListener() {} }, openOptionsPage: async () => {} },
    tabs: { query: async () => [], sendMessage: async () => {}, onRemoved: { addListener() {} } }
  };
  const context = vm.createContext({
    chrome, console, URL, URLSearchParams, AbortSignal, Date, TextEncoder, Uint8Array,
    crypto: webcrypto, importScripts() {}, btoa: value => Buffer.from(value, 'binary').toString('base64'),
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => url.endsWith('/api/me') ?
        { success: true, clinics: [{ id: 'clinic-a', ready: true }], clinicalEnabled: true } :
        { success: true, patient: null } };
    }
  });
  vm.runInContext("const NHI_ORIGIN = '" + origin + "';\n" +
    fs.readFileSync(path.join(__dirname, '..', 'extension', 'background.js'), 'utf8'), context);
  const invoke = (message, sender) => context.handle(message, sender);
  return { state, requests, invoke };
}
const patient = { id: extension, tab: { id: 12 },
  url: 'https://medvpn.nhi.gov.tw/qmue1000/QMUE1002S01.aspx' };
const settings = { id: extension, url: 'chrome-extension://' + extension + '/options.html' };
test('background bootstrap never returns bearer token or clinic signing key to content script', async () => {
  const w = worker();
  const result = await w.invoke({ type: 'bootstrap' }, patient);
  assert.equal(result.clinicId, 'clinic-a');
  assert.ok(!JSON.stringify(result).includes(w.state.auth.token));
  assert.ok(!Object.hasOwn(result, 'token'));
});
test('content scripts cannot invoke settings, reveal keys or use a different workspace', async () => {
  const w = worker();
  await assert.rejects(w.invoke({ type: 'api', path: '/api/clinic/setup-key', method: 'POST' }, patient),
    /SETUP_PAGE_REQUIRED/);
  await assert.rejects(w.invoke({ type: 'patient', path: '/api/complete', method: 'POST',
    clinicId: 'clinic-b', body: { rowId: 1 } }, patient), /WORKSPACE_CHANGED/);
  await assert.rejects(w.invoke({ type: 'patient', path: '/api/clinic/setup-key', method: 'POST',
    clinicId: 'clinic-a' }, patient), /PATIENT_OPERATION_REJECTED/);
  assert.equal(w.requests.length, 0);
});
test('patient requests send only the selected clinic and worker-held token to the fixed backend', async () => {
  const w = worker();
  await w.invoke({ type: 'patient', path: '/api/pending', method: 'GET', clinicId: 'clinic-a' }, patient);
  assert.equal(w.requests[0].url, origin + '/api/clinic/pending');
  assert.equal(w.requests[0].options.headers['X-NHI-Clinic'], 'clinic-a');
  assert.equal(w.requests[0].options.headers.Authorization, 'Bearer ' + w.state.auth.token);
  assert.equal(w.requests[0].options.redirect, 'error');
  await assert.rejects(w.invoke({ type: 'bootstrap' }, { ...patient,
    url: 'https://medvpn.nhi.gov.tw/another-page' }), /EXTENSION_SENDER_REJECTED/);
});
test('switching clinic and forgetting login clear tab patient cache; expired sessions are unusable', async () => {
  const w = worker();
  w.state['tab:12:clinic-a'] = { patient: 'SYNTHETIC' };
  await w.invoke({ type: 'selectClinic', id: 'clinic-a' }, settings);
  assert.ok(!w.state['tab:12:clinic-a']);
  w.state.auth.expiresAt = 0;
  await assert.rejects(w.invoke({ type: 'bootstrap' }, patient), /LOGIN_REQUIRED/);
  await w.invoke({ type: 'forget' }, settings);
  assert.deepEqual(w.state, {});
});
test('packaging is reproducible from reviewed userscript; no embedded credentials or old backend; exact host permissions', () => {
  const dest = build(origin);
  const manifest = JSON.parse(fs.readFileSync(path.join(dest, 'extension', 'manifest.json')));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, [origin + '/*',
    'https://medvpn.nhi.gov.tw/qmue1000/QMUE1002S01.aspx*']);
  const content = fs.readFileSync(path.join(dest, 'extension', 'content.js'), 'utf8');
  assert.ok(!/GM_getValue|GM_setValue|TOKEN_KEY|clinical-medicine\.onrender\.com/.test(content));
  assert.ok(!/Authorization: 'Bearer/.test(content));
  assert.ok(!/Reconfigure your token|@connect|Tampermonkey menu/.test(content));
  assert.match(content, /cph_txtLDLC/);
  assert.match(content, /function saveExtractedPatient/);
  assert.match(content, /function markComplete/);
  new vm.Script(content);
  const receiver = fs.readFileSync(path.join(dest, 'receiver', 'NhiPatientApi.gs'), 'utf8');
  assert.match(receiver, /patient.health/);
  assert.match(receiver, /nhiWithLock_/);
  assert.match(receiver, /REQUEST_ID_CONFLICT/);
  assert.throws(() => build('https://clinical-medicine.onrender.com'), /NEW HTTPS/);
});
