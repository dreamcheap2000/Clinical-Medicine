'use strict';

const MAX_RESPONSE_BYTES = 16384;
const TIMEOUT_MS = 25000;

class ProbeError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function appsScriptUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid Apps Script URL'); }
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || url.port ||
      url.username || url.password || url.search || url.hash ||
      !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname))
    throw new Error('Invalid Apps Script URL');
  return url.href;
}

async function responseJson(response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_RESPONSE_BYTES) throw new Error('Response too large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function checkGateway(fetcher = fetch) {
  const response = await fetcher('https://clinical-medicine.onrender.com/healthz', {
    redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (response.status !== 200) throw new ProbeError('GATEWAY_HTTP_ERROR');
  const result = await responseJson(response);
  if (!result || result.ok !== true) throw new ProbeError('GATEWAY_INVALID_RESPONSE');
}

async function checkAppsScript(value, fetcher = fetch) {
  const url = appsScriptUrl(value);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let response = await fetcher(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: '{}', redirect: 'manual', signal
  });
  if ([302, 303].includes(response.status)) {
    let location;
    try { location = new URL(response.headers.get('location')); }
    catch { throw new ProbeError('GOOGLE_REDIRECT_REJECTED'); }
    if (location.protocol !== 'https:' || location.hostname !== 'script.googleusercontent.com' ||
        location.port || location.username || location.password || location.hash ||
        location.pathname !== '/macros/echo')
      throw new ProbeError('GOOGLE_REDIRECT_REJECTED');
    response = await fetcher(location.href, { method: 'GET', redirect: 'error', signal });
  }
  if (response.status !== 200)
    throw new ProbeError(response.status === 403 ? 'GOOGLE_HTTP_403' : 'GOOGLE_HTTP_ERROR');
  const result = await responseJson(response);
  if (!result || result.ok !== false || result.error !== 'INVALID_ENVELOPE')
    throw new ProbeError('GOOGLE_UNEXPECTED_RESPONSE');
}

async function retry(check, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; ; attempt++) {
    try {
      await check();
      return { ok: true };
    } catch (error) {
      if (attempt < 2) await pause(15000);
      else return { ok: false, reason: error instanceof ProbeError ? error.code : 'NETWORK_OR_INVALID_RESPONSE' };
    }
  }
}

async function main() {
  const url = process.env.PHCEP_MONITOR_APPS_SCRIPT_URL;
  try { appsScriptUrl(url); }
  catch {
    console.error('Monitor configuration error: set PHCEP_MONITOR_APPS_SCRIPT_URL to the PHCEP web app URL.');
    process.exitCode = 1;
    return;
  }
  const results = await Promise.all([
    retry(checkGateway),
    retry(() => checkAppsScript(url))
  ]);
  console.log(`Gateway liveness: ${results[0].ok ? 'PASS' : `FAIL ${results[0].reason}`}`);
  console.log(`Apps Script authorization probe: ${results[1].ok ? 'PASS' : `FAIL ${results[1].reason}`}`);
  if (!results.every(result => result.ok)) {
    console.error('See PHCEP/workflow/MONITORING.md; the probe does not establish the failure cause.');
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { appsScriptUrl, checkGateway, checkAppsScript, retry };
