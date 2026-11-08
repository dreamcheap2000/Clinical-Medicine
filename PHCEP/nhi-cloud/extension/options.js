'use strict';
const $ = id => document.getElementById(id);
let me, currentClinic;
async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.success) throw new Error(response?.error || 'EXTENSION_UNAVAILABLE');
  return response;
}
const api = (path, method = 'GET', body) => send({ type: 'api', path, method, body });
function clearKey() { $('setupKey').value = ''; }
async function refresh() {
  clearKey();
  me = await api('/api/me');
  currentClinic = me.clinics.some(c => c.id === me.activeClinicId) ? me.activeClinicId : null;
  $('identity').textContent = me.email + (me.clinicalEnabled ? '' : '（院方資料處理核准尚未啟用）');
  $('clinics').replaceChildren(new Option('請選擇', ''));
  me.clinics.forEach(c => $('clinics').append(new Option(c.name + (c.ready ? ' — 就緒' : ' — 待設定'), c.id)));
  $('clinics').value = currentClinic || '';
  const clinic = me.clinics.find(c => c.id === currentClinic);
  $('admin').hidden = !clinic || clinic.role !== 'admin';
  $('sheetLink').hidden = !clinic?.sheet_id;
  if (clinic?.sheet_id) $('sheetLink').href = 'https://docs.google.com/spreadsheets/d/' + clinic.sheet_id + '/edit';
  if (clinic?.role === 'admin') {
    const settings = await api('/api/clinic/setup');
    $('receiverUrl').value = settings.receiverUrl || '';
    $('members').textContent = (await api('/api/clinic/members')).members.map(m => m.email + ' — ' + m.role).join('\n');
  }
  $('status').textContent = clinic ? (clinic.ready ? '診所連線已設定；重新整理 NHI 頁面後可使用。' : '請完成管理員首次設定。') :
    '請建立或選擇診所；成員需先由診所管理員加入。';
}
function action(id, fn) {
  $(id).addEventListener('click', async () => {
    $(id).disabled = true; $('status').textContent = '處理中…';
    try { await fn(); }
    catch (error) { $('status').textContent = error.message; }
    finally { $(id).disabled = false; }
  });
}
action('login', async () => { await send({ type: 'login' }); currentClinic = null; await refresh(); });
action('logout', async () => {
  await send({ type: 'logout' }); clearKey(); $('admin').hidden = true;
  $('identity').textContent = ''; $('status').textContent = '已登出；重新整理 NHI 頁面以清除畫面。';
});
action('forget', async () => {
  await send({ type: 'forget' }); clearKey(); $('admin').hidden = true;
  $('identity').textContent = ''; $('status').textContent = '本機登入及個案暫存已清除；此操作不等同遠端撤銷。';
});
action('refresh', refresh);
action('select', async () => {
  await send({ type: 'selectClinic', id: $('clinics').value });
  currentClinic = $('clinics').value; await refresh();
});
action('create', async () => {
  const clinic = await api('/api/clinics', 'POST', { name: $('clinicName').value });
  await send({ type: 'selectClinic', id: clinic.id }); currentClinic = clinic.id; await refresh();
});
action('newSheet', async () => { await api('/api/clinic/sheet', 'POST', {}); await refresh(); });
action('connectSheet', async () => { await api('/api/clinic/sheet', 'POST', { sheetId: $('sheetId').value.trim() }); await refresh(); });
action('key', async () => {
  clearKey(); $('setupKey').value = (await api('/api/clinic/setup-key', 'POST', {})).key;
  $('status').textContent = '密鑰已載入密碼欄位，60 秒後自動清除。'; setTimeout(clearKey, 60000);
});
action('copyKey', async () => {
  if (!$('setupKey').value) throw new Error('請先取得配對密鑰');
  await navigator.clipboard.writeText($('setupKey').value);
  $('status').textContent = '已複製；完成配對後請清除剪貼簿。';
});
action('hideKey', async () => { clearKey(); $('status').textContent = '畫面密鑰已清除。'; });
action('receiver', async () => { await api('/api/clinic/receiver', 'POST', { url: $('receiverUrl').value.trim() }); await refresh(); });
action('invite', async () => {
  await api('/api/clinic/members', 'POST', { email: $('memberEmail').value.trim(), role: $('memberRole').value });
  await refresh();
});
action('revoke', async () => {
  if (!confirm('撤銷此成員的診所存取權？不會變更 Google Sheet 分享權限。')) return;
  await api('/api/clinic/members', 'DELETE', { email: $('memberEmail').value.trim() }); await refresh();
});
for (const name of ['NhiSheet.gs', 'NhiPatientApi.gs', 'NhiCloudPair.gs', 'NhiImportDialog.html', 'appsscript.json']) {
  const link = document.createElement('a');
  link.textContent = name; link.href = NHI_ORIGIN + '/downloads/' + name;
  link.target = '_blank'; link.rel = 'noopener noreferrer'; $('downloads').append(link);
}
window.addEventListener('pagehide', clearKey);
refresh().catch(error => { $('status').textContent = error.message; });
