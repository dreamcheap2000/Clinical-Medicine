/**
 * report-list.js
 * Renders the searchable, filterable table of saved reports.
 * Also handles the detail modal and delete action.
 */

import { getReports, deleteReport, EXAM_TYPES } from '../app.js';

export function renderList() {
  const container = document.getElementById('main-content');
  container.innerHTML = `
    <h2 class="page-title">📋 Report Archive</h2>
    <div class="card">
      <div class="search-bar">
        <input type="text"   id="search-input"  class="form-control" placeholder="🔍  Search patient, finding, tag…">
        <select id="filter-type" class="form-control">
          <option value="">All Exam Types</option>
          ${Object.entries(EXAM_TYPES).map(([k,v]) => `<option value="${k}">${v.title}</option>`).join('')}
        </select>
        <input type="date" id="filter-date-from" class="form-control" title="From date">
        <input type="date" id="filter-date-to"   class="form-control" title="To date">
        <button class="btn btn-secondary btn-sm" id="btn-clear-filter">✕ Clear</button>
      </div>
      <div class="report-table-wrap">
        <table class="report-table" id="report-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Patient ID</th>
              <th>Exam Type</th>
              <th>Tags / Findings</th>
              <th>Impression</th>
              <th style="text-align:center">Actions</th>
            </tr>
          </thead>
          <tbody id="report-tbody"></tbody>
        </table>
      </div>
      <div id="list-footer" style="font-size:.8rem;color:var(--color-muted);margin-top:.6rem;"></div>
    </div>
  `;

  wireFilters();
  renderRows();
}

/* ------------------------------------------------------------------ */
/* Filtering & rendering                                                */
/* ------------------------------------------------------------------ */

function getFilters() {
  return {
    query:    (document.getElementById('search-input')?.value    || '').toLowerCase(),
    type:      document.getElementById('filter-type')?.value      || '',
    dateFrom:  document.getElementById('filter-date-from')?.value || '',
    dateTo:    document.getElementById('filter-date-to')?.value   || '',
  };
}

function matchesFilters(report, { query, type, dateFrom, dateTo }) {
  if (type && report.examType !== type) return false;
  if (dateFrom && report.examDate < dateFrom) return false;
  if (dateTo   && report.examDate > dateTo)   return false;

  if (query) {
    const hay = [
      report.patientId, report.patientName, report.examTitle,
      ...(report.tags || []),
      report.fields?.impression_text || ''
    ].join(' ').toLowerCase();
    if (!hay.includes(query)) return false;
  }
  return true;
}

function renderRows() {
  const tbody = document.getElementById('report-tbody');
  if (!tbody) return;

  const filters = getFilters();
  const reports = getReports()
    .filter(r => matchesFilters(r, filters))
    .sort((a, b) => b.examDate.localeCompare(a.examDate) || b.createdAt.localeCompare(a.createdAt));

  if (reports.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="no-records">No reports match your criteria.</td></tr>`;
    document.getElementById('list-footer').textContent = '';
    return;
  }

  tbody.innerHTML = reports.map(r => {
    const tagHtml = (r.tags || []).length
      ? r.tags.map(t => `<span class="tag tag-abnormal">${esc(t)}</span>`).join(' ')
      : '<span class="tag tag-normal">Normal / No flags</span>';

    const imp = r.fields?.impression_text || '';
    const impShort = imp.length > 70 ? imp.slice(0, 70) + '…' : imp;

    return `<tr>
      <td>${esc(r.examDate)}</td>
      <td>${esc(r.patientId || '—')}</td>
      <td><span class="tag tag-default">${esc(r.examTitle || r.examType)}</span></td>
      <td>${tagHtml}</td>
      <td title="${esc(imp)}">${esc(impShort) || '<em style="color:var(--color-muted)">—</em>'}</td>
      <td style="text-align:center;white-space:nowrap">
        <button class="btn btn-outline btn-sm" data-action="view"   data-id="${r.id}">🔍 View</button>
        <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${r.id}">✏️</button>
        <button class="btn btn-danger btn-sm"   data-action="delete" data-id="${r.id}">🗑️</button>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('list-footer').textContent =
    `Showing ${reports.length} of ${getReports().length} report(s).`;

  // Wire row buttons
  tbody.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const { action, id } = btn.dataset;
      if (action === 'view')   openDetailModal(id);
      if (action === 'edit')   window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'edit', id } }));
      if (action === 'delete') confirmDelete(id);
    });
  });
}

function wireFilters() {
  ['search-input','filter-type','filter-date-from','filter-date-to'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderRows);
    document.getElementById(id)?.addEventListener('change', renderRows);
  });
  document.getElementById('btn-clear-filter')?.addEventListener('click', () => {
    document.getElementById('search-input').value    = '';
    document.getElementById('filter-type').value     = '';
    document.getElementById('filter-date-from').value = '';
    document.getElementById('filter-date-to').value   = '';
    renderRows();
  });
}

/* ------------------------------------------------------------------ */
/* Detail modal                                                         */
/* ------------------------------------------------------------------ */

function openDetailModal(id) {
  const report = getReports().find(r => r.id === id);
  if (!report) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div>
          <h2 style="font-size:1.15rem">${esc(report.examTitle || report.examType)}</h2>
          <div style="font-size:.8rem;color:var(--color-muted);margin-top:.2rem">
            ${esc(report.examDate)} &nbsp;·&nbsp; ID: ${esc(report.id)}
            &nbsp;·&nbsp; Template v${esc(report.templateVersion)}
          </div>
        </div>
        <button class="modal-close" id="modal-close-btn">✕</button>
      </div>

      <div class="detail-section">
        <h4>Patient</h4>
        <p>${esc(report.patientName || '—')} &nbsp;(${esc(report.patientId || '—')})</p>
      </div>

      <div class="detail-section">
        <h4>Classifications / Tags</h4>
        <p>${(report.tags || []).length
              ? report.tags.map(t => `<span class="tag tag-abnormal">${esc(t)}</span>`).join(' ')
              : '<span class="tag tag-normal">No abnormalities flagged</span>'}</p>
      </div>

      <div class="detail-section">
        <h4>All Fields</h4>
        <table style="width:100%;font-size:.875rem;border-collapse:collapse">
          ${Object.entries(report.fields || {}).map(([k, v]) => `
            <tr>
              <td style="padding:.3rem .5rem;font-weight:600;white-space:nowrap;color:var(--color-muted);width:35%">${esc(k.replace(/_/g,' '))}</td>
              <td style="padding:.3rem .5rem">${esc(Array.isArray(v) ? v.join(', ') : v)}</td>
            </tr>`).join('')}
        </table>
      </div>

      <div class="detail-section">
        <h4>Impression</h4>
        <p style="white-space:pre-wrap">${esc(report.fields?.impression_text || '—')}</p>
      </div>

      <div class="form-actions">
        <button class="btn btn-outline" id="modal-edit-btn">✏️ Edit</button>
        <button class="btn btn-secondary" id="modal-close-btn2">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('modal-close-btn').addEventListener('click', close);
  document.getElementById('modal-close-btn2').addEventListener('click', close);
  document.getElementById('modal-edit-btn').addEventListener('click', () => {
    close();
    window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'edit', id } }));
  });
}

/* ------------------------------------------------------------------ */
/* Delete                                                               */
/* ------------------------------------------------------------------ */

function confirmDelete(id) {
  const report = getReports().find(r => r.id === id);
  if (!report) return;
  if (!confirm(`Delete report for ${report.patientId || 'patient'} (${report.examDate})? This cannot be undone.`)) return;
  deleteReport(id);
  renderRows();
  window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'info', msg: 'Report deleted.' } }));
}

/* ------------------------------------------------------------------ */

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
