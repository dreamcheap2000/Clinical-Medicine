/**
 * report-form.js
 * Renders a dynamic form from a template JSON and handles save/suggest.
 */

import { classifyReport }          from './classifier.js';
import { getSuggestions }          from './template-engine.js';
import { getReports, saveReport }  from '../app.js';

let _template    = null;
let _editId      = null;   // non-null when editing an existing report

/**
 * Render the form for a given template into #main-content.
 * @param {Object} template - parsed template JSON
 * @param {string|null} editId - report ID to pre-populate (edit mode)
 */
export function renderForm(template, editId = null) {
  _template = template;
  _editId   = editId;

  const container = document.getElementById('main-content');
  const existing  = editId ? getReports().find(r => r.id === editId) : null;

  container.innerHTML = `
    <h2 class="page-title">
      ${editId ? '✏️ Edit Report' : '📝 New Report'} — ${template.title}
    </h2>
    <div id="suggestion-bar">
      <div class="suggestion-label">💡 Impression suggestions (based on similar records):</div>
      <div class="suggestion-chips" id="suggestion-chips">—</div>
    </div>
    <form id="report-form" autocomplete="off">
      ${template.sections.map(section => renderSection(section, existing)).join('')}
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">💾 Save Report</button>
        <button type="button" class="btn btn-secondary" id="btn-cancel">✕ Cancel</button>
      </div>
    </form>
  `;

  document.getElementById('report-form').addEventListener('submit', onSubmit);
  document.getElementById('btn-cancel').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'list' }));
  });

  // Wire suggestion engine: update on any input change
  container.querySelectorAll('input,select,textarea').forEach(el => {
    el.addEventListener('change', debounce(updateSuggestions, 400));
    el.addEventListener('input',  debounce(updateSuggestions, 400));
  });
}

/* ------------------------------------------------------------------ */
/* Section / Field renderers                                            */
/* ------------------------------------------------------------------ */

function renderSection(section, existing) {
  const fields = (section.fields || []).map(f => renderField(f, existing)).join('');
  return `
    <div class="section-header">${section.label || section.id}</div>
    ${fields}
  `;
}

function renderField(field, existing) {
  if (typeof field === 'string') {
    // Simple text field shorthand
    field = { id: field, label: field, type: 'text' };
  }
  const savedVal = existing ? (existing.fields[field.id] ?? '') : '';

  switch (field.type) {
    case 'select':       return renderSelect(field, savedVal);
    case 'multiselect':  return renderMultiselect(field, savedVal);
    case 'textarea':     return renderTextarea(field, savedVal);
    case 'number':       return renderNumber(field, savedVal);
    case 'date':         return renderDate(field, savedVal);
    default:             return renderText(field, savedVal);
  }
}

function labelHtml(field) {
  return `<label for="${field.id}">${field.label || field.id}${field.required ? '<span class="required">*</span>' : ''}</label>
          ${field.hint ? `<span class="hint">${field.hint}</span>` : ''}`;
}

function renderText(field, val) {
  return `<div class="form-group">
    ${labelHtml(field)}
    <input id="${field.id}" name="${field.id}" type="text"
           class="form-control" value="${esc(val)}"
           ${field.required ? 'required' : ''}>
  </div>`;
}

function renderNumber(field, val) {
  return `<div class="form-group">
    ${labelHtml(field)}
    <input id="${field.id}" name="${field.id}" type="number"
           class="form-control" value="${esc(val)}"
           ${field.min !== undefined ? `min="${field.min}"` : ''}
           ${field.max !== undefined ? `max="${field.max}"` : ''}
           step="any"
           ${field.required ? 'required' : ''}>
  </div>`;
}

function renderDate(field, val) {
  const today = new Date().toISOString().split('T')[0];
  return `<div class="form-group">
    ${labelHtml(field)}
    <input id="${field.id}" name="${field.id}" type="date"
           class="form-control" value="${esc(val) || today}"
           ${field.required ? 'required' : ''}>
  </div>`;
}

function renderSelect(field, val) {
  const options = (field.choices || []).map(c =>
    `<option value="${esc(c)}" ${c === val ? 'selected' : ''}>${esc(c)}</option>`
  ).join('');
  return `<div class="form-group">
    ${labelHtml(field)}
    <select id="${field.id}" name="${field.id}" class="form-control" ${field.required ? 'required' : ''}>
      <option value="">— select —</option>
      ${options}
    </select>
  </div>`;
}

function renderMultiselect(field, val) {
  const selected = Array.isArray(val) ? val : (val ? [val] : []);
  const boxes = (field.choices || []).map(c => `
    <label>
      <input type="checkbox" name="${field.id}" value="${esc(c)}" ${selected.includes(c) ? 'checked' : ''}>
      ${esc(c)}
    </label>`).join('');
  return `<div class="form-group">
    ${labelHtml(field)}
    <div class="multiselect-list">${boxes}</div>
  </div>`;
}

function renderTextarea(field, val) {
  return `<div class="form-group">
    ${labelHtml(field)}
    <textarea id="${field.id}" name="${field.id}" class="form-control"
              rows="4" ${field.required ? 'required' : ''}>${esc(val)}</textarea>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Suggestions                                                          */
/* ------------------------------------------------------------------ */

function updateSuggestions() {
  if (!_template) return;
  const values   = collectFormValues();
  const similar  = getReports().filter(r => r.examType === _template.examType);
  const suggs    = getSuggestions(values, similar, 6);

  const bar = document.getElementById('suggestion-chips');
  if (!bar) return;
  if (suggs.length === 0) { bar.innerHTML = '<span style="color:var(--color-muted);font-size:.82rem">No suggestions yet — start typing or save more reports.</span>'; return; }

  bar.innerHTML = suggs.map(s => {
    const preview = s.length > 80 ? s.slice(0, 80) + '…' : s;
    return `<span class="chip" title="${esc(s)}" data-full="${esc(s)}">${esc(preview)}</span>`;
  }).join('');

  bar.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const ta = document.getElementById('impression_text');
      if (ta) { ta.value = chip.dataset.full; ta.dispatchEvent(new Event('input')); }
    });
  });
}

/* ------------------------------------------------------------------ */
/* Form submission                                                      */
/* ------------------------------------------------------------------ */

function onSubmit(e) {
  e.preventDefault();
  const values = collectFormValues();
  const tags   = classifyReport(_template, values);

  const report = {
    id:           _editId || generateId(),
    examType:     _template.examType,
    examTitle:    _template.title,
    templateVersion: _template.version || '1.0.0',
    createdAt:    _editId
                    ? (getReports().find(r => r.id === _editId)?.createdAt || new Date().toISOString())
                    : new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
    fields:       values,
    tags:         tags,
    patientId:    values.patient_id   || '',
    patientName:  values.patient_name || '',
    examDate:     values.exam_date    || new Date().toISOString().split('T')[0],
  };

  saveReport(report);
  window.dispatchEvent(new CustomEvent('navigate', { detail: 'list' }));
  window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', msg: 'Report saved successfully.' } }));
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function collectFormValues() {
  const form   = document.getElementById('report-form');
  if (!form) return {};
  const data   = {};
  const fdData = new FormData(form);

  // Handle multiselects separately (checkboxes with same name → array)
  const multiNames = new Set();
  _template.sections.forEach(s =>
    (s.fields || []).forEach(f => { if (f.type === 'multiselect') multiNames.add(f.id); })
  );

  multiNames.forEach(name => { data[name] = []; });
  for (const [key, val] of fdData.entries()) {
    if (multiNames.has(key)) {
      data[key].push(val);
    } else {
      data[key] = val;
    }
  }
  return data;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}
