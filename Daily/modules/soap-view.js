/**
 * modules/soap-view.js
 * Displays all category SOAP templates and physical exam guides.
 *
 * Layout:
 *   - Floating draggable category buttons in a relative container
 *   - Active category shows S+O (left) and A+P (right) in a 2-column layout
 *   - "Recently Used Terms" is a fixed-position floating panel (draggable, resizable)
 *     that defaults to 2/3 viewport width
 *   - Each S/O/A/P ref-section is CSS-resizable (vertical)
 *   - Single global "Copy All Checked" button placed below "Insert All Checked"
 *     copies full text (including after ":") to clipboard
 *   - Single global "Insert All Checked" button inserts terms (before ":") to new entry
 */

import {
  getIcdData, getSoapTemplates, deleteSoapTemplate,
  navigate, esc, showToast, buildCombinedObjective,
  getRecentSoapTerms, recordSoapItemWithSection,
  getShortcutKeys, matchShortcut, isTypingInput,
  getFloatPositions, initFloatPanel, initDraggableInContainer,
  saveFloatPanelState, getFloatPanelState,
} from '../app.js';

const CATS_AREA_HEIGHT_KEY = 'soap_cats_area_h';

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

  /* ── Calculate default positions for category buttons (grid) ── */
  const BTN_W = 158, BTN_H = 56, GAP = 8, COLS = 4;
  const catsAreaH = parseInt(getFloatPositions()[CATS_AREA_HEIGHT_KEY]) ||
    (Math.ceil(cats.length / COLS) * (BTN_H + GAP) + GAP + 30);

  /* Issue 1: restore panel state before rendering */
  const panelState = getFloatPanelState('soap_recent_panel');

  container.innerHTML = `
    <h2 class="page-title">📋 SOAP &amp; Physical Exam Templates</h2>
    <p class="subtitle">Drag category buttons to reposition • Check items then use the buttons below</p>

    <!-- Global action buttons (below page title) -->
    <div class="soap-view-global-actions">
      <button class="btn btn-primary" id="soap-view-insert-all-checked">➕ Insert All Checked to New Entry
        <kbd>${esc(shortcuts.insertSoapAll)}</kbd></button>
      <button class="btn btn-outline" id="soap-view-copy-all-checked">📋 Copy All Checked (full text)</button>
      <button class="btn btn-outline btn-sm-inline ${panelState.hidden ? '' : 'btn-active'}"
        id="soap-view-toggle-recent"
        title="Toggle Recently Used Terms panel">📊 Recent Terms${panelState.hidden ? '' : ' ✓'}</button>
    </div>

    <!-- Floating category buttons area -->
    <div class="float-cats-wrap">
      <div class="float-cats-hint">🖱 Drag buttons to reposition • Click to view category</div>
      <div class="float-cats-area" id="float-cats-area-soap"
           style="min-height:${catsAreaH}px"></div>
    </div>

    <!-- My Saved Templates (below floating area) -->
    <div id="user-tmpl-section">${buildUserTemplatesHTML(userTemplates)}</div>

    <!-- Active category detail -->
    <div id="soap-active-cat"></div>
  `;

  /* ── Build floating category buttons ── */
  const positions = getFloatPositions();
  const catsArea  = container.querySelector('#float-cats-area-soap');

  cats.forEach((cat, i) => {
    const col   = i % COLS;
    const row   = Math.floor(i / COLS);
    const defX  = col * (BTN_W + GAP) + GAP;
    const defY  = row * (BTN_H + GAP) + GAP;
    const saved = positions[`soap_cat_${cat.id}`];

    const btn = document.createElement('button');
    btn.className   = 'float-cat-btn';
    btn.dataset.cat = cat.id;
    btn.title       = `${cat.nameEn} / ${cat.nameZh}`;
    btn.innerHTML   = `
      <span class="float-cat-icon">${cat.icon || ''}</span>
      <span class="float-cat-name">${esc(cat.nameEn)}</span>
      <span class="float-cat-zh">${esc(cat.nameZh)}</span>`;
    btn.style.left  = (saved?.x ?? defX) + 'px';
    btn.style.top   = (saved?.y ?? defY) + 'px';

    catsArea.appendChild(btn);
    initDraggableInContainer(btn, `soap_cat_${cat.id}`, { x: defX, y: defY });

    btn.addEventListener('click', () => {
      if (btn.dataset.dragged === '1') return;
      /* Toggle category */
      const alreadyActive = btn.classList.contains('active');
      container.querySelectorAll('.float-cat-btn').forEach(b => b.classList.remove('active'));
      if (!alreadyActive) {
        btn.classList.add('active');
        showSoapCategory(cat, container);
      } else {
        container.querySelector('#soap-active-cat').innerHTML = '';
      }
    });
  });

  /* ── Floating "Recently Used Terms" panel ── */
  const recentPanel = _buildRecentPanel(shortcuts);
  document.body.appendChild(recentPanel);

  const defW = Math.round(window.innerWidth * 2 / 3);
  initFloatPanel(recentPanel, 'soap_recent_panel', {
    x: Math.round((window.innerWidth - defW) / 2),
    y: 80,
  });
  /* Default width 2/3 viewport if no saved width */
  if (!getFloatPositions()['soap_recent_panel']?.w) {
    recentPanel.style.width  = defW + 'px';
    recentPanel.style.height = '420px';
  }

  /* Issue 1: restore visibility / minimize state */
  if (panelState.hidden)    recentPanel.classList.add('float-panel-hidden');
  if (panelState.minimized) recentPanel.classList.add('float-panel-minimized');

  /* Issue 1: Toggle button — persist state and update label */
  const soapToggleBtn = container.querySelector('#soap-view-toggle-recent');
  function _updateSoapToggleBtn() {
    const isHidden = recentPanel.classList.contains('float-panel-hidden');
    soapToggleBtn.textContent = isHidden ? '📊 Recent Terms' : '📊 Recent Terms ✓';
    soapToggleBtn.classList.toggle('btn-active', !isHidden);
  }
  soapToggleBtn?.addEventListener('click', () => {
    const wasHidden = recentPanel.classList.contains('float-panel-hidden');
    recentPanel.classList.toggle('float-panel-hidden');
    if (!wasHidden) recentPanel.classList.remove('float-panel-minimized');
    saveFloatPanelState('soap_recent_panel', { hidden: !wasHidden, minimized: false });
    _updateSoapToggleBtn();
  });
  _updateSoapToggleBtn();

  /* Issue 1: Minimize button inside the panel */
  recentPanel.querySelector('#soap-recent-minimize-btn')?.addEventListener('click', () => {
    const isMin = recentPanel.classList.toggle('float-panel-minimized');
    recentPanel.querySelector('#soap-recent-minimize-btn').textContent = isMin ? '⬆' : '⬇';
    saveFloatPanelState('soap_recent_panel', { minimized: isMin });
  });

  /* Close button */
  recentPanel.querySelector('#soap-recent-close-btn')?.addEventListener('click', () => {
    recentPanel.classList.add('float-panel-hidden');
    recentPanel.classList.remove('float-panel-minimized');
    saveFloatPanelState('soap_recent_panel', { hidden: true, minimized: false });
    _updateSoapToggleBtn();
  });

  /* ── Insert All Checked ── */
  function doInsertAllChecked() {
    const checked = [...container.querySelectorAll('.soap-view-cb:checked'),
                     ...recentPanel.querySelectorAll('.soap-view-cb:checked')];
    if (!checked.length) { showToast('info', 'No items checked — tick some items first.'); return; }
    const text = checked.map(cb => _termWithColon(cb.dataset.term || cb.dataset.text)).join('\n');
    checked.forEach(cb => recordSoapItemWithSection(cb.dataset.text, cb.dataset.seckey || 's'));
    const prev = sessionStorage.getItem('prefill_soap_text') || '';
    sessionStorage.setItem('prefill_soap_text', prev ? `${prev}\n${text}` : text);
    navigate('log');
  }
  container.querySelector('#soap-view-insert-all-checked')?.addEventListener('click', doInsertAllChecked);

  /* ── Copy All Checked (full text including after ":") ── */
  container.querySelector('#soap-view-copy-all-checked')?.addEventListener('click', () => {
    const checked = [...container.querySelectorAll('.soap-view-cb:checked'),
                     ...recentPanel.querySelectorAll('.soap-view-cb:checked')];
    if (!checked.length) { showToast('info', 'No items checked anywhere.'); return; }
    _copyText(checked.map(cb => cb.dataset.text).join('\n'));
  });

  /* ── Keyboard shortcut ── */
  if (window._soapViewAbort) window._soapViewAbort.abort();
  window._soapViewAbort = new AbortController();
  window.addEventListener('keydown', e => {
    if (isTypingInput(e.target)) return;
    const sc = getShortcutKeys();
    if (matchShortcut(e, sc.insertSoapAll) || matchShortcut(e, sc.insertAll)) {
      e.preventDefault();
      doInsertAllChecked();
    }
  }, { signal: window._soapViewAbort.signal });

  /* Remove floating panel when navigating away */
  window._soapViewAbort.signal.addEventListener('abort', () => {
    recentPanel.remove();
  });

  /* ── Select-all / clear-all toggle per section ── */
  function handleToggleAll(e) {
    const btn = e.target.closest('.soap-view-toggle-all');
    if (!btn) return;
    const section = btn.closest('.ref-section');
    if (!section) return;
    const cbs    = [...section.querySelectorAll('.soap-view-cb')];
    const allChk = cbs.every(cb => cb.checked);
    cbs.forEach(cb => { cb.checked = !allChk; });
    btn.textContent = allChk ? 'Select All' : 'Clear All';
  }
  container.addEventListener('click', handleToggleAll);
  recentPanel.addEventListener('click', handleToggleAll);

  /* ── User-template delete ── */
  container.querySelector('#user-tmpl-section')?.addEventListener('click', e => {
    const btn = e.target.closest('.user-tmpl-delete-btn');
    if (!btn) return;
    e.stopPropagation();
    if (!confirm('Delete this saved template?')) return;
    deleteSoapTemplate(btn.dataset.id);
    btn.closest('.ref-section')?.remove();
    showToast('success', 'Template deleted.');
  });

  /* Open requested category on load */
  const initCat = opts.categoryId ? cats.find(c => c.id === opts.categoryId) : null;
  if (initCat) {
    const btn = container.querySelector(`.float-cat-btn[data-cat="${initCat.id}"]`);
    if (btn) { btn.classList.add('active'); showSoapCategory(initCat, container); }
  }
}

/* ================================================================ */

function _buildRecentPanel(shortcuts) {
  const panel = document.createElement('div');
  panel.className = 'float-panel';
  panel.id = 'soap-recent-float-panel';

  const savedState = getFloatPanelState('soap_recent_panel');
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

  const bodyHtml = !terms.length
    ? `<p class="no-records" style="font-size:.8rem;padding:.5rem">
        No terms used yet. Insert items to build history.
       </p>`
    : sectionMeta.map(sm => {
        const items = bySection[sm.key];
        if (!items.length) return '';
        return `
          <div class="recent-section">
            <div class="recent-section-title">${sm.label}</div>
            ${items.map(t => {
              const colonIdx  = t.term.indexOf(':');
              const termText  = colonIdx >= 0 ? t.term.slice(0, colonIdx).trim() : t.term;
              const detail    = colonIdx >= 0 ? t.term.slice(colonIdx + 1).trim() : '';
              return `
                <label class="soap-view-item">
                  <input type="checkbox" class="soap-view-cb"
                    data-text="${esc(t.term)}" data-term="${esc(termText)}"
                    data-seckey="${esc(sm.key)}">
                  <span class="soap-view-item-text">
                    <b>${esc(termText)}</b>${detail
                      ? `<span class="soap-view-item-detail">: ${esc(detail)}</span>` : ''}
                  </span>
                  ${t.count > 0 ? `<span class="freq-badge">×${t.count}</span>` : ''}
                </label>`;
            }).join('')}
          </div>`;
      }).join('');

  panel.innerHTML = `
    <div class="float-drag-handle">
      <span>📊 Recently Used SOAP Terms (top ${terms.length})</span>
      <div style="display:flex;gap:.4rem;align-items:center">
        <button type="button" class="float-panel-toggle" id="soap-recent-minimize-btn"
          title="Minimize / restore panel">${savedState.minimized ? '⬆' : '⬇'}</button>
        <button type="button" class="float-panel-toggle" id="soap-recent-close-btn"
          title="Hide panel">✕</button>
      </div>
    </div>
    <div class="float-panel-body">
      <div class="recent-panel-header">
        Select items and use the global Insert / Copy buttons above.
      </div>
      ${bodyHtml}
    </div>`;

  return panel;
}

/* ================================================================ */

function showSoapCategory(cat, container) {
  const s  = cat.soap || {};
  const pe = cat.physicalExam || {};
  const combinedObjective = buildCombinedObjective(s, pe);

  const activeCatEl = container.querySelector('#soap-active-cat');
  activeCatEl.innerHTML = `
    <div class="card" style="margin-top:.5rem">
      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem;flex-wrap:wrap">
        <span style="font-size:1.5rem">${cat.icon || ''}</span>
        <div>
          <div style="font-size:1rem;font-weight:700;color:var(--color-heading)">${esc(cat.nameEn)}</div>
          <div style="font-size:.85rem;color:var(--color-muted)">${esc(cat.nameZh)}
            ${cat.codeRange ? `— ${esc(cat.codeRange)}` : ''}</div>
        </div>
        <div style="margin-left:auto;display:flex;gap:.5rem;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm-inline"
            onclick="window.dispatchEvent(new CustomEvent('navigate',{detail:{page:'browser',categoryId:'${esc(cat.id)}'}}))">
            🔍 Browse Codes
          </button>
          <button class="btn btn-outline btn-sm-inline"
            onclick="window.dispatchEvent(new CustomEvent('navigate',{detail:'log'}))">
            📝 New Entry
          </button>
        </div>
      </div>

      <!-- 2-column: S+O | A+P -->
      <div class="soap-3col" style="grid-template-columns:1fr 1fr">
        <div class="soap-3col-side soap-3col-left">
          ${soapBlock('🗣️ S — Subjective',  s.subjective,     's')}
          ${soapBlock('🔎 O — Objective',    combinedObjective,'o')}
        </div>
        <div class="soap-3col-side soap-3col-right">
          ${soapBlock('💡 Assessment Pearls', s.assessment_pearls,'a')}
          ${soapBlock('🗂️ Plan Template',     s.plan_template,    'p')}
        </div>
      </div>
    </div>`;

  activeCatEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ================================================================ */

const NO_USER_TEMPLATES_MSG =
  '<p class="no-records" style="padding:.75rem;font-size:.85rem">No saved templates yet.</p>';

function buildUserTemplatesHTML(templates) {
  if (!templates.length) return '';
  const bodyContent = templates.map(t => {
    const lines  = t.text.split('\n').filter(l => l.trim());
    const cbItems = lines.map(line => {
      const colonIdx = line.indexOf(':');
      const term   = colonIdx >= 0 ? line.slice(0, colonIdx).trim() : line;
      const detail = colonIdx >= 0 ? line.slice(colonIdx + 1).trim() : '';
      return `
        <label class="soap-view-item">
          <input type="checkbox" class="soap-view-cb"
            data-text="${esc(line)}" data-term="${esc(term)}" data-seckey="s">
          <span class="soap-view-item-text">
            <b>${esc(term)}</b>${detail
              ? `<span class="soap-view-item-detail">: ${esc(detail)}</span>` : ''}
          </span>
        </label>`;
    }).join('');
    return `
      <div class="ref-section" data-tmpl-id="${esc(t.id)}">
        <div class="ref-title-row">
          <span class="ref-title">📄 ${esc(t.name)}<span class="hint" style="font-weight:400;margin-left:.5rem;font-size:.76rem">${t.createdAt ? new Date(t.createdAt).toLocaleDateString() : ''}</span></span>
          <span class="ref-section-actions">
            <button type="button" class="soap-view-toggle-all btn-ref-action">Select All</button>
            <button type="button" class="user-tmpl-delete-btn btn-ref-action" data-id="${esc(t.id)}" title="Delete">🗑️</button>
          </span>
        </div>
        <div class="soap-view-checklist">${cbItems}</div>
      </div>`;
  }).join('');

  return `
    <div class="card" style="margin-bottom:.75rem">
      <div class="card-title">📝 My Saved Templates</div>
      ${bodyContent}
    </div>`;
}

/* ================================================================ */

/**
 * Renders a SOAP/exam section with checkable items.
 * Per-section copy buttons are removed; copying is done globally.
 */
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
      </span>
    </div>
    <div class="soap-view-checklist">${cbItems}</div>
  </div>`;
}

/* ================================================================ */

function _copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => showToast('success', '📋 Copied to clipboard.'))
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
  try   { document.execCommand('copy'); showToast('success', '📋 Copied to clipboard.'); }
  catch { showToast('error', 'Copy failed — please copy manually.'); }
  document.body.removeChild(ta);
}

function _termWithColon(term) {
  return term.endsWith(':') ? term : `${term}:`;
}
