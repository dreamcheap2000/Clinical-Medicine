/**
 * modules/icd-browser.js
 * Browsable / searchable reference of all neuro-MSK ICD-10 codes.
 *
 * Layout:
 *   - Floating draggable category buttons in a relative container
 *     (icon-only by default; full name shown on hover)
 *   - "Recently Used ICD Codes" is a fixed-position floating panel (draggable, resizable,
 *     minimizable — state is persisted across visits)
 *   - Category detail panel appears below the floating buttons area
 *   - Last viewed category is remembered across visits (Issue 4)
 *   - Selecting a code here auto-updates quad_icd_checked so Quad View stays in sync
 */

import {
  getIcdBrowserMeta, loadCategoryCodes, searchAllCodes,
  getIcdData, getIcdFreq,
  navigate, esc, buildCombinedObjective,
  getShortcutKeys, matchShortcut, showToast, isTypingInput,
  getFloatPositions, initFloatPanel, initDraggableInContainer,
  saveFloatPanelState, getFloatPanelState,
} from '../app.js';

/* Issue 4 — remember last viewed category */
const ICD_LAST_CAT_KEY = 'icdLastCat_v1';
const ICD_VIEW_SCROLL_KEY = 'icdBrowserScrollY_v1';

export async function renderIcdBrowser(opts = {}) {
  const container = document.getElementById('main-content');
  container.innerHTML = `<p style="padding:2rem;color:#888">Loading ICD data…</p>`;

  let browserCats;
  try { browserCats = await getIcdBrowserMeta(); }
  catch(e) {
    container.innerHTML = `<div class="card" style="color:red">⚠️ Failed to load ICD data: ${esc(e.message)}</div>`;
    return;
  }

  /* Also load SOAP template data (22 categories) for the SOAP tab in category detail */
  let soapData = null;
  try { soapData = await getIcdData(); } catch { /* non-critical */ }

  const cats      = Array.isArray(browserCats) ? browserCats : [];
  const shortcuts = getShortcutKeys();
  const selectedCodes = new Map();

  /* Issue 4: restore last-viewed category instead of always showing the first one */
  const initCat = opts.categoryId || localStorage.getItem(ICD_LAST_CAT_KEY) || '';

  /* Calculate default floating button positions */
  const BTN_W = 60, BTN_H = 60, GAP = 8, COLS = 9;
  const catsAreaH = Math.ceil(cats.length / COLS) * (BTN_H + GAP) + GAP + 30;

  /* Issue 1: restore panel visibility state before building HTML */
  const panelState = getFloatPanelState('icd_recent_panel');

  container.innerHTML = `
    <h2 class="page-title">🔍 ICD-10 Code Browser</h2>
    <p class="subtitle">10-category reclassified 2023 Chinese Edition (ICD-10-CM) — hover over icons for category names</p>

    <!-- Search bar -->
    <div class="browser-search-wrap">
      <input class="field-input browser-search" id="browser-search" type="text"
        placeholder="Search by code, English name, or Chinese name (e.g. G43 / migraine / 偏頭痛)…">
      <div id="browser-search-results" class="browser-search-results hidden"></div>
    </div>

    <!-- Action row -->
    <div class="soap-view-global-actions" style="margin-bottom:.75rem">
      <button class="btn btn-primary btn-sm-inline" id="icd-insert-recent"
        title="${esc(shortcuts.insertIcd)}">➕ Insert Selected
        <kbd>${esc(shortcuts.insertIcd)}</kbd></button>
      <button class="btn btn-outline btn-sm-inline ${panelState.hidden ? '' : 'btn-active'}"
        id="icd-toggle-recent" title="Show/hide recently used ICD codes panel">
        📊 Recent Codes${panelState.hidden ? '' : ' ✓'}</button>
    </div>

    <!-- Floating category buttons area -->
    <div class="float-cats-wrap">
      <div class="float-cats-hint">🖱 Drag icons to reposition • Click to browse category • Hover to see name</div>
      <div class="float-cats-area" id="float-cats-area-icd"
           style="min-height:${catsAreaH}px"></div>
    </div>

    <!-- Category detail panel (below floating cats) -->
    <div id="icd-cat-detail" class="icd-cat-detail"></div>
  `;

  /* ── Build floating category buttons (icon-only mode) ── */
  const positions = getFloatPositions();
  const catsArea  = container.querySelector('#float-cats-area-icd');

  cats.forEach((cat, i) => {
    const col   = i % COLS;
    const row   = Math.floor(i / COLS);
    const defX  = col * (BTN_W + GAP) + GAP;
    const defY  = row * (BTN_H + GAP) + GAP;
    const saved = positions[`icd_cat_${cat.id}`];

    const btn = document.createElement('button');
    btn.className   = 'float-cat-btn float-cat-icon-only';
    btn.dataset.cat = cat.id;
    btn.title       = `${cat.nameEn} / ${cat.nameZh} — ${cat.codeRange}`;
    btn.innerHTML   = `
      <span class="float-cat-icon">${cat.icon || '📋'}</span>
      <span class="float-cat-hover-label">${esc(cat.nameEn)}<br><small>${esc(cat.nameZh)}</small></span>`;
    btn.style.left  = (saved?.x ?? defX) + 'px';
    btn.style.top   = (saved?.y ?? defY) + 'px';

    catsArea.appendChild(btn);
    initDraggableInContainer(btn, `icd_cat_${cat.id}`, { x: defX, y: defY });

    btn.addEventListener('click', () => {
      if (btn.dataset.dragged === '1') return;
      const alreadyActive = btn.classList.contains('active');
      container.querySelectorAll('.float-cat-btn').forEach(b => b.classList.remove('active'));
      if (!alreadyActive) {
        btn.classList.add('active');
        showCategoryAsync(cat.id, cats, soapData, null, container, selectedCodes);
      } else {
        container.querySelector('#icd-cat-detail').innerHTML = '';
        localStorage.removeItem(ICD_LAST_CAT_KEY);
      }
    });
  });

  /* ── Floating "Recently Used ICD Codes" panel ── */
  const recentPanel = _buildRecentPanel(shortcuts);
  document.body.appendChild(recentPanel);

  const defW = Math.round(window.innerWidth * 2 / 3);
  initFloatPanel(recentPanel, 'icd_recent_panel', {
    x: Math.round((window.innerWidth - defW) / 2),
    y: 80,
  });
  if (!getFloatPositions()['icd_recent_panel']?.w) {
    recentPanel.style.width  = defW + 'px';
    recentPanel.style.height = '380px';
  }

  /* Issue 1: restore panel visibility / minimize state */
  if (panelState.hidden)    recentPanel.classList.add('float-panel-hidden');
  if (panelState.minimized) recentPanel.classList.add('float-panel-minimized');

  /* Issue 1: Toggle recent panel — persist state, update button label */
  const toggleBtn = container.querySelector('#icd-toggle-recent');
  function _updateToggleBtn() {
    const isHidden = recentPanel.classList.contains('float-panel-hidden');
    toggleBtn.textContent = isHidden ? '📊 Recent Codes' : '📊 Recent Codes ✓';
    toggleBtn.classList.toggle('btn-active', !isHidden);
  }
  toggleBtn?.addEventListener('click', () => {
    const wasHidden = recentPanel.classList.contains('float-panel-hidden');
    recentPanel.classList.toggle('float-panel-hidden');
    if (!wasHidden) {
      /* hiding — also clear minimized so next show is clean */
      recentPanel.classList.remove('float-panel-minimized');
    }
    saveFloatPanelState('icd_recent_panel', { hidden: !wasHidden, minimized: false });
    _updateToggleBtn();
  });
  _updateToggleBtn();

  /* Minimize/restore is now controlled by double-click on panel header */
  recentPanel.querySelector('.float-drag-handle')?.addEventListener('dblclick', () => {
    const isMin = recentPanel.classList.toggle('float-panel-minimized');
    saveFloatPanelState('icd_recent_panel', { minimized: isMin });
  });

  /* Close button — hides entirely */
  recentPanel.querySelector('#icd-recent-close')?.addEventListener('click', () => {
    recentPanel.classList.add('float-panel-hidden');
    recentPanel.classList.remove('float-panel-minimized');
    saveFloatPanelState('icd_recent_panel', { hidden: true, minimized: false });
    _updateToggleBtn();
  });

  /* ── Insert selected recent ICD codes ── */
  function doInsertSelectedIcd() {
    const checked = [...recentPanel.querySelectorAll('.icd-recent-cb:checked')];
    if (!checked.length) { showToast('info', 'No recent ICD codes selected.'); return; }
    const first = checked[0];
    sessionStorage.setItem('prefill_icd', JSON.stringify({
      code:       first.dataset.code,
      en:         first.dataset.en,
      zh:         first.dataset.zh,
      categoryId: first.dataset.cat || '',
    }));
    if (checked.length > 1) {
      const extras = checked.slice(1).map(cb => ({
        code: cb.dataset.code, en: cb.dataset.en, zh: cb.dataset.zh, categoryId: cb.dataset.cat,
      }));
      sessionStorage.setItem('prefill_icd_extra', JSON.stringify(extras));
    } else {
      sessionStorage.removeItem('prefill_icd_extra');
    }
    /* Also sync to quad_icd_checked so Quad View reflects the selection */
    _syncCheckedToQuad([...checked.map(cb => ({
      code: cb.dataset.code, en: cb.dataset.en, zh: cb.dataset.zh, categoryId: cb.dataset.cat || '',
    }))]);
    navigate('log');
  }

  container.querySelector('#icd-insert-recent')?.addEventListener('click', doInsertSelectedIcd);
  recentPanel.querySelector('#icd-insert-recent-panel')?.addEventListener('click', doInsertSelectedIcd);

  /* Issue 7: Keyboard shortcut — use isTypingInput() so hotkeys work even when checkbox/button has focus */
  if (window._icdBrowserAbort) window._icdBrowserAbort.abort();
  window._icdBrowserAbort = new AbortController();
  window.addEventListener('keydown', e => {
    if (isTypingInput(e.target)) return;
    const sc = getShortcutKeys();
    if (matchShortcut(e, sc.insertIcd) || matchShortcut(e, sc.insertAll)) {
      e.preventDefault();
      doInsertSelectedIcd();
    }
  }, { signal: window._icdBrowserAbort.signal });

  /* Remove floating panel on navigate */
  window._icdBrowserAbort.signal.addEventListener('abort', () => {
    recentPanel.remove();
  });

  /* ── Global search ── */
  const searchEl  = container.querySelector('#browser-search');
  const searchRes = container.querySelector('#browser-search-results');
  let _timer = null;

  searchEl.addEventListener('input', () => {
    clearTimeout(_timer);
    const q = searchEl.value.trim();
    if (q.length < 2) { searchRes.classList.add('hidden'); return; }
    _timer = setTimeout(() => {
      const results = searchAllCodes(q, 60);
      if (!results.length) {
        searchRes.innerHTML = '<div class="no-records" style="padding:.5rem 1rem">No matching codes.</div>';
      } else {
        searchRes.innerHTML = results.map(r => {
          const catObj = cats.find(c => c.id === r.categoryId);
          return `<div class="browser-hit" data-cat="${esc(r.categoryId)}" data-code="${esc(r.code)}" data-en="${esc(r.en)}" data-zh="${esc(r.zh || '')}">
            <span class="tag tag-code">${esc(r.code)}</span>
            <span class="dd-en">${esc(r.en)}</span>
            <span class="dd-zh">${esc(r.zh || '')}</span>
            ${catObj ? `<span class="tag tag-cat">${catObj.icon || ''} ${esc(catObj.nameEn)}</span>` : ''}
          </div>`;
        }).join('');
      }
      searchRes.classList.remove('hidden');
    }, 200);
  });

  searchRes.addEventListener('click', e => {
    const hit = e.target.closest('.browser-hit');
    if (!hit) return;
    searchRes.classList.add('hidden');
    searchEl.value = '';
    const catId = hit.dataset.cat;
    container.querySelectorAll('.float-cat-btn').forEach(b => b.classList.remove('active'));
    const catBtn = container.querySelector(`.float-cat-btn[data-cat="${catId}"]`);
    if (catBtn) catBtn.classList.add('active');
    showCategoryAsync(catId, cats, soapData, hit.dataset.code, container, selectedCodes);
  });

  container.addEventListener('click', e => {
    if (!e.target.closest('#browser-search') && !e.target.closest('#browser-search-results'))
      searchRes.classList.add('hidden');
  });

  /* Issue 4: Open last-viewed category (or opts.categoryId) */
  if (initCat) {
    const btn = container.querySelector(`.float-cat-btn[data-cat="${initCat}"]`);
    if (btn) { btn.classList.add('active'); showCategoryAsync(initCat, cats, soapData, null, container, selectedCodes); }
  }

  const savedY = parseInt(localStorage.getItem(ICD_VIEW_SCROLL_KEY) || '0', 10);
  if (savedY > 0) setTimeout(() => window.scrollTo({ top: savedY, behavior: 'auto' }), 60);
  window.addEventListener('scroll', () => {
    localStorage.setItem(ICD_VIEW_SCROLL_KEY, String(Math.max(0, Math.round(window.scrollY))));
  }, { signal: window._icdBrowserAbort.signal });
}

/* ------------------------------------------------------------------ */
/* Sync checked codes to quad_icd_checked sessionStorage              */
/* ------------------------------------------------------------------ */

function _syncCheckedToQuad(newItems) {
  let existing = [];
  try { existing = JSON.parse(sessionStorage.getItem('quad_icd_checked') || '[]'); } catch { existing = []; }
  const map = new Map(existing.map(x => [x.code, x]));
  for (const item of newItems) { if (item?.code) map.set(item.code, item); }
  sessionStorage.setItem('quad_icd_checked', JSON.stringify([...map.values()]));
}

/* ------------------------------------------------------------------ */

function _buildRecentPanel(shortcuts) {
  const freq  = getIcdFreq();
  const top50 = Object.values(freq)
    .sort((a, b) => b.count - a.count || b.lastUsed.localeCompare(a.lastUsed))
    .slice(0, 50);

  /* Issue 1: get current minimized state for button label */
  const savedState = getFloatPanelState('icd_recent_panel');

  /* Issue 6: Show only the primary term (before first comma or colon) in the label,
     to accommodate many more entries in the same panel space.
     Full data-en attribute retains the complete description for insertion. */
  const bodyHtml = !top50.length
    ? `<p class="no-records" style="font-size:.8rem;padding:.5rem">
        No codes used yet. Save entries to start building recent history.
       </p>`
    : top50.map(c => {
        const shortEn = c.en.split(/[,:]/, 1)[0].trim();
        return `
      <label class="icd-recent-item">
        <input type="checkbox" class="icd-recent-cb"
          data-code="${esc(c.code)}" data-en="${esc(c.en)}" data-zh="${esc(c.zh)}"
          data-cat="${esc(c.categoryId)}">
        <span class="icd-recent-text">
          <span class="tag tag-code">${esc(c.code)}</span>
          <span class="icd-recent-en" title="${esc(c.en)}">${esc(shortEn)}</span>
          <span class="icd-recent-zh">${esc(c.zh)}</span>
        </span>
        <span class="freq-badge">×${c.count}</span>
      </label>`;
      }).join('');

  const panel = document.createElement('div');
  panel.className = 'float-panel';
  panel.id = 'icd-recent-float-panel';
  panel.innerHTML = `
    <div class="float-drag-handle">
      <span>⏱ Recently Used ICD Codes (top ${top50.length})</span>
      <div style="display:flex;gap:.4rem;align-items:center">
        <button type="button" class="float-panel-toggle" id="icd-insert-recent-panel"
          title="${esc(shortcuts.insertIcd)}">➕ Insert Sel.</button>
        <button type="button" class="float-panel-toggle" id="icd-recent-close"
          title="Hide panel">✕</button>
      </div>
    </div>
    <div class="float-panel-body">
      ${bodyHtml}
    </div>`;

  return panel;
}

/* ------------------------------------------------------------------ */

async function showCategoryAsync(catId, cats, soapData, highlightCode = null, container, selectedCodes) {
  /* Issue 4: Remember last viewed category */
  if (catId) localStorage.setItem(ICD_LAST_CAT_KEY, catId);

  const detail = document.getElementById('icd-cat-detail');
  if (!detail) return;
  const catObj = cats.find(c => c.id === catId);
  if (!catObj) { detail.innerHTML = ''; return; }

  /* Show loading state while codes load */
  if (catId !== 'others') {
    detail.innerHTML = `<div class="icd-detail-inner"><p style="padding:1rem;color:#888">Loading codes for ${esc(catObj.nameEn)}…</p></div>`;
  }

  /* Load codes lazily */
  let codes = [];
  if (catId === 'others') {
    /* Others category is too large to display in a list — show search hint */
    codes = [];
  } else {
    codes = await loadCategoryCodes(catId);
  }

  /* Look up SOAP template from the 22-cat SOAP data */
  const soapCatMap = {
    dementia_cog: ['dementia','inflammatory_cns','demyelinating','tbi','cerebral_palsy'],
    cerebrovascular: ['stroke'],
    epilepsy: ['epilepsy'],
    headache: ['headache'],
    movement: ['movement_disorder'],
    neuromuscular_pns: ['peripheral_nerve','cranial_nerve','neuromuscular','vertigo','autonomic_pain'],
    sleep: ['sleep'],
    spine_msk: ['spine','joint_oa','shoulder_elbow','soft_tissue','arthritis','connective_tissue','bone_joint'],
    chronic: [],
    others: [],
  };
  const soapCatIds = soapCatMap[catId] || [];
  const soapCats   = (soapData?.categories || []).filter(c => soapCatIds.includes(c.id));
  /* Merge SOAP content from all relevant sub-categories */
  const mergedSoap = {
    subjective: soapCats.flatMap(c => c.soap?.subjective || []),
    objective:  soapCats.flatMap(c => c.soap?.objective  || []),
    assessment_pearls: soapCats.flatMap(c => c.soap?.assessment_pearls || []),
    plan_template:     soapCats.flatMap(c => c.soap?.plan_template     || []),
  };
  const mergedPe = {
    neurologic_exam: soapCats.flatMap(c => c.physicalExam?.neurologic_exam || []),
    bedside_scales:  soapCats.flatMap(c => c.physicalExam?.bedside_scales || c.physicalExam?.bedside_cognitive || []),
  };
  const combinedObjective = buildCombinedObjective(mergedSoap, mergedPe);

  const othersNote = catId === 'others'
    ? `<div style="padding:1rem;background:var(--color-surface);border-radius:var(--radius);border:1px solid var(--color-border)">
        <p style="color:#888;font-size:.9rem">📋 The <b>Other Conditions</b> category contains 65,000+ non-specialty ICD-10-CM codes.</p>
        <p style="color:#888;font-size:.85rem;margin-top:.5rem">Use the <b>search box above</b> to find specific codes by code number, English name, or Chinese name.</p>
       </div>`
    : '';

  detail.innerHTML = `
    <div class="icd-detail-inner">
      <div class="browser-cat-header">
        <span class="browser-cat-icon">${catObj.icon || ''}</span>
        <div>
          <h3 class="browser-cat-title">${esc(catObj.nameEn)} — ${esc(catObj.nameZh)}</h3>
          <span class="hint">ICD-10 range: ${esc(catObj.codeRange || '')}</span>
        </div>
      </div>

      <div class="tab-bar" id="tab-bar">
        <button class="tab-btn active" data-tab="codes">📄 Codes (${codes.length})</button>
        <button class="tab-btn" data-tab="soap">📋 SOAP Template</button>
      </div>

      <div class="tab-panel" id="tab-codes">
        ${othersNote}
        ${catId !== 'others' ? `
        <div class="code-filter-wrap">
          <button class="btn btn-primary btn-sm-inline" id="cat-insert-checked"
            title="${esc(getShortcutKeys().insertIcd)}">➕ Insert Checked</button>
          <input class="field-input code-filter" id="code-filter" type="text"
            placeholder="Filter codes in this category…">
        </div>
        <div class="code-table-wrap">
          <table class="code-table">
            <thead><tr><th></th><th>Code</th><th>English Name</th><th>中文名稱</th></tr></thead>
            <tbody id="code-tbody">${buildCodeRows(codes, highlightCode, selectedCodes, catId)}</tbody>
          </table>
        </div>` : ''}
      </div>

      <div class="tab-panel hidden" id="tab-soap">
        ${mergedSoap.subjective.length || combinedObjective.length
          ? [
              soapBlock('🗣️ S — Subjective', mergedSoap.subjective),
              soapBlock('🔎 O — Objective',   combinedObjective),
              soapBlock('💡 Assessment',       mergedSoap.assessment_pearls),
              soapBlock('🗂️ Plan',            mergedSoap.plan_template),
            ].join('')
          : '<p class="no-records" style="padding:1rem">No SOAP template available for this category.</p>'}
      </div>
    </div>
  `;

  detail.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      detail.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      detail.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      detail.querySelector(`#tab-${btn.dataset.tab}`)?.classList.remove('hidden');
    });
  });

  if (catId !== 'others') {
    detail.querySelector('#code-filter')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      const filtered = codes.filter(c =>
        c.code.toLowerCase().includes(q) || c.en.toLowerCase().includes(q) || c.zh.includes(e.target.value)
      );
      detail.querySelector('#code-tbody').innerHTML = buildCodeRows(filtered, null, selectedCodes, catId);
      wireCategoryCheckboxes(detail, selectedCodes);
    });

    wireCategoryCheckboxes(detail, selectedCodes);
    detail.querySelector('#cat-insert-checked')?.addEventListener('click', () => {
      const list = [...selectedCodes.values()];
      if (!list.length) {
        showToast('info', 'No category ICD codes checked.');
        return;
      }
      /* Sync checked codes to quad view */
      _syncCheckedToQuad(list);
      sessionStorage.setItem('prefill_icd', JSON.stringify(list[0]));
      if (list.length > 1) sessionStorage.setItem('prefill_icd_extra', JSON.stringify(list.slice(1)));
      else sessionStorage.removeItem('prefill_icd_extra');
      navigate('log');
    });
  }

  if (highlightCode) {
    const row = detail.querySelector(`[data-code="${highlightCode}"]`);
    if (row) {
      row.classList.add('highlight-row');
      setTimeout(() => row.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
  }
}

function buildCodeRows(codes, highlightCode, selectedCodes, catId) {
  return codes.map(c => `
    <tr data-code="${esc(c.code)}" ${c.code === highlightCode ? 'class="highlight-row"' : ''}>
      <td><input type="checkbox" class="icd-cat-cb" data-code="${esc(c.code)}" data-en="${esc(c.en)}"
        data-zh="${esc(c.zh || '')}" data-cat="${esc(catId || '')}" ${selectedCodes?.has(c.code) ? 'checked' : ''}></td>
      <td><span class="tag tag-code">${esc(c.code)}</span></td>
      <td class="code-en">${esc(c.en)}</td>
      <td class="code-zh">${esc(c.zh || '')}</td>
    </tr>`).join('');
}

function wireCategoryCheckboxes(panel, selectedCodes) {
  panel.querySelectorAll('.icd-cat-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const item = {
        code: cb.dataset.code,
        en: cb.dataset.en || '',
        zh: cb.dataset.zh || '',
        categoryId: cb.dataset.cat || '',
      };
      if (cb.checked) selectedCodes.set(item.code, item);
      else selectedCodes.delete(item.code);
      /* Keep quad_icd_checked in sync on each checkbox change */
      if (cb.checked) _syncCheckedToQuad([item]);
      else {
        try {
          const existing = JSON.parse(sessionStorage.getItem('quad_icd_checked') || '[]');
          sessionStorage.setItem('quad_icd_checked', JSON.stringify(existing.filter(x => x.code !== item.code)));
        } catch { /* ignore */ }
      }
    });
  });
}

function soapBlock(title, items) {
  if (!items?.length) return '';
  return `<div class="ref-section">
    <div class="ref-title">${title}</div>
    <ul class="ref-list">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
  </div>`;
}

