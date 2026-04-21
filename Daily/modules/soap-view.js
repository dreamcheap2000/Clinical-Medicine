/**
 * modules/soap-view.js
 * Displays all category SOAP templates and physical exam guides.
 * Layout per category: S+O left | recent 100 terms center | A+P right
 * Single global Insert All Checked button (Shift+I shortcut).
 */

import {
  getIcdData, getSoapTemplates, deleteSoapTemplate,
  navigate, esc, showToast, buildCombinedObjective,
  getRecentSoapTerms, recordSoapItemWithSection,
  getShortcutKeys, matchShortcut,
} from '../app.js';

export async function renderSoapView(opts = {}) {
  const container = document.getElementById('main-content');
  container.innerHTML = `<p style="padding:2rem;color:#888">Loading templates…</p>`;

  let icdData;
  try { icdData = await getIcdData(); }
  catch(e) {
    container.innerHTML = `<div class="card" style="color:red">⚠️ ${esc(e.message)}</div>`;
    return;
  }

  const cats          = icdData.categories || [];
  const userTemplates = getSoapTemplates();
  const shortcuts     = getShortcutKeys();

  container.innerHTML = `
    <h2 class="page-title">📋 SOAP &amp; Physical Exam Templates</h2>
    <p class="subtitle">Check items to select them — one <b>Insert All Checked</b> button inserts everything selected across S, O, A, P
      <span class="hint">(shortcut: ${esc(shortcuts.insertSoapAll)})</span></p>

    <!-- Single global Insert All Checked button -->
    <div class="soap-view-global-actions">
      <button class="btn btn-outline" id="soap-view-copy-all-checked">📋 Copy All Checked</button>
      <button class="btn btn-primary" id="soap-view-insert-all-checked">➕ Insert All Checked to New Entry <kbd>${esc(shortcuts.insertSoapAll)}</kbd></button>
    </div>

    <!-- My Saved Templates -->
    ${buildUserTemplatesAccordion(userTemplates)}

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

  /* Global copy-all-checked (across all open sections) */
  container.querySelector('#soap-view-copy-all-checked')?.addEventListener('click', () => {
    const checked = [...container.querySelectorAll('.soap-view-cb:checked')];
    if (!checked.length) { showToast('info', 'No items checked anywhere.'); return; }
    _copyText(checked.map(cb => cb.dataset.text).join('\n'));
  });

  /* Global insert-all-checked — single insert button */
  function doInsertAllChecked() {
    const checked = [...container.querySelectorAll('.soap-view-cb:checked')];
    if (!checked.length) { showToast('info', 'No items checked anywhere.'); return; }
    const text = checked.map(cb => _termWithColon(cb.dataset.term || cb.dataset.text)).join('\n');
    /* Record usage with section info */
    checked.forEach(cb => {
      recordSoapItemWithSection(cb.dataset.text, cb.dataset.seckey || 's');
    });
    const prev = sessionStorage.getItem('prefill_soap_text') || '';
    sessionStorage.setItem('prefill_soap_text', prev ? `${prev}\n${text}` : text);
    navigate('log');
  }

  container.querySelector('#soap-view-insert-all-checked')?.addEventListener('click', doInsertAllChecked);

  /* Keyboard shortcut for insert all — use AbortController so cleanup is automatic on re-render */
  if (window._soapViewAbort) window._soapViewAbort.abort();
  window._soapViewAbort = new AbortController();
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const sc = getShortcutKeys();
    if (matchShortcut(e, sc.insertSoapAll) || matchShortcut(e, sc.insertAll)) {
      e.preventDefault();
      doInsertAllChecked();
    }
  }, { signal: window._soapViewAbort.signal });

  /* Select-all / clear-all toggle per section */
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

  /* Wire user-template delete buttons */
  container.addEventListener('click', e => {
    const btn = e.target.closest('.user-tmpl-delete-btn');
    if (!btn) return;
    e.stopPropagation();
    if (!confirm('Delete this saved template?')) return;
    deleteSoapTemplate(btn.dataset.id);
    btn.closest('.ref-section')?.remove();
    const body = container.querySelector('#user-tmpl-body');
    if (body && !body.querySelector('.ref-section')) {
      body.innerHTML = NO_USER_TEMPLATES_MSG;
    }
    showToast('success', 'Template deleted.');
  });

  /* Open the first item by default (or requested one) */
  const initId  = opts.categoryId || cats[0]?.id;
  const initHdr = container.querySelector(`.accordion-header[data-cat="${initId}"]`);
  if (initHdr) initHdr.click();
}

/* ------------------------------------------------------------------ */

const NO_USER_TEMPLATES_MSG =
  '<p class="no-records" style="padding:.75rem;font-size:.85rem">No saved templates yet. Create one from the SOAP note form.</p>';

function buildUserTemplatesAccordion(templates) {
  const bodyContent = !templates.length
    ? NO_USER_TEMPLATES_MSG
    : templates.map(t => {
        const lines = t.text.split('\n').filter(l => l.trim());
        const cbItems = lines.map(line => {
          const colonIdx = line.indexOf(':');
          const term   = colonIdx >= 0 ? line.slice(0, colonIdx).trim() : line;
          const detail = colonIdx >= 0 ? line.slice(colonIdx + 1).trim() : '';
          return `
          <label class="soap-view-item">
            <input type="checkbox" class="soap-view-cb"
              data-text="${esc(line)}" data-term="${esc(term)}" data-seckey="s">
            <span class="soap-view-item-text">
              <b>${esc(term)}</b>${detail ? `<span class="soap-view-item-detail">: ${esc(detail)}</span>` : ''}
            </span>
          </label>`;
        }).join('');
        return `
          <div class="ref-section" data-tmpl-id="${esc(t.id)}">
            <div class="ref-title-row">
              <span class="ref-title">📄 ${esc(t.name)}<span class="hint" style="font-weight:400;margin-left:.5rem;font-size:.76rem">${t.createdAt ? new Date(t.createdAt).toLocaleDateString() : ''}</span></span>
              <span class="ref-section-actions">
                <button type="button" class="soap-view-toggle-all btn-ref-action">Select All</button>
                <button type="button" class="soap-view-copy-btn btn-ref-action">📋 Copy</button>
                <button type="button" class="user-tmpl-delete-btn btn-ref-action" data-id="${esc(t.id)}" title="Delete template">🗑️</button>
              </span>
            </div>
            <div class="soap-view-checklist">${cbItems}</div>
          </div>`;
      }).join('');

  return `
    <div class="accordion-item" id="user-tmpl-accordion-item">
      <button class="accordion-header" id="user-tmpl-header" type="button">
        <span class="cat-icon">📝</span>
        <span class="acc-title">
          <b>My Saved Templates</b>
          <span class="acc-zh">自定義模板</span>
          <span class="hint">${templates.length} template${templates.length !== 1 ? 's' : ''}</span>
        </span>
        <span class="acc-arrow" id="user-tmpl-arrow">▶</span>
      </button>
      <div class="accordion-body hidden" id="user-tmpl-body">
        ${bodyContent}
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */

function buildAccordionItem(cat) {
  const s  = cat.soap || {};
  const pe = cat.physicalExam || {};
  const combinedObjective = buildCombinedObjective(s, pe);

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
        <!-- 3-column layout: S+O | recent 100 | A+P -->
        <div class="soap-3col">

          <!-- Left: S + O -->
          <div class="soap-3col-side soap-3col-left">
            ${soapBlock('🗣️ S — Subjective', s.subjective, 's')}
            ${soapBlock('🔎 O — Objective',   combinedObjective, 'o')}
          </div>

          <!-- Center: recently used terms -->
          <div class="soap-3col-center">
            ${buildRecentTermsPanel()}
          </div>

          <!-- Right: A + P -->
          <div class="soap-3col-side soap-3col-right">
            ${soapBlock('💡 Assessment Pearls', s.assessment_pearls, 'a')}
            ${soapBlock('🗂️ Plan Template',     s.plan_template,     'p')}
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

/* ------------------------------------------------------------------ */

/** Builds the center panel of recently used SOAP terms (top 100), stratified by section. */
function buildRecentTermsPanel() {
  const terms = getRecentSoapTerms(100);

  const bySection = { s: [], o: [], a: [], p: [] };
  for (const t of terms) {
    const sec = t.section in bySection ? t.section : 's';
    bySection[sec].push(t);
  }

  const sectionMeta = [
    { key: 's', label: '🗣️ S — Subjective' },
    { key: 'o', label: '🔎 O — Objective'   },
    { key: 'a', label: '💡 Assessment'       },
    { key: 'p', label: '🗂️ Plan'            },
  ];

  const total = terms.length;
  if (!total) {
    return `
      <div class="recent-panel-header">📊 Recently Used Terms</div>
      <p class="no-records" style="font-size:.8rem;padding:.5rem">
        No terms used yet. Insert items from the S/O/A/P sections to start building your history.
      </p>`;
  }

  return `
    <div class="recent-panel-header">
      📊 Recently Used Terms <span class="hint" style="font-size:.75rem">(top ${total})</span>
    </div>
    ${sectionMeta.map(sm => {
      const items = bySection[sm.key];
      if (!items.length) return '';
      return `
        <div class="recent-section">
          <div class="recent-section-title">${sm.label}</div>
          ${items.map(t => {
            const colonIdx = t.term.indexOf(':');
            const termText   = colonIdx >= 0 ? t.term.slice(0, colonIdx).trim() : t.term;
            const detail     = colonIdx >= 0 ? t.term.slice(colonIdx + 1).trim() : '';
            return `
            <label class="soap-view-item">
              <input type="checkbox" class="soap-view-cb"
                data-text="${esc(t.term)}" data-term="${esc(termText)}" data-seckey="${esc(sm.key)}">
              <span class="soap-view-item-text">
                <b>${esc(termText)}</b>${detail ? `<span class="soap-view-item-detail">: ${esc(detail)}</span>` : ''}
              </span>
              ${t.count > 0 ? `<span class="freq-badge">×${t.count}</span>` : ''}
            </label>`;
          }).join('')}
        </div>`;
    }).join('')}
  `;
}

/* ------------------------------------------------------------------ */

/** Renders a SOAP/exam section with checkable items and copy control only (no per-section insert). */
function soapBlock(title, items, sectionKey = 's') {
  if (!items?.length) return '';
  const cbItems = items.map((item) => {
    const colonIdx = item.indexOf(':');
    const term   = colonIdx >= 0 ? item.slice(0, colonIdx).trim() : item;
    const detail = colonIdx >= 0 ? item.slice(colonIdx + 1).trim() : '';
    return `
    <label class="soap-view-item">
      <input type="checkbox" class="soap-view-cb"
        data-text="${esc(item)}" data-term="${esc(term)}" data-seckey="${esc(sectionKey)}">
      <span class="soap-view-item-text">
        <b>${esc(term)}</b>${detail ? `<span class="soap-view-item-detail">: ${esc(detail)}</span>` : ''}
      </span>
    </label>`;
  }).join('');

  return `<div class="ref-section">
    <div class="ref-title-row">
      <span class="ref-title">${title}</span>
      <span class="ref-section-actions">
        <button type="button" class="soap-view-toggle-all btn-ref-action">Select All</button>
        <button type="button" class="soap-view-copy-btn btn-ref-action">📋 Copy</button>
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

function _termWithColon(term) {
  return term.endsWith(':') ? term : `${term}:`;
}
