import json
import tempfile
import unittest
from pathlib import Path

from scripts import write_clasp_credentials as writer


class WriteClaspCredentialsTests(unittest.TestCase):
    def test_parse_clasprc_json_rejects_malformed_json(self):
        with self.assertRaisesRegex(ValueError, "not valid JSON"):
            writer.parse_clasprc_json("{")

    def test_normalize_clasprc_payload_accepts_modern_tokens_default_format(self):
        payload = {
            "tokens": {
                "default": {
                    "type": "authorized_user",
                    "client_id": "client-id",
                    "client_secret": "client-secret",
                    "refresh_token": "refresh-token",
                }
            }
        }

        self.assertEqual(writer.normalize_clasprc_payload(payload), payload)

    def test_normalize_clasprc_payload_accepts_legacy_local_format(self):
        payload = {
            "token": {"access_token": "access-token"},
            "oauth2ClientSettings": {
                "clientId": "client-id",
                "clientSecret": "client-secret",
            },
        }

        self.assertEqual(writer.normalize_clasprc_payload(payload), payload)

    def test_normalize_clasprc_payload_rewrites_token_only_format_for_clasp(self):
        normalized = writer.normalize_clasprc_payload(
            {
                "token": {
                    "access_token": "access-token",
                    "refresh_token": "refresh-token",
                    "expiry_date": 12345,
                    "token_type": "Bearer",
                }
            }
        )

        self.assertEqual(
            normalized,
            {
                "access_token": "access-token",
                "refresh_token": "refresh-token",
                "expiry_date": 12345,
                "exprity_date": 12345,
                "token_type": "Bearer",
            },
        )

    def test_normalize_clasprc_payload_rejects_incomplete_modern_tokens_default_format(self):
        with self.assertRaisesRegex(ValueError, "tokens.default"):
            writer.normalize_clasprc_payload({"tokens": {}})

    def test_normalize_clasprc_payload_promotes_token_credentials_with_client_config(self):
        normalized = writer.normalize_clasprc_payload(
            {
                "token": {
                    "type": "authorized_user",
                    "client_id": "client-id",
                    "client_secret": "client-secret",
                    "refresh_token": "refresh-token",
                }
            }
        )

        self.assertEqual(
            normalized,
            {
                "tokens": {
                    "default": {
                        "type": "authorized_user",
                        "client_id": "client-id",
                        "client_secret": "client-secret",
                        "refresh_token": "refresh-token",
                    }
                }
            },
        )

    def test_write_clasprc_json_preserves_legacy_local_payload(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / ".clasprc.json"
            payload = {
                "token": {"refresh_token": "refresh-token"},
                "oauth2ClientSettings": {
                    "clientId": "client-id",
                    "clientSecret": "client-secret",
                },
                "isLocalCreds": True,
            }
            writer.write_clasprc_json(path, json.dumps(payload))

            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), payload)

    def test_write_clasprc_json_discards_unsupported_token_sibling_fields(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / ".clasprc.json"
            writer.write_clasprc_json(
                path,
                json.dumps(
                    {
                        "token": {"refresh_token": "refresh-token"},
                        "unsupported": "metadata",
                    }
                ),
            )

            self.assertEqual(
                json.loads(path.read_text(encoding="utf-8")),
                {"refresh_token": "refresh-token"},
            )

    def test_write_clasprc_json_writes_normalized_payload(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / ".clasprc.json"
            writer.write_clasprc_json(
                path,
                json.dumps({"token": {"refresh_token": "refresh-token"}}),
            )

            self.assertEqual(
                json.loads(path.read_text(encoding="utf-8")),
                {"refresh_token": "refresh-token"},
            )
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
