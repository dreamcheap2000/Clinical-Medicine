# Clinical Medicine — PHCEP

Primary Health Care Electronic Program (PHCEP) for Taiwan Core IG ICD-10 & NHI reference.

## 🌐 GitHub Page

**Live site:** [https://dreamcheap2000.github.io/Clinical-Medicine/](https://dreamcheap2000.github.io/Clinical-Medicine/)

## 📐 Framework

The GitHub Page is a single-page application (SPA) built with vanilla HTML / CSS / JavaScript — no build step or framework dependency. All data is embedded as static JSON files served directly by GitHub Pages.

### Tab structure

| Tab | Description |
|-----|-------------|
| 📚 衛教資源 | Patient education resources (FastSR-powered search) |
| 💊 藥品給付規定 | NHI drug coverage rules |
| 📖 參考資料 | Reference documents |
| ICD-10-CM (診斷) | ICD-10-CM 2023 Chinese diagnosis codes |
| 💰 NHI支付標準 | NHI payment standard codes (181st ed.) |
| ICD-10-PCS (處置) | ICD-10-PCS procedure codes |
| 🔩 特材給付 | Special materials coverage |
| 📝 EBM筆記 | Evidence-based medicine notes |
| 🏥 SOAP病歷 | SOAP note writer |
| 🗂️ 歷史記錄 | Session history |
| 🩺 治療流程 | Clinical workflow diagrams ([EVT](PHCEP/workflow/README.md) — acute stroke thrombectomy) |
| ⚙️ 設定 | Settings & keyboard shortcuts |

### 📚 衛教資源 — FastSR Framework

The patient education tab uses a **FastSR** (Fast Structured Retrieval) system, inspired by the EBM-NLP PICO framework adapted to clinical SOAP format.

#### Data schema (v2.0)

Each education entry contains:

| Field | Description |
|-------|-------------|
| `title` | Auto-extracted or manual entry title |
| `source_url` | Source URL(s); multiple URLs shown as an expandable list |
| `tags` | Keywords for fast filtering |
| `fastsr.S/O/A/P` | Sentences classified into SOAP sections for semantic search |
| `versions.simple_zh` | Patient-friendly Traditional Chinese |
| `versions.professional_zh` | Medical-professional Traditional Chinese |
| `versions.english` | English version |

#### Search optimization

- **FastSR 3-Prototype Scoring**: Every query is scored against three prototype representations per entry, and the total match score (0–100%) is decomposed into three proportional contributions that sum to 100%:
  - **Global (G%)** — `blue bar`: query-token recall against the full document's bag-of-words vocabulary (Protocon)
  - **Semantic (S%)** — `amber bar`: query-token recall against domain-specific medical vocabulary present in the entry (Protosem)
  - **Fragment (F%)** — `green bar`: maximum per-sentence query-token recall across all SOAP sentences (Protofrag)
- **Title boost**: +50 points added when query tokens match the entry title.
- **SOAP section pills**: shown in section-filter mode (S/O/A/P buttons) to indicate which section matched.
- **Search mode filter**: Users can restrict search to a single SOAP section (S / O / A / P).
- **Search history**: Last 50 queries persisted per tab; auto-saved after 10 seconds of no change.

#### GitHub Actions auto-translation (GitHub Models AI)

When a `.docx` or `.txt` file is pushed to `Patient education/`:

1. Content is treated as the **professional version** (`professional_zh` or `english` depending on detected language).
2. The **GitHub Models API** (`https://models.inference.ai.azure.com`, default model `gpt-4o-mini` — see [GitHub Models docs](https://docs.github.com/en/github-models) for available model names) is called using the built-in `GITHUB_TOKEN` — **no external secrets required**.
3. FastSR auto-classifies sentences into S/O/A/P structure.
4. **Three prototype representations** are pre-computed and stored in the JSON for fast client-side scoring.
5. URLs in the text are extracted and stored in `source_url`.
6. The entry is merged into `PHCEP/data/edu/patient_edu_data.json` and committed automatically.

### Key features

- Dark / light mode toggle (persisted in `localStorage`)
- Full-text ICD-10-CM & ICD-10-PCS code search (Chinese + English)
- NHI payment standard lookup (181st edition, 115.04.01)
- Special materials (特材) coverage viewer
- EVT acute stroke thrombectomy workflow diagrams
- Keyboard shortcuts: **Alt/Option + 1–8** to switch tabs; **Shift + 9** (歷史紀錄), **Shift + 0** (治療流程), **Shift + -** (設定); **Alt/Option + ↑/↓** to scroll; **Cmd/Ctrl + ↑/↓** to jump to top/bottom

### Repository layout

```
Clinical-Medicine/
├── PHCEP/                  ← main SPA (GitHub Pages root)
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── data/               ← ICD & NHI JSON data
│   │   └── edu/
│   │       └── patient_edu_data.json  ← v2 FastSR education entries
│   ├── workflow/           ← clinical workflow images
│   │   ├── README.md       ← EVT flowchart display page
│   │   ├── EVT_Flowchart_01.png
│   │   └── EVT_Flowchart_02.png
│   └── *.xlsx / *.pdf      ← ICD / NHI reference files
├── Patient education/      ← upload .docx/.txt here; CI auto-translates & updates JSON
├── .github/
│   ├── scripts/
│   │   ├── build_edu_data.py        ← AI-powered v2 entry builder
│   │   └── translate_edu.py         ← (imported by build_edu_data.py)
│   └── workflows/
│       ├── update-edu-data.yml      ← triggers on Patient education/ push
│       └── deploy-pages.yml         ← deploys PHCEP/ to GitHub Pages
└── Report/                 ← reports
```
