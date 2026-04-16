/**
 * modules/soap-view.js
 * Displays all category SOAP templates and physical exam guides side-by-side.
 */

import { getIcdData, navigate, esc } from '../app.js';

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
    <p class="subtitle">Category-level templates — select a category to expand</p>

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
            ${soapBlock('📊 Bedside Scales / Scores',          pe.bedside_scales)}
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

function soapBlock(title, items) {
  if (!items?.length) return '';
  return `<div class="ref-section">
    <div class="ref-title">${title}</div>
    <ul class="ref-list">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
  </div>`;
}
