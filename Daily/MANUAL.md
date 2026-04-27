# Daily OPD Session Logger — User Manual

**App URL:** Served as a GitHub Pages site from the `Daily/` directory.  
**For:** Dr. Chan Lin-Chu (Neurology / Interventional Neuroradiology / Neuromusculoskeletal Ultrasound)

---

## Table of Contents

1. [Overview](#overview)
2. [Navigation](#navigation)
3. [Quad View (🔲)](#quad-view)
4. [New Entry (📝)](#new-entry)
5. [ICD Browser (🔍)](#icd-browser)
6. [SOAP Templates (📋)](#soap-templates)
7. [Home Dashboard (🏠)](#home-dashboard)
8. [Medical Stats (📊)](#medical-stats)
9. [Settings (⚙️)](#settings)
10. [Data Sync & Storage](#data-sync--storage)
11. [Keyboard Shortcuts](#keyboard-shortcuts)
12. [FAQ](#faq)

---

## Overview

The **Daily OPD Session Logger** is a browser-based clinical documentation tool designed for outpatient neurology practice. It helps you:

- **Browse 73,000+ ICD-10-CM codes** (2023 Chinese Edition) organized into 10 specialty categories.
- **Build SOAP notes** quickly by selecting from pre-built templates.
- **Record each patient encounter** with ICD code(s), SOAP note, and key learning point.
- **View statistics** on your practice patterns.
- Work efficiently via the **Quad View** — four panels visible simultaneously.

All data is stored in your browser's `localStorage`. No server required.

---

## Navigation

The navigation bar at the top provides quick access to all pages:

| Button | Page |
|--------|------|
| 🔲 Quad View | Four-panel split-screen view |
| 🏠 Home | Dashboard with recent entries and stats |
| 📝 New Entry | Form to add a new OPD encounter |
| 🔍 ICD Browser | Browse and search all ICD-10-CM codes |
| 📋 SOAP Templates | Pre-built SOAP templates by specialty |
| 📊 Medical Stats | Charts and statistics of your practice |
| ⚙️ Settings | Keyboard shortcuts and data management |

---

## Quad View

The Quad View divides the screen into four panels (TL/TR/BL/BR):

| Position | Default Content |
|----------|----------------|
| Top-Left (TL) | 🏠 Home Dashboard (mini) |
| Top-Right (TR) | 📝 Quick Entry form |
| Bottom-Left (BL) | 🔍 ICD Browser panel |
| Bottom-Right (BR) | 📋 SOAP Templates panel |

### How to use the Quad View

1. **ICD Panel (BL):**
   - Click a category button (emoji icon) to browse codes for that category.
   - Check codes you want to use — they are automatically added to `quad_icd_checked`.
   - Use the search box to find any specialty ICD code by code number, English, or Chinese.
   - Click **"Categories"** tab to browse, or **"⏱ Recent"** tab to see your most-used codes.

2. **SOAP Panel (BR):**
   - Click a category button (emoji icon) to load SOAP templates for that specialty.
   - Check SOAP term items — they are automatically inserted into the SOAP note textarea in the TR panel.
   - Use the S/O/A/P filter buttons to show only terms of a specific SOAP section.

3. **Quick Entry (TR):**
   - Date and patient ID fields.
   - EBM statement field.
   - SOAP note textarea — auto-populated from checked SOAP items in the BR panel.
   - Checked ICD codes from the BL panel are auto-linked.

4. **Toolbar buttons (top of page):**
   - **💾 Save New Entry (Shift+R):** Saves the current Quad view data as a new patient encounter.
   - **🗑 Clear All:** Clears all Quad view inputs (date/pid/SOAP/ICD/EBM).
   - **🌐 Web Panel:** Replaces any panel with an embedded iframe (UpToDate, Google, OpenEvidence).

### Syncing with New Entry page

When you click **"📝 Open New Entry"** in the Quad View, all checked ICD codes and SOAP text are automatically pre-filled into the New Entry form. Changes in the New Entry form are also saved back via the form draft system.

---

## New Entry

The New Entry page (📝) is for recording individual patient encounters.

### Fields

| Field | Description |
|-------|-------------|
| Date | Encounter date (defaults to today) |
| Patient ID | Optional identifier (anonymized) |
| ICD-10 Codes | Search and add multiple ICD codes |
| Key Learning Point | EBM statement or clinical pearl |
| SOAP Note | Free-text SOAP note (no forced structure) |

### Adding ICD codes

1. Type in the **ICD search box** — search by code (e.g. `G43`) or condition name (e.g. `migraine` or `偏頭痛`).
2. Results appear from 73,000+ ICD-10-CM codes. Click any result to add it.
3. Multiple codes can be added; each appears as a removable tag.
4. The right-side **ghost panel** shows SOAP templates for the selected code's category.

### Ghost Panel (SOAP Reference)

- Click **"🔍 Template Items"** to show the ghost panel on the right.
- Browse and check SOAP items, then click **"✓ Insert"** to insert them into the SOAP textarea.
- The ghost panel auto-opens when you select an ICD code.

### Saving

Click **"💾 Save Entry"** to save the record. It is stored in `localStorage` and the Home Dashboard will show the new entry.

### FHIR Export

Click **"🏥 FHIR Export"** to download a FHIR Bundle JSON file for the current entry.

---

## ICD Browser

The ICD Browser (🔍) provides full access to the 2023 ICD-10-CM Chinese edition (73,681 billable codes).

### Category Buttons (Icon-Only Mode)

- The top area shows **emoji icon buttons** arranged in a grid — one per category.
- **Hover** over an icon to see its English and Chinese category name.
- **Click** an icon to browse that category's codes.
- **Drag** icons to reposition them anywhere in the grid area. Positions are remembered.

### 10 ICD Categories

| Icon | Category (EN) | 中文 | ICD Range |
|------|--------------|------|-----------|
| 🧠 | Dementia & Neurodegeneration | 失智/神經退化 | F01–F09, G00–G14, G30–G37, G80–G83 |
| 🫀 | Cerebrovascular & Stroke | 腦血管疾病/腦中風 | G45–G46, I60–I69 |
| ⚡ | Epilepsy | 癲癇 | G40–G41 |
| 🤕 | Headache & Migraine | 頭痛/偏頭痛 | G43–G44 |
| 🌀 | Movement Disorders | 動作障礙 | G20–G26 |
| 😴 | Sleep Disorders | 睡眠疾患 | G47 |
| 🦾 | Neuromuscular & Peripheral Nerve | 神經肌肉/周邊神經 | G50–G73, G89–G99, H81–H83 |
| 🦴 | Spine & Musculoskeletal | 脊椎/骨骼肌肉 | M00–M99 |
| 💊 | Chronic Disease Management | 慢性病管理 | E10–E14, E65–E68, E78, I10–I16, J44–J45, N17–N19 |
| 📋 | Other Conditions | 其他疾病 | All other codes |

> **Note:** The "Other Conditions" category contains 65,000+ codes. Use the search box to find codes in this category.

### Browsing a Category

After clicking a category:
- **Codes tab:** A filterable table of all codes in that category. Check codes, then click **"➕ Insert Checked"** to pre-fill them into New Entry.
- **SOAP tab:** Merged SOAP templates from the relevant specialty sub-categories.

Use the **in-category filter box** to narrow down codes within the table.

### Global Search

Type in the search box at the top to search across all 9 specialty categories simultaneously (73k codes searchable once loaded). Results show code, English name, Chinese name, and category. Click a result to jump to that category with the code highlighted.

### Recently Used Panel

The **"📊 Recent Codes"** floating panel (drag handle at top) shows your 50 most-used ICD codes:
- Check codes in this panel, then click **"➕ Insert Sel."** to pre-fill into New Entry.
- **Double-click** the header to minimize/expand the panel.
- Panel size and position are remembered between sessions.

---

## SOAP Templates

The SOAP Templates page (📋) provides reference templates organized by specialty category.

### Category Buttons (Icon-Only Mode)

Same as ICD Browser — emoji icons, hover to see full name, drag to reposition.

22 specialty sub-categories are available, reflecting the doctor's detailed clinical domains.

### Viewing a Category

After clicking a category:
- **S — Subjective:** Typical patient-reported symptoms and history items.
- **O — Objective:** Examination and bedside scale items (merged from physicalExam data).
- **Assessment Pearls:** Clinical pearls and diagnostic criteria.
- **Plan Template:** Management steps and follow-up points.

Each item has a **checkbox**. Check all items you want, then click **"➕ Insert All Checked to New Entry"**.

### Insert vs Copy

| Button | What it does |
|--------|-------------|
| ➕ Insert All Checked to New Entry | Inserts **term labels** (before ":") into the SOAP textarea, structured by section (S:/O:/A:/P:), then navigates to New Entry form |
| 📋 Copy All Checked (full text) | Copies **full item text** (including detail after ":") to clipboard without navigating |

### Recently Used Terms Panel

- **"📊 Recent Terms"** toggle shows/hides the floating Recently Used Terms panel.
- Shows your most-used SOAP items across all categories, grouped by S/O/A/P section.
- All items in the recent panel are also checkable and included in Insert/Copy operations.
- Panel size and position are remembered between sessions.

---

## Home Dashboard

The Dashboard (🏠) shows:

- **Statistics cards:** Total entries, unique patients, ICD codes used, unique conditions.
- **Quick actions:** New Entry, ICD Browser, SOAP Templates, Medical Stats.
- **Recent entries:** Last 10 encounters with ICD codes, date, patient ID, and SOAP summary.
- **Data Management:** Export JSON, Import JSON, Restore from Repo.

### Restoring Data

If you visit the app on a new device, click **"📂 Restore from Repo"** to reload sessions that were previously synced to the repository.

---

## Medical Stats

The Stats page (📊) shows:

- **Pie chart:** Distribution of ICD categories used.
- **Bar chart:** Most frequent ICD codes.
- **Trend chart:** Monthly session volume.
- **SOAP frequency:** Most-used SOAP terms by section.

---

## Settings

The Settings page (⚙️) allows customization of:

### Keyboard Shortcuts

| Action | Default | Description |
|--------|---------|-------------|
| Quad View | `Q` | Jump to Quad View from anywhere |
| Insert SOAP (ghost panel) | `Shift+C` | Insert all checked items in the ghost panel |
| Insert SOAP All (templates page) | `Shift+I` | Insert all checked items on SOAP Templates page |
| Insert ICD (browser page) | `Shift+S` | Insert selected ICD codes from browser |
| Insert All (global) | `Shift+A` | Insert all checked items on current page |
| Save Entry (Quad) | `Shift+R` | Save a new entry directly from Quad View |

You can change any shortcut by typing a new key combination (e.g. `Ctrl+I`, `Alt+S`).

### Data Management

- **Export JSON:** Download all session data as a JSON file.
- **Import JSON:** Import sessions from a JSON file.
- **Clear All Data:** Permanently delete all local session data.

---

## Data Sync & Storage

### Where data is stored

- All session data is stored in your browser's **`localStorage`**.
- Floating panel positions are also stored in `localStorage` under `floatPositions_v1`.
- Floating panel visibility/minimize states are under `floatPanelState_v1`.
- Form drafts (unsaved entries) are stored in `sessionStorage` under `opdFormDraft_v1`.
- Quad view in-progress data is stored in `sessionStorage` under `quad_*` keys.

### Persistence across navigation

| Data | Persists |
|------|----------|
| Saved patient entries | ✅ localStorage (permanent) |
| Panel positions/sizes | ✅ localStorage (permanent) |
| Category preferences | ✅ localStorage (permanent) |
| Quad view inputs | ✅ sessionStorage (tab lifetime) |
| Checked ICD codes | ✅ sessionStorage → pre-filled in New Entry |
| Checked SOAP terms | ✅ sessionStorage → pre-filled in New Entry |
| Form draft | ✅ sessionStorage → restored on return to New Entry |

### GitHub Sync

If the repository is set up with GitHub Pages, session JSON files can be committed to `Daily/sessions/`. On first load, the app tries to restore sessions from these files via `restoreSessionsFromRepo()`.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Q` | Navigate to Quad View |
| `Shift+C` | Insert SOAP items from ghost panel (in New Entry) |
| `Shift+I` | Insert all checked items (SOAP Templates page) |
| `Shift+S` | Insert selected ICD codes (ICD Browser page) |
| `Shift+A` | Insert all (any page) |
| `Shift+R` | Save new entry from Quad View |

> All shortcuts can be customized in ⚙️ Settings.

---

## FAQ

**Q: Why don't some codes appear in the search?**  
A: The 9 specialty categories (~8,164 codes) are preloaded at startup. The "Other Conditions" category (65,517 codes) is searchable via the global search box but codes are not listed in a table. If you need a non-specialty code, type its code prefix in the search box.

**Q: What happens to my data if I clear the browser?**  
A: Data is stored in `localStorage` — clearing browser cache/cookies will erase it. Use Export JSON before clearing, or commit sessions to the repo for GitHub-based restore.

**Q: Can I use this on mobile?**  
A: The app works on mobile browsers, but the Quad View is best suited for large screens (laptop/desktop). On small screens, the individual pages (New Entry, ICD Browser, SOAP Templates) work well.

**Q: Why does the "Others" category not show a code list?**  
A: The Others category contains 65,517 codes. Displaying them all in a table would be impractical. Use the search box to find any specific code in this category.

**Q: How do I find a specific ICD code quickly?**  
A: Type the code prefix (e.g. `N80`) or a condition name (e.g. `endometriosis` or `子宮內膜異位症`) in the global search box on the ICD Browser page. Results appear within 200ms from the preloaded specialty cache.

**Q: The floating panel disappeared — how do I get it back?**  
A: Click the **"📊 Recent Codes"** or **"📊 Recent Terms"** button in the action bar at the top of the ICD Browser or SOAP Templates page.
