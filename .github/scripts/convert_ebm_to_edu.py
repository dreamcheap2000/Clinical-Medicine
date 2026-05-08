#!/usr/bin/env python3
"""
convert_ebm_to_edu.py
---------------------
Reads PHCEP/data/ebm/pending_conversions.json, converts qualifying EBM entries
(those with more than MIN_LINES non-empty content lines) into full 衛教資源
articles with:

  - AI-powered FastSR S/O/A/P classification   (GitHub Models API)
  - AI-tailored tags                            (GitHub Models API)
  - 3 language versions: 簡易版/專業版/English  (GitHub Models API)
  - Version tracking: 1.0 for new, bumped on update

Merges results into PHCEP/data/edu/patient_edu_data.json.
Clears successfully processed entries from pending_conversions.json.

Auth: GITHUB_TOKEN environment variable (automatically provided in GitHub Actions).
"""

import json
import os
import re
import datetime
import sys
from pathlib import Path

REPO_ROOT    = Path(__file__).resolve().parents[2]
PENDING_FILE = REPO_ROOT / "PHCEP" / "data" / "ebm" / "pending_conversions.json"
OUTPUT_FILE  = REPO_ROOT / "PHCEP" / "data" / "edu" / "patient_edu_data.json"

# Minimum non-empty lines of content to qualify for conversion
MIN_LINES = 3


def load_pending() -> dict:
    if not PENDING_FILE.exists():
        return {"entries": []}
    try:
        return json.loads(PENDING_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"⚠️ Could not read pending_conversions.json: {e}")
        return {"entries": []}


def load_edu_data() -> dict:
    if OUTPUT_FILE.exists():
        try:
            return json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"version": "2.0", "generated": "", "entries": []}


def count_content_lines(content: str) -> int:
    return len([l for l in content.splitlines() if l.strip()])


def bump_version(version_str: str) -> str:
    """Bump the minor version: '1.0' → '1.1', '1.1' → '1.2', etc."""
    try:
        parts = str(version_str).split(".")
        major = int(parts[0])
        minor = int(parts[1]) if len(parts) > 1 else 0
        return f"{major}.{minor + 1}"
    except Exception:
        return "1.1"


def sanitize_id(raw_id: str) -> str:
    """Ensure the EBM entry id is safe to use as a JSON id."""
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", raw_id)[:60] if raw_id else "ebm_" + str(int(datetime.datetime.now().timestamp()))


def build():
    # ------------------------------------------------------------------ setup
    sys.path.insert(0, str(Path(__file__).parent))
    from translate_edu import convert_ebm_note, _get_client

    client = _get_client()
    if not client:
        print("⚠️ GITHUB_TOKEN not set — will run without AI (keyword fallback only)")
    else:
        print("✔ GitHub Models client ready")

    # ---------------------------------------------------------- load input files
    pending  = load_pending()
    edu_data = load_edu_data()

    raw_pending = pending.get("entries") or []
    if not raw_pending:
        print("ℹ️ pending_conversions.json is empty — nothing to do")
        return

    # Filter: only entries with > MIN_LINES non-empty content lines (i.e., at least MIN_LINES+1 lines)
    qualifying = [
        e for e in raw_pending
        if isinstance(e.get("content"), str) and count_content_lines(e["content"]) > MIN_LINES
    ]
    skipped = len(raw_pending) - len(qualifying)
    if skipped:
        print(f"ℹ️ Skipping {skipped} entries with ≤ {MIN_LINES} non-empty lines")
    if not qualifying:
        print("ℹ️ No qualifying EBM entries to convert")
        return

    # Build lookup of existing entries by EBM source id
    existing_entries: list[dict] = edu_data.get("entries") or []
    existing_by_ebm_id: dict[str, dict] = {}
    for e in existing_entries:
        src_id = e.get("_ebm_source_id", "")
        if src_id:
            existing_by_ebm_id[src_id] = e

    # ---------------------------------------------------------- convert entries
    today = datetime.date.today().isoformat()
    processed_ids: set[str] = set()
    updated_entries: list[dict] = list(existing_entries)

    for ebm in qualifying:
        ebm_id   = str(ebm.get("id", ""))
        content  = ebm.get("content", "")
        icd_cat  = ebm.get("icdCat", "") or ""
        date_str = ebm.get("date", today)

        print(f"\nProcessing EBM entry: {ebm_id!r} (date={date_str})")

        # Locate existing 衛教資源 entry derived from this EBM note
        existing = existing_by_ebm_id.get(ebm_id)
        existing_versions = (existing or {}).get("versions") or {}
        existing_fastsr   = (existing or {}).get("fastsr")
        existing_tags     = (existing or {}).get("tags") or []
        existing_title    = (existing or {}).get("title") or ""
        old_version       = (existing or {}).get("version", "1.0")

        try:
            doc = convert_ebm_note(
                client,
                note_text=content,
                existing_title=existing_title,
                existing_versions=existing_versions,
                existing_fastsr=existing_fastsr,
                existing_tags=existing_tags,
            )
        except Exception as e:
            print(f"  ❌ Conversion failed: {e} — skipping entry")
            continue

        if existing:
            # Update existing entry — bump version, preserve id and added_date
            new_version = bump_version(old_version)
            print(f"  ↺ Updating existing entry (version {old_version} → {new_version})")
            existing.update({
                "title":        doc["title"],
                "source_url":   doc["source_url"] or existing.get("source_url", ""),
                "source_label": doc["source_label"] or existing.get("source_label", ""),
                "source_urls":  doc["source_urls"] or existing.get("source_urls", []),
                "tags":         doc["tags"] or existing_tags,
                "fastsr":       doc["fastsr"],
                "prototype":    doc["prototype"],
                "versions":     doc["versions"],
                "version":      new_version,
                "modified_date": today,
            })
        else:
            # New entry
            edu_id = "edu_ebm_" + sanitize_id(ebm_id)
            # Avoid id collisions
            existing_ids = {e.get("id") for e in updated_entries}
            if edu_id in existing_ids:
                edu_id = edu_id + "_" + str(int(datetime.datetime.now().timestamp()))[-6:]

            new_entry = {
                "id":           edu_id,
                "title":        doc["title"],
                "source_url":   doc["source_url"],
                "source_label": doc["source_label"],
                "source_urls":  doc["source_urls"],
                "original_lang": "zh-TW",
                "added_date":   date_str,
                "version":      "1.0",
                "tags":         doc["tags"],
                "fastsr":       doc["fastsr"],
                "prototype":    doc["prototype"],
                "versions":     doc["versions"],
                "_ebm_source_id": ebm_id,
                "_from_ebm":    True,
            }
            updated_entries.append(new_entry)
            print(f"  ✔ New entry created: {edu_id}")

        processed_ids.add(ebm_id)

    if not processed_ids:
        print("\nNo entries were successfully processed.")
        return

    # ------------------------------------------------ write patient_edu_data.json
    output = {
        "version":   "2.0",
        "generated": today,
        "entries":   updated_entries,
    }
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\n✅ Written {len(updated_entries)} entries to {OUTPUT_FILE}")

    # -------------------------------------------- clear processed from pending
    remaining = [e for e in raw_pending if str(e.get("id", "")) not in processed_ids]
    cleared = {
        "entries": remaining,
        "_last_processed": today,
        "_comment": (
            "EBM notes pushed from the PHCEP app for AI conversion to 衛教資源. "
            "Each entry must have: id, date, content (≥4 non-empty lines). "
            "The convert-ebm-to-edu workflow processes this file and clears it after success."
        ),
    }
    with open(PENDING_FILE, "w", encoding="utf-8") as f:
        json.dump(cleared, f, ensure_ascii=False, indent=2)
    print(f"✅ Cleared {len(processed_ids)} processed entries from pending_conversions.json "
          f"({len(remaining)} remaining)")


if __name__ == "__main__":
    build()
