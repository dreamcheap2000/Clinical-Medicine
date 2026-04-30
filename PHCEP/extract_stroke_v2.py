#!/usr/bin/env python3
"""
Improved stroke guideline PDF extraction script v2.
Generates structured JSON with auto-detected titles, authors, sections.
"""

import os
import re
import json
import unicodedata
from datetime import date
from pathlib import Path

import fitz  # PyMuPDF


PDF_DIR = "/tmp/stroke_pdfs"
OUTPUT_PATH = "/home/runner/work/Clinical-Medicine/Clinical-Medicine/PHCEP/data/stroke_guidelines.json"
MAX_CONTENT_PER_SECTION = 5000  # initial limit; reduced to 2000 if file > 10MB


# ── topic detection ────────────────────────────────────────────────────────────
TOPIC_RULES = [
    (re.compile(r"血脂|dyslipidemia|lipid", re.I), "dyslipidemia"),
    (re.compile(r"血壓|blood.?pressure", re.I), "blood_pressure"),
    (re.compile(r"靜脈溶栓|靜脈.*血栓.*溶解|血栓溶解|iv.*thrombolysis|thrombolysis", re.I), "iv_thrombolysis"),
    (re.compile(r"動脈取栓|動脈.*血栓.*移除|thrombectomy|mechanical.*thrombectomy", re.I), "mechanical_thrombectomy"),
    (re.compile(r"抗血小板|antiplatelet", re.I), "antiplatelet"),
    (re.compile(r"心房纖維|心房顫動|NOAC|atrial.?fibrillation", re.I), "noac_af"),
    (re.compile(r"腦出血|intracerebral.?hemorrhage", re.I), "intracerebral_hemorrhage"),
    (re.compile(r"顱內動脈|intracranial.?atherosclerosis", re.I), "intracranial_atherosclerosis"),
    (re.compile(r"糖尿病|diabetes|glycemic", re.I), "diabetes_glycemic"),
    (re.compile(r"腎臟|CKD|chronic.?kidney", re.I), "ckd_stroke"),
    (re.compile(r"院前|prehospital", re.I), "prehospital"),
    (re.compile(r"急診|emergency", re.I), "prehospital_emergency"),
    (re.compile(r"癲癇|epilepsy", re.I), "post_stroke_epilepsy"),
    (re.compile(r"痙攣|spasticity", re.I), "post_stroke_spasticity"),
    (re.compile(r"吞嚥|dysphagia", re.I), "post_stroke_dysphagia"),
    (re.compile(r"女性|women", re.I), "women_stroke"),
    (re.compile(r"類澱粉|amyloid", re.I), "anti_amyloid_antibody"),
    (re.compile(r"帶狀.?疹|herpes.?zoster|疱疹|疫苗", re.I), "herpes_zoster_vaccine"),
    (re.compile(r"COVID", re.I), "covid19_adjustment"),
]


def detect_topic(text: str) -> str:
    for pattern, key in TOPIC_RULES:
        if pattern.search(text):
            return key
    return "general"


def has_chinese(text: str) -> bool:
    return any("\u4e00" <= c <= "\u9fff" for c in text)


def is_garbled(text: str) -> bool:
    """Detect encoding/garbled issues."""
    if not text:
        return False
    replacement_chars = text.count("\ufffd") + text.count("?")
    total = max(len(text), 1)
    return replacement_chars / total > 0.15


# ── page-level span extraction ────────────────────────────────────────────────
def get_page_spans(page):
    """Return list of (text, size, flags, bbox) sorted top-to-bottom."""
    spans = []
    blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
    for block in blocks:
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                t = span.get("text", "").strip()
                if t:
                    spans.append({
                        "text": t,
                        "size": span.get("size", 0),
                        "flags": span.get("flags", 0),
                        "bbox": span.get("bbox", (0, 0, 0, 0)),
                        "font": span.get("font", ""),
                    })
    return spans


def is_bold(span):
    return bool(span["flags"] & 2**4) or "Bold" in span.get("font", "") or "bold" in span.get("font", "")


# ── title detection ────────────────────────────────────────────────────────────
def detect_title(doc) -> str:
    """Find largest bold/big text on page 1 (Chinese preferred, English fallback)."""
    if doc.page_count == 0:
        return ""
    page = doc[0]
    spans = get_page_spans(page)

    def _extract_title_from_candidates(candidates):
        if not candidates:
            return ""
        max_size = max(s["size"] for s in candidates)
        big = [s for s in candidates if s["size"] >= max_size - 1]
        big.sort(key=lambda s: (round(s["bbox"][1] / 5), s["bbox"][0]))
        title_parts = []
        prev_y = None
        line_parts = []
        for s in big:
            y = round(s["bbox"][1] / 5)
            if prev_y is None or y == prev_y:
                line_parts.append(s["text"])
            else:
                if line_parts:
                    title_parts.append(" ".join(line_parts))
                line_parts = [s["text"]]
            prev_y = y
        if line_parts:
            title_parts.append(" ".join(line_parts))
        combined = " ".join(title_parts).strip()
        return re.sub(r"\s+", " ", combined)[:300]

    # Try Chinese first
    zh_candidates = [s for s in spans if has_chinese(s["text"]) and s["size"] >= 14]
    if not zh_candidates:
        zh_candidates = [s for s in spans if has_chinese(s["text"])]
    if zh_candidates:
        return _extract_title_from_candidates(zh_candidates)

    # Fallback: largest English text (size >= 14, not garbled)
    en_candidates = [
        s for s in spans
        if s["size"] >= 14 and s["text"].strip()
        and not is_garbled(s["text"])
        and len(s["text"].strip()) > 5
    ]
    return _extract_title_from_candidates(en_candidates)


# ── author / affiliation extraction ───────────────────────────────────────────
INSTITUTION_RE = re.compile(r"(醫院|學院|大學|診所|研究院|醫學中心|健康中心|衛生局|疾管局|醫療財團)")
SUPERSCRIPT_RE = re.compile(r"^[\d,、，;\s]+$")


def extract_authors_affiliations(doc):
    """
    Heuristic extraction from page 1 (and page 2 if needed).
    Returns (authors_list, affiliations_list, author_block_str).
    """
    authors = []
    affiliations = []
    author_block_lines = []

    pages_to_scan = [0] + ([1] if doc.page_count > 1 else [])
    all_spans = []
    for pi in pages_to_scan:
        all_spans.extend(get_page_spans(doc[pi]))

    # Find title font size to know where author region starts
    title_size = 0
    for s in all_spans:
        if has_chinese(s["text"]) and s["size"] > title_size:
            title_size = s["size"]

    # Collect medium-sized text (not title, not tiny footnotes)
    # Author names are usually 9-12pt; affiliations slightly smaller
    author_zone = []
    in_author_zone = False
    for s in all_spans:
        txt = s["text"].strip()
        if not txt:
            continue
        sz = s["size"]
        # Start author zone after the title (text smaller than title but >= 8pt)
        if sz >= title_size - 2 and has_chinese(txt) and len(txt) < 100:
            # Might still be title area; skip
            continue
        if sz >= 8 and sz < title_size - 1:
            # Check if it looks like names (Chinese chars, commas, superscripts)
            if has_chinese(txt) or INSTITUTION_RE.search(txt):
                author_zone.append(s)

    # Split into author lines vs affiliation lines
    for s in author_zone:
        txt = s["text"].strip()
        # Affiliations contain institution keywords
        if INSTITUTION_RE.search(txt):
            # Try to strip leading superscript number
            clean = re.sub(r"^[\d]+\s*", "", txt)
            if clean not in affiliations and len(clean) > 2:
                affiliations.append(clean)
            author_block_lines.append(txt)
        elif has_chinese(txt) and len(txt) < 150:
            # Could be author names – split on common separators
            # Remove superscript digits
            clean = re.sub(r"[0-9,，、；;]+", ",", txt)
            parts = [p.strip() for p in clean.split(",") if p.strip()]
            for p in parts:
                p2 = re.sub(r"\s+", "", p)
                if 1 < len(p2) <= 12 and has_chinese(p2) and p2 not in authors:
                    authors.append(p2)
            author_block_lines.append(txt)

    author_block = "; ".join(author_block_lines[:10]) if author_block_lines else ""
    return authors[:30], affiliations[:20], author_block[:500]


# ── section detection ─────────────────────────────────────────────────────────
HEADING_RE = re.compile(
    r"^("
    r"\d+\.\s|"          # 1. 
    r"\d+\.\d+\s|"       # 1.1 
    r"\d+\.\d+\.\d+\s|"  # 1.1.1
    r"第[一二三四五六七八九十百]+[章節]|"
    r"[一二三四五六七八九十]+[、.、]\s?|"
    r"[（(][一二三四五六七八九十百\d]+[）)]\s?"
    r")"
)

REF_SECTION_RE = re.compile(r"^(參考文獻|References|REFERENCES|Bibliography|文獻)", re.I)
REF_ITEM_RE = re.compile(r"^\s*(\d+)\.\s+(.+)")


def classify_heading_level(text: str, size: float, bold: bool, max_size: float) -> int:
    """Return heading level 1-3, or 0 if not a heading."""
    if not text or len(text.strip()) < 2:
        return 0
    t = text.strip()
    # Very large = h1
    if size >= max_size * 0.9 and (bold or has_chinese(t)):
        return 1
    # Medium with number pattern
    m = HEADING_RE.match(t)
    if m:
        prefix = m.group(0)
        if re.match(r"^\d+\.\d+\.\d+", prefix):
            return 3
        if re.match(r"^\d+\.\d+\s", prefix):
            return 2
        return 1
    # Bold Chinese short text
    if bold and has_chinese(t) and len(t) <= 60:
        if size >= max_size * 0.75:
            return 1
        if size >= max_size * 0.65:
            return 2
        return 3
    return 0


def extract_references(text_lines: list) -> list:
    """Parse reference list items from text lines."""
    refs = []
    current_num = None
    current_text = []
    for line in text_lines:
        m = REF_ITEM_RE.match(line)
        if m:
            if current_num is not None:
                refs.append({"num": str(current_num), "text": " ".join(current_text).strip()})
            current_num = m.group(1)
            current_text = [m.group(2).strip()]
        elif current_num is not None and line.strip():
            current_text.append(line.strip())
    if current_num is not None:
        refs.append({"num": str(current_num), "text": " ".join(current_text).strip()})
    return refs


def cite_refs_in_text(text: str) -> list:
    """Extract cited reference numbers from text like [1,2,3] or (1)(2)."""
    nums = set()
    for m in re.finditer(r"\[(\d+(?:[,;\s]\d+)*)\]|\((\d+)\)", text):
        raw = m.group(1) or m.group(2)
        for n in re.split(r"[,;\s]+", raw):
            n = n.strip()
            if n.isdigit():
                nums.add(n)
    return sorted(nums, key=lambda x: int(x))


# ── main extraction per PDF ────────────────────────────────────────────────────
def extract_pdf(pdf_path: str, gid: str, content_limit: int) -> dict:
    filename = os.path.basename(pdf_path)
    year_m = re.match(r"^(\d{4})_", filename)
    year = int(year_m.group(1)) if year_m else 0

    doc = fitz.open(pdf_path)
    total_pages = doc.page_count

    # Detect garbled from first 3 pages
    sample_text = ""
    for pi in range(min(3, total_pages)):
        sample_text += doc[pi].get_text()
    garbled = is_garbled(sample_text)

    title = detect_title(doc)
    authors, affiliations, author_block = extract_authors_affiliations(doc)

    topic = detect_topic(title)
    if topic == "general":
        topic = detect_topic(filename)
    if topic == "general" and doc.page_count > 0:
        # Fallback: scan first page full text
        page1_text = doc[0].get_text()
        topic = detect_topic(page1_text)

    # Collect all page text with span info for section detection
    # We do a two-pass: collect all spans then segment into sections
    all_page_data = []
    for pi in range(total_pages):
        page = doc[pi]
        spans = get_page_spans(page)
        all_page_data.append({"page": pi + 1, "spans": spans, "text": page.get_text()})

    # Determine max heading font size across doc (excluding title page)
    all_sizes = []
    for pd in all_page_data[1:]:
        for s in pd["spans"]:
            if s["size"] > 0 and has_chinese(s["text"]):
                all_sizes.append(s["size"])
    max_body_size = max(all_sizes, default=12)

    # ── Build flat section list ─────────────────────────────────────────────
    sections_flat = []  # list of {level, heading, page, content_lines, refs}
    current_section = None
    ref_mode = False
    ref_lines = []

    for pd in all_page_data:
        page_num = pd["page"]
        page_text_lines = pd["text"].split("\n")

        # Use span-level heading detection for accuracy
        for span in pd["spans"]:
            t = span["text"].strip()
            if not t:
                continue

            # Reference section detection
            if REF_SECTION_RE.match(t):
                ref_mode = True
                if current_section:
                    sections_flat.append(current_section)
                current_section = None
                continue

            if ref_mode:
                ref_lines.append(t)
                continue

            bold = is_bold(span)
            lvl = classify_heading_level(t, span["size"], bold, max_body_size)

            if lvl > 0 and len(t.strip()) >= 2:
                if current_section:
                    sections_flat.append(current_section)
                current_section = {
                    "level": lvl,
                    "heading": t,
                    "page": page_num,
                    "content_lines": [],
                }
            else:
                if current_section is None:
                    current_section = {
                        "level": 1,
                        "heading": "",
                        "page": page_num,
                        "content_lines": [],
                    }
                current_section["content_lines"].append(t)

    if current_section:
        sections_flat.append(current_section)

    references = extract_references(ref_lines)

    # ── Build tree structure (3 levels) ────────────────────────────────────
    def make_section_obj(flat, idx, parent_id):
        s = flat[idx]
        content = " ".join(s["content_lines"])
        # Limit content
        if len(content) > content_limit:
            content = content[:content_limit]
        refs_cited = cite_refs_in_text(content)
        sid = f"{parent_id}_{idx+1:02d}"
        return {
            "id": sid,
            "level": s["level"],
            "heading": s["heading"],
            "page": s["page"],
            "content": content.strip(),
            "refs": refs_cited,
            "subsections": [],
        }

    def build_tree(flat_sections, gid):
        tree = []
        stack = []  # (level, node)

        for i, s in enumerate(flat_sections):
            lvl = s["level"]
            content = " ".join(s["content_lines"])
            if len(content) > content_limit:
                content = content[:content_limit]
            refs_cited = cite_refs_in_text(content)

            # Generate ID
            def make_id(stack_path):
                parts = [gid]
                parts += [f"s{n:02d}" for n in stack_path]
                return "_".join(parts)

            node = {
                "heading": s["heading"],
                "level": lvl,
                "page": s["page"],
                "content": content.strip(),
                "refs": refs_cited,
                "subsections": [],
            }

            # Find parent
            while stack and stack[-1][0] >= lvl:
                stack.pop()

            if not stack:
                # Top level
                idx = len(tree) + 1
                node["id"] = f"{gid}_s{idx:02d}"
                tree.append(node)
                stack.append((lvl, node))
            else:
                parent = stack[-1][1]
                idx = len(parent["subsections"]) + 1
                node["id"] = f'{parent["id"]}_{idx:02d}'
                parent["subsections"].append(node)
                stack.append((lvl, node))

        return tree

    tree = build_tree(sections_flat, gid)

    # If no sections detected, create one big section per page
    if not tree:
        for pd in all_page_data:
            txt = pd["text"].strip()
            if txt:
                content = txt[:content_limit]
                tree.append({
                    "id": f"{gid}_s{pd['page']:02d}",
                    "level": 1,
                    "heading": f"Page {pd['page']}",
                    "page": pd["page"],
                    "content": content,
                    "refs": cite_refs_in_text(content),
                    "subsections": [],
                })

    doc.close()

    return {
        "id": gid,
        "filename": filename,
        "year": year,
        "lang": "zh" if has_chinese(title) else "en",
        "title": title,
        "title_en": "",
        "topic": topic,
        "category": title,
        "authors": authors,
        "affiliations": affiliations,
        "authorBlock": author_block,
        "pages": total_pages,
        "garbled": garbled,
        "sections": tree,
        "references": references,
    }


def count_sections(sections):
    total = 0
    for s in sections:
        total += 1
        total += count_sections(s.get("subsections", []))
    return total


def main():
    pdf_files = sorted([
        f for f in os.listdir(PDF_DIR)
        if f.endswith(".pdf") and not f.startswith("._")
    ])

    guidelines = []
    content_limit = MAX_CONTENT_PER_SECTION

    print(f"Processing {len(pdf_files)} PDFs from {PDF_DIR}...")

    for i, fname in enumerate(pdf_files):
        gid = f"g{i+1:03d}"
        fpath = os.path.join(PDF_DIR, fname)
        print(f"  [{gid}] {fname}")
        try:
            g = extract_pdf(fpath, gid, content_limit)
            guidelines.append(g)
        except Exception as e:
            print(f"    ERROR: {e}")
            guidelines.append({
                "id": gid,
                "filename": fname,
                "year": int(fname[:4]) if fname[:4].isdigit() else 0,
                "lang": "zh",
                "title": fname,
                "title_en": "",
                "topic": "general",
                "category": fname,
                "authors": [],
                "affiliations": [],
                "authorBlock": "",
                "pages": 0,
                "garbled": True,
                "sections": [],
                "references": [],
            })

    output = {
        "version": "2.0",
        "generated": str(date.today()),
        "guidelines": guidelines,
    }

    # Check size, reduce if needed
    json_str = json.dumps(output, ensure_ascii=False, indent=2)
    size_mb = len(json_str.encode("utf-8")) / (1024 * 1024)

    if size_mb > 10:
        print(f"  Output too large ({size_mb:.1f} MB), reducing content limit to 2000 chars...")
        content_limit = 2000
        # Re-extract with lower limit
        guidelines2 = []
        for i, fname in enumerate(pdf_files):
            gid = f"g{i+1:03d}"
            fpath = os.path.join(PDF_DIR, fname)
            try:
                g = extract_pdf(fpath, gid, content_limit)
                guidelines2.append(g)
            except Exception as e:
                guidelines2.append(guidelines[i] if i < len(guidelines) else {
                    "id": gid, "filename": fname, "garbled": True,
                    "sections": [], "references": []
                })
        output["guidelines"] = guidelines2
        json_str = json.dumps(output, ensure_ascii=False, indent=2)
        size_mb = len(json_str.encode("utf-8")) / (1024 * 1024)

    # Write output
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(json_str)

    # Stats
    total_sections = sum(count_sections(g["sections"]) for g in output["guidelines"])
    total_refs = sum(len(g["references"]) for g in output["guidelines"])
    print(f"\n=== Stats ===")
    print(f"Guidelines processed : {len(guidelines)}")
    print(f"Total sections       : {total_sections}")
    print(f"Total references     : {total_refs}")
    print(f"Output file size     : {size_mb:.2f} MB")
    print(f"Output path          : {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
