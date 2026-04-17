/**
 * modules/icd-browser.js
 * Browsable / searchable reference of all neuro-MSK ICD-10 codes
 * organized by category, with SOAP + exam detail panel.
 */

import { getIcdData, searchCodes, navigate, esc } from '../app.js';

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

  const initCat = opts.categoryId || cats[0]?.id || '';

  container.innerHTML = `
    <h2 class="page-title">🔍 ICD-10 Code Browser</h2>
    <p class="subtitle">Neuro-musculoskeletal &amp; Neurologic — 2023 Chinese Edition (ICD-10-CM)</p>

    <!-- Search bar -->
    <div class="browser-search-wrap">
      <input class="field-input browser-search" id="browser-search" type="text"
        placeholder="Search by code, English name, or Chinese name (e.g. G43 / migraine / 偏頭痛)…">
      <div id="browser-search-results" class="browser-search-results hidden"></div>
    </div>

    <div class="browser-layout">
      <!-- Category sidebar -->
      <aside class="cat-sidebar">
        ${cats.map(c => `
          <button class="cat-btn${c.id === initCat ? ' active' : ''}" data-cat="${esc(c.id)}">
            <span class="cat-icon">${c.icon || ''}</span>
            <span class="cat-label">
              <span class="cat-en">${esc(c.nameEn)}</span>
              <span class="cat-zh">${esc(c.nameZh)}</span>
            </span>
            <span class="cat-count">${(lookup[c.id] || []).length}</span>
          </button>`).join('')}
      </aside>

      <!-- Main panel -->
      <div class="browser-main" id="browser-main">
        <!-- populated by showCategory -->
      </div>
    </div>
  `;

  /* Show initial category */
  showCategory(initCat, cats, lookup);

  /* Category sidebar clicks */
  container.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showCategory(btn.dataset.cat, cats, lookup);
    });
  });

  /* Global search */
  const searchEl   = container.querySelector('#browser-search');
  const searchRes  = container.querySelector('#browser-search-results');
  let _timer = null;

  searchEl.addEventListener('input', () => {
    clearTimeout(_timer);
    const q = searchEl.value.trim();
    if (q.length < 2) { searchRes.classList.add('hidden'); return; }
    _timer = setTimeout(() => {
      const results = searchCodes(q, icdData, 60);
      if (!results.length) { searchRes.innerHTML = '<div class="no-records" style="padding:.5rem 1rem">No matching codes.</div>'; }
      else {
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
    /* jump to category and highlight */
    const catId = hit.dataset.cat;
    container.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    const catBtn = container.querySelector(`.cat-btn[data-cat="${catId}"]`);
    if (catBtn) catBtn.classList.add('active');
    showCategory(catId, cats, lookup, hit.dataset.code);
  });

  /* Close search results on outside click — use container delegation to avoid global listener leaks */
  container.addEventListener('click', e => {
    if (!e.target.closest('#browser-search') && !e.target.closest('#browser-search-results'))
      searchRes.classList.add('hidden');
  });
}

/* ------------------------------------------------------------------ */

function showCategory(catId, cats, lookup, highlightCode = null) {
  const main   = document.getElementById('browser-main');
  if (!main) return;
  const catObj = cats.find(c => c.id === catId);
  const codes  = lookup[catId] || [];

  if (!catObj) { main.innerHTML = '<p class="no-records">Select a category.</p>'; return; }

  const soap = catObj.soap || {};
  const pe   = catObj.physicalExam || {};

  main.innerHTML = `
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
      <button class="tab-btn" data-tab="exam">🩺 Physical Exam</button>
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
      ${soapBlock('🔎 O — Objective (template)',   soap.objective)}
      ${soapBlock('💡 Assessment Pearls',           soap.assessment_pearls)}
      ${soapBlock('🗂️ Plan Template',              soap.plan_template)}
    </div>

    <!-- Exam tab -->
    <div class="tab-panel hidden" id="tab-exam">
      ${soapBlock('📊 Bedside Scales / Scores',        pe.bedside_scales)}
      ${soapBlock('🔬 Neurologic / Physical Exam Steps', pe.neurologic_exam)}
    </div>
  `;

  /* Tabs */
  main.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      main.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      main.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      main.querySelector(`#tab-${btn.dataset.tab}`)?.classList.remove('hidden');
    });
  });

  /* Code filter */
  main.querySelector('#code-filter')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filtered = codes.filter(c =>
      c.code.toLowerCase().includes(q) ||
      c.en.toLowerCase().includes(q)   ||
      c.zh.includes(e.target.value)
    );
    main.querySelector('#code-tbody').innerHTML = buildCodeRows(filtered, null);
    wireUseButtons(main);
  });

  wireUseButtons(main);

  /* Scroll to highlighted code */
  if (highlightCode) {
    const row = main.querySelector(`[data-code="${highlightCode}"]`);
    if (row) {
      row.classList.add('highlight-row');
      setTimeout(() => row.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
  }
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

function wireUseButtons(main) {
  main.querySelectorAll('.btn-use').forEach(btn => {
    btn.addEventListener('click', () => {
      /* Navigate to new entry form pre-filled with this code.
         categoryId is stored so the ghost SOAP panel auto-loads. */
      const catBtn = main.closest('.browser-main')
        ? document.querySelector('.cat-btn.active')
        : null;
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
