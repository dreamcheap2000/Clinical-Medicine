import argparse
import json
import os
import sys
from pathlib import Path

DEFAULT_CLASP_OAUTH_CLIENT_ID = (
    "1072944905499-vm2v2i5dvn0a0d2o4ca36i1vge8cvbn0.apps.googleusercontent.com"
)
DEFAULT_CLASP_OAUTH_CLIENT_SECRET = "v6V3fKV_zWU7iw1DrpO1rknX"


def has_non_empty_string(value):
    return isinstance(value, str) and bool(value.strip())


def has_usable_token(token):
    return isinstance(token, dict) and (
        has_non_empty_string(token.get("access_token"))
        or has_non_empty_string(token.get("refresh_token"))
    )


def parse_clasprc_json(raw):
    if not raw.strip():
        raise ValueError("CLASPRC_JSON is empty or not set")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError(f"CLASPRC_JSON is not valid JSON: {error.msg}") from error
    if not isinstance(parsed, dict):
        raise ValueError("CLASPRC_JSON must be a JSON object")
    return parsed


def normalize_token_wrapped_payload(token):
    normalized_token = dict(token)
    if "exprity_date" not in normalized_token and "expiry_date" in normalized_token:
        normalized_token["exprity_date"] = normalized_token["expiry_date"]

    return {
        "token": normalized_token,
        "oauth2ClientSettings": {
            "clientId": DEFAULT_CLASP_OAUTH_CLIENT_ID,
            "clientSecret": DEFAULT_CLASP_OAUTH_CLIENT_SECRET,
        },
    }


def normalize_clasprc_payload(parsed):
    tokens = parsed.get("tokens")
    if tokens is not None:
        if not isinstance(tokens, dict) or not isinstance(tokens.get("default"), dict):
            raise ValueError("CLASPRC_JSON tokens format must include an object at tokens.default")
        default_credentials = tokens["default"]
        if not has_usable_token(default_credentials):
            raise ValueError(
                "CLASPRC_JSON tokens.default format must include non-empty access_token or refresh_token"
            )
        if not (
            has_non_empty_string(default_credentials.get("client_id"))
            and has_non_empty_string(default_credentials.get("client_secret"))
        ):
            raise ValueError(
                "CLASPRC_JSON tokens.default format must include non-empty client_id and client_secret"
            )
        return parsed

    token = parsed.get("token")
    if token is not None:
        if not has_usable_token(token):
            raise ValueError(
                "CLASPRC_JSON token format must include non-empty token.access_token or token.refresh_token"
            )

        oauth_settings = parsed.get("oauth2ClientSettings")
        if oauth_settings is not None:
            if not (
                isinstance(oauth_settings, dict)
                and has_non_empty_string(oauth_settings.get("clientId"))
                and has_non_empty_string(oauth_settings.get("clientSecret"))
            ):
                raise ValueError(
                    "CLASPRC_JSON local token format must include non-empty "
                    "oauth2ClientSettings.clientId and oauth2ClientSettings.clientSecret"
                )
            return parsed

        if has_non_empty_string(token.get("client_id")) and has_non_empty_string(
            token.get("client_secret")
        ):
            return {
                "tokens": {
                    "default": {
                        **token,
                        "type": token.get("type", "authorized_user"),
                    }
                }
            }

        return normalize_token_wrapped_payload(token)

    if has_usable_token(parsed):
        return parsed

    raise ValueError(
        "CLASPRC_JSON must be in one of clasp's supported formats: "
        "legacy top-level tokens, token + oauth2ClientSettings, or tokens.default"
    )


def write_clasprc_json(path: Path, raw):
    normalized = normalize_clasprc_payload(parse_clasprc_json(raw))
    content = json.dumps(normalized)
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    fd = os.open(path, flags, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
    finally:
        try:
            os.chmod(path, 0o600)
        except FileNotFoundError:
            pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    write_clasprc_json(Path(args.output), os.environ.get("CLASPRC_JSON", ""))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error
