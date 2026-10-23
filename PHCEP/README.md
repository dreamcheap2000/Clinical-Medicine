# PHCEP LINE OA integration

This directory provides **code provisioning**, not a live deployment. No Google
Sheet, Form, LINE channel, or cloud service was created/deployed by this PR.
All IDs/URLs returned by setup come from the authorized operator's actual account.
The clinical frontend (`app.js`, `index.html`, `style.css`) and reference documents
are unchanged. The Central/Peripheral **clinical** route is unrelated to backend mode.

## Architecture

```text
LINE (one webhook URL: https://YOUR_GATEWAY/webhook)
  │ exact raw bytes + X-Line-Signature
  ▼
Node gateway: verify LINE HMAC, bound body, select ONE configured backend
  ├─ APPS_SCRIPT ────────────────────────────────────┐
  └─ SPRING_BOOT → authenticated Java ingress adapter│
                                                    ▼
                         authenticated Apps Script doPost (signed envelope)
                           │ shared ScriptLock + durable event ledger
                           ▼
                  configured Sheet + PRIVATE Drive media
                      │                 │
             trusted clinician          Google Forms submissions
               H → draft                signed invitation → correlation
               I → explicit push        normalized records + manual scores
                      │
            durable outbox + LINE X-Line-Retry-Key
```

Spring is a runnable alternate ingress/processing **adapter**, not a second
spreadsheet writer. It verifies the internal envelope and delegates the same raw
events to the canonical Apps Script storage processor. Text, image, audio, video,
and file messages are accepted; other message types are recorded as generic
messages. Non-message events do not trigger clinical actions. There is no automated
diagnosis, CDR scoring, reply, mirroring, or automatic backend failover.

## Canonical source and prerequisites

Upload **only** the `.gs` files and `appsscript.json` inside `PHCEP/apps-script/`
to the verified PHCEP Apps Script project. Do not upload the four `.gs.txt` reference
files, `PHCEP/appsscript.json`, tests, gateway, or Java source. Do not combine this
project with the unrelated top-level `apps-script/` project: its endpoints, triggers,
workflow, and auto-reply behavior are not the PHCEP contract.

Use Node 22+ for the gateway, Java 17+ and Maven 3.6.3+ for Spring.
The Spring module pins its release in `PHCEP/spring-boot/pom.xml`; dependency
upgrades require a fresh advisory check and tests. See its own README for the
verified release and build instructions in `PHCEP/spring-boot/README.adoc`.
The adapter uses the actively maintained Spring Boot 4.1 line (4.1.1), Java 17,
and the official Jackson 2 compatibility module; it is not pinned to the older
3.5 line merely because that release still exists in Maven Central.
The Maven BOM overrides patch both Jackson 2 and 3 after advisory checks flagged
the initially managed versions.

For optional clasp use, copy `PHCEP/apps-script/.clasp.json.example` to
`PHCEP/apps-script/.clasp.json`, replace the placeholder with your **script** ID,
and authenticate locally with your authorized Google OAuth account. From that
directory, `clasp push` uploads only the allowlisted source. Never commit
`.clasprc.json`, `.clasp.json`, OAuth tokens, or `.env` files. Manual editor upload
is supported without clasp. Enable the Apps Script API if using clasp.

## Configuration

Use Apps Script **Project Settings → Script properties** and service runtime
environment/secret manager. GitHub Actions secrets are **not** runtime properties,
cannot be read back by this implementation, and are not automatically transferred
to Google or the gateway. Do not put secret values in Sheets, the browser,
URLs/query strings, logs, fixtures, or version control.

| Name | Location | Purpose |
| --- | --- | --- |
| `SPREADSHEET_ID` | Script Properties | Existing authorized spreadsheet; if absent, setup uses the bound sheet or creates one and stores its ID |
| `LINE_CHANNEL_ACCESS_TOKEN` | Script Properties | LINE push/media/profile access; legacy `CHANNEL_ACCESS_TOKEN` alias supported |
| `LINE_CHANNEL_SECRET` | gateway env; Script Properties; Spring env | LINE signature key; Script/Spring require it to reject reuse as internal signing key |
| `GATEWAY_SIGNING_SECRET` | gateway env; Script Properties; Spring env | Shared internal HMAC key, at least 32 random characters, **distinct** from LINE channel secret |
| `TRUSTED_EDITOR_EMAILS` | Script Properties | Comma-separated explicitly approved clinician accounts; required by setup |
| `IMAGE_FOLDER_ID` | Script Properties | Private media folder; legacy `DRIVE_FOLDER_ID` alias supported; setup creates private folder if neither exists |
| `CDR_FORM_ID`, `VITALS_FORM_ID` | Script Properties | Reused form IDs; generated/stored by setup if absent |
| `CDR_FORM_URL`, `VITALS_FORM_URL` | Script Properties | Existing form URLs retained/migrated; CDR aliases `GOOGLE_FORM_URL` / `GOOGLE_FORM_BASE_URL` |
| `CDR_LINE_ITEM_ID`, `VITALS_LINE_ITEM_ID` | Script Properties | Actual form text item IDs discovered/stored by setup, not hardcoded entry numbers |
| `CDR_TOKEN_ITEM_ID`, `VITALS_TOKEN_ITEM_ID` | Script Properties | Actual invitation item IDs, used with `createResponse().withItemResponse().toPrefilledUrl()` |
| `CDR_RESPONSE_SHEET_ID`, `VITALS_RESPONSE_SHEET_ID` | Script Properties | Located by actual form association when available; not sheet name/order |
| `CDR_PROVISION_STAGE`, `VITALS_PROVISION_STAGE`, `CDR_PROVISION_STEP`, `VITALS_PROVISION_STEP` | Script Properties | Setup-managed progress for resuming newly created forms after interrupted provisioning |
| `CLINICIAN_SEND_ON_EDIT` | Script Properties | Default off; `true` explicitly enables trusted single-cell I edits to send |
| `AI_CURATED_QA_OPT_IN` | Script Properties | Default off; `true` permits manual curated QA embedding routine only |
| `PHCEP_SUGGESTION_LIMIT` | Script Properties | Optional; integer 1-10 dropdown suggestions per row (default 5) |
| `GEMINI_API_KEY` | Script Properties | Optional; missing key returns `MISSING_KEY`, no network call |
| `PHCEP_BACKEND_MODE` | gateway env | `APPS_SCRIPT` (default) or `SPRING_BOOT`; never Central/Peripheral |
| `PHCEP_APPS_SCRIPT_URL` | gateway and Spring env | Configured `https://script.google.com/macros/s/DEPLOYMENT_ID/exec` |
| `PHCEP_SPRING_BOOT_URL` | gateway env | Trusted operator-configured HTTPS host with `/internal/events` path |
| `PORT` | gateway env | Gateway listener, default 8080; terminate TLS in an authorized reverse proxy |

Generated form item/state properties are setup-managed; do not edit them to point
to arbitrary resources. Templates contain placeholders only. Restrict secret
manager access separately from ordinary spreadsheet editing.

## Authorized operator setup (Apps Script now)

1. Create a dedicated standalone or bound Apps Script project, upload the canonical
   source, and set the required properties. Use a dedicated account with only
   necessary Sheet/Form/Drive permissions. Rotate any credentials previously
   exposed elsewhere; no credential values are copied into this implementation.
   Run `validatePHCEPConfiguration()` in the authorized editor: output lists
   missing property names only, never secret values. Set required secret/editor
   properties before setup; absent spreadsheet/media IDs are provisioned by setup.
   Setup also returns `missingRuntimeProperties`; a missing LINE access token
   does not block provisioning but must be supplied before media/push operations.
2. Run `setupPHCEP()` in the Apps Script editor and grant the requested Sheets,
   Forms, Drive, outbound HTTP, and installable-trigger permissions. Setup is
   idempotent: it preserves existing data/configuration, reuses forms, expands
   columns safely, and refuses conflicting headers or form destinations.
   Do not bypass those errors or blindly rename columns containing history.
3. Inspect the returned resource IDs/URLs in the **authorized editor only**. Setup
   returns the actual spreadsheet, CDR/vitals and private media folder IDs/URLs;
   do not publish
   operator execution output. Confirm the full supplied Traditional Chinese CDR
   observer/direct assessment questions and vitals sections. Clinician scores
   belong only in `PHCEP臨床評分`, keyed by response ID; no scoring algorithm exists.
4. Setup installs one spreadsheet edit and two **Form-source** submit triggers
   for the setup account. Repeated setup removes duplicate managed handlers for
   that account, not unrelated triggers. Google hides other users' installed
   triggers: use one designated trigger owner and manually remove prior owners'
   duplicate triggers. No simple `onEdit` sends or performs authorized networking.
   Menus are **optional**: every required workflow runs from sheet cells through
   the installed edit trigger (see *No-menu workflow*), so a standalone project
   does not need a bound copy. Do not install a second sending project.
5. Review Google sharing explicitly: no public Sheets/media/vector files;
   only approved staff may read clinical records. Sheet protections constrain
   **editing, not viewing** and do not grant Sheet access. Share the spreadsheet
   with approved staff in Google UI, remove public/domain/link viewers, and
   review inherited folder/shared-drive access. Protection failures stop setup.
6. Review and publish both Forms in Google Forms UI. Configure responder access
   according to your approved population and Workspace policy; test with a real
   authorized respondent. `getPublishedUrl()`/prefill URL generation alone does
   not guarantee that the form is published, accepting responses, or accessible
   outside your domain. Preserve consent/access policy; do not silently open forms
   to everyone. Rerun setup to resolve any asynchronously-created response sheet
   association; submit handling uses form IDs, not a response-sheet guess.
7. Deploy the Apps Script web app executing as its authorized owner and reachable
   by the gateway. The manifest permits anonymous **transport**, but every
   processing request is authenticated in `doPost` before any spreadsheet access.
   There is no unsigned LINE entry point or public administration API.
   Update the versioned deployment after code changes; editor saves alone do not
   update `/exec`. Keep Google deployment IDs private where practical.
8. Deploy the Node gateway behind HTTPS. Supply its runtime environment, using
   `PHCEP/gateway/.env.example` as the name/placeholder template (Node does not
   automatically load it). Run `npm start` from `PHCEP/gateway`. Restrict outbound
   networking to configured Google destinations, and inbound request/rate limits
   at your proxy; redact request bodies/headers and downstream exceptions from
   proxy/platform/APM logs too.
9. In LINE Developers configure the channel's **single** webhook URL as
   `https://YOUR_GATEWAY/webhook`. Enable webhooks and redelivery. Use LINE's Verify
   button (signed `events: []` is supported). Disable unintended existing
   auto-replies elsewhere. Do not point LINE directly at Apps Script.

## Deployment configuration check

From `PHCEP/gateway`, run `npm run validate:config` (equivalent to
`node scripts/validate-config.cjs --check`) with the intended runtime environment.
With Node 22+, an optional local file can be loaded explicitly:
`node --env-file=.env scripts/validate-config.cjs --check`.
Never commit that file or paste its contents into logs/issues.

The check is read-only, prints PASS/FAIL per variable with no values, and exits
non-zero on failure; it is also suitable for CI with injected secret variables.
It requires a non-blank `LINE_CHANNEL_SECRET`, a distinct `GATEWAY_SIGNING_SECRET`
of at least 32 non-padding characters, an explicit `PHCEP_BACKEND_MODE`, and the
selected mode's canonical HTTPS endpoint. Runtime still defaults an omitted mode
to `APPS_SCRIPT`; this preflight deliberately requires an explicit deployment choice.
No dependencies or automatic `.env` loading are added.

This is a **local syntax/presence check**, not a connectivity or cross-service
secret comparison. It cannot verify Google permissions, deployment identity,
Script Properties, or that keys match across services. Run
`validatePHCEPConfiguration()` separately in the authorized Apps Script editor
and compare configuration privately through your secret manager.

## Troubleshooting: no Render errors and no sheet rows

1. **Check the deployed project and route.** Render Root Directory must be
   `PHCEP/gateway`, Start Command `npm start`, and LINE's webhook URL exactly
   `https://YOUR_GATEWAY/webhook` (no trailing slash or query). Use the deployed
   `/exec` URL from canonical **`PHCEP/apps-script/`**, not the unrelated
   top-level `apps-script/` project or its deployment workflow. Publish a new
   Apps Script deployment version after source changes.
2. **Separate verification from delivery.** LINE Developers → Verify sends
   `events: []`: a 200 verifies the route/authentication/backend acknowledgement,
   but should not create a message row. Then send a fresh nonclinical synthetic
   text message to the OA with webhooks enabled. Do not use patient data for testing.
3. **Inspect Render application logs at that time.** `gateway_response` records
   only status and a fixed reason: 404 `method_path_mismatch`, 415
   `content_encoding_rejected`, 413 `payload_too_large`/`payload_read_error`,
   401 `signature_failed`, 400 `invalid_json`/`invalid_events`, 502
   `backend_unavailable`, or 200 `accepted`. A normal GET `/healthz` is quiet.
   No webhook outcome logs suggests checking LINE delivery settings, Render
   service/deployed revision, and proxy routing first; a healthy probe alone
   does not test backend delivery.
4. **For 502, inspect the backend class.** `backend_network_error`,
   `backend_timeout`, `backend_redirect_rejected`, and
   `backend_response_read_error` distinguish transport/response failures.
   Existing `backend_http_error`, `backend_invalid_response`, and
   `backend_rejected` include only status and, where available, a safe-shaped error
   code. Two attempts can produce two backend logs before the final 502; no
   automatic backend switching occurs. In Spring mode check the adapter as well.
5. **Check Apps Script → Executions at the test time.** An execution marked
   completed does not prove acceptance: caught failures return
   `{ "ok": false, "error": "CODE" }` with HTTP 200, which the gateway rejects.
   Inspect safe codes in gateway logs/authorized diagnostic responses:
   `CONFIGURATION` (properties/access), `AUTHENTICATION` (shared key),
   `EXPIRED` (clock/window), `INVALID_ENVELOPE`/`INVALID_PAYLOAD` (wrong contract),
   `REPLAY`, `BUSY`, `MEDIA_FAILED`, or `ACCEPTANCE_FAILED`.
   Never log full responses or signed envelopes to investigate.
6. **Confirm the storage target privately.** Check Script Property
   `SPREADSHEET_ID` and the deployment owner's access to that exact spreadsheet.
   A real accepted text message belongs in `LINE對話`; `PHCEP事件` tracks durable
   event processing and `PHCEP請求` tracks transport replay protection.
   Forms use `PHCEP表單紀錄` (invalid associations go to `PHCEP隔離`); outbound
   sends use `PHCEP寄件匣`. Empty Verify/non-message events do not imply a missing
   conversational row. Reuse existing Sheet/Form/Drive IDs and records.

Gateway outcome diagnostics intentionally exclude request bodies, paths, methods,
headers, signatures, tokens, user IDs, message text, exception messages, and full
backend payloads. Keep proxy/platform/APM logs equally restrictive. Share only
safe status/reason/error codes, never clinical rows, credentials, or raw requests.

### Coordinated deployment and secret rotation

1. Schedule a maintenance window and pause webhook traffic (disable LINE webhooks
   and drain in-flight requests/retries). Plan for pending delivery/recovery;
   do not assume all messages during the pause will be redelivered.
2. In authorized secret stores update the shared `GATEWAY_SIGNING_SECRET` on
   gateway, canonical Apps Script Script Properties, and Spring if used. Keep it
   distinct from the channel's `LINE_CHANNEL_SECRET`; update that value everywhere
   required if rotating the LINE key too. Preserve Sheet/Form/Drive resource IDs;
   never store credentials in those resources.
3. Run the local preflight and Apps Script configuration check. Restart/redeploy
   services so they load the new environment; update the Apps Script versioned
   deployment when changing code, and synchronize its `/exec` URL where needed.
4. While normal traffic remains paused, use LINE Verify and a controlled,
   authenticated synthetic message test (briefly enable delivery under the
   maintenance window if necessary). Confirm 200 `accepted` and the expected
   `LINE對話` row before resuming normal traffic. If unsuccessful, keep traffic
   paused and restore a matching configuration on every affected service.

These updates are coordinated, **not globally atomic**. Updating only one side
temporarily breaks authentication; a local validator cannot make rotation atomic
or prove that remote secrets match. Render credentials alone do not authorize
Google Script Properties or Sheet/Form changes.

## Clinician workflow

`LINE對話` columns A:J retain the uploaded layout:
Message ID; 發送問卷 (勾選); User ID; DateTime; User Name;
訊息 (病患問題); 檔案/媒體連結; 建議回覆選單; 回覆草稿 (可編輯);
回覆紀錄 (最新). K stores Event Key and L stores durable operation status.
Existing extra history must be moved by an authorized operator if it conflicts
with these explicitly checked reserved columns. No clinician history is shifted
into event/storage columns. Subsequent sent replies are retained idempotently in
the separate protected `PHCEP回覆歷史` sheet; J continues to show the latest reply.
The previous latest reply is right-shifted only inside the dedicated history area
`回覆紀錄 (前1…前5)` at the end of the operator block; K/L and the operator
controls never move. Older entries drop off that visible area but stay in
`PHCEP回覆歷史`.

New incoming messages are inserted at row 2, immediately below the frozen header.
Existing rows move down intact, including drafts, private media links, operation
state, controls and reply history. Each new row receives its own checkbox and
dropdown validation rules; duplicate webhook retries do not insert another row.
Existing messages are not sorted or otherwise reordered by deployment.

H selects a curated QA reply and populates I; it does not send.
Use the explicit clinician draft-send menu to confirm sending, or enable the
clearly labelled I send-on-edit menu after confirmation. Only approved identified
single-cell edits can send; multi-cell paste does not. Google may omit editor
identity from trigger events: those sends are refused; use the authorized menu.
B requests CDR; batch menu supports checked rows. Vitals and subsequent daily
invitations use the dedicated **send selected vitals** and **new CDR/vitals
invitation** menus, not an automatic timer. A retry uses the stored invitation;
a confirmed new invitation deliberately creates a new operation. L and the outbox
show pending/sent/retry states. Resolve failed pending payloads before changing
recipient/content. Patient media remains private; LINE cannot render private
Drive downloads, and the integration does not publish files to make them render.
Clinician drafts are text; formula strings are not executed as outbound content.

### No-menu workflow (edit-trigger cells)

Run `migratePHCEPLayout()` once after updating the code to repair the layout,
hide obsolete action/source columns, refresh existing collected conversations,
and repair validations and the spreadsheet edit trigger without creating Forms or changing
form-submit triggers. Run it as the designated trigger owner: Google only exposes
that account's triggers, so old triggers owned by other accounts must be removed
by those owners. `setupPHCEP()` also provisions Forms and their submit triggers
and is not needed just to repair these controls.
Tab order becomes **`總覽`, `LINE對話`, `QA知識庫`**, then the rest.

**`總覽`** (first tab) links to `LINE對話`, `QA知識庫`, `收錄集合` and every
`PHCEP*` ledger, shows row counts and safe counters only (outbox pending/failed,
outbox manual review, quarantine, collection pending/approved, unfinished events)
plus the last refresh time. Tick **C1 重新整理** to refresh (or run
`refreshPHCEPOverview()`); setup also refreshes it. No message text, recipients,
answers or secrets are copied there.

**Grouped operator block in `LINE對話`** is first created directly after L, in
columns M:S, followed by the history area T:X. Generic setup/layout migration
retains a complete existing block at a later offset; it does not relocate it.
The guarded manual deployment below instead rejects blocks outside M.
The column references below describe the M-start layout. When first created,
the system columns K (Event Key) and L (操作狀態) are hidden. Editors then see
B (questionnaire checkbox), H (suggestion), I (draft), J (latest reply) and the
controls side by side. M (legacy action) and O (legacy source) are now hidden on
each migration, not deleted; existing values, column positions and history are
preserved. Neither hidden field controls sending or collection. K/L are not moved or changed; unhide them at any time
(click the arrows between J and M) when you need to diagnose a failure.

| Column | Editable by editors? |
| --- | --- |
| A, C–G | No (message data) |
| B, H, I | Yes |
| J | No (latest sent reply) |
| K, L | No (system; hidden) |
| M–R | Yes (operator controls) |
| S | No (操作結果 status) |
| T–X | No (reply history 前1…前5) |

| Header | Use |
| --- | --- |
| 操作動作 | Hidden, obsolete; existing values are preserved and never executed or automatically cleared |
| 確認執行 (勾選) | Sends column I's draft immediately; no action selection needed |
| 收錄來源 | Hidden, obsolete; collection always captures all conversation content |
| 重要性 (1-5，選填) | Optional; blank = none. Only integers 1-5; anything else is cleared with a status |
| 收錄 (勾選) | Collect this row into `收錄集合` immediately (non-sending) |
| 媒體檔名 (修改即改名) | Type a new name to rename the private Drive media file linked in G |
| 操作結果 | Status/result written by the script; never authoritative state (L is) |

Tick 確認執行 to send the draft, or tick 收錄 to collect without sending.
For a batch, select multiple cells in **one checkbox column** and fill/paste
`TRUE`: each selected row executes immediately. There is no second confirmation
or queue. Rectangular pastes spanning other columns never send or collect and
reset the pasted checkboxes with an explanatory status. Single-cell and batch
operations require a verified trusted editor (`e.user` in
`TRUSTED_EDITOR_EMAILS` or owner). Each checkbox resets after its attempt.
The edit handler waits up to 20 seconds for a busy script lock; if it cannot
acquire the lock, it resets the boxes and explicitly asks the operator to retry.
If a batch approaches four minutes, remaining rows are left unsent/uncollected,
their boxes reset, and their status asks for a smaller batch; completed rows
are not rolled back. Inspect every selected row's status.
Sending retains durable retry keys, deduplication and `MANUAL_REVIEW`.
Questionnaire and suggestion-refresh operations remain available through their
existing explicit menu/editor entrypoints, not the obsolete action dropdown.

Collection works with no reply. Column C contains the question and a clickable
media URL from LINE對話 G, including image/video rows. Column D captures the
latest reply, unsent draft, visible history and full archived reply history,
deduplicating identical text and labelling multiple parts. One collection entry
is maintained per source message (Event Key/Message ID), not per question/reply
text. Draft edits, importance changes and successful sends refresh an already
collected entry automatically. A changed snapshot resets its status to 待審核
and retains its QA ID; the published QA is untouched until explicit reapproval,
which updates that same QA row rather than appending a duplicate. Check the
`migratePHCEPLayout()` result's `collections.failed` count after upgrading;
legacy entries are matched by their stored source identity and are not deleted.
Older duplicate entries are retained for manual review.

**Troubleshooting a failed draft send.** `SEND_FAILED` in older outbox rows
does not identify the cause. New attempts record a safe code in `PHCEP寄件匣`
and show it in 操作結果: `LINE_TOKEN_MISSING`, `LINE_HTTP_401` (invalid/expired
token), `LINE_HTTP_403` (access denied), `LINE_HTTP_400` (invalid request),
`LINE_MONTHLY_QUOTA_EXCEEDED`, `LINE_HTTP_429` (rate/quota limit), or
`LINE_FETCH_FAILED` (Apps Script could not complete the HTTP request).
No raw LINE response, access token or patient text is included in these errors.
Run `diagnosePHCEPLineSend` in the Apps Script editor as an authorized clinician
to check token authentication and monthly quota without sending a message.
Its execution log contains only safe HTTP codes and quota counts. The token must
be in Apps Script Script Properties as `LINE_CHANNEL_ACCESS_TOKEN` (or legacy
`CHANNEL_ACCESS_TOKEN`); GitHub Actions secrets alone are not runtime properties.
After fixing the reported cause, tick 確認執行 again on the same
unchanged draft. Do not clear L, delete the outbox row, or generate a new retry
key: pending sends retain their original key; expired ambiguous sends require
manual reconciliation instead of a blind resend.

**Local suggestion matcher (no network).** Text messages get an H dropdown during
ingestion using only `QA知識庫` C/D/E questions and G replies: NFKC + lowercase,
punctuation/space removal, leading 請問/您好 and trailing 謝謝 removal, exact
match, guarded containment (≥2 characters and ≥25% of the longer text), bigram
Dice similarity and bounded edit distance (≤64 characters). Relevance must reach
0.45 first; only then may importance (+0.01 × level, max +0.05) and global usage
count O (log-scaled, max +0.03) reorder candidates. Low relevance is never rescued;
no confident match means no dropdown. Up to `PHCEP_SUGGESTION_LIMIT` (default 5)
unique replies are offered. Matching is bounded (≤2000 QA rows, ≤500 characters)
and any matcher failure is ignored so ingestion still completes. Suggestions never
send: H only fills I. Selecting H increments the QA usage counts N/O.

**Importance** is optional metadata (blank = none, 5 = highest ranking hint). It
is **not** clinical urgency/triage and never escalates or alerts. Sheet validation
(`LINE對話` 重要性, `收錄集合` G, `QA知識庫` B) and script checks accept only
1, 2, 3, 4, 5; 0, 6, negatives, decimals and text are rejected/cleared with a
status. Existing invalid QA B values are ignored by ranking, not deleted.

**Collections (`收錄集合`).** Collecting copies the conversation snapshot with
provenance (Event Key, Message ID, `LINE對話!row`,
timestamp, collector email). The LINE user ID is never copied. Drafts are marked
`未發送 (草稿)` when no latest sent reply exists. Entries are identified by their
source message, and later content updates reuse the existing entry. New or changed
rows start as `待審核` and are **not** used for suggestions.
A trusted editor reviews/deidentifies the wording, then sets B to `核准`; the edit
trigger publishes or updates it in `QA知識庫` (ID `COL-…`, importance in B) and marks
it `已發布`. Missing question/reply or invalid importance returns it to `待審核`
with a note. `publishApprovedCollections()` publishes any remaining `核准` rows.
Approval is an operator attestation of deidentification, not automatic scrubbing.

**Media preview and rename.** G keeps a rich-text link to the private Drive file
(set `IMAGE_FOLDER_ID` to your private LINE media folder; it must stay private).
Typing a name in LINE對話 媒體檔名 or QA知識庫 F (`Line Friend 連結備註`, linked
to the file in H) renames the file only if it is inside that configured
folder and still private, strips path/control characters (max 120), then updates
all matching LINE G / QA H link labels, LINE filename controls, QA F and QA I.
QA F displays a cell note and a toast with success/refusal details. QA D/E
(`LINE Friend 訊息 1/2`) are alternate question phrasings for matching C; they
do not send LINE messages. F is not a matcher question or reply.
Images, videos, audio and uploaded files received through LINE are stored in the
private media folder; ordinary web URLs remain links and are not downloaded.
Other files, shared files and non-Drive links are refused. No
sharing changes are made and no public links are created.

### Migration notes

- `setupPHCEP()` / `migratePHCEPLayout()` are idempotent: they add missing sheets
  (`收錄集合`, `總覽`) and headers. On first creation, they insert the operator
  block right after L (legacy content beyond L is shifted right by inserting
  empty columns, not overwritten) and hide K/L once. A complete existing block
  at a later offset is retained, not relocated, and repeat migration does not
  re-hide K/L. They also reorder tabs and apply validations. A:L and existing
  rows/operation state are not moved. Obsolete M/O controls are hidden on every
  migration. `migratePHCEPLayout()` additionally refreshes already-collected
  source rows and reports any synchronization failures; no messages are sent.
- Generic setup/migration rejects conflicting or incomplete block headers,
  unlabelled data where headers would go, and an unmanaged existing `總覽`,
  but may already have changed other sheets, protections or columns before
  throwing. The guarded manual entrypoint below preflights expected conflicts
  before migration writes and rejects existing blocks outside M; it still
  provides no atomicity, automatic rollback or guarantee against partial writes.
- Until migration runs, the new code still works with the old layout: history
  shifting and control cells are simply inactive.
- Upload the new `Matcher.gs` and `Workflow.gs` with the other `.gs` files and
  publish a new web-app version.

### Operator verification checklist

1. Run `migratePHCEPLayout()`; confirm M/O are hidden, `collections.failed` is 0,
   and that `總覽` links open each sheet.
2. Add a synthetic QA row, send a synthetic text: H offers the reply; Executions
   show no extra network call besides the LINE profile lookup.
3. Select H → I fills; tick 確認執行 → 操作結果 shows ✅,
   J updates, the previous reply moves to 前1, K/L unchanged.
4. Enter `7` in 重要性 → cleared with status; enter `3` → accepted.
5. Tick 收錄 → `收錄集合` row `待審核`; tick again → `已存在`; set `核准` → QA row.
6. Send a synthetic image, collect it without replying → C contains its clickable
   media URL. Send a later draft → the same collection entry is updated.
7. Type a new 媒體檔名 or linked QA F filename → Drive name and matching labels
   update; file sharing remains private.
8. Fill TRUE down N for draft sends or Q for collections, one checkbox column
   per edit. Verify every selected row's 操作結果; rectangular pastes never send.

`QA知識庫` preserves the uploaded 15 columns, with empty QA handled safely.
Maintain only curated/deidentified education content there. Do not copy patient
messages or LINE IDs into it. `buildCuratedQAEmbeddings()` is optional, manual,
and requires both explicit `AI_CURATED_QA_OPT_IN=true` and column J's exact approval
marker `APPROVED_DEIDENTIFIED_QA` on each row. It embeds question C into K, not
reply vectors against patient questions, and sends the API key in a header.
Vectors stay private in the Sheet. The marker is an operator attestation, **not**
automatic deidentification. No patient-derived AI workflow is enabled.

## Invitations, submissions, and schema

Each invite contains a random opaque nonce, expiry and HMAC in the actual Forms
invitation field; it contains **no LINE ID**. `LINE ID 編號` is editable/optional
and ignored for identity association. Invites expire after 24 hours, are bound
server-side to one form type and LINE recipient, and can link only one response
ID. Token edits, timestamp edits, expiry, cross-form use and replay are quarantined.
Possession of a link associates the response with an invitation, **not a verified
respondent**. Links are editable bearer credentials and may be copied/shared;
first valid submission can consume an invitation. Forms cannot cryptographically
lock prefilled fields. Use external verified identity/consent procedures when
required; this code does not claim to authenticate a patient or prevent forwarding.

| Sheet | Contract |
| --- | --- |
| `PHCEP事件` | Durable Event Key, phase, message ID, update time |
| `PHCEP請求` | Internal transport nonce SHA-256 digest, expiry; no signing secrets |
| `PHCEP寄件匣` | Durable send key, UUID LINE retry key, status, recipient, messages JSON, timestamps, safe error code |
| `PHCEP邀請` | Nonce, mapped LINE recipient, source/form type, form ID, expiry, consuming response ID |
| `PHCEP表單紀錄` | Response ID, correlation nonce, source type (`CDR`/`VITALS`), submission timestamp, mapped LINE ID, structured answers JSON |
| `PHCEP隔離` | Invalid response ID/form ID/time and safe reason, no duplicated answers |
| `PHCEP臨床評分` | Protected manual clinician fields keyed by response ID, separate from raw Form response columns |
| `PHCEP回覆歷史` | Protected operation ID, event key, send-record timestamp and clinician draft history |
| `收錄集合` | Collection key, review status, question, reply, source, sent flag, optional importance, Event Key, Message ID, row reference, time, collector, review note, published QA ID |
| `總覽` | PHCEP-managed index: sheet links, safe counters, last refresh time |

Google Forms still stores invalid submissions in its raw responses; quarantine
excludes them from normalized clinical association, not from Google's storage.
Response records contain item ID/title/answer without invitation bearer token or
the editable LINE-ID answer. Raw response destination columns are never used for
manual scores. If an existing Form permits response editing, changed answers for
the same response ID require clinician review rather than silently replacing
scores or presenting stale answers as newly linked. Inspect quarantine before
clinical use; unchanged retry submissions remain idempotent.
Failed/busy submit triggers need authorized reconciliation; use
`reconcilePHCEPFormResponse('CDR', responseId)` or
`reconcilePHCEPFormResponse('VITALS', responseId)` from the authorized editor.
Supply the actual response ID obtained in the restricted Google Forms workflow;
do not publish it. Reconciliation uses the stored Form response and its actual
submission timestamp, not copied answers or the time a failed trigger was rerun.
Review trigger failures in Google UI without exporting patient answers.

## Endpoints and signed contract

Gateway: `POST /webhook`, `GET /healthz` (liveness only, not deployment readiness).
Spring: `POST /internal/events`, authenticated signed envelope.
Apps Script: `POST /exec`, same signed envelope; no public admin/outbound endpoint.

```json
{
  "version": 1,
  "action": "events",
  "timestamp": 1700000000000,
  "nonce": "00000000-0000-4000-8000-000000000000",
  "rawBody": "BASE64_OF_EXACT_ORIGINAL_LINE_JSON_UTF8_BYTES",
  "signature": "BASE64_HMAC_SHA256"
}
```

The example is nonfunctional synthetic data. Canonical UTF-8 signing string is
`1\n` + action + `\n` + decimal integer timestamp + `\n` + nonce + `\n` +
rawBody, **no final newline**. Signature is standard padded Base64 of HMAC-SHA256
with `GATEWAY_SIGNING_SECRET`. Raw body is standard padded Base64. Timestamp is
epoch milliseconds within ±5 minutes; clocks must be synchronized. Nonce is a
UUID and durably rejected if reused. JSON formatting/order is not signed;
canonical field values and exact embedded payload bytes are. LINE signature is
verified **before** parsing at the gateway, using a constant-time digest comparison.
Apps Script does not pretend that undocumented `e.headers` exists.

Responses: `{ "ok": true }` means durable accepted processing; Apps Script errors
are HTTP-200 `{ "ok": false, "error": "SAFE_CODE" }`. Gateway/Spring check that JSON
contract, not HTTP status alone; failures become non-2xx. The gateway forwards an
event bundle only once per successful attempt to one configured backend.
Each gateway retry uses a fresh transport nonce but preserves original event and
message IDs. Spring forwards the original authenticated envelope without changing
its nonce, so replay is checked by the same durable Apps Script nonce ledger.
Google ContentService result redirects are allowlisted and fetched
with GET, never re-posting the signed body to another host. Operator-configured
Spring URL is a trusted secret-manager setting, not a request-supplied destination.
HTTPS is mandatory for backend URLs; credentials/query strings in configuration
URLs and arbitrary redirects are rejected.

## Retry, switch, and rollback

Ingress retries/failover use the **same script project and spreadsheet**. Shared
ScriptLock fails immediately if unavailable; only an acquired lock is released.
Completion is marked after durable row acceptance; unfinished journal entries
resume by event key/message ID, deterministic private media name and row lookup.
Do not delete event/outbox keys while LINE may still redeliver. Network/Sheets/Drive
are not one transaction: this is practical durable deduplication, **not a promise
of exactly-once side effects**. Google quotas, execution timeout, manual row edits,
event-key retention and Drive consistency remain operational limits.

An authorized script operator may run `phcepCleanupExpiredNonces()` to prune only
expired transport nonce hashes with a 60-second boundary grace. It does not delete
event/outbox deduplication records or clinical records. Do not expose this editor
routine as a web endpoint.

Outbound sends persist payload and UUID `X-Line-Retry-Key` before the HTTP call.
Ambiguous retries reuse the same key; LINE's retry-key guarantee is time-bounded
(24 hours). This implementation conservatively stops ambiguous retries at
23 hours from the original persisted creation time (`AMBIGUOUS_EXPIRED`);
records missing that timestamp also stop. Old ambiguous operations must be reconciled manually, not reset and
resent blindly. A new deliberate message is a new operation, not a retry.
No automatic failover occurs after partial completion.

ScriptLock does not lock human spreadsheet edits. Do not sort, delete, move rows,
or change recipients while operations are pending. Use filters/views without
reordering storage, and reconcile pending operations before administrative edits.
Durable keys/status columns and ledger sheets are integration-owned; manual changes
can invalidate retry guarantees.

For Spring:

1. Build/test and deploy `PHCEP/spring-boot` with its documented environment.
   Keep `/internal/events` private behind gateway/service networking in addition
   to HMAC authentication. Use the **same** signing key, Apps Script URL and storage.
2. Verify signed synthetic requests reach the same event ledger; do not enable
   another LINE webhook, independent writer, or direct Java outbound sending.
3. Drain gateway in-flight requests/restart gracefully, set
   `PHCEP_BACKEND_MODE=SPRING_BOOT` and its trusted URL, restart gateway.
   The LINE webhook URL stays unchanged. If an in-flight old-mode request and a
   redelivery overlap, the shared lock/ledger resolves duplicates.
4. Rollback by draining/restarting gateway with `APPS_SCRIPT`; keep the same IDs,
   ledger/outbox and secrets. Do not switch after an error as automatic failover.

Gateway performs two attempts with 250 ms backoff and bounded request timeouts.
Spring performs one bounded Google forwarding attempt; retry is owned by the
gateway to retain the original envelope/replay contract. Large workloads need monitoring
of quotas/latency and a durable queue designed around the same event contract;
this minimal deployment deliberately does not claim production-scale throughput.

## Validation and required live smoke test

Synthetic local tests:

```sh
node --test PHCEP/tests/*.test.cjs
cd PHCEP/gateway && npm test
cd ../spring-boot && mvn test && mvn package
```

Use absolute checkout paths when executing these commands in automation.
Mock tests exercise setup reuse, schemas/protections, invitation tampering,
trigger dispatch, lock failure, durable retries, signature errors, formula
injection, private media, and optional AI. Java uses mocked configured storage
transport; it does not create live Google resources.

Implementation verification: gateway tests and local unsigned-request smoke test
passed; Apps Script mock tests passed in the implementation agents; Java Maven
verification and executable-JAR startup smoke test passed. The final combined
automated review/CodeQL tool timed out and tripped its retry circuit breaker;
that final combined validation is **not** claimed complete. Individual Java
CodeQL runs reported no alerts. Live Google/LINE authorization, publishing,
sharing and quota behavior remain untested here.

**Operator must manually verify after authorized deployment (not performed here):**

- [ ] LINE Verify sends empty signed events successfully; unsigned/tampered ingress fails.
- [ ] Synthetic LINE text and test media appear once in the configured sheet; media remains private.
- [ ] Trusted H choice fills I; explicit clinician push succeeds; deliberate retry does not duplicate push.
- [ ] B/batch sends CDR and explicit vitals invitation uses actual item IDs; both forms are accessible.
- [ ] Synthetic responses link by invitation/response ID; tampered, expired, cross-form/replayed links quarantine.
- [ ] Manual clinician scores do not overwrite Form response columns; nonapproved staff cannot edit them.
- [ ] Switch backend with unchanged LINE URL; duplicate/redelivered event appears once.
- [ ] Simulated Google/LINE failure returns non-2xx at gateway and retry resumes existing durable operation.
- [ ] Run submit reconciliation after a simulated trigger failure; check retained raw/normalized records.
- [ ] Review sharing, platform logs, retention/deletion policy and alerts before using clinical data.

Do not use this as emergency monitoring. Obtain institutional authorization,
consent and clinical review; no regulatory compliance or clinical validation is
claimed. Minimize access and retention. Authorized administrators must coordinate
deletion across Forms (`deleteResponse`/`deleteAllResponses`), raw response Sheets,
normalized/clinician/quarantine/invitation records, private Drive files and backups.
Deleting Form responses does not automatically remove Sheet rows. Preserve
nonclinical event/outbox dedup keys through the redelivery/retry horizon, then apply
an approved retention policy; deleting them early allows duplicates.

## Primary provider documentation

- [LINE receiving messages/signature and duplicate detection](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)
- [LINE signature verification](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)
- [LINE push / X-Line-Retry-Key](https://developers.line.biz/en/reference/messaging-api/#send-push-message)
- [LINE retry-key limitations](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)
- [Apps Script web-app event object (no request headers)](https://developers.google.com/apps-script/guides/web)
- [Installable triggers and account limitations](https://developers.google.com/apps-script/guides/triggers/installable)
- [FormResponse / toPrefilledUrl](https://developers.google.com/apps-script/reference/forms/form-response)
- [Form publishing and responder permissions](https://developers.google.com/apps-script/reference/forms/form)
- [Sheet getFormUrl](https://developers.google.com/apps-script/reference/spreadsheet/sheet#getFormUrl())
- [Sheet protection](https://developers.google.com/apps-script/reference/spreadsheet/protection)
- [Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings)
- [Spring Boot system requirements](https://docs.spring.io/spring-boot/system-requirements.html)

## Manual PHCEP layout deployment

### Code-only deployment to the existing web app

The operator has confirmed that the existing `CLASP_SCRIPT_ID` and
`CLASP_DEPLOYMENT_ID` secrets identify the PHCEP project and its production web
app. Use the manual **PHCEP code-only deployment** workflow
(`.github/workflows/phcep-code-deploy.yml`), on `main`, with confirmation
`DEPLOY`, to upload code and update that existing deployment without changing
its URL. It reuses the existing `CLASPRC_JSON` user OAuth secret; neither a
service account nor an API-executable deployment is required for this path.
The script ID must match the independently inspected PHCEP project
`1CpdImaCVfjNxJvBnD4xrxf5j2zAKI0mzQS-ZXeQ0H2w3aNMBaDLgCeVD`.

This workflow backs up the current editor source as an immutable Apps Script
version before uploading, preserves the exact reviewed remote `test.js`
diagnostic helpers, verifies uploaded and immutable-version source, and confirms
the existing deployment points to the new version. A smoke test sends only an
unsigned empty JSON object and requires `INVALID_ENVELOPE`, before any event
processing or spreadsheet write; it also surfaces missing runtime configuration.
Unrecognized extra files,
changed diagnostic helpers, a different web-app configuration, or a deployment
that does not belong to the project block the operation. It never calls setup,
migration, diagnostics, synthetic events, or any Apps Script Execution API function;
it does not change Script Properties, Forms, triggers, LINE, or Render settings.
Existing triggers use saved source, so an upload can affect them before the web
app is redeployed. There is no automatic rollback; the summary records the
previous deployed version and the editor-source backup version for recovery.

Do not run **Deploy Apps Script** against this same project: that separate
workflow uploads the incompatible top-level `apps-script/` backend. Do not merge
those source trees. The layout workflow below is separate and retains its stricter
user-OAuth/API-executable requirements. Its canonical file-set check will reject
the preserved remote-only `test.js`; resolve that deliberately before attempting
layout migration rather than bypassing the check.

### Layout migration workflow

`.github/workflows/phcep-manual-layout.yml` runs
`scripts/phcep_manual_deploy.py` only through **workflow_dispatch**. It has no
push, pull-request, schedule or other automatic deployment trigger. This PR
does not dispatch a live workflow or modify Google/LINE resources. Merge the
reviewed change into `main` before attempting the manual workflow.

### Prerequisites and target verification

An authorized owner must independently verify the Apps Script project and its
association with the intended spreadsheet. The existing `PHCEP/apps-script/.clasp.json`
script ID is **unverified**; do not adopt it without verification. Root-project
CLASP secrets/configuration do not establish the PHCEP target.

Configure these repository **variables**:

| Variable | Required value |
| --- | --- |
| `PHCEP_SCRIPT_ID` | The independently verified PHCEP Apps Script project ID. |
| `PHCEP_EXPECTED_SCRIPT_ID` | The same script ID, independently verified as a second target pin. |
| `PHCEP_SPREADSHEET_ID` | Exactly `12ksl5GvgM_YVc1NjrPE9LRe_YvUgqttLl0R41z5dazo`. |
| `PHCEP_OAUTH_CLIENT_ID` | The verified custom user-OAuth client ID used by the credential. |
| `PHCEP_PREFLIGHT_SOURCE_SHA256` | Optional only when the entire remote project matches the reviewed local project; otherwise required as the canonical SHA256 of an independently reviewed previous remote source revision. Never permits a differing safety entrypoint, file set or manifest. |

Configure the repository **secret** `PHCEP_CLASPRC_JSON` with a refreshable
**script-owner user OAuth** credential. Never paste credentials into source,
issues, workflow inputs, logs or reports. Service accounts are unsupported.
The script's existing ScriptProperties `SPREADSHEET_ID` must already match the
exact spreadsheet above: the entrypoint checks it and **never overwrites it**.
This workflow does not provision credentials or repair runtime configuration.
No Gemini key is needed for this layout-only operation.

Use a custom **Desktop OAuth client** in a standard Google Cloud project
compatible with, and associated with the **same Cloud project as the script**;
do not assume clasp's default client or an unrelated client can execute it.
Enable the Apps Script API in the Cloud project and the Apps Script API
user-access toggle in the owner's Apps Script settings, plus the Google APIs
needed by the manifest's services. Authorize the owner with **every scope in
`PHCEP/apps-script/appsscript.json` plus
`https://www.googleapis.com/auth/script.projects`**. A refreshed token must have
the expected client audience and all those scopes; an old partial grant is not
sufficient. Follow the official OAuth/API-executable prerequisites rather than
substituting a web-app deployment:

- [Executing functions with the Apps Script API](https://developers.google.com/apps-script/api/how-tos/execute)
- [google/clasp: running Apps Script functions](https://github.com/google/clasp/blob/master/docs/run.md)

### One-time manual safety bootstrap

This is an explicit, separately authorized **manual prerequisite**, not something
the workflow silently performs:

1. Back up and inspect the verified project's current source, manifest and
   configuration securely. Manually install the exact reviewed PHCEP source
   **and manifest**, including `ManualMigration.gs` and its dependencies,
   **without running setup or migration**. Source installation is not permission to invoke `setupPHCEP()`
   or change existing Forms, triggers, folders, webhooks or ScriptProperties.
2. Separately establish a pre-existing **API executable**, restricted to the
   owner (`executionApi.access: MYSELF`); a web app is not an API executable.
   Preserve existing web-app configuration. The runner invokes the owner with
   `devMode: true`, so it executes the latest saved source, not an old deployment
   version. Keep concurrent editor/source changes out of the deployment window.
3. Align the reviewed local and remote manifests before dispatch. The runner
   requires **exact parsed manifest equality before any remote execution, in
   both dry-run and apply modes**. The reviewed local
   manifest includes `executionApi.access: MYSELF` and leaves `webapp` unchanged,
   so installing that exact manifest supports the owner-only API prerequisite.
   Adding an API setting only remotely, or any other manifest drift, would block
   apply. Do not remove or bypass the equality check.

A dry run **never uploads source**, including when the preview entrypoint is
missing or differs. It fails closed with
`PREVIEW_UNAVAILABLE_BOOTSTRAP_REQUIRED` until the reviewed safety entrypoint
has been installed manually. Do not use apply as a bootstrap shortcut.

Before any `scripts.run` call in either mode, the runner verifies the entire
remote file set, parsed manifest equality, and exact `ManualMigration` source.
It also checks the canonical SHA256 of the **whole project**, because other
`.gs` files share globals and could override the preview's code. The remote
project must match the local reviewed project, or match the independently
reviewed previous revision pinned by `PHCEP_PREFLIGHT_SOURCE_SHA256`. That
optional pin permits only reviewed non-wrapper source differences; it does
not relax the safety-entrypoint, file-set or manifest checks.

To obtain a previous revision's pin, use a trusted checkout of that reviewed
revision, with the canonical-digest helper available, and run from its trusted
repository root:

```sh
python3 -c 'from scripts.phcep_manual_deploy import content_digest, local_content; print(content_digest(local_content()))'
```

Independently confirm that revision is the intended previously installed
project before setting the variable. **Never copy a hash of unknown live code
and thereby bless unreviewed source.** If a trusted previous canonical hash
is unavailable, manually review and bootstrap the exact latest source and
manifest instead. Missing or incorrect pins for differing non-wrapper source
fail closed with `SOURCE_INTEGRITY_PIN_REQUIRED`.

### Run dry first, then explicitly apply

1. Merge first. In GitHub **Actions → PHCEP manual layout deployment**, choose
   **Run workflow**, branch **main**, enter the exact confirmation **APPLY**,
   and leave **dry_run** checked (the default). Confirmation is required even
   for dry run; non-`main` dispatches are rejected before checkout/secrets.
2. Review the sanitized job summary/report and resolve every blocker. A
   successful dry run performs read-only target, credential and layout
   preflight, including whole-project source integrity, file-set and manifest
   checks before execution; it does not upload code or migrate sheets.
   Dry-run success does not guarantee a later apply if remote state changes.
3. Before apply, take an owner-verified backup in a secure,
   **clinical-approved location**, outside Actions logs/artifacts. Preserve
   sheet data, layout and protections, Forms and responses, resource IDs and
   runtime configuration. Coordinate with other operators and pause human
   spreadsheet edits; ScriptLock does not lock human editing.
4. Dispatch the same workflow again on **main**, enter **APPLY**, and explicitly
   uncheck **dry_run**. Check the commit being applied and review the resulting
   before/after report, including known partial changes and unknown outcomes.

The workflow runs local safety tests before accessing Google and serializes
this target without cancelling an in-flight run. It uses the Apps Script REST
API, **not the clasp CLI**. It reuses the existing credential-normalization
helper in memory; it does not write a credential file or log secrets. Both
modes use a fixed source-file allowlist and reject unknown/missing remote files,
manifest drift and unpinned source drift before any remote execution. Apply
then replaces whole-project source while preserving the checked manifest and
existing web-app settings. It does not call version/deployment creation or
update APIs, or update webhooks.

### Migration limits and report interpretation

The entrypoint calls only the existing narrow `phcepMigrateLayout_`: it can
create missing managed sheets and refresh managed schemas, validations,
protections, sheet order and the overview. It does **not** run setup, create
Forms, triggers or folders, or change runtime IDs. Existing operator/control
blocks outside the supported **M-column** start are rejected, not relocated.
Unsupported/conflicting headers and response-sheet layouts require separate
human review, not a forced migration. K/L are hidden only when the operator
block is first created; repeating migration does not re-hide them if an
operator has subsequently unhidden them.

Before/after reports contain allowlisted, sanitized **schema metadata**, not
clinical cell contents, arbitrary remote error text, resource IDs or URLs.
The fixed target is documented here; report metadata does not disclose those
identifiers. Summaries and the `phcep-manual-layout-report` artifact have a
short artifact retention of **3 days**; follow the repository's access and
log-retention policy too. Unknown observations are `null`, not fabricated
zeroes or guarantees. Forms inventory records whether each existing Form is
configured and readable, and its item count when readable. It opens configured
Forms read-only; it does not expose item titles, values, responses, URLs or IDs.
Forms reporting is metadata-only: “unchanged” means unchanged observable
metadata, and inaccessible/unobservable state is “unknown”; neither proves exact
unchanged questions, responses, sharing or content. Likewise,
unchanged sheet metadata does not prove unchanged cells, formatting,
validations or protection contents.

Apply is **not atomic**: source upload may succeed before migration fails,
and migration can leave partial sheet changes. The runner does not
automatically retry Google mutations or roll back; after a timeout the remote
outcome can be unknown. Once source upload is attempted, the report clears
`after` to `null` until a fresh migration result is available; an earlier preview
must not be mistaken for proof of an unchanged post-timeout state.
Inspect the reported completed stages and known
before/after changes, then securely verify the live state before deciding
whether any further operation is safe. **Do not blindly rerun an unknown
result.** Rolling back Apps Script source does not reverse sheet changes;
use the approved backup and an owner-reviewed recovery plan.

### Blockers and safe diagnostics

Diagnostics intentionally suppress raw Google responses. Never enable secret
or clinical-data logging to investigate a failure.

| Diagnostic / symptom | Operator action |
| --- | --- |
| `MAIN_ONLY`, `CONFIRMATION_REQUIRED` | Merge first, select `main`, and enter `APPLY` exactly, including for dry run. |
| `SCRIPT_ID_PIN_REQUIRED`, `TARGET_MISMATCH` | Independently verify both script-ID variables and the exact spreadsheet variable; do not guess from existing clasp configuration. |
| Invalid, non-user or non-refreshable OAuth credential | Complete the owner-user OAuth prerequisite and securely replace the PHCEP-specific secret; do not use a service account. |
| `OAUTH_CLIENT_MISMATCH`, `OAUTH_SCOPES_REQUIRED` | Check custom Desktop client/audience and same Cloud project; reauthorize all manifest scopes plus `script.projects`. |
| `PREVIEW_UNAVAILABLE_BOOTSTRAP_REQUIRED` | Manually install the exact reviewed source and manifest without executing setup/migration, separately establish the owner-only API executable, then repeat dry run. |
| `REMOTE_FILE_SET_MISMATCH`, `MANIFEST_MISMATCH` | Review source drift and reconcile the exact allowlist/manifest, including owner-only `executionApi`, without deleting unknown files or weakening guards. |
| `SOURCE_INTEGRITY_PIN_REQUIRED` | Use the canonical hash from an independently reviewed trusted previous checkout, or manually bootstrap exact latest reviewed source/manifest. Never pin unknown live code merely to pass preflight. |
| Remote migration blocked / unsupported layout | Privately check ScriptProperties `SPREADSHEET_ID`, authorized owner/editor access, headers, response-sheet conflicts, overview ownership and operator block at M. Review unsupported layouts manually; no automatic relocation. |
| API/execution failure | Check API enablement, owner user-access toggle, pre-existing API executable, owner identity, scopes and Cloud-project compatibility. If apply began, reconcile possible partial/unknown changes before any rerun. |
