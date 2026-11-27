# PHCEP LINE availability monitor

The GitHub Actions workflow runs approximately every 15 minutes and can also be
started manually. It checks Render `/healthz` and sends an unsigned empty object
directly to the configured PHCEP Apps Script web app, expecting
`INVALID_ENVELOPE`. It sends no LINE events and does not write monitoring rows.
Three attempts are made before reporting a failure; logs contain only fixed
status codes, never URLs, credentials, or response bodies.

To enable it:

1. Put the workflow and monitor source on the repository's default branch.
2. In GitHub repository **Settings → Secrets and variables → Actions**, create
   the secret `PHCEP_MONITOR_APPS_SCRIPT_URL` containing the exact PHCEP `/exec`
   URL configured on Render. Do not paste it into an issue, log, or chat.
3. In GitHub notification settings, enable Actions email notifications for
   failed workflows. Scheduled-run notifications go to the workflow's actor;
   check the recipient and email delivery with a controlled failure.
4. Run the workflow manually and confirm both checks pass. Confirm that a
   controlled failure sends an alert, then restore the configuration and run it
   successfully again.

`GOOGLE_HTTP_403` is consistent with the previously observed authorization
failure, but can have other causes. Follow the [403 troubleshooting
instructions](../README.md#google-http-403-even-when-deployment-access-is-anyone);
consent must be granted by the authorized owner when Google requires it.
This monitor cannot grant consent, check the configured LINE webhook, verify
message handling or a Sheet row, or recover missed messages. `/healthz` is
liveness only, and the empty Apps Script probe does not test Sheet access.
GitHub schedules may be delayed or dropped, and public-repository workflows may
be disabled after 60 days of inactivity; use independent dead-man monitoring
if continuous coverage is required. Failed runs can send repeated alerts.
Enable LINE webhook redelivery separately; it is not guaranteed to recover all
events. Do not use the backend probe as Render's restart health check.
