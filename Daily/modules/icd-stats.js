/**
 * modules/icd-stats.js
 * ICD-10 usage frequency statistics page.
 * Shows usage counts, bar charts, category breakdown, per-code history and CSV export.
 */

import { getIcdFreq, navigate, esc } from '../app.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function fmt(date) { return date ? String(date).slice(0, 10) : '—'; }

function filterByRange(codes, from, to) {
  if (!from && !to) return codes.map(c => ({ ...c }));
  return codes.map(c => {
    if (!from && !to) return { ...c };
    /* Recalculate count from history within range */
    const hist = (c.history || []).filter(h => {
      if (from && h.date < from) return false;
      if (to   && h.date > to)   return false;
      return true;
    });
    const count = hist.reduce((s, h) => s + h.count, 0);
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
    download: `icd-stats-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* Main render                                                          */
/* ------------------------------------------------------------------ */

export function renderIcdStats() {
  const container = document.getElementById('main-content');
  const allFreq   = getIcdFreq();
  const allCodes  = Object.values(allFreq);

  container.innerHTML = `
    <h2 class="page-title">📊 ICD-10 Usage Statistics</h2>
    <p class="subtitle">Frequency analysis of ICD-10 codes used in your OPD sessions (stored locally).</p>

    ${allCodes.length === 0 ? `
      <div class="card">
        <p class="no-records" style="font-size:1rem;padding:.5rem 0">
          No ICD code data yet. Save OPD entries with ICD codes to start tracking usage.
        </p>
        <button class="btn btn-primary" id="btn-go-new">📝 New OPD Entry</button>
      </div>` : buildStatsPage(allCodes)}
  `;

  if (allCodes.length === 0) {
    container.querySelector('#btn-go-new')?.addEventListener('click', () => navigate('log'));
    return;
  }

  mountStatsInteractivity(container, allCodes);
}

/* ------------------------------------------------------------------ */
/* Build full stats page HTML                                           */
/* ------------------------------------------------------------------ */

function buildStatsPage(allCodes) {
  const total       = allCodes.reduce((s, c) => s + c.count, 0);
  const topCode     = allCodes.reduce((a, b) => a.count > b.count ? a : b, allCodes[0]);
  const allDates    = allCodes.flatMap(c => (c.history || []).map(h => h.date)).sort();
  const firstDate   = allDates[0] || '';
  const lastDate    = allDates[allDates.length - 1] || '';

  /* Category breakdown */
  const catMap = {};
  allCodes.forEach(c => {
    const key = c.categoryName || c.categoryId || 'Unknown';
    catMap[key] = (catMap[key] || 0) + c.count;
  });
  const catRows = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  const maxCat  = catRows[0]?.[1] || 1;

  return `
    <!-- Summary stats -->
    <div class="stats-grid" style="margin-bottom:1rem">
      <div class="stat-card">
        <div class="stat-value">${allCodes.length}</div>
        <div class="stat-label">Unique Codes</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${total}</div>
        <div class="stat-label">Total Recorded Uses</div>
      </div>
      <div class="stat-card" style="cursor:default" title="${esc(topCode.en)}">
        <div class="stat-value" style="font-size:1.35rem">${esc(topCode.code)}</div>
        <div class="stat-label">Most-Used Code (×${topCode.count})</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="font-size:1.1rem">${Object.keys(catMap).length}</div>
        <div class="stat-label">Categories Covered</div>
      </div>
    </div>

    <!-- Date range filter -->
    <div class="card stats-filter-card">
      <div class="stats-filter-row">
        <label class="field-label" style="white-space:nowrap">📅 Date range:</label>
        <input class="field-input stats-date-input" type="date" id="stats-from" value="" placeholder="From">
        <span style="color:var(--color-muted)">—</span>
        <input class="field-input stats-date-input" type="date" id="stats-to" value="" placeholder="To">
        <button class="btn btn-sm-inline" id="stats-range-7">Last 7 days</button>
        <button class="btn btn-sm-inline" id="stats-range-30">Last 30 days</button>
        <button class="btn btn-sm-inline" id="stats-range-all">All time</button>
        <button class="btn btn-outline" id="stats-export-csv" style="margin-left:auto">⬇️ Export CSV</button>
      </div>
    </div>

    <!-- Top codes bar chart -->
    <div class="card" id="stats-chart-card">
      <div class="card-title">📈 Top Codes by Use <span class="hint" style="font-weight:400" id="stats-chart-subtitle">(all time)</span></div>
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
/* Interactivity: filter, sort, drill-down, export                     */
/* ------------------------------------------------------------------ */

function mountStatsInteractivity(container, allCodes) {
  let sortCol = 'count';
  let sortDir = 'desc';
  let fromDate = '';
  let toDate   = '';

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
    const filtered  = getFiltered();
    const maxCount  = filtered[0]?.count || 1;
    const top10     = filtered.slice(0, 10);
    const rangeLabel = fromDate || toDate
      ? ` (${fromDate || '…'} — ${toDate || '…'})`
      : ' (all time)';

    /* Bar chart */
    const chartEl = container.querySelector('#stats-bar-chart');
    const subtitle = container.querySelector('#stats-chart-subtitle');
    if (subtitle) subtitle.textContent = rangeLabel;
    if (chartEl) {
      if (!top10.length) {
        chartEl.innerHTML = '<p class="no-records">No data for this range.</p>';
      } else {
        chartEl.innerHTML = `<div class="bar-chart-wrap">${
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
    }

    /* Table */
    const tableWrap  = container.querySelector('#stats-table-wrap');
    const tableCount = container.querySelector('#stats-table-count');
    if (tableCount) tableCount.textContent = `${filtered.length} code${filtered.length !== 1 ? 's' : ''}`;
    if (tableWrap) {
      tableWrap.innerHTML = buildTable(filtered, sortCol, sortDir);
      /* Sort header clicks */
      tableWrap.querySelectorAll('[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
          const col = th.dataset.sort;
          if (sortCol === col) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
          else { sortCol = col; sortDir = 'desc'; }
          refresh();
        });
      });
      /* Row detail toggle */
      tableWrap.querySelectorAll('[data-detail-code]').forEach(btn => {
        btn.addEventListener('click', () => {
          const code  = btn.dataset.detailCode;
          const codeData = allCodes.find(c => c.code === code);
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
    fromDate = '';
    toDate   = '';
    if (fromEl) fromEl.value = '';
    if (toEl)   toEl.value   = '';
    refresh();
  });

  container.querySelector('#stats-export-csv')?.addEventListener('click', () => {
    exportCsv(getFiltered());
  });

  /* Initial render */
  refresh();
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

/* ------------------------------------------------------------------ */
/* Per-code detail row (daily history sparkline)                       */
/* ------------------------------------------------------------------ */

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
