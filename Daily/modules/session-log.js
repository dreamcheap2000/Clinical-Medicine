/**
 * modules/session-log.js
 * Daily OPD session entry form with ICD-10 auto-search, SOAP template picker,
 * inline SOAP dropdowns, combined SOAP output with copy buttons, and timestamped persistence.
 */

import {
  getSessions, saveSession,
  getIcdData, searchCodes,
  getSoapFreq, recordSoapSelections,
  recordIcdUse,
  navigate, showToast, esc,
  saveSessionWithSync,
} from '../app.js';

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
          <input type="hidden" id="f-icd-code"    value="${esc(existing?.icdCode        || prefill?.code || '')}">
          <input type="hidden" id="f-icd-desc"    value="${esc(existing?.icdDescription || prefill?.en   || '')}">
          <input type="hidden" id="f-icd-zh"      value="${esc(existing?.icdZh          || prefill?.zh   || '')}">
          <input type="hidden" id="f-icd-cat"     value="${esc(existing?.categoryId     || '')}">
          <input type="hidden" id="f-icd-catname" value="${esc(existing?.categoryName   || '')}">
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
            <button type="button" class="btn btn-sm-inline" id="btn-template-picker">📋 All Template Items</button>
          </div>
          <div class="soap-fields">
            <div class="field-group soap-field-wrap" data-soap-key="s">
              <div class="soap-label-row">
                <label class="field-label">S — Subjective</label>
                <button type="button" class="btn btn-sm-inline soap-dropdown-btn" data-soap-key="s">▾ Items</button>
                <div class="soap-inline-dropdown hidden" data-soap-key="s"></div>
              </div>
              <textarea class="field-input field-textarea soap-textarea" id="f-soap-s" rows="3"
                placeholder="Patient-reported symptoms, history…">${esc(existing?.soap?.s || '')}</textarea>
            </div>
            <div class="field-group soap-field-wrap" data-soap-key="o">
              <div class="soap-label-row">
                <label class="field-label">O — Objective</label>
                <button type="button" class="btn btn-sm-inline soap-dropdown-btn" data-soap-key="o">▾ Items</button>
                <div class="soap-inline-dropdown hidden" data-soap-key="o"></div>
              </div>
              <textarea class="field-input field-textarea soap-textarea" id="f-soap-o" rows="3"
                placeholder="Physical exam findings, vitals, test results…">${esc(existing?.soap?.o || '')}</textarea>
            </div>
            <div class="field-group soap-field-wrap" data-soap-key="a">
              <div class="soap-label-row">
                <label class="field-label">A — Assessment</label>
                <button type="button" class="btn btn-sm-inline soap-dropdown-btn" data-soap-key="a">▾ Items</button>
                <div class="soap-inline-dropdown hidden" data-soap-key="a"></div>
              </div>
              <textarea class="field-input field-textarea soap-textarea" id="f-soap-a" rows="2"
                placeholder="Diagnosis, severity, clinical impression…">${esc(existing?.soap?.a || '')}</textarea>
            </div>
            <div class="field-group soap-field-wrap" data-soap-key="p">
              <div class="soap-label-row">
                <label class="field-label">P — Plan</label>
                <button type="button" class="btn btn-sm-inline soap-dropdown-btn" data-soap-key="p">▾ Items</button>
                <div class="soap-inline-dropdown hidden" data-soap-key="p"></div>
              </div>
              <textarea class="field-input field-textarea soap-textarea" id="f-soap-p" rows="2"
                placeholder="Treatment, referrals, follow-up, patient education…">${esc(existing?.soap?.p || '')}</textarea>
            </div>
          </div>
        </div>

        <!-- Combined SOAP output -->
        <div class="combined-soap-wrap">
          <div class="combined-soap-header">
            <span class="field-label">📋 Combined SOAP Output</span>
            <button type="button" class="btn btn-sm-inline" id="btn-copy-all-soap">📋 Copy All</button>
          </div>
          <div id="combined-soap-output" class="combined-soap-box">
            <p class="no-records" style="font-size:.85rem">Fill in SOAP fields above to preview combined output.</p>
          </div>
        </div>

        <!-- Actions -->
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">💾 Save Entry</button>
          <button type="button" class="btn btn-outline" id="btn-cancel">Cancel</button>
        </div>
      </form>
    </div>

    <!-- SOAP reference panel (hidden by default) -->
    <div id="soap-panel" class="soap-panel hidden"></div>
  `;

  wireForm(container, existing);
}

/* ------------------------------------------------------------------ */

function wireForm(container, existing) {
  const form              = container.querySelector('#opd-form');
  const searchInput       = container.querySelector('#f-icd-search');
  const dropdown          = container.querySelector('#icd-dropdown');
  const badge             = container.querySelector('#icd-selected-badge');
  const btnClear          = container.querySelector('#btn-clear-icd');
  const btnTemplatePicker = container.querySelector('#btn-template-picker');
  const soapPanel         = container.querySelector('#soap-panel');

  let _icdData    = null;
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
      <button type="button" class="btn-soap-link" id="btn-view-soap">📋 View SOAP / Exam</button>`;
    badge.classList.remove('hidden');

    wireViewSoap(badge, cat, _icdData, soapPanel);
    updateCombinedSoap(form);
    refreshInlineDropdowns(cat);
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
    form.querySelectorAll('.soap-inline-dropdown').forEach(d => d.classList.add('hidden'));
    updateCombinedSoap(form);
    refreshInlineDropdowns('');
  });

  /* View SOAP reference for pre-existing selected code */
  if (existing?.categoryId) {
    const btnViewSoap = badge.querySelector('#btn-view-soap');
    if (btnViewSoap) {
      getIcdData().then(d => { wireViewSoap(badge, existing.categoryId, d, soapPanel); });
    }
  }

  /* Template picker button */
  btnTemplatePicker.addEventListener('click', async () => {
    const catId = form.querySelector('#f-icd-cat').value;
    if (!catId) { showToast('error', 'Select an ICD code first to load its category template.'); return; }
    if (!_icdData) _icdData = await getIcdData();
    const catObj = (_icdData.categories || []).find(c => c.id === catId);
    if (!catObj) { showToast('error', 'Category not found.'); return; }
    openTemplatePicker(catObj, catId, form);
  });

  /* Inline SOAP dropdowns — populate when an ICD category is selected */
  const SOAP_KEY_MAP = {
    s: cat => cat.soap?.subjective        || [],
    o: cat => cat.soap?.objective          || [],
    a: cat => cat.soap?.assessment_pearls || [],
    p: cat => cat.soap?.plan_template      || [],
  };

  function refreshInlineDropdowns(catId) {
    form.querySelectorAll('.soap-dropdown-btn').forEach(btn => {
      btn.disabled = !catId;
    });
  }

  function populateInlineDropdown(key, catObj) {
    const dd = form.querySelector(`.soap-inline-dropdown[data-soap-key="${key}"]`);
    if (!dd) return;
    const items = SOAP_KEY_MAP[key]?.(catObj) || [];
    if (!items.length) { dd.innerHTML = '<div class="sid-empty">No items for this category.</div>'; return; }
    dd.innerHTML = items.map(item => `
      <label class="sid-item">
        <input type="checkbox" class="sid-cb" data-key="${key}" data-text="${esc(item)}">
        <span class="sid-text">${esc(item)}</span>
      </label>`).join('') +
      `<div class="sid-footer">
        <button type="button" class="btn-sid-insert" data-key="${key}">✓ Insert Checked</button>
      </div>`;
    dd.querySelector('.btn-sid-insert')?.addEventListener('click', () => {
      const checked = [...dd.querySelectorAll(`.sid-cb[data-key="${key}"]:checked`)];
      if (!checked.length) { showToast('info', 'Check some items first.'); return; }
      const items = checked.map(cb => cb.dataset.text);
      const ta = form.querySelector(`#f-soap-${key}`);
      if (ta) {
        const cur = ta.value.trim();
        ta.value = cur ? `${cur}\n${items.join('\n')}` : items.join('\n');
        ta.dispatchEvent(new Event('input'));
      }
      recordSoapSelections(form.querySelector('#f-icd-cat').value, items);
      dd.classList.add('hidden');
      showToast('success', `Added ${items.length} item${items.length > 1 ? 's' : ''}.`);
    });
  }

  /* Wire dropdown toggle buttons */
  form.querySelectorAll('.soap-dropdown-btn').forEach(btn => {
    btn.disabled = true;
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const key = btn.dataset.soapKey;
      const dd  = form.querySelector(`.soap-inline-dropdown[data-soap-key="${key}"]`);
      if (!dd) return;
      const isOpen = !dd.classList.contains('hidden');
      /* close all other dropdowns */
      form.querySelectorAll('.soap-inline-dropdown').forEach(d => d.classList.add('hidden'));
      if (!isOpen) {
        const catId = form.querySelector('#f-icd-cat').value;
        if (!_icdData) _icdData = await getIcdData();
        const catObj = (_icdData.categories || []).find(c => c.id === catId);
        if (catObj) populateInlineDropdown(key, catObj);
        dd.classList.remove('hidden');
      }
    });
  });

  /* Re-enable dropdown buttons whenever a category is selected (initial state) */
  const catInput = form.querySelector('#f-icd-cat');
  if (catInput.value) refreshInlineDropdowns(catInput.value);

  /* Combined SOAP — auto-update on every keystroke */
  ['#f-soap-s', '#f-soap-o', '#f-soap-a', '#f-soap-p', '#f-ebm'].forEach(id => {
    form.querySelector(id)?.addEventListener('input', () => updateCombinedSoap(form));
  });
  updateCombinedSoap(form);

  /* Copy all combined SOAP */
  container.querySelector('#btn-copy-all-soap').addEventListener('click', () => {
    const text = getAllSoapText(form);
    if (!text) { showToast('info', 'Nothing to copy — fill in the SOAP fields first.'); return; }
    copyText(text, 'Combined SOAP');
  });

  /* Close ICD dropdown & inline SOAP dropdowns on outside click */
  container.addEventListener('click', e => {
    if (!e.target.closest('#f-icd-search') && !e.target.closest('#icd-dropdown')) {
      dropdown.classList.add('hidden');
    }
    if (!e.target.closest('.soap-label-row')) {
      form.querySelectorAll('.soap-inline-dropdown').forEach(d => d.classList.add('hidden'));
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

    const now       = new Date();
    const timestamp = `${date} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    const session = {
      id:             existing?.id || `opd-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      date,
      timestamp,
      patientId:      form.querySelector('#f-pid').value.trim()      || null,
      icdCode:        form.querySelector('#f-icd-code').value         || null,
      icdDescription: form.querySelector('#f-icd-desc').value         || null,
      icdZh:          form.querySelector('#f-icd-zh').value           || null,
      categoryId:     form.querySelector('#f-icd-cat').value          || null,
      categoryName:   form.querySelector('#f-icd-catname').value      || null,
      condition,
      ebm:  form.querySelector('#f-ebm').value.trim()                 || null,
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
    recordIcdUse(session);
    showToast('success', `Entry saved at ${timestamp}.`);
    saveSessionWithSync(session).catch(() => {/* sync errors already toasted */});
    navigate('dashboard');
  });
}

/* ------------------------------------------------------------------ */
/* Template picker modal                                                */
/* ------------------------------------------------------------------ */

function openTemplatePicker(catObj, catId, form) {
  /* Remove any existing overlay */
  document.getElementById('soap-picker-overlay')?.remove();

  const catFreq = getSoapFreq()[catId] || {};

  /* Build sections with frequency-sorted items */
  const sections = [
    { label: '🗣️ S — Subjective',       key: 's', items: catObj.soap?.subjective        || [] },
    { label: '🔎 O — Objective',         key: 'o', items: catObj.soap?.objective          || [] },
    { label: '💡 A — Assessment Pearls', key: 'a', items: catObj.soap?.assessment_pearls || [] },
    { label: '🗂️ P — Plan',              key: 'p', items: catObj.soap?.plan_template      || [] },
  ];

  /* Sort each section descending by use count; ties keep original order */
  sections.forEach(sec => {
    sec.sortedItems = sec.items
      .map((text, origIdx) => ({ text, origIdx, count: catFreq[text] || 0 }))
      .sort((a, b) => b.count - a.count || a.origIdx - b.origIdx);
  });

  const hasItems = sections.some(s => s.sortedItems.length > 0);
  if (!hasItems) { showToast('error', 'No SOAP template items for this category.'); return; }

  const overlay = document.createElement('div');
  overlay.id        = 'soap-picker-overlay';
  overlay.className = 'picker-overlay';
  overlay.innerHTML = `
    <div class="picker-panel" role="dialog" aria-modal="true" aria-label="SOAP Template Picker">
      <div class="picker-header">
        <span>${catObj.icon || '📋'} ${esc(catObj.nameEn)} — Template Picker</span>
        <button type="button" class="picker-close-btn" id="picker-close-x" aria-label="Close">✕</button>
      </div>
      <div class="picker-body">
        ${sections.map(sec => sec.sortedItems.length === 0 ? '' : `
          <div class="picker-section">
            <div class="picker-section-title">${sec.label}</div>
            ${sec.sortedItems.map(({ text, count }) => `
              <label class="picker-item">
                <input type="checkbox" class="picker-cb" data-section="${sec.key}" data-text="${esc(text)}">
                <span class="picker-item-text">${esc(text)}</span>
                ${count > 0 ? `<span class="freq-badge">×${count}</span>` : ''}
              </label>`).join('')}
          </div>`).join('')}
      </div>
      <div class="picker-footer">
        <button type="button" class="btn btn-outline" id="picker-clear-all">Clear All</button>
        <button type="button" class="btn btn-primary" id="picker-close-fill">✓ Close &amp; Fill</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  /* Close on backdrop click or X button */
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#picker-close-x').addEventListener('click', () => overlay.remove());

  /* Clear all checkboxes */
  overlay.querySelector('#picker-clear-all').addEventListener('click', () => {
    overlay.querySelectorAll('.picker-cb').forEach(cb => { cb.checked = false; });
  });

  /* Close & Fill: append checked items to textareas */
  overlay.querySelector('#picker-close-fill').addEventListener('click', () => {
    const selected = { s: [], o: [], a: [], p: [] };
    overlay.querySelectorAll('.picker-cb:checked').forEach(cb => {
      const sec  = cb.dataset.section;
      /* dataset automatically decodes HTML entities from the data-text attribute
         (which was encoded via esc() when building the picker HTML), so the value
         here is the original unencoded template text. */
      const text = cb.dataset.text;
      if (sec in selected) selected[sec].push(text);
    });

    const fieldMap   = { s: '#f-soap-s', o: '#f-soap-o', a: '#f-soap-a', p: '#f-soap-p' };
    let   totalAdded = 0;

    for (const [sec, items] of Object.entries(selected)) {
      if (!items.length) continue;
      const ta  = form.querySelector(fieldMap[sec]);
      if (!ta) continue;
      const cur = ta.value.trim();
      ta.value  = cur ? `${cur}\n${items.join('\n')}` : items.join('\n');
      totalAdded += items.length;
    }

    /* Record selections for frequency learning */
    const allSelected = Object.values(selected).flat();
    if (allSelected.length) recordSoapSelections(catId, allSelected);

    overlay.remove();
    updateCombinedSoap(form);

    if (totalAdded > 0) showToast('success', `Added ${totalAdded} template item${totalAdded > 1 ? 's' : ''}.`);
    else                showToast('info', 'No items selected.');
  });
}

/* ------------------------------------------------------------------ */
/* Combined SOAP output helpers                                         */
/* ------------------------------------------------------------------ */

function getCombinedLines(form) {
  const s       = form.querySelector('#f-soap-s')?.value.trim()  || '';
  const o       = form.querySelector('#f-soap-o')?.value.trim()  || '';
  const a       = form.querySelector('#f-soap-a')?.value.trim()  || '';
  const p       = form.querySelector('#f-soap-p')?.value.trim()  || '';
  const ebm     = form.querySelector('#f-ebm')?.value.trim()     || '';
  const icdCode = form.querySelector('#f-icd-code')?.value       || '';
  const icdDesc = form.querySelector('#f-icd-desc')?.value       || '';
  const icdZh   = form.querySelector('#f-icd-zh')?.value         || '';

  const lines = [];
  if (s)       lines.push({ label: 'S',   text: s });
  if (o)       lines.push({ label: 'O',   text: o });
  if (a)       lines.push({ label: 'A',   text: a });
  if (p)       lines.push({ label: 'P',   text: p });
  if (icdCode) lines.push({ label: 'ICD', text: `${icdCode}${icdDesc ? ' — ' + icdDesc : ''}${icdZh ? ' · ' + icdZh : ''}` });
  if (ebm)     lines.push({ label: 'EBM', text: ebm });
  return lines;
}

function getAllSoapText(form) {
  return getCombinedLines(form).map(l => `${l.label}: ${l.text}`).join('\n');
}

function updateCombinedSoap(form) {
  const output = form.closest('#main-content')?.querySelector('#combined-soap-output')
               || document.querySelector('#combined-soap-output');
  if (!output) return;

  const lines = getCombinedLines(form);
  if (!lines.length) {
    output.innerHTML = '<p class="no-records" style="font-size:.85rem">Fill in SOAP fields above to preview combined output.</p>';
    return;
  }

  output.innerHTML = lines.map((line, idx) => `
    <div class="soap-output-line">
      <span class="soap-output-label">${line.label}:</span>
      <span class="soap-output-text">${esc(line.text)}</span>
      <button type="button" class="btn-copy-line" data-idx="${idx}" title="Copy ${line.label}">📋</button>
    </div>`).join('');

  output.querySelectorAll('.btn-copy-line').forEach(btn => {
    const idx  = parseInt(btn.dataset.idx, 10);
    const line = lines[idx];
    btn.addEventListener('click', () => copyText(`${line.label}: ${line.text}`, line.label));
  });
}

/* ------------------------------------------------------------------ */
/* Clipboard helper                                                     */
/* ------------------------------------------------------------------ */

function copyText(text, label) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => showToast('success', `${label ? label + ' ' : ''}copied to clipboard.`))
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

/* ------------------------------------------------------------------ */
/* SOAP reference panel (view only, not fill)                          */
/* ------------------------------------------------------------------ */

function wireViewSoap(badge, catId, icdData, soapPanel) {
  const btn = badge.querySelector('#btn-view-soap');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const catObj = (icdData.categories || []).find(c => c.id === catId);
    if (!catObj) return;
    soapPanel.classList.remove('hidden');
    soapPanel.innerHTML = buildSoapHtml(catObj);
    soapPanel.querySelector('#btn-close-soap')?.addEventListener('click', () => {
      soapPanel.classList.add('hidden');
    });
    soapPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function buildSoapHtml(cat) {
  const s  = cat.soap || {};
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
      ${peSection('🩺 Bedside Scales / Cognitive Tests', pe.bedside_scales || pe.bedside_cognitive)}
      ${peSection('🔬 Neurologic / Physical Exam', pe.neurologic_exam)}
    </div>`;
}

function soapSection(title, items) {
  if (!items?.length) return '';
  return `<div class="ref-section">
    <div class="ref-title">${title}</div>
    <ul class="ref-list">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
  </div>`;
}
function peSection(title, items) { return soapSection(title, items); }
