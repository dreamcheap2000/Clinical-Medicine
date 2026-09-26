import tempfile
import unittest
from pathlib import Path

from scripts import validate_apps_script_response as validator


class ValidateAppsScriptResponseTests(unittest.TestCase):
    def test_parse_response_rejects_malformed_json(self):
        with self.assertRaisesRegex(ValueError, "not valid JSON"):
            validator.parse_response("{")

    def test_parse_response_rejects_non_object_json(self):
        with self.assertRaisesRegex(ValueError, "must be a JSON object"):
            validator.parse_response('["ok"]')

    def test_validate_response_rejects_wrong_status(self):
        with self.assertRaisesRegex(ValueError, "must be 'success', got 'error'"):
            validator.validate_response({"status": "error"}, expected_status="success")

    def test_validate_response_rejects_missing_required_keys(self):
        with self.assertRaisesRegex(ValueError, "missing required keys: qaCount"):
            validator.validate_response(
                {"status": "ok"},
                expected_status="ok",
                required_keys=["qaCount"],
            )

    def test_validate_response_rejects_error_metadata(self):
        with self.assertRaisesRegex(ValueError, "indicates an error despite matching status"):
            validator.validate_response(
                {"status": "success", "error": "Unsupported action"},
                expected_status="success",
            )

    def test_validate_response_rejects_falsey_error_metadata(self):
        with self.assertRaisesRegex(ValueError, "indicates an error despite matching status"):
            validator.validate_response(
                {"status": "success", "error": ""},
                expected_status="success",
            )

    def test_validate_response_rejects_non_true_success_flag(self):
        with self.assertRaisesRegex(ValueError, "indicates an error despite matching status"):
            validator.validate_response(
                {"status": "success", "success": 0},
                expected_status="success",
            )

    def test_validate_response_allows_empty_errors_collection(self):
        payload = {"status": "success", "errors": []}
        self.assertEqual(
            validator.validate_response(payload, expected_status="success"),
            payload,
        )

    def test_load_and_validate_accepts_expected_response(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "response.json"
            path.write_text('{"status":"ok","qaCount":1,"threshold":0.35}', encoding="utf-8")

            payload = validator.parse_response(validator.load_response(path))
            self.assertEqual(
                validator.validate_response(
                    payload,
                    expected_status="ok",
                    required_keys=["qaCount", "threshold"],
                ),
                payload,
            )


if __name__ == "__main__":
    unittest.main()
