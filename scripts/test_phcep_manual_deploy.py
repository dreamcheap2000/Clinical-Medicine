import copy
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import phcep_manual_deploy as runner


class FakeGoogle:
    def __init__(self):
        self.calls = []
        self.files = runner.local_content()
        self.scopes = json.loads(self.files[-1]["source"])["oauthScopes"] + [runner.SCOPE + "script.projects"]
        self.snapshot = {
            "totalSheets": 12, "otherSheets": 0, "legacyLinePresent": False,
            "sheets": [{"name": name, "present": True, "index": i + 1,
                        "columns": 24, "matchingHeaders": 12, "protectionCount": 1}
                       for i, name in enumerate(runner.SHEETS)],
            "line": {"controlStartColumn": 13, "historyStartColumn": 20, "hiddenK": True, "hiddenL": True},
            "forms": {name: {"configured": True, "observable": True, "items": 5}
                      for name in ("CDR", "VITALS")},
        }
        self.preview_error = False
        self.apply_error = False
        self.upload_error = False
        self.apply_timeout = False
        self.partial = False

    def __call__(self, method, url, token=None, payload=None, form=False):
        self.calls.append((method, url, payload))
        if url.endswith("/token"):
            return {"access_token": "fixture-access-secret"}
        if "/tokeninfo?" in url:
            return {"aud": "fixture-client", "scope": " ".join(self.scopes)}
        if method == "GET":
            return {"files": self.files}
        if method == "PUT":
            if self.upload_error:
                raise runner.Blocked("GOOGLE_API_FAILED")
            return {"files": payload["files"]}
        apply = payload["parameters"][0]["apply"]
        if self.apply_timeout and apply:
            raise runner.Blocked("GOOGLE_API_FAILED")
        if (apply and self.apply_error) or (not apply and self.preview_error):
            return {"done": True, "error": {"message": "patient secret access-token"}}
        after = copy.deepcopy(self.snapshot)
        if self.partial and apply:
            after["line"]["hiddenK"] = False
        return {"done": True, "response": {"result": {
            "status": "failed" if self.partial and apply else "ok",
            "before": self.snapshot, "after": after,
            "blocker": "patient secret access-token",
            "changes": {"operations": {
                "state": "partial" if self.partial and apply else "completed" if apply else "not_started",
                "schemaProtectionFormattingSheets": list(runner.SHEETS) if apply else [],
                "validationSheets": ["LINE對話", "QA知識庫", "收錄集合"] if apply else [],
                "overviewRefreshed": apply, "sheetOrderEnsured": apply,
            }},
        }}}


def environment():
    return {
        "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": "a" * 40,
        "PHCEP_CONFIRMATION": "APPLY", "PHCEP_SCRIPT_ID": "s" * 40,
        "PHCEP_EXPECTED_SCRIPT_ID": "s" * 40, "PHCEP_SPREADSHEET_ID": runner.TARGET,
        "PHCEP_OAUTH_CLIENT_ID": "fixture-client",
        "PHCEP_CLASPRC_JSON": json.dumps({"tokens": {"default": {
            "type": "authorized_user", "client_id": "fixture-client",
            "client_secret": "fixture-client-secret", "refresh_token": "fixture-refresh-secret",
        }}}),
    }


class ManualDeployTests(unittest.TestCase):
    def setUp(self):
        self.env = environment()
        self.google = FakeGoogle()

    def run_report(self):
        return runner.run(self.env, self.google)

    def test_branch_and_confirmation_fail_without_any_google_calls(self):
        for key, value, blocker in (
            ("GITHUB_REF", "refs/heads/feature", "MAIN_ONLY"),
            ("GITHUB_REF", "refs/tags/main", "MAIN_ONLY"),
            ("PHCEP_CONFIRMATION", "apply", "CONFIRMATION_REQUIRED"),
            ("PHCEP_CONFIRMATION", "$(echo patient)", "CONFIRMATION_REQUIRED"),
        ):
            with self.subTest(key=key, value=value):
                self.env = environment()
                self.env[key] = value
                self.assertIn(blocker, self.run_report()["blockers"])
                self.assertEqual([], self.google.calls)

    def test_boolean_inputs_and_default(self):
        for value in (None, True, "true"):
            self.assertTrue(runner.dry_run(value))
        for value in (False, "false"):
            self.assertFalse(runner.dry_run(value))
        for value in ("", "False", "no", 0, 1, [], {}):
            with self.assertRaises(runner.Blocked):
                runner.dry_run(value)

    def test_dry_run_default_makes_no_mutations_or_bootstrap(self):
        report = self.run_report()
        self.assertEqual("dry_run_noop", report["status"])
        self.assertEqual("not_attempted", report["sourceUpload"])
        self.assertEqual("not_attempted", report["migration"])
        for method, url, payload in self.google.calls:
            self.assertNotEqual("PUT", method)
            if url.endswith(":run"):
                self.assertEqual(runner.FUNCTION, payload["function"])
                self.assertIs(payload["parameters"][0]["apply"], False)
        self.assertEqual("unchanged", report["actual"]["forms"]["CDR"])

    def test_preview_unavailable_never_uploads_in_any_mode(self):
        self.google.files = [f for f in self.google.files if f["name"] != "ManualMigration"]
        for value in ("true", "false"):
            self.env["PHCEP_DRY_RUN"] = value
            report = self.run_report()
            self.assertIn("PREVIEW_UNAVAILABLE_BOOTSTRAP_REQUIRED", report["blockers"])
        self.assertFalse(any(method == "PUT" or url.endswith(":run")
                             for method, url, _ in self.google.calls))

    def test_preview_code_drift_blocks_execution(self):
        self.google.files = copy.deepcopy(self.google.files)
        self.google.files[0]["source"] += "\n"
        wrapper = next(f for f in self.google.files if f["name"] == "ManualMigration")
        wrapper["source"] += "\n"
        self.assertIn("PREVIEW_UNAVAILABLE_BOOTSTRAP_REQUIRED", self.run_report()["blockers"])
        self.assertFalse(any(url.endswith(":run") for _, url, _ in self.google.calls))

    def test_whole_project_integrity_before_any_execution_in_both_modes(self):
        for mode in ("true", "false"):
            self.env["PHCEP_DRY_RUN"] = mode
            self.google = FakeGoogle()
            self.google.files = copy.deepcopy(self.google.files)
            self.google.files[0]["source"] += "\nfunction phcepManualLayoutMigration() { throw 'unsafe'; }\n"
            report = self.run_report()
            self.assertIn("SOURCE_INTEGRITY_PIN_REQUIRED", report["blockers"])
            self.assertFalse(any(method == "PUT" or url.endswith(":run")
                                 for method, url, _ in self.google.calls))

    def test_independently_reviewed_old_source_pin_allows_updates(self):
        self.env["PHCEP_DRY_RUN"] = False
        self.google.files = copy.deepcopy(self.google.files)
        self.google.files[0]["source"] += "\n// reviewed previous revision\n"
        self.env["PHCEP_PREFLIGHT_SOURCE_SHA256"] = runner.content_digest(self.google.files)
        self.assertEqual("applied", self.run_report()["status"])
        uploaded = next(payload["files"] for method, _, payload in self.google.calls if method == "PUT")
        self.assertEqual(runner.content_digest(runner.local_content()), runner.content_digest(uploaded))

    def test_bad_or_stale_source_pin_never_executes(self):
        self.google.files = copy.deepcopy(self.google.files)
        self.google.files[0]["source"] += "\n// source drift\n"
        for pin in ("fixture-secret", "a" * 64):
            self.env["PHCEP_PREFLIGHT_SOURCE_SHA256"] = pin
            self.assertIn("SOURCE_INTEGRITY_PIN_REQUIRED", self.run_report()["blockers"])
        self.assertFalse(any(method == "PUT" or url.endswith(":run")
                             for method, url, _ in self.google.calls))

    def test_digest_ignores_api_file_metadata_order_and_manifest_formatting(self):
        files = copy.deepcopy(self.google.files)
        files[-1]["source"] = json.dumps(json.loads(files[-1]["source"]), sort_keys=True)
        files[0]["lastModifyUser"] = {"displayName": "patient fixture-secret"}
        self.assertEqual(runner.content_digest(files[::-1]), runner.content_digest(self.google.files))

    def test_string_and_boolean_false_upload_then_apply_fixed_function(self):
        for value in ("false", False):
            self.env["PHCEP_DRY_RUN"] = value
            self.google = FakeGoogle()
            report = self.run_report()
            self.assertEqual("applied", report["status"], report)
            self.assertEqual("completed", report["sourceUpload"])
            executions = [p for _, url, p in self.google.calls if url.endswith(":run")]
            self.assertEqual([False, True], [p["parameters"][0]["apply"] for p in executions])
            self.assertTrue(all(p["function"] == runner.FUNCTION for p in executions))
            self.assertFalse(any("deployments" in url or "versions" in url for _, url, _ in self.google.calls))

    def test_missing_bad_credentials_and_target_fail_before_network(self):
        for key, value in (
            ("PHCEP_CLASPRC_JSON", ""),
            ("PHCEP_CLASPRC_JSON", "not-json fixture-secret"),
            ("PHCEP_CLASPRC_JSON", json.dumps({"type": "service_account", "private_key": "fixture"})),
            ("PHCEP_CLASPRC_JSON", json.dumps({"token": {"type": "service_account"}})),
            ("PHCEP_CLASPRC_JSON", json.dumps({"tokens": []})),
            ("PHCEP_CLASPRC_JSON", json.dumps({"token": {"access_token": "fixture"}})),
            ("PHCEP_SCRIPT_ID", "../wrong"),
            ("PHCEP_EXPECTED_SCRIPT_ID", "different-script"),
            ("PHCEP_SPREADSHEET_ID", runner.TARGET + "x"),
            ("PHCEP_OAUTH_CLIENT_ID", "wrong"),
        ):
            with self.subTest(key=key, value=value):
                self.env = environment()
                self.env[key] = value
                report = self.run_report()
                self.assertEqual("failed", report["status"])
                self.assertEqual([], self.google.calls)
                self.assertNotIn("fixture-secret", json.dumps(report))

    def test_missing_scopes_prevent_execution_and_upload(self):
        self.google.scopes = []
        self.assertIn("OAUTH_SCOPES_REQUIRED", self.run_report()["blockers"])
        self.assertFalse(any(url.endswith(":run") or method == "PUT"
                             for method, url, _ in self.google.calls))

    def test_http_200_error_is_failure_before_upload(self):
        self.google.preview_error = True
        self.env["PHCEP_DRY_RUN"] = False
        report = self.run_report()
        self.assertIn("EXECUTION_FAILED", report["blockers"])
        self.assertEqual("not_attempted", report["sourceUpload"])
        self.assertNotIn("patient", json.dumps(report))

    def test_apply_failure_retains_known_source_change_unknown_remote_outcome(self):
        self.google.apply_timeout = True
        self.env["PHCEP_DRY_RUN"] = False
        report = self.run_report()
        self.assertEqual("completed", report["sourceUpload"])
        self.assertEqual("outcome_unknown", report["migration"])
        self.assertIsNone(report["after"])
        self.assertIsNone(report["actual"])

    def test_upload_timeout_does_not_claim_sheet_changes_or_rollback(self):
        self.google.upload_error = True
        self.env["PHCEP_DRY_RUN"] = False
        report = self.run_report()
        self.assertEqual("outcome_unknown", report["sourceUpload"])
        self.assertEqual("not_attempted", report["migration"])
        self.assertIsNone(report["after"])

    def test_partial_failure_has_sanitized_actual_diff(self):
        self.google.partial = True
        self.env["PHCEP_DRY_RUN"] = False
        report = self.run_report()
        self.assertEqual("failed", report["status"])
        self.assertEqual(["LINE對話"], report["actual"]["changedSheets"])
        self.assertEqual("failed", report["migration"])
        self.assertEqual("partial", report["operations"]["state"])
        self.assertNotIn("patient", json.dumps(report))

    def test_manifest_and_unknown_files_are_never_overwritten(self):
        for kind in ("manifest", "extra"):
            self.google = FakeGoogle()
            self.env["PHCEP_DRY_RUN"] = False
            self.google.files = copy.deepcopy(self.google.files)
            if kind == "manifest":
                self.google.files[-1]["source"] = "{}"
            else:
                self.google.files.append({"name": "unknown", "type": "SERVER_JS", "source": "private"})
            self.assertEqual("failed", self.run_report()["status"])
            self.assertFalse(any(method == "PUT" for method, _, _ in self.google.calls))
            self.assertFalse(any(url.endswith(":run") for _, url, _ in self.google.calls))

    def test_sanitization_excludes_all_arbitrary_remote_strings(self):
        secret = "patient-name fixture-secret https://private.example/answers"
        snapshot = self.google.snapshot
        snapshot["rows"] = secret
        snapshot["line"]["hiddenK"] = secret
        snapshot["forms"]["CDR"]["id"] = secret
        snapshot["sheets"].append({"name": secret})
        snapshot["sheets"][0]["columns"] = secret
        self.assertNotIn(secret, json.dumps(self.run_report()))
        self.assertNotIn(secret, json.dumps(runner.operations({"operations": {
            "state": secret, "schemaProtectionFormattingSheets": [secret, "LINE對話"],
            "validationSheets": [secret], "overviewRefreshed": secret}})))
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "report.json"
            summary = Path(directory) / "summary"
            runner.write_report(self.run_report(), output, summary)
            self.assertNotIn(secret, output.read_text() + summary.read_text())
            self.assertEqual(0o600, output.stat().st_mode & 0o777)

    def test_unknown_is_not_zero(self):
        self.assertIsNone(runner.inventory(None))
        self.assertIsNone(runner.observed_diff(None, runner.inventory(self.google.snapshot)))
        self.assertIsNone(runner.inventory({})["totalSheets"])

    def test_created_renamed_absent_and_unknown_are_distinct(self):
        before = runner.inventory(self.google.snapshot)
        after = copy.deepcopy(before)
        before["sheets"][0]["present"] = False
        before["legacyLinePresent"] = True
        before["sheets"][1]["present"] = after["sheets"][1]["present"] = False
        before["sheets"][2]["present"] = None
        before["sheets"][3]["present"] = False
        diff = runner.observed_diff(before, after)
        self.assertEqual(["LINE對話"], diff["renamedSheets"])
        self.assertEqual(["QA知識庫"], diff["absentSheets"])
        self.assertEqual(["PHCEP事件"], diff["unknownSheets"])
        self.assertEqual(["PHCEP請求"], diff["createdSheets"])

    def test_remote_diagnostics_are_allowlisted(self):
        payload = {"status": "blocked", "blocker": "UNSUPPORTED_LINE_LAYOUT"}
        self.assertEqual("UNSUPPORTED_LINE_LAYOUT", runner.remote_report(payload)["blocker"])
        payload["blocker"] = "patient fixture-secret"
        self.assertEqual("REMOTE_MIGRATION_BLOCKED", runner.remote_report(payload)["blocker"])

    def test_real_transport_does_not_return_error_bodies(self):
        with patch.object(runner.request, "urlopen", side_effect=runner.error.URLError("patient fixture-secret")):
            with self.assertRaisesRegex(runner.Blocked, "^GOOGLE_API_FAILED$"):
                runner.http("GET", "https://script.googleapis.com/")

    def test_workflow_guard_runs_before_checkout_and_secret_materialization(self):
        workflow = (runner.ROOT / ".github/workflows/phcep-manual-layout.yml").read_text()
        guard_step = workflow.index("- name: Guard")
        self.assertLess(guard_step, workflow.index("uses: actions/checkout"))
        self.assertLess(guard_step, workflow.index("secrets.PHCEP_CLASPRC_JSON"))
        self.assertNotIn("${{ inputs.", workflow.split("run: |", 1)[1].split("      - name:", 1)[0])
        self.assertEqual(1, workflow.count("workflow_dispatch:"))
        self.assertNotIn("\n  push:", workflow)
        self.assertNotIn("\n  schedule:", workflow)
        source = textwrap.dedent(workflow.split("python3 - <<'PY'\n", 1)[1].split("\n          PY", 1)[0])
        for ref, confirmation, mode, succeeds in (
            ("refs/heads/main", "APPLY", "true", True),
            ("refs/heads/main", "APPLY", "false", True),
            ("refs/heads/main", "APPLY", "invalid", False),
            ("refs/heads/feature", "APPLY", "true", False),
            ("refs/tags/main", "APPLY", "true", False),
            ("refs/heads/main", "apply", "true", False),
            ("refs/heads/main", "$(echo unsafe)", "true", False),
        ):
            with self.subTest(ref=ref, confirmation=confirmation, mode=mode):
                with tempfile.TemporaryDirectory() as directory:
                    env = {**os.environ, "GITHUB_REF": ref, "CONFIRMATION": confirmation,
                           "DRY_RUN": mode, "RUNNER_TEMP": directory, "GITHUB_SHA": "a" * 40,
                           "GITHUB_STEP_SUMMARY": str(Path(directory) / "summary")}
                    result = subprocess.run([sys.executable, "-c", source], env=env, capture_output=True)
                    self.assertEqual(succeeds, result.returncode == 0, result.stderr)
                    report = json.loads((Path(directory) / "phcep-report.json").read_text())
                    self.assertTrue(report["blockers"])
                    self.assertTrue((Path(directory) / "summary").exists())


if __name__ == "__main__":
    unittest.main()
