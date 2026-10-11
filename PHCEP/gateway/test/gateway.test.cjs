'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { verifyLine, envelope, configuration, delivery, forward, createServer } = require('../server.cjs');
const lineSecret = 'synthetic-line-key';
const signingSecret = 'synthetic-internal-key-for-tests-only';
const raw = Buffer.from('{"events":[{"webhookEventId":"test-event","type":"message","message":{"id":"test-message","text":"測試"}}]}');
const signature = value => crypto.createHmac('sha256', lineSecret).update(value).digest('base64');
const config = mode => ({ mode, lineSecret, signingSecret,
  url: mode === 'APPS_SCRIPT' ? 'https://script.google.com/macros/s/TEST/exec' : 'https://internal.example/internal/events' });

test('LINE exact raw bytes: valid, missing, invalid and whitespace tampering', () => {
  assert.equal(verifyLine(raw, signature(raw), lineSecret), true);
  for (const value of [undefined, '', 'bad', signature(Buffer.from('different'))])
    assert.equal(verifyLine(raw, value, lineSecret), false);
  assert.equal(verifyLine(Buffer.concat([raw, Buffer.from('\n')]), signature(raw), lineSecret), false);
});
test('canonical envelope preserves raw Unicode and event IDs', () => {
  const value = envelope(raw, signingSecret, 123, 'test-nonce');
  assert.deepEqual(Buffer.from(value.rawBody, 'base64'), raw);
  assert.equal(value.signature, crypto.createHmac('sha256', signingSecret)
    .update(`1\nevents\n123\ntest-nonce\n${value.rawBody}`).digest('base64'));
});
test('configuration rejects unsafe URLs, invalid mode and shared secrets', () => {
  const env = { LINE_CHANNEL_SECRET: lineSecret, GATEWAY_SIGNING_SECRET: signingSecret,
    PHCEP_APPS_SCRIPT_URL: config('APPS_SCRIPT').url };
  assert.equal(configuration(env).mode, 'APPS_SCRIPT');
  for (const url of ['http://script.google.com/macros/s/TEST/exec', 'https://evil.example/exec',
    'https://script.google.com:444/macros/s/TEST/exec',
    'https://script.google.com/macros/s/TEST/exec?secret=x'])
    assert.throws(() => configuration({ ...env, PHCEP_APPS_SCRIPT_URL: url }));
  assert.throws(() => configuration({ ...env, PHCEP_BACKEND_MODE: 'MIRROR' }));
  assert.throws(() => configuration({ ...env, LINE_CHANNEL_SECRET: signingSecret }));
});
test('both modes route once to their configured destination', async () => {
  for (const mode of ['APPS_SCRIPT', 'SPRING_BOOT']) {
    const calls = [];
    await forward(raw, config(mode), async (url, options) => {
      calls.push([url, JSON.parse(options.body)]);
      return new Response('{"ok":true}');
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], config(mode).url);
    assert.deepEqual(Buffer.from(calls[0][1].rawBody, 'base64'), raw);
  }
});
test('bounded retry creates fresh nonce and propagates HTTP/JSON failures', async () => {
  const nonces = [];
  await forward(raw, config('APPS_SCRIPT'), async (_url, options) => {
    nonces.push(JSON.parse(options.body).nonce);
    return nonces.length === 1 ? new Response('{"ok":false,"error":"BUSY"}') : new Response('{"ok":true}');
  }, async () => {});
  assert.equal(nonces.length, 2);
  assert.notEqual(nonces[0], nonces[1]);
  for (const result of [() => new Response('{}'), () => new Response('{"ok":false}'),
    () => new Response('{"ok":true,"error":null}'),
    () => new Response('{"ok":true}', { status: 503 }), () => new Response('invalid')]) {
    let count = 0;
    await assert.rejects(forward(raw, config('SPRING_BOOT'), async () => { count++; return result(); }, async () => {}));
    assert.equal(count, 2);
  }
});
test('Google result redirect GET only; rejects other hosts without forwarding secret', async () => {
  const calls = [];
  await delivery(config('APPS_SCRIPT'), envelope(raw, signingSecret), async (url, options) => {
    calls.push([url, options]);
    return calls.length === 1 ? new Response(null, { status: 302,
      headers: { location: 'https://script.googleusercontent.com/macros/echo?result=synthetic' } })
      : new Response('{"ok":true}');
  });
  assert.equal(calls[1][1].method, 'GET');
  assert.equal(calls[1][1].body, undefined);
  await assert.rejects(delivery(config('APPS_SCRIPT'), {}, async () => new Response(null,
    { status: 302, headers: { location: 'https://evil.example/' } })));
  await assert.rejects(delivery(config('APPS_SCRIPT'), {}, async () => new Response(null,
    { status: 302, headers: { location: 'https://script.googleusercontent.com/other-path' } })));
});
test('HTTP endpoint accepts signed empty verification and rejects invalid before side effects', async t => {
  let calls = 0;
  const server = createServer(config('APPS_SCRIPT'), async () => { calls++; return new Response('{"ok":true}'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/webhook`;
  const empty = Buffer.from('{"events":[]}');
  assert.equal((await fetch(url, { method: 'POST', body: empty,
    headers: { 'x-line-signature': signature(empty) } })).status, 200);
  assert.equal(calls, 1);
  for (const sig of ['', signature(raw)]) {
    assert.equal((await fetch(url, { method: 'POST', body: empty,
      headers: { 'x-line-signature': sig } })).status, 401);
  }
  assert.equal(calls, 1);
  const malformed = Buffer.from('{');
  assert.equal((await fetch(url, { method: 'POST', body: malformed,
    headers: { 'x-line-signature': signature(malformed) } })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', body: 'x'.repeat(1048577) })).status, 413);
});
test('HTTP delivery error returns non-2xx after bounded same-backend retries', async t => {
  let calls = 0;
  const server = createServer(config('APPS_SCRIPT'), async () => {
    calls++;
    return new Response('{"ok":false,"error":"ACCEPTANCE_FAILED"}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/webhook`, {
    method: 'POST', body: raw, headers: { 'x-line-signature': signature(raw) }
  });
  assert.equal(response.status, 502);
  assert.equal(calls, 2);
  assert.equal((await response.text()).includes('ACCEPTANCE_FAILED'), false);
});
