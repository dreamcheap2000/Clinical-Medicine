import argparse
import json
import sys
from pathlib import Path


def load_response(path: Path):
    return path.read_text(encoding="utf-8")


def parse_response(text: str):
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as error:
        raise ValueError(f"Apps Script response is not valid JSON: {error.msg}") from error
    if not isinstance(payload, dict):
        raise ValueError("Apps Script response must be a JSON object")
    return payload


def has_meaningful_error_value(value):
    if isinstance(value, str):
        return True
    if value is None or value is False or value == 0:
        return False
    if isinstance(value, (list, dict, tuple, set)) and not value:
        return False
    return True


def validate_response(payload, expected_status, required_keys=None):
    status = payload.get("status")
    if status != expected_status:
        raise ValueError(
            f"Apps Script response status must be {expected_status!r}, got {status!r}"
        )

    has_error_metadata = any(
        key in payload and has_meaningful_error_value(payload[key])
        for key in ("error", "errors")
    )
    has_invalid_success = "success" in payload and payload["success"] is not True
    if has_error_metadata or has_invalid_success:
        raise ValueError("Apps Script response indicates an error despite matching status")

    missing_keys = [key for key in (required_keys or []) if key not in payload]
    if missing_keys:
        missing = ", ".join(missing_keys)
        raise ValueError(f"Apps Script response is missing required keys: {missing}")

    return payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--expected-status", required=True)
    parser.add_argument("--require-key", action="append", default=[])
    args = parser.parse_args()

    response_text = load_response(Path(args.input))
    payload = parse_response(response_text)
    validate_response(
        payload,
        expected_status=args.expected_status,
        required_keys=args.require_key,
    )
    print(
        f"Validated Apps Script response with status={payload['status']!r} "
        f"and keys={','.join(sorted(payload.keys()))}"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error
