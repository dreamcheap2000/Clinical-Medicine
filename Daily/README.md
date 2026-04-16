# Daily OPD Session Logger

A **zero-dependency, browser-local web application** for daily outpatient clinic (OPD) logging with self-classifying ICD-10 codes, SOAP templates, and neurologic / musculoskeletal physical exam references.

---

## How to Use

```bash
# Option 1 — local HTTP server (recommended)
cd Daily
python -m http.server 8080
# then open http://localhost:8080

# Option 2 — open directly (works in most browsers for ES modules)
open Daily/index.html
```

No installation, no build step, no server required.

---

## Daily Workflow

1. **Open the app** → lands on the Dashboard.
2. Click **📝 New Entry** (or the nav bar "New Entry").
3. **Select the date** (defaults to today).
4. **Search for the ICD-10 code** by typing the code (`G43`, `I63`) or a condition in English or Chinese (`migraine`, `偏頭痛`, `stroke`, `腦梗塞`). Select from the dropdown.
5. After selecting a code, click **📋 View SOAP / Exam** to open a reference panel with:
   - Category-level SOAP template (S/O/Assessment Pearls/Plan)
   - Bedside scales and neurologic / physical exam checklist
6. Click **Load Category Template** to auto-fill the SOAP textareas from the template. Edit freely.
7. Fill in **Patient Condition / Presentation** and optionally the **EBM Statement**.
8. Click **💾 Save Entry** — the entry is saved with a date + time timestamp.
9. All today's entries appear on the Dashboard with timestamps. Every subsequent save within the same session adds a new timestamped entry.

---

## Features

### 📋 ICD-10 Self-Classification
- **2,255 billable codes** extracted from the 2023 Chinese ICD-10-CM edition across **13 categories**:

| Category | ICD Range | Codes |
|---|---|---|
| 🧠 Dementia | F01–F03, G30–G31 | 87 |
| ⚡ Epilepsy | G40–G41 | 50 |
| 🤲 Movement Disorders | G20–G26 | 41 |
| 🫀 Stroke / Cerebrovascular | I60–I69, G45–G46 | 432 |
| 🤕 TBI | S06, S09 | 638 |
| 🤯 Headache / Pain | G43–G44, R51 | 86 |
| 👁️ Cranial Nerve Disorders | G50–G55 | 33 |
| 🔬 Peripheral Neuropathy | G56–G63 | 93 |
| 🧬 Demyelinating (MS) | G35–G37 | 13 |
| 🦴 Spine Disorders | M40–M54 | 548 |
| 🦵 Osteoarthritis | M16–M19 | 91 |
| 💪 Shoulder & Elbow | M75–M77 | 84 |
| 🦶 Soft Tissue / Enthesopathy | M72, M79 | 59 |

- Codes are specific to **side of lesion** (e.g., `M75.121` = Complete rotator cuff tear, **right**; `M75.122` = **left**).
- Search is real-time across code, English name, and Chinese name (中文名稱).

### 📋 SOAP + Physical Exam Templates (by Category)
- Each category has a **category-level SOAP template** with subjective cues, objective exam checklist, assessment pearls, and plan template.
- Each category has a **physical exam reference** with bedside scales and step-by-step neurologic / musculoskeletal exam instructions.
- Templates can be loaded into the SOAP textareas in one click and freely edited.

### 📅 Timestamped Daily Log
- Every OPD entry is saved with **date + HH:MM timestamp**.
- Dashboard shows today's entries at the top, followed by recent entries.
- Full edit and delete support.
- Export/import as JSON for backup and multi-device use.

---

## Folder Structure

```
Daily/
├── index.html                  ← SPA shell
├── app.js                      ← Router, localStorage, ICD search, data loading
├── style.css                   ← All styles
├── data/
│   └── icd_categories.json     ← 2255 ICD-10 codes + SOAP/exam templates (13 categories)
├── modules/
│   ├── session-log.js          ← OPD entry form with ICD search, SOAP editor, timestamp
│   ├── icd-browser.js          ← ICD code browser (category sidebar + code table + SOAP tabs)
│   └── soap-view.js            ← Accordion SOAP + exam reference by category
└── README.md
```

---

## Data Persistence & Privacy

All data is stored **only in your browser's localStorage** — nothing is transmitted to any server.

- **Export**: Downloads a dated `.json` backup file.
- **Import**: Merges from a previously exported file (de-duplicates by entry ID).

---

## ICD Data Source

Codes extracted from:
> **2023年版 ICD-10-CM 中文版** (Taiwan MOHW, version 1131118V3)

SOAP templates and physical exam guides are compiled from standard neurologic and musculoskeletal clinical examination practices and are intended as **reference templates only** — always apply clinical judgment.
