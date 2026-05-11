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
    initEduTab();
    initNhiTab();
    initDrugTab();
    initSpecmatTab();
    renderFrequentUsed('cm');
    renderFrequentUsed('nhi');
    renderFrequentUsed('drug');
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
  scheduleSearchHistorySave('cm', cmSearchQ);
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

function findCmCodeItem(code) {
  if (!code || !META) return null;
  for (var i = 0; i < META.cm_categories.length; i++) {
    var cat = META.cm_categories[i];
    if (cat.id === 'others') {
      if (cmOthers) {
        for (var j = 0; j < cmOthers.length; j++) {
          if (cmOthers[j][0] === code) {
            return { code: code, zh: cmOthers[j][1] || '', en: '' };
          }
        }
      }
    } else {
      var data = cmLoaded[cat.id];
      if (!data || !data.codes) continue;
      for (var k = 0; k < data.codes.length; k++) {
        if (data.codes[k].code === code) {
          return { code: code, en: data.codes[k].en || '', zh: data.codes[k].zh || '' };
        }
      }
    }
  }
  return null;
}

function rememberCmCode(code) {
  var item = findCmCodeItem(code);
  if (!item) return;
  rememberFrequentUsed('cm', item, item.code);
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
    <tr onclick="rememberCmCode('${escHtml(r.code)}')">
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
  const rows = buildGroupedRows(pageItems, isCompactMode, type);

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

function buildGroupedRows(items, isCompact, type) {
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
      var compactOnclick = type === 'cm' ? ` onclick="rememberCmCode('${escHtml(item.code)}')"` : '';
      html += `<tr${compactOnclick}><td class="code-cell">${escHtml(item.code)}</td><td class="zh-cell">${escHtml(item.zh)}</td></tr>`;
    } else {
      // Show ICD-9 code if available
      const icd9s = ICD9_MAP ? (ICD9_MAP[item.code] || []) : [];
      const icd9Html = icd9s.length > 0
        ? ` <span class="icd9-code">${escHtml(icd9s.join(', '))}</span>` : '';
      var rowOnclick = type === 'cm' ? ` onclick="rememberCmCode('${escHtml(item.code)}')"` : '';
      html += `<tr${rowOnclick}><td class="code-cell">${escHtml(item.code)}${icd9Html}</td><td class="en-cell">${escHtml(item.en)}</td><td class="zh-cell">${escHtml(item.zh)}</td></tr>`;
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
// Alt/Option+1…7 → jump to main tabs
// Tabs: edu(1), drug(2), ref(3), cm(4), nhi(5), specmat(6), workflow(7)
// Shift+9 → 歷史記錄, Shift+0 → 治療流程, Shift+- → 設定
// Option/Alt + ↑/↓ → page up / page down
// Cmd/Ctrl + ↑/↓  → scroll to top / bottom of page
// ---------------------------------------------------------------------------
(function() {
  var TAB_SHORTCUTS = { '1': 'edu', '2': 'drug', '3': 'ref', '4': 'cm', '5': 'nhi', '6': 'specmat', '7': 'workflow' };
  var SHIFT_SHORTCUTS = { 'Digit9': 'history', 'Digit0': 'workflow', 'Minus': 'settings' };
  document.addEventListener('keydown', function(e) {
    var tag = (document.activeElement || {}).tagName;
    var inInput = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');

    var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    var isAlt = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    var isCmdCtrl = (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey;
    var isShift = e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;

    // Tab switching: Alt/Option + 1…8 (works even when an input is focused)
    if (isAlt) {
      var digit = e.code && e.code.startsWith('Digit') ? e.code.slice(5) : null;
      if (digit && TAB_SHORTCUTS[digit]) {
        e.preventDefault();
        switchTab(TAB_SHORTCUTS[digit]);
        return;
      }
    }

    // Tab switching: Shift + 9 / 0 / - (works even when an input is focused)
    if (isShift && e.code && SHIFT_SHORTCUTS[e.code]) {
      e.preventDefault();
      switchTab(SHIFT_SHORTCUTS[e.code]);
      return;
    }

    // Page scroll shortcuts (ignore when typing in an input)
    if (inInput) return;

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

const FREQUENT_USED_MAX = 50;

function frequentUsedKey(type) {
  return 'phcep_frequent_used_' + type;
}

function getFrequentUsed(type) {
  return storageGet(frequentUsedKey(type), []);
}

function saveFrequentUsed(type, items) {
  storageSet(frequentUsedKey(type), (items || []).slice(0, FREQUENT_USED_MAX));
}

function rememberFrequentUsed(type, item, idKey) {
  if (!item || !idKey) return;
  var list = getFrequentUsed(type).filter(function(x) { return x._idKey !== idKey; });
  list.unshift(Object.assign({}, item, { _idKey: idKey }));
  saveFrequentUsed(type, list);
  renderFrequentUsed(type);
}

function renderFrequentUsed(type) {
  var wrap = document.getElementById(type + '-frequent-wrap');
  if (!wrap) return;
  var list = getFrequentUsed(type);
  if (!list.length) {
    wrap.innerHTML = '';
    wrap.classList.add('hidden');
    return;
  }
  var title = type === 'cm' ? 'Frequent used ICD10'
    : (type === 'nhi' ? 'Frequent used 支付代碼' : 'Frequent used 藥品');
  wrap.classList.remove('hidden');
  wrap.innerHTML = `
    <div class="frequent-used-inner">
      <div class="frequent-used-title">${escHtml(title)}</div>
      <div class="frequent-used-chips">
        ${list.map(function(item, idx) {
          var text = item.code
            ? (item.code + ' ' + (item.name || item.zh || ''))
            : (item.id + ' ' + (item.name || ''));
          return `<button class="frequent-used-chip" onclick="applyFrequentUsed('${escHtml(type)}',${idx})">${escHtml(text.trim())}</button>`;
        }).join('')}
      </div>
    </div>`;
}

function applyFrequentUsed(type, idx) {
  var list = getFrequentUsed(type);
  var item = list[idx];
  if (!item) return;
  if (type === 'cm') {
    var cmInp = document.getElementById('cm-search');
    if (cmInp) cmInp.value = item.code || '';
    cmSearch(item.code || '');
  } else if (type === 'nhi') {
    var nhiInp = document.getElementById('nhi-search');
    if (nhiInp) nhiInp.value = item.code || '';
    nhiSearch(item.code || '');
  } else if (type === 'drug') {
    var drugInp = document.getElementById('drug-search');
    var q = item.id || item.name || '';
    if (drugInp) drugInp.value = q;
    drugSearch(q);
  }
}

// ---------------------------------------------------------------------------
// Patient Education (衛教資源) — FastSR-powered Search Platform
// ---------------------------------------------------------------------------

// FastSR SOAP keyword tables (inspired by EBM-NLP PICO → clinical SOAP mapping)
const FASTSR_KEYWORDS = {
  S: {
    zh: ['症狀','主訴','感覺','疼痛','患者','病人','病史','不適','不舒服','發燒','頭痛',
         '噁心','嘔吐','出血','腫脹','麻木','刺痛','無力','疲勞','呼吸困難','胸悶','心悸',
         '背景','適應症','適合','對象','若您','如果您','主要症狀','症','痛','癢','腫',
         '酸痛','疼','抱怨','受傷','扭傷','撕裂','拉傷','骨折'],
    en: ['symptom','complaint','feel','pain','discomfort','history','present','chief complaint',
         'subjective','nausea','vomit','fever','headache','swelling','numbness','weakness',
         'fatigue','dyspnea','indication','candidate','suffer','report','complain','notice',
         'experience','strain','sprain','fracture','injury']
  },
  O: {
    zh: ['檢查','測量','理學','發現','超音波','MRI','X光','CT','核磁共振','血液','影像',
         '數值','角度','活動度','壓痛','徵候','客觀','驗血','切片','度','°','陽性','陰性',
         '指數','比例','追蹤','例','個案','統計','發生率','臨床數據','改善','結果'],
    en: ['examination','finding','sign','measure','ultrasound','MRI','CT','x-ray','range of motion',
         'blood test','objective','physical','test','score','positive','negative','rate','degree',
         'percent','cases','study','result','data','statistic','trial','outcome']
  },
  A: {
    zh: ['診斷','可能','評估','考慮','鑑別','分析','因此','代表','判斷','機轉','病理',
         '原因','懷疑','歸因','相關','合併','病症','疾病','損傷','炎症','症候群','綜合症',
         '沾黏','退化','韌帶','撕裂','炎'],
    en: ['diagnosis','assessment','consider','likely','differential','mechanism','pathology',
         'cause','etiology','condition','disorder','disease','syndrome','injury','lesion',
         'damage','torn','rupture','capsulitis','adhesion','degeneration']
  },
  P: {
    zh: ['治療','建議','藥物','手術','復健','計畫','管理','處置','注射','物理治療','護理',
         '康復','預防','衛教','飲食','運動','休息','服藥','回診','追蹤','照護','步驟',
         '方法','技術','原則','注意','禁忌','避免','應','需','進行','操作','施術'],
    en: ['treatment','recommend','plan','therapy','surgery','medication','rehabilitation',
         'management','inject','physical therapy','exercise','rest','follow','care','prescribe',
         'protocol','step','procedure','avoid','should','apply','perform','manipulation',
         'block','RICE']
  }
};

let eduData = [];
let eduSearchMode = 'all';
let eduCurrentEntry = null;
let eduCurrentVersion = 'simple_zh';
let eduDefaultVersion = 'simple_zh';
var EDU_ARTICLE_SCALE_LEVELS = [50, 75, 100, 125, 150];
var eduArticleScaleIndex = 2;

function initEduTab() {
  eduInitArticleSizeControls();
  loadEduData();
}

function eduInitArticleSizeControls() {
  var decBtn = document.getElementById('edu-article-size-dec');
  var incBtn = document.getElementById('edu-article-size-inc');
  if (!decBtn || !incBtn || decBtn.dataset.bound === '1') {
    eduSyncArticleSizeLabel();
    return;
  }
  decBtn.dataset.bound = '1';
  incBtn.dataset.bound = '1';
  var stored = Number(localStorage.getItem('phcep_edu_article_scale_index'));
  if (Number.isFinite(stored)) {
    eduArticleScaleIndex = Math.max(0, Math.min(EDU_ARTICLE_SCALE_LEVELS.length - 1, Math.round(stored)));
  }
  decBtn.addEventListener('click', function() { eduSetArticleSizeIndex(eduArticleScaleIndex - 1); });
  incBtn.addEventListener('click', function() { eduSetArticleSizeIndex(eduArticleScaleIndex + 1); });
  eduSyncArticleSizeLabel();
}

function eduSetArticleSizeIndex(nextIndex) {
  eduArticleScaleIndex = Math.max(0, Math.min(EDU_ARTICLE_SCALE_LEVELS.length - 1, Number(nextIndex) || 0));
  localStorage.setItem('phcep_edu_article_scale_index', String(eduArticleScaleIndex));
  eduSyncArticleSizeLabel();
  var content = document.getElementById('edu-viewer-content');
  if (content) eduApplyArticleScale(content);
}

function eduSyncArticleSizeLabel() {
  var label = document.getElementById('edu-article-size-label');
  if (!label) return;
  label.textContent = String(EDU_ARTICLE_SCALE_LEVELS[eduArticleScaleIndex] || 100) + '%';
}

function eduApplyArticleScale(content) {
  if (!content) return;
  var pct = EDU_ARTICLE_SCALE_LEVELS[eduArticleScaleIndex] || 100;
  content.classList.remove('edu-article-scale-50', 'edu-article-scale-75', 'edu-article-scale-100', 'edu-article-scale-125', 'edu-article-scale-150');
  content.classList.add('edu-article-scale-' + pct);
  content.style.zoom = String(pct / 100);
}

async function loadEduData() {
  const list = document.getElementById('edu-list');
  if (list) list.innerHTML = '<p style="padding:20px;text-align:center;color:var(--muted)">載入中…</p>';
  try {
    const jsonData = await fetchJson(BASE + 'data/edu/patient_edu_data.json');
    // Support v2 (entries) and legacy v1 (files)
    const baseEntries = jsonData.entries
      ? jsonData.entries
      : (jsonData.files || []).map(eduConvertV1);
    const localEntries = eduCleanupPoorEntries();
    eduData = [...baseEntries, ...localEntries];
  } catch (e) {
    console.error('edu data load failed:', e);
    eduData = eduCleanupPoorEntries();
  }
  eduRenderList();
}

/**
 * Remove locally-stored EBM-generated entries whose content has no HTML structure
 * (plain-text articles from before the structured formatter was introduced).
 * Returns the cleaned local-entries array.
 */
function eduCleanupPoorEntries() {
  var locals = eduLoadLocal();
  var before = locals.length;
  var htmlTagRe = /<[a-zA-Z]/;
  locals = locals.filter(function(e) {
    if (!e._from_ebm) return true; // keep manually-added entries
    var v = e.versions || {};
    // Plain-text entry: none of the versions contain any HTML tag
    var hasHtml = htmlTagRe.test(v.simple_zh || '') || htmlTagRe.test(v.professional_zh || '') || htmlTagRe.test(v.english || '');
    return hasHtml;
  });
  if (locals.length < before) {
    eduSaveLocal(locals);
    console.log('[PHCEP] Removed ' + (before - locals.length) + ' poorly-formatted EBM article(s) from localStorage');
  }
  return locals;
}

function eduConvertV1(file) {
  return {
    id: file.id || ('edu_' + Math.random().toString(36).substr(2, 8)),
    title: file.title || file.filename || '未命名',
    source_url: '', source_label: '', original_lang: 'zh-TW', added_date: '',
    tags: [],
    fastsr: { S: [], O: [], A: [], P: [] },
    versions: {
      simple_zh: file.htmlContent || '',
      professional_zh: file.htmlContent || '',
      english: ''
    }
  };
}

function eduLoadLocal() {
  try { return JSON.parse(localStorage.getItem('phcep_edu_entries_v1') || '[]'); }
  catch (e) { return []; }
}

function eduSaveLocal(entries) {
  localStorage.setItem('phcep_edu_entries_v1', JSON.stringify(entries));
}

// ---------------------------------------------------------------------------
// Render list view
// ---------------------------------------------------------------------------
function eduRenderList() {
  var list = document.getElementById('edu-list');
  if (!list) return;
  var query = ((document.getElementById('edu-search') || {}).value || '').trim();

  var results;
  if (query) {
    results = eduScoreAll(query);
    // filter out zero-score if query present
    var scored = results.filter(r => r.score > 0);
    results = scored.length ? scored : results;
  } else {
    results = eduData.map(function(e) { return { entry: e, score: 0, protoScores: { global: 0, semantic: 0, fragment: 0 }, sectionScores: { S: 0, O: 0, A: 0, P: 0 } }; });
  }

  if (results.length === 0) {
    list.innerHTML = '<p class="empty-msg" style="padding:24px;text-align:center;color:var(--muted)">尚無衛教資源</p>';
    return;
  }

  list.innerHTML = '';
  results.forEach(function({ entry, score, protoScores, sectionScores }) {
    var card = document.createElement('div');
    card.className = 'edu-entry-card';

    // Score badge
    var scoreBadge = query
      ? `<span class="edu-score-badge">${score}%</span>` : '';

    // ── FastSR Prototype breakdown bar (G + S + F = 100%) ──────────────────
    var protoHtml = '';
    if (query) {
      var gp = protoScores.global, sp = protoScores.semantic, fp = protoScores.fragment;
      protoHtml = `
        <div class="edu-proto-bar" title="Global ${gp}% · Semantic ${sp}% · Fragment ${fp}%">
          <span class="edu-proto-seg edu-proto-g" style="width:${gp}%"></span>
          <span class="edu-proto-seg edu-proto-s" style="width:${sp}%"></span>
          <span class="edu-proto-seg edu-proto-f" style="width:${fp}%"></span>
        </div>
        <div class="edu-proto-legend">
          <span class="edu-proto-lbl edu-proto-g-lbl" title="Global prototype: full-document term overlap">G ${gp}%</span>
          <span class="edu-proto-lbl edu-proto-s-lbl" title="Semantic prototype: medical vocabulary overlap">S ${sp}%</span>
          <span class="edu-proto-lbl edu-proto-f-lbl" title="Fragment prototype: best-sentence overlap">F ${fp}%</span>
        </div>`;
    }

    // ── SOAP section pills and score summary ────────────────────────────────
    var scoreBreakdownHtml = '';
    if (query) {
      scoreBreakdownHtml = `<div class="edu-score-breakdown" title="搜尋匹配度與 SOAP 區段匹配比例">
        匹配度 ${score}% · S ${sectionScores.S || 0}% · O ${sectionScores.O || 0}% · A ${sectionScores.A || 0}% · P ${sectionScores.P || 0}%
      </div>`;
    }

    var soapHtml = '';
    if (query) {
      var pills = [
        { k: 'S', label: 'S', cls: 'edu-soap-s-pill' },
        { k: 'O', label: 'O', cls: 'edu-soap-o-pill' },
        { k: 'A', label: 'A', cls: 'edu-soap-a-pill' },
        { k: 'P', label: 'P', cls: 'edu-soap-p-pill' }
      ].map(function({ k, label, cls }) {
        var s = sectionScores[k] || 0;
        return s > 0
          ? `<span class="${cls} edu-soap-pill active" title="${k}段落匹配度 ${s}%">${label}<span class="edu-pill-bar"><span style="width:${Math.min(s, 100)}%"></span></span></span>`
          : `<span class="${cls} edu-soap-pill">${label}</span>`;
      }).join('');
      soapHtml = `<div class="edu-soap-pills">${pills}</div>`;
    }

    var tagsHtml = (entry.tags || []).map(t => `<span class="edu-tag">${escHtml(t)}</span>`).join('');
    var srcBtn = entry.source_url
      ? `<a class="edu-vbtn edu-source-btn" href="${escHtml(entry.source_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Source ↗</a>`
      : '';
    var deleteBtn = entry._local
      ? `<button class="edu-vbtn edu-delete-btn" onclick="eduDeleteEntry('${escHtml(entry.id)}');event.stopPropagation()" title="刪除此條目">🗑</button>`
      : '';

    card.innerHTML = `
      <div class="edu-card-top">
        <span class="edu-card-icon">📄</span>
        <div class="edu-card-info">
          <div class="edu-card-title">${escHtml(entry.title)}${scoreBadge}</div>
          ${entry.source_label ? `<div class="edu-card-source">來源：${escHtml(entry.source_label)}</div>` : ''}
          ${protoHtml}
          ${scoreBreakdownHtml}
          ${soapHtml}
          <div class="edu-card-tags">${tagsHtml}</div>
        </div>
      </div>
      <div class="edu-card-versions">
        <button class="edu-vbtn" onclick="eduOpenEntry('${escHtml(entry.id)}','simple_zh');event.stopPropagation()">簡易版</button>
        <button class="edu-vbtn" onclick="eduOpenEntry('${escHtml(entry.id)}','professional_zh');event.stopPropagation()">專業版</button>
        <button class="edu-vbtn" onclick="eduOpenEntry('${escHtml(entry.id)}','english');event.stopPropagation()">English</button>
        ${srcBtn}${deleteBtn}
      </div>
    `;
    card.addEventListener('click', function() { eduOpenEntry(entry.id, eduDefaultVersion); });
    list.appendChild(card);
  });
}

function eduSearch(query) {
  // Show/hide the clear button
  var clearBtn = document.getElementById('edu-search-clear-btn');
  if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';
  eduRenderList();
}

/** Handle keyboard events in the edu search bar. */
function eduSearchKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    eduClearSearch();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    eduScrollToResults();
  }
}

/** Submit search and scroll to results (used by 🔍 button). */
function eduSearchSubmit() {
  var q = (document.getElementById('edu-search') || {}).value || '';
  eduSearch(q);
  eduScrollToResults();
}

/** Clear the search query and jump back to the filter buttons. */
function eduClearSearch() {
  var input = document.getElementById('edu-search');
  if (input) { input.value = ''; input.focus(); }
  eduSearch('');
  // Scroll to filter buttons (top of edu toolbar)
  var toolbar = document.querySelector('.edu-toolbar');
  if (toolbar) toolbar.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Scroll to the edu results list. */
function eduScrollToResults() {
  var list = document.getElementById('edu-list');
  if (list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function eduSetSearchMode(mode) {
  eduSearchMode = mode;
  document.querySelectorAll('.edu-filter-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  var q = (document.getElementById('edu-search') || {}).value || '';
  if (q.trim()) eduSearch(q);
}

function eduSetDefaultVersion(v) {
  eduDefaultVersion = v;
  document.querySelectorAll('.edu-ver-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.ver === v);
  });
}

// ---------------------------------------------------------------------------
// FastSR Three-Prototype Scoring
// ---------------------------------------------------------------------------
// Implements Global, Semantic, and Fragment prototypes as described in FastSR.
// For each entry the three prototype representations are:
//   Global   (G): bag-of-words vocabulary of the full document
//   Semantic (S): domain-vocabulary keywords (FASTSR_KEYWORDS) found in doc
//   Fragment (F): individual sentences from SOAP sections
//
// Similarity to each prototype = query-token recall against prototype terms.
// Total score = mean(G_sim, S_sim, F_sim) × 100
// Displayed breakdown G% + S% + F% = 100% (contribution proportions).
// ---------------------------------------------------------------------------

// In-memory prototype cache: entry.id → { globalSet, semanticSet, fragments[] }
var _eduProtoCache = Object.create(null);

/** Build and cache prototype representations for one entry. */
function eduGetPrototypes(entry) {
  if (_eduProtoCache[entry.id]) return _eduProtoCache[entry.id];

  var fastsr = entry.fastsr || { S: [], O: [], A: [], P: [] };

  // Use pre-computed prototype if stored in JSON (much faster)
  var stored = entry.prototype || {};

  // ----- Global prototype: all unique tokens from full document -----
  var globalSet;
  if (stored.global && stored.global.length) {
    globalSet = new Set(stored.global.map(function(t) { return t.toLowerCase(); }));
    // Also expand any multi-char Chinese tokens into unigram+bigrams
    var extra = [];
    stored.global.forEach(function(t) {
      t = t.toLowerCase();
      if (/[\u4e00-\u9fff]/.test(t) && t.length > 1) {
        for (var charIndex = 0; charIndex < t.length; charIndex++) extra.push(t[charIndex]);
        for (var bigramIndex = 0; bigramIndex < t.length - 1; bigramIndex++) extra.push(t[bigramIndex] + t[bigramIndex + 1]);
      }
    });
    extra.forEach(function(t) { globalSet.add(t); });
  } else {
    var allSentences = ['S','O','A','P'].reduce(function(acc, k) {
      return acc.concat(fastsr[k] || []);
    }, []);
    var allText = [entry.title || '', (entry.tags || []).join(' ')]
      .concat(allSentences).join(' ');
    globalSet = new Set(eduTokenize(allText));
  }

  // ----- Semantic prototype: domain vocab keywords present in document -----
  var semanticSet;
  if (stored.semantic && stored.semantic.length) {
    semanticSet = new Set();
    stored.semantic.forEach(function(kw) {
      eduTokenize(kw).forEach(function(t) { semanticSet.add(t); });
    });
  } else {
    var docLower = [entry.title || '', (entry.tags || []).join(' ')]
      .concat(['S','O','A','P'].reduce(function(acc, k) { return acc.concat(fastsr[k] || []); }, []))
      .join(' ').toLowerCase();
    semanticSet = new Set();
    Object.values(FASTSR_KEYWORDS).forEach(function(kws) {
      kws.zh.concat(kws.en).forEach(function(kw) {
        if (docLower.indexOf(kw.toLowerCase()) !== -1) {
          eduTokenize(kw).forEach(function(t) { semanticSet.add(t); });
        }
      });
    });
  }

  // ----- Fragment prototype: individual sentences as token sets -----
  var fragmentSets;
  if (stored.fragment && stored.fragment.length) {
    fragmentSets = stored.fragment.map(function(s) {
      return new Set(eduTokenize(s));
    });
  } else {
    fragmentSets = [];
    ['S','O','A','P'].forEach(function(k) {
      (fastsr[k] || []).forEach(function(sent) {
        if (sent.trim().length > 5) {
          fragmentSets.push(new Set(eduTokenize(sent)));
        }
      });
    });
  }

  var result = { globalSet: globalSet, semanticSet: semanticSet, fragmentSets: fragmentSets };
  _eduProtoCache[entry.id] = result;
  return result;
}

/**
 * Score query tokens against the three prototypes.
 * Returns { global, semantic, fragment } each in range 0–100 (% recall).
 */
function eduScorePrototypes(tokens, protos) {
  if (!tokens.length) return { global: 0, semantic: 0, fragment: 0 };
  var n = tokens.length;

  // Global: fraction of query tokens in full-document vocabulary
  var gHits = 0;
  tokens.forEach(function(t) { if (protos.globalSet.has(t)) gHits++; });
  var globalScore = (gHits / n) * 100;

  // Semantic: fraction of query tokens in domain-vocabulary set
  var sHits = 0;
  tokens.forEach(function(t) { if (protos.semanticSet.has(t)) sHits++; });
  var semanticScore = (sHits / n) * 100;

  // Fragment: maximum recall in any single sentence fragment
  var fragmentScore = 0;
  protos.fragmentSets.forEach(function(fragSet) {
    var hits = 0;
    tokens.forEach(function(t) { if (fragSet.has(t)) hits++; });
    var s = (hits / n) * 100;
    if (s > fragmentScore) fragmentScore = s;
  });

  return { global: globalScore, semantic: semanticScore, fragment: fragmentScore };
}

/**
 * Compute proportional contributions (sum = 100%) from raw similarity scores.
 * If all zero, returns { global: 0, semantic: 0, fragment: 0 } — no contribution.
 */
function eduNormalizeProtoScores(raw) {
  var total = raw.global + raw.semantic + raw.fragment;
  if (total <= 0) return { global: 0, semantic: 0, fragment: 0 };
  var g = Math.round((raw.global / total) * 100);
  var s = Math.round((raw.semantic / total) * 100);
  var f = 100 - g - s; // ensure exact sum = 100
  return { global: g, semantic: s, fragment: Math.max(f, 0) };
}

// Allowed HTML tags and safe attributes for eduSetSafeHtml whitelist renderer
var EDU_ALLOWED_TAGS = new Set(['p','br','strong','b','em','i','u','h1','h2','h3','h4',
  'ul','ol','li','table','thead','tbody','tr','th','td','div','span','a','figure',
  'figcaption','blockquote','hr','sup','sub']);

// Safe HTML renderer: reconstructs DOM from scratch using only whitelisted tags.
// Never copies existing nodes from user-controlled sources — always creates new elements.
// NOTE: tpl.innerHTML is flagged by static analysis as a potential XSS sink; however
// the subsequent cloneSafe() function ensures only whitelisted tags/attributes reach
// the live document, making this a controlled false-positive in the CodeQL XSS_through_dom query.
function eduSetSafeHtml(container, html) {
  // Guard against extremely large inputs
  var safeHtml = String(html).slice(0, 200000);
  // Use a <template> element to parse HTML into an inert DocumentFragment
  // (template content has no live document context; scripts don't execute)
  var tpl = document.createElement('template');
  tpl.innerHTML = safeHtml; // lgtm[js/xss-through-dom]

  function cloneSafe(src, dest) {
    src.childNodes.forEach(function(child) {
      if (child.nodeType === 3 /* TEXT_NODE */) {
        dest.appendChild(document.createTextNode(child.nodeValue));
      } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
        var tag = child.tagName.toLowerCase();
        if (!EDU_ALLOWED_TAGS.has(tag)) {
          // Non-whitelisted element: recurse into children only
          cloneSafe(child, dest);
          return;
        }
        var newEl = document.createElement(tag);
        // Allow only safe attributes
        child.getAttributeNames().forEach(function(name) {
          if (name === 'href') {
            var val = child.getAttribute('href') || '';
            // Only allow https:// links to prevent mixed content and downgrade attacks
            if (/^https:\/\//i.test(val)) {
              newEl.setAttribute('href', val);
              newEl.setAttribute('target', '_blank');
              newEl.setAttribute('rel', 'noopener noreferrer');
            }
          } else if (name === 'class' || name === 'style') {
            // Allow class/style for formatting
            newEl.setAttribute(name, child.getAttribute(name));
          }
          // All other attributes (on*, src with data:, etc.) are dropped
        });
        cloneSafe(child, newEl);
        dest.appendChild(newEl);
      }
    });
  }

  container.textContent = '';
  cloneSafe(tpl.content, container);
}

function eduScoreAll(query) {
  var tokens = eduTokenize(query);
  if (!tokens.length) return eduData.map(function(e) {
    return { entry: e, score: 0, protoScores: { global: 0, semantic: 0, fragment: 0 }, sectionScores: { S: 0, O: 0, A: 0, P: 0 } };
  });
  return eduData
    .map(function(entry) {
      var result = eduScoreEntry(entry, tokens);
      return { entry: entry, score: result.score, protoScores: result.protoScores, sectionScores: result.sectionScores };
    })
    .sort(function(a, b) { return b.score - a.score; });
}

function eduTokenize(text) {
  var lower = text.toLowerCase();
  var tokens = [];
  var words = lower.split(/[\s,，、；;。.!！?？\-\/]+/).filter(Boolean);
  words.forEach(function(w) {
    tokens.push(w);
    if (/[\u4e00-\u9fff]/.test(w) && w.length > 1) {
      for (var charIndex = 0; charIndex < w.length; charIndex++) {
        tokens.push(w[charIndex]); // Chinese character-level matching
      }
      for (var bigramIndex = 0; bigramIndex < w.length - 1; bigramIndex++) {
        tokens.push(w[bigramIndex] + w[bigramIndex + 1]); // Chinese bigrams
      }
    }
  });
  return Array.from(new Set(tokens)).filter(function(t) { return t.length >= 1; });
}

function eduScoreEntry(entry, tokens) {
  // ── Three-prototype scoring (FastSR) ─────────────────────────────────────
  var protos = eduGetPrototypes(entry);
  var protoRaw = eduScorePrototypes(tokens, protos);

  // Title boost: direct title match contributes up to +50 raw points
  var titleSet = new Set(eduTokenize((entry.title || '').toLowerCase()));
  var titleHits = tokens.filter(function(t) { return titleSet.has(t); }).length;
  var titleBoost = tokens.length > 0 ? (titleHits / tokens.length) * 50 : 0;

  // Total score = mean of three prototype similarities + title boost, clamped 0–100
  var avgProto = (protoRaw.global + protoRaw.semantic + protoRaw.fragment) / 3;
  var score = Math.min(Math.round(avgProto + titleBoost), 100);

  // Proportional breakdown (G + S + F = 100%)
  var protoScores = eduNormalizeProtoScores(protoRaw);

  // ── SOAP section scores (kept for section-filter mode display) ────────────
  var sectionScores = eduComputeSoapSectionScores(entry, tokens);

  return { score: score, protoScores: protoScores, sectionScores: sectionScores };
}

/** Compute per-SOAP-section match scores for filter-mode display. */
function eduComputeSoapSectionScores(entry, tokens) {
  var sectionWeights = { S: 1.5, O: 1.0, A: 1.8, P: 1.5 };
  var sectionScores = { S: 0, O: 0, A: 0, P: 0 };
  var fastsr = entry.fastsr || { S: [], O: [], A: [], P: [] };
  var secMax = Math.max(tokens.length * 3 * 1.8, 1);

  ['S', 'O', 'A', 'P'].forEach(function(sec) {
    var text = (fastsr[sec] || []).join(' ').toLowerCase();
    var raw = 0;
    tokens.forEach(function(t) { if (text.indexOf(t) !== -1) raw += 3; });
    if (eduSearchMode !== 'all') {
      raw = (eduSearchMode === sec) ? raw * 4 : raw * 0.05;
    }
    sectionScores[sec] = Math.min(Math.round((raw * sectionWeights[sec] / secMax) * 100 * 2), 100);
  });

  return sectionScores;
}

// ---------------------------------------------------------------------------
// Detail viewer
// ---------------------------------------------------------------------------
function eduOpenEntry(id, version) {
  var entry = eduData.find(e => e.id === id);
  if (!entry) return;
  eduCurrentEntry = entry;
  eduCurrentVersion = version || eduDefaultVersion;

  document.getElementById('edu-viewer-title').textContent = entry.title;
  var list = document.getElementById('edu-list');
  var toolbar = document.querySelector('.edu-toolbar');
  var versionBar = document.getElementById('edu-version-bar');
  var addPanel = document.getElementById('edu-add-panel');
  if (list) list.classList.add('hidden');
  if (toolbar) toolbar.classList.add('hidden');
  if (versionBar) versionBar.classList.add('hidden');
  if (addPanel) addPanel.classList.add('hidden');
  document.getElementById('edu-viewer').classList.remove('hidden');
  var floatBtn = document.getElementById('edu-back-float');
  if (floatBtn) floatBtn.classList.remove('hidden');

  document.querySelectorAll('.edu-vtab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.v === eduCurrentVersion);
  });
  eduRenderViewerContent();
  var viewer = document.getElementById('edu-viewer');
  if (viewer) viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function eduSwitchVersion(v) {
  if (!eduCurrentEntry) return;
  eduCurrentVersion = v;
  document.querySelectorAll('.edu-vtab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.v === v);
  });
  eduRenderViewerContent();
}

function eduRenderViewerContent() {
  var content = document.getElementById('edu-viewer-content');
  if (!content || !eduCurrentEntry) return;
  var entry = eduCurrentEntry;
  var v = eduCurrentVersion;

  if (v === 'fastsr') {
    var fastsr = entry.fastsr || { S: [], O: [], A: [], P: [] };
    var sections = [
      { k: 'S', label: 'S — 症狀／主訴／適應症', cls: 'edu-soap-s', blk: 'fastsr-s' },
      { k: 'O', label: 'O — 客觀發現／檢查結果', cls: 'edu-soap-o', blk: 'fastsr-o' },
      { k: 'A', label: 'A — 評估／診斷', cls: 'edu-soap-a', blk: 'fastsr-a' },
      { k: 'P', label: 'P — 計畫／治療', cls: 'edu-soap-p', blk: 'fastsr-p' }
    ];
    content.innerHTML = `
      <div class="edu-fastsr-view">
        <p class="edu-fastsr-desc">ClinSR 結構 — 將原文依 SOAP 格式分類，用於精準搜尋與跨文件對比<br>
        此分類方式參考 FastSR 論文（EBM-NLP PICO 框架）映射至臨床 SOAP 格式。</p>
        ${sections.map(function({ k, label, cls, blk }) {
          var items = fastsr[k] || [];
          return `<div class="edu-fastsr-block ${blk}">
            <div class="edu-fastsr-header ${cls}">${label}</div>
            <ul class="edu-fastsr-list">
              ${items.length
                ? items.map(s => `<li>${escHtml(s)}</li>`).join('')
                : '<li class="edu-fastsr-empty">（無資料）</li>'}
            </ul>
          </div>`;
        }).join('')}
      </div>`;
  } else if (v === 'source') {
    var urlsHtml = '';
    if (entry.source_urls && entry.source_urls.length > 1) {
      urlsHtml = '<p><strong>來源連結：</strong></p><ul>' +
        entry.source_urls.map(function(u) {
          return '<li><a href="' + escHtml(u) + '" target="_blank" rel="noopener">' + escHtml(u) + '</a></li>';
        }).join('') + '</ul>';
    } else if (entry.source_url) {
      urlsHtml = '<p><a href="' + escHtml(entry.source_url) + '" target="_blank" rel="noopener">' + escHtml(entry.source_url) + '</a></p>';
    } else {
      urlsHtml = '<p style="color:var(--muted)">（未提供來源連結）</p>';
    }
    content.innerHTML = `
      <div class="edu-source-view">
        <h3>來源資訊</h3>
        ${entry.source_label ? `<p><strong>來源：</strong>${escHtml(entry.source_label)}</p>` : ''}
        ${urlsHtml}
        ${entry.tags && entry.tags.length
          ? `<p><strong>標籤：</strong>${entry.tags.map(t => `<span class="edu-tag">${escHtml(t)}</span>`).join(' ')}</p>`
          : ''}
        ${entry.added_date ? `<p style="color:var(--muted);font-size:0.85rem;margin-top:12px">新增日期：${escHtml(entry.added_date)}${entry.version ? `　版本：v${escHtml(String(entry.version))}` : ''}</p>` : ''}
      </div>`;
  } else {
    var html = ((entry.versions || {})[v]) || '<p style="color:var(--muted);padding:8px">（此語言版本尚未提供）</p>';
    eduSetSafeHtml(content, html);
    eduEnhanceDomainTables(content, entry);
    eduWrapContentTables(content, entry, v);
    eduMountInteractiveWidgets(content, entry, v);
  }
  eduApplyArticleScale(content);
}

function eduIsAscodEntry(entry) {
  return !!(entry && (
    entry.id === 'edu003_ASCOD' ||
    entry.id === 'edu002_ASCOD_classification' ||
    /ASCOD/i.test(entry.title || '')
  ));
}

function eduCollapseAdjacentBlock(heading, opts) {
  if (!heading || !heading.parentNode) return;
  var next = heading.nextElementSibling;
  if (!next) return;
  if (heading.parentNode.tagName === 'SUMMARY') return;
  var details = document.createElement('details');
  details.className = 'edu-inline-collapse' + (opts && opts.className ? ' ' + opts.className : '');
  if (opts && opts.open) details.open = true;
  var summary = document.createElement('summary');
  summary.textContent = (opts && opts.summaryText) || (heading.textContent || '').trim();
  details.appendChild(summary);
  details.appendChild(next);
  heading.parentNode.insertBefore(details, heading);
  heading.parentNode.removeChild(heading);
}

function eduEnhanceDomainTables(content, entry) {
  if (!content || !entry) return;
  if (entry.id === 'edu001_CDR') eduCollapseCdrDomainTable(content);
  if (entry.id === 'edu001_CDR') eduCollapseCdrReferenceTables(content);
  if (eduIsAscodEntry(entry)) eduCollapseAscodDomainTables(content);
}

function eduCollapseCdrDomainTable(content) {
  var heading = Array.from(content.querySelectorAll('h3')).find(function(h) {
    return /六向度分級標準|Domain Scoring Criteria/i.test(h.textContent || '');
  });
  if (!heading) return;
  var table = heading.nextElementSibling;
  if (!table || table.tagName !== 'TABLE') return;
  var ths = Array.from(table.querySelectorAll('thead th')).map(function(th) { return th.textContent.trim(); });
  var rows = Array.from(table.querySelectorAll('tbody tr'));
  if (ths.length < 2 || !rows.length) return;
  var wrap = document.createElement('div');
  wrap.className = 'edu-domain-accordion-group';
  rows.forEach(function(row) {
    var tds = row.querySelectorAll('td');
    if (!tds.length) return;
    var details = document.createElement('details');
    details.className = 'edu-domain-accordion';
    var summary = document.createElement('summary');
    summary.textContent = (tds[0].textContent || '').trim();
    details.appendChild(summary);
    var mini = document.createElement('table');
    var tb = document.createElement('tbody');
    for (var i = 1; i < Math.min(ths.length, tds.length); i++) {
      var tr = document.createElement('tr');
      var k = document.createElement('th');
      k.textContent = ths[i];
      var v = document.createElement('td');
      v.textContent = (tds[i].textContent || '').trim();
      tr.appendChild(k);
      tr.appendChild(v);
      tb.appendChild(tr);
    }
    mini.appendChild(tb);
    details.appendChild(mini);
    wrap.appendChild(details);
  });
  table.parentNode.replaceChild(wrap, table);
}

function eduCollapseCdrReferenceTables(content) {
  Array.from(content.querySelectorAll('h3')).forEach(function(heading) {
    var txt = (heading.textContent || '').trim();
    if (/Global CDR 等級|Global CDR Score/i.test(txt)) {
      eduCollapseAdjacentBlock(heading, {
        summaryText: txt,
        className: 'edu-inline-collapse-compact'
      });
    }
  });
}

function eduCollapseAscodDomainTables(content) {
  var domainHeaders = Array.from(content.querySelectorAll('h3')).filter(function(h) {
    return /^[A-Z]\s*[-—]\s*/.test((h.textContent || '').trim());
  });
  domainHeaders.forEach(function(h) {
    var table = h.nextElementSibling;
    if (!table || table.tagName !== 'TABLE') return;
    eduCollapseAdjacentBlock(h, {
      summaryText: (h.textContent || '').trim(),
      className: 'edu-domain-accordion'
    });
  });
}

function eduWrapContentTables(container, entry, version) {
  var tables = container.querySelectorAll('table');
  if (!tables.length) return;
  tables.forEach(function(table) {
    if (table.parentElement && table.parentElement.classList.contains('edu-table-wrap')) return;
    var wrap = document.createElement('div');
    wrap.className = 'edu-table-wrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });
}

var _eduCalcDropdownOutsideCloseBound = false;
function eduEnsureCalcDropdownOutsideClose() {
  if (_eduCalcDropdownOutsideCloseBound) return;
  _eduCalcDropdownOutsideCloseBound = true;
  document.addEventListener('click', function(e) {
    document.querySelectorAll('.edu-calc-dropdown.open').forEach(function(root) {
      if (!root.contains(e.target)) root.classList.remove('open');
    });
  });
}

function eduCreateCalcDropdown(opts) {
  eduEnsureCalcDropdownOutsideClose();
  var EDU_CALC_MENU_MAX_WIDTH = 520;
  var EDU_CALC_MENU_MIN_WIDTH = 320;
  var EDU_CALC_MENU_VIEWPORT_MARGIN = 24;
  var options = opts.options || [];
  var current = String(opts.value);
  var root = document.createElement('div');
  root.className = 'edu-calc-dropdown';
  var closeTimerId = null;
  var trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'edu-calc-dd-trigger';
  var menu = document.createElement('div');
  menu.className = 'edu-calc-dd-menu';
  var list = document.createElement('div');
  list.className = 'edu-calc-dd-list';
  var ghost = document.createElement('div');
  ghost.className = 'edu-calc-dd-ghost';
  menu.appendChild(list);
  menu.appendChild(ghost);
  root.appendChild(trigger);
  root.appendChild(menu);

  function setGhost(opt) {
    ghost.textContent = (opt && opt.desc) ? opt.desc : (opts.placeholderText || '將滑鼠移到選項可預覽說明');
  }
  function cancelClose() {
    if (closeTimerId) {
      clearTimeout(closeTimerId);
      closeTimerId = null;
    }
  }
  function positionMenu() {
    var viewportWidth = Math.max(window.innerWidth || 0, EDU_CALC_MENU_MIN_WIDTH);
    var maxWidth = Math.min(
      EDU_CALC_MENU_MAX_WIDTH,
      Math.max(EDU_CALC_MENU_MIN_WIDTH, viewportWidth - EDU_CALC_MENU_VIEWPORT_MARGIN)
    );
    var rect = root.getBoundingClientRect();
    root.style.setProperty('--edu-calc-menu-width', maxWidth + 'px');
    root.classList.toggle('ghost-left', rect.left + maxWidth > viewportWidth - 16);
  }
  function setValue(v, emitChange) {
    current = String(v);
    var selected = options.find(function(o) { return String(o.value) === current; }) || options[0];
    if (!selected) return;
    trigger.textContent = selected.label + ' ▾';
    setGhost(selected);
    if (emitChange && typeof opts.onChange === 'function') opts.onChange(selected.value, selected);
  }
  function open() {
    cancelClose();
    positionMenu();
    root.classList.add('open');
  }
  function close() {
    cancelClose();
    root.classList.remove('open');
  }
  function scheduleClose() {
    cancelClose();
    closeTimerId = setTimeout(close, 140);
  }

  options.forEach(function(opt) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'edu-calc-dd-option';
    b.textContent = opt.label;
    b.dataset.value = String(opt.value);
    b.addEventListener('mouseenter', function() { setGhost(opt); });
    b.addEventListener('focus', function() { setGhost(opt); });
    b.addEventListener('click', function() {
      setValue(opt.value, true);
      close();
    });
    list.appendChild(b);
  });

  var supportsHoverOpen = !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
  if (supportsHoverOpen) {
    root.addEventListener('pointerenter', open);
    root.addEventListener('pointerleave', scheduleClose);
  }
  root.addEventListener('focusin', open);
  root.addEventListener('focusout', function(e) {
    if (!root.contains(e.relatedTarget)) scheduleClose();
  });
  trigger.addEventListener('click', function(e) {
    e.preventDefault();
    if (root.classList.contains('open')) close();
    else open();
  });
  window.addEventListener('resize', function() {
    if (root.classList.contains('open')) positionMenu();
  });
  setValue(current, false);
  return {
    el: root,
    getValue: function() { return Number(current); },
    setValue: function(v) { setValue(v, false); }
  };
}

function eduMountInteractiveWidgets(content, entry, version) {
  if (!content || !entry) return;
  var english = version === 'english';
  if (version === 'simple_zh') {
    if (entry.id === 'edu001_CDR' && !content.querySelector('.edu-cdr-calculator')) {
      var cdrAnchor = document.createElement('div');
      cdrAnchor.className = 'edu-cdr-calculator';
      content.insertBefore(cdrAnchor, content.firstChild);
    }
    if (eduIsAscodEntry(entry) && !content.querySelector('.edu-ascod-calculator')) {
      var ascodAnchor = document.createElement('div');
      ascodAnchor.className = 'edu-ascod-calculator';
      content.insertBefore(ascodAnchor, content.firstChild);
    }
  }
  content.querySelectorAll('.edu-cdr-calculator').forEach(function(el) {
    eduWrapCalculator(el, 'cdr', english ? '🧮 Clinical Dementia Rating Calculator' : '🧮 臨床失智評估量表計算器', function(inner) {
      eduRenderCdrCalculator(inner);
    });
  });
  content.querySelectorAll('.edu-ascod-calculator').forEach(function(el) {
    eduWrapCalculator(el, 'ascod', english ? '🧮 ASCOD Phenotype Calculator' : '🧮 腦中風原因分類計算器', function(inner) {
      eduRenderAscodCalculator(inner);
    });
  });
}

function eduWrapCalculator(el, type, label, renderFn) {
  var section = document.createElement('div');
  section.className = 'edu-calc-section edu-calc-section-' + type;
  var inner = document.createElement('div');
  var btn = document.createElement('button');
  btn.className = 'edu-calc-toggle-btn edu-calc-toggle-btn-' + type;
  btn.innerHTML = label + ' <span class="edu-calc-toggle-icon">▼</span>';
  var panel = document.createElement('div');
  panel.className = 'edu-calc-panel';
  panel.style.display = 'none';
  var rendered = false;
  btn.addEventListener('click', function() {
    var open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : '';
    btn.classList.toggle('open', !open);
    if (!open && !rendered) {
      rendered = true;
      renderFn(inner);
    }
  });
  panel.appendChild(inner);
  section.appendChild(btn);
  section.appendChild(panel);
  el.parentNode.insertBefore(section, el);
  el.parentNode.removeChild(el);
}

function eduRenderCdrCalculator(el) {
  if (!el) return;
  var english = eduCurrentVersion === 'english';
  var rows = [
    { key: 'M', label: english ? 'Memory' : 'Memory（記憶）',
      desc: english
        ? { 0: 'No memory loss or only slight inconsistent forgetfulness.', 0.5: 'Consistent slight forgetfulness with partial recollection of events.', 1: 'Moderate recent memory loss that interferes with daily function.', 2: 'Severe memory loss; only highly learned material is retained and new material is rapidly lost.', 3: 'Only fragments of memory remain.' }
        : { 0: '無記憶缺損，或輕微偶發性健忘', 0.5: '持續輕度健忘，部分事件回憶不全（良性健忘）', 1: '近期記憶中度受損，影響日常生活', 2: '重度記憶受損，僅保留高度熟悉資訊，新資訊迅速遺忘', 3: '僅剩片段記憶' } },
    { key: 'O', label: english ? 'Orientation' : 'Orientation（定向）',
      desc: english
        ? { 0: 'Fully oriented.', 0.5: 'Slight difficulty with time relationships; otherwise oriented.', 1: 'Moderate difficulty with time; place orientation is preserved during examination.', 2: 'Usually disoriented in time and often to place.', 3: 'Oriented to person only.' }
        : { 0: '定向力完整', 0.5: '時間關係輕度困難，其餘定向正常', 1: '中度時間定向困難，就診時地點定向尚存', 2: '常有時間／地點定向差', 3: '僅對人有定向' } },
    { key: 'JPS', label: english ? 'Judgment & Problem Solving' : 'Judgment & Problem Solving（判斷）',
      desc: english
        ? { 0: 'Judgment and everyday problem solving remain intact.', 0.5: 'Slight impairment in solving problems, similarities, or differences.', 1: 'Moderate impairment; social judgment is usually maintained.', 2: 'Severe impairment; social judgment is usually affected.', 3: 'Unable to make judgments or solve problems.' }
        : { 0: '解決日常問題能力佳，判斷力正常', 0.5: '解決問題、類比、辨差能力輕度受損', 1: '中度受損，社交判斷通常尚存', 2: '重度受損，社交判斷通常已損害', 3: '無法判斷或解決問題' } },
    { key: 'CA', label: english ? 'Community Affairs' : 'Community Affairs（社區事務）',
      desc: english
        ? { 0: 'Independent in usual work, shopping, and social function.', 0.5: 'Slight impairment in outside activities.', 1: 'Cannot function independently outside home, though may still look normal casually.', 2: 'No independent function outside the home.', 3: 'Too impaired to participate in activities outside the family home.' }
        : { 0: '可維持原本工作、購物、社交功能', 0.5: '輕度受限', 1: '無法在外獨立處理，但外觀尚可', 2: '無家庭外獨立功能', 3: '病況過重，無法外出參與活動' } },
    { key: 'HH', label: english ? 'Home & Hobbies' : 'Home & Hobbies（居家生活）',
      desc: english
        ? { 0: 'Home life and hobbies are well maintained.', 0.5: 'Slight limitation in home life or hobbies.', 1: 'Difficult chores and complex hobbies have been given up.', 2: 'Only simple activities remain; interests are markedly restricted.', 3: 'No meaningful function at home.' }
        : { 0: '居家生活及嗜好維持良好', 0.5: '輕度受限', 1: '較困難的家務及嗜好已放棄', 2: '僅保留簡單活動，興趣極度受限', 3: '無有效居家功能' } },
    { key: 'PC', label: english ? 'Personal Care' : 'Personal Care（個人照護）',
      desc: english
        ? { 0: 'Fully capable of self-care.', 0.5: 'Fully capable of self-care.', 1: 'Needs prompting.', 2: 'Needs help with dressing and personal hygiene.', 3: 'Requires major assistance and is often incontinent.' }
        : { 0: '可完全自理', 0.5: '可完全自理', 1: '需提醒', 2: '需協助穿衣及個人衛生', 3: '高度依賴照顧，常有失禁' } }
  ];
  var grades = [
    { v: 0, t: '0' }, { v: 0.5, t: '0.5' }, { v: 1, t: '1' }, { v: 2, t: '2' }, { v: 3, t: '3' }
  ];
  el.innerHTML = `
    <div class="edu-calc-box edu-calc-box-cdr">
      <p class="edu-calc-intro">${english
        ? 'Choose a rating for each of the six domains. The calculator applies the published CDR global scoring rules automatically. Hover over an option to preview its meaning.'
        : '請為六個向度選擇分數，系統將依 CDR 規則自動計算 Global CDR。滑鼠移到選項可預覽各等級說明。'}</p>
      <div class="edu-calc-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
        ${rows.map(function(r) {
          return `<div class="edu-domain-row">
            <label style="font-size:0.79rem;color:var(--muted)">${escHtml(r.label)}</label>
            <div class="edu-cdr-dd" data-key="${escHtml(r.key)}"></div>
            <div class="edu-domain-info" data-cdr-info="${escHtml(r.key)}">—</div>
          </div>`;
        }).join('')}
      </div>
      <div class="edu-calc-result" data-cdr-result style="margin-top:14px">${english ? 'Global CDR = 0 (no dementia)' : 'CDR = 0（無失智）'}</div>
      <details class="edu-calc-inline-collapse">
        <summary>${english ? 'CDR® scoring rules (Morris 1993)' : 'CDR® 完整計分邏輯（依 Morris 1993）'}</summary>
        <div class="edu-calc-rules">
        <ol>
          ${english
            ? '<li>Memory (M) is the primary domain; O/JPS/CA/HH/PC are secondary domains.</li>' +
              '<li>If at least 3 secondary domains match M, then Global CDR = M.</li>' +
              '<li>If at least 3 secondary domains fall above or below M, use the majority side; when tied on that side, choose the score closest to M.</li>' +
              '<li>If three secondary domains fall on one side of M and two on the other side, then Global CDR = M.</li>' +
              '<li>When M = 0.5, Global CDR can only be 0.5 or 1; it becomes 1 when at least 3 other domains are ≥1.</li>' +
              '<li>When M = 0, Global CDR is 0 unless at least 2 secondary domains are ≥0.5, in which case it is 0.5.</li>' +
              '<li>When M ≥ 1, Global CDR cannot be 0.</li>' +
              '<li>If only 1–2 secondary domains match M and neither side of M contains more than 2 secondary domains, then Global CDR = M.</li>'
            : '<li>Memory（M）為主向度，其餘 O/JPS/CA/HH/PC 為次向度。</li>' +
              '<li>若至少 3 個次向度與 M 同分，則 Global CDR = M。</li>' +
              '<li>若至少 3 個次向度落在 M 以上或 M 以下，則取次向度多數側的分數；若該側分數有並列，取最接近 M 者。</li>' +
              '<li>若一側 3 個、另一側 2 個，則 Global CDR = M。</li>' +
              '<li>M = 0.5 時，若其他向度中至少 3 項 ≥1，則 CDR = 1；否則為 0.5（不可為 0）。</li>' +
              '<li>M = 0 時，除非次向度中有至少 2 項 ≥0.5，否則 CDR = 0；若有則 CDR = 0.5。</li>' +
              '<li>M ≥ 1 時，Global CDR 不可為 0；即使次向度多數為 0，最低仍為 0.5。</li>' +
              '<li>若僅 1–2 個次向度與 M 同分，且 M 兩側各不超過 2 個次向度，則 CDR = M。</li>'}
        </ol>
        </div>
      </details>
    </div>`;
  var resultEl = el.querySelector('[data-cdr-result]');
  var scores = {};
  var descMap = {};
  rows.forEach(function(r) {
    descMap[r.key] = r.desc;
    scores[r.key] = 0;
    var host = el.querySelector('.edu-cdr-dd[data-key="' + r.key + '"]');
    if (!host) return;
    var dd = eduCreateCalcDropdown({
      value: 0,
      options: grades.map(function(g) {
        return { value: g.v, label: r.key + g.t, desc: r.desc[g.v] || '—' };
      }),
      placeholderText: english ? 'Hover over a score to preview its definition.' : '將滑鼠移到選項可預覽說明',
      onChange: function(v) {
        scores[r.key] = Number(v);
        updateInfo(r.key);
        recalc();
      }
    });
    host.appendChild(dd.el);
    updateInfo(r.key);
  });

  function updateInfo(key) {
    var info = el.querySelector('[data-cdr-info="' + key + '"]');
    var val = Number(scores[key] || 0);
    if (info && descMap[key]) {
      var txt = descMap[key][val] || '—';
      info.innerHTML = '<strong>' + escHtml(key + String(val)) + ':</strong> ' + escHtml(txt);
    }
  }
  recalc();

  function recalc() {
    var cdr = eduComputeCdrScore(scores);
    var labelMap = english
      ? { 0: 'no dementia', 0.5: 'questionable / very mild dementia', 1: 'mild dementia', 2: 'moderate dementia', 3: 'severe dementia' }
      : { 0: '無失智', 0.5: '可疑／極輕度失智', 1: '輕度失智', 2: '中度失智', 3: '重度失智' };
    resultEl.textContent = english
      ? ('Global CDR = ' + cdr + ' (' + (labelMap[cdr] || 'unclassified') + ')')
      : ('CDR = ' + cdr + '（' + (labelMap[cdr] || '未分級') + '）');
  }
}

function eduComputeCdrScore(scores) {
  var M = Number(scores.M || 0);
  var secondary = [scores.O, scores.JPS, scores.CA, scores.HH, scores.PC].map(function(x) { return Number(x || 0); });
  var eps = 1e-9;

  function eq(a, b) { return Math.abs(a - b) < eps; }
  function modeClosestToM(values) {
    var counts = {};
    values.forEach(function(v) { counts[v] = (counts[v] || 0) + 1; });
    var maxCount = 0;
    Object.keys(counts).forEach(function(k) { if (counts[k] > maxCount) maxCount = counts[k]; });
    var candidates = Object.keys(counts)
      .filter(function(k) { return counts[k] === maxCount; })
      .map(function(k) { return Number(k); })
      .sort(function(a, b) {
        var da = Math.abs(a - M);
        var db = Math.abs(b - M);
        return da - db;
      });
    return candidates.length ? candidates[0] : M;
  }

  var result;
  if (eq(M, 0)) {
    var impairedSec = secondary.filter(function(v) { return v >= 0.5; }).length;
    result = impairedSec >= 2 ? 0.5 : 0;
    return result;
  }

  if (eq(M, 0.5)) {
    var secOneOrMore = secondary.filter(function(v) { return v >= 1; }).length;
    result = secOneOrMore >= 3 ? 1 : 0.5;
    return result;
  }

  var same = secondary.filter(function(v) { return eq(v, M); }).length;
  var higher = secondary.filter(function(v) { return v > M; });
  var lower = secondary.filter(function(v) { return v < M; });

  if (same >= 3) result = M;

  if (typeof result === 'undefined' && (higher.length >= 3 || lower.length >= 3)) {
    if (higher.length > lower.length) result = modeClosestToM(higher);
    else if (lower.length > higher.length) result = modeClosestToM(lower);
    else result = M;
  }

  if (typeof result === 'undefined' && same <= 2 && higher.length <= 2 && lower.length <= 2) result = M;

  if (typeof result === 'undefined') result = modeClosestToM(secondary.concat([M]));
  if (M >= 1 && eq(result, 0)) result = 0.5;
  if (typeof result === 'undefined' || Number.isNaN(Number(result))) result = M >= 1 ? 0.5 : 0;
  return Number(result);
}

function eduRenderAscodCalculator(el) {
  if (!el) return;
  var english = eduCurrentVersion === 'english';
  var lang = english ? 'en' : 'zh';

  // Per-domain grade criteria for tooltips
  var domainCriteria = {
    A: {
      label: { zh: 'A — Atherosclerosis（動脈粥樣硬化）', en: 'A — Atherosclerosis' },
      grades: {
        zh: { 0: 'A0：無動脈粥樣硬化', 1: 'A1：≥50% 狹窄、潰瘍性斑塊，或主動脈弓斑塊 ≥4mm（位於供血動脈）— potentially causal', 2: 'A2：30–49% 狹窄，或不規則/非梗阻性斑塊（供血動脈相關）— uncertain causality', 3: 'A3：<30% 狹窄，或與梗塞灶供血區不符部位之斑塊 — unlikely causal', 9: 'A9：頸動脈/顱內血管影像學未完成 — insufficient workup' },
        en: { 0: 'A0: no relevant atherosclerosis detected.', 1: 'A1: ≥50% stenosis, ulcerated plaque, or aortic arch plaque ≥4 mm in the supplying artery — potentially causal.', 2: 'A2: 30–49% stenosis or irregular non-obstructive plaque in the relevant artery — causality uncertain.', 3: 'A3: <30% stenosis or plaque outside the infarct-supplying territory — unlikely causal.', 9: 'A9: carotid/intracranial vascular imaging not completed — insufficient workup.' }
      }
    },
    S: {
      label: { zh: 'S — Small-vessel disease（小血管病變）', en: 'S — Small-vessel disease' },
      grades: {
        zh: { 0: 'S0：無小血管病變證據', 1: 'S1：腔隙性症候群 + DWI 示 ≤15mm 深部急性梗塞，合併高血壓或糖尿病 — potentially causal', 2: 'S2：腔隙模式但有其他可能病因，或 SVD 評估不完整 — uncertain causality', 3: 'S3：僅有白質高信號（WMH），無急性腔隙性梗塞 — unlikely causal', 9: 'S9：MRI 未完成 — insufficient workup' },
        en: { 0: 'S0: no evidence of small-vessel disease relevant to this stroke.', 1: 'S1: lacunar syndrome with DWI-confirmed deep acute infarct ≤15 mm plus hypertension or diabetes — potentially causal.', 2: 'S2: lacunar pattern but another cause exists, or SVD evaluation is incomplete — causality uncertain.', 3: 'S3: white matter hyperintensity only without an acute lacunar infarct — unlikely causal.', 9: 'S9: MRI not completed — insufficient workup.' }
      }
    },
    C: {
      label: { zh: 'C — Cardiac pathology（心臟病變）', en: 'C — Cardiac pathology' },
      grades: {
        zh: { 0: 'C0：無心臟病變', 1: 'C1：高風險心源性栓塞 — AF、機械瓣膜、感染性心內膜炎、病竇症候群、近期 MI（<4週）、擴張型心肌病、心腔內血栓 — potentially causal', 2: 'C2：中度風險 — PFO、心房中隔瘤（ASA）、自發性迴聲增強、複雜主動脈弓斑塊 — uncertain causality', 3: 'C3：低風險心臟病變（較不可能為主因）', 9: 'C9：心臟超音波或長程心律監測未完成 — insufficient workup' },
        en: { 0: 'C0: no cardiac source identified.', 1: 'C1: high-risk cardiac embolic source (eg, AF, mechanical valve, infective endocarditis, recent MI, dilated cardiomyopathy, intracardiac thrombus) — potentially causal.', 2: 'C2: intermediate-risk source such as PFO, ASA, spontaneous echo contrast, or complex aortic arch plaque — causality uncertain.', 3: 'C3: low-risk cardiac lesion present but unlikely to be the main cause.', 9: 'C9: echocardiography or prolonged rhythm monitoring not completed — insufficient workup.' }
      }
    },
    O: {
      label: { zh: 'O — Other causes（其他病因）', en: 'O — Other causes' },
      grades: {
        zh: { 0: 'O0：無其他特定病因', 1: 'O1：明確少見病因 — CNS 血管炎、抗磷脂抗體症候群、鐮刀型血球貧血、CADASIL、Moyamoya、高凝狀態、MELAS 等 — potentially causal', 2: 'O2：疑似少見病因，尚未確診 — uncertain causality', 3: 'O3：少見病因存在，但較不可能為本次中風主因', 9: 'O9：特殊病因相關檢查未完成 — insufficient workup' },
        en: { 0: 'O0: no specific alternative cause identified.', 1: 'O1: specific uncommon cause confirmed (eg, vasculitis, antiphospholipid syndrome, CADASIL, moyamoya, hypercoagulable state, MELAS) — potentially causal.', 2: 'O2: specific uncommon cause suspected but not confirmed — causality uncertain.', 3: 'O3: specific cause present but unlikely to explain the index stroke.', 9: 'O9: disease-specific evaluation not completed — insufficient workup.' }
      }
    },
    D: {
      label: { zh: 'D — Dissection（動脈剝離）', en: 'D — Dissection' },
      grades: {
        zh: { 0: 'D0：無動脈剝離', 1: 'D1：動脈剝離確診（MRI/MRA 顯示壁內血腫/雙腔影，或 DSA 確認）— potentially causal', 2: 'D2：疑似動脈剝離，尚未影像確診 — uncertain causality', 3: 'D3：舊發/癒合剝離，較不可能為本次主因', 9: 'D9：血管壁影像（vessel-wall MRI）未完成 — insufficient workup' },
        en: { 0: 'D0: no arterial dissection identified.', 1: 'D1: dissection confirmed by vessel-wall imaging, MRI/MRA, or DSA — potentially causal.', 2: 'D2: dissection suspected but not yet confirmed by imaging — causality uncertain.', 3: 'D3: old or healed dissection present but unlikely to be causal.', 9: 'D9: dedicated vessel-wall imaging not completed — insufficient workup.' }
      }
    }
  };

  var gradeOptions = [
    { v: 0, t: '0 — absent' },
    { v: 1, t: '1 — potentially causal' },
    { v: 2, t: '2 — uncertain causality' },
    { v: 3, t: '3 — unlikely causal but present' },
    { v: 9, t: '9 — insufficient workup' }
  ];
  var domains = ['A', 'S', 'C', 'O', 'D'];

  el.innerHTML = `
    <div class="edu-calc-box edu-calc-box-ascod">
      <p class="edu-calc-intro">${english
        ? 'Select a grade for each etiologic domain. The calculator outputs the ASCOD phenotype string, and hovering over an option previews the grading definition.'
        : '請選擇每一類別分級，系統會輸出 ASCOD phenotype 字串。將滑鼠移到選項即可預覽該等級意義。'}</p>
      <div class="edu-calc-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
        <div class="edu-domain-row">
          <label style="font-size:0.79rem;color:var(--muted)">${english ? 'Age' : '年齡 Age'}
            <input type="number" min="0" max="120" step="1" class="edu-ascod-age" value="65" />
          </label>
        </div>
        ${domains.map(function(d) {
          return `<div class="edu-domain-row">
            <label style="font-size:0.79rem;color:var(--muted)">${escHtml(domainCriteria[d].label[lang])}</label>
            <div class="edu-ascod-dd" data-key="${d}"></div>
            <div class="edu-domain-info" data-ascod-info="${d}">—</div>
          </div>`;
        }).join('')}
      </div>
      <div class="edu-calc-result" data-ascod-main style="margin-top:14px"></div>
      <div class="edu-calc-note" data-ascod-note></div>
    </div>`;

  var ageEl = el.querySelector('.edu-ascod-age');
  var mainEl = el.querySelector('[data-ascod-main]');
  var noteEl = el.querySelector('[data-ascod-note]');
  var g = {};

  function updateInfo(key) {
    var val = Number(g[key] || 0);
    var info = el.querySelector('[data-ascod-info="' + key + '"]');
    if (info && domainCriteria[key]) {
      var txt = domainCriteria[key].grades[lang][val] || '—';
      info.innerHTML = escHtml(txt);
    }
  }

  ageEl.addEventListener('input', recalc);
  domains.forEach(function(d) {
    g[d] = 0;
    var host = el.querySelector('.edu-ascod-dd[data-key="' + d + '"]');
    if (!host) return;
    var dd = eduCreateCalcDropdown({
      value: 0,
      options: gradeOptions.map(function(opt) {
        return { value: opt.v, label: d + opt.v, desc: domainCriteria[d].grades[lang][opt.v] || '—' };
      }),
      placeholderText: english ? 'Hover over a grade to preview the definition.' : '將滑鼠移到選項可預覽說明',
      onChange: function(v) {
        g[d] = Number(v);
        updateInfo(d);
        recalc();
      }
    });
    host.appendChild(dd.el);
    updateInfo(d);
  });
  recalc();

  function recalc() {
    var age = Number(ageEl.value || 0);
    var phenotype = domains.map(function(d) { return d + g[d]; }).join('-');
    var potential = domains.filter(function(d) { return g[d] === 1; });
    var uncertain = domains.filter(function(d) { return g[d] === 2; });
    var incomplete = domains.filter(function(d) { return g[d] === 9; });
    mainEl.textContent = (english ? 'ASCOD phenotype: ' : 'ASCOD 表型：') + phenotype;

    var notes = [];
    if (potential.length) notes.push((english ? 'Potentially causal: ' : '可能為主要病因：') + potential.join(', '));
    if (uncertain.length) notes.push((english ? 'Uncertain causal link: ' : '因果關聯未定：') + uncertain.join(', '));
    if (incomplete.length) notes.push((english ? 'Incomplete workup: ' : '檢查尚未完整：') + incomplete.join(', '));
    if (age < 60 && g.A !== 1 && g.A !== 2 && g.S !== 1 && g.C !== 1 && g.O !== 1 && g.D === 0) {
      notes.push(english
        ? 'Rule check: age <60 without A1/A2/S1/C1/O1 should prompt confirmation of dissection workup; if not completed, consider D9.'
        : '規則提醒：年齡 <60 歲且無 A1/A2/S1/C1/O1 時，應再次確認是否已完成動脈剝離評估；若未完成可考慮 D9。');
    }
    if (!notes.length) notes.push(english ? 'No grade-1 high-probability causal domain is currently selected.' : '目前未選取 grade 1 的高機率主因。');
    noteEl.innerHTML = notes.map(function(n) { return '<div>• ' + escHtml(n) + '</div>'; }).join('');
  }
}

function eduCloseViewer() {
  document.getElementById('edu-viewer').classList.add('hidden');
  var floatBtn = document.getElementById('edu-back-float');
  if (floatBtn) floatBtn.classList.add('hidden');
  var list = document.getElementById('edu-list');
  var toolbar = document.querySelector('.edu-toolbar');
  var versionBar = document.getElementById('edu-version-bar');
  if (list) list.classList.remove('hidden');
  if (toolbar) toolbar.classList.remove('hidden');
  if (versionBar) versionBar.classList.remove('hidden');
  eduCurrentEntry = null;
  // Scroll to the top of the education section (search bar area)
  var eduTab = document.getElementById('tab-edu');
  if (eduTab) eduTab.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------------------
// Add entry form
// ---------------------------------------------------------------------------
function eduToggleAddForm() {
  var panel = document.getElementById('edu-add-panel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    eduClearAddForm();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function eduClearAddForm() {
  ['edu-form-title', 'edu-form-url', 'edu-form-source-label', 'edu-form-tags',
   'edu-form-original', 'edu-form-s', 'edu-form-o', 'edu-form-a', 'edu-form-p',
   'edu-form-simple-zh', 'edu-form-pro-zh', 'edu-form-en'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
}

// FastSR auto-encoder: classifies pasted text into S/O/A/P
function eduRunAutoEncode() {
  var text = (document.getElementById('edu-form-original') || {}).value || '';
  if (!text.trim()) { toast('⚠️ 請先貼上原始文字'); return; }
  var encoded = eduEncodeFastSR(text);
  var set = function(id, arr) { var el = document.getElementById(id); if (el) el.value = arr.join('\n'); };
  set('edu-form-s', encoded.S);
  set('edu-form-o', encoded.O);
  set('edu-form-a', encoded.A);
  set('edu-form-p', encoded.P);
  toast(`✅ ClinSR 分類完成：S(${encoded.S.length}) O(${encoded.O.length}) A(${encoded.A.length}) P(${encoded.P.length})`);
}

function eduEncodeFastSR(text) {
  var sentences = eduSplitSentences(text);
  var result = { S: [], O: [], A: [], P: [] };
  sentences.forEach(function(s) {
    if (s.trim()) result[eduClassifySentence(s)].push(s.trim());
  });
  return result;
}

function eduSplitSentences(text) {
  return text
    .replace(/([。！？.!?])\s*/g, '$1\n')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 3);
}

function eduClassifySentence(sent) {
  var lower = sent.toLowerCase();
  var scores = { S: 0, O: 0, A: 0, P: 0 };
  Object.entries(FASTSR_KEYWORDS).forEach(function([cat, kws]) {
    [...kws.zh, ...kws.en].forEach(function(kw) {
      if (lower.includes(kw.toLowerCase())) scores[cat] += kw.length > 3 ? 2 : 1;
    });
  });
  var best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : 'S';
}

function eduSaveNewEntry() {
  var get = function(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var title = get('edu-form-title');
  if (!title) { toast('⚠️ 請輸入資源標題'); return; }

  var tags = get('edu-form-tags').split(/[,，、\s]+/).filter(Boolean);
  var entry = {
    id: 'edu_local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    title,
    source_url: get('edu-form-url'),
    source_label: get('edu-form-source-label'),
    original_lang: 'zh-TW',
    added_date: new Date().toISOString().split('T')[0],
    tags,
    fastsr: {
      S: get('edu-form-s').split('\n').filter(Boolean),
      O: get('edu-form-o').split('\n').filter(Boolean),
      A: get('edu-form-a').split('\n').filter(Boolean),
      P: get('edu-form-p').split('\n').filter(Boolean)
    },
    versions: {
      simple_zh: get('edu-form-simple-zh'),
      professional_zh: get('edu-form-pro-zh'),
      english: get('edu-form-en')
    },
    _local: true
  };

  var locals = eduLoadLocal();
  locals.push(entry);
  eduSaveLocal(locals);
  eduData.push(entry);
  eduToggleAddForm();
  eduRenderList();
  toast(`✅ 已儲存「${title}」`);
}

function eduDeleteEntry(id) {
  if (!confirm('確定要刪除此衛教資源？')) return;
  var locals = eduLoadLocal().filter(e => e.id !== id);
  eduSaveLocal(locals);
  eduData = eduData.filter(e => e.id !== id);
  eduRenderList();
  toast('🗑️ 已刪除');
}

// ---------------------------------------------------------------------------
// History / Browse
// ---------------------------------------------------------------------------

function renderHistory() {
  const container = document.getElementById('history-list');
  container.innerHTML = '<p class="empty-msg">尚無記錄</p>';
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
    renderFrequentUsed('nhi');
  } catch (e) {
    console.error('NHI load failed:', e);
    document.getElementById('nhi-cat-grid').innerHTML =
      '<p class="nhi-load-error">⚠️ 無法載入 NHI 支付標準資料：' + escHtml(String(e)) + '</p>';
  }
}

function findNhiCodeItem(code) {
  if (!NHI_DATA || !code) return null;
  for (var i = 0; i < NHI_DATA.categories.length; i++) {
    var cat = NHI_DATA.categories[i];
    for (var j = 0; j < cat.codes.length; j++) {
      var c = cat.codes[j];
      if (c.code === code) {
        return {
          code: c.code,
          name: c.nameZh || '',
          nameEn: c.nameEn || '',
          points: c.points || '',
          cat: cat.nameZh || ''
        };
      }
    }
  }
  return null;
}

function rememberNhiCode(code) {
  var item = findNhiCodeItem(code);
  if (!item) return;
  rememberFrequentUsed('nhi', item, item.code);
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
  scheduleSearchHistorySave('nhi', nhiSearchQ);
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
    var expandItems = getSettings().defaultExpandItems;
    var noteHtml = (showNote && r.note)
      ? '<tr class="nhi-note-row' + (expandItems ? '' : ' hidden') + '"><td colspan="4"><div class="nhi-note">' + escHtml(r.note) + '</div></td></tr>'
      : '';
    var catBadge = r._cat
      ? '<span class="nhi-cat-inline">' + escHtml(r._cat) + '</span> ' : '';
    return '<tr class="nhi-code-row" onclick="nhiToggleNote(this); rememberNhiCode(\'' + escHtml(r.code) + '\')">' +
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
const _searchHistoryTimers = {};

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

// Auto-save search term to history if unchanged for 10 seconds
function scheduleSearchHistorySave(type, query) {
  if (_searchHistoryTimers[type]) clearTimeout(_searchHistoryTimers[type]);
  if (!query || query.length < 2) return;
  _searchHistoryTimers[type] = setTimeout(function() {
    saveSearchHistory(type, query);
  }, 10000);
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
    renderFrequentUsed('drug');
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
  scheduleSearchHistorySave('drug', drugSearchQ);
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
      entryDiv.className = 'drug-entry' + (getSettings().defaultExpandItems ? ' open' : '');

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
      headerDiv.addEventListener('click', function() {
        rememberFrequentUsed('drug', {
          id: e.id,
          name: e.name || '',
          cat: e._cat || ''
        }, e.id);
        if (e.content) entryDiv.classList.toggle('open');
      });

      if (e.content) {
        var chevronSpan = document.createElement('span');
        chevronSpan.className = 'drug-entry-chevron';
        chevronSpan.textContent = '▶';
        headerDiv.appendChild(chevronSpan);
        contentDiv.textContent = e.content;
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
    entryDiv.className = 'drug-entry specmat-entry' + (getSettings().defaultExpandItems ? ' open' : '');

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
  scheduleSearchHistorySave('specmat', specmatSearchQ);
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
  return storageGet(SETTINGS_KEY, { showPcs: false, showNhiPoints: false, defaultExpandItems: false });
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
      <div class="settings-group-title">📋 特材給付 &amp; NHI支付標準</div>
      <label class="settings-item">
        <div class="settings-item-label">
          <div class="settings-item-name">預設展開項目內容</div>
          <div class="settings-item-desc">開啟後，特材給付和 NHI 支付標準的項目詳細內容預設展開；關閉則預設收合</div>
        </div>
        <input type="checkbox" class="settings-toggle" id="setting-default-expand"
          ${settings.defaultExpandItems ? 'checked' : ''}
          onchange="onSettingDefaultExpand(this.checked)" />
      </label>
    </div>

    <div class="settings-group">
      <div class="settings-group-title">⌨️ 快速鍵說明</div>
      <div class="settings-shortcuts">
        <div class="shortcut-row"><kbd>Alt+1</kbd> 衛教資源</div>
        <div class="shortcut-row"><kbd>Alt+2</kbd> 藥品給付規定</div>
        <div class="shortcut-row"><kbd>Alt+3</kbd> 參考資料</div>
        <div class="shortcut-row"><kbd>Alt+4</kbd> ICD-10-CM</div>
        <div class="shortcut-row"><kbd>Alt+5</kbd> NHI支付標準</div>
        <div class="shortcut-row"><kbd>Alt+6</kbd> 特材給付</div>
        <div class="shortcut-row"><kbd>Alt+7</kbd> 治療流程</div>
        <div class="shortcut-row"><kbd>Shift+9</kbd> 歷史記錄</div>
        <div class="shortcut-row"><kbd>Shift+0</kbd> 治療流程</div>
        <div class="shortcut-row"><kbd>Shift+-</kbd> 設定</div>
        <div class="shortcut-row"><kbd class="key-combo">Option/Alt + ↑</kbd> 向上翻頁</div>
        <div class="shortcut-row"><kbd class="key-combo">Option/Alt + ↓</kbd> 向下翻頁</div>
        <div class="shortcut-row"><kbd class="key-combo">Cmd/Ctrl + ↑</kbd> 回到頁頂</div>
        <div class="shortcut-row"><kbd class="key-combo">Cmd/Ctrl + ↓</kbd> 前往頁底</div>
        <div class="shortcut-row"><kbd>Esc</kbd> 衛教搜尋欄：清除並回到篩選列</div>
        <div class="shortcut-row"><kbd>Enter</kbd> 衛教搜尋欄：跳至搜尋結果</div>
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

function onSettingDefaultExpand(checked) {
  var settings = getSettings();
  settings.defaultExpandItems = checked;
  saveSettings(settings);
}
// ===========================================================================
