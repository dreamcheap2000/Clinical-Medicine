# Apps Script deployment

This directory contains the LINE Official Account Apps Script backend, now tracked in Git and deployable with `clasp`.

## Files
- `Code.gs`: webhook, LINE helpers, QA sync endpoints, and similarity-based auto reply logic.
- `Similarity.js`: pure-JS similarity module shared by Apps Script and Node tests.
- `appsscript.json`: Apps Script manifest.
- `.clasp.json.template`: local template for `clasp`; CI writes the real `.clasp.json` from `CLASP_SCRIPT_ID`.

## One-time setup
1. Install `clasp` locally: `npm i -g @google/clasp`
2. Run `clasp login`
3. Copy `~/.clasprc.json` into the GitHub Actions secret `CLASPRC_JSON`
4. Add GitHub Actions secrets:
   - `CLASP_SCRIPT_ID`
   - `CLASP_DEPLOYMENT_ID`
   - `CLASPRC_JSON`
   - `GS_WEBAPP_URL`
   - `GS_WEBAPP_SECRET`
5. Enable the Apps Script API at <https://script.google.com/home/usersettings>
6. In Apps Script **Project Settings → Script properties**, set:
   - `GS_WEBAPP_SECRET`
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `QA_THRESHOLD` (optional, default `0.35`)
   - `QA_REPLY_FIELD` (`ANSWER`, `QUESTION`, or `QUESTION_AND_ANSWER`; default `ANSWER`)
   - `DEFAULT_FALLBACK_REPLY` (optional; leave empty to preserve the old “log only” fallback)

## QA data management
- Edit repository QA pairs in `/home/runner/work/Clinical-Medicine/Clinical-Medicine/qa_pairs.json`
- The `embed.yml` workflow can generate `q_vec` / `a_vec` fields and sync them to the script
- The Apps Script accepts the following authenticated actions:
  - `GET ?action=health&secret=...`
  - `GET ?action=list_qa&secret=...`
  - `POST {"action":"sync_qa","secret":"...","overwrite":true,"items":[...]}`
  - `POST {"action":"upsert_qa","secret":"...","items":[...]}`
- QA rows are stored in the `QA` sheet (or legacy `QA_BASE` sheet if it already exists)
- Unmatched LINE messages are logged to `UNMATCHED_QA`

## Threshold tuning
- Start with `QA_THRESHOLD=0.35`
- Increase the threshold if replies are too aggressive
- Lower the threshold if obvious matches are missed
- Keyword hits add a small bonus, so keep the `Keywords` column concise and relevant

## Local test
Run the shared similarity tests:

```bash
cd /home/runner/work/Clinical-Medicine/Clinical-Medicine/apps-script
npm test
```
