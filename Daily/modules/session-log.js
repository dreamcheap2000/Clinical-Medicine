/**
 * modules/session-log.js
 * Daily OPD session entry form.
 *
 * UI layout:
 *   Left  — form (ICD search, patient info, combined SOAP textarea)
 *   Right — ghost panel (SOAP/Exam reference for selected ICD category)
 *
 * Features:
 *   • Combined editable SOAP textarea (no forced S/O/A/P separation)
 *   • Ghost panel with checkable template items → insert into SOAP textarea
 *   • Custom named SOAP templates: save current text, load later
 *   • Special patient-type dropdown
 *   • Key learning / EBM statement field
 *   • FHIR export (downloads FHIR Bundle JSON)
 */

import {
  getSessions, saveSession,
  getIcdData, searchCodes,
  getSoapFreq, recordSoapSelections,
  getSoapTemplates, saveSoapTemplate, deleteSoapTemplate,
  recordIcdUse,
  navigate, showToast, esc,
  saveSessionWithSync,
} from '../app.js';

/* ============================================================ */
/* Patient type options                                           */
/* ============================================================ */

const PATIENT_TYPES = [
  '', 'Elderly (≥65)', 'Pediatric', 'Pregnant', 'Oncology',
  'Post-surgical', 'ICU / Critical', 'Immunocompromised',
  'Rehabilitation', 'Palliative', 'Mental Health', 'Other',
];

/* ============================================================ */
/* Main render                                                    */
/* ============================================================ */

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

  /* Pick up SOAP text inserted from SOAP Templates page */
  let prefillSoapText = '';
  try {
    const rawSoap = sessionStorage.getItem('prefill_soap_text');
    if (rawSoap) { prefillSoapText = rawSoap; sessionStorage.removeItem('prefill_soap_text'); }
  } catch { /* ignore */ }

  /* Reconstruct combined SOAP text from existing record (backward compat) */
  const existingSoapText = existing?.soapText ||
    [existing?.soap?.s && `S: ${existing.soap.s}`,
     existing?.soap?.o && `O: ${existing.soap.o}`,
     existing?.soap?.a && `A: ${existing.soap.a}`,
     existing?.soap?.p && `P: ${existing.soap.p}`]
    .filter(Boolean).join('\n\n') || prefillSoapText || '';

  container.innerHTML = `
    <h2 class="page-title">📝 ${editId ? 'Edit' : 'New'} OPD Entry</h2>

    <div class="entry-layout">

      <!-- ===== Left: main form ===== -->
      <div class="entry-form-col">
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

            <!-- Patient type -->
            <div class="field-group">
              <label class="field-label" for="f-pt">Special Patient Type</label>
              <select class="field-input" id="f-pt">
                ${PATIENT_TYPES.map(t =>
                  `<option value="${esc(t)}" ${(existing?.patientType || '') === t ? 'selected' : ''}>${esc(t || '— none —')}</option>`
                ).join('')}
              </select>
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
              <input type="hidden" id="f-icd-code"    value="${esc(existing?.icdCode        || prefill?.code || '')}">
              <input type="hidden" id="f-icd-desc"    value="${esc(existing?.icdDescription || prefill?.en   || '')}">
              <input type="hidden" id="f-icd-zh"      value="${esc(existing?.icdZh          || prefill?.zh   || '')}">
              <input type="hidden" id="f-icd-cat"     value="${esc(existing?.categoryId     || prefill?.categoryId || '')}">
              <input type="hidden" id="f-icd-catname" value="${esc(existing?.categoryName   || '')}">
              ${(existing?.icdCode || prefill) ? `
                <div class="icd-selected" id="icd-selected-badge">
                  <span class="tag tag-code">${esc(existing?.icdCode || prefill?.code || '')}</span>
                  <span>${esc(existing?.icdDescription || prefill?.en || '')} ${(existing?.icdZh || prefill?.zh) ? '· '+esc(existing?.icdZh || prefill?.zh) : ''}</span>
                  ${existing?.categoryName ? `<span class="tag tag-cat">${esc(existing.categoryName)}</span>` : ''}
                  <button type="button" class="btn-soap-link" id="btn-show-ghost">📋 SOAP Panel</button>
                </div>` : '<div class="icd-selected hidden" id="icd-selected-badge"></div>'}
            </div>

            <!-- Patient condition / chief complaint -->
            <div class="field-group">
              <label class="field-label" for="f-condition">Patient Condition / Presentation</label>
              <textarea class="field-input field-textarea" id="f-condition" rows="2"
                placeholder="Chief complaint, relevant history, clinical context… (optional)">${esc(existing?.condition || (prefill ? (prefill.en || '') : ''))}</textarea>
            </div>

            <!-- Key learning / EBM -->
            <div class="field-group">
              <label class="field-label" for="f-klp">Key Learning Point / EBM Statement</label>
              <textarea class="field-input field-textarea" id="f-klp" rows="2"
                placeholder="Evidence-based statement, guideline reference, clinical pearl…">${esc(existing?.keyLearning || existing?.ebm || '')}</textarea>
            </div>

            <!-- Combined SOAP note -->
            <div class="field-group">
              <div class="soap-header">
                <span>📋 SOAP Note (combined)</span>
                <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center">
                  <button type="button" class="btn btn-sm-inline" id="btn-tmpl-load">📂 Load Template</button>
                  <button type="button" class="btn btn-sm-inline" id="btn-tmpl-save">💾 Save as Template</button>
                  <button type="button" class="btn btn-sm-inline" id="btn-copy-soap">📋 Copy</button>
                  ${(existing?.categoryId || prefill?.categoryId) ? `<button type="button" class="btn btn-sm-inline" id="btn-show-ghost-soap">🔍 Template Items</button>` : ''}
                </div>
              </div>
              <textarea class="field-input field-textarea soap-combined-ta" id="f-soap-text"
                rows="10" placeholder="Write your SOAP note here (free text, no forced structure).
You can also use the 'Template Items' button to insert structured items from the SOAP reference panel on the right →

Example format (optional):
S: Patient reports headache, 3 days
O: Alert, BP 130/85, neuro exam normal
A: Tension headache (G44.2)
P: NSAIDs, follow up in 2 weeks">${esc(existingSoapText)}</textarea>
            </div>

            <!-- Actions -->
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">💾 Save Entry</button>
              <button type="button" class="btn btn-outline" id="btn-fhir-export" title="Download FHIR Bundle JSON">🏥 FHIR Export</button>
              <button type="button" class="btn btn-outline" id="btn-cancel">Cancel</button>
            </div>
          </form>
        </div>
      </div>

      <!-- ===== Right: ghost SOAP panel ===== -->
      <div class="entry-ghost-col" id="ghost-col">
        <div id="ghost-panel" class="ghost-panel">
          <div class="ghost-panel-header">
            <span id="ghost-panel-title">📋 SOAP Reference</span>
            <button type="button" class="btn btn-sm-inline" id="btn-ghost-close">✕</button>
          </div>
          <div id="ghost-panel-body" class="ghost-panel-body">
            <p class="no-records" style="padding:1rem;font-size:.85rem">
              Select an ICD code to load SOAP / Physical Exam template items.<br>
              Check items and click <b>Insert</b> to append to your SOAP note.
            </p>
          </div>
        </div>
      </div>

    </div><!-- /.entry-layout -->
  `;

  wireForm(container, existing, prefill);
}

/* ============================================================ */
/* Wire form logic                                               */
/* ============================================================ */

function wireForm(container, existing, prefill) {
  const form        = container.querySelector('#opd-form');
  const searchInput = container.querySelector('#f-icd-search');
  const dropdown    = container.querySelector('#icd-dropdown');
  const badge       = container.querySelector('#icd-selected-badge');
  const ghostPanel  = container.querySelector('#ghost-panel');
  const ghostBody   = container.querySelector('#ghost-panel-body');
  const ghostCol    = container.querySelector('#ghost-col');

  let _icdData    = null;
  let _searchTimer = null;

  getIcdData().then(d => {
    _icdData = d;
    /* If we already have a category (from prefill or existing), load ghost panel */
    const catId = form.querySelector('#f-icd-cat').value;
    if (catId) loadGhostPanel(catId, d);
  });

  /* ── ICD search ── */
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
    const catObj  = (_icdData.categories || []).find(c => c.id === cat);
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
      <button type="button" class="btn-soap-link" id="btn-show-ghost">📋 SOAP Panel</button>`;
    badge.classList.remove('hidden');

    /* Pre-fill condition field if empty */
    const condField = form.querySelector('#f-condition');
    if (!condField.value.trim()) condField.value = en;

    /* Load ghost panel */
    if (catObj) loadGhostPanel(cat, _icdData);

    wireShowGhost();
  });

  /* ── Clear ICD ── */
  container.querySelector('#btn-clear-icd').addEventListener('click', () => {
    searchInput.value = '';
    ['#f-icd-code','#f-icd-desc','#f-icd-zh','#f-icd-cat','#f-icd-catname']
      .forEach(id => { form.querySelector(id).value = ''; });
    badge.classList.add('hidden');
    badge.innerHTML = '';
    dropdown.classList.add('hidden');
    ghostBody.innerHTML = '<p class="no-records" style="padding:1rem;font-size:.85rem">Select an ICD code to load template items.</p>';
  });

  /* ── Close ICD dropdown on outside click ── */
  container.addEventListener('click', e => {
    if (!e.target.closest('#f-icd-search') && !e.target.closest('#icd-dropdown'))
      dropdown.classList.add('hidden');
  });

  /* ── Show/hide ghost panel ── */
  function wireShowGhost() {
    container.querySelector('#btn-show-ghost')?.addEventListener('click', () => {
      ghostCol.classList.toggle('ghost-visible');
    });
  }
  wireShowGhost();

  container.querySelector('#btn-show-ghost-soap')?.addEventListener('click', () => {
    ghostCol.classList.add('ghost-visible');
  });

  container.querySelector('#btn-ghost-close')?.addEventListener('click', () => {
    ghostCol.classList.remove('ghost-visible');
  });

  /* ── Copy SOAP ── */
  container.querySelector('#btn-copy-soap').addEventListener('click', () => {
    const ta = form.querySelector('#f-soap-text');
    if (!ta?.value.trim()) { showToast('info', 'SOAP note is empty.'); return; }
    copyText(ta.value, 'SOAP note');
  });

  /* ── FHIR Export ── */
  container.querySelector('#btn-fhir-export').addEventListener('click', async () => {
    const session = buildSession(form, existing);
    if (!session) return;
    const { exportSessionAsFhirBundle } = await import('./firebase-sync.js');
    exportSessionAsFhirBundle(session);
    showToast('success', 'FHIR Bundle downloaded.');
  });

  /* ── Load saved SOAP templates ── */
  container.querySelector('#btn-tmpl-load').addEventListener('click', () => {
    openTemplateLoader(form);
  });

  /* ── Save current SOAP as template ── */
  container.querySelector('#btn-tmpl-save').addEventListener('click', () => {
    const ta = form.querySelector('#f-soap-text');
    const text = ta?.value.trim();
    if (!text) { showToast('info', 'SOAP note is empty — nothing to save.'); return; }
    const name = prompt('Enter a name for this template:');
    if (!name?.trim()) return;
    const tmpl = {
      id:        `tmpl-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      name:      name.trim(),
      text,
      createdAt: new Date().toISOString(),
    };
    saveSoapTemplate(tmpl);
    showToast('success', `Template "${tmpl.name}" saved.`);
  });

  /* ── Cancel ── */
  container.querySelector('#btn-cancel').addEventListener('click', () => navigate('dashboard'));

  /* ── Submit ── */
  form.addEventListener('submit', e => {
    e.preventDefault();
    const session = buildSession(form, existing);
    if (!session) return;
    saveSession(session);
    recordIcdUse(session);
    showToast('success', `Entry saved at ${session.timestamp}.`);
    saveSessionWithSync(session).catch(err => { console.warn('Sync error:', err); });
    navigate('dashboard');
  });

  /* ── Load ghost panel for existing/prefill category ── */
  function loadGhostPanel(catId, icdData) {
    const catObj = (icdData.categories || []).find(c => c.id === catId);
    if (!catObj) return;
    container.querySelector('#ghost-panel-title').textContent =
      `${catObj.icon || '📋'} ${catObj.nameEn} — Template`;
    ghostBody.innerHTML = buildGhostContent(catObj, catId);
    wireGhostInsert(ghostBody, form, catId);
    ghostCol.classList.add('ghost-visible');
  }
}

/* ============================================================ */
/* Build session object from form                                */
/* ============================================================ */

function buildSession(form, existing) {
  const date = form.querySelector('#f-date').value.trim();
  if (!date) { showToast('error', 'Date is required.'); return null; }

  const soapText = form.querySelector('#f-soap-text').value.trim();
  const now      = new Date();
  const timestamp = `${date} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  /* Try to split combined text into S/O/A/P sections (best effort) */
  const soapSplit = splitSoapText(soapText);

  return {
    id:             existing?.id || `opd-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    date,
    timestamp,
    patientId:      form.querySelector('#f-pid').value.trim()          || null,
    patientType:    form.querySelector('#f-pt').value                  || null,
    icdCode:        form.querySelector('#f-icd-code').value            || null,
    icdDescription: form.querySelector('#f-icd-desc').value            || null,
    icdZh:          form.querySelector('#f-icd-zh').value              || null,
    categoryId:     form.querySelector('#f-icd-cat').value             || null,
    categoryName:   form.querySelector('#f-icd-catname').value         || null,
    condition:      form.querySelector('#f-condition').value.trim()    || null,
    keyLearning:    form.querySelector('#f-klp').value.trim()          || null,
    ebm:            form.querySelector('#f-klp').value.trim()          || null,
    soapText,
    soap:           soapSplit,
    createdAt:      existing?.createdAt || new Date().toISOString(),
    updatedAt:      new Date().toISOString(),
  };
}

/**
 * Attempt to parse "S: ... O: ... A: ... P: ..." sections from free text.
 * Falls back to storing the whole text in soap.s.
 */
function splitSoapText(text) {
  if (!text) return { s: null, o: null, a: null, p: null };
  /* Match sections starting with S: / O: / A: / P: (case-insensitive, multiline) */
  const sec = (label) => {
    const re = new RegExp(`(?:^|\\n)${label}:\\s*([\\s\\S]*?)(?=\\n[SOAP]:|$)`, 'i');
    const m  = text.match(re);
    return m ? m[1].trim() : null;
  };
  const s = sec('S');
  const o = sec('O');
  const a = sec('A');
  const p = sec('P');
  /* If none found, put everything in s */
  if (!s && !o && !a && !p) return { s: text, o: null, a: null, p: null };
  return { s, o, a, p };
}

/* ============================================================ */
/* Ghost panel content                                           */
/* ============================================================ */

function buildGhostContent(catObj, catId) {
  const s  = catObj.soap || {};
  const pe = catObj.physicalExam || {};

  const sections = [
    { key: 's', label: '🗣️ Subjective',    items: s.subjective        || [] },
    { key: 'o', label: '🔎 Objective',      items: s.objective          || [] },
    { key: 'a', label: '💡 Assessment',     items: s.assessment_pearls || [] },
    { key: 'p', label: '🗂️ Plan',           items: s.plan_template      || [] },
    { key: 'pe', label: '🩺 Physical Exam', items: (pe.neurologic_exam || []).concat(pe.bedside_scales || pe.bedside_cognitive || []) },
  ].filter(sec => sec.items.length > 0);

  if (!sections.length) {
    return '<p class="no-records" style="padding:1rem;font-size:.85rem">No template items for this category.</p>';
  }

  const catFreq = getSoapFreq()[catId] || {};

  return `
    <div class="ghost-insert-all-row">
      <span class="hint" style="font-size:.8rem">Check items, then click <b>Insert Checked</b></span>
    </div>
    ${sections.map(sec => {
      const sorted = sec.items
        .map((text, i) => ({ text, i, count: catFreq[text] || 0 }))
        .sort((a, b) => b.count - a.count || a.i - b.i);
      return `
        <div class="ghost-section" data-sec-key="${esc(sec.key)}">
          <div class="ghost-section-header">
            <span class="ghost-sec-title">${sec.label}</span>
            <div class="ghost-sec-actions">
              <button type="button" class="btn-ref-action ghost-toggle-all" data-sec="${esc(sec.key)}">All</button>
              <button type="button" class="btn-ref-action ghost-insert-btn" data-sec="${esc(sec.key)}">✓ Insert</button>
            </div>
          </div>
          <div class="ghost-items">
            ${sorted.map(({ text, count }) => `
              <label class="ghost-item">
                <input type="checkbox" class="ghost-cb" data-sec="${esc(sec.key)}" data-text="${esc(text)}">
                <span class="ghost-item-text">${esc(text)}</span>
                ${count > 0 ? `<span class="freq-badge">×${count}</span>` : ''}
              </label>`).join('')}
          </div>
        </div>`;
    }).join('')}
  `;
}

function wireGhostInsert(ghostBody, form, catId) {
  const ta = form.querySelector('#f-soap-text');

  /* Toggle all in section */
  ghostBody.querySelectorAll('.ghost-toggle-all').forEach(btn => {
    btn.addEventListener('click', () => {
      const sec  = btn.dataset.sec;
      const cbs  = [...ghostBody.querySelectorAll(`.ghost-cb[data-sec="${sec}"]`)];
      const allC = cbs.every(cb => cb.checked);
      cbs.forEach(cb => { cb.checked = !allC; });
      btn.textContent = allC ? 'All' : 'None';
    });
  });

  /* Insert checked items for a section */
  ghostBody.querySelectorAll('.ghost-insert-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sec     = btn.dataset.sec;
      const checked = [...ghostBody.querySelectorAll(`.ghost-cb[data-sec="${sec}"]:checked`)];
      if (!checked.length) { showToast('info', 'Check some items first.'); return; }

      const items = checked.map(cb => cb.dataset.text);
      if (ta) {
        const cur  = ta.value.trim();
        const label = sec === 'pe' ? 'PE' : sec.toUpperCase();
        const toAdd = items.join('\n' + ' '.repeat(label.length + 2));
        ta.value = cur ? `${cur}\n${label}: ${toAdd}` : `${label}: ${toAdd}`;
      }
      recordSoapSelections(catId, items);
      checked.forEach(cb => { cb.checked = false; });
      showToast('success', `Inserted ${items.length} item${items.length > 1 ? 's' : ''}.`);
    });
  });
}

/* ============================================================ */
/* Template loader modal                                         */
/* ============================================================ */

function openTemplateLoader(form) {
  document.getElementById('tmpl-loader-overlay')?.remove();

  const templates = getSoapTemplates();

  const overlay = document.createElement('div');
  overlay.id        = 'tmpl-loader-overlay';
  overlay.className = 'picker-overlay';

  if (!templates.length) {
    overlay.innerHTML = `
      <div class="picker-panel" style="max-width:420px">
        <div class="picker-header">
          <span>📂 Load SOAP Template</span>
          <button class="picker-close-btn" id="tmpl-close">✕</button>
        </div>
        <div class="picker-body">
          <p class="no-records">No saved templates yet. Fill in a SOAP note and use "Save as Template" to create one.</p>
        </div>
        <div class="picker-footer">
          <button class="btn btn-outline" id="tmpl-close2">Close</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#tmpl-close').addEventListener('click',  () => overlay.remove());
    overlay.querySelector('#tmpl-close2').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    return;
  }

  overlay.innerHTML = `
    <div class="picker-panel" role="dialog" aria-modal="true" aria-label="Load SOAP Template">
      <div class="picker-header">
        <span>📂 Load SOAP Template</span>
        <button class="picker-close-btn" id="tmpl-close">✕</button>
      </div>
      <div class="picker-body" id="tmpl-loader-body">
        ${templates.map(t => `
          <div class="tmpl-loader-item" data-id="${esc(t.id)}">
            <div class="tmpl-loader-top">
              <span class="tmpl-loader-name">${esc(t.name)}</span>
              <span class="hint" style="font-size:.76rem">${t.createdAt ? new Date(t.createdAt).toLocaleDateString() : ''}</span>
              <button class="btn-ref-action tmpl-delete-btn" data-id="${esc(t.id)}">🗑️</button>
            </div>
            <div class="tmpl-preview">${esc(t.text.slice(0, 200))}${t.text.length > 200 ? '…' : ''}</div>
            <div class="tmpl-select-parts">
              <button class="btn btn-outline btn-sm-inline tmpl-insert-full" data-id="${esc(t.id)}">Insert All</button>
              <button class="btn btn-sm-inline tmpl-pick-parts" data-id="${esc(t.id)}">Pick Lines…</button>
            </div>
          </div>`).join('')}
      </div>
      <div class="picker-footer">
        <button class="btn btn-outline" id="tmpl-close2">Close</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const ta = form.querySelector('#f-soap-text');

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#tmpl-close').addEventListener('click',  () => overlay.remove());
  overlay.querySelector('#tmpl-close2').addEventListener('click', () => overlay.remove());

  /* Insert full template */
  overlay.querySelectorAll('.tmpl-insert-full').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = templates.find(x => x.id === btn.dataset.id);
      if (!t || !ta) return;
      const cur = ta.value.trim();
      ta.value = cur ? `${cur}\n\n${t.text}` : t.text;
      overlay.remove();
      showToast('success', `Template "${t.name}" inserted.`);
    });
  });

  /* Pick individual lines from template */
  overlay.querySelectorAll('.tmpl-pick-parts').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = templates.find(x => x.id === btn.dataset.id);
      if (!t) return;
      overlay.remove();
      openLinePicker(t, ta);
    });
  });

  /* Delete template */
  overlay.querySelectorAll('.tmpl-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm('Delete this template?')) return;
      deleteSoapTemplate(btn.dataset.id);
      btn.closest('.tmpl-loader-item').remove();
      if (!document.querySelector('.tmpl-loader-item')) {
        document.querySelector('#tmpl-loader-body').innerHTML =
          '<p class="no-records">No saved templates.</p>';
      }
      showToast('success', 'Template deleted.');
    });
  });
}

/* ============================================================ */
/* Line picker for partial template insertion                    */
/* ============================================================ */

function openLinePicker(template, ta) {
  document.getElementById('line-picker-overlay')?.remove();

  const lines = template.text.split('\n').filter(l => l.trim());

  const overlay = document.createElement('div');
  overlay.id        = 'line-picker-overlay';
  overlay.className = 'picker-overlay';
  overlay.innerHTML = `
    <div class="picker-panel" role="dialog" aria-label="Pick Lines from Template">
      <div class="picker-header">
        <span>📝 ${esc(template.name)} — Pick Lines</span>
        <button class="picker-close-btn" id="lp-close">✕</button>
      </div>
      <div class="picker-body">
        ${lines.map((line, i) => `
          <label class="picker-item">
            <input type="checkbox" class="lp-cb" data-idx="${i}" checked>
            <span class="picker-item-text">${esc(line)}</span>
          </label>`).join('')}
      </div>
      <div class="picker-footer">
        <button class="btn btn-outline" id="lp-cancel">Cancel</button>
        <button class="btn btn-primary" id="lp-insert">✓ Insert Selected</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#lp-close').addEventListener('click',  () => overlay.remove());
  overlay.querySelector('#lp-cancel').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#lp-insert').addEventListener('click', () => {
    const selected = [...overlay.querySelectorAll('.lp-cb:checked')]
      .map(cb => lines[parseInt(cb.dataset.idx, 10)])
      .filter(Boolean);
    if (!selected.length) { showToast('info', 'No lines selected.'); return; }
    const cur = ta?.value.trim() || '';
    if (ta) ta.value = cur ? `${cur}\n${selected.join('\n')}` : selected.join('\n');
    overlay.remove();
    showToast('success', `Inserted ${selected.length} line${selected.length > 1 ? 's' : ''}.`);
  });
}

/* ============================================================ */
/* Clipboard helper                                              */
/* ============================================================ */

function copyText(text, label) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => showToast('success', `${label ? label + ' ' : ''}copied.`))
      .catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  try   { document.execCommand('copy'); showToast('info', 'Copied.'); }
  catch { showToast('error', 'Copy failed — please copy manually.'); }
  document.body.removeChild(ta);
}
