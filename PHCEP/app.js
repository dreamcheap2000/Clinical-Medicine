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
    renderPcsGrid();
    renderAbout();
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
}

// ---------------------------------------------------------------------------
// CM Category Grid
// ---------------------------------------------------------------------------
function renderCmGrid() {
  const grid = document.getElementById('cm-cat-grid');
  grid.innerHTML = META.cm_categories.map(cat => catCardHtml(cat, 'cm')).join('');
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

  let rows;
  let totalCount;

  if (isCompact) {
    // data is [[code, zh], ...]
    const filtered = q
      ? data.filter(([c,z]) => c.toLowerCase().includes(q) || z.toLowerCase().includes(q))
      : data;
    totalCount = filtered.length;
    rows = filtered.slice(0, 500).map(([c,z]) =>
      `<tr><td class="code-cell">${escHtml(c)}</td><td class="zh-cell">${escHtml(z)}</td></tr>`
    ).join('');
    container.innerHTML = `
      <div class="codes-table-wrap">
        <table class="codes-table compact-table">
          <thead><tr><th>代碼</th><th>中文名稱</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="row-count">顯示 ${Math.min(500, totalCount).toLocaleString()} / ${totalCount.toLocaleString()} 筆${totalCount > 500 ? '（輸入關鍵字篩選）' : ''}</div>`;
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
    rows = filtered.slice(0, 500).map(r =>
      `<tr>
        <td class="code-cell">${escHtml(r.code)}</td>
        <td class="en-cell">${escHtml(r.en)}</td>
        <td class="zh-cell">${escHtml(r.zh)}</td>
      </tr>`
    ).join('');
    container.innerHTML = `
      <div class="codes-table-wrap">
        <table class="codes-table">
          <thead><tr><th>代碼</th><th>English</th><th>中文名稱</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="row-count">顯示 ${Math.min(500, totalCount).toLocaleString()} / ${totalCount.toLocaleString()} 筆${totalCount > 500 ? '（輸入關鍵字篩選）' : ''}</div>`;
  }
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
});
