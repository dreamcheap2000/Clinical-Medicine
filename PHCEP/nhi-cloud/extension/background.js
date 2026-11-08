'use strict';
importScripts('config.js');
const apiPaths = new Set(['/api/me', '/api/clinics', '/api/clinic/setup', '/api/clinic/sheet',
  '/api/clinic/setup-key', '/api/clinic/receiver', '/api/clinic/members']);
const patientPaths = new Set(['/api/pending', '/api/complete', '/api/preview', '/api/extract']);
const random = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
async function challenge(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function responseJson(response) {
  let result;
  try { result = await response.json(); } catch { throw new Error('INVALID_SERVER_RESPONSE'); }
  if (!response.ok || result.success !== true) {
    throw new Error(/^[A-Z_]{1,60}$/.test(result.error || '') ? result.error : 'SERVER_REQUEST_FAILED');
  }
  return result;
}
async function session() {
  const { auth } = await chrome.storage.session.get('auth');
  if (!auth || auth.expiresAt <= Date.now()) throw new Error('LOGIN_REQUIRED');
  return auth;
}
async function request(path, method = 'GET', body, clinicRequired = false) {
  const auth = await session();
  const { clinicId } = await chrome.storage.session.get('clinicId');
  if (clinicRequired && !clinicId) throw new Error('WORKSPACE_REQUIRED');
  const headers = { Authorization: 'Bearer ' + auth.token };
  if (clinicRequired) headers['X-NHI-Clinic'] = clinicId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(NHI_ORIGIN + path, { method, headers, credentials: 'omit',
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(45000),
    body: body === undefined ? undefined : JSON.stringify(body) });
  return responseJson(response);
}
function trustedPage(sender) {
  return sender.id === chrome.runtime.id && !sender.tab &&
    sender.url === chrome.runtime.getURL('options.html');
}
function nhiPage(sender) {
  if (sender.id !== chrome.runtime.id || !sender.tab) return false;
  const url = new URL(sender.url);
  return url.origin === 'https://medvpn.nhi.gov.tw' &&
    url.pathname === '/qmue1000/QMUE1002S01.aspx';
}
async function login() {
  const verifier = random();
  const url = NHI_ORIGIN + '/auth/start?' + new URLSearchParams({
    extension: chrome.runtime.id, challenge: await challenge(verifier)
  });
  const redirect = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  const expected = chrome.identity.getRedirectURL('nhi');
  if (!redirect || !redirect.startsWith(expected + '#')) throw new Error('LOGIN_REDIRECT_REJECTED');
  const code = new URLSearchParams(new URL(redirect).hash.slice(1)).get('code');
  if (!/^[A-Za-z0-9_-]{43}$/.test(code || '')) throw new Error('LOGIN_CODE_MISSING');
  const auth = await responseJson(await fetch(NHI_ORIGIN + '/auth/exchange', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
    redirect: 'error', signal: AbortSignal.timeout(30000), body: JSON.stringify({ code, verifier })
  }));
  // A different login must never inherit the previous clinic or patient cache.
  await chrome.storage.session.clear();
  await chrome.storage.session.set({ auth: { token: auth.token, expiresAt: auth.expiresAt } });
}
async function invalidateTabs() {
  const tabs = await chrome.tabs.query({ url: 'https://medvpn.nhi.gov.tw/qmue1000/QMUE1002S01.aspx*' });
  for (const tab of tabs) {
    try { await chrome.tabs.sendMessage(tab.id, { type: 'invalidate' }); }
    catch { console.info('NHI tab has no active assistant; reload to initialize.'); }
  }
}
async function handle(message, sender) {
  if (!message || typeof message !== 'object') throw new Error('INVALID_EXTENSION_MESSAGE');
  const settings = trustedPage(sender), patient = nhiPage(sender);
  if (!settings && !patient) throw new Error('EXTENSION_SENDER_REJECTED');
  if (message.type === 'openSetup') { await chrome.runtime.openOptionsPage(); return { success: true }; }
  if (message.type === 'bootstrap' && patient) {
    const auth = await session();
    const { clinicId } = await chrome.storage.session.get('clinicId');
    if (!clinicId) throw new Error('WORKSPACE_REQUIRED');
    const me = await request('/api/me');
    if (!me.clinics.some(c => c.id === clinicId && c.ready)) throw new Error('WORKSPACE_NOT_READY');
    if (!me.clinicalEnabled) throw new Error('CLINICAL_DATA_NOT_APPROVED');
    const key = 'tab:' + sender.tab.id + ':' + clinicId;
    return { success: true, origin: NHI_ORIGIN, clinicId, expiresAt: auth.expiresAt,
      state: (await chrome.storage.session.get(key))[key] || {} };
  }
  if (message.type === 'state' && patient) {
    await session();
    const { clinicId } = await chrome.storage.session.get('clinicId');
    if (!clinicId || clinicId !== message.clinicId) throw new Error('WORKSPACE_CHANGED');
    if (typeof message.state !== 'object' || !message.state ||
        JSON.stringify(message.state).length > 30000) throw new Error('INVALID_PATIENT_STATE');
    await chrome.storage.session.set({ ['tab:' + sender.tab.id + ':' + clinicId]: message.state });
    return { success: true };
  }
  if (message.type === 'patient' && patient) {
    if (!patientPaths.has(message.path) ||
        (message.path === '/api/pending' ? message.method !== 'GET' : message.method !== 'POST')) {
      throw new Error('PATIENT_OPERATION_REJECTED');
    }
    const { clinicId } = await chrome.storage.session.get('clinicId');
    if (clinicId !== message.clinicId) throw new Error('WORKSPACE_CHANGED');
    return request(message.path.replace('/api/', '/api/clinic/'), message.method, message.body, true);
  }
  if (!settings) throw new Error('SETUP_PAGE_REQUIRED');
  if (message.type === 'login') { await login(); await invalidateTabs(); return request('/api/me'); }
  if (message.type === 'logout') {
    await request('/api/logout', 'POST', {});
    await chrome.storage.session.clear();
    await invalidateTabs();
    return { success: true };
  }
  if (message.type === 'forget') {
    // Local cleanup is explicit when an expired session cannot be revoked remotely.
    await chrome.storage.session.clear();
    await invalidateTabs();
    return { success: true };
  }
  if (message.type === 'selectClinic') {
    const me = await request('/api/me');
    if (!me.clinics.some(c => c.id === message.id)) throw new Error('WORKSPACE_NOT_FOUND');
    const auth = await session();
    await chrome.storage.session.clear();
    await chrome.storage.session.set({ auth, clinicId: message.id });
    await invalidateTabs();
    return { success: true };
  }
  if (message.type === 'api' && apiPaths.has(message.path) &&
      ['GET', 'POST', 'DELETE'].includes(message.method)) {
    const result = await request(message.path, message.method, message.body, message.path.startsWith('/api/clinic/'));
    if (message.path === '/api/me') {
      const { clinicId } = await chrome.storage.session.get('clinicId');
      result.activeClinicId = clinicId || null;
    }
    return result;
  }
  throw new Error('EXTENSION_OPERATION_REJECTED');
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(sendResponse).catch(error => {
    console.error('nhi_extension_error', /^[A-Z_]{1,60}$/.test(error.message) ? error.message : 'NETWORK_OR_EXTENSION_ERROR');
    sendResponse({ success: false, error: /^[A-Z_]{1,60}$/.test(error.message) ?
      error.message : 'NETWORK_OR_EXTENSION_ERROR' });
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    chrome.storage.session.get(null).then(values => chrome.storage.session.remove(
      Object.keys(values).filter(key => key.startsWith('tab:' + tabId + ':'))))
      .catch(() => console.error('NHI_TAB_CACHE_CLEANUP_FAILED'));
  });
  return true;
});
