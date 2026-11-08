'use strict';
const crypto = require('node:crypto');
const { fail } = require('./core.cjs');
const { appsScriptBackend } = require('../gateway/patient-api.cjs');

async function health(url, signingSecret, fetcher = fetch) {
  const envelope = { version: 1, action: 'patient.health', timestamp: Date.now(),
    nonce: crypto.randomUUID(), rawBody: Buffer.from('{}').toString('base64') };
  envelope.signature = crypto.createHmac('sha256', signingSecret)
    .update(`1\n${envelope.action}\n${envelope.timestamp}\n${envelope.nonce}\n${envelope.rawBody}`).digest('base64');
  const signal = AbortSignal.timeout(30000);
  let response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope), redirect: 'manual', signal });
  if ([302, 303].includes(response.status)) {
    let location;
    try { location = new URL(response.headers.get('location')); } catch { fail(502, 'RECEIVER_REDIRECT_REJECTED'); }
    if (location.protocol !== 'https:' || location.hostname !== 'script.googleusercontent.com' ||
        location.port || location.username || location.password || location.hash ||
        location.pathname !== '/macros/echo') fail(502, 'RECEIVER_REDIRECT_REJECTED');
    response = await fetcher(location.href, { redirect: 'error', signal });
  }
  if (!response.ok) fail(502, 'RECEIVER_ACCESS_REQUIRED');
  let text = '';
  for await (const chunk of response.body) {
    text += Buffer.from(chunk).toString('utf8');
    if (text.length > 4096) fail(502, 'RECEIVER_RESPONSE_TOO_LARGE');
  }
  let result;
  try { result = JSON.parse(text); } catch { fail(502, 'RECEIVER_INVALID_RESPONSE'); }
  if (result.success !== true || result.schemaVersion !== 1 ||
      typeof result.sheetId !== 'string') fail(502, 'RECEIVER_NOT_READY');
  return result;
}
module.exports = { health, backend: (url, signingSecret) => appsScriptBackend({ url, signingSecret }) };
