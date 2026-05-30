# Work_Progress_20260531

## Completed (2nd modification)
1. Re-reviewed the latest generated 衛教內容 and confirmed English leakage remained in Chinese versions for three section-derived entries from `20260526-1.docx`.
2. Fully rewrote `simple_zh` and `professional_zh` content in `PHCEP/data/edu/patient_edu_data.json` for:
   - 延長時間窗 IVT 之灌注影像選案（非 RAPID 軟體）
   - ICH 外科處置與腫瘤相關出血風險
   - 腦腫瘤相關出血的影像判讀與鑑別
3. Reordered each article into consistent clinical flow (summary → criteria/evidence → practical sequence → conclusion) to improve readability.

## 衛教資源 update status
- ✅ Chinese readability fixed for the three affected entries.
- ✅ English-only paragraphs removed from `simple_zh` and `professional_zh`.
- ✅ Existing `english` versions preserved for bilingual reference.

## Pipeline hardening updates
1. Added an automated Chinese quality guard script:
   - `.github/scripts/validate_edu_translations.py`
2. Planned/linked workflow gate to fail CI when long English sentence blocks are detected in Chinese fields.
3. Updated workflow documentation to include this QA guardrail, so future uploads under `Patient education/` are blocked before bad output is committed.

## Remaining follow-up
1. Spot-check the updated entries in PHCEP UI (`衛教資源` tab) after deployment.
2. Continue optional editorial polishing for terminology consistency across all historical entries.
