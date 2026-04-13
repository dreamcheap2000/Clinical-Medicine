/**
 * app.js
 * Core application: state management, routing, template loading,
 * localStorage persistence.
 */

import { renderForm }       from './modules/report-form.js';
import { renderList }       from './modules/report-list.js';
import { renderStatistics } from './modules/statistics.js';

/* ================================================================== */
/* Exam type registry                                                   */
/* ================================================================== */

export const EXAM_TYPES = {
  ultrasound_injection: { title: 'Ultrasound-Guided Injection',              icon: '💉', file: 'templates/ultrasound_injection.json' },
  neck_doppler:         { title: 'Color-Coded US & Doppler (Neck)',          icon: '🫀', file: 'templates/neck_doppler.json'          },
  tccs:                 { title: 'Transcranial Color-Coded Sonography (TCCS)', icon: '🧠', file: 'templates/tccs.json'                },
  eeg:                  { title: 'Electroencephalography (EEG)',              icon: '⚡', file: 'templates/eeg.json'                  },
  ncv_emg:              { title: 'NCV / EMG',                                icon: '🔬', file: 'templates/ncv_emg.json'              },
};

/* ================================================================== */
/* LocalStorage persistence                                            */
/* ================================================================== */

const STORAGE_KEY = 'clinicalReports_v1';

export function getReports() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveReport(report) {
  const reports = getReports();
  const idx     = reports.findIndex(r => r.id === report.id);
  if (idx >= 0) {
    reports[idx] = report;
  } else {
    reports.push(report);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
}

export function deleteReport(id) {
  const reports = getReports().filter(r => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
}

export function exportReportsJSON() {
  const data = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    reports: getReports(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `clinical-reports-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importReportsJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => {
      try {
        const data    = JSON.parse(e.target.result);
        const incoming = Array.isArray(data) ? data : (data.reports || []);
        const existing = getReports();
        const merged   = [...existing];
        let   added    = 0;
        for (const r of incoming) {
          if (!merged.find(x => x.id === r.id)) {
            merged.push(r);
            added++;
          }
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        resolve(added);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/* ================================================================== */
/* Template cache                                                       */
/* ================================================================== */

const _templateCache = {};

export async function loadTemplate(examType) {
  if (_templateCache[examType]) return _templateCache[examType];
  const info = EXAM_TYPES[examType];
  if (!info) throw new Error(`Unknown exam type: ${examType}`);
  const res  = await fetch(info.file);
  if (!res.ok) throw new Error(`Failed to load template: ${info.file}`);
  const tmpl = await res.json();
  _templateCache[examType] = tmpl;
  return tmpl;
}

/* ================================================================== */
/* Router                                                               */
/* ================================================================== */

let _currentPage = 'dashboard';

export function navigate(target) {
  // target is either a string ('dashboard','list','new','stats')
  // or an object { page: 'edit', id: '...' } or { page: 'new', examType: '...' }
  if (typeof target === 'string') {
    _currentPage = target;
    renderPage(target);
  } else {
    _currentPage = target.page;
    renderPage(target);
  }
  updateNav(_currentPage);
}

function renderPage(target) {
  const page = typeof target === 'string' ? target : target.page;

  switch (page) {
    case 'dashboard':
      renderDashboard();
      break;
    case 'list':
      renderList();
      break;
    case 'stats':
      renderStatistics();
      break;
    case 'new':
      if (target.examType) {
        loadTemplate(target.examType).then(tmpl => renderForm(tmpl, null)).catch(showError);
      } else {
        renderExamTypeSelector();
      }
      break;
    case 'edit':
      if (target.id) {
        const report = getReports().find(r => r.id === target.id);
        if (!report) { showError('Report not found.'); return; }
        loadTemplate(report.examType).then(tmpl => renderForm(tmpl, target.id)).catch(showError);
      }
      break;
    default:
      renderDashboard();
  }
}

function updateNav(page) {
  document.querySelectorAll('#nav-links button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });
}

/* ================================================================== */
/* Dashboard (home)                                                     */
/* ================================================================== */

function renderDashboard() {
  const reports       = getReports();
  const totalReports  = reports.length;
  const totalAbnormal = reports.filter(r => r.tags && r.tags.length > 0).length;
  const uniquePts     = new Set(reports.map(r => r.patientId).filter(Boolean)).size;

  // Last 5 reports
  const recent = [...reports]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  const container = document.getElementById('main-content');
  container.innerHTML = `
    <h2 class="page-title" style="margin-bottom:1rem">🏥 Clinical Exam Report System</h2>

    <!-- Quick stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${totalReports}</div>
        <div class="stat-label">Total Reports</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${uniquePts}</div>
        <div class="stat-label">Unique Patients</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${totalAbnormal}</div>
        <div class="stat-label">Abnormal Findings</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${Object.keys(EXAM_TYPES).length}</div>
        <div class="stat-label">Exam Types</div>
      </div>
    </div>

    <!-- New report shortcuts -->
    <div class="card">
      <div class="card-title">➕ New Report</div>
      <div class="exam-type-grid">
        ${Object.entries(EXAM_TYPES).map(([k, v]) => `
          <div class="exam-type-card" data-exam="${k}">
            <div class="exam-icon">${v.icon}</div>
            <div class="exam-name">${v.title}</div>
          </div>`).join('')}
      </div>
    </div>

    <!-- Recent reports -->
    <div class="card">
      <div class="card-title">🕐 Recent Reports</div>
      ${recent.length === 0
        ? '<p class="no-records">No reports yet. Create your first report above.</p>'
        : `<table class="report-table">
            <thead><tr><th>Date</th><th>Patient ID</th><th>Exam Type</th><th>Tags</th></tr></thead>
            <tbody>
              ${recent.map(r => `
                <tr>
                  <td>${esc(r.examDate)}</td>
                  <td>${esc(r.patientId || '—')}</td>
                  <td><span class="tag tag-default">${esc(r.examTitle || r.examType)}</span></td>
                  <td>${(r.tags || []).length
                    ? r.tags.slice(0, 3).map(t => `<span class="tag tag-abnormal">${esc(t)}</span>`).join(' ')
                    : '<span class="tag tag-normal">Normal</span>'}</td>
                </tr>`).join('')}
            </tbody>
          </table>`}
    </div>

    <!-- Data management -->
    <div class="card">
      <div class="card-title">💾 Data Management</div>
      <div style="display:flex;gap:.7rem;flex-wrap:wrap;align-items:center">
        <button class="btn btn-outline" id="btn-export">⬇️ Export JSON</button>
        <label class="btn btn-outline" style="cursor:pointer">
          ⬆️ Import JSON
          <input type="file" id="import-file" accept=".json" style="display:none">
        </label>
        <span style="font-size:.8rem;color:var(--color-muted)">Data is stored in your browser's localStorage.</span>
      </div>
    </div>
  `;

  // Wire exam type cards
  container.querySelectorAll('.exam-type-card').forEach(card => {
    card.addEventListener('click', () => navigate({ page: 'new', examType: card.dataset.exam }));
  });

  // Export / Import
  document.getElementById('btn-export').addEventListener('click', exportReportsJSON);
  document.getElementById('import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const added = await importReportsJSON(file);
      showToast('success', `Imported ${added} new report(s).`);
      renderDashboard();
    } catch (err) {
      showToast('error', `Import failed: ${err.message}`);
    }
  });
}

/* ================================================================== */
/* Exam type selector (intermediate step for "new report")             */
/* ================================================================== */

function renderExamTypeSelector() {
  const container = document.getElementById('main-content');
  container.innerHTML = `
    <h2 class="page-title">➕ Select Exam Type</h2>
    <div class="exam-type-grid">
      ${Object.entries(EXAM_TYPES).map(([k, v]) => `
        <div class="exam-type-card" data-exam="${k}">
          <div class="exam-icon">${v.icon}</div>
          <div class="exam-name">${v.title}</div>
        </div>`).join('')}
    </div>
  `;
  container.querySelectorAll('.exam-type-card').forEach(card => {
    card.addEventListener('click', () => navigate({ page: 'new', examType: card.dataset.exam }));
  });
}

/* ================================================================== */
/* Toast notifications                                                  */
/* ================================================================== */

function showToast(type, msg) {
  const tc = document.getElementById('toast-container');
  if (!tc) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  tc.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function showError(msg) {
  const container = document.getElementById('main-content');
  container.innerHTML = `<div class="card" style="color:var(--color-danger)">⚠️ ${esc(msg)}</div>`;
}

/* ================================================================== */
/* Bootstrap                                                            */
/* ================================================================== */

function boot() {
  // Build navbar links
  const navLinks = document.getElementById('nav-links');
  if (navLinks) {
    const pages = [
      { page: 'dashboard', label: '🏠 Home'       },
      { page: 'new',       label: '➕ New Report'  },
      { page: 'list',      label: '📋 Reports'     },
      { page: 'stats',     label: '📊 Statistics'  },
    ];
    navLinks.innerHTML = pages.map(p =>
      `<button data-page="${p.page}">${p.label}</button>`
    ).join('');
    navLinks.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => navigate(btn.dataset.page));
    });
  }

  // Global navigation event (fired by other modules)
  window.addEventListener('navigate', e => navigate(e.detail));

  // Global toast event
  window.addEventListener('toast', e => showToast(e.detail.type, e.detail.msg));

  // Initial render
  navigate('dashboard');
}

document.addEventListener('DOMContentLoaded', boot);

/* ------------------------------------------------------------------ */
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
