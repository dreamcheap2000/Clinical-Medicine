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

---

## Modification 3 — Dark Theme, Floating Panels, Resizable Sections (2026-04-21)

### Task 1 — Retrieve Saved Entries from Repo Session Files

**Problem:** Previously saved OPD sessions and SOAP-related data stored in the repo (e.g., `Daily/sessions/2026-04-21.json`) were not auto-loaded into the browser localStorage on a fresh visit.

**Solution:**
- Added `Daily/sessions/index.json` manifest listing all daily session JSON files.
- `app.js` now includes `restoreSessionsFromRepo()` which fetches `./sessions/index.json` on first load. If localStorage is empty (or not yet seeded), it fetches each listed `*.json` file and merges all sessions into localStorage, skipping duplicates by `id`.
- This runs automatically once on `boot()`. Restored count is displayed as a toast.
- A **📂 Restore from Repo** button is added to the Dashboard "Data Management" card, allowing manual re-import at any time.
- Files changed: `Daily/app.js`, `Daily/sessions/index.json` (new)

---

### Task 2 — Single Combined Copy Button Below Insert All Checked

**Problem:** Each S/O/A/P segment had its own "Copy" button, leading to multiple per-section toasts and fragmented copying workflow.

**Solution:**
- Removed all per-section copy buttons from the SOAP templates page.
- Added **one global "📋 Copy All Checked (full text)"** button placed immediately after (below) the "➕ Insert All Checked" button in the global actions bar.
- This button copies the **full text** of every checked item — including words after ":" — to the clipboard in one operation.
- A single "📋 Copied to clipboard" toast is shown once per Copy All action.
- Files changed: `Daily/modules/soap-view.js`

---

### Task 3 — Dark Theme (Black Background, White Text)

**Problem:** All pages used a light (#f4f6fb) background with dark text.

**Solution:**
- Updated all CSS design tokens in `:root` to a dark palette:
  - `--color-bg: #0d0d0d`, `--color-surface: #1a1a1a`, `--color-border: #2e2e2e`
  - `--color-text: #dde1ea`, `--color-heading: #ffffff`
  - Tags, buttons, cards, tables all use dark equivalents
- Replaced all hardcoded light-mode hex colors (`#f0f7ff`, `#f8faff`, `#fff`, etc.) with dark equivalents or CSS variables.
- Files changed: `Daily/style.css`

---

### Task 4 — SOAP Templates: Floating Categories, Resizable Panels

**Problem:** SOAP categories were in an accordion. The center panel was a fixed 220px column. S/O/A/P sections had no adjustable size.

**Solution:**
- **Categories → Floating Buttons:** Each SOAP category is now rendered as a draggable `position:absolute` button inside a `position:relative` floating area container.
  - Default positions are arranged in a 4-column grid.
  - Dragging a button repositions it; clicking (without drag) opens the category detail.
  - Overlap is managed by z-index: clicked button rises to the top.
- **Center "Recently Used Terms" → Floating Panel:** Extracted from the 3-column grid into a `position:fixed` draggable and CSS `resize: both` panel.
  - Default width is **2/3 of viewport width**.
  - Has a drag handle at the top; panel body is scrollable.
  - Toggle with the "📊 Recent Terms" button in the global action bar.
- **S/O/A/P Sections Resizable:** Each `.ref-section` element has CSS `resize: vertical; overflow: auto` so the user can drag the bottom edge to adjust height.
- **Center panel in 3-col layout:** Changed from `1fr 220px 1fr` to `1fr 4fr 1fr` to give center column ~2/3 of available width. Also `resize: both` on `.soap-3col-center`.
- Files changed: `Daily/modules/soap-view.js`, `Daily/style.css`, `Daily/app.js`

---

### Task 5 — ICD Browser: Floating Categories, Floating Recent Codes Panel

**Problem:** ICD categories were split into fixed left/right columns; the recent codes panel was a static center column.

**Solution:**
- **Categories → Floating Buttons:** Same draggable floating-button pattern as SOAP templates. 16 categories rendered as draggable buttons in a relative container.
- **"Recently Used ICD Codes" → Floating Panel:** `position:fixed`, CSS `resize: both`, drag handle, default width 2/3 of viewport.
  - "Insert Selected" button inside the panel for quick code insertion.
  - "✕" button to hide; can be reopened via "📊 Recent Codes" toggle button.
- Files changed: `Daily/modules/icd-browser.js`, `Daily/style.css`

---

### Task 6 — Memorize Floating Window Positions Automatically

**Problem:** Floating panel / button positions were not saved.

**Solution:**
- `saveFloatPosition(key, {x, y, w, h})` stores each panel's position and size to `localStorage` under `floatPositions_v1`.
- `initFloatPanel()` restores saved `x`, `y`, `w`, `h` on re-render.
- `initDraggableInContainer()` restores saved `x`, `y` for category buttons.
- A `ResizeObserver` fires `saveFloatPosition` whenever a floating panel is resized.
- Files changed: `Daily/app.js`

---

### Task 7 — "Copied" Toast: Single Notification After Copy All

**Problem:** Per-section copy buttons each fired a separate "Copied" toast.

**Solution:**
- Per-section copy buttons are removed (see Task 2). The single global "Copy All Checked" button shows one "📋 Copied to clipboard." toast after the entire copy operation.
- Files changed: `Daily/modules/soap-view.js`

---

---

## Modification 4 — Quad View Overhaul, Form Cleanup & Repo Maintenance (2026-04-26)

### Task 1 — Remove "Special Patient Type" and "Patient Condition / Presentation" from New Entry Page

**Problem:** The New Entry form contained two fields not needed for the core Neuro-MSK workflow:
- "Special Patient Type" dropdown
- "Patient Condition / Presentation" textarea

**Solution:**
- Removed both fields from `renderSessionLog()` HTML template.
- Removed `patientType` and `condition` from `saveFormDraft()` and `buildSession()`.
- Removed the pre-fill of condition field from ICD code selection.
- All existing saved entries remain intact (no data loss — fields preserved in storage, just not shown).
- Files changed: `Daily/modules/session-log.js`

---

### Task 2 — Quad View: Real-time Sync (< 2s) to New Entry Page

**Problem:** Quad view autosaved EBM/SOAP text to sessionStorage only every 20 seconds, causing stale data when navigating to New Entry.

**Solution:**
- EBM textarea already saved on every `input` event (unchanged).
- SOAP note textarea now saves on every `input` event AND via 2-second interval.
- ICD checked items already saved immediately on checkbox change (unchanged).
- SOAP checked items already saved immediately on checkbox change (unchanged).
- Added real-time sync: when SOAP template items are checked/unchecked in the BR panel, the SOAP note textarea (TR panel) updates automatically with the structured `buildSectionedSoapInsert` output.
- Files changed: `Daily/app.js`

---

### Task 3 — Quad View: "Open Full ICD Browser" / "Open Full SOAP Templates" in Panel Headers

**Problem:** These buttons were at the bottom of the quad panel bodies, not easily visible.

**Solution:**
- The `_quadPanel()` function always renders a "↗ Full" button in the header (already navigates to the correct page).
- Removed the redundant bottom-of-body "Open Full ICD Browser →" and "Open Full SOAP Templates →" buttons from `_renderQuadIcd` and `_renderQuadSoap`.
- Files changed: `Daily/app.js`

---

### Task 4 — Quad View: Tab UI (Categories / Recently Used) in ICD and SOAP Panels

**Problem:** ICD and SOAP panels mixed category buttons and recently-used lists in one scrolling area.

**Solution:**
- Both `_renderQuadIcd` and `_renderQuadSoap` now have a **📋 Categories | ⏱ Recent** tab strip.
- Active tab persisted to `localStorage` under `quad_icd_tab` / `quad_soap_tab`.
- Files changed: `Daily/app.js`

---

### Task 5 — Quad View: Category Dropdown Menus (Replace Free-text Prompt)

**Problem:** The ⚙️ Edit button used `prompt()` for category selection (poor UX, no visual list).

**Solution:**
- Replaced `prompt()` with an inline dropdown checklist showing all available categories with checkboxes.
- Maximum 10 categories enforced with toast notification.
- Stored to `localStorage` under `quad_icd_categories` / `quad_soap_categories`.
- Files changed: `Daily/app.js`

---

### Task 6 — Quad View: SOAP Segment Filter (S/O/A/P/All)

**Problem:** All SOAP term sections were shown together with no way to filter by S/O/A/P.

**Solution:**
- Added a filter row in the Categories tab of the SOAP panel with S/O/A/P checkboxes.
- Filtering updates the term list in real-time.
- Filter selection persisted to `localStorage` under `quad_soap_seg_filter`.
- Files changed: `Daily/app.js`

---

### Task 7 — Quad View: Save New Entry Button (Shift+R) + Clear Windows

**Problem:** No way to save a completed entry directly from quad view without navigating away.

**Solution:**
- Added a "💾 Save New Entry (Shift+R)" button in the quad view toolbar.
- Shortcut `Shift+R` also triggers save (added to `DEFAULT_SHORTCUTS`).
- On save: builds a session from quad sessionStorage, calls `saveSession()` + `recordIcdUse()`, clears all quad sessionStorage keys, re-renders quad view.
- Files changed: `Daily/app.js`

---

### Task 8 — Quad View: External Web Panel (iframe)

**Problem:** No way to view external reference sites within the quad view.

**Solution:**
- Added a "🌐 Web Panel" button in the quad toolbar.
- Clicking shows a popover with position (TL/TR/BL/BR) + URL selectors:
  - 🔬 UpToDate (`https://www.uptodate.com/contents/search`)
  - 🔍 Google (`https://www.google.com/`)
  - 🧬 OpenEvidence (`https://www.openevidence.com/`)
- Selected panel body replaced with a sandboxed `<iframe>` (no `allow-same-origin`).
- URL whitelist enforced to prevent open-redirect.
- A "✕ Restore" button within the iframe panel restores the original content.
- "✕ Restore All Original Panels" restores all panels.
- Selection persisted to `localStorage` under `quad_ext_panel`.
- Note: some sites (UpToDate, OpenEvidence) may block embedding via `X-Frame-Options`; a warning is shown.
- Files changed: `Daily/app.js`

---

### Task 9 — Repo Cleanup: Remove Redundant Files

**Problem:** Repository contained macOS artifact folders and old backup directories.

**Solution:**
- Removed `__MACOSX/` directory (macOS archive artifacts).
- Removed `PHCEP/backup-2026-04-24/` directory (old backup of Daily app files).
- Files removed: `__MACOSX/Daily/._Daily`, `PHCEP/backup-2026-04-24/*`

---

## Pending / Future Work

### High Priority
- [ ] **ICD-10-CM 2023 Chinese Version Full Expansion** (Task 5 from modification 4 request):
  - Source file `1.2023年中文版ICD-10-CM_PCS_1131118V3.xlsx` is in the repo root (7.3 MB).
  - Categories needed for Neurology specialty (detailed):
    - G00–G09: Inflammatory diseases of CNS
    - G10–G14: Systemic atrophies affecting CNS
    - G20–G26: Extrapyramidal & movement disorders (Parkinson's, HD, etc.)
    - G30–G32: Other degenerative diseases of NS (Alzheimer's, etc.)
    - G35–G37: Demyelinating diseases (MS, NMO)
    - G40–G47: Episodic/paroxysmal disorders (epilepsy, migraine, sleep)
    - G50–G59: Nerve, nerve root & plexus disorders
    - G60–G65: Polyneuropathies
    - G70–G73: Neuromuscular junction & muscle diseases
    - G80–G83: Cerebral palsy & other paralytic syndromes
    - G89–G99: Other disorders of NS (pain, autonomic NS, hydrocephalus)
    - I60–I69: Cerebrovascular diseases (stroke, TIA, etc.)
    - H80–H83: Vestibular disorders (vertigo)
  - Categories needed for Interventional Neuroradiology (detailed):
    - I60–I69: Cerebrovascular
    - G08: Intracranial/spinal phlebitis
    - T80–T88: Complications of procedures
  - Categories needed for Neuromusculoskeletal Ultrasound (detailed):
    - M00–M25: Arthropathies
    - M40–M54: Dorsopathies
    - M60–M79: Soft tissue disorders
    - G50–G59: Nerve root & plexus disorders
  - Categories needed for Chronic Disease (broad):
    - E10–E14: Diabetes mellitus
    - I10–I16: Hypertensive diseases
    - E65–E68: Obesity & other hypernutrition
    - E78: Disorders of lipoprotein metabolism
    - N17–N19: Kidney failure
  - All other categories: broad groupings by ICD chapter
  - This is a multi-stage task requiring parsing the XLSX and generating JSON
- [ ] **Window size persistence** across navigation (Task 2):
  - ICD Browser and SOAP templates floating panel sizes already persist via `floatPositions_v1`
  - Verify this works after switching pages and returning
- [ ] **Drag-and-drop category button reordering** in quad view panels
  - Category buttons in quad ICD/SOAP panels should be reorderable by drag
  - Store order in `localStorage`
- [ ] Add patient-level record linking (multiple visits per patient ID)
- [ ] Export to standard clinical formats (PDF summary, CSV)
- [ ] Settings page: add `saveNewEntryFromQuad` (Shift+R) to configurable shortcuts UI

