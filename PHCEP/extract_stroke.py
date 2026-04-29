#!/usr/bin/env python3
"""
Extract structured content from stroke guideline PDFs and output JSON.
"""

import fitz  # pymupdf
import json
import os
import re
from datetime import date

PDF_DIR = "/tmp/stroke_pdfs/"
OUTPUT_JSON = "/home/runner/work/Clinical-Medicine/Clinical-Medicine/PHCEP/data/stroke_guidelines.json"
MAX_JSON_BYTES = 5 * 1024 * 1024  # 5MB
CONTENT_TRUNCATE = 500

# ---------------------------------------------------------------------------
# Metadata catalogue
# ---------------------------------------------------------------------------
CATALOGUE = [
    {
        "filename": "2020_2.V2(2)-85-107.pdf",
        "year": 2020,
        "lang": "zh",
        "title": "2020台灣腦中風學會腦血管疾病血脂異常治療指引",
        "title_en": "2020 Taiwan Stroke Society Guidelines for Dyslipidemia Management in Cerebrovascular Disease",
        "topic": "dyslipidemia",
        "superseded_by": None,
    },
    {
        "filename": "2020_2.V2(3)-169-205.pdf",
        "year": 2020,
        "lang": "zh",
        "title": "2020台灣腦中風學會缺血性腦中風相關之血壓控制指引",
        "title_en": "",
        "topic": "blood_pressure",
        "superseded_by": None,
    },
    {
        "filename": "2020_2020GuidelineForPrehospitalManagement.pdf",
        "year": 2020,
        "lang": "en",
        "title": "",
        "title_en": "2020 Guideline for Prehospital Management of Stroke",
        "topic": "prehospital",
        "superseded_by": None,
    },
    {
        "filename": "2020_2020台灣腦中風學會非心因性缺血性腦中風抗血小板藥物治療指引.pdf",
        "year": 2020,
        "lang": "zh",
        "title": "2020台灣腦中風學會非心因性缺血性腦中風抗血小板藥物治療指引",
        "title_en": "",
        "topic": "antiplatelet",
        "superseded_by": "2022_2.V4(2)-53-60--20240227.pdf",
    },
    {
        "filename": "2020_485447586-2-V2-4-257-275.pdf",
        "year": 2020,
        "lang": "zh",
        "title": "急性缺血中風病人的院前緊急處置與急診診斷治療指引",
        "title_en": "",
        "topic": "prehospital_emergency",
        "superseded_by": None,
    },
    {
        "filename": "2020_台灣腦中風學會針對急性中風流程因應COVID-19疫情調整之建議.pdf",
        "year": 2020,
        "lang": "zh",
        "title": "台灣腦中風學會針對急性中風流程因應COVID-19疫情調整之建議",
        "title_en": "",
        "topic": "covid19_adjustment",
        "superseded_by": None,
    },
    {
        "filename": "2021_2021年台灣腦中風學會與台灣癲癇醫學會之中風後癲癇治療指引.pdf",
        "year": 2021,
        "lang": "zh",
        "title": "2021年台灣腦中風學會與台灣癲癇醫學會之中風後癲癇治療指引",
        "title_en": "",
        "topic": "post_stroke_epilepsy",
        "superseded_by": None,
    },
    {
        "filename": "2021_3.V3(1)-1-27.pdf",
        "year": 2021,
        "lang": "zh",
        "title": "台灣腦中風學會之腦中風後痙攣治療指引",
        "title_en": "",
        "topic": "post_stroke_spasticity",
        "superseded_by": None,
    },
    {
        "filename": "2022_2.V4(2)-53-60--20240227.pdf",
        "year": 2022,
        "lang": "zh",
        "title": "2022抗血小板藥物治療更新指引",
        "title_en": "",
        "topic": "antiplatelet",
        "superseded_by": None,
    },
    {
        "filename": "2022_2.V4(3)-111-142.pdf",
        "year": 2022,
        "lang": "zh",
        "title": "顱內動脈粥狀硬化疾病處置指引",
        "title_en": "",
        "topic": "intracranial_atherosclerosis",
        "superseded_by": None,
    },
    {
        "filename": "2022_2.V4(4)-173-206.pdf",
        "year": 2022,
        "lang": "zh",
        "title": "腦血管疾病糖尿病及血糖治療指引",
        "title_en": "",
        "topic": "diabetes_glycemic",
        "superseded_by": None,
    },
    {
        "filename": "2022_2021TaiwanStrokeSocietyGuidelines.pdf",
        "year": 2022,
        "lang": "en",
        "title": "",
        "title_en": "2021 Taiwan Stroke Society Guidelines for Blood Pressure Control in Ischemic Stroke",
        "topic": "blood_pressure",
        "superseded_by": None,
    },
    {
        "filename": "2022_2022focusedUpdateOfThe2017Taiwan.pdf",
        "year": 2022,
        "lang": "en",
        "title": "",
        "title_en": "2022 Focused Update of the 2017 Taiwan Stroke Society Guidelines",
        "topic": "focused_update_2017",
        "superseded_by": None,
    },
    {
        "filename": "2022_3.V4(2)-61-75.pdf",
        "year": 2022,
        "lang": "en",
        "title": "",
        "title_en": "Dual Antiplatelet Therapy for Non-Cardioembolic Ischemic Stroke",
        "topic": "antiplatelet",
        "superseded_by": "2022_2.V4(2)-53-60--20240227.pdf",
    },
    {
        "filename": "2022_The2020TaiwanStrokeSocietyGuidelines.pdf",
        "year": 2022,
        "lang": "en",
        "title": "",
        "title_en": "The 2020 Taiwan Stroke Society Guidelines",
        "topic": "general_2020",
        "superseded_by": None,
    },
    {
        "filename": "2023_2.V5(2)-93-132.pdf",
        "year": 2023,
        "lang": "zh",
        "title": "台灣腦中風學會女性腦中風實證聲明",
        "title_en": "",
        "topic": "women_stroke",
        "superseded_by": None,
    },
    {
        "filename": "2023_678796165-2-V5-3-151-172.pdf",
        "year": 2023,
        "lang": "zh",
        "title": "急性缺血中風動脈內血栓移除治療指引更新",
        "title_en": "",
        "topic": "mechanical_thrombectomy",
        "superseded_by": None,
    },
    {
        "filename": "2023_682711909-2-V5-4-259-306.pdf",
        "year": 2023,
        "lang": "zh",
        "title": "台灣腦中風學會自發性腦出血處置指引",
        "title_en": "",
        "topic": "intracerebral_hemorrhage",
        "superseded_by": None,
    },
    {
        "filename": "2024_2.V6(1)-1-65.pdf",
        "year": 2024,
        "lang": "zh",
        "title": "非維他命K拮抗劑口服抗凝血劑用於心房纖維顫動病人腦中風預防治療指引更新",
        "title_en": "",
        "topic": "noac_af",
        "superseded_by": None,
    },
    {
        "filename": "2024_2.V6(3)-171-218.pdf",
        "year": 2024,
        "lang": "zh",
        "title": "台灣腦中風學會及台灣腎臟醫學會慢性腎臟病患者腦中風治療指引",
        "title_en": "",
        "topic": "ckd_stroke",
        "superseded_by": None,
    },
    {
        "filename": "2024_755407498-2-V6-2-103-140.pdf",
        "year": 2024,
        "lang": "zh",
        "title": "台灣腦中風學會之腦中風後吞嚥障礙照護指引",
        "title_en": "",
        "topic": "post_stroke_dysphagia",
        "superseded_by": None,
    },
    {
        "filename": "2025_2.V7(1)-1-57.pdf",
        "year": 2025,
        "lang": "zh",
        "title": "急性缺血性腦中風靜脈血栓溶解治療指引更新",
        "title_en": "",
        "topic": "iv_thrombolysis",
        "superseded_by": None,
    },
    {
        "filename": "2025_2.V7(2)-83-98.pdf",
        "year": 2025,
        "lang": "zh",
        "title": "台灣腦中風學會及台灣臨床失智症學會共識聲明：抗類澱粉蛋白抗體治療",
        "title_en": "",
        "topic": "anti_amyloid_antibody",
        "superseded_by": None,
    },
    {
        "filename": "2026_guideline_01.pdf",
        "year": 2026,
        "lang": "zh",
        "title": "腦血管高風險與腦血管疾病成人之帶狀疹疫苗指引",
        "title_en": "",
        "topic": "herpes_zoster_vaccine",
        "superseded_by": None,
    },
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def is_bold(flags: int, font_name: str) -> bool:
    if flags & 16:
        return True
    bold_fonts = {"DFYuan-Bd", "DFKaiShu-SB", "NotoSansCJKtc-Bold", "NotoSerifCJKtc-Bold"}
    for bf in bold_fonts:
        if bf.lower() in font_name.lower():
            return True
    # heuristic: font name contains "Bold", "BD", "-B"
    return bool(re.search(r'[Bb]old|[Bb][Dd]|-[Bb]\b', font_name))


def classify_span(span) -> str:
    """Return 'title', 'h1', 'h2', 'ref_inline', 'footnote', or 'text'."""
    size = span.get("size", 10)
    flags = span.get("flags", 0)
    font = span.get("font", "")
    bold = is_bold(flags, font)
    text = span.get("text", "").strip()

    # Superscript / inline reference
    if size < 8:
        return "ref_inline"
    # Footnote-sized at bottom of page (heuristic: size < 9)
    if size < 9:
        return "footnote"
    # Main title
    if size >= 18 and bold:
        return "title"
    # Section heading
    if (size >= 14 and bold) or re.match(r'^\d+[\.\、]', text):
        return "h1"
    # Subsection heading
    if size >= 12 and bold:
        return "h2"
    return "text"


def is_reference_heading(text: str) -> bool:
    t = text.strip()
    return bool(re.match(r'^(References|參考文獻|Reference)', t, re.IGNORECASE))


def looks_garbled(text: str) -> bool:
    """Detect if text has many replacement/garbled chars."""
    if not text:
        return False
    bad = sum(1 for c in text if ord(c) in (65533, 0xFFFD) or (0xE000 <= ord(c) <= 0xF8FF))
    return bad > len(text) * 0.05


def clean_text(t: str) -> str:
    return re.sub(r'\s+', ' ', t).strip()


# ---------------------------------------------------------------------------
# Main extraction
# ---------------------------------------------------------------------------

def extract_pdf(filepath: str, meta: dict) -> dict:
    """Extract structured content from a single PDF."""
    result = dict(meta)
    result["garbled"] = False
    result["sections"] = []
    result["references"] = []

    try:
        doc = fitz.open(filepath)
    except Exception as e:
        result["error"] = str(e)
        return result

    result["pages"] = doc.page_count

    all_blocks = []  # list of (page_num, block_type, text, size, bold)

    for page_num, page in enumerate(doc, start=1):
        try:
            blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
        except Exception:
            continue

        page_height = page.rect.height

        for block in blocks:
            if block.get("type") != 0:  # text block
                continue
            for line in block.get("lines", []):
                line_text = ""
                line_type = "text"
                line_size = 10.0
                line_bold = False
                at_bottom = False

                for span in line.get("spans", []):
                    t = span.get("text", "")
                    if not t.strip():
                        continue
                    size = span.get("size", 10)
                    flags = span.get("flags", 0)
                    font = span.get("font", "")
                    bold = is_bold(flags, font)
                    origin_y = span.get("origin", (0, 0))[1]

                    # Check if bottom footnote area (bottom 10% of page)
                    if origin_y > page_height * 0.90:
                        at_bottom = True

                    line_text += t
                    if size > line_size:
                        line_size = size
                        line_bold = bold

                line_text = clean_text(line_text)
                if not line_text:
                    continue

                if at_bottom and line_size < 9:
                    span_type = "footnote"
                else:
                    # Build fake span dict for classify
                    fake_span = {
                        "size": line_size,
                        "flags": 16 if line_bold else 0,
                        "font": "",
                        "text": line_text,
                    }
                    span_type = classify_span(fake_span)

                if looks_garbled(line_text):
                    result["garbled"] = True

                all_blocks.append({
                    "page": page_num,
                    "type": span_type,
                    "text": line_text,
                    "size": line_size,
                    "bold": line_bold,
                })

    doc.close()

    # ------------------------------------------------------------------
    # Build sections tree
    # ------------------------------------------------------------------
    in_references = False
    ref_texts = []
    sections = []
    current_section = None
    current_subsection = None
    section_counter = 0
    subsection_counter = 0

    def flush_section():
        if current_section:
            if current_subsection:
                current_section["subsections"].append(current_subsection)
            sections.append(current_section)

    guideline_id = result.get("id", "g000")

    for blk in all_blocks:
        t = blk["text"]
        btype = blk["type"]
        page = blk["page"]

        if is_reference_heading(t):
            in_references = True
            flush_section()
            current_section = None
            current_subsection = None
            continue

        if in_references:
            # Collect reference lines
            ref_texts.append(t)
            continue

        if btype in ("title",):
            # Title blocks already known from catalogue; skip as section
            continue

        if btype == "h1":
            flush_section()
            current_subsection = None
            section_counter += 1
            subsection_counter = 0
            current_section = {
                "id": f"{guideline_id}_s{section_counter:02d}",
                "level": 1,
                "heading": t,
                "page": page,
                "content": "",
                "refs": [],
                "subsections": [],
            }
            continue

        if btype == "h2":
            if current_section:
                if current_subsection:
                    current_section["subsections"].append(current_subsection)
                subsection_counter += 1
                current_subsection = {
                    "id": f"{guideline_id}_s{section_counter:02d}_{subsection_counter:02d}",
                    "level": 2,
                    "heading": t,
                    "page": page,
                    "content": "",
                    "refs": [],
                }
            continue

        if btype == "ref_inline":
            # Inline citation numbers
            nums = re.findall(r'\d+', t)
            target = current_subsection if current_subsection else current_section
            if target:
                target["refs"].extend(nums)
            continue

        if btype in ("text", "footnote"):
            target = current_subsection if current_subsection else current_section
            if target:
                target["content"] = (target["content"] + " " + t).strip()
            continue

    flush_section()

    # Parse references
    references = []
    current_ref_num = None
    current_ref_text = ""
    for line in ref_texts:
        m = re.match(r'^(\d+)[.\)]\s*(.*)', line)
        if m:
            if current_ref_num is not None:
                references.append({"num": current_ref_num, "text": clean_text(current_ref_text)})
            current_ref_num = m.group(1)
            current_ref_text = m.group(2)
        else:
            current_ref_text += " " + line
    if current_ref_num is not None:
        references.append({"num": current_ref_num, "text": clean_text(current_ref_text)})

    result["sections"] = sections
    result["references"] = references
    return result


# ---------------------------------------------------------------------------
# Truncate content to stay under 5MB
# ---------------------------------------------------------------------------

def truncate_sections(sections, limit=CONTENT_TRUNCATE):
    for s in sections:
        if len(s.get("content", "")) > limit:
            s["content"] = s["content"][:limit] + "…"
        truncate_sections(s.get("subsections", []), limit)


def truncate_references(refs, max_refs=50, max_text=200):
    out = refs[:max_refs]
    for r in out:
        if len(r.get("text", "")) > max_text:
            r["text"] = r["text"][:max_text] + "…"
    return out


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    guidelines = []
    for idx, meta in enumerate(CATALOGUE, start=1):
        gid = f"g{idx:03d}"
        meta = dict(meta)
        meta["id"] = gid
        filepath = os.path.join(PDF_DIR, meta["filename"])

        if not os.path.exists(filepath):
            print(f"  [SKIP] {meta['filename']} not found")
            meta["sections"] = []
            meta["references"] = []
            meta["pages"] = 0
            meta["garbled"] = False
            guidelines.append(meta)
            continue

        print(f"  [{idx:02d}] Extracting {meta['filename']}...")
        entry = extract_pdf(filepath, meta)
        # Truncate content
        truncate_sections(entry.get("sections", []))
        entry["references"] = truncate_references(entry.get("references", []))
        guidelines.append(entry)
        garbled_note = " [GARBLED]" if entry.get("garbled") else ""
        superseded_note = f" [SUPERSEDED by {entry.get('superseded_by')}]" if entry.get("superseded_by") else ""
        print(f"       pages={entry.get('pages',0)}  sections={len(entry.get('sections',[]))}  refs={len(entry.get('references',[]))}{garbled_note}{superseded_note}")

    output = {
        "version": "1.0",
        "generated": str(date.today()),
        "guidelines": guidelines,
    }

    json_str = json.dumps(output, ensure_ascii=False, indent=2)
    size_mb = len(json_str.encode("utf-8")) / 1024 / 1024
    print(f"\nJSON size: {size_mb:.2f} MB")

    # If still too large, reduce content limit further
    if size_mb > 5:
        print("  Too large, re-truncating to 200 chars…")
        for g in guidelines:
            truncate_sections(g.get("sections", []), limit=200)
        json_str = json.dumps(output, ensure_ascii=False, indent=2)
        size_mb = len(json_str.encode("utf-8")) / 1024 / 1024
        print(f"  New size: {size_mb:.2f} MB")

    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        f.write(json_str)
    print(f"Saved → {OUTPUT_JSON}")


if __name__ == "__main__":
    main()
