# Task.md — Development Log

## Overview
Tracks what has been achieved in each modification of the **Daily OPD Session — Neuro-MSK ICD-10 Classifier** web application.

---

## Modification 1 — Bug Fixes & Multi-Code ICD Support

### Bug Fix: Template Inserts No Longer Erase the Entry Form

**Problem:** When a user clicked "Insert to Entry" from the SOAP Templates page (or "Use →" from the ICD Code Browser), it called `navigate('log')` which re-rendered the form from scratch — erasing any date, patient ID, SOAP text, condition, or key-learning data the user had already typed.

**Solution:** Added a **form draft** system using `sessionStorage`:
- The form auto-saves its entire state (date, patient ID, patient type, ICD codes, condition, key-learning, SOAP text) to `sessionStorage` under `opdFormDraft_v1` on every `input` / `change` event.
- When `renderSessionLog()` is called, it restores the draft and merges it with any new prefill data (ICD code from browser, SOAP text from templates).
- The draft is cleared when the entry is submitted or the user clicks Cancel.
- Files changed: `Daily/modules/session-log.js`

---

### Feature: Multiple ICD Codes per Patient

**Problem:** Each patient entry could only hold one ICD-10 code.

**Solution:**
- The ICD section in the New Entry form now supports an **array of ICD codes** (`icdCodes: [{code, en, zh, categoryId, categoryName}]`).
- Clicking a search result **adds** the code as a removable tag; duplicate codes are automatically prevented.
- Each tag has a **× Remove** button.
- The primary (first) code is still stored in the legacy `icdCode` / `icdDescription` / `categoryId` fields for full **backward compatibility** with existing data.
- The Dashboard entry cards now show all codes associated with a record.
- `recordIcdUse()` in `app.js` now iterates over all codes and records frequency for each.
- Files changed: `Daily/modules/session-log.js`, `Daily/app.js`, `Daily/style.css`

---

### Bug Fix: Ghost Panel Updates for Most Recently Selected ICD Category

**Problem:** The ghost SOAP reference panel needed to reflect the category of the most recently selected ICD code.

**Solution:**
- Every time a new ICD code is added, `loadGhostPanel()` is called for that code's category, so the ghost panel immediately updates.
- The ghost panel is opened automatically when any ICD code is added.
- Files changed: `Daily/modules/session-log.js`

---

### Fix: SOAP Template Insert — Only Terms Before ":"

**Problem:** SOAP template items have the format `"Term: detail/examples"` (e.g., `"Onset & course: insidious vs. stepwise"`). When inserting into the SOAP note, the full string was inserted, which is verbose and redundant.

**Solution:**
- SOAP items are now rendered with a visual split: the **term** (before ":") is shown in bold, the **detail** (after ":") is shown in muted smaller text — providing context in the reference panel without cluttering the inserted note.
- A `data-term` attribute stores only the term portion.
- **Insert** actions use only the term (e.g. `"Onset & course:"`) so the inserted note is a clean structured form for the clinician to fill in.
- **Copy** actions still use the full text (for reference copying).
- Applied in both the ghost panel in the entry form and the standalone SOAP Templates page.
- Files changed: `Daily/modules/session-log.js`, `Daily/modules/soap-view.js`, `Daily/style.css`

---

### New ICD Categories (ICD-10-CM 2023 中文版 Expansion)

Three new clinical categories were added to `Daily/data/icd_categories.json`, each with:
- Full SOAP template (Subjective, Objective, Assessment Pearls, Plan)
- Physical Exam reference (Bedside Scales, Neurologic Exam)
- ICD-10-CM 2023 Chinese codes and descriptions

| Category | ID | Code Range | Codes Added |
|---|---|---|---|
| 眩暈及前庭疾患 Vertigo & Vestibular Disorders | `vertigo` | H81–H83, R42 | 43 |
| 神經肌肉疾病 Neuromuscular Diseases | `neuromuscular` | G60–G73 | 44 |
| 睡眠疾患 Sleep Disorders | `sleep` | G47 | 42 |

Total codes added: **129**

---

## Modification 2 — SOAP/ICD UX Overhaul & Shortcut Keys (2026-04-21)

### Fix: No More Duplicate Inserts from SOAP Templates

**Problem:** Each SOAP sub-section (S, O, A, P) had its own "Insert to Entry" button.
Clicking multiple section buttons caused duplicate text in the SOAP note.

**Solution:**
- Removed all per-section "Insert to Entry" buttons from the SOAP Templates page (`soap-view.js`).
- Removed per-section "✓ Insert" buttons from the ghost SOAP panel in the New Entry form (`session-log.js`).
- **Single "Insert All Checked" button** at the top of the SOAP Templates page inserts every checked item across all S/O/A/P sections in one click, navigating to the New Entry form exactly once.
- Ghost panel now has a single "✓ Insert" button in its header that inserts all checked items into the SOAP textarea in-place (no navigation away).
- Files changed: `Daily/modules/soap-view.js`, `Daily/modules/session-log.js`

---

### Feature: SOAP Templates — 3-Column Layout with Recent Terms Center Panel

**Problem:** The SOAP Templates page showed all 4 sections stacked vertically.

**Solution:**
- New 3-column layout inside each category accordion body:
  - **Left column** — S (Subjective) + O (Objective) sections
  - **Center column** — "Recently Used Terms" panel (top 100 terms, stratified by S/O/A/P section)
  - **Right column** — A (Assessment Pearls) + P (Plan) sections
- The center panel shows the user's most-used SOAP terms with frequency badge (×N).
- All items in all three columns are checkable; the single global "Insert All Checked" button inserts everything selected.
- Section-aware usage tracking: each inserted term now records its S/O/A/P section for better stratification.
- Files changed: `Daily/modules/soap-view.js`, `Daily/app.js`, `Daily/style.css`

---

### Feature: ICD Browser — 3-Column Layout with Recent 50 Codes Center Panel

**Problem:** The ICD browser had a left category sidebar and a main content area only.

**Solution:**
- New 3-column layout:
  - **Left column** — first half of categories
  - **Center column** — "Recently Used ICD Codes" panel (top 50, with checkboxes + freq badge)
  - **Right column** — second half of categories
- Clicking a category from either column shows the full code table + SOAP tab in a detail panel below.
- The "Insert Selected" button in the center panel inserts all checked recent codes into the New Entry form (supporting multi-code selection).
- Extra selected codes beyond the first are passed as `prefill_icd_extra` to the New Entry form.
- Files changed: `Daily/modules/icd-browser.js`, `Daily/modules/session-log.js`, `Daily/style.css`

---

### Feature: Shortcut Keys — Configurable in Settings

**New shortcuts (defaults):**

| Action | Default Key |
|---|---|
| Insert all checked — SOAP ghost panel (entry form) | Shift+C |
| Insert all checked — SOAP Templates page | Shift+I |
| Insert selected — ICD Browser recent panel | Shift+S |
| Insert all selected (global, any page) | Shift+A |

- Shortcuts are checked per-page via a `matchShortcut(event, shortcutStr)` helper.
- All four shortcut keys are **configurable in Settings** (new "⌨️ Shortcut Keys" card).
- Settings page allows typing any combo like `Shift+C`, `C`, `Ctrl+S`. Saved to `localStorage`.
- Files changed: `Daily/modules/settings-view.js`, `Daily/modules/soap-view.js`, `Daily/modules/icd-browser.js`, `Daily/modules/session-log.js`, `Daily/app.js`

---

## Pending / Future Work

- [ ] Continue expanding ICD-10-CM 2023 中文版 coverage:
  - Autonomic nervous system disorders (G90)
  - Cerebrovascular disease detail (I60–I69 expansion)
  - Rehabilitation / musculoskeletal injury codes (M40–M54 expansion)
  - Common internal medicine codes (E10–E14 DM, I10 HTN, E66 obesity)
  - Infection-related neurological conditions (A81–A89)
- [ ] Add patient-level record linking (multiple visits per patient ID)
- [ ] Export to standard clinical formats (PDF summary, CSV)
