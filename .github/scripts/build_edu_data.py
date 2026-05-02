#!/usr/bin/env python3
"""
build_edu_data.py
-----------------
Scans the 'Patient education' folder, converts .docx files to HTML
using mammoth, and writes PHCEP/data/edu/patient_edu_data.json.

Supported file types:
  .docx  → converted to HTML with embedded base64 images
  .pdf   → stored with a direct GitHub raw URL for download
  other  → stored with a direct GitHub raw URL
"""

import json
import os
import re
import base64
import datetime
from pathlib import Path

REPO_ROOT   = Path(__file__).resolve().parents[2]
EDU_FOLDER  = REPO_ROOT / "Patient education"
OUTPUT_FILE = REPO_ROOT / "PHCEP" / "data" / "edu" / "patient_edu_data.json"

# GitHub raw URL base – files are accessed from the deployed Pages site via
# relative paths, but for PDF/other types we provide the raw GitHub URL.
GITHUB_RAW_BASE = (
    "https://raw.githubusercontent.com/dreamcheap2000/Clinical-Medicine/main/"
    "Patient%20education/"
)


def docx_to_html(docx_path: Path) -> tuple[str, list[dict]]:
    """Convert a .docx file to HTML using mammoth.
    Returns (html_string, images_list).
    Images in the list have the form {"data": "base64...", "mediaType": "image/png"}.
    """
    try:
        import mammoth
    except ImportError as exc:
        raise ImportError(
            "mammoth is required to convert .docx files. "
            "Install it with: pip install mammoth"
        ) from exc

    images = []

    def convert_image(image):
        with image.open() as img_f:
            raw = img_f.read()
        b64 = base64.b64encode(raw).decode("utf-8")
        images.append({"data": b64, "mediaType": image.content_type})
        return {"src": f"data:{image.content_type};base64,{b64}"}

    style_map = """
p[style-name='Heading 1'] => h2:fresh
p[style-name='Heading 2'] => h3:fresh
p[style-name='Heading 3'] => h4:fresh
"""
    result = mammoth.convert_to_html(
        docx_path,
        convert_image=mammoth.images.img_element(convert_image),
        style_map=style_map,
    )
    return result.value, images


def sanitize_id(filename: str, idx: int) -> str:
    """Generate a stable ID from filename."""
    stem = Path(filename).stem
    stem_ascii = re.sub(r"[^a-zA-Z0-9_\-]", "_", stem)[:30]
    return f"edu{idx+1:03d}_{stem_ascii}" if stem_ascii else f"edu{idx+1:03d}"


def build():
    if not EDU_FOLDER.exists():
        print(f"ERROR: Folder not found: {EDU_FOLDER}")
        return

    files_data = []
    supported = [".docx", ".pdf"]
    file_list = sorted(
        f for f in EDU_FOLDER.iterdir()
        if f.is_file() and not f.name.startswith(".")
    )

    for idx, fpath in enumerate(file_list):
        suffix = fpath.suffix.lower()
        filename = fpath.name
        title = fpath.stem  # Use filename stem as display title

        print(f"Processing [{suffix}]: {filename}")

        if suffix == ".docx":
            html_content, images = docx_to_html(fpath)
            entry = {
                "id": sanitize_id(filename, idx),
                "filename": filename,
                "title": title,
                "type": "docx",
                "htmlContent": html_content,
                "images": images,
            }
        elif suffix == ".pdf":
            raw_url = GITHUB_RAW_BASE + filename.replace(" ", "%20")
            entry = {
                "id": sanitize_id(filename, idx),
                "filename": filename,
                "title": title,
                "type": "pdf",
                "htmlContent": (
                    f'<p>📄 點擊下方按鈕開啟 PDF 文件：<br>'
                    f'<a href="{raw_url}" target="_blank" rel="noopener" '
                    f'style="display:inline-block;margin-top:8px;padding:8px 16px;'
                    f'background:#1a73e8;color:#fff;border-radius:6px;text-decoration:none">'
                    f'🔗 開啟 {filename}</a></p>'
                ),
                "images": [],
                "pdfUrl": raw_url,
            }
        else:
            raw_url = GITHUB_RAW_BASE + filename.replace(" ", "%20")
            entry = {
                "id": sanitize_id(filename, idx),
                "filename": filename,
                "title": title,
                "type": suffix.lstrip(".") or "file",
                "htmlContent": (
                    f'<p>📎 <a href="{raw_url}" target="_blank" rel="noopener">'
                    f'下載 {filename}</a></p>'
                ),
                "images": [],
            }

        files_data.append(entry)

    output = {
        "version": "1.0",
        "generated": datetime.date.today().isoformat(),
        "files": files_data,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Written {len(files_data)} file(s) to {OUTPUT_FILE}")


if __name__ == "__main__":
    build()
