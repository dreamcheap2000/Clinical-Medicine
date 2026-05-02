/* ============================================================
   PHCEP — app.js
   Taiwan Core IG ICD-10 Viewer
   ============================================================ */

'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let META = null;
let ICD9_MAP = null;  // ICD-10 code → [ICD-9 codes]
let cmLoaded  = {};   // catId → {codes: [...]}
let pcsLoaded = {};   // catId → {codes: [...]}
let cmOthers  = null; // compact [[code,zh],...]
let pcsOthers = null; // compact [[code,zh],...]
let activeCmCat  = null;
let activePcsCat = null;
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
    populatePcsCatSelect();
    initEbmTab();
    initSoapTab();
    initEduTab();
    initNhiTab();
    initDrugTab();
    initSpecmatTab();
    // Load ICD-9 mapping in background
    fetchJson(BASE + 'data/icd9_mapping.json').then(d => { ICD9_MAP = d; }).catch(() => {});
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
  // PCS tab is only accessible if enabled in settings
  if (name === 'pcs' && !getSettings().showPcs) return;
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c =>
    c.classList.toggle('active', c.id === 'tab-' + name));
  if (name === 'history') renderHistory();
  if (name === 'nhi') nhiOnTabShow();
  if (name === 'drug') drugOnTabShow();
  if (name === 'specmat') specmatOnTabShow();
  if (name === 'ebm') renderEbmInlineHistory();
  if (name === 'soap') renderSoapInlineHistory();
  if (name === 'settings') renderSettingsTab();
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
  const resultsAbove = document.getElementById('cm-search-results');
  if (cmSearchQ) {
    // Show results above category grid
    grid.classList.add('search-overlay-active');
    if (resultsAbove) {
      resultsAbove.classList.remove('hidden');
      resultsAbove.innerHTML = buildCmSearchResults(cmSearchQ);
    } else {
      detail.classList.remove('hidden');
      detail.innerHTML = buildCmSearchResults(cmSearchQ);
    }
  } else {
    grid.classList.remove('search-overlay-active');
    if (resultsAbove) resultsAbove.classList.add('hidden');
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

  const rows = results.map(r => {
    const icd9s = ICD9_MAP ? (ICD9_MAP[r.code] || []) : [];
    const icd9Html = icd9s.length > 0
      ? `<span class="icd9-code">(ICD-9: ${escHtml(icd9s.slice(0,3).join(', '))})</span>` : '';
    return `
    <tr>
      <td class="code-cell">${escHtml(r.code)}${icd9Html}</td>
      <td class="en-cell">${escHtml(r.en)}</td>
      <td class="zh-cell">${escHtml(r.zh)}</td>
      <td style="font-size:.72rem;color:var(--muted)">${escHtml(r.catName)}</td>
    </tr>`;
  }).join('');

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
  // Reset page for this category
  _icdPageState[type + '_' + catId] = 0;
  fillDetailTable(type, catId, '');
  // Scroll to detail
  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
      oninput="_icdPageState['${type}_${cat.id}']=0; fillDetailTable('${type}','${cat.id}',this.value)" />
  </div>
  <div id="detail-table-${type}">
    <div style="padding:20px;text-align:center;color:var(--muted)">載入中…</div>
  </div>`;
}

// Page state for large ICD category pagination
var _icdPageState = {};  // key: `${type}_${catId}` → current page (0-indexed)
const ICD_PAGE_SIZE = 500;  // codes per page for large categories

function fillDetailTable(type, catId, filterStr, pageOverride) {
  const loaded = type === 'cm' ? cmLoaded : pcsLoaded;
  const data   = loaded[catId];
  if (!data) return;

  const isCompact = catId === 'others';
  const q = filterStr.trim().toLowerCase();
  const tableId = `detail-table-${type}`;
  const container = document.getElementById(tableId);
  if (!container) return;

  // Determine current page
  var pageKey = type + '_' + catId;
  if (pageOverride !== undefined) {
    _icdPageState[pageKey] = pageOverride;
  }
  if (_icdPageState[pageKey] === undefined) {
    _icdPageState[pageKey] = 0;
  }

  let allItems;
  let isCompactMode;

  if (isCompact) {
    const filtered = q
      ? data.filter(([c,z]) => c.toLowerCase().includes(q) || z.toLowerCase().includes(q))
      : data;
    allItems = filtered.map(([c,z]) => ({code:c, en:'', zh:z}));
    isCompactMode = true;
  } else {
    const codes = data.codes || [];
    const filtered = q
      ? codes.filter(r =>
          r.code.toLowerCase().includes(q) ||
          r.en.toLowerCase().includes(q) ||
          r.zh.toLowerCase().includes(q))
      : codes;
    allItems = filtered;
    isCompactMode = false;
  }

  const totalCount = allItems.length;
  const needsPaging = totalCount > ICD_PAGE_SIZE;
  const totalPages = needsPaging ? Math.ceil(totalCount / ICD_PAGE_SIZE) : 1;
  var currentPage = _icdPageState[pageKey];
  if (currentPage >= totalPages) currentPage = 0;
  _icdPageState[pageKey] = currentPage;

  const pageItems = needsPaging
    ? allItems.slice(currentPage * ICD_PAGE_SIZE, (currentPage + 1) * ICD_PAGE_SIZE)
    : allItems;

  // Build alphabet navigation only if single page or small set
  const alphaNav = !needsPaging ? buildAlphaNav(pageItems.map(r => r.code)) : '';

  // Build table rows
  const rows = buildGroupedRows(pageItems, isCompactMode);

  // Pagination controls
  var pagingHtml = '';
  if (needsPaging) {
    var prevDisabled = currentPage === 0 ? 'disabled' : '';
    var nextDisabled = currentPage >= totalPages - 1 ? 'disabled' : '';
    var rangeStart = currentPage * ICD_PAGE_SIZE + 1;
    var rangeEnd = Math.min((currentPage + 1) * ICD_PAGE_SIZE, totalCount);
    pagingHtml = `
      <div class="icd-paging">
        <button class="icd-page-btn" onclick="fillDetailTable('${escHtml(type)}','${escHtml(catId)}','${escHtml(filterStr)}',${currentPage - 1})" ${prevDisabled}>← 上一頁</button>
        <span class="icd-page-info">第 ${currentPage + 1} / ${totalPages} 頁（${rangeStart}–${rangeEnd} / ${totalCount.toLocaleString()} 筆）</span>
        <button class="icd-page-btn" onclick="fillDetailTable('${escHtml(type)}','${escHtml(catId)}','${escHtml(filterStr)}',${currentPage + 1})" ${nextDisabled}>下一頁 →</button>
      </div>`;
  }

  const colHeaders = isCompactMode
    ? '<tr><th>代碼</th><th>中文名稱</th></tr>'
    : '<tr><th>代碼</th><th>English</th><th>中文名稱</th></tr>';
  const tableCls = isCompactMode ? 'codes-table compact-table' : 'codes-table';

  container.innerHTML = `
    ${alphaNav}
    ${pagingHtml}
    <div class="codes-table-wrap">
      <table class="${tableCls}">
        <thead>${colHeaders}</thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="row-count">顯示 ${needsPaging ? pageItems.length : totalCount.toLocaleString()} 筆${needsPaging ? '（共 ' + totalCount.toLocaleString() + ' 筆，分頁顯示）' : ''}</div>
    ${needsPaging ? pagingHtml : ''}`;
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
      // Show ICD-9 code if available
      const icd9s = ICD9_MAP ? (ICD9_MAP[item.code] || []) : [];
      const icd9Html = icd9s.length > 0
        ? ` <span class="icd9-code">${escHtml(icd9s.join(', '))}</span>` : '';
      html += `<tr><td class="code-cell">${escHtml(item.code)}${icd9Html}</td><td class="en-cell">${escHtml(item.en)}</td><td class="zh-cell">${escHtml(item.zh)}</td></tr>`;
    }
  }
  return html;
}

// ---------------------------------------------------------------------------
// PCS Tab — search bar and category select
// ---------------------------------------------------------------------------
let pcsSearchQ = '';

function populatePcsCatSelect() {
  const sel = document.getElementById('pcs-cat-sel');
  if (!sel || !META) return;
  sel.innerHTML = '<option value="">全部分類</option>' +
    META.pcs_categories.map(c =>
      `<option value="${escHtml(c.id)}">${escHtml(c.icon)} ${escHtml(c.nameZh)}</option>`
    ).join('');
}

function pcsSelectCat(id) {
  activePcsCat = id || null;
  const detail = document.getElementById('pcs-detail');
  const grid = document.getElementById('pcs-cat-grid');
  const resultsAbove = document.getElementById('pcs-search-results');
  if (id) {
    openCat('pcs', id);
  } else {
    if (grid) grid.classList.remove('hidden');
    if (detail) detail.classList.add('hidden');
    if (resultsAbove) resultsAbove.classList.add('hidden');
    document.querySelectorAll('#pcs-cat-grid .cat-card').forEach(c => c.classList.remove('active'));
  }
}

function pcsSearch(q) {
  pcsSearchQ = q.trim();
  const grid = document.getElementById('pcs-cat-grid');
  const resultsAbove = document.getElementById('pcs-search-results');
  if (pcsSearchQ) {
    if (grid) grid.classList.add('search-overlay-active');
    if (resultsAbove) {
      resultsAbove.classList.remove('hidden');
      resultsAbove.innerHTML = buildPcsSearchResults(pcsSearchQ);
    }
  } else {
    if (grid) grid.classList.remove('search-overlay-active');
    if (resultsAbove) resultsAbove.classList.add('hidden');
  }
}

function buildPcsSearchResults(q) {
  const ql = q.toLowerCase();
  const results = [];
  for (const cat of META.pcs_categories) {
    if (cat.id === 'others') {
      if (pcsOthers) {
        for (const [c, z] of pcsOthers) {
          if (c.toLowerCase().includes(ql) || z.toLowerCase().includes(ql)) {
            results.push({ code: c, en: '', zh: z, catName: cat.nameZh });
            if (results.length >= 300) break;
          }
        }
      }
    } else {
      const data = pcsLoaded[cat.id];
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
    return `<div style="padding:24px;color:var(--muted);text-align:center">無符合「${escHtml(q)}」的 ICD-10-PCS 代碼（未載入的分類不在搜尋範圍）</div>`;
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
      <div class="detail-title">🔍 搜尋「${escHtml(q)}」— ICD-10-PCS</div>
    </div>
    <div class="codes-table-wrap" style="max-height:60vh">
      <table class="codes-table">
        <thead><tr><th>代碼</th><th>English</th><th>中文名稱</th><th>分類</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="row-count">找到 ${results.length} 筆${results.length >= 300 ? '（已截斷）' : ''}</div>`;
}

// ---------------------------------------------------------------------------
// Keyboard Shortcuts
// Shift+1…7 → jump to main tabs
// Tabs: edu(1), drug(2), ref(3), cm(4), nhi(5), specmat(6), ebm(7)
// Option/Alt + ↑/↓ → page up / page down
// Cmd/Ctrl + ↑/↓  → scroll to top / bottom of page
// ---------------------------------------------------------------------------
(function() {
  var TAB_SHORTCUTS = { '1': 'edu', '2': 'drug', '3': 'ref', '4': 'cm', '5': 'nhi', '6': 'specmat', '7': 'ebm' };
  document.addEventListener('keydown', function(e) {
    var tag = (document.activeElement || {}).tagName;
    var inInput = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');

    // Tab switching: Shift+1…7
    if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      var key = e.key;
      if (TAB_SHORTCUTS[key] && !inInput) {
        e.preventDefault();
        switchTab(TAB_SHORTCUTS[key]);
      }
      return;
    }

    // Page scroll shortcuts (ignore when typing)
    if (inInput) return;

    var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    var isAlt = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    var isCmdCtrl = (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey;

    // Option/Alt + ↓ → page down
    if (isAlt && e.key === 'ArrowDown') {
      e.preventDefault();
      window.scrollBy({ top: window.innerHeight * 0.85, behavior: 'smooth' });
    // Option/Alt + ↑ → page up
    } else if (isAlt && e.key === 'ArrowUp') {
      e.preventDefault();
      window.scrollBy({ top: -window.innerHeight * 0.85, behavior: 'smooth' });
    // Cmd/Ctrl + ↓ → scroll to bottom
    } else if (isCmdCtrl && e.key === 'ArrowDown') {
      e.preventDefault();
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    // Cmd/Ctrl + ↑ → scroll to top
    } else if (isCmdCtrl && e.key === 'ArrowUp') {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
})();

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
  // Apply color mode first (no-flash via inline script, but also here for JS access)
  applyColorMode();

  await boot();

  // Apply persisted settings
  applySettings();

  // Preload specialty categories in background (enables search without clicking)
  preloadSpecialtyCm();

  // Event delegation for edu-list (delete buttons)
  var eduListEl = document.getElementById('edu-list');
  if (eduListEl) {
    eduListEl.addEventListener('click', e => {
      const btn = e.target.closest('[data-action="delete-edu"]');
      if (btn) deleteEduLink(btn.dataset.id);
    });
  }

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
  renderEbmInlineHistory();
}

function clearEbmForm() {
  document.getElementById('ebm-content').value = '';
  document.getElementById('ebm-date').value = todayStr();
  document.getElementById('ebm-icd-cat').value = '';
}

function renderEbmInlineHistory() {
  var container = document.getElementById('ebm-inline-history');
  if (!container) return;
  var entries = storageGet(EBM_ENTRIES_KEY);
  if (entries.length === 0) {
    container.innerHTML = '<div class="inline-history-empty">尚無 EBM 筆記記錄</div>';
    return;
  }
  container.innerHTML = entries.slice(0, 10).map(function(e) {
    var preview = e.content.substring(0, 120).replace(/\n/g, ' ');
    if (e.content.length > 120) preview += '…';
    return `<div class="inline-history-item">
      <div class="inline-history-meta">
        <span class="inline-history-date">${escHtml(e.date)}</span>
        ${e.icdCat ? `<span class="inline-history-cat">${escHtml(e.icdCat)}</span>` : ''}
      </div>
      <div class="inline-history-preview">${escHtml(preview)}</div>
      <div class="inline-history-actions">
        <button class="btn-xs" onclick="loadEbmFromHistory('${escHtml(e.id)}')">📥 載入</button>
      </div>
    </div>`;
  }).join('');
}

function loadEbmFromHistory(id) {
  var entries = storageGet(EBM_ENTRIES_KEY);
  var entry = entries.find(function(e) { return e.id === id; });
  if (!entry) return;
  document.getElementById('ebm-date').value = entry.date;
  if (entry.icdCat) document.getElementById('ebm-icd-cat').value = entry.icdCat;
  document.getElementById('ebm-content').value = entry.content;
  document.getElementById('ebm-content').scrollIntoView({ behavior: 'smooth' });
  toast('📥 EBM 筆記已載入');
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
  renderSoapInlineHistory();
}

function clearSoapForm() {
  document.getElementById('soap-content').value = DEFAULT_SOAP;
  document.getElementById('soap-date').value = todayStr();
}

function renderSoapInlineHistory() {
  var container = document.getElementById('soap-inline-history');
  if (!container) return;
  var entries = storageGet(SOAP_ENTRIES_KEY);
  if (entries.length === 0) {
    container.innerHTML = '<div class="inline-history-empty">尚無 SOAP 病歷記錄</div>';
    return;
  }
  container.innerHTML = entries.slice(0, 10).map(function(e) {
    var preview = e.content.substring(0, 120).replace(/\n/g, ' ');
    if (e.content.length > 120) preview += '…';
    return `<div class="inline-history-item">
      <div class="inline-history-meta">
        <span class="inline-history-date">${escHtml(e.date)}</span>
      </div>
      <div class="inline-history-preview">${escHtml(preview)}</div>
      <div class="inline-history-actions">
        <button class="btn-xs" onclick="loadSoapFromHistory('${escHtml(e.id)}')">📥 載入</button>
      </div>
    </div>`;
  }).join('');
}

function loadSoapFromHistory(id) {
  var entries = storageGet(SOAP_ENTRIES_KEY);
  var entry = entries.find(function(e) { return e.id === id; });
  if (!entry) return;
  document.getElementById('soap-date').value = entry.date;
  document.getElementById('soap-content').value = entry.content;
  document.getElementById('soap-content').scrollIntoView({ behavior: 'smooth' });
  toast('📥 SOAP 病歷已載入');
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
let nhiLevelFilter = '';   // Filter by 適用層級

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
  if (!NHI_DATA) {
    initNhiTab().then(function() { applyNhiPtsVisibility(); });
  } else {
    applyNhiPtsVisibility();
  }
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
  var wrap = document.getElementById('nhi-table-wrap');
  wrap.classList.remove('hidden');
  nhiRender();
  wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  if (nhiLevelFilter) {
    codes = codes.filter(function(r) {
      return r.available && r.available[nhiLevelFilter] === true;
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

function nhiTogglePts() {
  var show = document.getElementById('nhi-show-pts').checked;
  var settings = getSettings();
  settings.showNhiPoints = show;
  saveSettings(settings);
  applyNhiPtsVisibility();
}

function applyNhiPtsVisibility() {
  var show = getSettings().showNhiPoints;
  var tbl = document.getElementById('nhi-table');
  if (tbl) tbl.classList.toggle('nhi-pts-hidden', !show);
  var el = document.getElementById('nhi-show-pts');
  if (el) el.checked = show;
}

function nhiBackToGrid() {
  nhiActiveCat = null;
  nhiSearchQ = '';
  document.getElementById('nhi-search').value = '';
  document.getElementById('nhi-cat-sel').value = '';
  document.getElementById('nhi-cat-grid').classList.remove('hidden');
  document.getElementById('nhi-table-wrap').classList.add('hidden');
}

function nhiFilterLevel(level) {
  nhiLevelFilter = level;
  if (nhiActiveCat || nhiSearchQ) {
    nhiRender();
  }
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
  } else if (type === 'cm') {
    var inp = document.getElementById('cm-search');
    if (inp) { inp.value = query; cmSearch(query); }
  } else if (type === 'specmat') {
    var inp = document.getElementById('specmat-search');
    if (inp) { inp.value = query; specmatSearch(query); }
  }
  hideSearchHistory(type, 0);
}

// Close all search history dropdowns when clicking outside
document.addEventListener('click', function(e) {
  var types = ['cm', 'nhi', 'drug', 'specmat'];
  types.forEach(function(type) {
    var dropdown = document.getElementById(type + '-search-history');
    if (!dropdown || !dropdown.classList.contains('open')) return;
    var input = document.getElementById(type + '-search');
    if (!dropdown.contains(e.target) && e.target !== input) {
      dropdown.classList.remove('open');
    }
  });
});

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
  var wrap = document.getElementById('drug-list-wrap');
  wrap.classList.remove('hidden');
  drugRender();
  wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function drugSearch(q) {
  drugSearchQ = q.trim();
  if (drugSearchQ.length >= 2) {
    saveSearchHistory('drug', drugSearchQ);
  }
  var grid = document.getElementById('drug-cat-grid');
  var tagFilter = document.getElementById('drug-tag-filter');
  var searchResults = document.getElementById('drug-search-results');
  var listWrap = document.getElementById('drug-list-wrap');

  if (drugSearchQ) {
    if (grid) grid.classList.add('search-overlay-active');
    if (tagFilter) tagFilter.classList.add('search-overlay-active');
    if (!drugActiveCat) {
      // Global search: show results ABOVE the category grid
      if (grid) grid.classList.add('hidden');
      if (listWrap) listWrap.classList.add('hidden');
      if (searchResults) {
        searchResults.classList.remove('hidden');
        searchResults.innerHTML = buildDrugSearchResultsHtml(drugSearchQ);
      }
      return;
    }
    // Category + search: render in drug-list-wrap as before
    if (searchResults) searchResults.classList.add('hidden');
    if (listWrap) listWrap.classList.remove('hidden');
  } else {
    if (grid) grid.classList.remove('search-overlay-active', 'hidden');
    if (tagFilter) tagFilter.classList.remove('search-overlay-active');
    if (searchResults) searchResults.classList.add('hidden');
    if (!drugActiveCat) {
      if (listWrap) listWrap.classList.add('hidden');
      return;
    }
    if (listWrap) listWrap.classList.remove('hidden');
  }
  drugRender();
}

function buildDrugSearchResultsHtml(q) {
  var entries = drugGetFilteredEntries();
  if (entries.length === 0) {
    return `<div style="padding:24px;color:var(--muted);text-align:center">無符合「${escHtml(q)}」的藥品</div>`;
  }
  var header = `<div class="detail-header">
    <div class="detail-title">🔍 搜尋「${escHtml(q)}」— 共 ${entries.length} 項</div>
  </div>`;
  var items = entries.map(function(e) {
    if (e.isGroup) {
      return `<div class="drug-group-header"><span class="drug-group-id">${escHtml(e.id)}</span><span class="drug-group-name">${escHtml(e.name)}</span></div>`;
    }
    var rulePreview = (e.content || '').substring(0, 120);
    if ((e.content || '').length > 120) rulePreview += '…';
    var catBadge = e._cat ? `<span style="font-size:.68rem;color:var(--muted);margin-left:4px">${escHtml(e._cat)}</span>` : '';
    return `<div class="drug-entry specmat-search-result" style="cursor:pointer" onclick="drugOpenCat('${escHtml(e._catId || '')}')">
      <div class="specmat-result-header">
        <span class="drug-entry-id">${escHtml(e.id)}</span>
        <span class="drug-entry-name">${escHtml(e.name)}</span>${catBadge}
      </div>
      ${rulePreview ? `<div class="specmat-result-rule">${escHtml(rulePreview)}</div>` : ''}
    </div>`;
  }).join('');
  return header + '<div style="padding:0 8px 8px">' + items + '</div>';
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
      // Render group title headers (not tappable)
      if (e.isGroup) {
        var groupDiv = document.createElement('div');
        groupDiv.className = 'drug-group-header';
        var groupId = document.createElement('span');
        groupId.className = 'drug-group-id';
        groupId.textContent = e.id;
        var groupName = document.createElement('span');
        groupName.className = 'drug-group-name';
        if (e._cat) {
          var catBadge = document.createElement('span');
          catBadge.style.cssText = 'font-size:.68rem;color:var(--muted);margin-right:6px';
          catBadge.textContent = e._cat;
          groupName.appendChild(catBadge);
        }
        groupName.appendChild(document.createTextNode(e.name));
        groupDiv.appendChild(groupId);
        groupDiv.appendChild(groupName);
        entriesEl.appendChild(groupDiv);
        return;
      }

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

      headerDiv.appendChild(idSpan);
      headerDiv.appendChild(nameSpan);
      headerDiv.appendChild(tagsSpan);

      var contentDiv = document.createElement('div');
      contentDiv.className = 'drug-entry-content';

      // Only add expand functionality if there's content
      if (e.content) {
        var chevronSpan = document.createElement('span');
        chevronSpan.className = 'drug-entry-chevron';
        chevronSpan.textContent = '▶';
        headerDiv.appendChild(chevronSpan);
        contentDiv.textContent = e.content;
        headerDiv.addEventListener('click', function() {
          entryDiv.classList.toggle('open');
        });
      }

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
  if (sel) sel.value = '';
  var grid = document.getElementById('drug-cat-grid');
  if (grid) grid.classList.remove('hidden', 'search-overlay-active');
  var tagFilter = document.getElementById('drug-tag-filter');
  if (tagFilter) tagFilter.classList.remove('search-overlay-active');
  var searchResults = document.getElementById('drug-search-results');
  if (searchResults) { searchResults.classList.add('hidden'); searchResults.innerHTML = ''; }
  document.getElementById('drug-list-wrap').classList.add('hidden');
}
// ===========================================================================

// ===========================================================================
// Special Materials Tab (特材給付)
// ===========================================================================
var specmatData = null;
var specmatActiveCat = null;
var specmatSearchQ = '';

function initSpecmatTab() {
  // Data will be loaded when the tab is first opened
}

function specmatOnTabShow() {
  if (!specmatData) {
    loadSpecmatData();
  }
}

async function loadSpecmatData() {
  var grid = document.getElementById('specmat-cat-grid');
  if (grid) grid.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted)">載入中…</div>';
  try {
    specmatData = await fetchJson(BASE + 'data/nhi/special_materials.json');
    renderSpecmatGrid();
    populateSpecmatCatSelect();
  } catch(e) {
    if (grid) grid.innerHTML = '<p style="color:var(--red);padding:20px">⚠️ 載入特材資料失敗</p>';
  }
}

function renderSpecmatGrid() {
  var grid = document.getElementById('specmat-cat-grid');
  if (!grid || !specmatData) return;
  grid.innerHTML = specmatData.categories.map(function(cat) {
    return `<div class="cat-card" onclick="specmatOpenCat('${escHtml(cat.id)}')">
      <div class="cat-icon">${escHtml(cat.icon)}</div>
      <div class="cat-name-en">${escHtml(cat.nameEn)}</div>
      <div class="cat-name-zh">${escHtml(cat.nameZh)}</div>
      <div class="cat-range"></div>
      <div class="cat-count"><span class="count-badge">${cat.totalEntries} items</span></div>
    </div>`;
  }).join('');
}

function populateSpecmatCatSelect() {
  var sel = document.getElementById('specmat-cat-sel');
  if (!sel || !specmatData) return;
  sel.innerHTML = '<option value="">全部分類</option>' +
    specmatData.categories.map(function(c) {
      return `<option value="${escHtml(c.id)}">${escHtml(c.icon)} ${escHtml(c.nameZh)}</option>`;
    }).join('');
}

function specmatSelectCat(id) {
  specmatActiveCat = id || null;
  if (id) {
    specmatOpenCat(id);
  } else {
    var grid = document.getElementById('specmat-cat-grid');
    if (grid) grid.classList.remove('hidden');
    document.getElementById('specmat-list-wrap').classList.add('hidden');
    var searchResults = document.getElementById('specmat-search-results');
    if (searchResults) searchResults.classList.add('hidden');
  }
}

function specmatOpenCat(catId) {
  if (!specmatData) return;
  var cat = specmatData.categories.find(function(c) { return c.id === catId; });
  if (!cat) return;
  specmatActiveCat = catId;
  var grid = document.getElementById('specmat-cat-grid');
  if (grid) grid.classList.add('hidden');
  var wrap = document.getElementById('specmat-list-wrap');
  var header = document.getElementById('specmat-list-header');
  var entriesEl = document.getElementById('specmat-entries');
  wrap.classList.remove('hidden');
  header.innerHTML = `<button class="btn-drug-back" onclick="specmatBackToGrid()">← 返回</button>
    <span class="drug-list-title">${escHtml(cat.icon)} ${escHtml(cat.nameZh)}</span>
    <span class="drug-list-count">${cat.totalEntries} 項</span>`;
  entriesEl.innerHTML = '';
  cat.entries.forEach(function(e) {
    var entryDiv = document.createElement('div');
    entryDiv.className = 'drug-entry specmat-entry';

    var headerDiv = document.createElement('div');
    headerDiv.className = 'drug-entry-header';

    var idSpan = document.createElement('span');
    idSpan.className = 'drug-entry-id';
    idSpan.textContent = e.id;

    var nameSpan = document.createElement('span');
    nameSpan.className = 'drug-entry-name';
    nameSpan.textContent = e.name;

    var dateBadge = document.createElement('span');
    dateBadge.className = 'specmat-date-badge';
    dateBadge.textContent = e.startDate;

    headerDiv.appendChild(idSpan);
    headerDiv.appendChild(nameSpan);
    headerDiv.appendChild(dateBadge);

    var contentDiv = document.createElement('div');
    contentDiv.className = 'drug-entry-content';

    if (e.rule) {
      var chevronSpan = document.createElement('span');
      chevronSpan.className = 'drug-entry-chevron';
      chevronSpan.textContent = '▶';
      headerDiv.appendChild(chevronSpan);
      contentDiv.textContent = e.rule;
      headerDiv.addEventListener('click', function() { entryDiv.classList.toggle('open'); });
    }

    entryDiv.appendChild(headerDiv);
    entryDiv.appendChild(contentDiv);
    entriesEl.appendChild(entryDiv);
  });
}

function specmatBackToGrid() {
  specmatActiveCat = null;
  specmatSearchQ = '';
  var inp = document.getElementById('specmat-search');
  if (inp) inp.value = '';
  var grid = document.getElementById('specmat-cat-grid');
  if (grid) grid.classList.remove('hidden', 'search-overlay-active');
  var searchResults = document.getElementById('specmat-search-results');
  if (searchResults) searchResults.classList.add('hidden');
  document.getElementById('specmat-list-wrap').classList.add('hidden');
}

function specmatSearch(q) {
  specmatSearchQ = q.trim();
  if (specmatSearchQ.length >= 2) {
    saveSearchHistory('specmat', specmatSearchQ);
  }
  if (!specmatData) return;
  var grid = document.getElementById('specmat-cat-grid');
  var searchResults = document.getElementById('specmat-search-results');
  if (specmatSearchQ) {
    if (grid) grid.classList.add('search-overlay-active');
    if (searchResults) {
      searchResults.classList.remove('hidden');
      searchResults.innerHTML = buildSpecmatSearchResults(specmatSearchQ);
    }
  } else {
    if (grid) grid.classList.remove('search-overlay-active');
    if (searchResults) searchResults.classList.add('hidden');
  }
}

function buildSpecmatSearchResults(q) {
  var ql = q.toLowerCase();
  var results = [];
  specmatData.categories.forEach(function(cat) {
    cat.entries.forEach(function(e) {
      if ((e.name || '').toLowerCase().includes(ql) ||
          (e.rule || '').toLowerCase().includes(ql) ||
          (e.id || '').toLowerCase().includes(ql)) {
        results.push({ catName: cat.nameZh, catIcon: cat.icon, entry: e });
        if (results.length >= 200) return;
      }
    });
  });
  if (results.length === 0) {
    return `<div style="padding:24px;color:var(--muted);text-align:center">無符合「${escHtml(q)}」的特材</div>`;
  }
  var html = `<div class="detail-header"><div class="detail-title">🔍 搜尋「${escHtml(q)}」— 特材給付規定</div></div>`;
  results.forEach(function(r) {
    var e = r.entry;
    var rulePreview = (e.rule || '').substring(0, 150);
    if (e.rule && e.rule.length > 150) rulePreview += '…';
    html += `<div class="specmat-search-result">
      <div class="specmat-result-header">
        <span class="drug-entry-id">${escHtml(e.id)}</span>
        <span class="drug-entry-name">${escHtml(e.name)}</span>
        <span class="specmat-cat-badge">${escHtml(r.catIcon)} ${escHtml(r.catName)}</span>
      </div>
      ${rulePreview ? `<div class="specmat-result-rule">${escHtml(rulePreview)}</div>` : ''}
    </div>`;
  });
  html += `<div class="row-count">找到 ${results.length} 筆${results.length >= 200 ? '（已截斷）' : ''}</div>`;
  return html;
}
// ===========================================================================

// ===========================================================================
// Settings management
// ===========================================================================
const SETTINGS_KEY = 'phcep_settings';

function getSettings() {
  return storageGet(SETTINGS_KEY, { showPcs: false, showNhiPoints: false });
}

function saveSettings(settings) {
  storageSet(SETTINGS_KEY, settings);
}

function applySettings() {
  var settings = getSettings();

  // PCS tab visibility
  var pcsBtns = document.querySelectorAll('[data-tab="pcs"]');
  pcsBtns.forEach(function(btn) {
    btn.style.display = settings.showPcs ? '' : 'none';
  });
  // If PCS tab was active and now hidden, switch to edu
  var activePcsTab = document.querySelector('[data-tab="pcs"].active');
  if (!settings.showPcs && activePcsTab) {
    switchTab('edu');
  }

  // NHI points column visibility
  applyNhiPtsVisibility();
}

// ===========================================================================
// Color mode (dark / light)
// ===========================================================================
function applyColorMode() {
  var mode = localStorage.getItem('phcep_color_mode') || 'dark';
  document.documentElement.classList.toggle('light-mode', mode === 'light');
  var btn = document.getElementById('btn-color-mode');
  if (btn) btn.textContent = mode === 'light' ? '🌙' : '☀️';
}

function toggleColorMode() {
  var current = localStorage.getItem('phcep_color_mode') || 'dark';
  var next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem('phcep_color_mode', next);
  applyColorMode();
}

// ===========================================================================
// Settings Tab Renderer
// ===========================================================================
function renderSettingsTab() {
  var container = document.getElementById('settings-content');
  if (!container) return;
  var settings = getSettings();
  var mode = localStorage.getItem('phcep_color_mode') || 'dark';

  container.innerHTML = `
    <div class="settings-group">
      <div class="settings-group-title">🎨 外觀</div>
      <label class="settings-item">
        <div class="settings-item-label">
          <div class="settings-item-name">顯示模式</div>
          <div class="settings-item-desc">深色或淺色背景</div>
        </div>
        <button class="btn-settings-mode" onclick="toggleColorMode(); renderSettingsTab();">
          ${mode === 'dark' ? '🌙 深色模式（點擊切換淺色）' : '☀️ 淺色模式（點擊切換深色）'}
        </button>
      </label>
    </div>

    <div class="settings-group">
      <div class="settings-group-title">📋 標籤頁顯示</div>
      <label class="settings-item">
        <div class="settings-item-label">
          <div class="settings-item-name">顯示 ICD-10-PCS 標籤頁</div>
          <div class="settings-item-desc">ICD-10-PCS（手術處置）標籤頁，預設隱藏</div>
        </div>
        <input type="checkbox" class="settings-toggle" id="setting-show-pcs"
          ${settings.showPcs ? 'checked' : ''}
          onchange="onSettingShowPcs(this.checked)" />
      </label>
    </div>

    <div class="settings-group">
      <div class="settings-group-title">🏥 NHI 支付標準</div>
      <label class="settings-item">
        <div class="settings-item-label">
          <div class="settings-item-name">顯示支付點數欄位</div>
          <div class="settings-item-desc">在 NHI 支付標準表格中顯示支付點數，預設隱藏</div>
        </div>
        <input type="checkbox" class="settings-toggle" id="setting-show-nhi-pts"
          ${settings.showNhiPoints ? 'checked' : ''}
          onchange="onSettingShowNhiPts(this.checked)" />
      </label>
    </div>

    <div class="settings-group">
      <div class="settings-group-title">⌨️ 快速鍵說明</div>
      <div class="settings-shortcuts">
        <div class="shortcut-row"><kbd>Shift+1</kbd> 衛教資源</div>
        <div class="shortcut-row"><kbd>Shift+2</kbd> 藥品給付規定</div>
        <div class="shortcut-row"><kbd>Shift+3</kbd> 參考資料</div>
        <div class="shortcut-row"><kbd>Shift+4</kbd> ICD-10-CM</div>
        <div class="shortcut-row"><kbd>Shift+5</kbd> NHI支付標準</div>
        <div class="shortcut-row"><kbd>Shift+6</kbd> 特材給付</div>
        <div class="shortcut-row"><kbd>Shift+7</kbd> EBM筆記</div>
        <div class="shortcut-row"><kbd class="key-combo">Option/Alt + ↑</kbd> 向上翻頁</div>
        <div class="shortcut-row"><kbd class="key-combo">Option/Alt + ↓</kbd> 向下翻頁</div>
        <div class="shortcut-row"><kbd class="key-combo">Cmd/Ctrl + ↑</kbd> 回到頁頂</div>
        <div class="shortcut-row"><kbd class="key-combo">Cmd/Ctrl + ↓</kbd> 前往頁底</div>
      </div>
    </div>`;
}

function onSettingShowPcs(checked) {
  var settings = getSettings();
  settings.showPcs = checked;
  saveSettings(settings);
  applySettings();
}

function onSettingShowNhiPts(checked) {
  var settings = getSettings();
  settings.showNhiPoints = checked;
  saveSettings(settings);
  var cb = document.getElementById('nhi-show-pts');
  if (cb) cb.checked = checked;
  applyNhiPtsVisibility();
}
// ===========================================================================

