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
/* SOAP section-aware frequency tracking                         */
/* ============================================================ */

const SOAP_SECTION_FREQ_KEY = 'soapSectionFreq_v1';

export function getSoapSectionFreq() {
  try { return JSON.parse(localStorage.getItem(SOAP_SECTION_FREQ_KEY) || '{}'); }
  catch { return {}; }
}

/**
 * Records a single SOAP term with its section ('s' | 'o' | 'a' | 'p').
 */
export function recordSoapItemWithSection(term, section) {
  if (!term) return;
  const freq  = getSoapSectionFreq();
  const today = new Date().toISOString().slice(0, 10);
  if (!freq[term]) {
    freq[term] = { section: section || 's', count: 0, lastUsed: today };
  }
  freq[term].count   += 1;
  freq[term].lastUsed = today;
  /* Keep the first recorded section (most authoritative) */
  if (section && !freq[term].section) freq[term].section = section;
  localStorage.setItem(SOAP_SECTION_FREQ_KEY, JSON.stringify(freq));
}

/**
 * Returns the top N most-used SOAP terms, sorted by count desc then lastUsed desc.
 * Each entry: { term, section, count, lastUsed }
 */
export function getRecentSoapTerms(n = 100) {
  const freq = getSoapSectionFreq();
  return Object.entries(freq)
    .map(([term, d]) => ({
      term,
      section:  d.section  || 's',
      count:    d.count    || 0,
      lastUsed: d.lastUsed || '',
    }))
    .sort((a, b) => b.count - a.count || b.lastUsed.localeCompare(a.lastUsed))
    .slice(0, n);
}

/* ============================================================ */
/* Shortcut key settings                                         */
/* ============================================================ */

const SHORTCUT_KEYS_KEY = 'shortcutKeys_v1';

export const DEFAULT_SHORTCUTS = {
  insertSoap:    'Shift+C',  /* Insert selected in SOAP ghost window */
  insertSoapAll: 'Shift+I',  /* Insert all selected on SOAP templates page */
  insertIcd:     'Shift+S',  /* Insert selected ICD codes */
  insertAll:     'Shift+A',  /* Insert all selected (ICD + SOAP) */
};

export function getShortcutKeys() {
  try {
    const saved = JSON.parse(localStorage.getItem(SHORTCUT_KEYS_KEY) || 'null');
    return saved ? { ...DEFAULT_SHORTCUTS, ...saved } : { ...DEFAULT_SHORTCUTS };
  } catch { return { ...DEFAULT_SHORTCUTS }; }
}

export function saveShortcutKeys(keys) {
  localStorage.setItem(SHORTCUT_KEYS_KEY, JSON.stringify({ ...DEFAULT_SHORTCUTS, ...keys }));
}

/**
 * Returns true when a KeyboardEvent matches a shortcut string like "Shift+C".
 */
export function matchShortcut(event, shortcutStr) {
  if (!shortcutStr) return false;
  const parts = shortcutStr.split('+').map(s => s.trim().toLowerCase());
  const key   = parts[parts.length - 1];
  const shift = parts.includes('shift');
  const ctrl  = parts.includes('ctrl') || parts.includes('control');
  const alt   = parts.includes('alt');
  const meta  = parts.includes('meta');
  return (
    event.key.toLowerCase() === key &&
    event.shiftKey === shift &&
    event.ctrlKey  === ctrl  &&
    event.altKey   === alt   &&
    event.metaKey  === meta
  );
}

/**
 * Returns true if the element is a text-entry input (where shortcut keys should be suppressed).
 * Checkboxes, radios, buttons, and selects are NOT considered typing inputs.
 */
export function isTypingInput(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') {
    const t = (el.type || 'text').toLowerCase();
    return ['text','search','email','password','number','tel','url',
            'color','date','time','datetime-local','month','week'].includes(t);
  }
  return false;
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

/**
 * Builds a deduplicated, alphabetically-sorted combined Objective array by
 * merging a category's SOAP objective items with its physical exam items.
 * @param {object} soap - cat.soap (may be undefined)
 * @param {object} pe   - cat.physicalExam (may be undefined)
 * @returns {string[]}
 */
export function buildCombinedObjective(soap = {}, pe = {}) {
  const raw = [
    ...(soap.objective       || []),
    ...(pe.neurologic_exam   || []),
    ...(pe.bedside_scales    || pe.bedside_cognitive || []),
  ];
  return [...new Set(raw)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/* ============================================================ */
/* Router                                                        */
/* ============================================================ */

export function navigate(target) {
  const page = typeof target === 'string' ? target : target.page;
  /* Tear down floating panels from previous page before rendering the new one */
  if (page !== 'soap'    && window._soapViewAbort)    { window._soapViewAbort.abort();    window._soapViewAbort    = null; }
  if (page !== 'browser' && window._icdBrowserAbort)  { window._icdBrowserAbort.abort();  window._icdBrowserAbort  = null; }
  if (page !== 'log'     && window._ghostPanelAbort)  { window._ghostPanelAbort.abort();  window._ghostPanelAbort  = null; }
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
    case 'quad':      renderQuadView();     break;
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
        <button class="btn btn-outline" id="btn-restore-repo">📂 Restore from Repo</button>
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
  document.getElementById('btn-restore-repo')?.addEventListener('click', async () => {
    /* Reset the "done" flag so restoreSessionsFromRepo will run again */
    localStorage.removeItem(SESSION_RESTORE_KEY);
    const added = await restoreSessionsFromRepo();
    if (added > 0) {
      showToast('success', `📂 Restored ${added} entries from repo.`);
      renderDashboard();
    } else {
      showToast('info', 'No new entries found in repo session files.');
    }
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
/* Floating panel position persistence                           */
/* ============================================================ */

const FLOAT_POS_KEY = 'floatPositions_v1';

export function getFloatPositions() {
  try { return JSON.parse(localStorage.getItem(FLOAT_POS_KEY) || '{}'); }
  catch { return {}; }
}

export function saveFloatPosition(key, data) {
  const all = getFloatPositions();
  all[key]  = data;
  localStorage.setItem(FLOAT_POS_KEY, JSON.stringify(all));
}

let _zTop = 1100;

/* ── Shared drag infrastructure (single set of global handlers) ────────── */
/* Avoids N×2 document event listeners when there are N draggable elements. */

let _dragCtx = null;   /* { el, ox, oy, sx, sy, moved, storageKey, isPanel } | null */

function _ensureDragHandlers() {
  if (_ensureDragHandlers._installed) return;
  _ensureDragHandlers._installed = true;

  document.addEventListener('mousemove', e => {
    if (!_dragCtx) return;
    const { el, ox, oy, sx, sy, isPanel } = _dragCtx;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (!_dragCtx.moved && Math.abs(dx) + Math.abs(dy) > 4) _dragCtx.moved = true;
    if (!_dragCtx.moved && !isPanel) return;  /* containers need threshold; panels always */
    if (isPanel) {
      el.style.left = (ox + dx) + 'px';
      el.style.top  = (oy + dy) + 'px';
    } else {
      el.style.left = Math.max(0, ox + dx) + 'px';
      el.style.top  = Math.max(0, oy + dy) + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    if (!_dragCtx) return;
    const { el, moved, storageKey, isPanel } = _dragCtx;
    if (moved || isPanel) _persistPanel(el, storageKey, isPanel);
    if (!isPanel) {
      if (moved)   el.dataset.dragged = '1';
      else         delete el.dataset.dragged;
    }
    _dragCtx = null;
  });
}

/**
 * Make a fixed-position floating panel draggable and size-persistent.
 * el must have a .float-drag-handle child (or uses its own top area as handle).
 * Persists position, size, visibility (hidden/shown), and minimize state.
 */
export function initFloatPanel(el, storageKey, defaults = {}) {
  const saved  = getFloatPositions()[storageKey];
  el.style.position = 'fixed';
  el.style.left   = (saved?.x ?? defaults.x ?? 100) + 'px';
  el.style.top    = (saved?.y ?? defaults.y ?? 100) + 'px';
  if (saved?.w)   el.style.width  = saved.w + 'px';
  if (saved?.h)   el.style.height = saved.h + 'px';
  el.style.zIndex = ++_zTop;

  /* Restore minimized state */
  if (saved?.minimized) el.classList.add('float-panel-minimized');

  const handle = el.querySelector('.float-drag-handle') || el;

  handle.addEventListener('mousedown', e => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    el.style.zIndex = ++_zTop;
    _dragCtx = {
      el, isPanel: true, storageKey, moved: true,
      sx: e.clientX, sy: e.clientY,
      ox: parseInt(el.style.left) || 0,
      oy: parseInt(el.style.top)  || 0,
    };
    e.preventDefault();
  });

  el.addEventListener('mousedown', () => { el.style.zIndex = ++_zTop; });

  if (window.ResizeObserver && storageKey) {
    new ResizeObserver(() => _persistPanel(el, storageKey, true)).observe(el);
  }

  _ensureDragHandlers();
}

function _persistPanel(el, key, saveSize = true) {
  if (!key) return;
  const existing = getFloatPositions()[key] || {};
  const data = {
    x: parseInt(el.style.left) || 0,
    y: parseInt(el.style.top)  || 0,
  };
  if (saveSize) { data.w = el.offsetWidth; data.h = el.offsetHeight; }
  /* Preserve visibility / minimize state from existing saved data */
  if ('hidden'    in existing) data.hidden    = existing.hidden;
  if ('minimized' in existing) data.minimized = existing.minimized;
  saveFloatPosition(key, data);
}

/**
 * Save the visibility state (hidden/shown) and minimized state of a float panel.
 * Call this whenever the panel visibility or minimize state changes.
 */
export function saveFloatPanelState(storageKey, { hidden, minimized } = {}) {
  const all = getFloatPositions();
  const existing = all[storageKey] || {};
  all[storageKey] = Object.assign({}, existing, {
    ...(hidden    !== undefined ? { hidden    } : {}),
    ...(minimized !== undefined ? { minimized } : {}),
  });
  localStorage.setItem(FLOAT_POS_KEY, JSON.stringify(all));
}

/**
 * Get the saved visibility/minimize state for a float panel.
 */
export function getFloatPanelState(storageKey) {
  const saved = getFloatPositions()[storageKey] || {};
  return { hidden: !!saved.hidden, minimized: !!saved.minimized };
}

/**
 * Make an element draggable inside a relative container.
 * On drag-end, sets el.dataset.dragged = '1' briefly so click handlers can ignore drag-ends.
 */
export function initDraggableInContainer(el, storageKey, defaultPos = {}) {
  const saved = getFloatPositions()[storageKey];
  el.style.position = 'absolute';
  el.style.left = (saved?.x ?? defaultPos.x ?? 0) + 'px';
  el.style.top  = (saved?.y ?? defaultPos.y ?? 0) + 'px';
  el.style.zIndex = ++_zTop;

  el.addEventListener('mousedown', e => {
    el.style.zIndex = ++_zTop;
    _dragCtx = {
      el, isPanel: false, storageKey, moved: false,
      sx: e.clientX, sy: e.clientY,
      ox: parseInt(el.style.left) || 0,
      oy: parseInt(el.style.top)  || 0,
    };
    e.preventDefault();
  });

  /* Clear dragged flag in next tick so click handler runs first */
  el.addEventListener('click', () => {
    setTimeout(() => { delete el.dataset.dragged; }, 0);
  });

  _ensureDragHandlers();
}

/* ============================================================ */
/* Session restore from repo JSON files                         */
/* ============================================================ */

const SESSION_RESTORE_KEY = 'sessionRestoreDone_v1';

export async function restoreSessionsFromRepo() {
  /* Only run once per browser (skip if already done or data exists) */
  if (localStorage.getItem(SESSION_RESTORE_KEY)) return 0;

  let indexData;
  try {
    const res = await fetch('./sessions/index.json');
    if (!res.ok) { localStorage.setItem(SESSION_RESTORE_KEY, '1'); return 0; }
    indexData = await res.json();
  } catch { localStorage.setItem(SESSION_RESTORE_KEY, '1'); return 0; }

  const files   = indexData.files || [];
  const existing = getSessions();
  const merged   = [...existing];
  let added = 0;

  for (const fname of files) {
    try {
      const res = await fetch(`./sessions/${fname}`);
      if (!res.ok) continue;
      const data = await res.json();
      for (const s of (data.sessions || [])) {
        if (!merged.find(x => x.id === s.id)) { merged.push(s); added++; }
      }
    } catch { /* skip individual file errors */ }
  }

  if (added > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  localStorage.setItem(SESSION_RESTORE_KEY, '1');
  return added;
}

}

/* ============================================================ */
/* Quad View — 4-quadrant integrated dashboard (Issue 5)        */
/* ============================================================ */

async function renderQuadView() {
  const container = document.getElementById('main-content');
  /* Override default padding/scroll so the quad grid fills the full area */
  container.style.padding  = '0';
  container.style.overflow = 'hidden';

  /* Skeleton first — load ICD data in background */
  container.innerHTML = `
    <div class="quad-container" id="quad-container">
      ${_quadPanel('tl','🏥 Home',       'quad-home',  '🏠')}
      ${_quadPanel('tr','📝 New Entry',  'quad-entry', '📝')}
      ${_quadPanel('bl','🔍 ICD Browser','quad-icd',   '🔍')}
      ${_quadPanel('br','📋 SOAP Templates','quad-soap','📋')}
    </div>`;

  /* Wire up maximize buttons */
  container.querySelectorAll('.quad-panel').forEach(panel => {
    const maxBtn = panel.querySelector('.quad-max-btn');
    maxBtn?.addEventListener('click', e => {
      e.stopPropagation();
      const isMax = panel.classList.toggle('quad-maximized');
      maxBtn.textContent = isMax ? '⬜ Restore' : '⛶ Maximize';
    });
    /* Navigate to full page on double-click on header */
    panel.querySelector('.quad-panel-header')?.addEventListener('dblclick', () => {
      const page = panel.dataset.navPage;
      if (page) navigate(page);
    });
  });

  /* Render Home quadrant inline */
  _renderQuadHome(container.querySelector('#quad-home'));

  /* Render New Entry quadrant inline */
  _renderQuadEntry(container.querySelector('#quad-entry'));

  /* Load ICD data for ICD Browser and SOAP quadrants */
  let icdData = null;
  try { icdData = await getIcdData(); } catch { /* handled inline */ }
  _renderQuadIcd(container.querySelector('#quad-icd'), icdData);
  _renderQuadSoap(container.querySelector('#quad-soap'), icdData);

  /* Cleanup padding on navigate away */
  const origPad = '';
  const _restoreStyle = () => {
    container.style.padding  = origPad;
    container.style.overflow = '';
  };
  /* Use the navigate event to restore style */
  const _onNav = () => { _restoreStyle(); window.removeEventListener('navigate', _onNav); };
  window.addEventListener('navigate', _onNav);
}

function _quadPanel(pos, title, bodyId, navPage) {
  return `
    <div class="quad-panel" data-quad="${esc(pos)}" data-nav-page="${esc(navPage)}">
      <div class="quad-panel-header">
        <span class="quad-panel-title">${title}</span>
        <span class="quad-panel-actions">
          <button class="quad-panel-btn quad-max-btn" title="Maximize / restore">⛶ Maximize</button>
          <button class="quad-panel-btn quad-goto-btn"
            onclick="window.dispatchEvent(new CustomEvent('navigate',{detail:'${esc(navPage)}'}))"
            title="Open full page">↗ Full</button>
        </span>
      </div>
      <div class="quad-panel-body" id="${esc(bodyId)}">
        <p style="color:#888;font-size:.8rem;padding:.5rem">Loading…</p>
      </div>
    </div>`;
}

function _renderQuadHome(el) {
  if (!el) return;
  const sessions  = getSessions();
  const freq      = getIcdFreq();
  const today     = new Date().toISOString().slice(0, 10);
  const todayList = sessions.filter(s => s.date === today);
  const topCodes  = Object.values(freq).sort((a, b) => b.count - a.count).slice(0, 5);
  const maxCount  = topCodes[0]?.count || 1;

  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value">${todayList.length}</div><div class="stat-label">Today</div></div>
      <div class="stat-card"><div class="stat-value">${sessions.length}</div><div class="stat-label">Total</div></div>
      <div class="stat-card"><div class="stat-value">${new Set(sessions.map(s => s.date)).size}</div><div class="stat-label">Days</div></div>
      <div class="stat-card"><div class="stat-value">${Object.keys(freq).length}</div><div class="stat-label">ICD Used</div></div>
    </div>
    <div class="action-grid" style="margin-bottom:.5rem">
      <button class="action-btn btn-primary" data-nav="log">📝 New Entry</button>
      <button class="action-btn" data-nav="browser">🔍 ICD Browser</button>
      <button class="action-btn" data-nav="soap">📋 SOAP</button>
      <button class="action-btn" data-nav="stats">📊 Stats</button>
    </div>
    ${topCodes.length ? `
      <div class="card">
        <div class="card-title">📊 Top ICD Codes</div>
        <div class="dash-bar-chart">
          ${topCodes.map(c => `
            <div class="dash-bar-row">
              <span class="dash-bar-label"><span class="tag tag-code">${esc(c.code)}</span>
                ${esc(c.en.split(/[,:]/, 1)[0].slice(0, 28))}</span>
              <div class="dash-bar-track">
                <div class="dash-bar-fill" style="width:${Math.round(c.count / maxCount * 100)}%"></div>
              </div>
              <span class="dash-bar-count">${c.count}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}
    <div class="card">
      <div class="card-title">📅 Today — ${today}</div>
      ${todayList.length === 0
        ? '<p class="no-records">No entries today.</p>'
        : `<div class="entry-list">${todayList.slice(0, 5).map(s => `
          <div class="entry-card" style="cursor:pointer" data-edit="${esc(s.id)}">
            <div class="entry-header">
              <span class="entry-ts">${esc(s.timestamp || s.date)}</span>
              ${s.patientId ? `<span class="tag tag-default">${esc(s.patientId)}</span>` : ''}
              ${(s.icdCodes || []).map(c => `<span class="tag tag-code">${esc(c.code)}</span>`).join('')}
            </div>
          </div>`).join('')}</div>`}
    </div>`;

  el.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.nav)));
  el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => navigate({ page: 'log', editId: b.dataset.edit })));
}

function _renderQuadEntry(el) {
  if (!el) return;
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = `
    <p style="font-size:.8rem;color:var(--color-muted);margin-bottom:.5rem">
      Quick-start a new entry or open the full form.
    </p>
    <div style="display:flex;flex-direction:column;gap:.4rem;margin-bottom:.6rem">
      <div>
        <label class="field-label">Date</label>
        <input class="field-input" id="quad-date" type="date" value="${today}" style="width:100%">
      </div>
      <div>
        <label class="field-label">Patient ID</label>
        <input class="field-input" id="quad-pid" type="text" placeholder="Optional patient ID" style="width:100%">
      </div>
    </div>
    <button class="quad-open-btn" id="quad-new-entry-btn">📝 Open Full New Entry Form →</button>
    <div style="margin-top:.6rem;font-size:.78rem;color:var(--color-muted)">
      Double-click the panel header to open the full form.
    </div>`;

  el.querySelector('#quad-new-entry-btn')?.addEventListener('click', () => {
    const date = el.querySelector('#quad-date')?.value || today;
    const pid  = el.querySelector('#quad-pid')?.value  || '';
    if (date) sessionStorage.setItem('prefill_date', date);
    if (pid)  sessionStorage.setItem('prefill_pid', pid);
    navigate('log');
  });
}

function _renderQuadIcd(el, icdData) {
  if (!el) return;
  const freq  = getIcdFreq();
  const top10 = Object.values(freq).sort((a, b) => b.count - a.count).slice(0, 10);

  if (!icdData) {
    el.innerHTML = `<p style="color:red;font-size:.8rem">⚠ ICD data failed to load.</p>`;
    return;
  }

  el.innerHTML = `
    <div class="browser-search-wrap" style="margin-bottom:.5rem">
      <input class="field-input" id="quad-icd-search" type="text" style="width:100%"
        placeholder="Search ICD code or name…">
      <div id="quad-icd-results" class="browser-search-results hidden"></div>
    </div>
    <div class="quad-icd-recent">
      <div class="quad-icd-recent-title">⏱ Recently Used (click to browse)</div>
      ${top10.length === 0
        ? '<p style="font-size:.78rem;color:#888">No history yet.</p>'
        : top10.map(c => `
          <div class="quad-icd-recent-item" data-cat="${esc(c.categoryId)}" data-code="${esc(c.code)}">
            <span class="tag tag-code">${esc(c.code)}</span>
            <span>${esc(c.en.split(/[,:]/, 1)[0].slice(0, 36))}</span>
            <span class="freq-badge" style="margin-left:auto">×${c.count}</span>
          </div>`).join('')}
    </div>
    <button class="quad-open-btn" style="margin-top:.5rem" data-nav="browser">🔍 Open Full ICD Browser →</button>`;

  /* Live search */
  const searchEl  = el.querySelector('#quad-icd-search');
  const searchRes = el.querySelector('#quad-icd-results');
  let _t = null;
  searchEl?.addEventListener('input', () => {
    clearTimeout(_t);
    const q = searchEl.value.trim();
    if (q.length < 2) { searchRes.classList.add('hidden'); return; }
    _t = setTimeout(() => {
      const cats = icdData.categories || [];
      const results = searchCodes(q, icdData, 20);
      if (!results.length) {
        searchRes.innerHTML = '<div style="padding:.4rem .8rem;font-size:.8rem;color:#888">No results.</div>';
      } else {
        searchRes.innerHTML = results.map(r => {
          const cat = cats.find(c => c.id === r.categoryId);
          return `<div class="browser-hit" data-cat="${esc(r.categoryId)}" data-code="${esc(r.code)}">
            <span class="tag tag-code">${esc(r.code)}</span>
            <span class="dd-en">${esc(r.en)}</span>
            ${cat ? `<span class="tag tag-cat">${cat.icon || ''} ${esc(cat.nameEn)}</span>` : ''}
          </div>`;
        }).join('');
      }
      searchRes.classList.remove('hidden');
    }, 200);
  });
  searchRes?.addEventListener('click', e => {
    const hit = e.target.closest('.browser-hit');
    if (!hit) return;
    navigate({ page: 'browser', categoryId: hit.dataset.cat });
  });
  el.addEventListener('click', e => {
    if (!e.target.closest('#quad-icd-search') && !e.target.closest('#quad-icd-results'))
      searchRes?.classList.add('hidden');
  });

  /* Recently used items — navigate to browser with that category */
  el.querySelectorAll('.quad-icd-recent-item').forEach(item => {
    item.addEventListener('click', () => navigate({ page: 'browser', categoryId: item.dataset.cat }));
  });
  el.querySelector('[data-nav]')?.addEventListener('click', () => navigate('browser'));
}

function _renderQuadSoap(el, icdData) {
  if (!el) return;
  const cats = icdData?.categories || [];
  const recentTerms = getRecentSoapTerms ? getRecentSoapTerms(12) : [];

  el.innerHTML = `
    <div style="font-size:.78rem;color:var(--color-muted);margin-bottom:.4rem">
      Click a category to open SOAP templates, or see recent terms below.
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:.5rem">
      ${cats.slice(0, 8).map(c => `
        <button class="btn btn-outline" style="font-size:.72rem;padding:.22rem .45rem"
          data-cat="${esc(c.id)}" title="${esc(c.nameEn)} / ${esc(c.nameZh)}">
          ${c.icon || ''} ${esc(c.nameEn.split('/')[0].slice(0, 14))}
        </button>`).join('')}
    </div>
    ${recentTerms.length ? `
      <div class="card">
        <div class="card-title">📊 Recent SOAP Terms</div>
        ${recentTerms.map(t => {
          const termText = t.term.split(':')[0].trim();
          return `<div class="quad-soap-term">
            <span class="tag tag-default" style="font-size:.7rem">${esc(t.section.toUpperCase())}</span>
            <span>${esc(termText)}</span>
            ${t.count > 0 ? `<span class="freq-badge" style="margin-left:auto">×${t.count}</span>` : ''}
          </div>`;
        }).join('')}
      </div>` : '<p style="font-size:.78rem;color:#888">No SOAP history yet.</p>'}
    <button class="quad-open-btn" style="margin-top:.5rem">📋 Open Full SOAP Templates →</button>`;

  el.querySelectorAll('[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => navigate({ page: 'soap', categoryId: btn.dataset.cat }));
  });
  el.querySelector('.quad-open-btn')?.addEventListener('click', () => navigate('soap'));
}

/* ============================================================ */
/* Bootstrap                                                     */
/* ============================================================ */

async function boot() {
  const navLinks = document.getElementById('nav-links');
  if (navLinks) {
    const pages = [
      { page: 'quad',      label: '🔲 Quad View'      },
      { page: 'dashboard', label: '🏠 Home'            },
      { page: 'log',       label: '📝 New Entry'       },
      { page: 'browser',   label: '🔍 ICD Browser'     },
      { page: 'soap',      label: '📋 SOAP Templates'  },
      { page: 'stats',     label: '📊 Medical Stats'   },
      { page: 'settings',  label: '⚙️ Settings'        },
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

  /* Restore saved entries from repo session files (runs once) */
  const restored = await restoreSessionsFromRepo();
  if (restored > 0) {
    showToast('success', `📂 Restored ${restored} saved entries from repo.`);
    renderDashboard();
  }
}

document.addEventListener('DOMContentLoaded', boot);

/* ============================================================ */
export function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
