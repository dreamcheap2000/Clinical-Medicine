import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts import embed


class FakeVectors:
    def __init__(self, values):
        self._values = values

    def tolist(self):
        return self._values


class FakeSentenceTransformer:
    def __init__(self, model_name):
        self.model_name = model_name

    def encode(self, texts):
        return FakeVectors([[len(text)] for text in texts])


class EmbedScriptTests(unittest.TestCase):
    def test_load_pairs_rejects_non_array(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = Path(tmpdir) / "pairs.json"
            input_path.write_text('{"question":"x"}', encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "pairs.json must contain a JSON array"):
                embed.load_pairs(input_path)

    def test_main_writes_expected_fields(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = Path(tmpdir) / "qa_pairs.json"
            output_path = Path(tmpdir) / "qa_pairs_with_embeddings.json"
            input_path.write_text(
                json.dumps(
                    [
                        {
                            "question": "What is stroke?",
                            "answer": "A neurological emergency.",
                            "keywords": "stroke neuro",
                            "enabled": True,
                        }
                    ]
                ),
                encoding="utf-8",
            )

            fake_module = SimpleNamespace(SentenceTransformer=FakeSentenceTransformer)
            argv = [
                "embed.py",
                "--input",
                str(input_path),
                "--output",
                str(output_path),
                "--model",
                "fake-model",
            ]

            with patch.dict(sys.modules, {"sentence_transformers": fake_module}):
                with patch.object(sys, "argv", argv):
                    embed.main()

            output = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(output[0]["question"], "What is stroke?")
            self.assertEqual(output[0]["answer"], "A neurological emergency.")
            self.assertEqual(output[0]["keywords"], "stroke neuro")
            self.assertEqual(output[0]["enabled"], True)
            self.assertEqual(output[0]["q_vec"], [15])
            self.assertEqual(output[0]["a_vec"], [25])


if __name__ == "__main__":
    unittest.main()
