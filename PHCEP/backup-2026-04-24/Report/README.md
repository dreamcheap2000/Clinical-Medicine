# Clinical Exam Report System

A **self-contained, zero-dependency web application** for recording, classifying, and analysing clinical examination reports. No build step, no server required — open `index.html` directly in a modern browser or host on GitHub Pages.

---

## Supported Exam Types

| Exam Type | Key Fields |
|---|---|
| 💉 Ultrasound-Guided Injection | Target site, needle approach, substance, volume, guidance quality, outcome |
| 🫀 Color-Coded US & Doppler (Neck) | CCA/ICA/ECA/VA stenosis, IMT, PSV/EDV, plaque character |
| 🧠 Transcranial Color-Coded Sonography (TCCS) | Window quality, MCA/ACA/PCA/BA velocities, PI, emboli, midline shift, SN echogenicity |
| ⚡ Electroencephalography (EEG) | Background activity, focal slowing, epileptiform discharges, seizure type, medications |
| 🔬 NCV / EMG | Motor/sensory nerve conduction, MUAP analysis, pattern (axonal/demyelinating/myopathic) |

---

## Quick Start

```bash
# Option 1 — open directly (no server; some browsers block local ES modules)
open Report/index.html

# Option 2 — local HTTP server (recommended for full functionality)
cd Report
python -m http.server 8080
# then open http://localhost:8080
```

---

## Folder Structure

```
Report/
├── index.html              ← Single-page application shell
├── app.js                  ← Core router, state, localStorage persistence
├── style.css               ← All styles
├── data/
│   └── reports.json        ← Seed / export template (not read at runtime)
├── templates/
│   ├── ultrasound_injection.json
│   ├── neck_doppler.json
│   ├── tccs.json
│   ├── eeg.json
│   └── ncv_emg.json
├── modules/
│   ├── report-form.js      ← Dynamic form renderer
│   ├── report-list.js      ← Search / filter / delete list
│   ├── statistics.js       ← Chart.js dashboard
│   ├── template-engine.js  ← Frequency-based impression suggestions
│   └── classifier.js       ← Rule-based abnormality tagging
└── README.md
```

---

## Features

### 📝 Report Entry
- Select an exam type → form fields are rendered dynamically from the template JSON.
- Supports text, number, date, single-select, multi-select, and free-text textarea fields.
- Required field validation before save.

### 💡 Auto-Suggestion Engine (`template-engine.js`)
- As you fill in fields, the system scans all previously saved reports of the same exam type.
- Ranks matching impressions by keyword overlap (TF-IDF-lite, frequency-based).
- Click a suggestion chip to insert the impression text — accept, edit, or discard.
- No machine-learning server needed; improves automatically as more reports are saved.

### 🏷️ Auto-Classification (`classifier.js`)
- Each template defines `abnormality_rules` (field + condition → tag).
- On save, every report gets a `tags[]` array (e.g., `["Significant Right ICA Stenosis", "Ulcerated Plaque"]`).
- Supports rule types: `equals`, `not_equals`, `in`, `contains`, `not_contains`, `gt`, `lt`, `gte`, `lte`.

### 📋 Report Archive (`report-list.js`)
- Full-text search across patient ID, name, tags, impression.
- Filter by exam type, date range.
- View detail modal, edit, or delete any record.

### 📊 Statistics Dashboard (`statistics.js`)
- Reports by exam type (bar chart).
- Abnormality flag frequency top-10 (horizontal bar).
- Reports and abnormalities over time — monthly (line chart).
- Abnormality rate by exam type (doughnut).
- Procedure / template version evolution (stacked bar).
- Interactive date-range and exam-type filters.

### 💾 Data Persistence
- All reports are stored in **browser localStorage** (`clinicalReports_v1`).
- **Export** to a dated `clinical-reports-YYYY-MM-DD.json` file.
- **Import** from a previously exported JSON — de-duplicates by report ID.

---

## Template Schema

Each `templates/*.json` file defines the full form structure:

```jsonc
{
  "examType": "neck_doppler",
  "version": "1.0.0",
  "title": "...",
  "changelog": [
    { "version": "1.0.0", "date": "2026-04-13", "note": "Initial template" }
  ],
  "sections": [
    {
      "id": "vessels",
      "label": "Vessels",
      "fields": [
        {
          "id": "ICA_right_stenosis",
          "label": "Right ICA Stenosis",
          "type": "select",                         // text | number | date | select | multiselect | textarea
          "required": false,
          "choices": ["Normal", "< 50%", "50–69%"], // for select / multiselect
          "min": 0, "max": 100,                     // for number
          "hint": "Optional helper text"
        }
      ]
    }
  ],
  "abnormality_rules": [
    {
      "field": "ICA_right_stenosis",
      "in": ["50–69%", "70–99%", "Occluded"],       // operator: equals | not_equals | in | contains | not_contains | gt | lt
      "classify": "Significant Right ICA Stenosis"   // tag applied to report
    }
  ]
}
```

### Adding a New Exam Type

1. Create `templates/my_exam.json` following the schema above.
2. Add an entry to `EXAM_TYPES` in `app.js`:
   ```js
   my_exam: { title: 'My New Exam', icon: '🩻', file: 'templates/my_exam.json' }
   ```
3. Reload — the new exam type appears automatically in the UI.

### Updating a Template (versioning)

1. Add a new entry to `changelog[]` with today's date and a description.
2. Increment `version` (e.g., `"1.0.0"` → `"1.1.0"`).
3. Add/modify fields or rules.

Existing reports retain their original `templateVersion`, so the statistics dashboard can track which version of a procedure was used over time.

---

## Browser Compatibility

Works in all modern browsers (Chrome ≥ 90, Firefox ≥ 90, Safari ≥ 14, Edge ≥ 90) using native ES Modules. Internet Explorer is not supported.

---

## Privacy

All data is stored **locally in your browser**. Nothing is transmitted to any server. Use the Export function to back up data and share between devices.
