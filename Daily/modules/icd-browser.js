/**
 * modules/icd-browser.js
 * Browsable / searchable reference of all neuro-MSK ICD-10 codes.
 *
 * Layout:
 *   - Floating draggable category buttons in a relative container
 *   - "Recently Used ICD Codes" is a fixed-position floating panel (draggable, resizable)
 *   - Category detail panel appears below the floating buttons area
 */

import {
  getIcdData, searchCodes, getIcdFreq,
  navigate, esc, buildCombinedObjective,
  getShortcutKeys, matchShortcut, showToast,
  getFloatPositions, saveFloatPosition, initFloatPanel, initDraggableInContainer,
} from '../app.js';

export async function renderIcdBrowser(opts = {}) {
  const container = document.getElementById('main-content');
  container.innerHTML = `<p style="padding:2rem;color:#888">Loading ICD data…</p>`;

  let icdData;
  try { icdData = await getIcdData(); }
  catch(e) {
    container.innerHTML = `<div class="card" style="color:red">⚠️ Failed to load ICD data: ${esc(e.message)}</div>`;
    return;
  }

  const cats      = icdData.categories || [];
  const lookup    = icdData.codeLookup || {};
  const shortcuts = getShortcutKeys();

  const initCat = opts.categoryId || cats[0]?.id || '';

  /* Calculate default floating button positions */
  const BTN_W = 158, BTN_H = 56, GAP = 8, COLS = 4;
  const catsAreaH = Math.ceil(cats.length / COLS) * (BTN_H + GAP) + GAP + 30;

  container.innerHTML = `
    <h2 class="page-title">🔍 ICD-10 Code Browser</h2>
    <p class="subtitle">Neuro-musculoskeletal &amp; Neurologic — 2023 Chinese Edition (ICD-10-CM)</p>

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
      <button class="btn btn-outline btn-sm-inline" id="icd-toggle-recent">
        📊 Recent Codes</button>
    </div>

    <!-- Floating category buttons area -->
    <div class="float-cats-wrap">
      <div class="float-cats-hint">🖱 Drag buttons to reposition • Click to browse category</div>
      <div class="float-cats-area" id="float-cats-area-icd"
           style="min-height:${catsAreaH}px"></div>
    </div>

    <!-- Category detail panel (below floating cats) -->
    <div id="icd-cat-detail" class="icd-cat-detail"></div>
  `;

  /* ── Build floating category buttons ── */
  const positions = getFloatPositions();
  const catsArea  = container.querySelector('#float-cats-area-icd');

  cats.forEach((cat, i) => {
    const col   = i % COLS;
    const row   = Math.floor(i / COLS);
    const defX  = col * (BTN_W + GAP) + GAP;
    const defY  = row * (BTN_H + GAP) + GAP;
    const saved = positions[`icd_cat_${cat.id}`];

    const btn = document.createElement('button');
    btn.className   = 'float-cat-btn';
    btn.dataset.cat = cat.id;
    btn.title       = `${cat.nameEn} / ${cat.nameZh} — ${(lookup[cat.id] || []).length} codes`;
    btn.innerHTML   = `
      <span class="float-cat-icon">${cat.icon || ''}</span>
      <span class="float-cat-name">${esc(cat.nameEn)}</span>
      <span class="float-cat-zh">${esc(cat.nameZh)}</span>`;
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
        showCategory(cat.id, cats, lookup, null, container);
      } else {
        container.querySelector('#icd-cat-detail').innerHTML = '';
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

  /* Toggle recent panel */
  container.querySelector('#icd-toggle-recent')?.addEventListener('click', () => {
    recentPanel.classList.toggle('float-panel-hidden');
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
    navigate('log');
  }

  container.querySelector('#icd-insert-recent')?.addEventListener('click', doInsertSelectedIcd);

  /* Keyboard shortcut */
  if (window._icdBrowserAbort) window._icdBrowserAbort.abort();
  window._icdBrowserAbort = new AbortController();
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
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
      const results = searchCodes(q, icdData, 60);
      if (!results.length) {
        searchRes.innerHTML = '<div class="no-records" style="padding:.5rem 1rem">No matching codes.</div>';
      } else {
        searchRes.innerHTML = results.map(r => {
          const catObj = cats.find(c => c.id === r.categoryId);
          return `<div class="browser-hit" data-cat="${esc(r.categoryId)}" data-code="${esc(r.code)}">
            <span class="tag tag-code">${esc(r.code)}</span>
            <span class="dd-en">${esc(r.en)}</span>
            <span class="dd-zh">${esc(r.zh)}</span>
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
    showCategory(catId, cats, lookup, hit.dataset.code, container);
  });

  container.addEventListener('click', e => {
    if (!e.target.closest('#browser-search') && !e.target.closest('#browser-search-results'))
      searchRes.classList.add('hidden');
  });

  /* Open initial category */
  if (initCat) {
    const btn = container.querySelector(`.float-cat-btn[data-cat="${initCat}"]`);
    if (btn) { btn.classList.add('active'); showCategory(initCat, cats, lookup, null, container); }
  }
}

/* ------------------------------------------------------------------ */

function _buildRecentPanel(shortcuts) {
  const freq  = getIcdFreq();
  const top50 = Object.values(freq)
    .sort((a, b) => b.count - a.count || b.lastUsed.localeCompare(a.lastUsed))
    .slice(0, 50);

  const bodyHtml = !top50.length
    ? `<p class="no-records" style="font-size:.8rem;padding:.5rem">
        No codes used yet. Browse categories and click "Use →" to start building your history.
       </p>`
    : top50.map(c => `
      <label class="icd-recent-item">
        <input type="checkbox" class="icd-recent-cb"
          data-code="${esc(c.code)}" data-en="${esc(c.en)}" data-zh="${esc(c.zh)}"
          data-cat="${esc(c.categoryId)}">
        <span class="icd-recent-text">
          <span class="tag tag-code">${esc(c.code)}</span>
          <span class="icd-recent-en">${esc(c.en)}</span>
          <span class="icd-recent-zh">${esc(c.zh)}</span>
        </span>
        <span class="freq-badge">×${c.count}</span>
      </label>`).join('');

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
          title="Hide">✕</button>
      </div>
    </div>
    <div class="float-panel-body">
      ${bodyHtml}
    </div>`;

  panel.querySelector('#icd-recent-close')?.addEventListener('click', () => {
    panel.classList.add('float-panel-hidden');
  });

  panel.querySelector('#icd-insert-recent-panel')?.addEventListener('click', () => {
    const checked = [...panel.querySelectorAll('.icd-recent-cb:checked')];
    if (!checked.length) { showToast('info', 'No recent ICD codes selected.'); return; }
    const first = checked[0];
    sessionStorage.setItem('prefill_icd', JSON.stringify({
      code: first.dataset.code, en: first.dataset.en,
      zh: first.dataset.zh, categoryId: first.dataset.cat || '',
    }));
    if (checked.length > 1) {
      sessionStorage.setItem('prefill_icd_extra', JSON.stringify(
        checked.slice(1).map(cb => ({
          code: cb.dataset.code, en: cb.dataset.en,
          zh: cb.dataset.zh, categoryId: cb.dataset.cat,
        }))
      ));
    } else { sessionStorage.removeItem('prefill_icd_extra'); }
    navigate('log');
  });

  return panel;
}

/* ------------------------------------------------------------------ */

function showCategory(catId, cats, lookup, highlightCode = null, container) {
  const detail = document.getElementById('icd-cat-detail');
  if (!detail) return;
  const catObj = cats.find(c => c.id === catId);
  const codes  = lookup[catId] || [];
  if (!catObj) { detail.innerHTML = ''; return; }

  const soap = catObj.soap || {};
  const pe   = catObj.physicalExam || {};
  const combinedObjective = buildCombinedObjective(soap, pe);

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
        <div class="code-filter-wrap">
          <input class="field-input code-filter" id="code-filter" type="text"
            placeholder="Filter codes in this category…">
        </div>
        <div class="code-table-wrap">
          <table class="code-table">
            <thead><tr><th>Code</th><th>English Name</th><th>中文名稱</th><th></th></tr></thead>
            <tbody id="code-tbody">${buildCodeRows(codes, highlightCode)}</tbody>
          </table>
        </div>
      </div>

      <div class="tab-panel hidden" id="tab-soap">
        ${soapBlock('🗣️ S — Subjective', soap.subjective)}
        ${soapBlock('🔎 O — Objective',   combinedObjective)}
        ${soapBlock('💡 Assessment',       soap.assessment_pearls)}
        ${soapBlock('🗂️ Plan',            soap.plan_template)}
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

  detail.querySelector('#code-filter')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filtered = codes.filter(c =>
      c.code.toLowerCase().includes(q) || c.en.toLowerCase().includes(q) || c.zh.includes(e.target.value)
    );
    detail.querySelector('#code-tbody').innerHTML = buildCodeRows(filtered, null);
    wireUseButtons(detail);
  });

  wireUseButtons(detail);

  if (highlightCode) {
    const row = detail.querySelector(`[data-code="${highlightCode}"]`);
    if (row) {
      row.classList.add('highlight-row');
      setTimeout(() => row.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
  }

  setTimeout(() => detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
}

function buildCodeRows(codes, highlightCode) {
  return codes.map(c => `
    <tr data-code="${esc(c.code)}" ${c.code === highlightCode ? 'class="highlight-row"' : ''}>
      <td><span class="tag tag-code">${esc(c.code)}</span></td>
      <td class="code-en">${esc(c.en)}</td>
      <td class="code-zh">${esc(c.zh)}</td>
      <td><button class="btn-use" data-code="${esc(c.code)}" data-en="${esc(c.en)}"
          data-zh="${esc(c.zh)}">Use →</button></td>
    </tr>`).join('');
}

function wireUseButtons(panel) {
  panel.querySelectorAll('.btn-use').forEach(btn => {
    btn.addEventListener('click', () => {
      const catBtn = document.querySelector('.float-cat-btn.active');
      sessionStorage.setItem('prefill_icd', JSON.stringify({
        code:       btn.dataset.code,
        en:         btn.dataset.en,
        zh:         btn.dataset.zh,
        categoryId: catBtn?.dataset.cat || '',
      }));
      navigate('log');
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
