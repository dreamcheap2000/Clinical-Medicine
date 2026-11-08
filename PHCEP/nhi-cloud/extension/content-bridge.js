'use strict';
(async () => {
  const send = async message => {
    const result = await chrome.runtime.sendMessage(message);
    if (!result || result.success !== true) throw new Error(result?.error || 'EXTENSION_UNAVAILABLE');
    return result;
  };
  const setup = document.createElement('button');
  setup.textContent = 'NHI 診所設定 / 登入';
  Object.assign(setup.style, { position: 'fixed', bottom: '12px', left: '12px', zIndex: '2147483647' });
  setup.addEventListener('click', () => send({ type: 'openSetup' }).catch(error => alert(error.message)));
  document.documentElement.append(setup);
  let bootstrap;
  try { bootstrap = await send({ type: 'bootstrap' }); }
  catch (error) {
    setup.textContent += ' (' + error.message + ')';
    return;
  }
  const state = bootstrap.state;
  let invalidated = false;
  function invalidate() {
    invalidated = true;
    for (const key of Object.keys(state)) delete state[key];
    document.getElementById('nhi-phcep-assistant-host')?.remove();
    setup.textContent = 'NHI 登入／診所已變更；請重新整理頁面';
  }
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id === chrome.runtime.id && message.type === 'invalidate') invalidate();
  });
  const expiry = setInterval(() => {
    if (Date.now() >= bootstrap.expiresAt) { clearInterval(expiry); invalidate(); }
  }, 1000);
  const saveState = () => send({ type: 'state', clinicId: bootstrap.clinicId, state })
    .catch(error => { setStatus(error.message + '；暫存未保存，請重新登入／載入。', 'error'); });
  const sessionStorage = {
    getItem: key => state[key] || null,
    setItem: (key, value) => { state[key] = value; saveState(); },
    removeItem: key => { delete state[key]; saveState(); }
  };
  const GM_xmlhttpRequest = options => {
    if (invalidated) { options.onerror(); return; }
    const url = new URL(options.url);
    if (url.origin !== bootstrap.origin) { options.onerror(); return; }
    let body;
    try { body = options.data === undefined ? undefined : JSON.parse(options.data); }
    catch { options.onerror(); return; }
    send({ type: 'patient', clinicId: bootstrap.clinicId, path: url.pathname,
      method: options.method, body }).then(result => {
      if (invalidated) { options.onerror(); return; }
      options.onload({ status: 200, responseText: JSON.stringify(result) });
    }).catch(error => options.onload({
      status: /LOGIN|SESSION/.test(error.message) ? 401 : 502,
      responseText: JSON.stringify({ success: false, error: error.message })
    }));
  };
  /* NHI_ASSISTANT_BODY */
})().catch(error => {
  console.error('nhi_content_error', error.message);
  alert('NHI 擴充功能啟動失敗，請開啟設定檢查。');
});
