'use strict';
const http = require('node:http');
const crypto = require('node:crypto');

const MAX_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 16384;

function configuredUrl(value, mode) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Invalid backend URL');
  if (mode === 'APPS_SCRIPT' &&
      (url.hostname !== 'script.google.com' || url.port ||
       !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)))
    throw new Error('Invalid Apps Script URL');
  if (mode === 'SPRING_BOOT' && url.pathname !== '/internal/events')
    throw new Error('Invalid Spring endpoint');
  return url.href;
}

function configuration(env = process.env) {
  const mode = env.PHCEP_BACKEND_MODE || 'APPS_SCRIPT';
  if (!['APPS_SCRIPT', 'SPRING_BOOT'].includes(mode)) throw new Error('Invalid backend mode');
  const required = ['LINE_CHANNEL_SECRET', 'GATEWAY_SIGNING_SECRET',
    mode === 'APPS_SCRIPT' ? 'PHCEP_APPS_SCRIPT_URL' : 'PHCEP_SPRING_BOOT_URL'];
  const missing = required.filter(name => !env[name]);
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(', ')}`);
  if (env.GATEWAY_SIGNING_SECRET.length < 32 ||
      env.GATEWAY_SIGNING_SECRET === env.LINE_CHANNEL_SECRET)
    throw new Error('GATEWAY_SIGNING_SECRET must be distinct and at least 32 characters');
  return {
    mode, lineSecret: env.LINE_CHANNEL_SECRET, signingSecret: env.GATEWAY_SIGNING_SECRET,
    url: configuredUrl(env[required[2]], mode)
  };
}

function verifyLine(raw, signature, secret) {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const actual = Buffer.from(signature, 'base64');
  const expected = crypto.createHmac('sha256', secret).update(raw).digest();
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function envelope(raw, secret, now = Date.now(), nonce = crypto.randomUUID()) {
  const body = { version: 1, action: 'events', timestamp: now, nonce, rawBody: raw.toString('base64') };
  const canonical = `1\n${body.action}\n${body.timestamp}\n${body.nonce}\n${body.rawBody}`;
  body.signature = crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('base64');
  return body;
}

async function readBounded(stream, maximum) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maximum) throw new Error('Payload too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function backendErrorCode(result) {
  const code = result && typeof result === 'object' ? result.error : undefined;
  return typeof code === 'string' && /^[A-Z_]{1,40}$/.test(code) ? code : 'UNKNOWN';
}

async function delivery(config, body, fetcher = fetch) {
  const signal = AbortSignal.timeout(25000);
  let response = await fetcher(config.url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), redirect: 'manual', signal
  });
  // Apps Script ContentService redirects only the result; never re-post credentials.
  if (config.mode === 'APPS_SCRIPT' && [302, 303].includes(response.status)) {
    const location = new URL(response.headers.get('location'));
    if (location.protocol !== 'https:' || location.hostname !== 'script.googleusercontent.com' ||
        location.port || location.pathname !== '/macros/echo' ||
        location.username || location.password || location.hash)
      throw new Error('Untrusted redirect');
    response = await fetcher(location.href, { method: 'GET', redirect: 'error', signal });
  }
  if (!response.ok) {
    let error = null;
    try { error = backendErrorCode(JSON.parse((await readBounded(response.body, MAX_RESPONSE_BYTES)).toString('utf8'))); }
    catch { /* non-JSON or oversized error bodies are never logged */ }
    console.log('backend_http_error', JSON.stringify({ status: response.status, error }));
    throw new Error('Backend delivery failed');
  }
  const text = await readBounded(response.body, MAX_RESPONSE_BYTES);
  let result;
  try { result = JSON.parse(text.toString('utf8')); }
  catch (error) {
    console.log('backend_invalid_response', JSON.stringify({ status: response.status }));
    throw error;
  }
  if (!result || result.ok !== true || Object.hasOwn(result, 'error')) {
    // Log only the allowlist-shaped error code; never secrets or backend payloads.
    console.log('backend_rejected', JSON.stringify({ status: response.status, error: backendErrorCode(result) }));
    throw new Error('Backend rejected delivery');
  }
}

async function forward(raw, config, fetcher, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await delivery(config, envelope(raw, config.signingSecret), fetcher);
      return;
    } catch {
      if (attempt === 1) throw new Error('Backend unavailable');
      // Same durable event keys, fresh transport nonce; never switch backends on failure.
      await pause(250);
    }
  }
}

function createServer(config, fetcher = fetch) {
  return http.createServer(async (request, response) => {
    const reply = (status, ok) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(ok ? { ok: true } : { ok: false }));
    };
    if (request.method === 'GET' && request.url === '/healthz') return reply(200, true);
    if (request.method !== 'POST' || request.url !== '/webhook') return reply(404, false);
    if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity')
      return reply(415, false);
    let raw;
    try { raw = await readBounded(request, MAX_BYTES); } catch { return reply(413, false); }
    if (!verifyLine(raw, request.headers['x-line-signature'], config.lineSecret))
      return reply(401, false);
    try {
      const payload = JSON.parse(raw.toString('utf8'));
      if (!payload || !Array.isArray(payload.events) || payload.events.length > 100)
        return reply(400, false);
    } catch { return reply(400, false); }
    try { await forward(raw, config, fetcher); reply(200, true); }
    catch { reply(502, false); }
  });
}

if (require.main === module) {
  try {
    const server = createServer(configuration());
    server.requestTimeout = 60000;
    server.headersTimeout = 10000;
    server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
  } catch (error) {
    // Configuration errors contain names only, never values or downstream responses.
    console.error(error.message === 'Invalid URL' ? 'Invalid backend URL' : error.message);
    process.exitCode = 1;
  }
}
module.exports = { configuration, configuredUrl, verifyLine, envelope, delivery, forward, createServer };
