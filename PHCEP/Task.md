# PHCEP — Task.md  
**Primary Health Care Electronic Program**  
Development Progress Log

---

## Project Overview

PHCEP is a static web application (GitHub Pages) built under the **PHCEP/** folder of the Clinical-Medicine repository.  
It is based on the **Taiwan Core Implementation Guide (TW Core IG)** and presents 2023 ICD-10-CM / ICD-10-PCS codes categorised by relevance to Dr. Chan-Lin Chu's specialty profile.

**TW Core IG:**  
- Website: https://twcore.mohw.gov.tw/ig/twcore/  
- GitHub: https://github.com/ITRI-BDL-D/MOHW_TWCoreIG  

**Data source:**  
`1.2023年中文版ICD-10-CM_PCS_1131118V3(修改ICD-10-CM之N80.A0等中文名稱).xlsx`  
- Sheet `ICD-10-CM` — 73,681 billable codes (USE=1)  
- Sheet `ICD-10-PCS` — 78,530 billable codes (USE=1)  

**Doctor's specialty profile:**  
https://github.com/dreamcheap2000/Dr.-Chan-Lin-Chu-CV-and-licenses/blob/79e059a5437c089471ae4aed303f51bf8626dba7/README.md

---

## Milestone 1 — Initial Build (2026-04-28)

### Task 1 — Data Generation

**Python script:** `/tmp/gen_phcep_data.py` (not committed; reproducible)

**ICD-10-CM category definitions (based on doctor's specialty):**

| # | ID | Icon | English | 中文 | Code Range | Count |
|---|----|----|---------|------|------------|-------|
| 1 | `neuro_degen` | 🧠 | Neurodegenerative & Dementia | 神經退化性疾病與失智症 | F01–F09, G10–G14, G20–G26, G30–G37, G80–G83 | 243 |
| 2 | `cerebrovascular` | 🫀 | Cerebrovascular Disease & Stroke | 腦血管疾病與腦中風 | G45–G46, I60–I69 | 432 |
| 3 | `epilepsy` | ⚡ | Epilepsy & Seizure Disorders | 癲癇與發作性疾患 | G40–G41 | 50 |
| 4 | `headache` | 🤕 | Headache & Migraine | 頭痛與偏頭痛 | G43–G44 | 84 |
| 5 | `neuromuscular` | 🦾 | Neuromuscular, Peripheral Nerve & Vestibular | 神經肌肉、周邊神經與前庭疾患 | G50–G73, G89–G99, H81–H83 | 340 |
| 6 | `sleep` | 😴 | Sleep Disorders | 睡眠疾患 | G47 | 43 |
| 7 | `msk_spine` | 🦴 | Musculoskeletal & Spine | 骨骼肌肉與脊椎 | M00–M99 | 5,202 |
| 8 | `chronic` | 💊 | Chronic Disease Management | 慢性病管理 | E10–E14, E55, E65–E68, E78–E79, I10–I16, J44–J45, M80–M85, N17–N19 | 1,742 |
| 9 | `others` | 📋 | Other Conditions (compact) | 其他疾病（精簡） | All remaining | 65,545 |

**ICD-10-PCS category definitions:**

| # | ID | Icon | English | 中文 | Code Range | Count |
|---|----|----|---------|------|------------|-------|
| 1 | `cns_pns` | 🔬 | CNS & PNS Surgical Procedures | 中樞與周邊神經外科手術 | 00x (CNS), 01x (PNS) | 3,144 |
| 2 | `cerebrovascular_proc` | 🫀 | Cerebrovascular & Neurointerventional Procedures | 腦血管與神經介入手術 | 03x (Upper Arteries) | 3,830 |
| 3 | `imaging_neuro` | 🖼️ | Neurological & Vascular Imaging | 神經與血管影像診斷 | B0x (CNS Imaging), B3x (Arteries), B5x (Head/Neck) | 955 |
| 4 | `rehab` | 🏃 | Physical Rehabilitation & Diagnostic Audiology | 物理復健與聽力診斷 | F0x–F1x | 1,380 |
| 5 | `others` | 📋 | Other Procedures (compact) | 其他手術處置（精簡） | All remaining | 69,221 |

**FHIR profile references (TW Core IG):**
- `Condition` (ICD-10-CM codes): `Condition-twcore`  
  https://twcore.mohw.gov.tw/ig/twcore/StructureDefinition-Condition-twcore.html
- `Procedure` (ICD-10-PCS codes): `Procedure-twcore`  
  https://twcore.mohw.gov.tw/ig/twcore/StructureDefinition-Procedure-twcore.html

**Data format:**
- Relevant specialty codes: `{"codes": [{"code": "...", "en": "...", "zh": "..."}, ...]}`
- Non-relevant (others): compact `[[code, zh_name], ...]` — no EN name to reduce file size

**Files generated:**
```
PHCEP/data/meta.json                         (category metadata + TW Core IG references)
PHCEP/data/cm/neuro_degen.json               (29 KB)
PHCEP/data/cm/cerebrovascular.json           (67 KB)
PHCEP/data/cm/epilepsy.json                  (10 KB)
PHCEP/data/cm/headache.json                  (11 KB)
PHCEP/data/cm/neuromuscular.json             (35 KB)
PHCEP/data/cm/sleep.json                     (4 KB)
PHCEP/data/cm/msk_spine.json                 (646 KB)
PHCEP/data/cm/chronic.json                   (312 KB)
PHCEP/data/cm/others_compact.json            (4.6 MB — 65,545 codes, compact)
PHCEP/data/pcs/cns_pns.json                  (432 KB)
PHCEP/data/pcs/cerebrovascular_proc.json     (639 KB)
PHCEP/data/pcs/imaging_neuro.json            (148 KB)
PHCEP/data/pcs/rehab.json                    (234 KB)
PHCEP/data/pcs/others_compact.json           (4.3 MB — 69,221 codes, compact)
```

---

### Task 2 — Static Web App (GitHub Pages)

**Files created:**
```
PHCEP/index.html    — Single-page app entry point
PHCEP/style.css     — Dark theme, responsive layout
PHCEP/app.js        — Category grid, detail table, search, TW Core IG badges
```

**Features:**
- 🏷️ Header with TW Core IG version badge and code counts
- 📁 Two tabs: ICD-10-CM (Condition) and ICD-10-PCS (Procedure)
- 🗂️ Category grid: specialty categories (full detail) + others (compact)
- 📋 Per-category code table with filter input
- 🔗 FHIR profile chip linking to TW Core IG for each category
- 🔍 Search tab: searches all pre-loaded specialty categories; optionally loads others
- ℹ️ About tab: full metadata table, TW Core IG references, future work list
- ⚡ Specialty categories pre-loaded in background; others loaded lazily on demand

---

### Task 3 — GitHub Pages Deployment (Future)

The GitHub Pages workflow currently deploys `Daily/` only.  
To enable PHCEP as a GitHub Page, either:
1. Update `.github/workflows/deploy-pages.yml` to deploy the full repo root and access via `/PHCEP/`
2. Or add a second GitHub Actions job to deploy `PHCEP/` to a subdirectory

> **Status:** Deferred to future milestone.

---

## Pending / Future Work

- [ ] GitHub Pages deployment workflow for PHCEP
- [ ] FHIR Condition / Procedure resource generator (from selected codes → JSON Bundle)
- [ ] Virtual scrolling for large categories (msk_spine: 5,202; cns_pns: 3,144; etc.)
- [ ] Export search results to CSV
- [ ] Cross-reference with Daily OPD Classifier (shared code lookup)
- [ ] Add `Encounter` / `Patient` TW Core IG profile references
- [ ] FHIR CodeSystem validation endpoint integration
