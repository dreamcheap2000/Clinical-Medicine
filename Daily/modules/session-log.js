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
  buildCombinedObjective,
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
/* Form draft — preserves form state across navigation           */
/* ============================================================ */

const DRAFT_KEY = 'opdFormDraft_v1';

function loadFormDraft() {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); }
  catch { return null; }
}

function clearFormDraft() {
  sessionStorage.removeItem(DRAFT_KEY);
}

function saveFormDraft(form, icdCodes) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      date:        form.querySelector('#f-date')?.value      || '',
      patientId:   form.querySelector('#f-pid')?.value       || '',
      patientType: form.querySelector('#f-pt')?.value        || '',
      icdCodes:    Array.isArray(icdCodes) ? icdCodes : [],
      condition:   form.querySelector('#f-condition')?.value || '',
      keyLearning: form.querySelector('#f-klp')?.value       || '',
      soapText:    form.querySelector('#f-soap-text')?.value || '',
    }));
  } catch { /* ignore */ }
}

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

  /* Load auto-saved form draft (non-edit mode only) */
  const draft = !editId ? loadFormDraft() : null;
  clearFormDraft();

  /* ── Resolve initial ICD codes (multiple per patient) ── */
  let initIcdCodes;
  if (existing) {
    /* Edit mode: restore from saved record */
    initIcdCodes = existing.icdCodes
      || (existing.icdCode
          ? [{ code: existing.icdCode, en: existing.icdDescription || '', zh: existing.icdZh || '',
               categoryId: existing.categoryId || '', categoryName: existing.categoryName || '' }]
          : []);
  } else {
    /* New entry: start with draft codes */
    initIcdCodes = draft?.icdCodes || [];
    /* Add prefill ICD code from ICD browser if not already present */
    if (prefill?.code) {
      const alreadyHas = initIcdCodes.some(c => c.code === prefill.code);
      if (!alreadyHas) {
        initIcdCodes = [...initIcdCodes,
          { code: prefill.code, en: prefill.en || '', zh: prefill.zh || '',
            categoryId: prefill.categoryId || '', categoryName: '' }];
      }
    }
  }

  /* ── Resolve initial form field values (draft > existing > defaults) ── */
  const initDate        = existing?.date        || draft?.date        || new Date().toISOString().slice(0,10);
  const initPid         = existing?.patientId   || draft?.patientId   || '';
  const initPt          = existing?.patientType || draft?.patientType || '';
  const initCondition   = existing?.condition   || draft?.condition
    || (prefill && !draft ? (prefill.en || '') : '');
  const initKlp         = existing?.keyLearning || existing?.ebm || draft?.keyLearning || '';

  /* ── Resolve SOAP text (draft/existing + append prefill_soap_text) ── */
  const baseText = existing?.soapText ||
    [existing?.soap?.s && `S: ${existing.soap.s}`,
     existing?.soap?.o && `O: ${existing.soap.o}`,
     existing?.soap?.a && `A: ${existing.soap.a}`,
     existing?.soap?.p && `P: ${existing.soap.p}`]
    .filter(Boolean).join('\n\n') || draft?.soapText || '';
  const existingSoapText = baseText && prefillSoapText
    ? `${baseText}\n\n${prefillSoapText}`
    : (baseText || prefillSoapText);

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
                  value="${esc(initDate)}">
              </div>
              <div class="field-group">
                <label class="field-label" for="f-pid">Patient ID (optional)</label>
                <input class="field-input" type="text" id="f-pid" placeholder="e.g. 0001"
                  value="${esc(initPid)}">
              </div>
            </div>

            <!-- Patient type -->
            <div class="field-group">
              <label class="field-label" for="f-pt">Special Patient Type</label>
              <select class="field-input" id="f-pt">
                ${PATIENT_TYPES.map(t =>
                  `<option value="${esc(t)}" ${initPt === t ? 'selected' : ''}>${esc(t || '— none —')}</option>`
                ).join('')}
              </select>
            </div>

            <!-- ICD codes (multiple) -->
            <div class="field-group" style="position:relative">
              <label class="field-label" for="f-icd-search">ICD-10 Codes</label>
              <!-- Selected codes tags -->
              <div id="icd-codes-list" class="icd-codes-list">
                ${initIcdCodes.map((c, i) => buildIcdTag(c, i)).join('')}
              </div>
              <!-- Search row -->
              <div class="icd-search-row">
                <input class="field-input" type="text" id="f-icd-search"
                  placeholder="Search code (e.g. G43) or condition (e.g. migraine / 偏頭痛) — click result to add…">
                <button type="button" class="btn btn-sm-inline" id="btn-clear-icd" title="Clear search input">✕</button>
              </div>
              <div id="icd-dropdown" class="icd-dropdown hidden"></div>
              <!-- Hidden primary-code fields (backward compat — always = first in icdCodes) -->
              <input type="hidden" id="f-icd-code"    value="${esc(initIcdCodes[0]?.code         || '')}">
              <input type="hidden" id="f-icd-desc"    value="${esc(initIcdCodes[0]?.en           || '')}">
              <input type="hidden" id="f-icd-zh"      value="${esc(initIcdCodes[0]?.zh           || '')}">
              <input type="hidden" id="f-icd-cat"     value="${esc(initIcdCodes[0]?.categoryId   || '')}">
              <input type="hidden" id="f-icd-catname" value="${esc(initIcdCodes[0]?.categoryName || '')}">
            </div>

            <!-- Patient condition / chief complaint -->
            <div class="field-group">
              <label class="field-label" for="f-condition">Patient Condition / Presentation</label>
              <textarea class="field-input field-textarea" id="f-condition" rows="2"
                placeholder="Chief complaint, relevant history, clinical context… (optional)">${esc(initCondition)}</textarea>
            </div>

            <!-- Key learning / EBM -->
            <div class="field-group">
              <label class="field-label" for="f-klp">Key Learning Point / EBM Statement</label>
              <textarea class="field-input field-textarea" id="f-klp" rows="2"
                placeholder="Evidence-based statement, guideline reference, clinical pearl…">${esc(initKlp)}</textarea>
            </div>

            <!-- Combined SOAP note -->
            <div class="field-group">
              <div class="soap-header">
                <span>📋 SOAP Note (combined)</span>
                <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center">
                  <button type="button" class="btn btn-sm-inline" id="btn-tmpl-load">📂 Load Template</button>
                  <button type="button" class="btn btn-sm-inline" id="btn-tmpl-save">💾 Save as Template</button>
                  <button type="button" class="btn btn-sm-inline" id="btn-copy-soap">📋 Copy</button>
                  <button type="button" class="btn btn-sm-inline" id="btn-show-ghost-soap">🔍 Template Items</button>
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

  wireForm(container, existing, initIcdCodes);
}

/* ============================================================ */
/* ICD tag builder (multiple codes display)                      */
/* ============================================================ */

function buildIcdTag(c, idx) {
  return `<span class="icd-code-tag" data-idx="${idx}">
    <span class="tag tag-code">${esc(c.code)}</span>
    <span class="icd-tag-desc">${esc(c.en)}${c.zh ? ' · ' + esc(c.zh) : ''}</span>
    <button type="button" class="icd-tag-remove" data-idx="${idx}" title="Remove this code">×</button>
  </span>`;
}

/* ============================================================ */
/* Wire form logic                                               */
/* ============================================================ */

function wireForm(container, existing, initIcdCodes) {
  const form        = container.querySelector('#opd-form');
  const searchInput = container.querySelector('#f-icd-search');
  const dropdown    = container.querySelector('#icd-dropdown');
  const codesList   = container.querySelector('#icd-codes-list');
  const ghostPanel  = container.querySelector('#ghost-panel');
  const ghostBody   = container.querySelector('#ghost-panel-body');
  const ghostCol    = container.querySelector('#ghost-col');

  /* Working array of selected ICD codes */
  let icdCodes = Array.isArray(initIcdCodes) ? [...initIcdCodes] : [];

  let _icdData    = null;
  let _searchTimer = null;

  getIcdData().then(d => {
    _icdData = d;
    /* If we already have a category (from prefill or existing), load ghost panel */
    const catId = form.querySelector('#f-icd-cat').value;
    if (catId) loadGhostPanel(catId, d);
  });

  /* ── Helpers: update hidden primary-code fields + tags DOM ── */
  function updatePrimaryFields() {
    const p = icdCodes[0] || {};
    form.querySelector('#f-icd-code').value    = p.code        || '';
    form.querySelector('#f-icd-desc').value    = p.en          || '';
    form.querySelector('#f-icd-zh').value      = p.zh          || '';
    form.querySelector('#f-icd-cat').value     = p.categoryId  || '';
    form.querySelector('#f-icd-catname').value = p.categoryName || '';
  }

  function refreshCodesList() {
    codesList.innerHTML = icdCodes.map((c, i) => buildIcdTag(c, i)).join('');
    /* Wire remove buttons */
    codesList.querySelectorAll('.icd-tag-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        icdCodes.splice(idx, 1);
        refreshCodesList();
        updatePrimaryFields();
        saveDraft();
        /* Reset ghost panel if no codes left */
        if (!icdCodes.length) {
          ghostBody.innerHTML = '<p class="no-records" style="padding:1rem;font-size:.85rem">Select an ICD code to load template items.</p>';
          container.querySelector('#ghost-panel-title').textContent = '📋 SOAP Reference';
        }
      });
    });
  }

  /* ── Auto-save draft on any form change ── */
  function saveDraft() {
    saveFormDraft(form, icdCodes);
  }
  form.addEventListener('input',  saveDraft);
  form.addEventListener('change', saveDraft);
  /* Save immediately so prefill data (from ICD browser / SOAP templates) is
     persisted before the user navigates away again without touching any field */
  saveDraft();

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

    /* Add to codes array if not already present */
    if (!icdCodes.some(c => c.code === code)) {
      icdCodes.push({ code, en, zh, categoryId: cat, categoryName: catName });
      refreshCodesList();
      updatePrimaryFields();
    }

    searchInput.value = '';
    dropdown.classList.add('hidden');

    /* Pre-fill condition field if empty */
    const condField = form.querySelector('#f-condition');
    if (!condField.value.trim()) condField.value = en;

    /* Load ghost panel for the just-selected code's category */
    if (catObj) loadGhostPanel(cat, _icdData);
    ghostCol.classList.add('ghost-visible');

    saveDraft();
  });

  /* ── Clear search input only (does not remove selected codes) ── */
  container.querySelector('#btn-clear-icd').addEventListener('click', () => {
    searchInput.value = '';
    dropdown.classList.add('hidden');
  });

  /* ── Close ICD dropdown on outside click ── */
  container.addEventListener('click', e => {
    if (!e.target.closest('#f-icd-search') && !e.target.closest('#icd-dropdown'))
      dropdown.classList.add('hidden');
  });

  /* ── Show/hide ghost panel ── */
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
    const session = buildSession(form, existing, icdCodes);
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
      id:        `tmpl-${typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : Date.now().toString(36)}`,
      name:      name.trim(),
      text,
      createdAt: new Date().toISOString(),
    };
    saveSoapTemplate(tmpl);
    showToast('success', `Template "${tmpl.name}" saved.`);
  });

  /* ── Cancel (clear draft and go home) ── */
  container.querySelector('#btn-cancel').addEventListener('click', () => {
    clearFormDraft();
    navigate('dashboard');
  });

  /* ── Submit (clear draft and save) ── */
  form.addEventListener('submit', e => {
    e.preventDefault();
    const session = buildSession(form, existing, icdCodes);
    if (!session) return;
    clearFormDraft();
    saveSession(session);
    recordIcdUse(session);
    showToast('success', `Entry saved at ${session.timestamp}.`);
    saveSessionWithSync(session).catch(err => { console.warn('Sync error:', err); });
    navigate('dashboard');
  });

  /* ── Load ghost panel for a given category ── */
  function loadGhostPanel(catId, icdData) {
    const catObj = (icdData.categories || []).find(c => c.id === catId);
    if (!catObj) return;
    container.querySelector('#ghost-panel-title').textContent =
      `${catObj.icon || '📋'} ${catObj.nameEn} — Template`;
    ghostBody.innerHTML = buildGhostContent(catObj, catId);
    wireGhostInsert(ghostBody, form, catId);
  }
}

/* ============================================================ */
/* Build session object from form                                */
/* ============================================================ */

function buildSession(form, existing, icdCodes) {
  const date = form.querySelector('#f-date').value.trim();
  if (!date) { showToast('error', 'Date is required.'); return null; }

  const soapText = form.querySelector('#f-soap-text').value.trim();
  const now      = new Date();
  const timestamp = `${date} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  /* Try to split combined text into S/O/A/P sections (best effort) */
  const soapSplit = splitSoapText(soapText);

  /* Use icdCodes array; also expose primary fields for backward compat */
  const codes   = Array.isArray(icdCodes) && icdCodes.length ? icdCodes : null;
  const primary = codes?.[0] || null;

  return {
    id:             existing?.id || `opd-${typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Date.now().toString(36)}`}`,
    date,
    timestamp,
    patientId:      form.querySelector('#f-pid').value.trim()       || null,
    patientType:    form.querySelector('#f-pt').value               || null,
    /* Multiple ICD codes (new) */
    icdCodes:       codes,
    /* Primary code fields (backward compat = first in array) */
    icdCode:        primary?.code         || null,
    icdDescription: primary?.en           || null,
    icdZh:          primary?.zh           || null,
    categoryId:     primary?.categoryId   || null,
    categoryName:   primary?.categoryName || null,
    condition:      form.querySelector('#f-condition').value.trim() || null,
    keyLearning:    form.querySelector('#f-klp').value.trim()       || null,
    ebm:            form.querySelector('#f-klp').value.trim()       || null,
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

  /* Merge SOAP Objective + Neurologic/Physical Exam + Bedside Scales into one
     Objective section; deduplicate and sort alphabetically to group similar items */
  const combinedObjective = buildCombinedObjective(s, pe);

  const sections = [
    { key: 's', label: '🗣️ Subjective',  items: s.subjective        || [] },
    { key: 'o', label: '🔎 Objective',    items: combinedObjective },
    { key: 'a', label: '💡 Assessment',   items: s.assessment_pearls || [] },
    { key: 'p', label: '🗂️ Plan',         items: s.plan_template      || [] },
  ].filter(sec => sec.items.length > 0);

  if (!sections.length) {
    return '<p class="no-records" style="padding:1rem;font-size:.85rem">No template items for this category.</p>';
  }

  const catFreq = getSoapFreq()[catId] || {};

  return `
    <div class="ghost-insert-all-row">
      <span class="hint" style="font-size:.8rem">Check items then <b>Insert</b> — only the term before <b>":"</b> is inserted</span>
      <button type="button" class="btn-ref-action ghost-copy-all-btn">📋 Copy All Checked</button>
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
            ${sorted.map(({ text, count }) => {
              /* Split on first ":" to distinguish term from detail */
              const colonIdx = text.indexOf(':');
              const term   = colonIdx >= 0 ? text.slice(0, colonIdx).trim() : text;
              const detail = colonIdx >= 0 ? text.slice(colonIdx + 1).trim() : '';
              return `
              <label class="ghost-item">
                <input type="checkbox" class="ghost-cb" data-sec="${esc(sec.key)}"
                  data-text="${esc(text)}" data-term="${esc(term)}">
                <span class="ghost-item-text">
                  <b>${esc(term)}</b>${detail ? `<span class="ghost-item-detail">: ${esc(detail)}</span>` : ''}
                </span>
                ${count > 0 ? `<span class="freq-badge">×${count}</span>` : ''}
              </label>`;
            }).join('')}
          </div>
        </div>`;
    }).join('')}
  `;
}

/**
 * Returns the term with exactly one trailing colon.
 * Avoids double-colon if the term already ends with ":".
 */
function termWithColon(term) {
  return term.endsWith(':') ? term : `${term}:`;
}

function wireGhostInsert(ghostBody, form, catId) {
  const ta = form.querySelector('#f-soap-text');

  /* Global copy-all-checked button — copies full text for reference */
  ghostBody.querySelector('.ghost-copy-all-btn')?.addEventListener('click', () => {
    const checked = [...ghostBody.querySelectorAll('.ghost-cb:checked')];
    if (!checked.length) { showToast('info', 'Check some items first.'); return; }
    const text = checked.map(cb => cb.dataset.text).join('\n');
    copyText(text, 'Checked items');
  });

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

  /* Insert checked items for a section — uses only term before ":" */
  ghostBody.querySelectorAll('.ghost-insert-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sec     = btn.dataset.sec;
      const checked = [...ghostBody.querySelectorAll(`.ghost-cb[data-sec="${sec}"]:checked`)];
      if (!checked.length) { showToast('info', 'Check some items first.'); return; }

      /* Use data-term (part before ":") for insertion; full text is in data-text for recording */
      const fullTextItems = checked.map(cb => cb.dataset.text);
      const termItems     = checked.map(cb => cb.dataset.term || cb.dataset.text);

      if (ta) {
        const cur   = ta.value.trim();
        const toAdd = termItems.map(termWithColon).join('\n');
        ta.value = cur ? `${cur}\n${toAdd}` : toAdd;
        /* Programmatic value assignment doesn't fire 'input', so dispatch it manually
           so the auto-save draft captures the newly inserted text before any navigation */
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      recordSoapSelections(catId, fullTextItems);
      checked.forEach(cb => { cb.checked = false; });
      showToast('success', `Inserted ${termItems.length} item${termItems.length > 1 ? 's' : ''}.`);
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
      ta.dispatchEvent(new Event('input', { bubbles: true }));
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
    if (ta) {
      ta.value = cur ? `${cur}\n${selected.join('\n')}` : selected.join('\n');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
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
