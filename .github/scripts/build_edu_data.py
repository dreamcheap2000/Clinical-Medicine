#!/usr/bin/env python3
"""
build_edu_data.py
-----------------
Scans the 'Patient education' folder, converts .docx files to HTML
using mammoth, and writes PHCEP/data/edu/patient_edu_data.json
using the v2.0 schema (with FastSR SOAP sections and multi-language versions).

When OPENAI_API_KEY is set (e.g., via GitHub Actions secret), the script calls
the OpenAI API to:
  - Translate professional content into the other 2 language versions
  - Extract source URL(s) from the text
  - Auto-generate FastSR S/O/A/P classification

Existing manually-crafted entries (those NOT matching any file in the folder)
are preserved unchanged.

Supported file types:
  .docx  → converted to HTML with mammoth
  .txt   → plain text, wrapped in <p> tags
  other  → stored with a direct GitHub raw URL
"""

import json
import os
import re
import datetime
from pathlib import Path

REPO_ROOT   = Path(__file__).resolve().parents[2]
EDU_FOLDER  = REPO_ROOT / "Patient education"
OUTPUT_FILE = REPO_ROOT / "PHCEP" / "data" / "edu" / "patient_edu_data.json"

GITHUB_RAW_BASE = (
    "https://raw.githubusercontent.com/dreamcheap2000/Clinical-Medicine/main/"
    "Patient%20education/"
)


def docx_to_html(docx_path: Path) -> tuple[str, str]:
    """Convert a .docx file to HTML using mammoth.
    Returns (html_string, plain_text).
    """
    try:
        import mammoth
    except ImportError as exc:
        raise ImportError(
            "mammoth is required. Install with: pip install mammoth"
        ) from exc

    style_map = """
p[style-name='Heading 1'] => h2:fresh
p[style-name='Heading 2'] => h3:fresh
p[style-name='Heading 3'] => h4:fresh
"""
    result = mammoth.convert_to_html(docx_path, style_map=style_map)
    # Also extract raw text for FastSR classification and language detection
    text_result = mammoth.extract_raw_text(docx_path)
    return result.value, text_result.value


def txt_to_html(txt_path: Path) -> tuple[str, str]:
    """Read a plain text file and wrap paragraphs in <p> tags."""
    raw = txt_path.read_text(encoding="utf-8", errors="replace")
    paragraphs = [p.strip() for p in raw.split("\n\n") if p.strip()]
    html = "".join(f"<p>{p.replace(chr(10), '<br>')}</p>" for p in paragraphs)
    return html, raw


def strip_leading_title_para(html: str, stem: str) -> str:
    """Remove any leading <p>/<h1>/<h2> that is an exact duplicate of the document title/stem.

    Docx files often include the document title as the first heading/paragraph, which
    duplicates the ``title`` field shown in the viewer header.  This function strips that
    redundant first element so it does not appear in the rendered content.
    """
    stripped = stem.strip()
    if not stripped or not html:
        return html
    # Match a leading block-level tag whose text content equals the stem exactly.
    pattern = re.compile(
        r'^\s*<(p|h1|h2|h3)(?:\s[^>]*)?>\s*'
        + re.escape(stripped)
        + r'\s*</\1>\s*',
        re.IGNORECASE,
    )
    return pattern.sub("", html).strip()


def sanitize_id(filename: str, idx: int) -> str:
    stem = Path(filename).stem
    stem_ascii = re.sub(r"[^a-zA-Z0-9_\-]", "_", stem)[:30]
    return f"edu{idx+1:03d}" if not stem_ascii else f"edu{idx+1:03d}_{stem_ascii}"


def load_existing() -> dict:
    """Load existing patient_edu_data.json; return empty v2 dict on failure."""
    if OUTPUT_FILE.exists():
        try:
            return json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"version": "2.0", "generated": "", "entries": []}


SIDECAR_SUFFIX = ".meta.json"


def load_sidecar(fpath: Path) -> dict:
    """Load an optional sidecar <filename>.meta.json file next to the document.

    The sidecar may contain:
      source_urls  – list of URLs (merged with any URLs found in the document)
      title        – override title string
      tags         – list of tag strings
      notes        – freeform notes (ignored by the pipeline)

    Returns an empty dict if no sidecar exists or parsing fails.
    """
    sidecar = fpath.with_name(fpath.name + SIDECAR_SUFFIX)
    if not sidecar.exists():
        return {}
    try:
        return json.loads(sidecar.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"  ⚠️ Could not read sidecar {sidecar.name}: {exc}")
        return {}


def _needs_ai(versions: dict) -> bool:
    """Return True if any language version is missing or incomplete."""
    return not (
        versions.get("simple_zh", "").strip()
        and versions.get("professional_zh", "").strip()
        and versions.get("english", "").strip()
    )


def build():
    if not EDU_FOLDER.exists():
        print(f"ERROR: Folder not found: {EDU_FOLDER}")
        return

    # Import translation helper
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    from translate_edu import process_document

    existing_data = load_existing()
    existing_entries = existing_data.get("entries") or []

    # Build a lookup: title → existing entry (for preservation)
    existing_by_title = {e.get("title", ""): e for e in existing_entries}
    # Build a lookup: filename stem → existing entry (for update matching)
    existing_by_stem: dict[str, dict] = {}
    for e in existing_entries:
        src = e.get("source_file", "")
        if src:
            existing_by_stem[Path(src).stem] = e

    file_list = sorted(
        f for f in EDU_FOLDER.iterdir()
        if f.is_file() and not f.name.startswith(".")
    )

    new_entries: list[dict] = []
    processed_titles: set[str] = set()

    for idx, fpath in enumerate(file_list):
        suffix = fpath.suffix.lower()
        filename = fpath.name
        stem = fpath.stem

        # Skip sidecar metadata files — they are helpers, not documents
        if filename.endswith(SIDECAR_SUFFIX):
            continue

        print(f"Processing [{suffix}]: {filename}")

        if suffix == ".docx":
            html_content, plain_text = docx_to_html(fpath)
            # Strip redundant leading title paragraph (docx often includes it as first element)
            html_content = strip_leading_title_para(html_content, stem)
        elif suffix == ".txt":
            html_content, plain_text = txt_to_html(fpath)
            html_content = strip_leading_title_para(html_content, stem)
        else:
            raw_url = GITHUB_RAW_BASE + filename.replace(" ", "%20")
            entry = {
                "id": sanitize_id(filename, idx),
                "title": stem,
                "source_file": filename,
                "source_url": raw_url,
                "source_label": "",
                "source_urls": [raw_url],
                "original_lang": "zh-TW",
                "added_date": datetime.date.today().isoformat(),
                "tags": [],
                "fastsr": {"S": [], "O": [], "A": [], "P": []},
                "versions": {
                    "simple_zh": (
                        f'<p>📎 <a href="{raw_url}" target="_blank" rel="noopener">'
                        f'下載 {filename}</a></p>'
                    ),
                    "professional_zh": "",
                    "english": "",
                },
            }
            new_entries.append(entry)
            processed_titles.add(stem)
            continue

        # Load optional sidecar metadata
        sidecar = load_sidecar(fpath)
        extra_urls: list[str] = sidecar.get("source_urls", [])
        title_override: str = sidecar.get("title", "")
        extra_tags: list[str] = sidecar.get("tags", [])

        # Check if this file was already processed.
        # existing_by_stem uses the source_file stem as key.
        # existing_by_title uses entry title; for docx-generated entries the
        # title was historically set to the filename stem, so this also matches.
        existing_entry = existing_by_stem.get(stem) or existing_by_title.get(stem)
        existing_title = title_override or (existing_entry.get("title") if existing_entry else None)
        existing_versions = (existing_entry or {}).get("versions") or {}

        needs_ai = _needs_ai(existing_versions) or bool(extra_urls)
        if not needs_ai:
            print(f"  ✔ All versions present and no new URLs — skipping AI")

        # Process via AI translation (passing existing versions as fallback)
        doc_info = process_document(
            plain_text,
            html_content,
            stem,
            existing_title=existing_title,
            extra_urls=extra_urls,
            existing_versions=existing_versions,
            existing_fastsr=(existing_entry or {}).get("fastsr"),
        )

        # Determine entry id
        entry_id = (existing_entry or {}).get("id") or sanitize_id(filename, idx)

        # Merge tags: existing + sidecar (deduplicated)
        merged_tags = list(dict.fromkeys(
            ((existing_entry or {}).get("tags") or []) + extra_tags
        ))

        # Merge: keep existing tags / added_date if available
        entry = {
            "id": entry_id,
            "title": doc_info["title"],
            "source_file": filename,
            "source_url": doc_info["source_url"],
            "source_label": doc_info["source_label"],
            "source_urls": doc_info.get("source_urls", []),
            "original_lang": "zh-TW" if doc_info["versions"]["professional_zh"] else "en",
            "added_date": (existing_entry or {}).get("added_date") or datetime.date.today().isoformat(),
            "tags": merged_tags,
            "fastsr": doc_info["fastsr"],
            "prototype": doc_info.get("prototype", {}),
            "versions": doc_info["versions"],
        }
        new_entries.append(entry)
        processed_titles.add(doc_info["title"])
        if existing_title:
            processed_titles.add(existing_title)

    # Preserve existing manually-crafted entries not matched by any file
    for e in existing_entries:
        title = e.get("title", "")
        source_file = e.get("source_file", "")
        if title not in processed_titles and not source_file:
            # This is a manually-crafted entry with no source file → keep it
            new_entries.append(e)
            print(f"Preserving manual entry: {title}")

    output = {
        "version": "2.0",
        "generated": datetime.date.today().isoformat(),
        "entries": new_entries,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Written {len(new_entries)} entries to {OUTPUT_FILE}")


if __name__ == "__main__":
    build()

