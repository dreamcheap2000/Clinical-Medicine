# NHI Clinic Workflow — deployable pilot

Independent cloud service and Edge Manifest V3 extension. This is **not yet
deployed or published to Edge Add-ons**. Local synthetic tests do not certify
institutional approval, Google OAuth verification, or production readiness.
No LINE configuration, current patient gateway, credentials, or real patient
records are copied into this product.

## What is implemented

- Google OpenID login, nonce validation and PKCE; one-use extension login codes.
- PostgreSQL-backed eight-hour sessions; logout revocation and clinic membership
  checked on every request. Each clinic has its own owner, Sheet and signing key.
- Owner creates a standard Sheet automatically or connects an owned compatible
  existing Sheet. Headers come from the existing NHI worksheet contract.
- Admin invitations by verified Google email, clinician/admin roles and revocation.
  Users join only explicitly invited clinics; email invitations bind to a Google
  subject on first use. Invitations do not change Google file-sharing permissions.
- Per-clinic credentials encrypted with AES-256-GCM and authenticated context;
  session and login-code hashes stored in PostgreSQL. Audit stores only actor,
  clinic, operation and outcome, not patient records, tokens or full requests.
- Existing reviewed form mapping, manual filling, extraction preview, DRAFT
  insertion, idempotent extraction and completion. Writes still use the shared
  Apps Script lock, not unsafe Sheets read-then-write completion.
- Background-only session credential; no token or backend signing key passed to
  NHI content scripts. Patient cache stays in extension session storage per tab
  and clinic, not page sessionStorage. Clinic/account changes clear cached data.
- Explicit `CLINICAL_DATA_ENABLED=false` default blocks all clinical API operations,
  not only buttons. Enable only after institutional approval. Synthetic tests
  exercise the enabled path without contacting Google, NHI or Render.

## Architecture

```text
Edge extension -> independent clinic cloud -> clinic's signed Apps Script -> clinic Sheet
                     | PostgreSQL identities, memberships, sessions, encrypted keys
Google owner OAuth --+-> create/validate Sheet (only during setup)
NHI VPN: operator login, DOM fill/extract, operator review and manual submission
```

Each clinic receives an independent Sheet. Colleagues join the clinic through
their own Google login; they never receive a shared prototype token.
Only the owner performs the one-time Google script deployment. This is not a
promise of zero-click installation: Google consent, institutional approval and
ordinary Edge extension installation must remain user-confirmed.

## Operator setup (once for this product, not once per clinician)

1. Create a **new** cloud service and PostgreSQL database. Do not reuse the live
   `clinical-medicine` service or its environment variables.
2. Create an OAuth **Web application** in your organization's Google Cloud project.
   Enable Google Drive and Sheets APIs. Configure the exact redirect URI:
   `https://YOUR_NEW_SERVICE/auth/callback`.
3. Configure the OAuth consent screen for `openid`, `email`, `drive.file`,
   `drive.metadata.readonly` and `spreadsheets`. Metadata access verifies ownership
   of an existing Sheet; spreadsheet access supports connecting compatible existing
   Sheets. The app reads only headers during setup and uses the locked receiver for
   clinical operations. Complete any Google verification required for distribution.
   Do not assume an External/Testing OAuth app is suitable for public distribution.
4. Set the variables in [.env.example](.env.example) using the new service's secret
   manager. Keep `DATA_ENCRYPTION_KEY` stable and backed up: losing it prevents
   decrypting existing credentials. Generate 32 random bytes encoded as base64,
   outside source control. Never print or commit the key.
5. Use repository root as the service root. Build:

   ```powershell
   npm ci --ignore-scripts --prefix PHCEP\gateway
   npm ci --ignore-scripts --prefix PHCEP\nhi-cloud
   npm run build --prefix PHCEP\nhi-cloud
   ```

   Start: `npm start --prefix PHCEP\nhi-cloud`. Run
   `npm run migrate --prefix PHCEP\nhi-cloud` once before first start, and as a
   reviewed release step for future schema changes. Use TLS/verified certificates
   for database connections; never disable certificate verification. Set cloud
   health check to `/healthz`, which checks PostgreSQL but not Google access.
   Use Node 22 or later.
6. Build reads `PUBLIC_ORIGIN` and refuses the existing LINE service origin.
   Load `.build/extension` through Edge's **Load unpacked** for the pilot.
   Obtain the actual extension ID and put it in `EXTENSION_IDS` (comma-separated,
   no wildcards). Reload/redeploy configuration. For public distribution, publish
   the extension in Edge Add-ons and register the final store extension ID.
   Never share your Edge profile, exported tokens or secrets.
7. Test with two independent synthetic clinic workspaces, including denied
   cross-clinic operations and member revocation. Keep clinical data disabled until
   the organization's approval covers both Google storage and this cloud service.

No cloud resources or billing changes are created by the build.

## Clinic owner's setup

1. Install the extension, open its setup page, sign in with Google.
2. Create a clinic and select it. Create a new standard Sheet or connect your
   existing owned Sheet with exact compatible headers. An existing Sheet ID alone
   cannot grant access to another clinic. Already connected Sheets cannot be swapped.
3. Open the clinic Sheet's bound Apps Script editor. Install the five files exposed
   by the wizard. Do not overwrite unrelated scripts; inspect existing projects first.
   Files are generated from `../nhi-sheet-script`, with only a signed,
   header-only `patient.health` action and the pairing menu added.
4. Obtain the setup key from the owner-only wizard action, run `nhiCloudPair`,
   authorize Google, and paste the key into its prompt. It is stored in
   `NHI_GATEWAY_SIGNING_SECRET`, not source or a Sheet cell. Clear the clipboard
   after pairing. The prompt is not password-masked; use a private workstation.
5. Deploy the bound script as Web app / execute as owner / Anyone. **The Sheet
   itself stays restricted**. Institutional policy must permit this authenticated
   transport endpoint. The cloud verifies both signature and Sheet identity before
   enabling the clinic. Renew the owner's script authorization if Google requests it.
6. Paste the `/exec` URL into the wizard and validate. Add colleagues' Google emails.
   Share the Sheet only with explicitly trusted editors if they need to review
   DRAFT rows and promote them to PENDING.
7. Disable the old Tampermonkey script to avoid competing writes; refresh the NHI
   page after login or changing clinic. The extension never submits NHI forms.
   HIS import and follow-up menu functions remain in the copied bound script.

Ordinary members only install, sign in and select their invited clinic. They do
not configure Google service accounts, Apps Script keys, tokens, or Render URLs.

## Testing and packaging

```powershell
npm test --prefix PHCEP\nhi-cloud
$env:PUBLIC_ORIGIN = 'https://YOUR_NEW_SERVICE'
npm run build --prefix PHCEP\nhi-cloud
Compress-Archive -Path PHCEP\nhi-cloud\.build\extension\* -DestinationPath NHI-Clinic-Edge.zip
```

The userscript snapshot in `vendor/` is the existing locally maintained 2.2.0
assistant, copied without configuration secrets. Its SHA-256 is checked before
building. Review any upstream update, update the snapshot/checksum, and rerun
form mapping tests before release. Build transforms only credential transport,
host configuration and patient cache; it does not change NHI form selectors.

Tests use PGlite's PostgreSQL engine for real SQL schema, membership and session
semantics, plus synthetic HTTP, extension VM and Apps Script VM checks.
They do not substitute for a production PostgreSQL multi-connection concurrency
test, a real Google OAuth/Sheet setup, Edge installation, or the actual NHI page.

## Pilot limitations and required release checks

- Google and Edge account verification/store publication are not automated here.
  Real two-account end-to-end onboarding is required before distribution.
- No automated emails: invitation means an explicit membership entry; the admin
  communicates installation instructions separately.
- No MFA implementation in this product; configure institutional identity policy.
- Google refresh tokens and clinic credentials require a retention policy,
  audited deletion/offboarding process and key rotation procedure before broad use.
  Logout revokes the product session, not Google's consent or existing Sheet shares.
- Trusted Sheet editors can inspect the bound script and Script Properties.
  Clinic membership is not a replacement for Google sharing administration.
- The receiver cannot prevent concurrent manual Google Sheet edits. Its script
  lock serializes automated/menu writes; staff must preserve headers and immutable IDs.
- NHI DOM changes need validation. Missing fields are reported, not guessed;
  partial filling and manual category postbacks retain the original assistant UX.
- The cloud reuses the gateway's patient adapter/validation code as a library;
  deploying this service does not enable or reconfigure the original gateway.
