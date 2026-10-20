"""Manual PHCEP deployment. All remote responses are private, never logged."""

import json
import os
import re
import sys
from pathlib import Path
from urllib import error, parse, request

from scripts.write_clasp_credentials import normalize_clasprc_payload, parse_clasprc_json

TARGET = "12ksl5GvgM_YVc1NjrPE9LRe_YvUgqttLl0R41z5dazo"
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "PHCEP" / "apps-script"
FUNCTION = "phcepManualLayoutMigration"
SCOPE = "https://www.googleapis.com/auth/"
FILES = ("Core", "Embeddings", "Forms", "Matcher", "Setup", "Storage", "UI",
         "Workflow", "ManualMigration")
SHEETS = ("LINE對話", "QA知識庫", "PHCEP事件", "PHCEP請求", "PHCEP寄件匣",
          "PHCEP邀請", "PHCEP表單紀錄", "PHCEP隔離", "PHCEP回覆歷史", "PHCEP臨床評分",
          "收錄集合", "總覽")
REMOTE_BLOCKERS = {
    "INVALID_REQUEST", "TARGET_MISMATCH", "CONFIGURATION_MISMATCH", "UNAUTHORIZED",
    "LOCK_UNAVAILABLE", "READ_FAILED", "MIGRATION_FAILED", "UNMANAGED_OVERVIEW",
    "SCHEMA_CONFLICT", "UNSUPPORTED_LINE_LAYOUT",
}


class Blocked(Exception):
    """Only fixed diagnostic codes may leave the runner."""


def dry_run(value):
    if value is None or value is True or value == "true":
        return True
    if value is False or value == "false":
        return False
    raise Blocked("INVALID_DRY_RUN")


def guard(env):
    if env.get("GITHUB_REF") != "refs/heads/main":
        raise Blocked("MAIN_ONLY")
    if env.get("PHCEP_CONFIRMATION") != "APPLY":
        raise Blocked("CONFIRMATION_REQUIRED")
    return dry_run(env.get("PHCEP_DRY_RUN"))


def credentials(raw):
    try:
        parsed = parse_clasprc_json(raw)
        candidates = [parsed, parsed.get("token", {}),
                      parsed.get("tokens", {}).get("default", {})]
        if any(item.get("type") not in (None, "authorized_user") or
               "private_key" in item or "client_email" in item for item in candidates):
            raise Blocked("USER_OAUTH_REQUIRED")
        normalized = normalize_clasprc_payload(parsed)
        token = normalized.get("tokens", {}).get("default") or normalized.get("token")
        settings = normalized.get("oauth2ClientSettings", {})
        client = token.get("client_id") or settings.get("clientId")
        secret = token.get("client_secret") or settings.get("clientSecret")
        if not all(isinstance(v, str) and v.strip() for v in
                   (client, secret, token.get("refresh_token"))):
            raise Blocked("REFRESHABLE_USER_OAUTH_REQUIRED")
        return client, secret, token["refresh_token"]
    except Blocked:
        raise
    except Exception:
        raise Blocked("INVALID_USER_OAUTH") from None


def http(method, url, token=None, payload=None, form=False):
    headers = {}
    data = None
    if token:
        headers["Authorization"] = "Bearer " + token
    if payload is not None:
        data = (parse.urlencode(payload) if form else json.dumps(payload)).encode()
        headers["Content-Type"] = ("application/x-www-form-urlencoded" if form
                                   else "application/json")
    # No retries: a timeout after a mutation has an unknown outcome.
    try:
        req = request.Request(url, data=data, headers=headers, method=method)
        with request.urlopen(req, timeout=390 if url.endswith(":run") else 90) as response:
            result = json.load(response)
        if not isinstance(result, dict) or "error" in result:
            raise Blocked("GOOGLE_API_FAILED")
        return result
    except (error.URLError, ValueError, TimeoutError):
        raise Blocked("GOOGLE_API_FAILED") from None


def local_content():
    files = [{"name": name, "type": "SERVER_JS",
              "source": (SOURCE / (name + ".gs")).read_text()} for name in FILES]
    files.append({"name": "appsscript", "type": "JSON",
                  "source": (SOURCE / "appsscript.json").read_text()})
    return files


def count(value):
    return value if type(value) is int and 0 <= value <= 1000000 else None


def boolean(value):
    return value if type(value) is bool else None


def inventory(value):
    """Reconstruct a report from allowlisted fields, never copy remote objects."""
    if not isinstance(value, dict):
        return None
    result = {}
    for key in ("totalSheets", "otherSheets"):
        result[key] = count(value.get(key))
    result["legacyLinePresent"] = boolean(value.get("legacyLinePresent"))
    result["sheets"] = []
    for sheet in value.get("sheets", []) if isinstance(value.get("sheets"), list) else []:
        if not isinstance(sheet, dict) or sheet.get("name") not in SHEETS:
            continue
        item = {"name": sheet["name"]}
        item["present"] = boolean(sheet.get("present"))
        for key in ("index", "rows", "columns", "frozenRows", "matchingHeaders", "protectionCount"):
            item[key] = count(sheet.get(key))
        result["sheets"].append(item)
    line = value.get("line", {})
    if not isinstance(line, dict):
        line = {}
    result["line"] = {key: count(line.get(key)) for key in
                      ("controlStartColumn", "historyStartColumn")}
    result["line"].update({key: boolean(line.get(key)) for key in ("hiddenK", "hiddenL")})
    forms = value.get("forms", {})
    result["forms"] = {}
    if isinstance(forms, dict):
        for name in ("CDR", "VITALS"):
            form = forms.get(name, {})
            if isinstance(form, dict):
                result["forms"][name] = {
                    "configured": boolean(form.get("configured")),
                    "observable": boolean(form.get("observable")),
                    "items": count(form.get("items")),
                }
    return result


def remote_report(value):
    if not isinstance(value, dict) or value.get("status") not in ("ok", "blocked", "failed"):
        raise Blocked("INVALID_EXECUTION_RESPONSE")
    # Treat all remote diagnostics as untrusted, even messages in HTTP 200.
    blocker = value.get("blocker")
    return {"status": value["status"], "before": inventory(value.get("before")),
            "after": inventory(value.get("after")),
            "operations": operations(value.get("changes")),
            "blocker": None if value["status"] == "ok" else (
                blocker if isinstance(blocker, str) and blocker in REMOTE_BLOCKERS
                else "REMOTE_MIGRATION_BLOCKED")}


def operations(changes):
    if not isinstance(changes, dict) or not isinstance(changes.get("operations"), dict):
        return None
    source = changes["operations"]
    state = source.get("state")
    result = {"state": state if state in ("completed", "partial", "not_started") else "unknown"}
    for key in ("schemaProtectionFormattingSheets", "validationSheets"):
        names = source.get(key)
        result[key] = sorted({name for name in names if isinstance(name, str) and name in SHEETS}) if isinstance(names, list) else None
        result[key + "Count"] = len(result[key]) if result[key] is not None else None
    for key in ("overviewRefreshed", "sheetOrderEnsured"):
        result[key] = boolean(source.get(key))
    # Metadata snapshots cannot prove which cell values were changed.
    result["contentChangedSheetCount"] = None
    return result


def observed_diff(before, after):
    if before is None or after is None:
        return None
    old = {item["name"]: item for item in before["sheets"]}
    result = {"createdSheets": [], "renamedSheets": [], "changedSheets": [],
              "unchangedSheets": [], "absentSheets": [], "unknownSheets": [], "forms": {}}
    for item in after["sheets"]:
        previous = old.get(item["name"])
        if previous is None or previous["present"] is None or item["present"] is None:
            result["unknownSheets"].append(item["name"])
        elif not previous["present"] and item["present"]:
            if item["name"] == "LINE對話" and before["legacyLinePresent"] is True:
                result["renamedSheets"].append(item["name"])
            elif item["name"] == "LINE對話" and before["legacyLinePresent"] is None:
                result["unknownSheets"].append(item["name"])
            else:
                result["createdSheets"].append(item["name"])
        elif not item["present"]:
            result["absentSheets"].append(item["name"])
        elif previous != item or (item["name"] == "LINE對話" and before["line"] != after["line"]):
            result["changedSheets"].append(item["name"])
        else:
            result["unchangedSheets"].append(item["name"])
    for name in ("CDR", "VITALS"):
        first, last = before["forms"].get(name), after["forms"].get(name)
        result["forms"][name] = (
            "unknown" if not first or not last or not first["observable"] or not last["observable"]
            else "unchanged" if first == last else "changed")
    result["counts"] = {key: len(result[key]) for key in
                        ("createdSheets", "renamedSheets", "changedSheets",
                         "unchangedSheets", "absentSheets", "unknownSheets")}
    return result


def execute(api, url, token, apply):
    payload = api("POST", url + ":run", token, {
        "function": FUNCTION, "parameters": [{"targetSpreadsheetId": TARGET, "apply": apply}],
        "devMode": True,
    })
    if "error" in payload or payload.get("done") is not True:
        raise Blocked("EXECUTION_FAILED")
    return remote_report(payload.get("response", {}).get("result"))


def run(env, api=http):
    report = {"mode": "unknown", "commit": None, "status": "failed", "stages": [],
              "planned": ["existing_layout_migration", "source_upload"],
              "actual": None, "before": None, "after": None, "blockers": [],
              "sourceUpload": "not_attempted", "migration": "not_attempted",
              "operations": None}
    sha = env.get("GITHUB_SHA", "")
    report["commit"] = sha if re.fullmatch(r"[a-f0-9]{40}", sha) else None
    try:
        preview = guard(env)
        report["mode"] = "dry_run" if preview else "apply"
        report["stages"].append("guards")
        script = env.get("PHCEP_SCRIPT_ID", "")
        expected = env.get("PHCEP_EXPECTED_SCRIPT_ID", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{20,200}", script) or script != expected:
            raise Blocked("SCRIPT_ID_PIN_REQUIRED")
        if env.get("PHCEP_SPREADSHEET_ID") != TARGET:
            raise Blocked("TARGET_MISMATCH")
        client, secret, refresh = credentials(env.get("PHCEP_CLASPRC_JSON", ""))
        if client != env.get("PHCEP_OAUTH_CLIENT_ID"):
            raise Blocked("OAUTH_CLIENT_MISMATCH")
        files = local_content()
        report["stages"].append("configuration")
        auth = api("POST", "https://oauth2.googleapis.com/token", payload={
            "client_id": client, "client_secret": secret, "refresh_token": refresh,
            "grant_type": "refresh_token"}, form=True)
        token = auth.get("access_token")
        if not isinstance(token, str) or not token:
            raise Blocked("OAUTH_REFRESH_FAILED")
        info = api("GET", "https://oauth2.googleapis.com/tokeninfo?" +
                   parse.urlencode({"access_token": token}))
        manifest = json.loads(files[-1]["source"])
        required = set(manifest["oauthScopes"]) | {SCOPE + "script.projects"}
        if not required.issubset(set(info.get("scope", "").split())):
            raise Blocked("OAUTH_SCOPES_REQUIRED")
        if info.get("aud") != client:
            raise Blocked("OAUTH_CLIENT_MISMATCH")
        report["stages"].append("user_oauth")
        url = "https://script.googleapis.com/v1/projects/" + script
        remote = api("GET", url + "/content", token)
        if "error" in remote or not isinstance(remote.get("files"), list):
            raise Blocked("SOURCE_PREFLIGHT_FAILED")
        # The preview closure must be trusted before any remote execution.
        # ManualMigration is self-contained on its read-only path.
        safety = next(f for f in files if f["name"] == "ManualMigration")
        matches = [f for f in remote["files"] if f.get("name") == safety["name"]]
        if len(matches) != 1 or any(matches[0].get(k) != safety[k] for k in safety):
            raise Blocked("PREVIEW_UNAVAILABLE_BOOTSTRAP_REQUIRED")
        before = execute(api, "https://script.googleapis.com/v1/scripts/" + script, token, False)
        report["before"] = before["before"]
        report["after"] = before["after"]
        report["operations"] = before["operations"]
        if before["status"] != "ok":
            raise Blocked(before["blocker"])
        if report["before"] is None:
            raise Blocked("INVALID_EXECUTION_RESPONSE")
        report["stages"].append("readonly_preflight")
        if preview:
            report["status"] = "dry_run_noop"
            report["actual"] = observed_diff(report["before"], report["after"])
            return report
        # Do not delete unknown remote files, libraries or advanced service config.
        # A source push is whole-project replacement, so fail closed on drift.
        names = {(f["name"], f["type"]) for f in files}
        if {(f.get("name"), f.get("type")) for f in remote["files"]} != names or len(remote["files"]) != len(files):
            raise Blocked("REMOTE_FILE_SET_MISMATCH")
        remote_manifest = next(f["source"] for f in remote["files"] if f["name"] == "appsscript")
        if json.loads(remote_manifest) != manifest:
            raise Blocked("MANIFEST_MISMATCH")
        report["sourceUpload"] = "outcome_unknown"
        report["after"] = None
        uploaded = api("PUT", url + "/content", token, {"files": files})
        if "error" in uploaded or not isinstance(uploaded.get("files"), list):
            raise Blocked("SOURCE_UPLOAD_FAILED")
        report["sourceUpload"] = "completed"
        report["stages"].append("source_upload")
        report["migration"] = "outcome_unknown"
        report["operations"] = None
        result = execute(api, "https://script.googleapis.com/v1/scripts/" + script, token, True)
        report["after"] = result["after"]
        # Apply takes another locked preflight: use the actual locked before state.
        report["before"] = result["before"]
        report["actual"] = observed_diff(report["before"], report["after"])
        report["migration"] = result["status"]
        report["operations"] = result["operations"]
        if result["status"] != "ok":
            raise Blocked(result["blocker"])
        if report["before"] is None or report["after"] is None:
            raise Blocked("INVALID_EXECUTION_RESPONSE")
        report["stages"].append("migration")
        report["status"] = "applied"
    except Blocked as exc:
        report["blockers"].append(str(exc))
    except Exception:
        report["blockers"].append("UNEXPECTED_FAILURE")
    return report


def write_report(report, output, summary):
    content = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    Path(output).write_text(content)
    os.chmod(output, 0o600)
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("## PHCEP manual layout deployment\n\n")
            handle.write("Observed metadata only; unknown is `null`. Unchanged metadata does not "
                         "prove unchanged cell contents, formatting or protections. Apply refreshes "
                         "managed headers, protections, validations and overview; forms are never provisioned. "
                         "A failed apply can leave partial changes; no automatic rollback.\n\n")
            handle.write("```json\n" + content + "```\n")


def main():
    report = run(os.environ)
    write_report(report, os.environ["PHCEP_REPORT_PATH"], os.environ.get("GITHUB_STEP_SUMMARY"))
    return 0 if report["status"] in ("applied", "dry_run_noop") else 1


if __name__ == "__main__":
    sys.exit(main())
