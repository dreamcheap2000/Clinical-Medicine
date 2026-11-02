'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { configuration, createApp, sheetsBackend, appsScriptBackend, sheetRecords,
  columnName, validateResult } = require('../patient-api.cjs');

const token = 'synthetic-test-token-for-single-clinician-only';
const patient = { rowId: 123, patientId: 'TEST001', name: 'TEST PATIENT', birthday: '1960-01-01' };
const { createServer, configuration: lineConfiguration } = require('../server.cjs');

test('combined server preserves LINE webhook and isolates patient authorization', async t => {
  const lineSecret = 'synthetic-line-secret';
  let lineCalls = 0;
  let patientCalls = 0;
  const app = createApp({ token }, {
    pending: async () => { patientCalls++; return { success: true, patient }; }
  });
  const server = createServer({
    mode: 'APPS_SCRIPT', lineSecret,
    signingSecret: 'synthetic-distinct-line-signing-secret',
    url: 'https://script.google.com/macros/s/synthetic/exec'
  }, async () => { lineCalls++; return Response.json({ ok: true }); }, app)
    .listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.deepEqual(await (await fetch(base + '/healthz')).json(), { ok: true });
  assert.equal((await fetch(base + '/api/pending')).status, 401);
  assert.equal(lineCalls, 0);
  assert.equal(patientCalls, 0);
  assert.deepEqual(await (await fetch(base + '/api/pending', {
    headers: { Authorization: 'Bearer ' + token }
  })).json(), { success: true, patient });
  const raw = Buffer.from('{"events":[]}');
  const signature = crypto.createHmac('sha256', lineSecret).update(raw).digest('base64');
  assert.equal((await fetch(base + '/webhook', {
    method: 'POST', body: raw, headers: { 'x-line-signature': signature }
  })).status, 200);
  assert.equal(lineCalls, 1);
  assert.equal(patientCalls, 1);
  assert.equal((await fetch(base + '/webhook', {
    method: 'POST', body: raw, headers: { Authorization: 'Bearer ' + token }
  })).status, 401);
});

test('patient API is explicitly disabled without impacting LINE configuration', async t => {
  const env = {
    LINE_CHANNEL_SECRET: 'synthetic-line-secret',
    GATEWAY_SIGNING_SECRET: 'synthetic-distinct-line-signing-secret',
    PHCEP_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/synthetic/exec'
  };
  assert.equal(lineConfiguration(env).patientConfig, undefined);
  assert.throws(() => lineConfiguration({ ...env, PATIENT_API_ENABLED: 'true' }),
    /Patient API configuration invalid/);
  assert.throws(() => lineConfiguration({ ...env, PATIENT_API_ENABLED: 'yes' }));
  const server = createServer(lineConfiguration(env)).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/pending');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { success: false, error: 'PATIENT_API_DISABLED' });
});

async function running(t, backend) {
  const server = createApp({ token }, backend).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  return (path, options = {}) => fetch(url + path, options);
}

test('authorization runs before parsing or Google access; no-store responses', async t => {
  let calls = 0;
  const request = await running(t, {
    pending: async () => { calls++; return { success: true, patient }; },
    complete: async () => { calls++; return { success: true }; }
  });
  for (const authorization of [undefined, 'Bearer wrong', token, 'bearer ' + token]) {
    const headers = authorization ? { Authorization: authorization } : {};
    const response = await request('/api/pending', { headers });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const badBody = await request('/api/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{'
  });
  assert.equal(badBody.status, 401);
  assert.equal(calls, 0);
  const response = await request('/api/pending', { headers: { Authorization: 'Bearer ' + token } });
  assert.deepEqual(await response.json(), { success: true, patient });
  assert.equal(calls, 1);
});

test('completion validates exact rowId shape; empty queue and idempotent contract', async t => {
  const completed = [];
  const request = await running(t, {
    pending: async () => ({ success: true, patient: null }),
    complete: async rowId => { completed.push(rowId); return { success: true }; }
  });
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  for (const body of [{}, { rowId: '123' }, { rowId: -1 }, { rowId: 1.5 },
    { rowId: 123, patientId: 'extra' }]) {
    assert.equal((await request('/api/complete', {
      method: 'POST', headers, body: JSON.stringify(body)
    })).status, 400);
  }
  assert.equal(completed.length, 0);
  assert.equal((await request('/api/complete', { method: 'POST', headers, body: '{' })).status, 400);
  const result = await request('/api/complete', {
    method: 'POST', headers, body: JSON.stringify({ rowId: 123 })
  });
  assert.deepEqual(await result.json(), { success: true });
  assert.deepEqual(completed, [123]);
  assert.deepEqual(await (await request('/api/pending', { headers })).json(),
    { success: true, patient: null });
  assert.equal((await request('/api/pending?patientId=TEST', { headers })).status, 400);
});

test('upstream failures do not expose raw errors or return success', async t => {
  const request = await running(t, {
    pending: async () => { throw new Error('sensitive backend error'); },
    complete: async () => ({ success: false })
  });
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  assert.deepEqual(await (await request('/api/pending', { headers })).json(),
    { success: false, error: 'BACKEND_UNAVAILABLE' });
  assert.deepEqual(await (await request('/api/complete', {
    method: 'POST', headers, body: '{"rowId":123}'
  })).json(), { success: false, error: 'BACKEND_REJECTED' });
});

test('request body size is bounded before completion', async t => {
  let calls = 0;
  const request = await running(t, {
    pending: async () => ({ success: true, patient }),
    complete: async () => { calls++; return { success: true }; }
  });
  const response = await request('/api/complete', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowId: 123, extra: 'x'.repeat(3000) })
  });
  assert.equal(response.status, 413);
  assert.equal(calls, 0);
});

test('global prototype rate cap prevents unbounded unauthorized requests', async t => {
  let calls = 0;
  const request = await running(t, {
    pending: async () => { calls++; return { success: true, patient }; }
  });
  for (let i = 0; i < 60; i++) {
    assert.equal((await request('/api/pending')).status, 401);
  }
  assert.equal((await request('/api/pending')).status, 429);
  assert.equal(calls, 0);
});

test('projection excludes phone, unknown columns, secrets, and extra nested fields', () => {
  assert.deepEqual(validateResult({
    success: true, patient: { ...patient, phone: 'synthetic', secret: 'synthetic',
      history: { acuteCoronarySyndrome: false, unknown: true } }
  }, true), { success: true, patient: { ...patient, history: { acuteCoronarySyndrome: false } } });
  assert.throws(() => validateResult({ success: true }, true));
});

test('Sheets adapter reads pending but refuses unlocked writes', async () => {
  let status = 'PENDING';
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    if (options.method === 'PUT') {
      assert.deepEqual(JSON.parse(options.body).values, [['COMPLETE']]);
      assert.match(decodeURIComponent(url), /'Patients'!E2/);
      status = 'COMPLETE';
      return Response.json({ updatedCells: 1 });
    }
    return Response.json({ values: [
      ['rowId', 'patientId', 'name', 'birthday', 'workflowStatus'],
      [123, 'TEST001', 'TEST PATIENT', '1960-01-01', status]
    ] });
  };
  const auth = { getRequestHeaders: async () => new Headers({ Authorization: 'Bearer synthetic-google-token' }) };
  const backend = sheetsBackend({ sheetId: 'synthetic-sheet', tab: 'Patients' }, fetcher, auth);
  assert.deepEqual(await backend.pending(), { success: true, patient });
  await assert.rejects(backend.complete(123), /LOCKED_WRITER_REQUIRED/);
  await assert.rejects(backend.complete(999), /LOCKED_WRITER_REQUIRED/);
  assert.equal(requests.filter(request => request.options.method === 'PUT').length, 0);
  assert.equal(columnName(26), 'AA');
});

test('Sheets adapter skips DRAFT rows, serves the top-most PENDING row, refuses DRAFT completion', async () => {
  const writes = [];
  const fetcher = async (url, options) => {
    if (options.method === 'PUT') {
      writes.push(decodeURIComponent(url));
      return Response.json({ updatedCells: 1 });
    }
    return Response.json({ values: [
      ['rowId', 'patientId', 'name', 'birthday', 'workflowStatus', 'chartNo'],
      [7, 'TEST007', 'DRAFT PATIENT', '1960/01/01', 'DRAFT', 'SYN-7'],
      [9, 'TEST009', 'FIRST PENDING', '1961/02/02', 'PENDING', 'SYN-9'],
      [8, 'TEST008', 'SECOND PENDING', '1962/03/03', 'PENDING', 'SYN-8']
    ] });
  };
  const auth = { getRequestHeaders: async () => new Headers({ Authorization: '******' }) };
  const backend = sheetsBackend({ sheetId: 'synthetic-sheet', tab: 'Patients' }, fetcher, auth);
  assert.deepEqual(await backend.pending(), { success: true, patient: {
    rowId: 9, patientId: 'TEST009', name: 'FIRST PENDING', birthday: '1961/02/02' } });
  await assert.rejects(backend.complete(7), error => error.status === 503 &&
    error.code === 'LOCKED_WRITER_REQUIRED');
  assert.deepEqual(writes, []);
  await assert.rejects(backend.complete(8), /LOCKED_WRITER_REQUIRED/);
  assert.deepEqual(writes, []);
});

test('Sheets schema rejects duplicate IDs, headers, invalid statuses and boolean strings', () => {
  const headers = ['rowId', 'patientId', 'name', 'birthday', 'workflowStatus'];
  assert.throws(() => sheetRecords([headers, [123, '', '', '', 'PENDING'], [123, '', '', '', 'PENDING']]));
  assert.throws(() => sheetRecords([[...headers, 'rowId']]));
  assert.throws(() => sheetRecords([headers, [true, '', '', '', 'PENDING']]));
  assert.throws(() => sheetRecords([headers, [123, '', '', '', 'UNKNOWN']]));
  assert.throws(() => sheetRecords([[...headers, 'history.acuteCoronarySyndrome'],
    [123, '', '', '', 'PENDING', 'FALSE']]));
});

test('Apps Script envelope uses separate signing key and safe GET result redirect', async () => {
  const signingSecret = 'synthetic-separate-backend-signing-key';
  const calls = [];
  const backend = appsScriptBackend({
    url: 'https://script.google.com/macros/s/synthetic/exec', signingSecret
  }, async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      const envelope = JSON.parse(options.body);
      assert.equal(envelope.action, 'patient.pending');
      const canonical = `1\n${envelope.action}\n${envelope.timestamp}\n${envelope.nonce}\n${envelope.rawBody}`;
      assert.equal(envelope.signature,
        crypto.createHmac('sha256', signingSecret).update(canonical).digest('base64'));
      assert.equal(options.headers.Authorization, undefined);
      return new Response(null, { status: 302, headers: {
        location: 'https://script.googleusercontent.com/macros/echo?synthetic=1'
      } });
    }
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.equal(options.headers, undefined);
    return Response.json({ success: true, patient });
  });
  assert.deepEqual(await backend.pending(), { success: true, patient });
  const unsafe = appsScriptBackend({ url: 'https://script.google.com/macros/s/synthetic/exec', signingSecret },
    async () => new Response(null, { status: 302, headers: { location: 'https://example.invalid/' } }));
  await assert.rejects(unsafe.pending(), /GOOGLE_REDIRECT_REJECTED/);
});

test('configuration fails closed for placeholder tokens and invalid backend URLs', () => {
  assert.throws(() => configuration({ PATIENT_API_TOKEN: 'REPLACE_WITH_RANDOM_PROTOTYPE_CLINICIAN_TOKEN' }));
  assert.throws(() => configuration({ PATIENT_API_TOKEN: token, PATIENT_BACKEND: 'none' }));
  assert.throws(() => configuration({
    PATIENT_API_TOKEN: token, PATIENT_BACKEND: 'APPS_SCRIPT',
    PHCEP_PATIENT_APPS_SCRIPT_URL: 'https://example.invalid/',
    PATIENT_APPS_SCRIPT_SIGNING_SECRET: 'synthetic-separate-backend-signing-key'
  }));
});

test('reverse routes authorize, validate sparse payloads, project responses and reject unavailable writers', async t => {
  const sparse = { patientId: 'A100000002', ldlCMgDl: 0, history: { acuteCoronarySyndrome: false } };
  let previewCalls = 0;
  const previewToken = 'a'.repeat(43) + '=';
  const request = await running(t, {
    preview: async record => {
      previewCalls++;
      assert.deepEqual(record, sparse);
      return { success: true, existingCount: 2, sameVisitExists: false,
        previousVisitDate: '2026/11/01', suggestedEnrollmentDate: '2026/09/01',
        previewToken, secret: 'must-not-be-returned' };
    },
    extract: async body => {
      assert.deepEqual(body.patient, sparse);
      return { success: true, rowId: 321, workflowStatus: 'DRAFT', extra: 'excluded' };
    }
  });
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const post = (path, body, h = headers) => request(path, { method: 'POST', headers: h, body: JSON.stringify(body) });
  assert.equal((await post('/api/preview', { patient: sparse }, {})).status, 401);
  assert.equal(previewCalls, 0);
  for (const body of [
    { patient: { ...sparse, rowId: 1 } }, { patient: { patientId: 'invalid' } },
    { patient: { ...sparse, phone: 'not-allowed' } },
    { patient: { ...sparse, history: { acuteCoronarySyndrome: 'FALSE' } } }
  ]) {
    assert.equal((await post('/api/preview', body)).status, 400);
  }
  const preview = await (await post('/api/preview', { patient: sparse })).json();
  assert.equal(preview.existingCount, 2);
  assert.equal(preview.secret, undefined);
  const payload = {
    patient: sparse, previewToken, useSuggestedEnrollmentDate: true,
    requestId: 'synthetic-extraction-request-0001'
  };
  assert.deepEqual(await (await post('/api/extract', payload)).json(),
    { success: true, rowId: 321, workflowStatus: 'DRAFT' });
  assert.equal((await post('/api/extract', { ...payload, useSuggestedEnrollmentDate: 'yes' })).status, 400);
  const readOnly = await running(t, {});
  assert.equal((await readOnly('/api/preview', {
    method: 'POST', headers, body: JSON.stringify({ patient: sparse })
  })).status, 503);
});
