# Stroke rehabilitation calibration provenance

This repository currently tracks **two implemented prediction equations** and **three derived report entries**:

1. **Model 1** — 6MWT4 linear prediction equation (`Report/modules/stroke-rehab-predictor.js`)
2. **Model 2** — discharge independent-ambulation logistic equation (`Report/modules/stroke-rehab-predictor.js`)
3. **Entry 3** — observed-label complete-case discrimination analysis from the same score
4. **Entry 4** — best-case missing-6MWT4 sensitivity bound
5. **Entry 5** — worst-case missing-6MWT4 sensitivity bound

Entries 3–5 are **not separate fitted models** in the checked-in source. They are secondary analyses or sensitivity labels described in `20260920_models_1353.docx`.

## What the tracked code does

The only checked-in prediction code is the browser-side module
`/home/runner/work/Clinical-Medicine/Clinical-Medicine/Report/modules/stroke-rehab-predictor.js`.

- `predict6MWT(v)` computes a linear predictor from raw covariates, then clips the displayed point prediction to **0–550 m**.
- `predictAmbulation(v)` computes a logistic linear predictor from raw covariates and converts it with `1 / (1 + exp(-logit))`.
- `compute6MWTContributions(v)` subtracts `POP_MEANS` only to display a SHAP-style waterfall of predictor contributions relative to a reference patient.
- Both functions depend only on the input covariates and hard-coded coefficients.
- The tracked source contains **no weighting, no outcome-driven offset adjustment, no recentering, and no post-hoc recalibration step** before these predictions are produced.
- The `POP_MEANS` centering used in `compute6MWTContributions(v)` is **visualization only** and does **not** feed back into either prediction function.

## Complete tracked prediction path

### Model 1 — 6MWT4

1. Collect raw inputs from the form (`collectInputs()`).
2. Validate numeric ranges (`validateInputs()`).
3. Transform age to `max(age - 60, 0)`.
4. Compute the linear predictor using the fixed coefficients in `SIX_MWT_MODEL`.
5. Clip the displayed point prediction to `[0, 550]` metres with `Math.min(550, Math.max(0, raw))`.
6. Derive the displayed 95% prediction interval from the clipped point prediction using `± 1.96 × 65`.

### Model 2 — discharge independent ambulation

1. Collect raw inputs from the form (`collectInputs()`).
2. Validate numeric ranges (`validateInputs()`).
3. Transform age to `max(age - 60, 0)`.
4. Compute the logistic linear predictor using the fixed coefficients in `AMBULATION_MODEL`.
5. Convert the linear predictor to a probability with the inverse-logit transform.

### Entries 3–5 in the report document

The checked-in repository does **not** contain separate fitting or scoring code for the remaining three entries in the five-row document table. The document describes them as:

- an **observed-label complete-case discrimination analysis** using the same underlying score;
- a **best-case** missing-outcome sensitivity bound; and
- a **worst-case** missing-outcome sensitivity bound.

## Whether evaluation outcomes are used to alter predictions

Within the tracked repository source, **no**.

- The prediction functions do not accept observed outcomes.
- The prediction functions do not accept weights.
- There is no checked-in code path that subtracts or adds an offset based on the evaluation-set mean outcome.
- There is no checked-in calibration regression that writes adjusted predictions back to disk or back into the browser calculator.

Because the repository does **not** contain the patient-level calibration dataset, patient-level prediction vectors, or the original calibration-plot code that produced the previously discussed “five model” intercepts, the repository cannot reproduce or verify any claim that those reported intercepts were obtained after explicit recentering on the evaluation set.

## Apparent vs out-of-sample calibration

The current repository does **not** contain patient-level calibration predictions of any of the following types:

- held-out validation predictions;
- cross-validated or out-of-fold predictions;
- external-validation predictions; or
- an in-sample fitted-value export for the five reported entries.

Therefore:

- the bedside calculator itself is **not** an out-of-sample validation artifact;
- the repository does **not** generate calibration plots or calibration intercept/slope summaries from patient-level data;
- any previously reported calibration numbers for the five entries are **not reproducible from the tracked repository alone**; and
- the absence of untouched out-of-sample calibration predictions is now explicitly disclosed here.

## Why the previously reported zero intercepts cannot be confirmed from the repository

The repository currently lacks the exact patient-level inputs needed to recompute the previously reported calibration plots and summary statistics:

- prediction vector used for each plotted point;
- observed outcome vector used for each plotted point;
- observation weights and any normalization rule;
- missing-value exclusion mask;
- binning algorithm and tie handling;
- smoother/regression specification;
- confidence-interval method; and
- numeric formatting rules used for the published intercepts.

Because those inputs are not checked in, the repository does **not** treat the previously reported exact-zero calibration intercepts as reproducible outputs of the current source tree.

## Mathematical identity that would explain equality if the prior analysis was apparent/in-sample

If a weighted linear or generalized linear model with an intercept is evaluated on the **same weighted fitting sample**, and the reported “predicted” values are the model’s fitted values before any later clipping/relabeling, then:

- the weighted residual mean is zero; and
- the weighted observed mean equals the weighted fitted mean.

Under that apparent-calibration setup, an intercept-only recalibration term can be exactly zero by construction. That is a general mathematical identity, **not** evidence that the repository’s checked-in code explicitly recentered predictions with evaluation outcomes.

## Reproducible calibration-plot construction status

For the previously discussed five-entry calibration plots, the following items are **not tracked in the repository** and therefore are currently **not reproducible**:

- exact prediction vector used;
- exact observed outcome vector used;
- weights and weight normalization;
- missing-value handling mask used for plotting;
- binning algorithm, number of bins, bin boundaries, and tie handling;
- per-bin weighted summaries;
- smoother or regression-line formula and weighting;
- identity/reference line settings;
- confidence-interval method; and
- whether plotted data differed from the data used for the reported calibration statistics.

## Practical interpretation for analysts

- The repository supports the two fixed prediction equations only.
- The repository supports the document statement that entries 3–5 are derived complete-case/sensitivity analyses rather than new models.
- The repository does **not** currently support a reproducible claim that “all five calibration intercepts were exactly zero” or that “weighted observed and predicted means matched” for five checked-in prediction vectors.
- The repository does **not** contain untouched out-of-sample calibration predictions; that absence should be disclosed whenever the report is discussed.

## Machine-readable companion

See `Report/data/stroke_rehab_calibration_provenance.json` for the same disclosure in machine-readable form, and `.github/scripts/validate_stroke_rehab_calibration_provenance.py` for a lightweight automated consistency check.
