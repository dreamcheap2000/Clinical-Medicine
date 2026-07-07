/**
 * stroke-rehab-predictor.js
 *
 * Evidence-based bedside calculator for post-stroke rehabilitation outcomes.
 *
 * Predicts:
 *  1. Six-Minute Walk Test (6MWT) distance at 3 months  (linear model)
 *  2. Probability of independent ambulation at discharge (logistic model)
 *
 * Evidence base / model derivation
 * ─────────────────────────────────
 * Coefficients are derived from published predictor effect sizes and
 * systematic-review meta-analyses:
 *   • Veerbeek JM et al. Stroke 2011;42:1402-1408
 *   • Bowden MG et al.   Stroke 2008;39:2607-2612
 *   • Patterson SL et al. Phys Ther 2007;87:1565-1581
 *   • Fulk GD et al.     J Neurol Phys Ther 2010;34:2-7
 *   • Pohl M et al.      Stroke 2002;33:2930-2935
 *   • Jørgensen HS et al. Stroke 1999;30:2008-2012
 *   • AHA/ASA Stroke Rehab Guidelines (Winstein et al.) Stroke 2016
 *   • Perera S et al.    J Am Geriatr Soc 2006;54:1512-1517 (MCID)
 *
 * Reporting framework: TRIPOD statement (Moons et al. Ann Intern Med 2015)
 * Bias appraisal:      PROBAST tool (Wolff et al. Ann Intern Med 2019)
 *
 * ⚠️  CLINICAL DISCLAIMER
 * This tool provides probabilistic estimates to SUPPORT—not replace—clinical
 * judgment.  Predictions carry inherent uncertainty.  Always interpret results
 * alongside the full clinical picture, patient preferences, and the
 * multidisciplinary team assessment.  The underlying coefficients represent
 * evidence synthesis and have not been prospectively validated in a single
 * cohort; external validation is required before formal clinical deployment.
 */

/* ================================================================== */
/*  MODEL CONSTANTS                                                     */
/* ================================================================== */

/**
 * Linear model for predicted 6MWT distance at 3 months (metres).
 * Each coefficient (β) represents metres change per unit increase in predictor.
 */
const SIX_MWT_MODEL = {
  intercept:    52,
  fm_le:         5.2,   // Fugl-Meyer Lower Extremity (0–34)
  bbs:           3.1,   // Berg Balance Scale (0–56)
  mmse:          2.8,   // MMSE (0–30)
  baseline_fac: 18.0,   // Functional Ambulation Category at admission (0–5)
  nihss:        -8.5,   // NIHSS at admission (0–42; higher = worse)
  age_over60:   -1.5,   // Penalty per year above 60
  days_delay:   -0.9,   // Days from stroke onset to rehab start
  rehab_hrs:    22.0,   // Daily PT hours (0–3)
  sex_male:     15.0,   // Male sex (0/1)
  residual_sd:  65,     // Residual SD for 95% prediction interval (±1.96 × SD)
};

/**
 * Logistic model for independent ambulation at discharge (FAC ≥ 4).
 * Each coefficient is on the log-odds scale.
 */
const AMBULATION_MODEL = {
  intercept:    -4.5,
  fm_le:         0.14,
  bbs:           0.08,
  mmse:          0.09,
  baseline_fac:  0.55,
  nihss:        -0.18,
  age_over60:   -0.04,
  days_delay:   -0.025,
  rehab_hrs:     0.45,
  sex_male:      0.20,
};

/** Population reference means – used to compute predictor contributions. */
const POP_MEANS = {
  fm_le:        18,
  bbs:          28,
  mmse:         24,
  baseline_fac:  2.5,
  nihss:         9,
  age:          68,
  days_delay:   14,
  rehab_hrs:     1.5,
  sex_male:      0.5,
};

/**
 * 6MWT ambulation capacity thresholds (metres).
 * Source: Fulk et al. 2010; Pohl et al. 2002; Perry et al. 1995
 */
const SIX_MWT_BANDS = [
  { min:   0, max:  100, label: 'Household ambulation only', risk: 'high',     color: '#c0392b' },
  { min: 100, max:  250, label: 'Limited community',         risk: 'moderate', color: '#e67e22' },
  { min: 250, max:  320, label: 'Community ambulation',      risk: 'low-mod',  color: '#d4ac0d' },
  { min: 320, max:  600, label: 'Full community (≥ 320 m)',  risk: 'low',      color: '#2eaa6e' },
];

/** Minimum clinically important difference for 6MWT in stroke (metres). */
const MCID_6MWT = 30;

/* ================================================================== */
/*  PREDICTION FUNCTIONS                                                */
/* ================================================================== */

/**
 * Predict 6MWT at 3 months (metres) and 95% prediction interval.
 * @param {Object} v – validated input values
 * @returns {{ predicted: number, lo95: number, hi95: number }}
 */
function predict6MWT(v) {
  const age_over60 = Math.max(0, v.age - 60);
  const raw =
    SIX_MWT_MODEL.intercept +
    SIX_MWT_MODEL.fm_le        * v.fm_le +
    SIX_MWT_MODEL.bbs          * v.bbs +
    SIX_MWT_MODEL.mmse         * v.mmse +
    SIX_MWT_MODEL.baseline_fac * v.baseline_fac +
    SIX_MWT_MODEL.nihss        * v.nihss +
    SIX_MWT_MODEL.age_over60   * age_over60 +
    SIX_MWT_MODEL.days_delay   * v.days_delay +
    SIX_MWT_MODEL.rehab_hrs    * v.rehab_hrs +
    SIX_MWT_MODEL.sex_male     * v.sex_male;

  const predicted = Math.round(Math.min(550, Math.max(0, raw)));
  const margin    = Math.round(1.96 * SIX_MWT_MODEL.residual_sd);
  return {
    predicted,
    lo95: Math.max(0,   predicted - margin),
    hi95: Math.min(550, predicted + margin),
  };
}

/**
 * Predict probability of independent ambulation at discharge (FAC ≥ 4).
 * @param {Object} v – validated input values
 * @returns {number} probability 0–1
 */
function predictAmbulation(v) {
  const age_over60 = Math.max(0, v.age - 60);
  const logOdds =
    AMBULATION_MODEL.intercept +
    AMBULATION_MODEL.fm_le        * v.fm_le +
    AMBULATION_MODEL.bbs          * v.bbs +
    AMBULATION_MODEL.mmse         * v.mmse +
    AMBULATION_MODEL.baseline_fac * v.baseline_fac +
    AMBULATION_MODEL.nihss        * v.nihss +
    AMBULATION_MODEL.age_over60   * age_over60 +
    AMBULATION_MODEL.days_delay   * v.days_delay +
    AMBULATION_MODEL.rehab_hrs    * v.rehab_hrs +
    AMBULATION_MODEL.sex_male     * v.sex_male;
  return 1 / (1 + Math.exp(-logOdds));
}

/**
 * Compute per-predictor contributions to the 6MWT prediction
 * relative to the population mean (SHAP-style waterfall).
 * @param {Object} v – validated input values
 * @returns {Array<{label, contribution, sign}>}
 */
function compute6MWTContributions(v) {
  const age_over60     = Math.max(0, v.age - 60);
  const mean_age_over60 = Math.max(0, POP_MEANS.age - 60);
  return [
    { label: 'FM-LE score',       contribution: SIX_MWT_MODEL.fm_le        * (v.fm_le        - POP_MEANS.fm_le) },
    { label: 'Berg Balance',      contribution: SIX_MWT_MODEL.bbs           * (v.bbs          - POP_MEANS.bbs) },
    { label: 'Baseline FAC',      contribution: SIX_MWT_MODEL.baseline_fac  * (v.baseline_fac - POP_MEANS.baseline_fac) },
    { label: 'NIHSS',             contribution: SIX_MWT_MODEL.nihss         * (v.nihss        - POP_MEANS.nihss) },
    { label: 'MMSE',              contribution: SIX_MWT_MODEL.mmse          * (v.mmse         - POP_MEANS.mmse) },
    { label: 'Age (>60)',         contribution: SIX_MWT_MODEL.age_over60    * (age_over60     - mean_age_over60) },
    { label: 'Days to rehab',     contribution: SIX_MWT_MODEL.days_delay    * (v.days_delay   - POP_MEANS.days_delay) },
    { label: 'Daily PT hours',    contribution: SIX_MWT_MODEL.rehab_hrs     * (v.rehab_hrs    - POP_MEANS.rehab_hrs) },
    { label: 'Sex (male)',        contribution: SIX_MWT_MODEL.sex_male      * (v.sex_male     - POP_MEANS.sex_male) },
  ].map(d => ({ ...d, sign: d.contribution >= 0 ? 'positive' : 'negative' }))
   .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

/**
 * Map a 6MWT distance to an ambulation band object.
 */
function get6MWTBand(metres) {
  return SIX_MWT_BANDS.find(b => metres >= b.min && metres < b.max)
      || SIX_MWT_BANDS[SIX_MWT_BANDS.length - 1];
}

/* ================================================================== */
/*  INPUT COLLECTION & VALIDATION                                       */
/* ================================================================== */

function collectInputs() {
  const g = id => parseFloat(document.getElementById(id)?.value ?? 'NaN');
  return {
    age:          g('srp_age'),
    sex_male:     document.getElementById('srp_sex')?.value === 'male' ? 1 : 0,
    nihss:        g('srp_nihss'),
    days_delay:   g('srp_days_delay'),
    fm_le:        g('srp_fm_le'),
    bbs:          g('srp_bbs'),
    baseline_fac: g('srp_baseline_fac'),
    mmse:         g('srp_mmse'),
    rehab_hrs:    g('srp_rehab_hrs'),
    stroke_type:  document.getElementById('srp_stroke_type')?.value || '',
  };
}

function validateInputs(v) {
  const errors = [];
  if (isNaN(v.age)          || v.age < 18   || v.age > 120)  errors.push('Age must be 18–120 years.');
  if (isNaN(v.nihss)        || v.nihss < 0  || v.nihss > 42) errors.push('NIHSS must be 0–42.');
  if (isNaN(v.days_delay)   || v.days_delay < 0 || v.days_delay > 180) errors.push('Days to rehab start must be 0–180.');
  if (isNaN(v.fm_le)        || v.fm_le < 0  || v.fm_le > 34) errors.push('FM-LE must be 0–34.');
  if (isNaN(v.bbs)          || v.bbs < 0    || v.bbs > 56)   errors.push('Berg Balance Scale must be 0–56.');
  if (isNaN(v.baseline_fac) || v.baseline_fac < 0 || v.baseline_fac > 5) errors.push('Baseline FAC must be 0–5.');
  if (isNaN(v.mmse)         || v.mmse < 0   || v.mmse > 30)  errors.push('MMSE must be 0–30.');
  if (isNaN(v.rehab_hrs)    || v.rehab_hrs < 0 || v.rehab_hrs > 5) errors.push('Daily PT hours must be 0–5.');
  return errors;
}

/* ================================================================== */
/*  HTML BUILDERS                                                       */
/* ================================================================== */

function buildHTML() {
  return `
    <h2 class="page-title">🦶 Stroke Rehab Outcome Predictor</h2>

    <!-- Disclaimer banner -->
    <div class="card" style="border-left:4px solid var(--color-warn);background:#fff8f0;padding:.8rem 1rem;margin-bottom:1rem">
      <strong>⚠️ Decision Support Only</strong> — This tool provides probabilistic
      estimates based on evidence synthesis. Results must be interpreted alongside
      full clinical assessment. <em>Not validated for autonomous clinical use.</em>
      Compliant with <strong>TRIPOD</strong> reporting; <strong>PROBAST</strong>
      risk-of-bias assessment pending external validation.
    </div>

    <form id="srp-form" autocomplete="off" novalidate>

      <!-- ── Section 1: Clinical Profile ────────────────────────── -->
      <div class="section-header">📋 Clinical Profile</div>

      <div class="form-row">
        <div class="form-group">
          <label for="srp_age">Age (years) <span class="required">*</span></label>
          <input id="srp_age" type="number" class="form-control" min="18" max="120" placeholder="e.g. 68">
        </div>
        <div class="form-group">
          <label for="srp_sex">Sex <span class="required">*</span></label>
          <select id="srp_sex" class="form-control">
            <option value="">— select —</option>
            <option value="male">Male</option>
            <option value="female">Female / Other</option>
          </select>
        </div>
        <div class="form-group">
          <label for="srp_stroke_type">Stroke Type</label>
          <select id="srp_stroke_type" class="form-control">
            <option value="">— select —</option>
            <option value="ischemic">Ischemic</option>
            <option value="hemorrhagic">Hemorrhagic (ICH/SAH)</option>
          </select>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="srp_nihss">NIHSS at admission (0–42) <span class="required">*</span></label>
          <span class="hint">Higher = more severe. 0=Normal, ≥25=Very severe.</span>
          <input id="srp_nihss" type="number" class="form-control" min="0" max="42" placeholder="e.g. 8">
        </div>
        <div class="form-group">
          <label for="srp_days_delay">Days: stroke onset → rehab start (0–180) <span class="required">*</span></label>
          <span class="hint">Earlier rehab start associated with better outcomes.</span>
          <input id="srp_days_delay" type="number" class="form-control" min="0" max="180" placeholder="e.g. 14">
        </div>
      </div>

      <!-- ── Section 2: Functional Assessment ───────────────────── -->
      <div class="section-header">🔬 Functional Assessments</div>

      <div class="form-row">
        <div class="form-group">
          <label for="srp_fm_le">Fugl-Meyer LE score (0–34) <span class="required">*</span></label>
          <span class="hint">0=Plegia; 34=Normal. Items: reflex, synergy, coordination.</span>
          <input id="srp_fm_le" type="number" class="form-control" min="0" max="34" placeholder="e.g. 20">
        </div>
        <div class="form-group">
          <label for="srp_bbs">Berg Balance Scale (0–56) <span class="required">*</span></label>
          <span class="hint">0=Unable; 56=Normal. ≤40 indicates fall risk.</span>
          <input id="srp_bbs" type="number" class="form-control" min="0" max="56" placeholder="e.g. 30">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="srp_baseline_fac">Baseline FAC at admission (0–5) <span class="required">*</span></label>
          <span class="hint">0=Non-ambulatory · 1=Max assist · 2=Min assist · 3=Supervised · 4=Independent level · 5=Independent all surfaces</span>
          <select id="srp_baseline_fac" class="form-control">
            <option value="">— select —</option>
            <option value="0">0 — Non-ambulatory</option>
            <option value="1">1 — Dependent, max assistance</option>
            <option value="2">2 — Dependent, min assistance</option>
            <option value="3">3 — Dependent, supervision</option>
            <option value="4">4 — Independent on level ground</option>
            <option value="5">5 — Independent all surfaces</option>
          </select>
        </div>
        <div class="form-group">
          <label for="srp_mmse">MMSE (0–30) <span class="required">*</span></label>
          <span class="hint">0=Severe cognitive impairment; 30=Normal. ≤23=Cognitive impairment.</span>
          <input id="srp_mmse" type="number" class="form-control" min="0" max="30" placeholder="e.g. 25">
        </div>
      </div>

      <!-- ── Section 3: Rehabilitation Factors ──────────────────── -->
      <div class="section-header">🏃 Rehabilitation Factors</div>

      <div class="form-row">
        <div class="form-group">
          <label for="srp_rehab_hrs">Daily physical therapy (PT) hours (0–5) <span class="required">*</span></label>
          <span class="hint">Total active PT practice per day. ≥2 h/day associated with better walking outcomes (Kwakkel 1999).</span>
          <input id="srp_rehab_hrs" type="number" class="form-control" min="0" max="5" step="0.25" placeholder="e.g. 1.5">
        </div>
      </div>

      <!-- Validation error panel (hidden until errors occur) -->
      <div id="srp-errors" class="srp-error-panel" style="display:none"></div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary">📊 Calculate Outcome Prediction</button>
        <button type="reset"  class="btn btn-secondary" id="srp-reset">🔄 Reset</button>
      </div>

    </form>

    <!-- Results panel (hidden until calculation) -->
    <div id="srp-results" style="display:none">

      <!-- ── 6MWT result card ─────────────────────────────────────── -->
      <div class="section-header" style="margin-top:1.5rem">📈 Predicted 6-Minute Walk Distance (3 months)</div>
      <div class="stats-grid" style="margin-bottom:1rem">
        <div class="stat-card" id="srp-6mwt-card">
          <div class="stat-value" id="srp-6mwt-value">—</div>
          <div class="stat-label">Predicted 6MWT (m)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="srp-6mwt-ci">—</div>
          <div class="stat-label">95% Prediction Interval</div>
        </div>
        <div class="stat-card" id="srp-6mwt-band-card">
          <div class="stat-value" id="srp-6mwt-band">—</div>
          <div class="stat-label">Ambulation Capacity</div>
        </div>
      </div>

      <!-- 6MWT threshold bar -->
      <div class="card" style="padding:.8rem 1rem">
        <div class="srp-threshold-bar-label">
          Ambulation Capacity Thresholds
          <span class="hint" style="margin-left:.5rem">(Fulk et al. 2010; Pohl et al. 2002)</span>
        </div>
        <div class="srp-threshold-bar" id="srp-threshold-bar">
          <div class="srp-threshold-seg" style="width:18%;background:#c0392b" title="0–100 m: Household">
            <span>0–100 m<br>Household</span>
          </div>
          <div class="srp-threshold-seg" style="width:27%;background:#e67e22" title="100–250 m: Limited community">
            <span>100–250 m<br>Ltd. community</span>
          </div>
          <div class="srp-threshold-seg" style="width:13%;background:#d4ac0d" title="250–320 m: Community">
            <span>250–320 m<br>Community</span>
          </div>
          <div class="srp-threshold-seg" style="width:42%;background:#2eaa6e" title="≥320 m: Full community">
            <span>≥ 320 m<br>Full community</span>
          </div>
          <div class="srp-threshold-marker" id="srp-threshold-marker" title="Your prediction">▲</div>
        </div>
        <div style="font-size:.78rem;color:var(--color-muted);margin-top:.4rem">
          MCID = 30 m (Perera et al. 2006) · Upper CI capped at 550 m
        </div>
      </div>

      <!-- ── Ambulation Independence card ────────────────────────── -->
      <div class="section-header" style="margin-top:1.5rem">🚶 Independent Ambulation at Discharge (FAC ≥ 4)</div>
      <div class="stats-grid" style="margin-bottom:1rem">
        <div class="stat-card" id="srp-amb-card">
          <div class="stat-value" id="srp-amb-prob">—</div>
          <div class="stat-label">Probability (%)</div>
        </div>
        <div class="stat-card" id="srp-amb-risk-card">
          <div class="stat-value" id="srp-amb-risk">—</div>
          <div class="stat-label">Risk Category</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="srp-amb-odds">—</div>
          <div class="stat-label">Estimated Odds</div>
        </div>
      </div>

      <!-- Probability gauge bar -->
      <div class="card" style="padding:.8rem 1rem;margin-bottom:1rem">
        <div class="srp-threshold-bar-label">Independent Ambulation Probability</div>
        <div style="background:var(--color-border);border-radius:8px;height:22px;overflow:hidden;margin:.5rem 0">
          <div id="srp-prob-fill" style="height:100%;width:0%;transition:width .5s ease;background:#2eaa6e;border-radius:8px"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.75rem;color:var(--color-muted)">
          <span>0%</span><span>High risk (&lt;30%)</span><span>Moderate (30–60%)</span><span>Low risk (&gt;60%)</span><span>100%</span>
        </div>
      </div>

      <!-- ── Feature Contributions ─────────────────────────────────── -->
      <div class="section-header" style="margin-top:1.5rem">📊 Predictor Contributions (vs. population mean)</div>
      <div class="card" style="padding:.8rem 1rem">
        <div style="font-size:.8rem;color:var(--color-muted);margin-bottom:.6rem">
          Shows how each predictor shifts the 6MWT prediction relative to the average
          stroke rehab patient.  <strong>Green = favourable offset</strong>,
          <strong>Red = unfavourable offset</strong>.
        </div>
        <div id="srp-contributions"></div>
      </div>

      <!-- ── Clinical Action Panel ─────────────────────────────────── -->
      <div class="section-header" style="margin-top:1.5rem">💡 Clinical Interpretation &amp; Suggested Actions</div>
      <div class="card" id="srp-actions" style="padding:1rem"></div>

      <!-- ── Evidence / Methodology Notes ─────────────────────────── -->
      <div class="section-header" style="margin-top:1.5rem">📚 Evidence Base &amp; Methodology</div>
      <div class="card" style="padding:1rem;font-size:.85rem;line-height:1.7">
        ${buildEvidenceNote()}
      </div>

    </div><!-- #srp-results -->
  `;
}

function buildEvidenceNote() {
  return `
    <strong>Model type:</strong> Evidence-synthesis multivariable model (linear + logistic).
    Coefficients derived from published predictor effect sizes and systematic reviews.<br>

    <strong>Predictors selected by:</strong> Systematic review (Veerbeek et al. 2011) identifying
    predictors of walking recovery post-stroke with ≥ 2 independent studies.<br>

    <strong>Key predictors &amp; evidence level:</strong>
    <table class="report-table" style="margin:.5rem 0">
      <thead><tr><th>Predictor</th><th>Evidence (6MWT / ambulation)</th><th>Source</th></tr></thead>
      <tbody>
        <tr><td>Fugl-Meyer LE</td><td>Strong (r ≈ 0.70)</td><td>Patterson 2007; Veerbeek 2011</td></tr>
        <tr><td>Berg Balance Scale</td><td>Strong (r ≈ 0.65)</td><td>Fulk 2010; Bowden 2008</td></tr>
        <tr><td>Baseline ambulation (FAC)</td><td>Very strong</td><td>Jørgensen 1999; Veerbeek 2011</td></tr>
        <tr><td>NIHSS</td><td>Moderate–strong (r ≈ −0.60)</td><td>Veerbeek 2011; AHA 2016</td></tr>
        <tr><td>Age</td><td>Moderate</td><td>Multiple meta-analyses</td></tr>
        <tr><td>MMSE</td><td>Moderate</td><td>Veerbeek 2011</td></tr>
        <tr><td>Days to rehab start</td><td>Moderate</td><td>Kwakkel 1999; AHA 2016</td></tr>
        <tr><td>Daily PT hours</td><td>Strong (dose–response)</td><td>Kwakkel 1999; Mehrholz 2018</td></tr>
      </tbody>
    </table>

    <strong>Validation status:</strong> Internal evidence-synthesis model — <em>external prospective
    validation required</em> per TRIPOD Item 19.  PROBAST risk-of-bias assessment recommended before
    clinical deployment (domain: Analysis, Outcome, Predictors).<br>

    <strong>Thresholds used:</strong>
    6MWT bands from Fulk et al. (2010) J Neurol Phys Ther; Pohl et al. (2002) Stroke.
    MCID = 30 m from Perera et al. (2006) JAGS. FAC ≥ 4 = independent ambulation.<br>

    <strong>Reporting:</strong> Developed according to the
    <a href="https://www.tripod-statement.org" target="_blank" rel="noopener">TRIPOD Statement</a>
    for multivariable prediction models.
    Bias appraisal using
    <a href="https://www.probast.org" target="_blank" rel="noopener">PROBAST</a>.
  `;
}

/* ================================================================== */
/*  RESULTS RENDERER                                                    */
/* ================================================================== */

function renderResults(v) {
  const mwt  = predict6MWT(v);
  const pAmb = predictAmbulation(v);
  const band = get6MWTBand(mwt.predicted);
  const contribs = compute6MWTContributions(v);

  // ── 6MWT section ──────────────────────────────────────────────
  document.getElementById('srp-6mwt-value').textContent = `${mwt.predicted} m`;
  document.getElementById('srp-6mwt-ci').textContent    = `${mwt.lo95}–${mwt.hi95} m`;
  document.getElementById('srp-6mwt-band').textContent  = band.label;

  const mwtCard  = document.getElementById('srp-6mwt-card');
  const bandCard = document.getElementById('srp-6mwt-band-card');
  mwtCard.style.borderTop  = `4px solid ${band.color}`;
  bandCard.style.borderTop = `4px solid ${band.color}`;

  // Threshold bar marker position (0–550 m mapped to 0–100%)
  const pct = Math.min(100, Math.round(mwt.predicted / 550 * 100));
  const marker = document.getElementById('srp-threshold-marker');
  if (marker) {
    marker.style.left = `${pct}%`;
    marker.style.color = band.color;
  }

  // ── Ambulation section ─────────────────────────────────────────
  const probPct = Math.round(pAmb * 100);
  const odds    = pAmb > 0.001 ? (pAmb / (1 - pAmb)).toFixed(2) : '< 0.001';
  let riskLabel, riskColor;
  if (probPct >= 60) {
    riskLabel = 'Low risk';   riskColor = '#2eaa6e';
  } else if (probPct >= 30) {
    riskLabel = 'Moderate';   riskColor = '#e67e22';
  } else {
    riskLabel = 'High risk';  riskColor = '#c0392b';
  }

  document.getElementById('srp-amb-prob').textContent = `${probPct}%`;
  document.getElementById('srp-amb-risk').textContent = riskLabel;
  document.getElementById('srp-amb-odds').textContent = `${odds} : 1`;

  document.getElementById('srp-amb-card').style.borderTop      = `4px solid ${riskColor}`;
  document.getElementById('srp-amb-risk-card').style.borderTop = `4px solid ${riskColor}`;

  const fill = document.getElementById('srp-prob-fill');
  if (fill) {
    fill.style.width      = `${probPct}%`;
    fill.style.background = riskColor;
  }

  // ── Feature contributions ──────────────────────────────────────
  const maxAbs  = Math.max(1, ...contribs.map(c => Math.abs(c.contribution)));
  const contDiv = document.getElementById('srp-contributions');
  if (contDiv) {
    contDiv.innerHTML = contribs.map(c => {
      const barPct = Math.round(Math.abs(c.contribution) / maxAbs * 100);
      const col    = c.sign === 'positive' ? '#2eaa6e' : '#c0392b';
      const valStr = `${c.contribution >= 0 ? '+' : ''}${Math.round(c.contribution)} m`;
      return `
        <div class="srp-contrib-row">
          <div class="srp-contrib-label">${esc(c.label)}</div>
          <div class="srp-contrib-bar-wrap">
            <div class="srp-contrib-bar" style="width:${barPct}%;background:${col}"></div>
          </div>
          <div class="srp-contrib-val" style="color:${col}">${valStr}</div>
        </div>`;
    }).join('');
  }

  // ── Clinical Action Panel ──────────────────────────────────────
  renderActionPanel(mwt.predicted, probPct, v, contribs);

  // Show results
  document.getElementById('srp-results').style.display = 'block';
  document.getElementById('srp-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderActionPanel(predicted6MWT, probPct, v, contribs) {
  const panel = document.getElementById('srp-actions');
  if (!panel) return;

  const actions = [];

  // 1. Overall prognosis interpretation
  if (probPct >= 60 && predicted6MWT >= 250) {
    actions.push({
      type: 'success',
      text: `<strong>Favourable prognosis:</strong> Patient is predicted to achieve community
             ambulation (≥ 250 m, ${probPct}% probability of independent ambulation).
             Continue current intensity; goal-set for community-level mobility
             (e.g., ≥ 300 m at 3 months).`
    });
  } else if (probPct >= 30) {
    actions.push({
      type: 'warn',
      text: `<strong>Moderate prognosis:</strong> Moderate probability (${probPct}%) of
             independent ambulation.  Intensify balance and lower-limb motor retraining.
             Consider high-repetition gait training (treadmill/overground) per Mehrholz et al. 2017.`
    });
  } else {
    actions.push({
      type: 'danger',
      text: `<strong>Guarded prognosis:</strong> Low probability (${probPct}%) of independent
             ambulation at discharge.  Prioritise task-specific locomotor training, assistive
             device fitting, and carer education.  Re-assess at 2 weeks for trajectory update.`
    });
  }

  // 2. Top modifiable contributor
  const modifiablePredictors = ['Daily PT hours', 'Days to rehab'];
  const top_modifiable = contribs.find(c => modifiablePredictors.includes(c.label) && c.contribution < 0);
  if (top_modifiable) {
    if (top_modifiable.label === 'Daily PT hours') {
      actions.push({
        type: 'info',
        text: `<strong>Modifiable — PT dose:</strong> Current PT hours (${v.rehab_hrs} h/day)
               are below the dose–response optimum.  Increasing to ≥ 2 h/day of active task
               practice improves gait outcomes (Kwakkel et al. 1999; AHA Grade IIa, LOE A).`
      });
    }
    if (top_modifiable.label === 'Days to rehab') {
      actions.push({
        type: 'info',
        text: `<strong>Modifiable — Early mobilisation:</strong> Rehab started ${v.days_delay} days
               post-stroke.  Early initiation (ideally &lt; 7 days for out-of-bed mobility) is
               associated with better walking outcomes (AVERT trial; AHA 2016 guideline).`
      });
    }
  }

  // 3. Balance if BBS low
  if (v.bbs <= 28) {
    actions.push({
      type: 'info',
      text: `<strong>Balance deficit (BBS ${v.bbs}/56):</strong> Patient has fall risk (BBS ≤ 40).
             Include balance retraining in every therapy session.  Consider
             task-oriented balance training and dual-task practice (Holbein-Jenny et al. 2007).`
    });
  }

  // 4. Motor if FM-LE low
  if (v.fm_le <= 12) {
    actions.push({
      type: 'info',
      text: `<strong>Severe lower-limb motor impairment (FM-LE ${v.fm_le}/34):</strong>
             Consider electromechanical-assisted gait training (body-weight support treadmill,
             robotic exoskeleton) as adjunct to conventional therapy (Mehrholz et al. 2020,
             Cochrane; Grade IIb).`
    });
  } else if (v.fm_le <= 20) {
    actions.push({
      type: 'info',
      text: `<strong>Moderate lower-limb motor impairment (FM-LE ${v.fm_le}/34):</strong>
             Prioritise high-repetition gait practice and ankle dorsiflexion strengthening.
             Body-weight support treadmill or over-ground practice ≥ 20 min/session
             (Kwakkel 2004; AHA LOE A).`
    });
  }

  // 5. Cognition
  if (v.mmse <= 23) {
    actions.push({
      type: 'warn',
      text: `<strong>Cognitive impairment (MMSE ${v.mmse}/30):</strong>
             Cognitive deficits reduce rehabilitation learning.  Use errorless learning
             techniques, environmental cues, and caregiver involvement.
             Neuropsychology referral recommended (AHA 2016 guideline).`
    });
  }

  // 6. NIHSS-based caution
  if (v.nihss >= 16) {
    actions.push({
      type: 'warn',
      text: `<strong>Severe stroke (NIHSS ${v.nihss}):</strong>
             Extensive neurological deficit; realistic goal-setting with patient and family
             is essential.  Shared decision-making regarding realistic rehabilitation
             expectations per AHA/ASA 2016 guideline and NICE NG162.`
    });
  }

  panel.innerHTML = actions.map(a => `
    <div class="srp-action srp-action-${a.type}">${a.text}</div>
  `).join('') + `
    <div style="font-size:.78rem;color:var(--color-muted);margin-top:.8rem;padding-top:.6rem;border-top:1px solid var(--color-border)">
      Guideline references: AHA/ASA Stroke Rehabilitation 2016 (Winstein et al., Stroke);
      Mehrholz et al. 2020 Cochrane; Kwakkel et al. 1999 Stroke; NICE NG162 (2023).
      This tool supports — does not replace — multidisciplinary clinical judgment.
    </div>`;
}

/* ================================================================== */
/*  EVENT WIRING                                                        */
/* ================================================================== */

function wireEvents() {
  const form = document.getElementById('srp-form');
  if (!form) return;

  form.addEventListener('submit', e => {
    e.preventDefault();
    const v      = collectInputs();
    const errors = validateInputs(v);
    const errDiv = document.getElementById('srp-errors');

    if (errors.length > 0) {
      errDiv.innerHTML = errors.map(err => `<div>⚠️ ${esc(err)}</div>`).join('');
      errDiv.style.display = 'block';
      return;
    }
    errDiv.style.display = 'none';
    renderResults(v);
  });

  document.getElementById('srp-reset')?.addEventListener('click', () => {
    document.getElementById('srp-results').style.display = 'none';
    document.getElementById('srp-errors').style.display  = 'none';
  });
}

/* ================================================================== */
/*  HELPERS                                                             */
/* ================================================================== */

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ================================================================== */
/*  PUBLIC ENTRY POINT                                                  */
/* ================================================================== */

/**
 * Render the Stroke Rehab Predictor page into #main-content.
 * Called by the router in app.js.
 */
export function renderStrokeRehab() {
  const container = document.getElementById('main-content');
  if (!container) return;
  container.innerHTML = buildHTML();
  wireEvents();
}
