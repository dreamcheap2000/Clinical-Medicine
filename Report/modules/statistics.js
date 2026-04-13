/**
 * statistics.js
 * Renders the statistics dashboard using Chart.js (loaded from CDN).
 */

import { getReports, EXAM_TYPES } from '../app.js';

export function renderStatistics() {
  const container = document.getElementById('main-content');
  const reports   = getReports();

  // --- Compute stats ---
  const totalByType = computeTotalByType(reports);
  const totalReports = reports.length;
  const totalAbnormal = reports.filter(r => r.tags && r.tags.length > 0).length;
  const uniquePatients = new Set(reports.map(r => r.patientId).filter(Boolean)).size;
  const tagFreq = computeTagFrequency(reports);

  container.innerHTML = `
    <h2 class="page-title">📊 Statistics Dashboard</h2>

    <!-- Summary cards -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${totalReports}</div>
        <div class="stat-label">Total Reports</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${uniquePatients}</div>
        <div class="stat-label">Unique Patients</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${totalAbnormal}</div>
        <div class="stat-label">With Abnormalities</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${totalReports > 0 ? Math.round(totalAbnormal / totalReports * 100) : 0}%</div>
        <div class="stat-label">Abnormality Rate</div>
      </div>
    </div>

    <!-- Filters for charts -->
    <div class="card" style="padding:.8rem 1.2rem;margin-bottom:.8rem;">
      <div class="filter-row">
        <div class="form-group">
          <label>From</label>
          <input type="date" id="stat-date-from" class="form-control">
        </div>
        <div class="form-group">
          <label>To</label>
          <input type="date" id="stat-date-to" class="form-control">
        </div>
        <div class="form-group">
          <label>Exam Type</label>
          <select id="stat-type" class="form-control">
            <option value="">All</option>
            ${Object.entries(EXAM_TYPES).map(([k,v]) => `<option value="${k}">${v.title}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-apply-stats">Apply</button>
        <button class="btn btn-secondary btn-sm" id="btn-reset-stats">Reset</button>
      </div>
    </div>

    <!-- Charts -->
    <div class="chart-grid">
      <div class="chart-box">
        <h3>Reports by Exam Type</h3>
        <canvas id="chart-by-type"></canvas>
      </div>
      <div class="chart-box">
        <h3>Abnormality Flags (Top 10)</h3>
        <canvas id="chart-tags"></canvas>
      </div>
      <div class="chart-box" style="grid-column: 1 / -1">
        <h3>Reports Over Time (monthly)</h3>
        <canvas id="chart-over-time"></canvas>
      </div>
      <div class="chart-box">
        <h3>Abnormality Rate by Exam Type</h3>
        <canvas id="chart-abnorm-rate"></canvas>
      </div>
      <div class="chart-box">
        <h3>Procedure / Method Evolution</h3>
        <canvas id="chart-version"></canvas>
      </div>
    </div>

    <!-- Top tags table -->
    <div class="card">
      <div class="card-title">Most Frequent Findings / Tags</div>
      <table class="report-table">
        <thead><tr><th>Tag / Finding</th><th>Count</th><th>% of Reports</th></tr></thead>
        <tbody id="tag-table-body"></tbody>
      </table>
    </div>
  `;

  // Wire filter buttons
  document.getElementById('btn-apply-stats').addEventListener('click', () => redrawCharts(getFilteredReports()));
  document.getElementById('btn-reset-stats').addEventListener('click', () => {
    document.getElementById('stat-date-from').value = '';
    document.getElementById('stat-date-to').value   = '';
    document.getElementById('stat-type').value      = '';
    redrawCharts(reports);
  });

  redrawCharts(reports);
}

/* ------------------------------------------------------------------ */

function getFilteredReports() {
  const from = document.getElementById('stat-date-from')?.value || '';
  const to   = document.getElementById('stat-date-to')?.value   || '';
  const type = document.getElementById('stat-type')?.value      || '';
  return getReports().filter(r => {
    if (type && r.examType !== type) return false;
    if (from && r.examDate < from) return false;
    if (to   && r.examDate > to)   return false;
    return true;
  });
}

let _charts = {};

function destroyCharts() {
  Object.values(_charts).forEach(c => { try { c.destroy(); } catch(e) {} });
  _charts = {};
}

function redrawCharts(reports) {
  destroyCharts();

  const totalReports = reports.length;

  // --- By exam type (bar) ---
  const byType = computeTotalByType(reports);
  _charts.byType = new Chart(document.getElementById('chart-by-type'), {
    type: 'bar',
    data: {
      labels: Object.keys(byType),
      datasets: [{
        label: 'Reports',
        data: Object.values(byType),
        backgroundColor: PALETTE,
        borderRadius: 4,
      }]
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
  });

  // --- Tag frequency (horizontal bar) ---
  const tagFreq = computeTagFrequency(reports);
  const top10tags  = Object.entries(tagFreq).sort((a,b) => b[1]-a[1]).slice(0, 10);
  _charts.tags = new Chart(document.getElementById('chart-tags'), {
    type: 'bar',
    data: {
      labels: top10tags.map(([t]) => truncate(t, 30)),
      datasets: [{
        label: 'Count',
        data: top10tags.map(([,c]) => c),
        backgroundColor: '#e74c3c99',
        borderColor: '#c0392b',
        borderWidth: 1,
        borderRadius: 3,
      }]
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
    }
  });

  // --- Over time (line) ---
  const monthly = computeMonthly(reports);
  _charts.time = new Chart(document.getElementById('chart-over-time'), {
    type: 'line',
    data: {
      labels: Object.keys(monthly),
      datasets: [
        {
          label: 'Total Reports',
          data: Object.values(monthly).map(m => m.total),
          borderColor: '#1a6fa8',
          backgroundColor: '#1a6fa820',
          fill: true,
          tension: .3,
        },
        {
          label: 'With Abnormalities',
          data: Object.values(monthly).map(m => m.abnormal),
          borderColor: '#c0392b',
          backgroundColor: '#c0392b10',
          fill: false,
          tension: .3,
        }
      ]
    },
    options: {
      plugins: { legend: { position: 'top' } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
    }
  });

  // --- Abnormality rate by type (doughnut) ---
  const rateByType = computeAbnormalityRateByType(reports);
  _charts.rate = new Chart(document.getElementById('chart-abnorm-rate'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(rateByType),
      datasets: [{
        data: Object.values(rateByType),
        backgroundColor: PALETTE,
      }]
    },
    options: {
      plugins: {
        legend: { position: 'right' },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.raw.toFixed(0)}%`
          }
        }
      }
    }
  });

  // --- Version / procedure evolution ---
  const versionData = computeVersionTimeline(reports);
  _charts.version = new Chart(document.getElementById('chart-version'), {
    type: 'bar',
    data: {
      labels: versionData.labels,
      datasets: versionData.datasets
    },
    options: {
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });

  // --- Tag table ---
  const tbody = document.getElementById('tag-table-body');
  if (tbody) {
    const allTags = Object.entries(tagFreq).sort((a,b) => b[1]-a[1]);
    if (allTags.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="no-records">No classification tags yet.</td></tr>`;
    } else {
      tbody.innerHTML = allTags.map(([tag, count]) => `
        <tr>
          <td><span class="tag tag-abnormal">${esc(tag)}</span></td>
          <td>${count}</td>
          <td>${totalReports > 0 ? (count / totalReports * 100).toFixed(1) : 0}%</td>
        </tr>`).join('');
    }
  }
}

/* ------------------------------------------------------------------ */
/* Aggregation helpers                                                  */
/* ------------------------------------------------------------------ */

function computeTotalByType(reports) {
  const counts = {};
  for (const r of reports) {
    const label = EXAM_TYPES[r.examType]?.title || r.examType;
    counts[label] = (counts[label] || 0) + 1;
  }
  return counts;
}

function computeTagFrequency(reports) {
  const freq = {};
  for (const r of reports) {
    for (const tag of (r.tags || [])) {
      freq[tag] = (freq[tag] || 0) + 1;
    }
  }
  return freq;
}

function computeMonthly(reports) {
  const months = {};
  for (const r of reports) {
    const ym = (r.examDate || '').slice(0, 7); // YYYY-MM
    if (!ym) continue;
    if (!months[ym]) months[ym] = { total: 0, abnormal: 0 };
    months[ym].total++;
    if (r.tags && r.tags.length > 0) months[ym].abnormal++;
  }
  // Sort by month
  return Object.fromEntries(Object.entries(months).sort((a,b) => a[0].localeCompare(b[0])));
}

function computeAbnormalityRateByType(reports) {
  const byType = {};
  for (const r of reports) {
    const label = EXAM_TYPES[r.examType]?.title || r.examType;
    if (!byType[label]) byType[label] = { total: 0, abnormal: 0 };
    byType[label].total++;
    if (r.tags && r.tags.length > 0) byType[label].abnormal++;
  }
  const rates = {};
  for (const [t, d] of Object.entries(byType)) {
    rates[t] = d.total > 0 ? (d.abnormal / d.total * 100) : 0;
  }
  return rates;
}

function computeVersionTimeline(reports) {
  // Group by month × examType × templateVersion
  const data = {};
  const examTypes = new Set();
  for (const r of reports) {
    const ym    = (r.examDate || '').slice(0, 7);
    const label = `${EXAM_TYPES[r.examType]?.title || r.examType} v${r.templateVersion || '?'}`;
    if (!ym) continue;
    if (!data[ym]) data[ym] = {};
    data[ym][label] = (data[ym][label] || 0) + 1;
    examTypes.add(label);
  }

  const sortedMonths = Object.keys(data).sort();
  const labels       = sortedMonths;
  const seriesLabels = [...examTypes];

  const datasets = seriesLabels.map((lbl, i) => ({
    label: lbl,
    data: sortedMonths.map(m => data[m]?.[lbl] || 0),
    backgroundColor: PALETTE[i % PALETTE.length],
  }));

  return { labels, datasets };
}

/* ------------------------------------------------------------------ */
const PALETTE = [
  '#1a6fa8','#2eaa6e','#e67e22','#9b59b6','#c0392b',
  '#16a085','#d35400','#2980b9','#8e44ad','#27ae60'
];

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
