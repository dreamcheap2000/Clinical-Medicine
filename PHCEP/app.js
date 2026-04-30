/* ============================================================
   PHCEP — app.js
   Taiwan Core IG ICD-10 Viewer
   ============================================================ */

'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let META = null;
let cmLoaded  = {};   // catId → {codes: [...]}
let pcsLoaded = {};   // catId → {codes: [...]}
let cmOthers  = null; // compact [[code,zh],...]
let pcsOthers = null; // compact [[code,zh],...]
let activeCmCat  = null;
let activePcsCat = null;
let searchDebounce = null;
const BASE = (function () {
  // Works on GitHub Pages (/repo/PHCEP/) and local file://
  const s = document.currentScript ? document.currentScript.src : location.href;
  return s.replace(/app\.js$/, '');
})();

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  try {
    META = await fetchJson(BASE + 'data/meta.json');
    renderIgBadge();
    renderInfoBar();
    renderCmGrid();
    populateCmCatSelect();
    renderPcsGrid();
    renderAbout();
    initEbmTab();
    initSoapTab();
    initEduTab();
    initNhiTab();
    initDrugTab();
    initStrokeTab();
  } catch (e) {
    console.error('Boot failed:', e);
    toast('⚠️ 載入 meta.json 失敗，請確認部署路徑');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg, ms=2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

// ---------------------------------------------------------------------------
// Render header / infobar
// ---------------------------------------------------------------------------
function renderIgBadge() {
  const ig = META.twCoreIG;
  document.getElementById('ig-badge').innerHTML =
    `<span class="badge">TW Core IG v${ig.version}</span>` +
    `<span class="badge">ICD-10-CM ${META.icdSource.cm_total.toLocaleString()}</span>` +
    `<span class="badge">ICD-10-PCS ${META.icdSource.pcs_total.toLocaleString()}</span>`;
}

function renderInfoBar() {
  const ig = META.twCoreIG;
  document.getElementById('infobar-counts').textContent =
    `來源：${META.icdSource.title}  |  `;
  document.getElementById('ig-link').href = ig.url;
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c =>
    c.classList.toggle('active', c.id === 'tab-' + name));
  if (name === 'history') renderHistory();
  if (name === 'nhi') nhiOnTabShow();
  if (name === 'drug') drugOnTabShow();
  if (name === 'stroke') strokeOnTabShow();
}

// ---------------------------------------------------------------------------
// CM Category Grid
// ---------------------------------------------------------------------------
let cmSearchQ = '';
let cmActiveCatId = null;

function renderCmGrid() {
  const grid = document.getElementById('cm-cat-grid');
  grid.innerHTML = META.cm_categories.map(cat => catCardHtml(cat, 'cm')).join('');
}

function populateCmCatSelect() {
  const sel = document.getElementById('cm-cat-sel');
  if (!sel || !META) return;
  sel.innerHTML = '<option value="">全部分類</option>' +
    META.cm_categories.map(c =>
      `<option value="${escHtml(c.id)}">${escHtml(c.icon)} ${escHtml(c.nameZh)}</option>`
    ).join('');
}

function cmSelectCat(id) {
  const sel = document.getElementById('cm-cat-sel');
  cmActiveCatId = id || null;
  if (id) {
    openCat('cm', id);
  } else {
    // show grid, hide detail
    document.getElementById('cm-cat-grid').classList.remove('hidden');
    document.getElementById('cm-detail').classList.add('hidden');
    activeCmCat = null;
    cmActiveCatId = null;
    document.querySelectorAll('#cm-cat-grid .cat-card').forEach(c => c.classList.remove('active'));
  }
}

function cmSearch(q) {
  cmSearchQ = q.trim();
  if (cmSearchQ.length >= 2) {
    saveSearchHistory('cm', cmSearchQ);
  }
  const grid = document.getElementById('cm-cat-grid');
  const detail = document.getElementById('cm-detail');
  if (cmSearchQ) {
    // Overlay: fade grid, show search results in detail panel
    grid.classList.add('search-overlay-active');
    detail.classList.remove('hidden');
    detail.innerHTML = buildCmSearchResults(cmSearchQ);
  } else {
    grid.classList.remove('search-overlay-active');
    if (!activeCmCat) {
      detail.classList.add('hidden');
    }
  }
}

function buildCmSearchResults(q) {
  const ql = q.toLowerCase();
  const results = [];
  // Search loaded categories
  for (const cat of META.cm_categories) {
    if (cat.id === 'others') {
      if (cmOthers) {
        for (const [c, z] of cmOthers) {
          if (c.toLowerCase().includes(ql) || z.toLowerCase().includes(ql)) {
            results.push({ code: c, en: '', zh: z, catName: cat.nameZh });
            if (results.length >= 300) break;
          }
        }
      }
    } else {
      const data = cmLoaded[cat.id];
      if (data) {
        for (const r of (data.codes || [])) {
          if (r.code.toLowerCase().includes(ql) || r.en.toLowerCase().includes(ql) || r.zh.toLowerCase().includes(ql)) {
            results.push({ ...r, catName: cat.nameZh });
            if (results.length >= 300) break;
          }
        }
      }
    }
    if (results.length >= 300) break;
  }

  if (results.length === 0) {
    return `<div style="padding:24px;color:var(--muted);text-align:center">無符合「${escHtml(q)}」的 ICD-10-CM 代碼（未載入的分類不在搜尋範圍）</div>`;
  }

  const rows = results.map(r => `
    <tr>
      <td class="code-cell">${escHtml(r.code)}</td>
      <td class="en-cell">${escHtml(r.en)}</td>
      <td class="zh-cell">${escHtml(r.zh)}</td>
      <td style="font-size:.72rem;color:var(--muted)">${escHtml(r.catName)}</td>
    </tr>`).join('');

  return `
    <div class="detail-header">
      <div class="detail-title">🔍 搜尋「${escHtml(q)}」— ICD-10-CM</div>
    </div>
    <div class="codes-table-wrap" style="max-height:60vh">
      <table class="codes-table">
        <thead><tr><th>代碼</th><th>English</th><th>中文名稱</th><th>分類</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="row-count">找到 ${results.length} 筆${results.length >= 300 ? '（已截斷）' : ''}</div>`;
}

function renderPcsGrid() {
  const grid = document.getElementById('pcs-cat-grid');
  grid.innerHTML = META.pcs_categories.map(cat => catCardHtml(cat, 'pcs')).join('');
}

function catCardHtml(cat, type) {
  const isCompact = cat.compact === true;
  return `<div class="cat-card${isCompact ? ' compact-card' : ''}" onclick="openCat('${type}','${cat.id}')">
    <div class="cat-icon">${escHtml(cat.icon)}</div>
    <div class="cat-name-en">${escHtml(cat.nameEn)}</div>
    <div class="cat-name-zh">${escHtml(cat.nameZh)}</div>
    <div class="cat-range">${escHtml(cat.codeRange)}</div>
    <div class="cat-count">
      <span class="count-badge">${cat.codeCount.toLocaleString()} codes</span>
      ${isCompact ? '<span class="compact-label">精簡</span>' : ''}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Open category (click handler)
// ---------------------------------------------------------------------------
async function openCat(type, catId) {
  const detailId = type === 'cm' ? 'cm-detail' : 'pcs-detail';
  const gridId   = type === 'cm' ? 'cm-cat-grid' : 'pcs-cat-grid';
  const detail   = document.getElementById(detailId);

  // Toggle off if same
  if ((type === 'cm' && activeCmCat === catId) ||
      (type === 'pcs' && activePcsCat === catId)) {
    if (type === 'cm') activeCmCat = null; else activePcsCat = null;
    detail.classList.add('hidden');
    document.querySelectorAll(`#${gridId} .cat-card`).forEach(c => c.classList.remove('active'));
    return;
  }

  if (type === 'cm') activeCmCat = catId; else activePcsCat = catId;
  document.querySelectorAll(`#${gridId} .cat-card`).forEach((c, i) => {
    const cats = type === 'cm' ? META.cm_categories : META.pcs_categories;
    c.classList.toggle('active', cats[i].id === catId);
  });

  // Show loading placeholder
  const catMeta = (type === 'cm' ? META.cm_categories : META.pcs_categories)
    .find(c => c.id === catId);
  detail.classList.remove('hidden');
  detail.innerHTML = buildDetailSkeleton(catMeta, type);

  // Load data if needed
  const loaded = type === 'cm' ? cmLoaded : pcsLoaded;
  if (!loaded[catId]) {
    let url;
    if (catId === 'others') {
      url = BASE + `data/${type}/${type === 'cm' ? 'cm' : 'pcs'}_others_compact.json`;
    } else {
      url = BASE + `data/${type}/${catId}.json`;
    }
    try {
      const data = await fetchJson(url);
      loaded[catId] = data;
      if (catId === 'others') {
        if (type === 'cm') cmOthers = data; else pcsOthers = data;
      }
    } catch (e) {
      detail.innerHTML = `<p style="color:var(--red);padding:20px">⚠️ 載入失敗：${escHtml(e.message)}</p>`;
      return;
    }
  }

  // Re-render with data
  detail.innerHTML = buildDetailSkeleton(catMeta, type);
  fillDetailTable(type, catId, '');
}

function buildDetailSkeleton(cat, type) {
  const ig = META.twCoreIG;
  const profileUrl = type === 'cm' ? ig.condition_profile : ig.procedure_profile;
  const resourceType = type === 'cm' ? 'Condition' : 'Procedure';
  const system = type === 'cm' ? ig.icd10cm_system : ig.icd10pcs_system;
  const isCompact = cat.compact === true;
  return `
  <div class="detail-header">
    <div>
      <div class="detail-title">${escHtml(cat.icon)} ${escHtml(cat.nameEn)} / ${escHtml(cat.nameZh)}</div>
      <div class="detail-meta">
        ${escHtml(cat.codeRange)} &nbsp;·&nbsp; ${cat.codeCount.toLocaleString()} codes
        ${isCompact ? ' &nbsp;·&nbsp; <span style="color:var(--amber)">精簡格式（僅代碼＋中文名稱）</span>' : ''}
      </div>
    </div>
    <span class="fhir-chip">
      🔗 FHIR ${escHtml(resourceType)}
      <a href="${escHtml(profileUrl)}" target="_blank" rel="noopener">TW Core Profile ↗</a>
      &nbsp;|&nbsp; system: <code>${escHtml(system)}</code>
    </span>
  </div>
  <div class="detail-filter">
    <input type="text" id="detail-filter-${type}" placeholder="篩選代碼或名稱…"
      oninput="fillDetailTable('${type}','${cat.id}',this.value)" />
  </div>
  <div id="detail-table-${type}">
    <div style="padding:20px;text-align:center;color:var(--muted)">載入中…</div>
  </div>`;
}

function fillDetailTable(type, catId, filterStr) {
  const loaded = type === 'cm' ? cmLoaded : pcsLoaded;
  const data   = loaded[catId];
  if (!data) return;

  const isCompact = catId === 'others';
  const q = filterStr.trim().toLowerCase();
  const tableId = `detail-table-${type}`;
  const container = document.getElementById(tableId);
  if (!container) return;

  let totalCount;

  if (isCompact) {
    // data is [[code, zh], ...]
    const filtered = q
      ? data.filter(([c,z]) => c.toLowerCase().includes(q) || z.toLowerCase().includes(q))
      : data;
    totalCount = filtered.length;

    // Build alphabet navigation for large sets
    const alphaNav = buildAlphaNav(filtered.map(([c]) => c));

    // Build table rows grouped by first letter
    const rows = buildGroupedRows(filtered.map(([c,z]) => ({code:c, en:'', zh:z})), true);

    container.innerHTML = `
      ${alphaNav}
      <div class="codes-table-wrap">
        <table class="codes-table compact-table">
          <thead><tr><th>代碼</th><th>中文名稱</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="row-count">顯示 ${totalCount.toLocaleString()} 筆</div>`;
  } else {
    // data is {codes: [{code, en, zh}, ...]}
    const codes = data.codes || [];
    const filtered = q
      ? codes.filter(r =>
          r.code.toLowerCase().includes(q) ||
          r.en.toLowerCase().includes(q) ||
          r.zh.toLowerCase().includes(q))
      : codes;
    totalCount = filtered.length;

    // Build alphabet navigation for large sets
    const alphaNav = buildAlphaNav(filtered.map(r => r.code));

    // Build table rows grouped by first letter
    const rows = buildGroupedRows(filtered, false);

    container.innerHTML = `
      ${alphaNav}
      <div class="codes-table-wrap">
        <table class="codes-table">
          <thead><tr><th>代碼</th><th>English</th><th>中文名稱</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="row-count">顯示 ${totalCount.toLocaleString()} 筆</div>`;
  }
}

function buildAlphaNav(codes) {
  if (codes.length <= 500) return '';
  // Collect unique first letters and the anchor code for each
  const letterMap = {};
  for (const code of codes) {
    const letter = code[0] ? code[0].toUpperCase() : '#';
    if (!letterMap[letter]) letterMap[letter] = code;
  }
  const letters = Object.keys(letterMap).sort();
  const links = letters.map(l =>
    `<a class="alpha-link" href="#alpha-${escHtml(l)}" title="${escHtml(letterMap[l])}">${escHtml(l)}</a>`
  ).join('');
  return `<div class="alpha-nav">${links}</div>`;
}

function buildGroupedRows(items, isCompact) {
  if (items.length === 0) return '';
  let html = '';
  let lastLetter = null;
  for (const item of items) {
    const letter = item.code[0] ? item.code[0].toUpperCase() : '#';
    if (letter !== lastLetter) {
      html += `<tr><td colspan="${isCompact ? 2 : 3}" id="alpha-${escHtml(letter)}" class="alpha-anchor-row">${escHtml(letter)}</td></tr>`;
      lastLetter = letter;
    }
    if (isCompact) {
      html += `<tr><td class="code-cell">${escHtml(item.code)}</td><td class="zh-cell">${escHtml(item.zh)}</td></tr>`;
    } else {
      html += `<tr><td class="code-cell">${escHtml(item.code)}</td><td class="en-cell">${escHtml(item.en)}</td><td class="zh-cell">${escHtml(item.zh)}</td></tr>`;
    }
  }
  return html;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
function onSearchInput() {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(runSearch, 300);
}

async function runSearch() {
  const q = document.getElementById('search-input').value.trim().toLowerCase();
  if (q.length >= 2) {
    saveSearchHistory('fulltext', q);
  }
  const useCm  = document.getElementById('srch-cm').checked;
  const usePcs = document.getElementById('srch-pcs').checked;
  const useOthers = document.getElementById('srch-others').checked;
  const status = document.getElementById('search-status');
  const container = document.getElementById('search-results');

  if (q.length < 2) {
    container.innerHTML = '';
    status.textContent = '';
    return;
  }

  // Pre-load others if needed
  if (useOthers) {
    if (useCm && !cmOthers) {
      status.textContent = '載入 CM others…';
      try { cmOthers = cmLoaded['others'] = await fetchJson(BASE + 'data/cm/others_compact.json'); }
      catch(e) { status.textContent = '⚠️ CM others 載入失敗'; }
    }
    if (usePcs && !pcsOthers) {
      status.textContent = '載入 PCS others…';
      try { pcsOthers = pcsLoaded['others'] = await fetchJson(BASE + 'data/pcs/others_compact.json'); }
      catch(e) { status.textContent = '⚠️ PCS others 載入失敗'; }
    }
  }

  status.textContent = '搜尋中…';

  const results = [];

  // Search CM specialty categories
  if (useCm) {
    for (const cat of META.cm_categories) {
      if (cat.id === 'others') {
        if (!useOthers || !cmOthers) continue;
        for (const [c,z] of cmOthers) {
          if (c.toLowerCase().includes(q) || z.toLowerCase().includes(q)) {
            results.push({ type:'CM', catId:'others', catName: cat.nameZh, code:c, en:'', zh:z });
            if (results.length >= 200) break;
          }
        }
      } else {
        const data = cmLoaded[cat.id];
        if (!data) continue;
        for (const r of data.codes) {
          if (r.code.toLowerCase().includes(q) || r.en.toLowerCase().includes(q) || r.zh.toLowerCase().includes(q)) {
            results.push({ type:'CM', catId: cat.id, catName: cat.nameZh, ...r });
            if (results.length >= 200) break;
          }
        }
      }
      if (results.length >= 200) break;
    }
  }

  // Search PCS specialty categories
  if (usePcs) {
    for (const cat of META.pcs_categories) {
      if (cat.id === 'others') {
        if (!useOthers || !pcsOthers) continue;
        for (const [c,z] of pcsOthers) {
          if (c.toLowerCase().includes(q) || z.toLowerCase().includes(q)) {
            results.push({ type:'PCS', catId:'others', catName: cat.nameZh, code:c, en:'', zh:z });
            if (results.length >= 200) break;
          }
        }
      } else {
        const data = pcsLoaded[cat.id];
        if (!data) continue;
        for (const r of data.codes) {
          if (r.code.toLowerCase().includes(q) || r.en.toLowerCase().includes(q) || r.zh.toLowerCase().includes(q)) {
            results.push({ type:'PCS', catId: cat.id, catName: cat.nameZh, ...r });
            if (results.length >= 200) break;
          }
        }
      }
      if (results.length >= 200) break;
    }
  }

  status.textContent = results.length === 0
    ? '無結果（專科類別中；勾選「含其他」可搜尋全量）'
    : `找到 ${results.length} 筆${results.length >= 200 ? '（已截斷）' : ''}`;

  if (results.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);padding:20px">無結果</p>`;
    return;
  }

  const rows = results.map(r => `
    <tr>
      <td><span style="font-size:.7rem;background:${r.type==='CM'?'#1e3a5f':'#1a3020'};color:${r.type==='CM'?'var(--accent2)':'var(--green)'};border-radius:10px;padding:1px 6px">${r.type}</span></td>
      <td class="code-cell">${escHtml(r.code)}</td>
      <td class="en-cell">${escHtml(r.en)}</td>
      <td class="zh-cell">${escHtml(r.zh)}</td>
      <td style="font-size:.72rem;color:var(--muted)">${escHtml(r.catName)}</td>
    </tr>`).join('');

  container.innerHTML = `
    <div class="codes-table-wrap" style="max-height:500px">
      <table class="codes-table">
        <thead><tr><th>類型</th><th>代碼</th><th>English</th><th>中文名稱</th><th>分類</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------
function renderAbout() {
  if (!META) return;
  const ig = META.twCoreIG;
  const cmCats = META.cm_categories;
  const pcsCats = META.pcs_categories;

  const cmRows = cmCats.map(c =>
    `<tr><td>${escHtml(c.icon)}</td><td><code>${escHtml(c.id)}</code></td>
     <td>${escHtml(c.nameEn)}</td><td>${escHtml(c.nameZh)}</td>
     <td>${escHtml(c.codeRange)}</td>
     <td>${c.codeCount.toLocaleString()}${c.compact?' 精簡':''}</td></tr>`).join('');

  const pcsRows = pcsCats.map(c =>
    `<tr><td>${escHtml(c.icon)}</td><td><code>${escHtml(c.id)}</code></td>
     <td>${escHtml(c.nameEn)}</td><td>${escHtml(c.nameZh)}</td>
     <td>${escHtml(c.codeRange)}</td>
     <td>${c.codeCount.toLocaleString()}${c.compact?' 精簡':''}</td></tr>`).join('');

  document.getElementById('about-content').innerHTML = `
    <h3>🏥 PHCEP — Primary Health Care Electronic Program</h3>
    <p>本專案以 <strong>台灣核心實作指引（TW Core IG）</strong> 為基礎，
    對 2023 年中文版 ICD-10-CM / ICD-10-PCS 代碼依
    <a href="https://github.com/dreamcheap2000/Dr.-Chan-Lin-Chu-CV-and-licenses/blob/79e059a5437c089471ae4aed303f51bf8626dba7/README.md"
       target="_blank" rel="noopener">醫師專科相關性</a>
    進行分類，相關領域提供完整英文/中文資訊，其他領域以精簡格式儲存。</p>

    <h3>📋 Taiwan Core IG (TW Core IG)</h3>
    <table>
      <tr><th>屬性</th><th>值</th></tr>
      <tr><td>版本</td><td>${escHtml(ig.version)}</td></tr>
      <tr><td>網址</td><td><a href="${escHtml(ig.url)}" target="_blank">${escHtml(ig.url)}</a></td></tr>
      <tr><td>Condition Profile</td><td><a href="${escHtml(ig.condition_profile)}" target="_blank">Condition-twcore ↗</a></td></tr>
      <tr><td>Procedure Profile</td><td><a href="${escHtml(ig.procedure_profile)}" target="_blank">Procedure-twcore ↗</a></td></tr>
      <tr><td>ICD-10-CM System</td><td><code>${escHtml(ig.icd10cm_system)}</code></td></tr>
      <tr><td>ICD-10-PCS System</td><td><code>${escHtml(ig.icd10pcs_system)}</code></td></tr>
    </table>

    <h3>📊 ICD-10-CM 分類（${META.icdSource.cm_total.toLocaleString()} codes）</h3>
    <table>
      <thead><tr><th></th><th>ID</th><th>English</th><th>中文</th><th>Code Range</th><th>數量</th></tr></thead>
      <tbody>${cmRows}</tbody>
    </table>

    <h3>🔧 ICD-10-PCS 分類（${META.icdSource.pcs_total.toLocaleString()} codes）</h3>
    <table>
      <thead><tr><th></th><th>ID</th><th>English</th><th>中文</th><th>Code Range</th><th>數量</th></tr></thead>
      <tbody>${pcsRows}</tbody>
    </table>

    <h3>🗂️ 資料來源</h3>
    <p>${escHtml(META.icdSource.title)}（版本：${escHtml(META.icdSource.version)}）</p>

    <h3>🚧 未來工作</h3>
    <ul>
      <li>FHIR Bundle / Condition / Procedure 資源範例產生器</li>
      <li>依 TW Core IG 產生 JSON FHIR 資源</li>
      <li>全量 ICD-10-CM / PCS 虛擬捲動（Virtual Scrolling）</li>
      <li>匯出搜尋結果為 CSV</li>
      <li>連結 Daily OPD Classifier（跨專案代碼對應）</li>
    </ul>`;
}

// ---------------------------------------------------------------------------
// Pre-load all specialty (non-others) CM categories on boot
// ---------------------------------------------------------------------------
async function preloadSpecialtyCm() {
  for (const cat of META.cm_categories) {
    if (cat.id === 'others') continue;
    if (!cmLoaded[cat.id]) {
      try {
        cmLoaded[cat.id] = await fetchJson(BASE + `data/cm/${cat.id}.json`);
      } catch(e) {
        console.warn('preload cm failed:', cat.id, e);
      }
    }
  }
  // After CM, load PCS specialty too
  for (const cat of META.pcs_categories) {
    if (cat.id === 'others') continue;
    if (!pcsLoaded[cat.id]) {
      try {
        pcsLoaded[cat.id] = await fetchJson(BASE + `data/pcs/${cat.id}.json`);
      } catch(e) {
        console.warn('preload pcs failed:', cat.id, e);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  await boot();
  // Preload specialty categories in background (enables search without clicking)
  preloadSpecialtyCm();

  // Event delegation for edu-list (delete buttons)
  document.getElementById('edu-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-action="delete-edu"]');
    if (btn) deleteEduLink(btn.dataset.id);
  });

  // Event delegation for history-list (toggle / delete buttons)
  document.getElementById('history-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'toggle-entry') toggleHistoryEntry(btn.dataset.id);
    if (btn.dataset.action === 'delete-entry') deleteHistoryEntry(btn.dataset.type, btn.dataset.id);
  });
});

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
function storageGet(key, def = []) {
  try { return JSON.parse(localStorage.getItem(key)) ?? def; }
  catch { return def; }
}

function storageSet(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// EBM Notes
// ---------------------------------------------------------------------------
const EBM_ENTRIES_KEY   = 'phcep_ebm_entries';
const EBM_TEMPLATES_KEY = 'phcep_ebm_templates';

function initEbmTab() {
  document.getElementById('ebm-date').value = todayStr();
  renderEbmCatOptions();
  renderEbmTemplates();
}

function renderEbmCatOptions() {
  if (!META) return;
  const sel = document.getElementById('ebm-icd-cat');
  const cats = [...META.cm_categories, ...META.pcs_categories].filter(c => c.id !== 'others');
  sel.innerHTML = '<option value="">-- 選擇 ICD 類別 --</option>' +
    cats.map(c => `<option value="${escHtml(c.id)}">${escHtml(c.icon)} ${escHtml(c.nameZh)}</option>`).join('');
}

function renderEbmTemplates() {
  const templates = storageGet(EBM_TEMPLATES_KEY);
  const sel = document.getElementById('ebm-template-sel');
  sel.innerHTML = '<option value="">-- 載入範本 --</option>' +
    templates.map(t => `<option value="${escHtml(t.id)}">${escHtml(t.name)}</option>`).join('');
}

function loadEbmTemplate() {
  const id = document.getElementById('ebm-template-sel').value;
  if (!id) return;
  const t = storageGet(EBM_TEMPLATES_KEY).find(x => x.id === id);
  if (t) document.getElementById('ebm-content').value = t.content;
}

function saveEbmTemplate() {
  const content = document.getElementById('ebm-content').value.trim();
  if (!content) { toast('⚠️ 請先輸入內容再儲存範本'); return; }
  const name = prompt('範本名稱：');
  if (!name) return;
  const templates = storageGet(EBM_TEMPLATES_KEY);
  templates.push({ id: genId(), name, content });
  storageSet(EBM_TEMPLATES_KEY, templates);
  renderEbmTemplates();
  toast('✅ 範本已儲存');
}

function deleteEbmTemplate() {
  const id = document.getElementById('ebm-template-sel').value;
  if (!id) { toast('⚠️ 請先選擇要刪除的範本'); return; }
  const templates = storageGet(EBM_TEMPLATES_KEY).filter(t => t.id !== id);
  storageSet(EBM_TEMPLATES_KEY, templates);
  renderEbmTemplates();
  toast('🗑️ 範本已刪除');
}

function saveEbmEntry() {
  const content = document.getElementById('ebm-content').value.trim();
  if (!content) { toast('⚠️ 請先輸入 EBM 內容'); return; }
  const date   = document.getElementById('ebm-date').value || todayStr();
  const icdCat = document.getElementById('ebm-icd-cat').value;
  const entries = storageGet(EBM_ENTRIES_KEY);
  entries.unshift({ id: genId(), date, icdCat, content, createdAt: new Date().toISOString() });
  storageSet(EBM_ENTRIES_KEY, entries);
  toast('✅ EBM 筆記已儲存');
  if (document.getElementById('tab-history').classList.contains('active')) renderHistory();
}

function clearEbmForm() {
  document.getElementById('ebm-content').value = '';
  document.getElementById('ebm-date').value = todayStr();
  document.getElementById('ebm-icd-cat').value = '';
}

// ---------------------------------------------------------------------------
// SOAP Notes
// ---------------------------------------------------------------------------
const SOAP_ENTRIES_KEY   = 'phcep_soap_entries';
const SOAP_TEMPLATES_KEY = 'phcep_soap_templates';

const DEFAULT_SOAP =
`S（主觀/主訴）：

O（客觀/檢查）：

A（評估/診斷）：

P（計畫/處置）：
`;

function initSoapTab() {
  document.getElementById('soap-date').value = todayStr();
  document.getElementById('soap-content').value = DEFAULT_SOAP;
  renderSoapTemplates();
}

function renderSoapTemplates() {
  const templates = storageGet(SOAP_TEMPLATES_KEY);
  const sel = document.getElementById('soap-template-sel');
  sel.innerHTML = '<option value="">-- 載入範本 --</option>' +
    templates.map(t => `<option value="${escHtml(t.id)}">${escHtml(t.name)}</option>`).join('');
}

function loadSoapTemplate() {
  const id = document.getElementById('soap-template-sel').value;
  if (!id) return;
  const t = storageGet(SOAP_TEMPLATES_KEY).find(x => x.id === id);
  if (t) document.getElementById('soap-content').value = t.content;
}

function saveSoapTemplate() {
  const content = document.getElementById('soap-content').value.trim();
  if (!content) { toast('⚠️ 請先輸入內容再儲存範本'); return; }
  const name = prompt('範本名稱：');
  if (!name) return;
  const templates = storageGet(SOAP_TEMPLATES_KEY);
  templates.push({ id: genId(), name, content });
  storageSet(SOAP_TEMPLATES_KEY, templates);
  renderSoapTemplates();
  toast('✅ 範本已儲存');
}

function deleteSoapTemplate() {
  const id = document.getElementById('soap-template-sel').value;
  if (!id) { toast('⚠️ 請先選擇要刪除的範本'); return; }
  const templates = storageGet(SOAP_TEMPLATES_KEY).filter(t => t.id !== id);
  storageSet(SOAP_TEMPLATES_KEY, templates);
  renderSoapTemplates();
  toast('🗑️ 範本已刪除');
}

function saveSoapEntry() {
  const content = document.getElementById('soap-content').value.trim();
  if (!content) { toast('⚠️ 請先輸入 SOAP 內容'); return; }
  const date = document.getElementById('soap-date').value || todayStr();
  const entries = storageGet(SOAP_ENTRIES_KEY);
  entries.unshift({ id: genId(), date, content, createdAt: new Date().toISOString() });
  storageSet(SOAP_ENTRIES_KEY, entries);
  toast('✅ SOAP 病歷已儲存');
  if (document.getElementById('tab-history').classList.contains('active')) renderHistory();
}

function clearSoapForm() {
  document.getElementById('soap-content').value = DEFAULT_SOAP;
  document.getElementById('soap-date').value = todayStr();
}

// ---------------------------------------------------------------------------
// Patient Education Resources
// ---------------------------------------------------------------------------

function initEduTab() {
  renderEduFileList();
}

function renderEduFileList() {
  var container = document.getElementById('edu-file-list');
  if (!container) return;
  container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted)">載入中…</div>';

  fetchJson(BASE + 'data/edu/patient_edu_data.json').then(function(data) {
    if (!data || !data.files || data.files.length === 0) {
      container.innerHTML = '<p class="empty-msg" style="padding:20px">尚無衛教資源</p>';
      return;
    }
    container.innerHTML = '';
    data.files.forEach(function(file) {
      var card = document.createElement('div');
      card.className = 'edu-file-card';

      var icon = document.createElement('span');
      icon.className = 'edu-file-icon';
      icon.textContent = file.type === 'docx' ? '📄' : file.type === 'pdf' ? '📕' : '🖼️';

      var title = document.createElement('span');
      title.className = 'edu-file-title';
      title.textContent = file.title || file.filename;

      var meta = document.createElement('span');
      meta.className = 'edu-file-meta';
      meta.textContent = file.type ? file.type.toUpperCase() : '';

      card.appendChild(icon);
      card.appendChild(title);
      card.appendChild(meta);

      card.addEventListener('click', function() { eduOpenFile(file); });
      container.appendChild(card);
    });
  }).catch(function() {
    container.innerHTML = '<p style="padding:20px;color:var(--red)">⚠️ 無法載入衛教資源列表</p>';
  });
}

function eduOpenFile(file) {
  var viewer = document.getElementById('edu-viewer');
  var titleEl = document.getElementById('edu-viewer-title');
  var content = document.getElementById('edu-viewer-content');
  var fileList = document.getElementById('edu-file-list');

  if (!viewer || !content) return;

  titleEl.textContent = file.title || file.filename;
  content.innerHTML = '';

  // Show HTML content if available
  if (file.htmlContent) {
    content.innerHTML = file.htmlContent;
  }

  // Show images if available
  if (file.images && file.images.length > 0) {
    var imgSection = document.createElement('div');
    imgSection.className = 'edu-images';
    file.images.forEach(function(img) {
      var figure = document.createElement('figure');
      var imgEl = document.createElement('img');
      imgEl.src = img.data;
      imgEl.alt = img.caption || '';
      imgEl.className = 'edu-img';
      figure.appendChild(imgEl);
      if (img.caption) {
        var cap = document.createElement('figcaption');
        cap.textContent = img.caption;
        figure.appendChild(cap);
      }
      imgSection.appendChild(figure);
    });
    content.appendChild(imgSection);
  }

  if (!file.htmlContent && (!file.images || file.images.length === 0)) {
    content.innerHTML = '<p style="color:var(--muted);padding:20px">無可顯示的內容</p>';
  }

  if (fileList) fileList.classList.add('hidden');
  viewer.classList.remove('hidden');
}

function eduCloseViewer() {
  var viewer = document.getElementById('edu-viewer');
  var fileList = document.getElementById('edu-file-list');
  if (viewer) viewer.classList.add('hidden');
  if (fileList) fileList.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// History / Browse
// ---------------------------------------------------------------------------
let historyFilter = 'all';

function setHistoryFilter(f) {
  historyFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === f));
  renderHistory();
}

function renderHistory() {
  const ebm  = storageGet(EBM_ENTRIES_KEY).map(e => ({ ...e, type: 'ebm' }));
  const soap = storageGet(SOAP_ENTRIES_KEY).map(e => ({ ...e, type: 'soap' }));
  let all = [];
  if (historyFilter === 'all' || historyFilter === 'ebm')  all.push(...ebm);
  if (historyFilter === 'all' || historyFilter === 'soap') all.push(...soap);
  all.sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date);
    return b.createdAt.localeCompare(a.createdAt);
  });

  const container = document.getElementById('history-list');
  if (all.length === 0) {
    container.innerHTML = '<p class="empty-msg">尚無記錄</p>';
    return;
  }
  container.innerHTML = all.map(entry => {
    const preview   = entry.content.slice(0, 150).replace(/\n/g, ' ');
    const label     = entry.type === 'ebm' ? '📝 EBM' : '🏥 SOAP';
    const labelCls  = entry.type === 'ebm' ? 'ebm' : 'soap';
    let catLabel = '';
    if (entry.type === 'ebm' && entry.icdCat && META) {
      const cat = [...META.cm_categories, ...META.pcs_categories].find(c => c.id === entry.icdCat);
      if (cat) catLabel = `<span class="icd-tag">${escHtml(cat.icon)} ${escHtml(cat.nameZh)}</span>`;
    }
    return `
    <div class="history-entry" id="hentry-${escHtml(entry.id)}">
      <div class="history-entry-header">
        <span class="type-badge ${labelCls}">${label}</span>
        <span class="date-tag">📅 ${escHtml(entry.date)}</span>
        ${catLabel}
        <div class="history-actions">
          <button class="btn-icon" data-action="toggle-entry" data-id="${escHtml(entry.id)}" title="展開/收合">👁️</button>
          <button class="btn-icon" data-action="delete-entry" data-type="${escHtml(entry.type)}" data-id="${escHtml(entry.id)}" title="刪除">🗑️</button>
        </div>
      </div>
      <div class="history-preview">${escHtml(preview)}${entry.content.length > 150 ? '…' : ''}</div>
      <div class="history-full hidden" id="hfull-${escHtml(entry.id)}"><pre>${escHtml(entry.content)}</pre></div>
    </div>`;
  }).join('');
}

function toggleHistoryEntry(id) {
  const el = document.getElementById('hfull-' + id);
  if (el) el.classList.toggle('hidden');
}

function deleteHistoryEntry(type, id) {
  const key = type === 'ebm' ? EBM_ENTRIES_KEY : SOAP_ENTRIES_KEY;
  storageSet(key, storageGet(key).filter(e => e.id !== id));
  renderHistory();
  toast('🗑️ 已刪除');
}

// ===========================================================================
// NHI Payment Standard Tab
// ---------------------------------------------------------------------------
// State
let NHI_DATA = null;       // Full JSON from data/nhi/nhi.json
let nhiActiveCat = null;   // Currently selected category id
let nhiSearchQ = '';       // Current search query

async function initNhiTab() {
  try {
    NHI_DATA = await fetchJson(BASE + 'data/nhi/nhi.json');
    renderNhiCatGrid();
    populateNhiCatSelect();
  } catch (e) {
    console.error('NHI load failed:', e);
    document.getElementById('nhi-cat-grid').innerHTML =
      '<p class="nhi-load-error">⚠️ 無法載入 NHI 支付標準資料：' + escHtml(String(e)) + '</p>';
  }
}

function nhiOnTabShow() {
  if (!NHI_DATA) initNhiTab();
}

// Render the category card grid (landing view)
function renderNhiCatGrid() {
  if (!NHI_DATA) return;
  const grid = document.getElementById('nhi-cat-grid');
  grid.innerHTML = NHI_DATA.categories.map(cat => {
    const total = cat.codes.length;
    return '<div class="nhi-cat-card" onclick="nhiOpenCat(\'' + cat.id + '\')">' +
      '<div class="nhi-cat-icon">' + escHtml(cat.icon) + '</div>' +
      '<div class="nhi-cat-name-zh">' + escHtml(cat.nameZh) + '</div>' +
      '<div class="nhi-cat-name-en">' + escHtml(cat.nameEn) + '</div>' +
      '<div class="nhi-cat-section">' + escHtml(cat.section) + '</div>' +
      '<div class="nhi-cat-count">' + total + ' 項</div>' +
      '<div class="nhi-cat-resource">' + escHtml(cat.fhir_resource) + '</div>' +
      '</div>';
  }).join('');
}

function populateNhiCatSelect() {
  if (!NHI_DATA) return;
  const sel = document.getElementById('nhi-cat-sel');
  sel.innerHTML = '<option value="">— 選擇分類 —</option>' +
    NHI_DATA.categories.map(c =>
      '<option value="' + escHtml(c.id) + '">' + escHtml(c.icon) + ' ' + escHtml(c.nameZh) + '</option>'
    ).join('');
}

function nhiSelectCat(id) {
  if (!id) {
    nhiActiveCat = null;
    nhiSearchQ = '';
    document.getElementById('nhi-search').value = '';
    document.getElementById('nhi-cat-grid').classList.remove('hidden');
    document.getElementById('nhi-table-wrap').classList.add('hidden');
    return;
  }
  nhiOpenCat(id);
  document.getElementById('nhi-cat-sel').value = id;
}

function nhiOpenCat(id) {
  if (!NHI_DATA) return;
  nhiActiveCat = id;
  nhiSearchQ = document.getElementById('nhi-search').value.trim();
  document.getElementById('nhi-cat-sel').value = id;
  document.getElementById('nhi-cat-grid').classList.add('hidden');
  document.getElementById('nhi-table-wrap').classList.remove('hidden');
  nhiRender();
}

function nhiSearch(q) {
  nhiSearchQ = q.trim();
  if (nhiSearchQ.length >= 2) {
    saveSearchHistory('nhi', nhiSearchQ);
  }
  if (nhiSearchQ) {
    if (!nhiActiveCat) {
      document.getElementById('nhi-cat-grid').classList.add('hidden');
      document.getElementById('nhi-table-wrap').classList.remove('hidden');
    }
  } else if (!nhiActiveCat) {
    document.getElementById('nhi-cat-grid').classList.remove('hidden');
    document.getElementById('nhi-table-wrap').classList.add('hidden');
    return;
  }
  nhiRender();
}

function nhiRender() {
  if (!NHI_DATA) return;

  const q = nhiSearchQ.toLowerCase();
  const showNote = document.getElementById('nhi-show-note').checked;

  let codes = [];
  let headerText = '';
  let fhirProfile = '';
  let fhirResource = '';
  const fhirSystem = NHI_DATA.twCoreIG.nhi_system;

  if (nhiActiveCat) {
    const cat = NHI_DATA.categories.find(function(c) { return c.id === nhiActiveCat; });
    if (!cat) return;
    codes = cat.codes.slice();
    headerText = escHtml(cat.icon) + ' ' + escHtml(cat.nameZh) +
      ' <span class="nhi-header-en">' + escHtml(cat.nameEn) + '</span>' +
      ' <span class="nhi-header-section">' + escHtml(cat.section) + '</span>';
    fhirProfile = cat.fhir_profile;
    fhirResource = cat.fhir_resource;
  } else {
    headerText = '🔍 全分類搜尋：「' + escHtml(nhiSearchQ) + '」';
    fhirResource = 'Multiple';
    NHI_DATA.categories.forEach(function(cat) {
      cat.codes.forEach(function(c) {
        codes.push(Object.assign({}, c, {_cat: cat.nameZh}));
      });
    });
  }

  if (q) {
    codes = codes.filter(function(r) {
      return r.code.toLowerCase().includes(q) ||
        (r.nameZh || '').toLowerCase().includes(q) ||
        (r.nameEn || '').toLowerCase().includes(q) ||
        (r.note || '').toLowerCase().includes(q);
    });
  }

  document.getElementById('nhi-table-header').innerHTML =
    '<div class="nhi-th-left">' + headerText + '</div>' +
    '<div class="nhi-th-right">' +
    (nhiActiveCat ? '<button class="btn-nhi-back" onclick="nhiBackToGrid()">← 返回分類</button>' : '') +
    '<span class="nhi-count-badge">' + codes.length + ' 項</span>' +
    '</div>';

  const banner = document.getElementById('nhi-fhir-banner');
  if (nhiActiveCat && fhirProfile) {
    banner.classList.remove('hidden');
    banner.innerHTML =
      '<span class="nhi-fhir-label">TW Core IG FHIR:</span>' +
      '<a href="' + escHtml(fhirProfile) + '" target="_blank" rel="noopener" class="nhi-fhir-link">' + escHtml(fhirResource) + '</a>' +
      '<span class="nhi-fhir-sep">|</span>' +
      '<a href="' + escHtml(fhirSystem) + '" target="_blank" rel="noopener" class="nhi-fhir-link">NHI Code System</a>' +
      '<span class="nhi-fhir-sep">|</span>' +
      '<span class="nhi-fhir-source">' + escHtml(NHI_DATA.source.title) + ' ' + escHtml(NHI_DATA.source.edition) + '</span>';
  } else {
    banner.classList.add('hidden');
  }

  const tbody = document.getElementById('nhi-tbody');
  const noRes = document.getElementById('nhi-no-results');

  if (codes.length === 0) {
    tbody.innerHTML = '';
    noRes.classList.remove('hidden');
    return;
  }
  noRes.classList.add('hidden');

  function availBadges(avail) {
    if (!avail) return '';
    const labels = [['基層院所','基'],['地區醫院','地'],['區域醫院','區'],['醫學中心','醫']];
    return labels.map(function(pair) {
      return '<span class="avail-badge ' + (avail[pair[0]] ? 'avail-yes' : 'avail-no') + '">' + pair[1] + '</span>';
    }).join('');
  }

  tbody.innerHTML = codes.map(function(r) {
    var noteHtml = (showNote && r.note)
      ? '<tr class="nhi-note-row"><td colspan="4"><div class="nhi-note">' + escHtml(r.note) + '</div></td></tr>'
      : '';
    var catBadge = r._cat
      ? '<span class="nhi-cat-inline">' + escHtml(r._cat) + '</span> ' : '';
    return '<tr class="nhi-code-row" onclick="nhiToggleNote(this)">' +
      '<td class="col-code"><code class="nhi-code">' + escHtml(r.code) + '</code></td>' +
      '<td class="col-name">' + catBadge + escHtml(r.nameZh) +
        (r.nameEn ? '<br><span class="nhi-en">' + escHtml(r.nameEn) + '</span>' : '') +
        '</td>' +
      '<td class="col-pts"><span class="pts-badge">' + (escHtml(r.points) || '—') + '</span></td>' +
      '<td class="col-avail">' + availBadges(r.available) + '</td>' +
      '</tr>' + noteHtml;
  }).join('');
}

function nhiToggleNote(row) {
  var next = row.nextElementSibling;
  if (next && next.classList.contains('nhi-note-row')) {
    next.classList.toggle('hidden');
  }
}

function nhiBackToGrid() {
  nhiActiveCat = null;
  nhiSearchQ = '';
  document.getElementById('nhi-search').value = '';
  document.getElementById('nhi-cat-sel').value = '';
  document.getElementById('nhi-cat-grid').classList.remove('hidden');
  document.getElementById('nhi-table-wrap').classList.add('hidden');
}
// ===========================================================================

// ===========================================================================
// Search History
// ---------------------------------------------------------------------------
const SEARCH_HISTORY_MAX = 50;

function searchHistoryKey(type) {
  return 'phcep_search_history_' + type;
}

function getSearchHistory(type) {
  return storageGet(searchHistoryKey(type), []);
}

function saveSearchHistory(type, query) {
  if (!query || query.length < 2) return;
  let hist = getSearchHistory(type);
  // Remove duplicate
  hist = hist.filter(function(h) { return h !== query; });
  hist.unshift(query);
  if (hist.length > SEARCH_HISTORY_MAX) hist = hist.slice(0, SEARCH_HISTORY_MAX);
  storageSet(searchHistoryKey(type), hist);
}

function clearSearchHistory(type) {
  storageSet(searchHistoryKey(type), []);
  var itemsEl = document.getElementById(type + '-history-items');
  if (itemsEl) {
    itemsEl.innerHTML = '<div class="search-history-empty">無搜尋記錄</div>';
  }
}

function showSearchHistory(type) {
  var dropdownEl = document.getElementById(type + '-search-history');
  var itemsEl = document.getElementById(type + '-history-items');
  if (!dropdownEl || !itemsEl) return;

  var hist = getSearchHistory(type);
  if (hist.length === 0) {
    itemsEl.innerHTML = '<div class="search-history-empty">無搜尋記錄</div>';
  } else {
    itemsEl.innerHTML = '';
    hist.forEach(function(h) {
      var div = document.createElement('div');
      div.className = 'search-history-item';
      div.textContent = h;
      div.dataset.histType = type;
      div.dataset.histQuery = h;
      div.addEventListener('mousedown', function(e) {
        e.preventDefault();
        applySearchHistory(type, h);
      });
      itemsEl.appendChild(div);
    });
  }
  dropdownEl.classList.add('open');
}

function hideSearchHistory(type, delayMs) {
  setTimeout(function() {
    var el = document.getElementById(type + '-search-history');
    if (el) el.classList.remove('open');
  }, delayMs || 0);
}

function applySearchHistory(type, query) {
  if (type === 'nhi') {
    var inp = document.getElementById('nhi-search');
    if (inp) { inp.value = query; nhiSearch(query); }
  } else if (type === 'drug') {
    var inp = document.getElementById('drug-search');
    if (inp) { inp.value = query; drugSearch(query); }
  } else if (type === 'fulltext') {
    var inp = document.getElementById('search-input');
    if (inp) { inp.value = query; onSearchInput(); }
  } else if (type === 'cm') {
    var inp = document.getElementById('cm-search');
    if (inp) { inp.value = query; cmSearch(query); }
  } else if (type === 'stroke') {
    var inp = document.getElementById('stroke-search');
    if (inp) { inp.value = query; strokeSearch(inp.value); }
  }
  hideSearchHistory(type, 0);
}

// ===========================================================================
// Drug Benefits Tab
// ---------------------------------------------------------------------------
let DRUG_DATA = null;
let drugActiveCat = null;
let drugSearchQ = '';
let drugActiveTag = '';

async function initDrugTab() {
  try {
    DRUG_DATA = await fetchJson(BASE + 'data/nhi/drug_benefits.json');
    renderDrugCatGrid();
    populateDrugCatSelect();
    renderDrugTagFilter();
  } catch (e) {
    console.error('Drug benefits load failed:', e);
    var el = document.getElementById('drug-cat-grid');
    if (el) el.innerHTML = '<p class="nhi-load-error">⚠️ 無法載入藥品給付規定資料：' + escHtml(String(e)) + '</p>';
  }
}

function drugOnTabShow() {
  if (!DRUG_DATA) initDrugTab();
}

function renderDrugCatGrid() {
  if (!DRUG_DATA) return;
  var grid = document.getElementById('drug-cat-grid');
  if (!grid) return;
  grid.innerHTML = '';
  DRUG_DATA.categories.forEach(function(cat) {
    var card = document.createElement('div');
    card.className = 'drug-cat-card';
    card.addEventListener('click', function() { drugOpenCat(cat.id); });

    var iconDiv = document.createElement('div');
    iconDiv.className = 'drug-cat-icon';
    iconDiv.textContent = cat.icon;

    var nameZhDiv = document.createElement('div');
    nameZhDiv.className = 'drug-cat-name-zh';
    nameZhDiv.textContent = cat.nameZh;

    var nameEnDiv = document.createElement('div');
    nameEnDiv.className = 'drug-cat-name-en';
    nameEnDiv.textContent = cat.nameEn;

    var countDiv = document.createElement('div');
    countDiv.className = 'drug-cat-count';
    countDiv.textContent = cat.totalEntries + ' 項';

    card.appendChild(iconDiv);
    card.appendChild(nameZhDiv);
    card.appendChild(nameEnDiv);
    card.appendChild(countDiv);
    grid.appendChild(card);
  });
}

function populateDrugCatSelect() {
  if (!DRUG_DATA) return;
  var sel = document.getElementById('drug-cat-sel');
  if (!sel) return;
  sel.innerHTML = '<option value="">全部分類</option>' +
    DRUG_DATA.categories.map(function(c) {
      return '<option value="' + escHtml(c.id) + '">' + escHtml(c.icon) + ' ' + escHtml(c.nameZh) + '</option>';
    }).join('');
}

function renderDrugTagFilter() {
  if (!DRUG_DATA) return;
  var wrap = document.getElementById('drug-tag-filter');
  if (!wrap) return;
  var tags = DRUG_DATA.expertiseTags || [];

  // Build buttons using DOM to avoid XSS
  wrap.innerHTML = '';

  var allBtn = document.createElement('button');
  allBtn.className = 'drug-tag-btn active';
  allBtn.dataset.tag = '';
  allBtn.textContent = '全部';
  allBtn.addEventListener('click', function() { drugFilterTag('', allBtn); });
  wrap.appendChild(allBtn);

  tags.forEach(function(t) {
    var btn = document.createElement('button');
    btn.className = 'drug-tag-btn';
    btn.dataset.tag = t;
    btn.textContent = t;
    btn.addEventListener('click', function() { drugFilterTag(t, btn); });
    wrap.appendChild(btn);
  });
}

function drugFilterTag(tag, btn) {
  drugActiveTag = tag;
  document.querySelectorAll('.drug-tag-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.tag === tag);
  });
  if (drugActiveCat || drugSearchQ) {
    drugRender();
  }
}

function drugSelectCat(id) {
  if (!id) {
    drugActiveCat = null;
    drugSearchQ = '';
    var inp = document.getElementById('drug-search');
    if (inp) inp.value = '';
    document.getElementById('drug-cat-grid').classList.remove('hidden');
    document.getElementById('drug-list-wrap').classList.add('hidden');
    return;
  }
  drugOpenCat(id);
  var sel = document.getElementById('drug-cat-sel');
  if (sel) sel.value = id;
}

function drugOpenCat(id) {
  if (!DRUG_DATA) return;
  drugActiveCat = id;
  drugSearchQ = (document.getElementById('drug-search') || {}).value || '';
  drugSearchQ = drugSearchQ.trim();
  var sel = document.getElementById('drug-cat-sel');
  if (sel) sel.value = id;
  document.getElementById('drug-cat-grid').classList.add('hidden');
  document.getElementById('drug-list-wrap').classList.remove('hidden');
  drugRender();
}

function drugSearch(q) {
  drugSearchQ = q.trim();
  if (drugSearchQ.length >= 2) {
    saveSearchHistory('drug', drugSearchQ);
  }
  var grid = document.getElementById('drug-cat-grid');
  var sel = document.getElementById('drug-cat-sel');
  var tagFilter = document.getElementById('drug-tag-filter');
  if (drugSearchQ) {
    // When searching: make category controls transparent, overlay with results
    if (grid) grid.classList.add('search-overlay-active');
    if (sel) sel.classList.add('search-overlay-active');
    if (tagFilter) tagFilter.classList.add('search-overlay-active');
    if (!drugActiveCat) {
      if (grid) grid.classList.add('hidden');
      document.getElementById('drug-list-wrap').classList.remove('hidden');
    }
  } else {
    if (grid) grid.classList.remove('search-overlay-active');
    if (sel) sel.classList.remove('search-overlay-active');
    if (tagFilter) tagFilter.classList.remove('search-overlay-active');
    if (!drugActiveCat) {
      if (grid) grid.classList.remove('hidden');
      document.getElementById('drug-list-wrap').classList.add('hidden');
      return;
    }
  }
  drugRender();
}

function drugGetFilteredEntries() {
  if (!DRUG_DATA) return [];
  var allEntries = [];

  if (drugActiveCat) {
    var cat = DRUG_DATA.categories.find(function(c) { return c.id === drugActiveCat; });
    if (cat) allEntries = cat.entries.slice();
  } else {
    DRUG_DATA.categories.forEach(function(cat) {
      cat.entries.forEach(function(e) {
        allEntries.push(Object.assign({}, e, { _cat: cat.nameZh, _catId: cat.id }));
      });
    });
  }

  // Filter by expertise tag
  if (drugActiveTag) {
    allEntries = allEntries.filter(function(e) {
      return e.tags && e.tags.indexOf(drugActiveTag) >= 0;
    });
  }

  // Filter by search query
  if (drugSearchQ) {
    var q = drugSearchQ.toLowerCase();
    allEntries = allEntries.filter(function(e) {
      return e.name.toLowerCase().includes(q) ||
             (e.content || '').toLowerCase().includes(q) ||
             e.id.toLowerCase().includes(q);
    });
  }

  return allEntries;
}

function drugRender() {
  if (!DRUG_DATA) return;

  var entries = drugGetFilteredEntries();
  var headerEl = document.getElementById('drug-list-header');
  var entriesEl = document.getElementById('drug-entries');
  var noResEl = document.getElementById('drug-no-results');

  // Build header using DOM
  if (headerEl) {
    headerEl.innerHTML = '';
    var titleEl = document.createElement('div');
    titleEl.className = 'drug-list-title';
    if (drugActiveCat) {
      var cat = DRUG_DATA.categories.find(function(c) { return c.id === drugActiveCat; });
      if (cat) {
        titleEl.textContent = cat.icon + ' ' + cat.nameZh + ' ';
        var enSpan = document.createElement('span');
        enSpan.style.cssText = 'font-size:.78rem;font-weight:400;color:var(--muted)';
        enSpan.textContent = cat.nameEn;
        titleEl.appendChild(enSpan);
      }
    } else if (drugSearchQ) {
      titleEl.textContent = '🔍 全分類搜尋：「' + drugSearchQ + '」';
    } else if (drugActiveTag) {
      titleEl.textContent = '🏷️ 標籤篩選：' + drugActiveTag;
    } else {
      titleEl.textContent = '全部藥品';
    }
    headerEl.appendChild(titleEl);

    if (drugActiveCat) {
      var backBtn = document.createElement('button');
      backBtn.className = 'btn-drug-back';
      backBtn.textContent = '← 返回分類';
      backBtn.addEventListener('click', drugBackToGrid);
      headerEl.appendChild(backBtn);
    }

    var countBadge = document.createElement('span');
    countBadge.className = 'drug-count-badge';
    countBadge.textContent = entries.length + ' 項';
    headerEl.appendChild(countBadge);
  }

  if (entries.length === 0) {
    if (entriesEl) entriesEl.innerHTML = '';
    if (noResEl) noResEl.classList.remove('hidden');
    return;
  }
  if (noResEl) noResEl.classList.add('hidden');

  if (entriesEl) {
    entriesEl.innerHTML = '';
    entries.forEach(function(e) {
      var entryDiv = document.createElement('div');
      entryDiv.className = 'drug-entry';

      var headerDiv = document.createElement('div');
      headerDiv.className = 'drug-entry-header';

      var idSpan = document.createElement('span');
      idSpan.className = 'drug-entry-id';
      idSpan.textContent = e.id;

      var nameSpan = document.createElement('span');
      nameSpan.className = 'drug-entry-name';
      if (e._cat) {
        var catBadge = document.createElement('span');
        catBadge.style.cssText = 'font-size:.68rem;color:var(--muted);margin-right:6px';
        catBadge.textContent = e._cat;
        nameSpan.appendChild(catBadge);
      }
      nameSpan.appendChild(document.createTextNode(e.name));

      var tagsSpan = document.createElement('span');
      tagsSpan.className = 'drug-entry-tags';
      (e.tags || []).forEach(function(t) {
        var tagEl = document.createElement('span');
        tagEl.className = 'drug-tag';
        tagEl.textContent = t;
        tagsSpan.appendChild(tagEl);
      });

      var chevronSpan = document.createElement('span');
      chevronSpan.className = 'drug-entry-chevron';
      chevronSpan.textContent = '▶';

      headerDiv.appendChild(idSpan);
      headerDiv.appendChild(nameSpan);
      headerDiv.appendChild(tagsSpan);
      headerDiv.appendChild(chevronSpan);

      var contentDiv = document.createElement('div');
      contentDiv.className = 'drug-entry-content';
      contentDiv.textContent = e.content || '';

      headerDiv.addEventListener('click', function() {
        entryDiv.classList.toggle('open');
      });

      entryDiv.appendChild(headerDiv);
      entryDiv.appendChild(contentDiv);
      entriesEl.appendChild(entryDiv);
    });
  }
}

function drugToggleEntry(entryId) {
  var el = document.getElementById('dentry-' + entryId);
  if (el) el.classList.toggle('open');
}

function drugBackToGrid() {
  drugActiveCat = null;
  drugSearchQ = '';
  var inp = document.getElementById('drug-search');
  if (inp) inp.value = '';
  var sel = document.getElementById('drug-cat-sel');
  if (sel) { sel.value = ''; sel.classList.remove('search-overlay-active'); }
  var grid = document.getElementById('drug-cat-grid');
  if (grid) grid.classList.remove('hidden', 'search-overlay-active');
  var tagFilter = document.getElementById('drug-tag-filter');
  if (tagFilter) tagFilter.classList.remove('search-overlay-active');
  document.getElementById('drug-list-wrap').classList.add('hidden');
}
// ===========================================================================

// ===========================================================================
// Stroke Guidelines Tab — redesigned to match drug/ICD tab format
// ===========================================================================
var STROKE_DATA = null;
var strokeActiveTopic = '';
var strokeSearchQ = '';
var strokeSearchDebounce = null;

var STROKE_TOPIC_LABELS = {
  'dyslipidemia':              { label: '🧪 血脂異常', icon: '🧪', order: 1 },
  'blood_pressure':            { label: '💉 血壓控制', icon: '💉', order: 2 },
  'iv_thrombolysis':           { label: '💊 靜脈溶栓', icon: '💊', order: 3 },
  'mechanical_thrombectomy':   { label: '🔧 動脈取栓', icon: '🔧', order: 4 },
  'antiplatelet':              { label: '💊 抗血小板', icon: '💊', order: 5 },
  'noac_af':                   { label: '💊 NOAC/心房顫動', icon: '💊', order: 6 },
  'intracerebral_hemorrhage':  { label: '🩸 腦出血', icon: '🩸', order: 7 },
  'intracranial_atherosclerosis': { label: '🧠 顱內動脈硬化', icon: '🧠', order: 8 },
  'diabetes_glycemic':         { label: '🩸 糖尿病/血糖', icon: '🩸', order: 9 },
  'ckd_stroke':                { label: '🫘 慢性腎臟病', icon: '🫘', order: 10 },
  'prehospital':               { label: '🚑 院前處置', icon: '🚑', order: 11 },
  'prehospital_emergency':     { label: '🏥 急診處置', icon: '🏥', order: 12 },
  'post_stroke_epilepsy':      { label: '⚡ 中風後癲癇', icon: '⚡', order: 13 },
  'post_stroke_spasticity':    { label: '💪 中風後痙攣', icon: '💪', order: 14 },
  'post_stroke_dysphagia':     { label: '🍽️ 中風後吞嚥', icon: '🍽️', order: 15 },
  'women_stroke':              { label: '👩 女性中風', icon: '👩', order: 16 },
  'anti_amyloid_antibody':     { label: '🧬 抗類澱粉蛋白', icon: '🧬', order: 17 },
  'herpes_zoster_vaccine':     { label: '💉 帶狀疹疫苗', icon: '💉', order: 18 },
  'covid19_adjustment':        { label: '😷 COVID-19', icon: '😷', order: 19 },
  'focused_update_2017':       { label: '🔄 2017指引更新', icon: '🔄', order: 20 },
  'general_2020':              { label: '📋 2020綜合指引', icon: '📋', order: 21 },
  'general':                   { label: '📋 綜合指引', icon: '📋', order: 22 }
};

async function initStrokeTab() {
  if (!STROKE_DATA) {
    try {
      STROKE_DATA = await fetchJson(BASE + 'data/stroke_guidelines.json');
    } catch (e) {
      console.error('Stroke guidelines load failed:', e);
      var grid = document.getElementById('stroke-cat-grid');
      if (grid) grid.innerHTML = '<p style="padding:20px;color:var(--red)">⚠️ 無法載入腦中風指引資料：' + escHtml(String(e)) + '</p>';
      return;
    }
  }
  renderStrokeCatGrid();
  populateStrokeCatSelect();
}

function strokeOnTabShow() {
  if (!STROKE_DATA) initStrokeTab();
}

function renderStrokeCatGrid() {
  var grid = document.getElementById('stroke-cat-grid');
  if (!grid || !STROKE_DATA) return;
  grid.innerHTML = '';

  // Group guidelines by topic
  var topicMap = {};
  STROKE_DATA.guidelines.forEach(function(g) {
    if (!topicMap[g.topic]) topicMap[g.topic] = [];
    topicMap[g.topic].push(g);
  });

  // Sort topics by order
  var topics = Object.keys(topicMap).sort(function(a, b) {
    var oa = (STROKE_TOPIC_LABELS[a] || {}).order || 99;
    var ob = (STROKE_TOPIC_LABELS[b] || {}).order || 99;
    return oa - ob;
  });

  topics.forEach(function(topic) {
    var info = STROKE_TOPIC_LABELS[topic] || { label: topic, icon: '📄' };
    var guidelines = topicMap[topic];
    var card = document.createElement('div');
    card.className = 'drug-cat-card stroke-cat-card';
    card.addEventListener('click', function() { strokeOpenTopic(topic); });

    var iconDiv = document.createElement('div');
    iconDiv.className = 'drug-cat-icon';
    iconDiv.textContent = info.icon || '📄';

    var nameDiv = document.createElement('div');
    nameDiv.className = 'drug-cat-name-zh';
    nameDiv.textContent = info.label.replace(/^[^\s]+\s/, ''); // remove emoji prefix

    var countDiv = document.createElement('div');
    countDiv.className = 'drug-cat-count';
    countDiv.textContent = guidelines.length + ' 篇指引';

    // Year range
    var years = guidelines.map(function(g) { return g.year; });
    var yearRange = Math.min.apply(null, years) + (years.length > 1 ? '–' + Math.max.apply(null, years) : '');
    var yearDiv = document.createElement('div');
    yearDiv.className = 'stroke-cat-years';
    yearDiv.textContent = yearRange;

    card.appendChild(iconDiv);
    card.appendChild(nameDiv);
    card.appendChild(countDiv);
    card.appendChild(yearDiv);
    grid.appendChild(card);
  });
}

function populateStrokeCatSelect() {
  var sel = document.getElementById('stroke-cat-sel');
  if (!sel || !STROKE_DATA) return;
  sel.innerHTML = '<option value="">全部分類</option>';

  var topicsPresent = {};
  STROKE_DATA.guidelines.forEach(function(g) { topicsPresent[g.topic] = true; });
  var sorted = Object.keys(topicsPresent).sort(function(a, b) {
    var oa = (STROKE_TOPIC_LABELS[a] || {}).order || 99;
    var ob = (STROKE_TOPIC_LABELS[b] || {}).order || 99;
    return oa - ob;
  });
  sorted.forEach(function(topic) {
    var info = STROKE_TOPIC_LABELS[topic] || { label: topic };
    var opt = document.createElement('option');
    opt.value = topic;
    opt.textContent = info.label;
    sel.appendChild(opt);
  });
}

function strokeSelectCatById(topic) {
  if (!topic) {
    strokeActiveTopic = '';
    document.getElementById('stroke-cat-grid').classList.remove('hidden');
    document.getElementById('stroke-list-wrap').classList.add('hidden');
    var sel = document.getElementById('stroke-cat-sel');
    if (sel) sel.value = '';
    return;
  }
  strokeOpenTopic(topic);
  var sel = document.getElementById('stroke-cat-sel');
  if (sel) sel.value = topic;
}

function strokeOpenTopic(topic) {
  strokeActiveTopic = topic;
  var sel = document.getElementById('stroke-cat-sel');
  if (sel) sel.value = topic;
  document.getElementById('stroke-cat-grid').classList.add('hidden');
  document.getElementById('stroke-list-wrap').classList.remove('hidden');
  strokeRender();
}

function strokeSearch(q) {
  clearTimeout(strokeSearchDebounce);
  strokeSearchDebounce = setTimeout(function() {
    strokeSearchQ = q.trim();
    if (strokeSearchQ.length >= 2) {
      saveSearchHistory('stroke', strokeSearchQ);
    }
    var grid = document.getElementById('stroke-cat-grid');
    var sel = document.getElementById('stroke-cat-sel');
    if (strokeSearchQ) {
      if (grid) grid.classList.add('search-overlay-active');
      if (sel) sel.classList.add('search-overlay-active');
      if (!strokeActiveTopic) {
        if (grid) grid.classList.add('hidden');
        document.getElementById('stroke-list-wrap').classList.remove('hidden');
      }
    } else {
      if (grid) grid.classList.remove('search-overlay-active', 'hidden');
      if (sel) sel.classList.remove('search-overlay-active');
      if (!strokeActiveTopic) {
        document.getElementById('stroke-list-wrap').classList.add('hidden');
        return;
      }
    }
    strokeRender();
  }, 200);
}

function strokeRender() {
  if (!STROKE_DATA) return;
  var q = strokeSearchQ.toLowerCase();
  var topic = strokeActiveTopic;

  var filtered = STROKE_DATA.guidelines.filter(function(g) {
    if (topic && g.topic !== topic) return false;
    if (q) {
      var titleMatch = (g.title || g.title_en || '').toLowerCase().indexOf(q) >= 0;
      var topicMatch = (g.topic || '').toLowerCase().indexOf(q) >= 0;
      var sectionMatch = sectionMatchesQuery(g.sections || [], q);
      if (!titleMatch && !topicMatch && !sectionMatch) return false;
    }
    return true;
  });

  var headerEl = document.getElementById('stroke-list-header');
  var entriesEl = document.getElementById('stroke-entries');
  var noResEl = document.getElementById('stroke-no-results');

  if (headerEl) {
    headerEl.innerHTML = '';
    var titleEl = document.createElement('div');
    titleEl.className = 'drug-list-title';
    if (topic) {
      var info = STROKE_TOPIC_LABELS[topic] || { label: topic };
      titleEl.textContent = info.label;
    } else if (q) {
      titleEl.textContent = '🔍 全指引搜尋：「' + q + '」';
    } else {
      titleEl.textContent = '全部指引';
    }
    headerEl.appendChild(titleEl);

    if (topic) {
      var backBtn = document.createElement('button');
      backBtn.className = 'btn-drug-back';
      backBtn.textContent = '← 返回分類';
      backBtn.addEventListener('click', strokeBackToGrid);
      headerEl.appendChild(backBtn);
    }

    var badge = document.createElement('span');
    badge.className = 'drug-count-badge';
    badge.textContent = filtered.length + ' 篇';
    headerEl.appendChild(badge);
  }

  if (filtered.length === 0) {
    if (entriesEl) entriesEl.innerHTML = '';
    if (noResEl) noResEl.classList.remove('hidden');
    return;
  }
  if (noResEl) noResEl.classList.add('hidden');

  if (entriesEl) {
    entriesEl.innerHTML = '';
    filtered.forEach(function(g) {
      entriesEl.appendChild(buildStrokeCard(g, q));
    });
  }
}

function sectionMatchesQuery(sections, q) {
  return sections.some(function(s) {
    return (s.heading || '').toLowerCase().indexOf(q) >= 0 ||
           (s.content || '').toLowerCase().indexOf(q) >= 0 ||
           sectionMatchesQuery(s.subsections || [], q);
  });
}

function strokeBackToGrid() {
  strokeActiveTopic = '';
  strokeSearchQ = '';
  var inp = document.getElementById('stroke-search');
  if (inp) inp.value = '';
  var sel = document.getElementById('stroke-cat-sel');
  if (sel) sel.value = '';
  var grid = document.getElementById('stroke-cat-grid');
  if (grid) grid.classList.remove('hidden', 'search-overlay-active');
  document.getElementById('stroke-list-wrap').classList.add('hidden');
}

function buildStrokeCard(g, q) {
  var card = document.createElement('div');
  card.className = 'drug-entry stroke-guideline-card';

  var header = document.createElement('div');
  header.className = 'drug-entry-header';

  var yearBadge = document.createElement('span');
  yearBadge.className = 'drug-entry-id stroke-year-badge';
  yearBadge.textContent = g.year;

  var langBadge = document.createElement('span');
  langBadge.className = 'stroke-lang-badge';
  langBadge.textContent = g.lang === 'zh' ? '中文' : 'EN';

  var titleSpan = document.createElement('span');
  titleSpan.className = 'drug-entry-name';
  titleSpan.textContent = g.title || g.title_en || g.filename;

  var chevron = document.createElement('span');
  chevron.className = 'drug-entry-chevron';
  chevron.textContent = '▶';

  header.appendChild(yearBadge);
  header.appendChild(langBadge);
  header.appendChild(titleSpan);
  header.appendChild(chevron);
  header.addEventListener('click', function() { card.classList.toggle('open'); });

  var body = document.createElement('div');
  body.className = 'drug-entry-content stroke-card-body';

  // Attribution line: "台灣腦中風學會治療指引(year)" + affiliations in lower right
  var attrib = document.createElement('div');
  attrib.className = 'stroke-attribution';
  var attribLeft = document.createElement('span');
  attribLeft.className = 'stroke-attrib-main';
  attribLeft.textContent = '台灣腦中風學會治療指引（' + g.year + '）';
  var attribRight = document.createElement('span');
  attribRight.className = 'stroke-attrib-affil';
  attribRight.textContent = (g.affiliations || []).slice(0, 3).join('・');
  attrib.appendChild(attribLeft);
  attrib.appendChild(attribRight);
  body.appendChild(attrib);

  // Sections tree
  var refsMap = {};
  (g.references || []).forEach(function(r) { refsMap[String(r.num)] = r.text; });

  var sectionsToShow = q ? filterSectionsForQuery(g.sections || [], q) : (g.sections || []);
  sectionsToShow.forEach(function(s) {
    if (!s.heading && !s.content) return;
    body.appendChild(buildStrokeSection(s, refsMap, q, 1));
  });

  // References toggle
  var refs = g.references || [];
  if (refs.length > 0) {
    var refsToggle = document.createElement('div');
    refsToggle.className = 'stroke-refs-toggle';
    refsToggle.textContent = '📚 參考文獻 (' + refs.length + ')';
    var refsList = document.createElement('div');
    refsList.className = 'stroke-refs-list';
    refs.forEach(function(r) {
      var item = document.createElement('div');
      item.className = 'stroke-ref-item';
      item.textContent = r.num + '. ' + (r.text || '');
      refsList.appendChild(item);
    });
    refsToggle.addEventListener('click', function() {
      refsList.classList.toggle('open');
      refsToggle.textContent = refsList.classList.contains('open')
        ? '📚 隱藏參考文獻' : '📚 參考文獻 (' + refs.length + ')';
    });
    body.appendChild(refsToggle);
    body.appendChild(refsList);
  }

  card.appendChild(header);
  card.appendChild(body);
  if (q) card.classList.add('open');
  return card;
}

function filterSectionsForQuery(sections, q) {
  return sections.filter(function(s) {
    return (s.heading || '').toLowerCase().indexOf(q) >= 0 ||
           (s.content || '').toLowerCase().indexOf(q) >= 0 ||
           filterSectionsForQuery(s.subsections || [], q).length > 0;
  });
}

function buildStrokeSection(s, refsMap, q, level) {
  var cls = level === 1 ? 'stroke-section' : level === 2 ? 'stroke-subsection' : 'stroke-sub3';
  var hdrCls = level === 1 ? 'stroke-section-header' : level === 2 ? 'stroke-subsection-header' : 'stroke-sub3-header';
  var bodyCls = level === 1 ? 'stroke-section-body' : level === 2 ? 'stroke-subsection-body' : 'stroke-sub3-body';

  var sec = document.createElement('div');
  sec.className = cls;

  var hdr = document.createElement('div');
  hdr.className = hdrCls;

  var chevron = document.createElement('span');
  chevron.className = 'stroke-section-chevron';
  chevron.textContent = '▶';

  var titleSpan = document.createElement('span');
  titleSpan.textContent = s.heading || '';

  var pageSpan = document.createElement('span');
  pageSpan.className = 'stroke-section-page';
  if (s.page) pageSpan.textContent = 'p.' + s.page;

  hdr.appendChild(chevron);
  hdr.appendChild(titleSpan);
  hdr.appendChild(pageSpan);
  hdr.addEventListener('click', function() { sec.classList.toggle('open'); });

  var body = document.createElement('div');
  body.className = bodyCls;

  if (s.content) {
    var contentEl = document.createElement('div');
    contentEl.className = 'stroke-section-content';
    appendContentWithRefs(contentEl, s.content, s.refs || [], refsMap);
    body.appendChild(contentEl);
  }

  (s.subsections || []).forEach(function(ss) {
    if (!ss.heading && !ss.content) return;
    body.appendChild(buildStrokeSection(ss, refsMap, q, level + 1));
  });

  sec.appendChild(hdr);
  sec.appendChild(body);
  if (q) sec.classList.add('open');
  return sec;
}

function appendContentWithRefs(el, content, refNums, refsMap) {
  var parts = content.split(/(\[\d+(?:,\s*\d+)*\])/g);
  parts.forEach(function(part) {
    var m = part.match(/^\[(\d+(?:,\s*\d+)*)\]$/);
    if (m) {
      var nums = m[1].split(/,\s*/);
      nums.forEach(function(n) {
        var refEl = document.createElement('sup');
        refEl.className = 'stroke-ref-num';
        refEl.textContent = '[' + n + ']';
        var refText = refsMap[n.trim()];
        if (refText) {
          refEl.addEventListener('mouseenter', function(e) { showStrokeRefTooltip(e, refText); });
          refEl.addEventListener('mouseleave', hideStrokeRefTooltip);
        }
        el.appendChild(refEl);
      });
    } else if (part) {
      el.appendChild(document.createTextNode(part));
    }
  });
}

function showStrokeRefTooltip(e, text) {
  var tip = document.getElementById('stroke-ref-tooltip');
  if (!tip) return;
  tip.textContent = text;
  tip.classList.remove('hidden');
  positionStrokeTooltip(e, tip);
}

function positionStrokeTooltip(e, tip) {
  var x = e.clientX + 14;
  var y = e.clientY - 10;
  var w = tip.offsetWidth || 300;
  var h = tip.offsetHeight || 80;
  if (x + w > window.innerWidth - 10) x = e.clientX - w - 10;
  if (y + h > window.innerHeight - 10) y = e.clientY - h - 5;
  tip.style.left = Math.max(5, x) + 'px';
  tip.style.top = Math.max(5, y) + 'px';
}

function hideStrokeRefTooltip() {
  var tip = document.getElementById('stroke-ref-tooltip');
  if (tip) tip.classList.add('hidden');
}

document.addEventListener('mousemove', function(e) {
  var tip = document.getElementById('stroke-ref-tooltip');
  if (tip && !tip.classList.contains('hidden')) positionStrokeTooltip(e, tip);
});
// ===========================================================================
