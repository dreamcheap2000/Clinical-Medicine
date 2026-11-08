'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { Store } = require('../store.cjs');
const { createApp } = require('../server.cjs');
const { vault, hash, random, configuration, receiverUrl } = require('../core.cjs');
const { Google } = require('../google.cjs');
const schema = require('../sheet-schema.cjs');

const extension = 'a'.repeat(32);
const config = { origin: 'https://nhi-workflow.example', extensionIds: [extension],
  clientId: 'synthetic.apps.googleusercontent.com', clientSecret: 'synthetic-only',
  clinicalEnabled: true };
const secrets = vault(crypto.randomBytes(32));
let db, store, server, base, clinics, tokens, calls, provisioningCalls;
const actors = [{ subject: 'owner-a', email: 'a@example.test' },
  { subject: 'owner-b', email: 'b@example.test' }, { subject: 'member', email: 'member@example.test' }];
test.before(async () => {
  db = new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  const pool = { query: (...args) => db.query(...args), connect: async () => ({
    query: (...args) => db.query(...args), release() {}
  }) };
  store = new Store(pool);
  tokens = actors.map(() => random());
  for (let i = 0; i < actors.length; i++) {
    await store.query('INSERT INTO nhi_users VALUES($1,$2,$3)',
      [actors[i].subject, actors[i].email, secrets.seal({ refresh_token: 'synthetic' }, 'google:' + actors[i].subject)]);
    await store.query("INSERT INTO nhi_sessions VALUES($1,$2,now()+interval '8 hours')",
      [hash(tokens[i]), actors[i].subject]);
  }
  clinics = [crypto.randomUUID(), crypto.randomUUID()];
  for (let i = 0; i < clinics.length; i++) {
    await store.query(`INSERT INTO nhi_clinics(id,name,owner_subject,sheet_id,receiver_url,signing_key,ready)
      VALUES($1,$2,$3,$4,$5,$6,true)`, [clinics[i], 'Synthetic clinic ' + i, actors[i].subject,
      'synthetic-sheet-' + i, 'https://script.google.com/macros/s/synthetic-' + i + '/exec',
      secrets.seal('synthetic-key-' + i, 'clinic:' + clinics[i])]);
    await store.query("INSERT INTO nhi_members VALUES($1,$2,$3,'admin')",
      [clinics[i], actors[i].email, actors[i].subject]);
  }
  calls = []; provisioningCalls = [];
  const transport = {
    health: async (url, key) => ({ success: true, schemaVersion: 1,
      sheetId: url.includes('wrong') ? 'wrong-sheet' : 'synthetic-sheet-0' }),
    backend: (url, key) => {
      calls.push({ url, key });
      return {
        pending: async () => ({ success: true, patient: { rowId: 1, patientId: url.includes('synthetic-0') ? 'A100000002' : 'B100000002' } }),
        complete: async () => ({ success: true }),
        preview: async () => ({ success: true, existingCount: 0, sameVisitExists: false,
          previousVisitDate: null, suggestedEnrollmentDate: null, previewToken: 'a'.repeat(43) + '=' }),
        extract: async () => ({ success: true, rowId: 2, workflowStatus: 'DRAFT' })
      };
    }
  };
  const google = {
    clientFor: async user => user,
    owns: async (client, user, id) => { provisioningCalls.push('owns:' + id); },
    validateSheet: async (client, id) => { provisioningCalls.push('validate:' + id); },
    createSheet: async (client, user, clinic) => {
      provisioningCalls.push('create:' + clinic.id); return 'new-synthetic-' + clinic.id;
    },
    initialize: async (client, id) => { provisioningCalls.push('initialize:' + id); }
  };
  server = createApp(config, store, google, secrets, transport).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (db) await db.close();
});
async function request(route, actor = 0, clinic, method = 'GET', body, extra = {}) {
  const headers = { ...extra };
  if (actor !== null) headers.Authorization = 'Bearer ' + tokens[actor];
  if (clinic) headers['X-NHI-Clinic'] = clinic;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + route, { method, headers, redirect: 'manual',
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
test('authentication rejects missing, expired and revoked credentials; origin is exact', async () => {
  assert.equal((await request('/api/me', null)).status, 401);
  assert.equal((await request('/api/me', 0, null, 'GET', undefined,
    { Origin: 'https://malicious.example' })).status, 403);
  assert.equal((await request('/api/me', 0, null, 'GET', undefined,
    { Origin: 'chrome-extension://' + extension })).status, 200);
  const token = random();
  await store.query("INSERT INTO nhi_sessions VALUES($1,$2,now()-interval '1 second')", [hash(token), actors[0].subject]);
  await assert.rejects(store.session(token), { code: 'SESSION_EXPIRED' });
});
test('both clinics can read their own pending row but cannot access the other clinic via any patient operation', async () => {
  const start = calls.length;
  for (const [name, method, body] of [
    ['pending', 'GET', undefined], ['complete', 'POST', { rowId: 1 }],
    ['preview', 'POST', { patient: { patientId: 'A100000002' } }],
    ['extract', 'POST', { patient: { patientId: 'A100000002' }, requestId: crypto.randomUUID(),
      previewToken: 'a'.repeat(43) + '=', useSuggestedEnrollmentDate: false }]
  ]) {
    for (const actor of [0, 1]) {
      const rejected = await request('/api/clinic/' + name, actor, clinics[1 - actor], method, body);
      assert.equal(rejected.status, 404);
      assert.equal(rejected.body.error, 'WORKSPACE_NOT_FOUND');
    }
  }
  assert.equal(calls.length, start, 'no unauthorized request reaches either receiver');
  assert.equal((await request('/api/clinic/pending', 0, clinics[0])).body.patient.patientId, 'A100000002');
  assert.equal((await request('/api/clinic/pending', 1, clinics[1])).body.patient.patientId, 'B100000002');
  assert.equal(calls.at(-2).key, 'synthetic-key-0');
  assert.equal(calls.at(-1).key, 'synthetic-key-1');
  assert.equal((await request('/api/me', 0)).body.clinics.length, 1);
});
test('invitation is identity-bound, role-limited and revocation takes effect on the next request', async () => {
  assert.equal((await request('/api/clinic/pending', 2, clinics[0])).status, 404);
  assert.equal((await request('/api/clinic/members', 0, clinics[0], 'POST',
    { email: actors[2].email, role: 'clinician' })).status, 200);
  assert.equal((await request('/api/clinic/pending', 2, clinics[0])).status, 200);
  for (const [route, method, body] of [
    ['setup-key', 'POST', {}], ['members', 'GET', undefined],
    ['receiver', 'POST', { url: 'https://script.google.com/macros/s/synthetic/exec' }],
    ['sheet', 'POST', {}]
  ]) assert.equal((await request('/api/clinic/' + route, 2, clinics[0], method, body)).status, 403);
  assert.equal((await request('/api/clinic/members', 0, clinics[0], 'DELETE', { email: actors[2].email })).status, 200);
  assert.equal((await request('/api/clinic/pending', 2, clinics[0])).status, 404);
});
test('owner role cannot be removed or demoted; workspace headers are mandatory', async () => {
  assert.equal((await request('/api/clinic/members', 0, clinics[0], 'DELETE', { email: actors[0].email })).status, 409);
  assert.equal((await request('/api/clinic/members', 0, clinics[0], 'POST',
    { email: actors[0].email, role: 'clinician' })).status, 409);
  assert.equal((await request('/api/clinic/pending', 0)).status, 400);
});
test('receiver setup proves both shared key and sheet identity before activation', async () => {
  const old = await store.one('SELECT receiver_url FROM nhi_clinics WHERE id=$1', [clinics[0]]);
  assert.equal((await request('/api/clinic/receiver', 0, clinics[0], 'POST',
    { url: 'https://script.google.com/macros/s/wrong/exec' })).status, 409);
  assert.equal((await store.one('SELECT receiver_url FROM nhi_clinics WHERE id=$1', [clinics[0]])).receiver_url, old.receiver_url);
  assert.equal((await request('/api/clinic/receiver', 0, clinics[0], 'POST',
    { url: 'https://attacker.example/macros/s/synthetic/exec' })).status, 400);
  assert.throws(() => receiverUrl('https://script.google.com/macros/s/id/exec?secret=bad'), { code: 'INVALID_RECEIVER_URL' });
});
test('Sheet provisioning is idempotent, clinic-isolated and cannot swap an established target', async () => {
  const created = await request('/api/clinics', 0, null, 'POST', { name: 'Synthetic new clinic' });
  assert.equal(created.status, 201);
  const id = created.body.id;
  const first = await request('/api/clinic/sheet', 0, id, 'POST', {});
  assert.equal(first.status, 200);
  assert.equal((await request('/api/clinic/sheet', 0, id, 'POST', {})).body.sheetId, first.body.sheetId);
  assert.equal(provisioningCalls.filter(x => x === 'create:' + id).length, 1);
  assert.equal((await request('/api/clinic/sheet', 0, id, 'POST', { sheetId: 'different-synthetic' })).status, 409);
  assert.equal((await request('/api/clinic/sheet', 1, id, 'POST', {})).status, 404);
});
test('malformed data never reaches a receiver; audit contains actions, not patient text or tokens', async () => {
  const start = calls.length;
  assert.equal((await request('/api/clinic/complete', 0, clinics[0], 'POST', { rowId: 0 })).status, 400);
  assert.equal((await request('/api/clinic/preview', 0, clinics[0], 'POST',
    { patient: { patientId: 'A100000002', name: '=IMPORTXML("bad")' } })).status, 400);
  assert.equal(calls.length, start);
  assert.equal((await request('/api/clinic/extract', 0, clinics[0], 'POST', {
    patient: { patientId: 'A100000002', name: 'SYNTHETIC ONLY' }, requestId: crypto.randomUUID(),
    previewToken: 'a'.repeat(43) + '=', useSuggestedEnrollmentDate: false
  })).status, 200);
  const audit = JSON.stringify((await store.query('SELECT * FROM nhi_audit')).rows);
  assert.ok(!audit.includes('SYNTHETIC ONLY') && !audit.includes('A100000002') && !audit.includes(tokens[0]));
});
test('one-time OAuth exchange requires the original PKCE verifier and cannot be replayed', async () => {
  const verifier = random(), code = random();
  await store.query("INSERT INTO nhi_auth_codes VALUES($1,$2,$3,now()+interval '1 minute')",
    [hash(code), actors[0].subject, hash(verifier)]);
  const bad = await request('/auth/exchange', null, null, 'POST', { code, verifier: random() });
  assert.equal(bad.status, 401);
  const good = await request('/auth/exchange', null, null, 'POST', { code, verifier });
  assert.equal(good.status, 200);
  assert.equal((await store.session(good.body.token)).subject, actors[0].subject);
  assert.equal((await request('/auth/exchange', null, null, 'POST', { code, verifier })).status, 401);
  const revoked = await fetch(base + '/api/logout', { method: 'POST',
    headers: { Authorization: 'Bearer ' + good.body.token } });
  assert.equal(revoked.status, 200);
  await assert.rejects(store.session(good.body.token), { code: 'SESSION_EXPIRED' });
});
test('encrypted credentials are authenticated to their clinic and never stored as plaintext', async () => {
  const encoded = secrets.seal('synthetic-key', 'clinic:a');
  assert.equal(secrets.open(encoded, 'clinic:a'), 'synthetic-key');
  assert.ok(!encoded.includes('synthetic-key'));
  assert.throws(() => secrets.open(encoded, 'clinic:b'), { code: 'CREDENTIAL_DECRYPTION_FAILED' });
  const tampered = Buffer.from(encoded, 'base64'); tampered[30] ^= 1;
  assert.throws(() => secrets.open(tampered.toString('base64'), 'clinic:a'), { code: 'CREDENTIAL_DECRYPTION_FAILED' });
});
test('production clinical-data gate prevents every patient route, not only the UI', async () => {
  const start = calls.length;
  const app = createApp({ ...config, clinicalEnabled: false }, store, {}, secrets, {
    backend() { throw new Error('must not reach backend'); }
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => app.once('listening', resolve));
  try {
    for (const name of ['pending', 'complete', 'preview', 'extract']) {
      const response = await fetch('http://127.0.0.1:' + app.address().port + '/api/clinic/' + name,
        { method: name === 'pending' ? 'GET' : 'POST',
          headers: { Authorization: 'Bearer ' + tokens[0], 'X-NHI-Clinic': clinics[0] } });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error, 'CLINICAL_DATA_NOT_APPROVED');
    }
  } finally { await new Promise(resolve => app.close(resolve)); }
  assert.equal(calls.length, start);
});
test('Google Sheet initialization preserves existing content and refuses changed headers', async () => {
  const google = new Google(config, store, secrets), requests = [];
  google.request = async (client, url, method, body) => {
    requests.push({ method, body });
    if (url.includes('?fields=sheets')) return { sheets: [{ properties: { title: schema.tab, sheetId: 0 } }] };
    return { values: [schema.headers] };
  };
  await google.initialize({}, 'synthetic');
  assert.equal(requests.length, 2);
  assert.ok(requests.every(r => !r.method), 'compatible existing sheets are not reformatted or overwritten');
  google.request = async (client, url) => url.includes('?fields=sheets') ?
    { sheets: [{ properties: { title: schema.tab, sheetId: 0 } }] } : { values: [['unexpected-header']] };
  await assert.rejects(google.initialize({}, 'synthetic'), { code: 'SHEET_SCHEMA_MISMATCH' });
});
test('deployment configuration rejects placeholders and unsafe origins', () => {
  assert.throws(() => configuration({}), { code: 'CONFIGURATION_REQUIRED' });
  assert.throws(() => configuration({ PUBLIC_ORIGIN: 'https://host.example/path', DATABASE_URL: 'postgresql://synthetic',
    DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), GOOGLE_CLIENT_ID: 'synthetic',
    GOOGLE_CLIENT_SECRET: 'synthetic', EXTENSION_IDS: extension }), { code: 'INVALID_PUBLIC_ORIGIN' });
});
test('Google OAuth callback rejects a wrong nonce and exchanges only a verified identity for a one-use code', async () => {
  let identity = { sub: 'synthetic-oauth-owner', email: 'oauth@example.test', email_verified: true, nonce: 'wrong' };
  let audience;
  const google = { client: () => ({
    getToken: async options => {
      assert.equal(options.codeVerifier, 'synthetic-google-verifier');
      return { tokens: { id_token: 'synthetic-id-token', refresh_token: 'synthetic-refresh-token' } };
    },
    verifyIdToken: async options => { audience = options.audience; return { getPayload: () => identity }; }
  }) };
  const app = createApp(config, store, google, secrets).listen(0, '127.0.0.1');
  await new Promise(resolve => app.once('listening', resolve));
  const callback = 'http://127.0.0.1:' + app.address().port + '/auth/callback';
  const addState = async state => store.query(`INSERT INTO nhi_auth_states
    VALUES($1,$2,$3,$4,$5,now()+interval '5 minutes')`, [hash(state),
    secrets.seal('synthetic-google-verifier', 'oauth:' + hash(state)), 'expected-nonce', extension, hash('synthetic-challenge')]);
  try {
    const badState = random();
    await addState(badState);
    const bad = await fetch(callback + '?state=' + badState + '&code=synthetic', { redirect: 'manual' });
    assert.equal(bad.status, 401);
    assert.equal((await bad.json()).error, 'GOOGLE_IDENTITY_REJECTED');
    identity = { ...identity, nonce: 'expected-nonce' };
    const goodState = random();
    await addState(goodState);
    const good = await fetch(callback + '?state=' + goodState + '&code=synthetic', { redirect: 'manual' });
    assert.equal(good.status, 302);
    assert.equal(audience, config.clientId);
    const location = new URL(good.headers.get('location'));
    assert.equal(location.origin, 'https://' + extension + '.chromiumapp.org');
    assert.equal(location.pathname, '/nhi');
    assert.match(location.hash, /^#code=[A-Za-z0-9_-]{43}$/);
    assert.equal((await fetch(callback + '?state=' + goodState + '&code=synthetic', { redirect: 'manual' })).status, 401);
    const user = await store.one('SELECT credentials FROM nhi_users WHERE subject=$1', [identity.sub]);
    assert.ok(!user.credentials.includes('synthetic-refresh-token'));
  } finally { await new Promise(resolve => app.close(resolve)); }
});
