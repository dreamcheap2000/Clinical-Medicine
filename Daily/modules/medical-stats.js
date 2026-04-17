/**
 * modules/medical-stats.js
 * Medical Data Statistics page — replaces icd-stats.js.
 *
 * Sections:
 *  1. Summary KPIs
 *  2. Date-range filter
 *  3. ICD code frequency bar chart
 *  4. Category breakdown
 *  5. Special patient-type breakdown
 *  6. Key Learning Points (EBM statements) with star rating + category filter
 *  7. Sortable detail table with per-code sparkline
 */

import { getIcdFreq, getSessions, getPatientTypeFreq, getEbmStars, setEbmStar, navigate, esc } from '../app.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function fmt(date) { return date ? String(date).slice(0, 10) : '—'; }

function filterByRange(codes, from, to) {
  if (!from && !to) return codes.map(c => ({ ...c }));
  return codes.map(c => {
    const hist = (c.history || []).filter(h => {
      if (from && h.date < from) return false;
      if (to   && h.date > to)   return false;
      return true;
    });
    const count    = hist.reduce((s, h) => s + h.count, 0);
    const lastUsed = hist.length ? hist[hist.length - 1].date : null;
    return { ...c, count, lastUsed: lastUsed || c.lastUsed, filteredHist: hist };
  }).filter(c => c.count > 0);
}

function exportCsv(rows) {
  const headers = ['Code', 'English', 'Chinese', 'Category', 'Total Uses', 'Last Used'];
  const lines   = [headers, ...rows.map(r => [
    r.code, r.en, r.zh, r.categoryName || r.categoryId, r.count, fmt(r.lastUsed),
  ])].map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `medical-stats-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* Main render                                                          */
/* ------------------------------------------------------------------ */

export function renderMedicalStats() {
  const container   = document.getElementById('main-content');
  const allFreq     = getIcdFreq();
  const allCodes    = Object.values(allFreq);
  const sessions    = getSessions();
  const ptFreq      = getPatientTypeFreq();

  container.innerHTML = `
    <h2 class="page-title">📊 Medical Data Statistics</h2>
    <p class="subtitle">Frequency analysis, patient types, and key learning points — stored locally.</p>

    ${allCodes.length === 0 ? `
      <div class="card">
        <p class="no-records" style="font-size:1rem;padding:.5rem 0">
          No data yet. Save OPD entries to start tracking statistics.
        </p>
        <button class="btn btn-primary" id="btn-go-new">📝 New OPD Entry</button>
      </div>` : buildStatsPage(allCodes, sessions, ptFreq)}
  `;

  if (allCodes.length === 0) {
    container.querySelector('#btn-go-new')?.addEventListener('click', () => navigate('log'));
    return;
  }

  mountInteractivity(container, allCodes, sessions, ptFreq);
}

/* ------------------------------------------------------------------ */
/* Build full stats page HTML                                           */
/* ------------------------------------------------------------------ */

function buildStatsPage(allCodes, sessions, ptFreq) {
  const total     = allCodes.reduce((s, c) => s + c.count, 0);
  const topCode   = allCodes.reduce((a, b) => a.count > b.count ? a : b, allCodes[0]);
  const allDates  = allCodes.flatMap(c => (c.history || []).map(h => h.date)).sort();
  const firstDate = allDates[0] || '';
  const lastDate  = allDates[allDates.length - 1] || '';

  /* Category breakdown */
  const catMap = {};
  allCodes.forEach(c => {
    const key = c.categoryName || c.categoryId || 'Unknown';
    catMap[key] = (catMap[key] || 0) + c.count;
  });
  const catRows = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  const maxCat  = catRows[0]?.[1] || 1;

  /* Patient type breakdown */
  const ptRows  = Object.entries(ptFreq).sort((a, b) => b[1].count - a[1].count);
  const maxPt   = ptRows[0]?.[1]?.count || 1;

  /* Key Learning Points from sessions */
  const klpMap = {};
  sessions.forEach(s => {
    const text = s.keyLearning || s.ebm;
    if (!text?.trim()) return;
    const cat  = s.categoryName || s.categoryId || 'General';
    const key  = text.trim();
    if (!klpMap[key]) klpMap[key] = { text: key, category: cat, sessionId: s.id, count: 0 };
    klpMap[key].count += 1;
  });
  const klpList = Object.values(klpMap).sort((a, b) => b.count - a.count);
  const klpCats = ['All', ...new Set(klpList.map(k => k.category))];

  return `
    <!-- Summary KPIs -->
    <div class="stats-grid" style="margin-bottom:1rem">
      <div class="stat-card">
        <div class="stat-value">${allCodes.length}</div>
        <div class="stat-label">Unique ICD Codes</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${total}</div>
        <div class="stat-label">Total Recorded Uses</div>
      </div>
      <div class="stat-card" title="${esc(topCode.en)}">
        <div class="stat-value" style="font-size:1.35rem">${esc(topCode.code)}</div>
        <div class="stat-label">Most-Used Code (×${topCode.count})</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${sessions.length}</div>
        <div class="stat-label">Total OPD Entries</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${Object.keys(catMap).length}</div>
        <div class="stat-label">Categories</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${ptRows.length}</div>
        <div class="stat-label">Patient Types</div>
      </div>
    </div>

    <!-- Date range filter -->
    <div class="card stats-filter-card">
      <div class="stats-filter-row">
        <label class="field-label" style="white-space:nowrap">📅 Date range:</label>
        <input class="field-input stats-date-input" type="date" id="stats-from" placeholder="From">
        <span style="color:var(--color-muted)">—</span>
        <input class="field-input stats-date-input" type="date" id="stats-to" placeholder="To">
        <button class="btn btn-sm-inline" id="stats-range-7">Last 7 days</button>
        <button class="btn btn-sm-inline" id="stats-range-30">Last 30 days</button>
        <button class="btn btn-sm-inline" id="stats-range-all">All time</button>
        <button class="btn btn-outline" id="stats-export-csv" style="margin-left:auto">⬇️ Export CSV</button>
      </div>
    </div>

    <!-- Top codes bar chart -->
    <div class="card" id="stats-chart-card">
      <div class="card-title">📈 Top ICD Codes by Use
        <span class="hint" style="font-weight:400" id="stats-chart-subtitle">(all time)</span>
      </div>
      <div id="stats-bar-chart"></div>
    </div>

    <!-- Category breakdown -->
    <div class="card">
      <div class="card-title">🗂️ Category Breakdown</div>
      <div class="bar-chart-wrap">
        ${catRows.map(([name, count]) => `
          <div class="bar-row">
            <span class="bar-label">${esc(name)}</span>
            <div class="bar-track">
              <div class="bar-fill" style="width:${Math.round(count / maxCat * 100)}%">
                <span class="bar-val">${count}</span>
              </div>
            </div>
          </div>`).join('')}
      </div>
    </div>

    <!-- Special patient type breakdown -->
    <div class="card">
      <div class="card-title">👤 Special Patient Types</div>
      ${ptRows.length === 0
        ? '<p class="no-records">No patient type data yet. Tag entries with a patient type when saving.</p>'
        : `<div class="bar-chart-wrap">
          ${ptRows.map(([type, d]) => `
            <div class="bar-row">
              <span class="bar-label">${esc(type)}</span>
              <div class="bar-track">
                <div class="bar-fill" style="width:${Math.round(d.count / maxPt * 100)}%">
                  <span class="bar-val">${d.count}</span>
                </div>
              </div>
              <span class="hint" style="margin-left:.5rem">last: ${fmt(d.lastUsed)}</span>
            </div>`).join('')}
          </div>`}
    </div>

    <!-- Key Learning Points (EBM statements) -->
    <div class="card" id="klp-card">
      <div class="card-title">
        💡 Key Learning Points (EBM)
        <span class="hint" style="font-weight:400;margin-left:.5rem">
          — filter by category:
          <select id="klp-cat-filter" class="field-input" style="width:auto;display:inline-block;padding:.2rem .5rem;font-size:.82rem;margin-left:.35rem">
            ${klpCats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          </select>
        </span>
      </div>
      <div id="klp-list">
        ${buildKlpList(klpList, 'All')}
      </div>
    </div>

    <!-- Detailed sortable table -->
    <div class="card">
      <div class="card-title">📋 All Codes Detail
        <span class="hint" style="font-weight:400;margin-left:.5rem" id="stats-table-count"></span>
      </div>
      <div class="stats-table-wrap" id="stats-table-wrap"></div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Key Learning Points list                                             */
/* ------------------------------------------------------------------ */

function buildKlpList(klpList, catFilter) {
  const ebmStars = getEbmStars();
  const filtered = catFilter === 'All' ? klpList : klpList.filter(k => k.category === catFilter);
  if (!filtered.length) return '<p class="no-records">No key learning points recorded yet.</p>';

  return `<div class="klp-list">
    ${filtered.map((k, i) => {
      const stars  = ebmStars[k.text] || 0;
      const starHtml = [1,2,3,4,5].map(n =>
        `<button class="klp-star${stars >= n ? ' active' : ''}" data-key="${esc(k.text)}" data-rating="${n}">★</button>`
      ).join('');
      return `<div class="klp-item">
        <div class="klp-item-top">
          <span class="klp-cat-tag">${esc(k.category)}</span>
          <span class="klp-count hint">×${k.count}</span>
          <div class="klp-stars">${starHtml}</div>
        </div>
        <div class="klp-text">${esc(k.text)}</div>
      </div>`;
    }).join('')}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Interactivity                                                        */
/* ------------------------------------------------------------------ */

function mountInteractivity(container, allCodes, sessions, ptFreq) {
  let sortCol  = 'count';
  let sortDir  = 'desc';
  let fromDate = '';
  let toDate   = '';

  const klpMap = {};
  sessions.forEach(s => {
    const text = s.keyLearning || s.ebm;
    if (!text?.trim()) return;
    const cat  = s.categoryName || s.categoryId || 'General';
    const key  = text.trim();
    if (!klpMap[key]) klpMap[key] = { text: key, category: cat, sessionId: s.id, count: 0 };
    klpMap[key].count += 1;
  });
  const klpList = Object.values(klpMap).sort((a, b) => b.count - a.count);

  function getFiltered() {
    return filterByRange(allCodes, fromDate, toDate)
      .sort((a, b) => {
        let av = a[sortCol] ?? '';
        let bv = b[sortCol] ?? '';
        if (typeof av === 'number') return sortDir === 'desc' ? bv - av : av - bv;
        av = String(av).toLowerCase();
        bv = String(bv).toLowerCase();
        return sortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
      });
  }

  function refresh() {
    const filtered   = getFiltered();
    const maxCount   = filtered[0]?.count || 1;
    const top10      = filtered.slice(0, 10);
    const rangeLabel = fromDate || toDate
      ? ` (${fromDate || '…'} — ${toDate || '…'})`
      : ' (all time)';

    const subtitle = container.querySelector('#stats-chart-subtitle');
    if (subtitle) subtitle.textContent = rangeLabel;

    const chartEl = container.querySelector('#stats-bar-chart');
    if (chartEl) {
      chartEl.innerHTML = !top10.length
        ? '<p class="no-records">No data for this range.</p>'
        : `<div class="bar-chart-wrap">${
            top10.map(c => `
              <div class="bar-row">
                <span class="bar-label"><span class="tag tag-code">${esc(c.code)}</span> ${esc((c.en || '').slice(0, 30))}${(c.en||'').length > 30 ? '…' : ''}</span>
                <div class="bar-track">
                  <div class="bar-fill" style="width:${Math.round(c.count / maxCount * 100)}%">
                    <span class="bar-val">${c.count}</span>
                  </div>
                </div>
              </div>`).join('')
          }</div>`;
    }

    const tableWrap  = container.querySelector('#stats-table-wrap');
    const tableCount = container.querySelector('#stats-table-count');
    if (tableCount) tableCount.textContent = `${filtered.length} code${filtered.length !== 1 ? 's' : ''}`;
    if (tableWrap) {
      tableWrap.innerHTML = buildTable(filtered, sortCol, sortDir);
      tableWrap.querySelectorAll('[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
          const col = th.dataset.sort;
          if (sortCol === col) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
          else { sortCol = col; sortDir = 'desc'; }
          refresh();
        });
      });
      tableWrap.querySelectorAll('[data-detail-code]').forEach(btn => {
        btn.addEventListener('click', () => {
          const code      = btn.dataset.detailCode;
          const codeData  = allCodes.find(c => c.code === code);
          const detailRow = tableWrap.querySelector(`[data-detail-row="${code}"]`);
          if (!detailRow || !codeData) return;
          if (detailRow.classList.contains('hidden')) {
            detailRow.innerHTML = buildDetailRow(codeData, fromDate, toDate);
            detailRow.classList.remove('hidden');
            btn.textContent = '▲';
          } else {
            detailRow.classList.add('hidden');
            btn.textContent = '▼';
          }
        });
      });
    }
  }

  /* Date range controls */
  const fromEl = container.querySelector('#stats-from');
  const toEl   = container.querySelector('#stats-to');
  fromEl?.addEventListener('change', () => { fromDate = fromEl.value; refresh(); });
  toEl?.addEventListener('change',   () => { toDate   = toEl.value;   refresh(); });

  container.querySelector('#stats-range-7')?.addEventListener('click', () => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    fromDate = d.toISOString().slice(0, 10);
    toDate   = new Date().toISOString().slice(0, 10);
    if (fromEl) fromEl.value = fromDate;
    if (toEl)   toEl.value   = toDate;
    refresh();
  });
  container.querySelector('#stats-range-30')?.addEventListener('click', () => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    fromDate = d.toISOString().slice(0, 10);
    toDate   = new Date().toISOString().slice(0, 10);
    if (fromEl) fromEl.value = fromDate;
    if (toEl)   toEl.value   = toDate;
    refresh();
  });
  container.querySelector('#stats-range-all')?.addEventListener('click', () => {
    fromDate = '';  toDate = '';
    if (fromEl) fromEl.value = '';
    if (toEl)   toEl.value   = '';
    refresh();
  });

  container.querySelector('#stats-export-csv')?.addEventListener('click', () => exportCsv(getFiltered()));

  /* KLP category filter */
  const klpCatFilter = container.querySelector('#klp-cat-filter');
  klpCatFilter?.addEventListener('change', () => {
    const listEl = container.querySelector('#klp-list');
    if (listEl) listEl.innerHTML = buildKlpList(klpList, klpCatFilter.value);
    wireKlpStars(container, klpList, klpCatFilter);
  });

  wireKlpStars(container, klpList, klpCatFilter);
  refresh();
}

function wireKlpStars(container, klpList, klpCatFilter) {
  container.querySelectorAll('.klp-star').forEach(btn => {
    btn.addEventListener('click', () => {
      const key    = btn.dataset.key;
      const rating = parseInt(btn.dataset.rating, 10);
      setEbmStar(key, rating);
      /* Re-render KLP list */
      const listEl = container.querySelector('#klp-list');
      if (listEl) listEl.innerHTML = buildKlpList(klpList, klpCatFilter?.value || 'All');
      wireKlpStars(container, klpList, klpCatFilter);
    });
  });
}

/* ------------------------------------------------------------------ */
/* Table builder                                                        */
/* ------------------------------------------------------------------ */

function sortIcon(col, sortCol, sortDir) {
  if (col !== sortCol) return ' <span class="sort-icon">⇅</span>';
  return sortDir === 'desc' ? ' <span class="sort-icon sort-active">▼</span>'
                            : ' <span class="sort-icon sort-active">▲</span>';
}

function buildTable(rows, sortCol, sortDir) {
  const cols = [
    { key: 'code',         label: 'Code'      },
    { key: 'en',           label: 'English'   },
    { key: 'zh',           label: '中文'      },
    { key: 'categoryName', label: 'Category'  },
    { key: 'count',        label: 'Uses'      },
    { key: 'lastUsed',     label: 'Last Used' },
  ];

  return `
    <table class="code-table stats-table">
      <thead>
        <tr>
          ${cols.map(c => `
            <th data-sort="${c.key}" style="cursor:pointer;user-select:none">
              ${c.label}${sortIcon(c.key, sortCol, sortDir)}
            </th>`).join('')}
          <th style="width:40px"></th>
        </tr>
      </thead>
      <tbody>
        ${rows.length === 0
          ? `<tr><td colspan="7" class="no-records" style="padding:.75rem">No data for this range.</td></tr>`
          : rows.map(r => `
            <tr>
              <td><span class="tag tag-code">${esc(r.code)}</span></td>
              <td class="code-en">${esc(r.en)}</td>
              <td class="code-zh">${esc(r.zh)}</td>
              <td>${esc(r.categoryName || r.categoryId || '—')}</td>
              <td><span class="stats-count-badge">${r.count}</span></td>
              <td class="hint">${fmt(r.lastUsed)}</td>
              <td style="text-align:center">
                <button class="btn-sm" data-detail-code="${esc(r.code)}" title="Show daily history">▼</button>
              </td>
            </tr>
            <tr class="detail-row hidden" data-detail-row="${esc(r.code)}">
              <td colspan="7"></td>
            </tr>`).join('')}
      </tbody>
    </table>`;
}

function buildDetailRow(codeData, fromDate, toDate) {
  const hist = (codeData.history || [])
    .filter(h => {
      if (fromDate && h.date < fromDate) return false;
      if (toDate   && h.date > toDate)   return false;
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!hist.length) {
    return `<td colspan="7" style="padding:.5rem 1rem">
      <span class="hint">No history data for this date range.</span>
    </td>`;
  }

  const maxH = Math.max(...hist.map(h => h.count));

  return `<td colspan="7" style="padding:.5rem 1rem 1rem">
    <div class="detail-title">
      📅 Daily use history for <span class="tag tag-code">${esc(codeData.code)}</span>
      — ${esc(codeData.en)}
    </div>
    <div class="detail-sparkline">
      ${hist.map(h => `
        <div class="spark-col" title="${esc(h.date)}: ${h.count} use${h.count !== 1 ? 's' : ''}">
          <div class="spark-bar" style="height:${Math.round(h.count / maxH * 48)}px"></div>
          <div class="spark-label">${h.date.slice(5)}</div>
        </div>`).join('')}
    </div>
    <div class="hint" style="margin-top:.35rem">
      Total in range: ${hist.reduce((s, h) => s + h.count, 0)} uses across ${hist.length} day${hist.length !== 1 ? 's' : ''}
    </div>
  </td>`;
}
