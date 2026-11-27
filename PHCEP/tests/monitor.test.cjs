'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { appsScriptUrl, checkGateway, checkAppsScript, retry } = require('../workflow/monitor.cjs');

const url = 'https://script.google.com/macros/s/TEST/exec';

test('only accepts a canonical Google web app URL', () => {
  assert.equal(appsScriptUrl(url), url);
  for (const invalid of ['', 'https://evil.example/macros/s/TEST/exec',
    'https://script.google.com/macros/s/TEST/dev',
    `${url}?secret=x`, 'https://user@script.google.com/macros/s/TEST/exec'])
    assert.throws(() => appsScriptUrl(invalid));
});

test('gateway check rejects failures and malformed health responses', async () => {
  await checkGateway(async () => new Response('{"ok":true}'));
  for (const response of [new Response('{"ok":true}', { status: 503 }),
    new Response('{"ok":false}'), new Response('not json')])
    await assert.rejects(checkGateway(async () => response));
});

test('Google probe sends no events and follows only trusted result redirects', async () => {
  const calls = [];
  await checkAppsScript(url, async (target, options) => {
    calls.push([target, options]);
    return calls.length === 1 ?
      new Response(null, { status: 302, headers: {
        location: 'https://script.googleusercontent.com/macros/echo?result=synthetic'
      } }) : new Response('{"ok":false,"error":"INVALID_ENVELOPE"}');
  });
  assert.equal(calls[0][1].body, '{}');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[1][1].method, 'GET');
  assert.equal(calls[1][1].body, undefined);
  await assert.rejects(checkAppsScript(url, async () =>
    new Response(null, { status: 302, headers: { location: 'https://evil.example/macros/echo' } })));
});

test('Google 403, configuration errors, and unexpected responses fail the probe', async () => {
  for (const response of [new Response('Access denied', { status: 403 }),
    new Response('{"ok":false,"error":"CONFIGURATION"}'),
    new Response('{"ok":true}'), new Response('not json')])
    await assert.rejects(checkAppsScript(url, async () => response));
});

test('transient failures retry, and persistent failures are not hidden', async () => {
  let count = 0;
  assert.deepEqual(await retry(async () => {
    if (++count < 3) throw new Error('private');
  }, async () => {}), { ok: true });
  assert.equal(count, 3);
  count = 0;
  assert.deepEqual(await retry(async () => {
    count++;
    throw new Error('private');
  }, async () => {}), { ok: false, reason: 'NETWORK_OR_INVALID_RESPONSE' });
  assert.equal(count, 3);
});

test('persistent Google 403 is reported without the response body', async () => {
  const result = await retry(() => checkAppsScript(url, async () =>
    new Response('synthetic-private', { status: 403 })), async () => {});
  assert.deepEqual(result, { ok: false, reason: 'GOOGLE_HTTP_403' });
});
