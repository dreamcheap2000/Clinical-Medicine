# Clinical Medicine — PHCEP

Primary Health Care Electronic Program (PHCEP) for Taiwan Core IG ICD-10 & NHI reference.

## 🌐 GitHub Page

**Live site:** [https://dreamcheap2000.github.io/Clinical-Medicine/PHCEP/](https://dreamcheap2000.github.io/Clinical-Medicine/PHCEP/)

## 📐 Framework

The GitHub Page is a single-page application (SPA) built with vanilla HTML / CSS / JavaScript — no build step or framework dependency. All data is embedded as static JSON files served directly by GitHub Pages.

### Tab structure

| Tab | Description |
|-----|-------------|
| 📚 衛教資源 | Patient education resources |
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

### Key features

- Dark / light mode toggle (persisted in `localStorage`)
- Full-text ICD-10-CM & ICD-10-PCS code search (Chinese + English)
- NHI payment standard lookup (181st edition, 115.04.01)
- Special materials (特材) coverage viewer
- EVT acute stroke thrombectomy workflow diagrams
- Keyboard shortcuts: **Alt/Option + 1–8** to switch tabs; **Alt/Option + ↑/↓** to scroll; **Cmd/Ctrl + ↑/↓** to jump to top/bottom

### Repository layout

```
Clinical-Medicine/
├── PHCEP/                  ← main SPA (GitHub Pages root)
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── data/               ← ICD & NHI JSON data
│   ├── workflow/           ← clinical workflow images
│   │   ├── README.md       ← EVT flowchart display page
│   │   ├── EVT_Flowchart_01.png
│   │   └── EVT_Flowchart_02.png
│   └── *.xlsx / *.pdf      ← ICD / NHI reference files
├── Patient education/      ← patient handout materials
└── Report/                 ← reports
```
