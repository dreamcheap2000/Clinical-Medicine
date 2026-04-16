/**
 * modules/session-log.js
 * Daily OPD session entry form with ICD-10 auto-search, SOAP fields,
 * and timestamped persistence.
 */

import { getSessions, saveSession, deleteSession, getIcdData, searchCodes, navigate, showToast, esc } from '../app.js';

export function renderSessionLog(opts = {}) {
  const container = document.getElementById('main-content');
  const editId    = opts.editId || null;
  const existing  = editId ? getSessions().find(s => s.id === editId) : null;

  /* Pick up prefill from ICD browser "Use →" button */
  let prefill = null;
  try {
    const raw = sessionStorage.getItem('prefill_icd');
    if (raw) { prefill = JSON.parse(raw); sessionStorage.removeItem('prefill_icd'); }
  } catch { /* ignore */ }

  container.innerHTML = `
    <h2 class="page-title">📝 ${editId ? 'Edit' : 'New'} OPD Entry</h2>

    <div class="card">
      <form id="opd-form" autocomplete="off" novalidate>

        <!-- Meta row -->
        <div class="form-row-2">
          <div class="field-group">
            <label class="field-label" for="f-date">Date <span class="req">*</span></label>
            <input class="field-input" type="date" id="f-date" required
              value="${esc(existing?.date || new Date().toISOString().slice(0,10))}">
          </div>
          <div class="field-group">
            <label class="field-label" for="f-pid">Patient ID (optional)</label>
            <input class="field-input" type="text" id="f-pid" placeholder="e.g. 0001"
              value="${esc(existing?.patientId || '')}">
          </div>
        </div>

        <!-- ICD search -->
        <div class="field-group" style="position:relative">
          <label class="field-label" for="f-icd-search">ICD-10 Code Search</label>
          <div class="icd-search-row">
            <input class="field-input" type="text" id="f-icd-search"
              placeholder="Type code (e.g. G43) or condition (e.g. migraine / 偏頭痛)…"
              value="${esc(existing ? (existing.icdCode + (existing.icdDescription ? ' — ' + existing.icdDescription : '')) : (prefill ? prefill.code + ' — ' + prefill.en : ''))}">
            <button type="button" class="btn btn-sm-inline" id="btn-clear-icd">✕</button>
          </div>
          <div id="icd-dropdown" class="icd-dropdown hidden"></div>
          <input type="hidden" id="f-icd-code"   value="${esc(existing?.icdCode        || prefill?.code || '')}">
          <input type="hidden" id="f-icd-desc"   value="${esc(existing?.icdDescription || prefill?.en   || '')}">
          <input type="hidden" id="f-icd-zh"     value="${esc(existing?.icdZh          || prefill?.zh   || '')}">
          <input type="hidden" id="f-icd-cat"    value="${esc(existing?.categoryId     || '')}">
          <input type="hidden" id="f-icd-catname" value="${esc(existing?.categoryName  || '')}">
          ${(existing?.icdCode || prefill) ? `
            <div class="icd-selected" id="icd-selected-badge">
              <span class="tag tag-code">${esc(existing?.icdCode || prefill?.code || '')}</span>
              <span>${esc(existing?.icdDescription || prefill?.en || '')} ${(existing?.icdZh || prefill?.zh) ? '· '+esc(existing?.icdZh || prefill?.zh) : ''}</span>
              ${existing?.categoryName ? `<span class="tag tag-cat">${esc(existing.categoryName)}</span>` : ''}
              <button type="button" class="btn-soap-link" id="btn-view-soap">📋 View SOAP / Exam</button>
            </div>` : '<div class="icd-selected hidden" id="icd-selected-badge"></div>'}
        </div>

        <!-- Patient condition -->
        <div class="field-group">
          <label class="field-label" for="f-condition">Patient Condition / Presentation <span class="req">*</span></label>
          <textarea class="field-input field-textarea" id="f-condition" rows="3"
            placeholder="Describe the chief complaint, relevant history, clinical context…">${esc(existing?.condition || '')}</textarea>
        </div>

        <!-- EBM statement -->
        <div class="field-group">
          <label class="field-label" for="f-ebm">EBM Statement / Clinical Note</label>
          <textarea class="field-input field-textarea" id="f-ebm" rows="3"
            placeholder="Evidence-based medicine statement, guideline reference, clinical reasoning…">${esc(existing?.ebm || '')}</textarea>
        </div>

        <!-- SOAP fields -->
        <div class="soap-section">
          <div class="soap-header">
            <span>📋 SOAP Note</span>
            <button type="button" class="btn btn-sm-inline" id="btn-load-soap">Load Category Template</button>
          </div>
          <div class="soap-fields">
            <div class="field-group">
              <label class="field-label">S — Subjective</label>
              <textarea class="field-input field-textarea soap-textarea" id="f-soap-s" rows="3"
                placeholder="Patient-reported symptoms, history…">${esc(existing?.soap?.s || '')}</textarea>
            </div>
            <div class="field-group">
              <label class="field-label">O — Objective</label>
              <textarea class="field-input field-textarea soap-textarea" id="f-soap-o" rows="3"
                placeholder="Physical exam findings, vitals, test results…">${esc(existing?.soap?.o || '')}</textarea>
            </div>
            <div class="field-group">
              <label class="field-label">A — Assessment</label>
              <textarea class="field-input field-textarea soap-textarea" id="f-soap-a" rows="2"
                placeholder="Diagnosis, severity, clinical impression…">${esc(existing?.soap?.a || '')}</textarea>
            </div>
            <div class="field-group">
              <label class="field-label">P — Plan</label>
              <textarea class="field-input field-textarea soap-textarea" id="f-soap-p" rows="2"
                placeholder="Treatment, referrals, follow-up, patient education…">${esc(existing?.soap?.p || '')}</textarea>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">💾 Save Entry</button>
          <button type="button" class="btn btn-outline" id="btn-cancel">Cancel</button>
        </div>
      </form>
    </div>

    <!-- SOAP template panel (hidden by default) -->
    <div id="soap-panel" class="soap-panel hidden"></div>
  `;

  wireForm(container, existing);
}

/* ------------------------------------------------------------------ */

function wireForm(container, existing) {
  const form        = container.querySelector('#opd-form');
  const searchInput = container.querySelector('#f-icd-search');
  const dropdown    = container.querySelector('#icd-dropdown');
  const badge       = container.querySelector('#icd-selected-badge');
  const btnClear    = container.querySelector('#btn-clear-icd');
  const btnLoadSoap = container.querySelector('#btn-load-soap');
  const soapPanel   = container.querySelector('#soap-panel');

  let _icdData = null;
  let _searchTimer = null;

  getIcdData().then(d => { _icdData = d; });

  /* ICD search */
  searchInput.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) { dropdown.classList.add('hidden'); return; }
    _searchTimer = setTimeout(async () => {
      if (!_icdData) _icdData = await getIcdData();
      const results = searchCodes(q, _icdData);
      if (!results.length) { dropdown.classList.add('hidden'); return; }
      dropdown.innerHTML = results.map(r => `
        <div class="dropdown-item" data-code="${esc(r.code)}" data-en="${esc(r.en)}" data-zh="${esc(r.zh)}" data-cat="${esc(r.categoryId)}">
          <span class="tag tag-code">${esc(r.code)}</span>
          <span class="dd-en">${esc(r.en)}</span>
          <span class="dd-zh">${esc(r.zh)}</span>
        </div>`).join('');
      dropdown.classList.remove('hidden');
    }, 200);
  });

  dropdown.addEventListener('click', async e => {
    const item = e.target.closest('.dropdown-item');
    if (!item) return;
    const code = item.dataset.code;
    const en   = item.dataset.en;
    const zh   = item.dataset.zh;
    const cat  = item.dataset.cat;

    if (!_icdData) _icdData = await getIcdData();
    const catObj = (_icdData.categories || []).find(c => c.id === cat);
    const catName = catObj ? catObj.nameEn : cat;

    form.querySelector('#f-icd-code').value    = code;
    form.querySelector('#f-icd-desc').value    = en;
    form.querySelector('#f-icd-zh').value      = zh;
    form.querySelector('#f-icd-cat').value     = cat;
    form.querySelector('#f-icd-catname').value = catName;

    searchInput.value = `${code} — ${en}`;
    dropdown.classList.add('hidden');

    badge.innerHTML = `
      <span class="tag tag-code">${esc(code)}</span>
      <span>${esc(en)} ${zh ? '· '+esc(zh) : ''}</span>
      ${catName ? `<span class="tag tag-cat">${esc(catName)}</span>` : ''}
      <button type="button" class="btn-soap-link" id="btn-view-soap">📋 View SOAP / Exam</button>`;
    badge.classList.remove('hidden');

    wireViewSoap(badge, cat, _icdData, soapPanel);
  });

  /* Clear ICD */
  btnClear.addEventListener('click', () => {
    searchInput.value = '';
    form.querySelector('#f-icd-code').value    = '';
    form.querySelector('#f-icd-desc').value    = '';
    form.querySelector('#f-icd-zh').value      = '';
    form.querySelector('#f-icd-cat').value     = '';
    form.querySelector('#f-icd-catname').value = '';
    badge.classList.add('hidden');
    badge.innerHTML = '';
    dropdown.classList.add('hidden');
    soapPanel.classList.add('hidden');
  });

  /* View SOAP for pre-existing selected code */
  if (existing?.categoryId) {
    const btnViewSoap = badge.querySelector('#btn-view-soap');
    if (btnViewSoap) {
      getIcdData().then(d => {
        wireViewSoap(badge, existing.categoryId, d, soapPanel);
      });
    }
  }

  /* Load SOAP template into textareas */
  btnLoadSoap.addEventListener('click', async () => {
    const catId = form.querySelector('#f-icd-cat').value;
    if (!catId) { showToast('error', 'Select an ICD code first to load its category template.'); return; }
    if (!_icdData) _icdData = await getIcdData();
    const catObj = (_icdData.categories || []).find(c => c.id === catId);
    if (!catObj?.soap) { showToast('error', 'No SOAP template for this category.'); return; }

    const s = catObj.soap;
    form.querySelector('#f-soap-s').value = (s.subjective || []).join('\n');
    form.querySelector('#f-soap-o').value = (s.objective  || []).join('\n');
    form.querySelector('#f-soap-a').value = (s.assessment_pearls || []).join('\n');
    form.querySelector('#f-soap-p').value = (s.plan_template     || []).join('\n');
    showToast('success', `Loaded "${catObj.nameEn}" SOAP template. Edit as needed.`);
  });

  /* Close dropdown on outside click — use container-level delegation to avoid global listener leaks */
  container.addEventListener('click', e => {
    if (!e.target.closest('#f-icd-search') && !e.target.closest('#icd-dropdown')) {
      dropdown.classList.add('hidden');
    }
  });

  /* Cancel */
  container.querySelector('#btn-cancel').addEventListener('click', () => navigate('dashboard'));

  /* Submit */
  form.addEventListener('submit', e => {
    e.preventDefault();
    const date      = form.querySelector('#f-date').value.trim();
    const condition = form.querySelector('#f-condition').value.trim();
    if (!date)      { showToast('error', 'Date is required.'); return; }
    if (!condition) { showToast('error', 'Patient condition is required.'); return; }

    const now = new Date();
    const timestamp = `${date} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    const session = {
      id:              existing?.id || `opd-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      date,
      timestamp,
      patientId:       form.querySelector('#f-pid').value.trim() || null,
      icdCode:         form.querySelector('#f-icd-code').value    || null,
      icdDescription:  form.querySelector('#f-icd-desc').value    || null,
      icdZh:           form.querySelector('#f-icd-zh').value      || null,
      categoryId:      form.querySelector('#f-icd-cat').value     || null,
      categoryName:    form.querySelector('#f-icd-catname').value || null,
      condition,
      ebm:             form.querySelector('#f-ebm').value.trim()  || null,
      soap: {
        s: form.querySelector('#f-soap-s').value.trim() || null,
        o: form.querySelector('#f-soap-o').value.trim() || null,
        a: form.querySelector('#f-soap-a').value.trim() || null,
        p: form.querySelector('#f-soap-p').value.trim() || null,
      },
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveSession(session);
    showToast('success', `Entry saved at ${timestamp}.`);
    navigate('dashboard');
  });
}

/* ------------------------------------------------------------------ */

function wireViewSoap(badge, catId, icdData, soapPanel) {
  const btn = badge.querySelector('#btn-view-soap');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const catObj = (icdData.categories || []).find(c => c.id === catId);
    if (!catObj) return;
    soapPanel.classList.remove('hidden');
    soapPanel.innerHTML = buildSoapHtml(catObj);
    /* Wire close button after innerHTML update */
    soapPanel.querySelector('#btn-close-soap')?.addEventListener('click', () => {
      soapPanel.classList.add('hidden');
    });
    soapPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function buildSoapHtml(cat) {
  const s = cat.soap || {};
  const pe = cat.physicalExam || {};
  return `
    <div class="soap-panel-header">
      <span>${cat.icon || ''} ${esc(cat.nameEn)} — ${esc(cat.nameZh)}</span>
      <button class="btn btn-sm-inline" id="btn-close-soap">✕ Close</button>
    </div>

    <div class="soap-panel-body">
      ${soapSection('🗣️ S — Subjective', s.subjective)}
      ${soapSection('🔎 O — Objective', s.objective)}
      ${soapSection('💡 Assessment Pearls', s.assessment_pearls)}
      ${soapSection('🗂️ Plan Template', s.plan_template)}
      ${peSection('🩺 Bedside Scales', pe.bedside_scales)}
      ${peSection('🔬 Neurologic / Physical Exam', pe.neurologic_exam)}
    </div>
  `;
}

function soapSection(title, items) {
  if (!items?.length) return '';
  return `<div class="ref-section">
    <div class="ref-title">${title}</div>
    <ul class="ref-list">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
  </div>`;
}
function peSection(title, items) { return soapSection(title, items); }
