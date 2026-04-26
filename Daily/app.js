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
  quadView:      'Shift+Q',  /* Jump to quad view */
  quadNewEntry:  'Shift+N',  /* Build new entry from quad view */
};

const SOAP_SECTION_ORDER = ['s', 'o', 'a', 'p'];
const SOAP_SECTION_LABEL = { s: 'S', o: 'O', a: 'A', p: 'P' };

function _normalizeSoapTerm(term) {
  const t = String(term || '').trim();
  if (!t) return '';
  const head = t.includes(':') ? t.slice(0, t.indexOf(':')).trim() : t;
  return head.endsWith(':') ? head : `${head}:`;
}

export function buildSectionedSoapInsert(items = []) {
  const grouped = { s: [], o: [], a: [], p: [] };
  for (const item of items) {
    const section = SOAP_SECTION_ORDER.includes(item?.section) ? item.section : 's';
    const term = _normalizeSoapTerm(item?.term);
    if (!term) continue;
    grouped[section].push(term);
  }
  const blocks = [];
  for (const section of SOAP_SECTION_ORDER) {
    if (!grouped[section].length) continue;
    const dedup = [...new Set(grouped[section])];
    blocks.push(`${SOAP_SECTION_LABEL[section]}:\n${dedup.join('\n')}`);
  }
  return blocks.join('\n\n');
}

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
      ${_quadPanel('tl','💡 Key Learning Point / EBM Statement', 'quad-home',  'dashboard')}
      ${_quadPanel('tr','📝 SOAP Note', 'quad-entry', 'log')}
      ${_quadPanel('bl','🔍 ICD Browser','quad-icd',   'browser')}
      ${_quadPanel('br','📋 SOAP Templates','quad-soap','soap')}
    </div>`;

  /* Wire up header interactions */
  container.querySelectorAll('.quad-panel').forEach(panel => {
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

  const buildFromQuad = () => {
    // FIX: Grab current values directly from DOM instead of relying only on sessionStorage
    const ebm = (document.getElementById('quad-ebm-input')?.value || '').trim();
    const soap = (document.getElementById('quad-soap-input')?.value || '').trim();

    // ... rest of the existing logic to handle checkboxes and navigate ...
    const icdJson = sessionStorage.getItem('quad_icd_checked') || '[]';
    const soapCheckedJson = sessionStorage.getItem('quad_soap_checked') || '[]';
    let icdChecked = [];
    let soapChecked = [];
    try { icdChecked = JSON.parse(icdJson); } catch { icdChecked = []; }
    try { soapChecked = JSON.parse(soapCheckedJson); } catch { soapChecked = []; }

    if (icdChecked.length) {
      sessionStorage.setItem('prefill_icd', JSON.stringify(icdChecked[0]));
      if (icdChecked.length > 1) sessionStorage.setItem('prefill_icd_extra', JSON.stringify(icdChecked.slice(1)));
      else sessionStorage.removeItem('prefill_icd_extra');
    }

    const groupedSoap = buildSectionedSoapInsert(soapChecked.map(x => ({ section: x.section, term: x.term })));
    const composedSoap = [soap, groupedSoap].filter(Boolean).join('

').trim();
    if (composedSoap) sessionStorage.setItem('prefill_soap_text', composedSoap);
    if (ebm) sessionStorage.setItem('prefill_key_learning', ebm);
    navigate('log');
};;;

  container.querySelectorAll('#quad-new-entry-btn,#quad-new-entry-from-ebm').forEach(btn => {
    btn.addEventListener('click', buildFromQuad);
  });

  if (window._quadKeyAbort) window._quadKeyAbort.abort();
  window._quadKeyAbort = new AbortController();
  window.addEventListener('keydown', e => {
    if (isTypingInput(e.target)) return;
    if (matchShortcut(e, getShortcutKeys().quadNewEntry)) {
      e.preventDefault();
      buildFromQuad();
    }
  }, { signal: window._quadKeyAbort.signal });

  const _quadAutosaveTimer = setInterval(() => {
    const ebmText = container.querySelector('#quad-ebm-input')?.value || '';
    const soapText = container.querySelector('#quad-soap-input')?.value || '';
    sessionStorage.setItem('quad_ebm_statement', ebmText);
    sessionStorage.setItem('quad_soap_note', soapText);
  }, 20000);

  /* Cleanup padding on navigate away */
  const origPad = '';
  const _restoreStyle = () => {
    clearInterval(_quadAutosaveTimer);
    if (window._quadKeyAbort) { window._quadKeyAbort.abort(); window._quadKeyAbort = null; }
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
  const ebm = sessionStorage.getItem('quad_ebm_statement') || '';

  el.innerHTML = `
    <p class="hint" style="margin-bottom:.45rem">Auto-saved every 20 seconds.</p>
    <textarea class="field-input field-textarea" id="quad-ebm-input" rows="16"
      placeholder="Key learning points / EBM statement...">${esc(ebm)}</textarea>
    <div style="margin-top:.45rem;display:flex;gap:.35rem;align-items:center;flex-wrap:wrap">
      <button class="quad-open-btn" id="quad-new-entry-from-ebm">📝 New Entry (Shift+N)</button>
      <span class="hint">This content is passed into the New Entry form.</span>
    </div>`;

  const ta = el.querySelector('#quad-ebm-input');
  ta?.addEventListener('input', () => sessionStorage.setItem('quad_ebm_statement', ta.value));
}

function _renderQuadEntry(el) {
  if (!el) return;
  const soap = sessionStorage.getItem('quad_soap_note') || '';
  el.innerHTML = `
    <p class="hint" style="margin-bottom:.45rem">Editable SOAP note with template save/load.</p>
    <textarea class="field-input field-textarea" id="quad-soap-input" rows="12"
      placeholder="SOAP note...">${esc(soap)}</textarea>
    <div style="margin-top:.45rem;display:flex;gap:.35rem;flex-wrap:wrap;align-items:center">
      <button class="btn btn-outline" id="quad-save-soap-template">💾 Save Template</button>
      <button class="btn btn-outline" id="quad-load-soap-template">📂 Load Template</button>
      <button class="quad-open-btn" id="quad-new-entry-btn">📝 New Entry (Shift+N)</button>
    </div>`;

  const ta = el.querySelector('#quad-soap-input');
  ta?.addEventListener('input', () => sessionStorage.setItem('quad_soap_note', ta.value));

  el.querySelector('#quad-save-soap-template')?.addEventListener('click', () => {
    const text = (ta?.value || '').trim();
    if (!text) { showToast('info', 'SOAP note is empty.'); return; }
    const name = prompt('Template name:');
    if (!name?.trim()) return;
    saveSoapTemplate({
      id: `tmpl-${typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : Date.now().toString(36)}`,
      name: name.trim(),
      text,
      createdAt: new Date().toISOString(),
    });
    showToast('success', 'Template saved.');
  });

  el.querySelector('#quad-load-soap-template')?.addEventListener('click', () => {
    const templates = getSoapTemplates();
    if (!templates.length) { showToast('info', 'No saved templates yet.'); return; }
    const input = prompt(`Choose template number:\n${templates.map((t, i) => `${i + 1}. ${t.name}`).join('\n')}`);
    const idx = Number(input) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= templates.length) return;
    ta.value = templates[idx].text || '';
    sessionStorage.setItem('quad_soap_note', ta.value);
  });
}

function _renderQuadIcd(el, icdData) {
  if (!el) return;
  const freq  = getIcdFreq();
  const top10 = Object.values(freq).sort((a, b) => b.count - a.count).slice(0, 10);
  const selected = new Map();
  try {
    for (const item of JSON.parse(sessionStorage.getItem('quad_icd_checked') || '[]')) {
      if (item?.code) selected.set(item.code, item);
    }
  } catch { /* ignore */ }

  if (!icdData) {
    el.innerHTML = `<p style="color:red;font-size:.8rem">⚠ ICD data failed to load.</p>`;
    return;
  }

  const allCats = icdData.categories || [];
  let shownCats = allCats.slice(0, 10);
  try {
    const saved = JSON.parse(localStorage.getItem('quad_icd_categories') || 'null');
    if (Array.isArray(saved) && saved.length) {
      shownCats = allCats.filter(c => saved.includes(c.id)).slice(0, 10);
    }
  } catch { /* ignore */ }

  function persistSelected() {
    sessionStorage.setItem('quad_icd_checked', JSON.stringify([...selected.values()]));
  }

  function renderCatCodes(catId) {
    const codes = (icdData.codeLookup?.[catId] || []).slice(0, 300);
    const listEl = el.querySelector('#quad-icd-codes-list');
    if (!listEl) return;
    listEl.innerHTML = codes.map(c => `
      <label class="quad-soap-term">
        <input type="checkbox" class="quad-icd-check" data-code="${esc(c.code)}" data-en="${esc(c.en)}" data-zh="${esc(c.zh)}" data-cat="${esc(catId)}"
          ${selected.has(c.code) ? 'checked' : ''}>
        <span class="tag tag-code">${esc(c.code)}</span>
        <span>${esc(c.en)}</span>
      </label>
    `).join('') || '<p class="hint">No category codes.</p>';

    listEl.querySelectorAll('.quad-icd-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const item = { code: cb.dataset.code, en: cb.dataset.en || '', zh: cb.dataset.zh || '', categoryId: cb.dataset.cat || '' };
        if (cb.checked) selected.set(item.code, item);
        else selected.delete(item.code);
        persistSelected();
      });
    });
  }

  el.innerHTML = `
    <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:.45rem">
      ${shownCats.map(c => `<button class="btn btn-outline quad-icd-cat" data-cat="${esc(c.id)}">${c.icon || ''} ${esc(c.nameEn.slice(0, 12))}</button>`).join('')}
      <button class="btn btn-sm-inline" id="quad-icd-cats-edit">⚙️ Edit</button>
    </div>
    <div class="browser-search-wrap" style="margin-bottom:.5rem">
      <input class="field-input" id="quad-icd-search" type="text" style="width:100%"
        placeholder="Search ICD code or name…">
      <div id="quad-icd-results" class="browser-search-results hidden"></div>
    </div>
    <div class="quad-icd-recent">
      <div class="quad-icd-recent-title">⏱ Recently Used (checkable)</div>
      ${top10.length === 0
        ? '<p style="font-size:.78rem;color:#888">No history yet.</p>'
        : top10.map(c => `
          <label class="quad-icd-recent-item" data-cat="${esc(c.categoryId)}" data-code="${esc(c.code)}">
            <input type="checkbox" class="quad-icd-check" data-code="${esc(c.code)}" data-en="${esc(c.en)}" data-zh="${esc(c.zh)}" data-cat="${esc(c.categoryId)}"
              ${selected.has(c.code) ? 'checked' : ''}>
            <span class="tag tag-code">${esc(c.code)}</span>
            <span>${esc(c.en.split(/[,:]/, 1)[0].slice(0, 36))}</span>
            <span class="freq-badge" style="margin-left:auto">×${c.count}</span>
          </label>`).join('')}
    </div>
    <div id="quad-icd-codes-list" style="max-height:160px;overflow:auto;border:1px solid var(--color-border);border-radius:6px;padding:.3rem;margin-top:.45rem"></div>
    <button class="quad-open-btn" style="margin-top:.5rem" data-nav="browser">🔍 Open Full ICD Browser →</button>`;

  el.querySelectorAll('.quad-icd-cat').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.quad-icd-cat').forEach(b => b.classList.remove('btn-active'));
      btn.classList.add('btn-active');
      renderCatCodes(btn.dataset.cat);
    });
  });
  if (shownCats[0]) {
    el.querySelector(`.quad-icd-cat[data-cat="${shownCats[0].id}"]`)?.classList.add('btn-active');
    renderCatCodes(shownCats[0].id);
  }

  el.querySelector('#quad-icd-cats-edit')?.addEventListener('click', () => {
    const ids = prompt('Enter up to 10 category IDs (comma separated):', shownCats.map(c => c.id).join(','));
    if (!ids) return;
    const picked = ids.split(',').map(x => x.trim()).filter(Boolean).slice(0, 10);
    localStorage.setItem('quad_icd_categories', JSON.stringify(picked));
    _renderQuadIcd(el, icdData);
  });

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
    const item = { code: hit.dataset.code, en: hit.querySelector('.dd-en')?.textContent || '', zh: '', categoryId: hit.dataset.cat || '' };
    selected.set(item.code, item);
    persistSelected();
    showToast('success', `Added ${item.code}`);
  });
  el.addEventListener('click', e => {
    if (!e.target.closest('#quad-icd-search') && !e.target.closest('#quad-icd-results'))
      searchRes?.classList.add('hidden');
  });

  el.querySelectorAll('.quad-icd-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const item = { code: cb.dataset.code, en: cb.dataset.en || '', zh: cb.dataset.zh || '', categoryId: cb.dataset.cat || '' };
      if (cb.checked) selected.set(item.code, item);
      else selected.delete(item.code);
      persistSelected();
    });
  });
  el.querySelector('[data-nav]')?.addEventListener('click', () => navigate('browser'));
}

function _renderQuadSoap(el, icdData) {
  if (!el) return;
  const cats = icdData?.categories || [];
  const recentTerms = getRecentSoapTerms ? getRecentSoapTerms(20) : [];
  const selected = new Map();
  try {
    for (const item of JSON.parse(sessionStorage.getItem('quad_soap_checked') || '[]')) {
      if (item?.section && item?.term) selected.set(`${item.section}|${item.term}`, item);
    }
  } catch { /* ignore */ }

  let shownCats = cats.slice(0, 10);
  try {
    const saved = JSON.parse(localStorage.getItem('quad_soap_categories') || 'null');
    if (Array.isArray(saved) && saved.length) shownCats = cats.filter(c => saved.includes(c.id)).slice(0, 10);
  } catch { /* ignore */ }

  function persistSelected() {
    sessionStorage.setItem('quad_soap_checked', JSON.stringify([...selected.values()]));
  }

  function renderCatTerms(catId) {
    const cat = cats.find(c => c.id === catId);
    const soap = cat?.soap || {};
    const pe = cat?.physicalExam || {};
    const terms = [
      ...(soap.subjective || []).map(t => ({ section: 's', term: t })),
      ...buildCombinedObjective(soap, pe).map(t => ({ section: 'o', term: t })),
      ...(soap.assessment_pearls || []).map(t => ({ section: 'a', term: t })),
      ...(soap.plan_template || []).map(t => ({ section: 'p', term: t })),
    ];
    const list = el.querySelector('#quad-soap-terms-list');
    if (!list) return;
    list.innerHTML = terms.map(t => {
      const key = `${t.section}|${t.term}`;
      const label = t.term.split(':')[0].trim();
      return `<label class="quad-soap-term"><input type="checkbox" class="quad-soap-check" data-sec="${esc(t.section)}" data-term="${esc(t.term)}" ${selected.has(key) ? 'checked' : ''}><span class="tag tag-default" style="font-size:.7rem">${esc(t.section.toUpperCase())}</span><span>${esc(label)}</span></label>`;
    }).join('') || '<p class="hint">No terms in this category.</p>';
    list.querySelectorAll('.quad-soap-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const item = { section: cb.dataset.sec || 's', term: cb.dataset.term || '' };
        const key = `${item.section}|${item.term}`;
        if (cb.checked) selected.set(key, item);
        else selected.delete(key);
        persistSelected();
      });
    });
  }

  el.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:.5rem">
      ${shownCats.map(c => `
        <button class="btn btn-outline quad-soap-cat" style="font-size:.72rem;padding:.22rem .45rem"
          data-cat="${esc(c.id)}" title="${esc(c.nameEn)} / ${esc(c.nameZh)}">
          ${c.icon || ''} ${esc(c.nameEn.split('/')[0].slice(0, 14))}
        </button>`).join('')}
      <button class="btn btn-sm-inline" id="quad-soap-cats-edit">⚙️ Edit</button>
    </div>
    ${recentTerms.length ? `<div class="card"><div class="card-title">📊 Recent SOAP Terms (checkable)</div>
      ${recentTerms.map(t => {
        const key = `${t.section}|${t.term}`;
        const termText = t.term.split(':')[0].trim();
        return `<label class="quad-soap-term"><input type="checkbox" class="quad-soap-check" data-sec="${esc(t.section)}" data-term="${esc(t.term)}" ${selected.has(key) ? 'checked' : ''}><span class="tag tag-default" style="font-size:.7rem">${esc(t.section.toUpperCase())}</span><span>${esc(termText)}</span>${t.count > 0 ? `<span class="freq-badge" style="margin-left:auto">×${t.count}</span>` : ''}</label>`;
      }).join('')}
    </div>` : '<p style="font-size:.78rem;color:#888">No SOAP history yet.</p>'}
    <div id="quad-soap-terms-list" style="max-height:160px;overflow:auto;border:1px solid var(--color-border);border-radius:6px;padding:.3rem"></div>
    <button class="quad-open-btn" style="margin-top:.5rem">📋 Open Full SOAP Templates →</button>`;

  el.querySelectorAll('.quad-soap-cat').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.quad-soap-cat').forEach(b => b.classList.remove('btn-active'));
      btn.classList.add('btn-active');
      renderCatTerms(btn.dataset.cat);
    });
  });
  if (shownCats[0]) {
    el.querySelector(`.quad-soap-cat[data-cat="${shownCats[0].id}"]`)?.classList.add('btn-active');
    renderCatTerms(shownCats[0].id);
  }

  el.querySelector('#quad-soap-cats-edit')?.addEventListener('click', () => {
    const ids = prompt('Enter up to 10 category IDs (comma separated):', shownCats.map(c => c.id).join(','));
    if (!ids) return;
    const picked = ids.split(',').map(x => x.trim()).filter(Boolean).slice(0, 10);
    localStorage.setItem('quad_soap_categories', JSON.stringify(picked));
    _renderQuadSoap(el, icdData);
  });

  el.querySelectorAll('.quad-soap-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const item = { section: cb.dataset.sec || 's', term: cb.dataset.term || '' };
      const key = `${item.section}|${item.term}`;
      if (cb.checked) selected.set(key, item);
      else selected.delete(key);
      persistSelected();
    });
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
  window.addEventListener('keydown', e => {
    if (isTypingInput(e.target)) return;
    if (matchShortcut(e, getShortcutKeys().quadView)) {
      e.preventDefault();
      navigate('quad');
    }
  });

  navigate('dashboard');

  /* Restore saved entries from repo session files (runs once) */
  const restored = await restoreSessionsFromRepo();
  if (restored > 0) {
    showToast('success', `📂 Restored ${restored} saved entries from repo.`);
    renderDashboard();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  boot().catch(err => {
    console.error('Boot error:', err);
    const c = document.getElementById('main-content');
    if (c) {
      const msg = String(err?.message || err);
      c.innerHTML = `<div style="padding:2rem;color:#ff5252">
        <b>⚠️ Application failed to start.</b><br>
        <code style="font-size:.85rem">${esc(msg)}</code><br>
        <button id="btn-boot-reload" style="margin-top:1rem;padding:.4rem 1rem;cursor:pointer">🔄 Reload</button>
      </div>`;
      c.querySelector('#btn-boot-reload').addEventListener('click', () => location.reload());
    }
  });
});

/* ============================================================ */
export function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
