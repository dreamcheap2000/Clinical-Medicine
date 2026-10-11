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
to one dedicated Apps Script project. Do not upload the four `.gs.txt` reference
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
   A standalone project needs the Apps Script editor or an operator-bound UI
   project to expose spreadsheet menus; do not install a second sending project.
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

## Clinician workflow

`LINE對話` columns A:J retain the uploaded layout:
Message ID; 發送問卷 (勾選); User ID; DateTime; User Name;
訊息 (病患問題); 檔案/媒體連結; 建議回覆選單; 回覆草稿 (可編輯);
回覆紀錄 (最新). K stores Event Key and L stores durable operation status.
Existing extra history must be moved by an authorized operator if it conflicts
with these explicitly checked reserved columns. No clinician history is shifted
into event/storage columns.

H selects a manually curated QA reply and populates I; it does not send.
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
