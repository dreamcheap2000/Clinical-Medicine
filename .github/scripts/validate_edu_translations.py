#!/usr/bin/env python3
"""Fail when Chinese article versions contain long English-only blocks."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_FILE = REPO_ROOT / "PHCEP" / "data" / "edu" / "patient_edu_data.json"
DATA_FILE_REL = "PHCEP/data/edu/patient_edu_data.json"

TAG_RE = re.compile(r"<[^>]+>")
ENTITY_RE = re.compile(r"&[a-zA-Z#0-9]+;")
ENG_BLOCK_RE = re.compile(r"(?:\b[A-Za-z][A-Za-z0-9%/().,\-+]*\b[\s:;,]+){7,}")


def strip_html(text: str) -> str:
    text = TAG_RE.sub(" ", text)
    text = ENTITY_RE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def main() -> int:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    previous_raw = None
    try:
        previous_raw = subprocess.check_output(
            ["git", "show", f"HEAD:{DATA_FILE_REL}"],
            cwd=REPO_ROOT,
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        previous_raw = None

    previous_entries: dict[str, dict] = {}
    if previous_raw:
        try:
            prev = json.loads(previous_raw)
            for item in prev.get("entries", []):
                key = item.get("id") or f"{item.get('title','')}|{item.get('source_label','')}"
                previous_entries[key] = item
        except Exception:
            previous_entries = {}

    bad: list[str] = []

    for entry in data.get("entries", []):
        title = entry.get("title", "(untitled)")
        key = entry.get("id") or f"{entry.get('title','')}|{entry.get('source_label','')}"
        prev_entry = previous_entries.get(key) or {}
        prev_versions = prev_entry.get("versions") or {}
        versions = entry.get("versions") or {}
        for field in ("simple_zh", "professional_zh"):
            content = strip_html(versions.get(field, ""))
            if not content:
                continue
            if previous_entries and versions.get(field, "") == prev_versions.get(field, ""):
                continue
            if ENG_BLOCK_RE.search(content):
                bad.append(f"{title} [{field}]")

    if bad:
        print("❌ Translation QA failed: long English blocks found in Chinese fields:")
        for item in bad:
            print(f" - {item}")
        print("Please revise the affected simple_zh/professional_zh content before commit.")
        return 1

    print("✅ Translation QA passed: no long English blocks found in Chinese fields.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
