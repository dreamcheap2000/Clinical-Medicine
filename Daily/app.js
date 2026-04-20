/**
 * Daily/app.js
 * Core application: routing, localStorage persistence, ICD data loading,
 * and post-save cloud sync (GitHub + Firebase Firestore).
 * Zero-dependency SPA — open index.html directly in a modern browser.
 *
 * PRIVACY NOTE: All data (including patient identifiers) is stored exclusively
 * in the user's own browser localStorage and is never transmitted to any server
 * unless the user explicitly configures GitHub or Firebase sync in Settings.
 */

import { renderSessionLog }   from './modules/session-log.js';
import { renderIcdBrowser }   from './modules/icd-browser.js';
import { renderSoapView }     from './modules/soap-view.js';
import { renderMedicalStats } from './modules/medical-stats.js';
import { renderSettings }     from './modules/settings-view.js';

/* ============================================================ */
/* localStorage persistence                                      */
/* ============================================================ */

const STORAGE_KEY = 'dailyOPD_v1';

export function getSessions() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

export function saveSession(session) {
  const sessions = getSessions();
  const idx = sessions.findIndex(s => s.id === session.id);
  if (idx >= 0) sessions[idx] = session;
  else sessions.unshift(session);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function deleteSession(id) {
  const sessions = getSessions().filter(s => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

/**
 * saveSessionWithSync — call after saveSession() to push data to GitHub / Firebase.
 * Import lazily to avoid circular dep; errors are toasted, never thrown.
 */
export async function saveSessionWithSync(session) {
  const all = getSessions();
  const errors = [];

  try {
    const { getGithubSettings, commitSessionToGithub } = await import('./modules/github-sync.js');
    const ghCfg = getGithubSettings();
    if (ghCfg.enabled) {
      await commitSessionToGithub(session, all);
      showToast('success', '☁️ GitHub: session committed.');
    }
  } catch(e) {
    errors.push(`GitHub: ${e.message}`);
  }

  try {
    const { getFirebaseSettings, syncSessionToFirestore } = await import('./modules/firebase-sync.js');
    const fbCfg = getFirebaseSettings();
    if (fbCfg.enabled) {
      await syncSessionToFirestore(session);
      showToast('success', '🔥 Firestore: session synced.');
    }
  } catch(e) {
    errors.push(`Firebase: ${e.message}`);
  }

  if (errors.length) {
    showToast('error', `Sync error — ${errors.join('; ')}`);
  }
}

export function exportJSON() {
  const data = { version: '1.0.0', exportedAt: new Date().toISOString(), sessions: getSessions() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  // Filename uses ISO 8601 date (YYYY-MM-DD) which is safe across all operating systems
  a.download = `daily-opd-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data     = JSON.parse(e.target.result);
        const incoming = Array.isArray(data) ? data : (data.sessions || []);
        const existing = getSessions();
        const merged   = [...existing];
        let added = 0;
        for (const s of incoming) {
          if (!merged.find(x => x.id === s.id)) { merged.push(s); added++; }
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        resolve(added);
      } catch(err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/* ============================================================ */
/* Custom SOAP templates (user-saved, named)                     */
/* ============================================================ */

const SOAP_TMPL_KEY = 'soapTemplates_v1';

export function getSoapTemplates() {
  try { return JSON.parse(localStorage.getItem(SOAP_TMPL_KEY) || '[]'); }
  catch { return []; }
}

export function saveSoapTemplate(tmpl) {
  const list = getSoapTemplates();
  const idx  = list.findIndex(t => t.id === tmpl.id);
  if (idx >= 0) list[idx] = tmpl;
  else list.unshift(tmpl);
  localStorage.setItem(SOAP_TMPL_KEY, JSON.stringify(list));
}

export function deleteSoapTemplate(id) {
  const list = getSoapTemplates().filter(t => t.id !== id);
  localStorage.setItem(SOAP_TMPL_KEY, JSON.stringify(list));
}

/* ============================================================ */
/* Patient type / special patient tracking                       */
/* ============================================================ */

const PT_FREQ_KEY = 'patientTypeFreq_v1';

export function getPatientTypeFreq() {
  try { return JSON.parse(localStorage.getItem(PT_FREQ_KEY) || '{}'); }
  catch { return {}; }
}

export function recordPatientType(patientType) {
  if (!patientType) return;
  const freq  = getPatientTypeFreq();
  const today = new Date().toISOString().slice(0, 10);
  if (!freq[patientType]) freq[patientType] = { count: 0, lastUsed: today };
  freq[patientType].count   += 1;
  freq[patientType].lastUsed = today;
  localStorage.setItem(PT_FREQ_KEY, JSON.stringify(freq));
}

/* ============================================================ */
/* EBM / Key Learning star rating                                */
/* ============================================================ */

const EBM_STARS_KEY = 'ebmStars_v1';

export function getEbmStars() {
  try { return JSON.parse(localStorage.getItem(EBM_STARS_KEY) || '{}'); }
  catch { return {}; }
}

export function setEbmStar(key, rating) {
  const stars = getEbmStars();
  stars[key]  = rating;
  localStorage.setItem(EBM_STARS_KEY, JSON.stringify(stars));
}



const SOAP_FREQ_KEY = 'soapFreq_v1';

export function getSoapFreq() {
  try { return JSON.parse(localStorage.getItem(SOAP_FREQ_KEY) || '{}'); }
  catch { return {}; }
}

export function recordSoapSelections(catId, items) {
  if (!catId || !items?.length) return;
  const freq = getSoapFreq();
  if (!freq[catId]) freq[catId] = {};
  for (const item of items) {
    freq[catId][item] = (freq[catId][item] || 0) + 1;
  }
  localStorage.setItem(SOAP_FREQ_KEY, JSON.stringify(freq));
}

/* ============================================================ */
/* ICD usage frequency tracking                                  */
/* ============================================================ */

const ICD_FREQ_KEY = 'icdFreq_v1';

export function getIcdFreq() {
  try { return JSON.parse(localStorage.getItem(ICD_FREQ_KEY) || '{}'); }
  catch { return {}; }
}

export function recordIcdUse(session) {
  /* Support both single icdCode (legacy) and icdCodes array (new) */
  const codes = session.icdCodes?.length
    ? session.icdCodes
    : (session.icdCode
        ? [{ code: session.icdCode, en: session.icdDescription || '', zh: session.icdZh || '',
             categoryId: session.categoryId || '', categoryName: session.categoryName || '' }]
        : []);
  for (const c of codes) {
    _recordSingleIcd(c, session);
  }
  if (session.patientType) recordPatientType(session.patientType);
}

function _recordSingleIcd(codeObj, session) {
  if (!codeObj?.code) return;
  const freq  = getIcdFreq();
  const today = new Date().toISOString().slice(0, 10);
  const key   = codeObj.code;
  if (!freq[key]) {
    freq[key] = {
      code: codeObj.code,
      en:   codeObj.en          || '',
      zh:   codeObj.zh          || '',
      categoryId:   codeObj.categoryId   || '',
      categoryName: codeObj.categoryName || '',
      count:    0,
      lastUsed: today,
      history:  [],
    };
  } else {
    if (codeObj.en)           freq[key].en = codeObj.en;
    if (codeObj.zh)           freq[key].zh = codeObj.zh;
    if (codeObj.categoryName) freq[key].categoryName = codeObj.categoryName;
  }
  freq[key].count   += 1;
  freq[key].lastUsed = today;
  const hist       = freq[key].history;
  const todayEntry = hist.find(h => h.date === today);
  if (todayEntry) todayEntry.count += 1;
  else hist.push({ date: today, count: 1 });
  localStorage.setItem(ICD_FREQ_KEY, JSON.stringify(freq));
}

/* ============================================================ */
/* ICD data loading                                              */
/* ============================================================ */

let _icdData = null;

export async function getIcdData() {
  if (_icdData) return _icdData;
  const res = await fetch('data/icd_categories.json');
  if (!res.ok) throw new Error('Failed to load ICD data');
  _icdData = await res.json();
  return _icdData;
}

export function searchCodes(query, icdData, limit = 40) {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  const results = [];
  for (const [catId, codes] of Object.entries(icdData.codeLookup)) {
    for (const c of codes) {
      if (
        c.code.toLowerCase().includes(q) ||
        c.en.toLowerCase().includes(q)   ||
        c.zh.includes(query)
      ) {
        results.push({ ...c, categoryId: catId });
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
}

/* ============================================================ */
/* Router                                                        */
/* ============================================================ */

export function navigate(target) {
  const page = typeof target === 'string' ? target : target.page;
  updateNav(page);
  renderPage(target);
}

function renderPage(target) {
  const page = typeof target === 'string' ? target : target.page;
  switch (page) {
    case 'log':       renderSessionLog(typeof target === 'object' ? target : {}); break;
    case 'browser':   renderIcdBrowser(typeof target === 'object' ? target : {}); break;
    case 'soap':      renderSoapView(typeof target === 'object' ? target : {});   break;
    case 'stats':     renderMedicalStats(); break;
    case 'settings':  renderSettings();     break;
    case 'dashboard': renderDashboard();    break;
    default:          renderDashboard();
  }
}

function updateNav(page) {
  document.querySelectorAll('#nav-links button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });
}

/* ============================================================ */
/* Dashboard                                                     */
/* ============================================================ */

function renderDashboard() {
  const sessions  = getSessions();
  const freq      = getIcdFreq();
  const today     = new Date().toISOString().slice(0, 10);
  const todayList = sessions.filter(s => s.date === today);

  /* Top 5 ICD codes */
  const topCodes = Object.values(freq)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const maxCount = topCodes[0]?.count || 1;

  const container = document.getElementById('main-content');
  container.innerHTML = `
    <h2 class="page-title">🏥 Daily OPD Session Dashboard</h2>
    <p class="subtitle">Neuro-musculoskeletal &amp; Neurologic ICD-10 Self-Classification System</p>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${todayList.length}</div>
        <div class="stat-label">Today's Entries</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${sessions.length}</div>
        <div class="stat-label">Total Entries</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${new Set(sessions.map(s => s.date)).size}</div>
        <div class="stat-label">Days with Records</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${Object.keys(freq).length}</div>
        <div class="stat-label">ICD Codes Used</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <div class="card-title">⚡ Quick Actions</div>
      <div class="action-grid">
        <button class="action-btn btn-primary" data-nav="log">📝 New OPD Entry</button>
        <button class="action-btn" data-nav="browser">🔍 ICD Code Browser</button>
        <button class="action-btn" data-nav="soap">📋 SOAP Templates</button>
        <button class="action-btn" data-nav="stats">📊 Medical Statistics</button>
      </div>
    </div>

    ${topCodes.length ? `
    <div class="card" style="margin-bottom:1rem">
      <div class="card-title">📊 Top ICD Codes <span class="hint" style="font-weight:400;margin-left:.5rem">— <a href="#" data-nav="stats" style="color:var(--color-primary)">View full stats →</a></span></div>
      <div class="dash-bar-chart">
        ${topCodes.map(c => `
          <div class="dash-bar-row">
            <span class="dash-bar-label"><span class="tag tag-code">${esc(c.code)}</span> ${esc(c.en.slice(0, 35))}${c.en.length > 35 ? '…' : ''}</span>
            <div class="dash-bar-track">
              <div class="dash-bar-fill" style="width:${Math.round(c.count / maxCount * 100)}%"></div>
            </div>
            <span class="dash-bar-count">${c.count}</span>
          </div>`).join('')}
      </div>
    </div>` : ''}

    <div class="card">
      <div class="card-title">📅 Today's Entries — ${today}</div>
      ${todayList.length === 0
        ? '<p class="no-records">No entries today. Click "New OPD Entry" to start.</p>'
        : `<div class="entry-list">${todayList.map(s => entryCard(s, true)).join('')}</div>`}
    </div>

    <div class="card">
      <div class="card-title">🕐 Recent Entries</div>
      ${sessions.length === 0
        ? '<p class="no-records">No entries yet.</p>'
        : `<div class="entry-list">${sessions.slice(0, 10).map(s => entryCard(s, false)).join('')}</div>`}
    </div>

    <div class="card">
      <div class="card-title">💾 Data Management</div>
      <div class="row-gap">
        <button class="btn btn-outline" id="btn-export">⬇️ Export JSON</button>
        <label class="btn btn-outline" style="cursor:pointer">
          ⬆️ Import JSON
          <input type="file" id="import-file" accept=".json" style="display:none">
        </label>
        <span class="hint">All data stored in browser localStorage only.</span>
      </div>
    </div>
  `;

  container.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.nav));
  });

  container.querySelectorAll('[data-edit]').forEach(el => {
    el.addEventListener('click', () => navigate({ page: 'log', editId: el.dataset.edit }));
  });

  container.querySelectorAll('[data-delete]').forEach(el => {
    el.addEventListener('click', () => {
      if (confirm('Delete this entry?')) {
        deleteSession(el.dataset.delete);
        renderDashboard();
        showToast('success', 'Entry deleted.');
      }
    });
  });

  document.getElementById('btn-export').addEventListener('click', exportJSON);
  document.getElementById('import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const added = await importJSON(file);
      showToast('success', `Imported ${added} new entries.`);
      renderDashboard();
    } catch(err) { showToast('error', `Import failed: ${err.message}`); }
  });
}

function entryCard(s, compact) {
  const soapPreview = s.soapText || s.soap?.s || '';
  /* Show all ICD codes (new multi-code support) or fall back to single legacy code */
  const allCodes = s.icdCodes?.length
    ? s.icdCodes
    : (s.icdCode ? [{ code: s.icdCode, en: s.icdDescription || '', categoryName: s.categoryName || '' }] : []);
  return `
    <div class="entry-card">
      <div class="entry-header">
        <span class="entry-ts">${esc(s.timestamp || s.date)}</span>
        ${s.patientId   ? `<span class="tag tag-default">👤 ${esc(s.patientId)}</span>` : ''}
        ${s.patientType ? `<span class="tag tag-abnormal">${esc(s.patientType)}</span>` : ''}
        ${allCodes.length > 0
          ? allCodes.map(c => `<span class="tag tag-code">${esc(c.code)}</span>`).join('')
          : ''}
        <div class="entry-actions">
          <button class="btn-sm" data-edit="${esc(s.id)}">✏️</button>
          <button class="btn-sm btn-danger" data-delete="${esc(s.id)}">🗑️</button>
        </div>
      </div>
      ${allCodes.length > 0
        ? `<div class="entry-icd">${allCodes.map(c => `${esc(c.code)}${c.en ? ' ' + esc(c.en) : ''}`).join(' · ')}</div>`
        : ''}
      ${s.condition ? `<div class="entry-field"><b>Condition:</b> ${esc(s.condition)}</div>` : ''}
      ${!compact && (s.keyLearning || s.ebm) ? `<div class="entry-field"><b>EBM:</b> ${esc((s.keyLearning||s.ebm||'').slice(0,120))}${(s.keyLearning||s.ebm||'').length > 120 ? '…' : ''}</div>` : ''}
      ${!compact && soapPreview ? `<div class="entry-field"><b>SOAP:</b> ${esc(soapPreview.slice(0,120))}${soapPreview.length > 120 ? '…' : ''}</div>` : ''}
    </div>`;
}

/* ============================================================ */
/* Toast                                                         */
/* ============================================================ */

export function showToast(type, msg) {
  const tc = document.getElementById('toast-container');
  if (!tc) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  tc.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

/* ============================================================ */
/* Bootstrap                                                     */
/* ============================================================ */

function boot() {
  const navLinks = document.getElementById('nav-links');
  if (navLinks) {
    const pages = [
      { page: 'dashboard', label: '🏠 Home'          },
      { page: 'log',       label: '📝 New Entry'     },
      { page: 'browser',   label: '🔍 ICD Browser'   },
      { page: 'soap',      label: '📋 SOAP Templates' },
      { page: 'stats',     label: '📊 Medical Stats'   },
      { page: 'settings',  label: '⚙️ Settings'       },
    ];
    navLinks.innerHTML = pages.map(p =>
      `<button data-page="${p.page}">${p.label}</button>`
    ).join('');
    navLinks.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => navigate(btn.dataset.page));
    });
  }

  window.addEventListener('navigate', e => navigate(e.detail));
  window.addEventListener('toast',    e => showToast(e.detail.type, e.detail.msg));

  navigate('dashboard');
}

document.addEventListener('DOMContentLoaded', boot);

/* ============================================================ */
export function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
