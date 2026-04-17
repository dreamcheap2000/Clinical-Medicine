/**
 * modules/soap-view.js
 * Displays all category SOAP templates and physical exam guides side-by-side.
 * Items are rendered as checkboxes so users can select, copy, or insert into new entries.
 */

import { getIcdData, navigate, esc, showToast } from '../app.js';

export async function renderSoapView(opts = {}) {
  const container = document.getElementById('main-content');
  container.innerHTML = `<p style="padding:2rem;color:#888">Loading templates…</p>`;

  let icdData;
  try { icdData = await getIcdData(); }
  catch(e) {
    container.innerHTML = `<div class="card" style="color:red">⚠️ ${esc(e.message)}</div>`;
    return;
  }

  const cats = icdData.categories || [];

  container.innerHTML = `
    <h2 class="page-title">📋 SOAP &amp; Physical Exam Templates</h2>
    <p class="subtitle">Check items to select them — then copy or insert directly into a new OPD entry</p>

    <!-- Copy-all-checked across ALL sections -->
    <div class="soap-view-global-actions">
      <button class="btn btn-outline" id="soap-view-copy-all-checked">📋 Copy All Checked</button>
      <button class="btn btn-primary" id="soap-view-insert-all-checked">➕ Insert All Checked to New Entry</button>
    </div>

    <div class="accordion" id="soap-accordion">
      ${cats.map(c => buildAccordionItem(c)).join('')}
    </div>
  `;

  /* Accordion toggle */
  container.querySelectorAll('.accordion-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const item  = hdr.closest('.accordion-item');
      const body  = item.querySelector('.accordion-body');
      const arrow = hdr.querySelector('.acc-arrow');
      const open  = !body.classList.contains('hidden');
      /* close all */
      container.querySelectorAll('.accordion-body').forEach(b => b.classList.add('hidden'));
      container.querySelectorAll('.acc-arrow').forEach(a => a.textContent = '▶');
      if (!open) {
        body.classList.remove('hidden');
        arrow.textContent = '▼';
        body.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });

  /* Copy-checked buttons (per section) */
  container.addEventListener('click', e => {
    const btn = e.target.closest('.soap-view-copy-btn');
    if (!btn) return;
    const section = btn.closest('.ref-section');
    if (!section) return;
    const checked = [...section.querySelectorAll('.soap-view-cb:checked')];
    if (!checked.length) { showToast('info', 'No items checked — tick some items first.'); return; }
    const text = checked.map(cb => cb.dataset.text).join('\n');
    _copyText(text);
  });

  /* Insert-checked buttons (per section) → prefill new entry */
  container.addEventListener('click', e => {
    const btn = e.target.closest('.soap-view-insert-btn');
    if (!btn) return;
    const section = btn.closest('.ref-section');
    if (!section) return;
    const checked = [...section.querySelectorAll('.soap-view-cb:checked')];
    if (!checked.length) { showToast('info', 'No items checked — tick some items first.'); return; }
    const text = checked.map(cb => cb.dataset.text).join('\n');
    sessionStorage.setItem('prefill_soap_text', text);
    navigate('log');
  });

  /* Global copy-all-checked (across all open sections) */
  container.querySelector('#soap-view-copy-all-checked')?.addEventListener('click', () => {
    const checked = [...container.querySelectorAll('.soap-view-cb:checked')];
    if (!checked.length) { showToast('info', 'No items checked anywhere.'); return; }
    _copyText(checked.map(cb => cb.dataset.text).join('\n'));
  });

  /* Global insert-all-checked → prefill new entry */
  container.querySelector('#soap-view-insert-all-checked')?.addEventListener('click', () => {
    const checked = [...container.querySelectorAll('.soap-view-cb:checked')];
    if (!checked.length) { showToast('info', 'No items checked anywhere.'); return; }
    const text = checked.map(cb => cb.dataset.text).join('\n');
    sessionStorage.setItem('prefill_soap_text', text);
    navigate('log');
  });

  /* Select-all / clear-all toggle */
  container.addEventListener('click', e => {
    const btn = e.target.closest('.soap-view-toggle-all');
    if (!btn) return;
    const section = btn.closest('.ref-section');
    if (!section) return;
    const cbs    = [...section.querySelectorAll('.soap-view-cb')];
    const allChk = cbs.every(cb => cb.checked);
    cbs.forEach(cb => { cb.checked = !allChk; });
    btn.textContent = allChk ? 'Select All' : 'Clear All';
  });

  /* Open the first item by default (or requested one) */
  const initId  = opts.categoryId || cats[0]?.id;
  const initHdr = container.querySelector(`.accordion-header[data-cat="${initId}"]`);
  if (initHdr) initHdr.click();
}

/* ------------------------------------------------------------------ */

function buildAccordionItem(cat) {
  const s  = cat.soap || {};
  const pe = cat.physicalExam || {};

  return `
    <div class="accordion-item">
      <button class="accordion-header" data-cat="${esc(cat.id)}" type="button">
        <span class="cat-icon">${cat.icon || ''}</span>
        <span class="acc-title">
          <b>${esc(cat.nameEn)}</b>
          <span class="acc-zh">${esc(cat.nameZh)}</span>
          <span class="hint">${esc(cat.codeRange || '')}</span>
        </span>
        <span class="acc-arrow">▶</span>
      </button>

      <div class="accordion-body hidden">
        <div class="soap-two-col">

          <!-- Left: SOAP -->
          <div class="soap-col">
            <h4 class="col-title">📋 SOAP Template</h4>
            ${soapBlock('🗣️ S — Subjective', s.subjective)}
            ${soapBlock('🔎 O — Objective',   s.objective)}
            ${soapBlock('💡 Assessment Pearls', s.assessment_pearls)}
            ${soapBlock('🗂️ Plan Template',    s.plan_template)}
          </div>

          <!-- Right: Physical Exam -->
          <div class="soap-col">
            <h4 class="col-title">🩺 Physical Exam Reference</h4>
            ${soapBlock('📊 Bedside Scales / Scores',          pe.bedside_scales || pe.bedside_cognitive)}
            ${soapBlock('🔬 Neurologic / Physical Exam Steps', pe.neurologic_exam)}
          </div>
        </div>

        <div style="margin-top:.75rem;padding-top:.75rem;border-top:1px solid var(--color-border)">
          <button class="btn btn-primary btn-sm-inline"
            onclick="window.dispatchEvent(new CustomEvent('navigate',{detail:{page:'browser',categoryId:'${esc(cat.id)}'}}))">
            🔍 Browse ${esc(cat.nameEn)} Codes
          </button>
          <button class="btn btn-outline btn-sm-inline"
            onclick="window.dispatchEvent(new CustomEvent('navigate',{detail:'log'}))">
            📝 New OPD Entry
          </button>
        </div>
      </div>
    </div>
  `;
}

/** Renders a SOAP/exam section with checkable items and copy + insert controls. */
function soapBlock(title, items) {
  if (!items?.length) return '';
  const cbItems = items.map((item, i) => `
    <label class="soap-view-item">
      <input type="checkbox" class="soap-view-cb" data-text="${esc(item)}">
      <span class="soap-view-item-text">${esc(item)}</span>
    </label>`).join('');

  return `<div class="ref-section">
    <div class="ref-title-row">
      <span class="ref-title">${title}</span>
      <span class="ref-section-actions">
        <button type="button" class="soap-view-toggle-all btn-ref-action">Select All</button>
        <button type="button" class="soap-view-copy-btn btn-ref-action">📋 Copy</button>
        <button type="button" class="soap-view-insert-btn btn-ref-action">➕ Insert to Entry</button>
      </span>
    </div>
    <div class="soap-view-checklist">${cbItems}</div>
  </div>`;
}

function _copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => showToast('success', 'Copied to clipboard.'))
      .catch(() => _fallback(text));
  } else {
    _fallback(text);
  }
}

function _fallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  try   { document.execCommand('copy'); showToast('info', 'Copied.'); }
  catch { showToast('error', 'Copy failed — please copy manually.'); }
  document.body.removeChild(ta);
}
