/**
 * modules/icd-browser.js
 * Browsable / searchable reference of all neuro-MSK ICD-10 codes.
 *
 * Layout: 3 columns
 *   Left  — first half of categories
 *   Center — recently used 50 ICD codes (checkboxes, insert with Shift+S)
 *   Right  — second half of categories
 *   Below  — category detail (code table + SOAP tab) when a category is active
 */

import {
  getIcdData, searchCodes, getIcdFreq,
  navigate, esc, buildCombinedObjective,
  getShortcutKeys, matchShortcut, showToast,
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

  const cats   = icdData.categories || [];
  const lookup = icdData.codeLookup || {};
  const shortcuts = getShortcutKeys();

  const initCat = opts.categoryId || cats[0]?.id || '';

  /* Split categories for left / right columns */
  const half      = Math.ceil(cats.length / 2);
  const leftCats  = cats.slice(0, half);
  const rightCats = cats.slice(half);

  container.innerHTML = `
    <h2 class="page-title">🔍 ICD-10 Code Browser</h2>
    <p class="subtitle">Neuro-musculoskeletal &amp; Neurologic — 2023 Chinese Edition (ICD-10-CM)</p>

    <!-- Search bar -->
    <div class="browser-search-wrap">
      <input class="field-input browser-search" id="browser-search" type="text"
        placeholder="Search by code, English name, or Chinese name (e.g. G43 / migraine / 偏頭痛)…">
      <div id="browser-search-results" class="browser-search-results hidden"></div>
    </div>

    <!-- 3-column header: left-cats | recent-50 | right-cats -->
    <div class="icd-3col-layout">

      <!-- Left category column -->
      <aside class="icd-cat-col" id="icd-cat-left">
        <div class="icd-cat-col-title">Categories (1–${leftCats.length})</div>
        ${leftCats.map(c => catBtnHtml(c, lookup, c.id === initCat)).join('')}
      </aside>

      <!-- Center: recently used 50 ICD codes -->
      <div class="icd-center-col" id="icd-center-col">
        <div class="icd-center-header">
          <span>⏱ Recently Used ICD Codes <span class="hint" style="font-size:.75rem">(top 50)</span></span>
          <button class="btn btn-primary btn-sm-inline" id="icd-insert-recent"
            title="${esc(shortcuts.insertIcd)}">➕ Insert Selected <kbd>${esc(shortcuts.insertIcd)}</kbd></button>
        </div>
        <div id="icd-recent-list">
          ${buildRecentIcdList()}
        </div>
      </div>

      <!-- Right category column -->
      <aside class="icd-cat-col" id="icd-cat-right">
        <div class="icd-cat-col-title">Categories (${leftCats.length + 1}–${cats.length})</div>
        ${rightCats.map(c => catBtnHtml(c, lookup, c.id === initCat)).join('')}
      </aside>

    </div>

    <!-- Category detail panel (below 3-col header) -->
    <div id="icd-cat-detail" class="icd-cat-detail">
      <!-- populated by showCategory -->
    </div>
  `;

  /* Show initial category */
  showCategory(initCat, cats, lookup, null, container);

  /* Category button clicks */
  container.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showCategory(btn.dataset.cat, cats, lookup, null, container);
    });
  });

  /* Recent ICD list: Use → buttons */
  wireRecentUseButtons(container);

  /* Insert selected recent ICD codes (checkboxes) */
  function doInsertSelectedIcd() {
    const checked = [...container.querySelectorAll('.icd-recent-cb:checked')];
    if (!checked.length) { showToast('info', 'No recent ICD codes selected.'); return; }
    /* Store the first selected code as the primary prefill */
    const first = checked[0];
    const catBtn = container.querySelector(`.cat-btn[data-cat="${first.dataset.cat}"]`);
    sessionStorage.setItem('prefill_icd', JSON.stringify({
      code:       first.dataset.code,
      en:         first.dataset.en,
      zh:         first.dataset.zh,
      categoryId: first.dataset.cat || '',
    }));
    /* Additional codes go into a separate multi-prefill key */
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
  function onKey(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const sc = getShortcutKeys();
    if (matchShortcut(e, sc.insertIcd) || matchShortcut(e, sc.insertAll)) {
      e.preventDefault();
      doInsertSelectedIcd();
    }
  }
  window.addEventListener('keydown', onKey);
  const _prev = window._icdBrowserNavCleanup;
  if (_prev) window.removeEventListener('keydown', _prev);
  window._icdBrowserNavCleanup = onKey;

  /* Global search */
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
    container.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    const catBtn = container.querySelector(`.cat-btn[data-cat="${catId}"]`);
    if (catBtn) catBtn.classList.add('active');
    showCategory(catId, cats, lookup, hit.dataset.code, container);
  });

  container.addEventListener('click', e => {
    if (!e.target.closest('#browser-search') && !e.target.closest('#browser-search-results'))
      searchRes.classList.add('hidden');
  });
}

/* ------------------------------------------------------------------ */

function catBtnHtml(c, lookup, active) {
  return `
    <button class="cat-btn${active ? ' active' : ''}" data-cat="${esc(c.id)}">
      <span class="cat-icon">${c.icon || ''}</span>
      <span class="cat-label">
        <span class="cat-en">${esc(c.nameEn)}</span>
        <span class="cat-zh">${esc(c.nameZh)}</span>
      </span>
      <span class="cat-count">${(lookup[c.id] || []).length}</span>
    </button>`;
}

/* ------------------------------------------------------------------ */

/** Builds the recent-50 ICD codes list with checkboxes. */
function buildRecentIcdList() {
  const freq = getIcdFreq();
  const top50 = Object.values(freq)
    .sort((a, b) => b.count - a.count || b.lastUsed.localeCompare(a.lastUsed))
    .slice(0, 50);

  if (!top50.length) {
    return '<p class="no-records" style="font-size:.8rem;padding:.4rem">No codes used yet. Browse categories and click "Use →" to start building your history.</p>';
  }

  return top50.map(c => `
    <label class="icd-recent-item">
      <input type="checkbox" class="icd-recent-cb"
        data-code="${esc(c.code)}" data-en="${esc(c.en)}" data-zh="${esc(c.zh)}" data-cat="${esc(c.categoryId)}">
      <span class="icd-recent-text">
        <span class="tag tag-code">${esc(c.code)}</span>
        <span class="icd-recent-en">${esc(c.en)}</span>
        <span class="icd-recent-zh">${esc(c.zh)}</span>
      </span>
      <span class="freq-badge">×${c.count}</span>
    </label>`).join('');
}

/* ------------------------------------------------------------------ */

function wireRecentUseButtons(container) {
  container.querySelectorAll('.icd-recent-use-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      sessionStorage.setItem('prefill_icd', JSON.stringify({
        code:       btn.dataset.code,
        en:         btn.dataset.en,
        zh:         btn.dataset.zh,
        categoryId: btn.dataset.cat || '',
      }));
      navigate('log');
    });
  });
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

      <!-- Tabs -->
      <div class="tab-bar" id="tab-bar">
        <button class="tab-btn active" data-tab="codes">📄 Codes (${codes.length})</button>
        <button class="tab-btn" data-tab="soap">📋 SOAP Template</button>
      </div>

      <!-- Codes tab -->
      <div class="tab-panel" id="tab-codes">
        <div class="code-filter-wrap">
          <input class="field-input code-filter" id="code-filter" type="text"
            placeholder="Filter codes in this category…">
        </div>
        <div class="code-table-wrap">
          <table class="code-table">
            <thead><tr><th>Code</th><th>English Name</th><th>中文名稱</th><th></th></tr></thead>
            <tbody id="code-tbody">
              ${buildCodeRows(codes, highlightCode)}
            </tbody>
          </table>
        </div>
      </div>

      <!-- SOAP tab -->
      <div class="tab-panel hidden" id="tab-soap">
        ${soapBlock('🗣️ S — Subjective (template)', soap.subjective)}
        ${soapBlock('🔎 O — Objective (template)',   combinedObjective)}
        ${soapBlock('💡 Assessment Pearls',           soap.assessment_pearls)}
        ${soapBlock('🗂️ Plan Template',              soap.plan_template)}
      </div>
    </div>
  `;

  /* Tabs */
  detail.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      detail.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      detail.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      detail.querySelector(`#tab-${btn.dataset.tab}`)?.classList.remove('hidden');
    });
  });

  /* Code filter */
  detail.querySelector('#code-filter')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filtered = codes.filter(c =>
      c.code.toLowerCase().includes(q) ||
      c.en.toLowerCase().includes(q)   ||
      c.zh.includes(e.target.value)
    );
    detail.querySelector('#code-tbody').innerHTML = buildCodeRows(filtered, null);
    wireUseButtons(detail);
  });

  wireUseButtons(detail);

  /* Scroll to highlighted code */
  if (highlightCode) {
    const row = detail.querySelector(`[data-code="${highlightCode}"]`);
    if (row) {
      row.classList.add('highlight-row');
      setTimeout(() => row.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
  }

  /* Scroll detail into view */
  setTimeout(() => detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
}

function buildCodeRows(codes, highlightCode) {
  return codes.map(c => `
    <tr data-code="${esc(c.code)}" ${c.code === highlightCode ? 'class="highlight-row"' : ''}>
      <td><span class="tag tag-code">${esc(c.code)}</span></td>
      <td class="code-en">${esc(c.en)}</td>
      <td class="code-zh">${esc(c.zh)}</td>
      <td><button class="btn-use" data-code="${esc(c.code)}" data-en="${esc(c.en)}" data-zh="${esc(c.zh)}">Use →</button></td>
    </tr>`).join('');
}

function wireUseButtons(panel) {
  panel.querySelectorAll('.btn-use').forEach(btn => {
    btn.addEventListener('click', () => {
      const catBtn = document.querySelector('.cat-btn.active');
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
