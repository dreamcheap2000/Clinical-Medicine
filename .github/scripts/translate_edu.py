#!/usr/bin/env python3
"""
translate_edu.py
----------------
Helper module for AI-powered translation and FastSR classification of
patient education content.

Uses the GitHub Models API (https://models.inference.ai.azure.com) so no
external secrets are needed — only the built-in GITHUB_TOKEN from Actions.

Requires: openai>=1.0.0  (pip install openai)
Auth:     GITHUB_TOKEN environment variable (automatically provided in Actions)
"""

from __future__ import annotations

import json
import os
import re
from typing import Optional


# ---------------------------------------------------------------------------
# GitHub Models client (uses GITHUB_TOKEN — no external secret needed)
# ---------------------------------------------------------------------------
GITHUB_MODELS_BASE_URL = "https://models.inference.ai.azure.com"
GITHUB_MODELS_DEFAULT  = "gpt-4o-mini"

try:
    from openai import OpenAI
    _openai_available = True
except ImportError:
    _openai_available = False


def _get_client() -> Optional["OpenAI"]:
    """Return an OpenAI-compatible client pointed at GitHub Models.

    Falls back gracefully to None when:
    - openai package is not installed, or
    - GITHUB_TOKEN is not set (e.g., local dev without env var)
    """
    if not _openai_available:
        return None
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        return None
    return OpenAI(
        base_url=GITHUB_MODELS_BASE_URL,
        api_key=token,
    )


def _chat(client: "OpenAI", system: str, user: str, model: str = GITHUB_MODELS_DEFAULT) -> str:
    """Call GitHub Models chat completion; return response text."""
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.3,
    )
    return resp.choices[0].message.content.strip()


# ---------------------------------------------------------------------------
# Language detection
# ---------------------------------------------------------------------------
def detect_language(text: str) -> str:
    """Return 'zh' for predominantly Chinese text, 'en' otherwise."""
    chinese_chars = sum(1 for c in text if "\u4e00" <= c <= "\u9fff")
    return "zh" if chinese_chars / max(len(text), 1) > 0.1 else "en"


# ---------------------------------------------------------------------------
# URL extraction
# ---------------------------------------------------------------------------
URL_RE = re.compile(
    r"https?://[^\s\)\]\>\"\'\u3002\uff0c\u300d]+",
    re.IGNORECASE,
)


def extract_urls(text: str) -> list[str]:
    """Extract all URLs from text."""
    return list(dict.fromkeys(URL_RE.findall(text)))


# ---------------------------------------------------------------------------
# FastSR keyword tables (mirrors FASTSR_KEYWORDS in app.js)
# ---------------------------------------------------------------------------

FASTSR_KW = {
    "S": {
        "zh": ["症狀", "主訴", "感覺", "疼痛", "患者", "病人", "病史", "不適", "適應症",
               "適合", "對象", "若您", "如果您", "主要症狀", "症", "痛", "癢", "腫",
               "酸痛", "疼", "受傷", "扭傷", "撕裂", "拉傷"],
        "en": ["symptom", "complaint", "feel", "pain", "discomfort", "history",
               "indication", "candidate", "suffer", "report", "complain",
               "strain", "sprain", "fracture", "injury"],
    },
    "O": {
        "zh": ["檢查", "測量", "理學", "發現", "超音波", "MRI", "X光", "CT", "核磁共振",
               "數值", "角度", "活動度", "壓痛", "徵候", "陽性", "陰性", "統計", "結果"],
        "en": ["examination", "finding", "sign", "measure", "ultrasound", "MRI",
               "CT", "x-ray", "range of motion", "test", "positive", "negative",
               "rate", "percent", "cases", "study", "result", "data", "outcome"],
    },
    "A": {
        "zh": ["診斷", "評估", "考慮", "鑑別", "分析", "因此", "代表", "判斷", "機轉",
               "病理", "原因", "懷疑", "相關", "合併", "病症", "疾病", "損傷", "炎症"],
        "en": ["diagnosis", "assessment", "consider", "likely", "differential",
               "mechanism", "pathology", "cause", "condition", "disorder",
               "disease", "syndrome", "injury", "torn", "rupture"],
    },
    "P": {
        "zh": ["治療", "建議", "藥物", "手術", "復健", "計畫", "管理", "處置", "注射",
               "物理治療", "護理", "康復", "預防", "衛教", "步驟", "方法", "技術",
               "原則", "注意", "禁忌", "避免"],
        "en": ["treatment", "recommend", "plan", "therapy", "surgery",
               "medication", "rehabilitation", "management", "inject",
               "physical therapy", "exercise", "rest", "follow", "care",
               "prescribe", "protocol", "step", "procedure", "avoid"],
    },
}



# Minimum keyword length to receive a higher match weight
KEYWORD_LENGTH_THRESHOLD = 3
MAX_EBM_NOTE_PROMPT_CHARS = 4000


def classify_sentence(sentence: str) -> str:
    lower = sentence.lower()
    scores: dict[str, int] = {"S": 0, "O": 0, "A": 0, "P": 0}
    for cat, kws in FASTSR_KW.items():
        for kw in kws["zh"] + kws["en"]:
            if kw.lower() in lower:
                scores[cat] += 2 if len(kw) > KEYWORD_LENGTH_THRESHOLD else 1
    best = max(scores, key=lambda k: scores[k])
    return best if scores[best] > 0 else "S"


def build_fastsr(text: str) -> dict[str, list[str]]:
    """Classify sentences from plain text into S/O/A/P buckets."""
    # Split into sentences
    raw = re.sub(r"([。！？.!?])\s*", r"\1\n", text)
    sentences = [s.strip() for s in raw.splitlines() if len(s.strip()) > 3]
    result: dict[str, list[str]] = {"S": [], "O": [], "A": [], "P": []}
    for sent in sentences:
        result[classify_sentence(sent)].append(sent)
    return result


def _fastsr_needs_ai(fastsr: dict) -> bool:
    """Return True when the existing FastSR data looks poor quality.

    Heuristics:
    - Any section (O or A) is empty → classification was too coarse
    - S section holds >#FASTSR_S_RATIO_THRESHOLD of all sentences when total > #FASTSR_MIN_SENTENCES
    """
    # Quality thresholds
    FASTSR_S_RATIO_THRESHOLD = 0.8   # S-section dominance ratio above which quality is poor
    FASTSR_MIN_SENTENCES     = 5     # minimum total sentences before ratio check applies

    s = fastsr.get("S", [])
    o = fastsr.get("O", [])
    a = fastsr.get("A", [])
    p = fastsr.get("P", [])
    total = len(s) + len(o) + len(a) + len(p)
    if total == 0:
        return True
    if not o and not a:
        return True
    if len(s) > FASTSR_S_RATIO_THRESHOLD * total and total > FASTSR_MIN_SENTENCES:
        return True
    return False


# ---------------------------------------------------------------------------
# AI-powered FastSR classification
# ---------------------------------------------------------------------------

# Maximum input length passed to the AI classifier to stay within model context limits
AI_FASTSR_MAX_INPUT_CHARS = 3500

SYSTEM_FASTSR = (
    "You are a clinical NLP classifier. Given medical patient education text in any language, "
    "classify each meaningful sentence into one of four SOAP sections.\n"
    "S (Subjective): patient symptoms, complaints, indications, who the procedure is for, patient background.\n"
    "O (Objective): examination findings, measurements, test results, clinical statistics, study data.\n"
    "A (Assessment): diagnosis, mechanism, pathology, disease analysis, rationale.\n"
    "P (Plan): treatment steps, medications, procedures, pre/post-care instructions, what to do or avoid.\n"
    "Rules: every sentence appears in exactly one section; skip sentences shorter than 8 characters.\n"
    "Return ONLY a valid JSON object with keys \"S\", \"O\", \"A\", \"P\" each holding an array of strings. "
    "No markdown fences, no extra text."
)


def ai_classify_fastsr(client: "OpenAI", text: str) -> dict[str, list[str]]:
    """Use GitHub Models AI to classify text into S/O/A/P buckets.

    Falls back to keyword-based classification if JSON parsing fails.
    """
    truncated = text[:AI_FASTSR_MAX_INPUT_CHARS]
    raw = _chat(client, SYSTEM_FASTSR, truncated)
    try:
        # Strip possible markdown fences the model may still emit
        json_str = re.sub(r"```json?\s*|\s*```", "", raw).strip()
        data = json.loads(json_str)
        return {
            "S": [str(s) for s in data.get("S", []) if str(s).strip()],
            "O": [str(s) for s in data.get("O", []) if str(s).strip()],
            "A": [str(s) for s in data.get("A", []) if str(s).strip()],
            "P": [str(s) for s in data.get("P", []) if str(s).strip()],
        }
    except Exception as exc:
        print(f"  ⚠️ AI FastSR parse failed: {exc} — falling back to keyword classifier")
        return build_fastsr(text)



def _simple_tokenize(text: str) -> list[str]:
    """Basic tokenizer: lowercase words + Chinese bigrams (mirrors app.js eduTokenize)."""
    lower = text.lower()
    tokens: list[str] = []
    words = re.split(r"[\s,，、；;。.!！?？\-\/]+", lower)
    for w in words:
        if not w:
            continue
        tokens.append(w)
        if re.search(r"[\u4e00-\u9fff]", w) and len(w) > 1:
            for i in range(len(w) - 1):
                tokens.append(w[i] + w[i + 1])
    return list(dict.fromkeys(t for t in tokens if t))


def _top_tokens(text: str, k: int = 60) -> list[str]:
    """Return the top-k most frequent tokens from text (global prototype terms)."""
    from collections import Counter
    tokens = _simple_tokenize(text)
    # Remove single-char tokens that are not Chinese
    filtered = [t for t in tokens if len(t) > 1 or re.search(r"[\u4e00-\u9fff]", t)]
    counts = Counter(filtered)
    return [t for t, _ in counts.most_common(k)]


def build_prototypes(
    title: str,
    tags: list[str],
    fastsr: dict[str, list[str]],
) -> dict:
    """Build the three FastSR prototype representations for an entry.

    Returns a dict with keys:
      global   – list of top terms from the full document (BOW approximation)
      semantic – list of matched domain-vocabulary keywords
      fragment – list of representative sentences (one per SOAP section + title)
    """
    # Full document text
    all_sentences = [s for secs in fastsr.values() for s in secs]
    full_text = " ".join([title] + tags + all_sentences)

    # --- Global prototype: top-60 terms from full document ---
    global_terms = _top_tokens(full_text, k=60)

    # --- Semantic prototype: FASTSR domain keywords present in the document ---
    full_lower = full_text.lower()
    semantic_terms: list[str] = []
    for kws in FASTSR_KW.values():
        for kw in kws["zh"] + kws["en"]:
            if kw.lower() in full_lower and kw not in semantic_terms:
                semantic_terms.append(kw)

    # --- Fragment prototype: one representative sentence per SOAP section ---
    fragments: list[str] = []
    if title.strip():
        fragments.append(title)
    for sec in ("S", "O", "A", "P"):
        sents = fastsr.get(sec, [])
        if sents:
            # Pick the longest sentence as most information-dense representative
            rep = max(sents, key=len)
            fragments.append(rep)

    return {
        "global": global_terms,
        "semantic": semantic_terms,
        "fragment": fragments,
    }


# ---------------------------------------------------------------------------
# AI translation
# ---------------------------------------------------------------------------
SYSTEM_TRANSLATE_ZH = (
    "You are a medical translator. Translate the provided professional-level Traditional Chinese "
    "medical patient education content into the requested format. Preserve all medical accuracy. "
    "Return only valid HTML (using only: p, ul, ol, li, h2, h3, h4, strong, em, table, thead, "
    "tbody, tr, th, td). Do not include ```html fences."
)

SYSTEM_TRANSLATE_EN = (
    "You are a medical translator. Translate the provided professional-level English medical "
    "patient education content into the requested format. Return only valid HTML."
)

SYSTEM_EXTRACT_TITLE = (
    "Extract a concise title (≤ 20 Chinese characters or ≤ 8 English words) from the following "
    "medical text. Return ONLY the title text, no punctuation, no quotes."
)

TAIWAN_LOCALE_GUIDANCE = (
    "Use Taiwanese Traditional Chinese wording and tone (台灣用語與語氣), "
    "and avoid Mainland China expressions."
)


def ai_translate_to_simple_zh(client: "OpenAI", professional_zh_html: str) -> str:
    """Generate patient-friendly Simple Chinese from professional Chinese."""
    prompt = (
        "Convert the following professional Traditional Chinese medical content into "
        "a patient-friendly version (簡易版). Use plain language, add relevant emojis as "
        "section headers. Structure: brief intro, bullet-list key points, assessment bullet list, "
        "treatment/RICE instructions. " + TAIWAN_LOCALE_GUIDANCE + " Return only HTML.\n\n"
        + professional_zh_html
    )
    return _chat(client, SYSTEM_TRANSLATE_ZH, prompt)


def ai_translate_to_english(client: "OpenAI", professional_zh_html: str) -> str:
    """Translate professional Chinese HTML to professional English HTML."""
    prompt = (
        "Translate the following Traditional Chinese professional medical content into "
        "professional English. Maintain all medical terminology, structure, and detail. "
        "Return only HTML.\n\n"
        + professional_zh_html
    )
    return _chat(client, SYSTEM_TRANSLATE_ZH, prompt)


def ai_translate_zh_from_en(client: "OpenAI", professional_en_html: str) -> str:
    """Translate professional English HTML to professional Traditional Chinese HTML."""
    prompt = (
        "Translate the following professional English medical content into professional "
        "Traditional Chinese (繁體中文, 台灣用語與語氣). Maintain all medical terminology and structure. "
        + TAIWAN_LOCALE_GUIDANCE + " "
        "Return only HTML.\n\n"
        + professional_en_html
    )
    return _chat(client, SYSTEM_TRANSLATE_EN, prompt)


def ai_translate_to_simple_zh_from_en(client: "OpenAI", professional_en_html: str) -> str:
    """Generate patient-friendly Simple Chinese from professional English HTML."""
    prompt = (
        "Translate the following professional English medical content into patient-friendly "
        "Traditional Chinese (繁體中文簡易版, 台灣用語與語氣). Use plain language, add relevant emojis as "
        "section headers. " + TAIWAN_LOCALE_GUIDANCE + " Return only HTML.\n\n"
        + professional_en_html
    )
    return _chat(client, SYSTEM_TRANSLATE_EN, prompt)


def ai_extract_title(client: "OpenAI", text: str) -> str:
    """Use AI to extract a concise title from the text."""
    return _chat(client, SYSTEM_EXTRACT_TITLE, text[:2000])


# ---------------------------------------------------------------------------
# AI helpers for EBM note → 衛教資源 article conversion
# ---------------------------------------------------------------------------

SYSTEM_GENERATE_ARTICLE = (
    "You are a senior clinical educator creating patient education materials. "
    "Based on the raw medical/EBM note provided, write a well-structured article. "
    "Return only valid HTML (using only: p, ul, ol, li, h2, h3, h4, strong, em, table, thead, "
    "tbody, tr, th, td). Do not include ```html fences or markdown."
)

SYSTEM_GENERATE_TAGS = (
    "You are a medical taxonomy specialist. Extract 5–10 concise medical keyword tags from "
    "the provided clinical/EBM text. Tags should be in Traditional Chinese (繁體中文) or "
    "standard medical English abbreviations (e.g. MCL, ACL, NSAIDs). "
    "Return ONLY a JSON array of strings, no extra text, no markdown fences."
)


def ai_generate_professional_zh_from_note(client: "OpenAI", note_text: str) -> str:
    """Generate a professional Traditional Chinese patient education article from a raw EBM note."""
    prompt = (
        "Based on the following raw EBM/clinical note (may be a mix of Chinese and English), "
        "write a complete professional-level Traditional Chinese (繁體中文) patient education "
        "article with clear sections (e.g. background, indications, procedure, outcomes, "
        "post-care, contraindications). Use proper medical terminology and Taiwanese clinical wording "
        "(台灣醫療用語、繁體中文語氣). " + TAIWAN_LOCALE_GUIDANCE + " Return only HTML.\n\n"
        + note_text[:MAX_EBM_NOTE_PROMPT_CHARS]
    )
    return _chat(client, SYSTEM_GENERATE_ARTICLE, prompt)


def ai_generate_simple_zh_from_note(client: "OpenAI", professional_zh_html: str) -> str:
    """Generate patient-friendly Simple Chinese from a professional Chinese article."""
    prompt = (
        "Rewrite the following professional Traditional Chinese medical content into a "
        "patient-friendly version (簡易版). Use plain everyday language, add relevant emojis "
        "as visual cues for section headers. Structure: brief intro sentence, bullet-point "
        "key facts, what to expect, and key instructions. Use Taiwanese Traditional Chinese "
        "wording. " + TAIWAN_LOCALE_GUIDANCE + " Return only HTML.\n\n"
        + professional_zh_html
    )
    return _chat(client, SYSTEM_GENERATE_ARTICLE, prompt)


def ai_generate_english_from_professional_zh(client: "OpenAI", professional_zh_html: str) -> str:
    """Translate a professional Traditional Chinese article to professional English."""
    prompt = (
        "Translate the following professional Traditional Chinese patient education article "
        "into professional English. Maintain all medical accuracy, structure, and terminology. "
        "Return only HTML.\n\n"
        + professional_zh_html
    )
    return _chat(client, SYSTEM_GENERATE_ARTICLE, prompt)


def ai_generate_tags(client: "OpenAI", text: str, title: str = "") -> list:
    """Use AI to extract 5–10 relevant medical tags from the text."""
    snippet = (title + "\n\n" + text)[:2500]
    raw = _chat(client, SYSTEM_GENERATE_TAGS, snippet)
    try:
        json_str = re.sub(r"```json?\s*|\s*```", "", raw).strip()
        tags = json.loads(json_str)
        if isinstance(tags, list):
            return [str(t).strip() for t in tags if str(t).strip()]
    except Exception as exc:
        print(f"  ⚠️ AI tags parse failed: {exc} — falling back to empty list")
    return []


def convert_ebm_note(
    client: "OpenAI | None",
    note_text: str,
    existing_title: str = "",
    existing_versions: "dict | None" = None,
    existing_fastsr: "dict | None" = None,
    existing_tags: "list | None" = None,
) -> dict:
    """Convert a raw EBM note into a full v2 衛教資源 entry dict.

    Returns a dict with keys: title, tags, fastsr, prototype, versions,
    source_url, source_label, source_urls.
    Falls back gracefully when no AI client is available.
    """
    ev = existing_versions or {}
    ef = existing_fastsr or {}

    urls = list(dict.fromkeys(extract_urls(note_text)))
    source_url = urls[0] if urls else ""
    source_label = ""
    if source_url:
        domain = re.sub(r"https?://(www\.)?", "", source_url).split("/")[0]
        source_label = domain

    if client:
        try:
            title = existing_title or ai_extract_title(client, note_text)
            print(f"  ✔ Title: {title}")
        except Exception as e:
            print(f"  ⚠️ AI title failed: {e}")
            title = existing_title or note_text.strip().splitlines()[0][:50]
    else:
        title = existing_title or note_text.strip().splitlines()[0][:50]

    # Generate 3 article versions
    if client:
        try:
            professional_zh = ev.get("professional_zh", "") or ai_generate_professional_zh_from_note(client, note_text)
            print("  ✔ professional_zh generated")
        except Exception as e:
            print(f"  ⚠️ professional_zh failed: {e}")
            professional_zh = ev.get("professional_zh", "") or f"<p>{note_text}</p>"

        try:
            if ev.get("simple_zh", "").strip():
                simple_zh = ev["simple_zh"]
                print("  ✔ Reusing existing simple_zh")
            else:
                simple_zh = ai_generate_simple_zh_from_note(client, professional_zh)
                print("  ✔ simple_zh generated")
        except Exception as e:
            print(f"  ⚠️ simple_zh failed: {e}")
            simple_zh = ev.get("simple_zh", "") or professional_zh

        try:
            if ev.get("english", "").strip():
                english = ev["english"]
                print("  ✔ Reusing existing english")
            else:
                english = ai_generate_english_from_professional_zh(client, professional_zh)
                print("  ✔ english generated")
        except Exception as e:
            print(f"  ⚠️ english failed: {e}")
            english = ev.get("english", "")
    else:
        professional_zh = ev.get("professional_zh", "") or f"<p>{note_text}</p>"
        simple_zh = ev.get("simple_zh", "") or professional_zh
        english = ev.get("english", "")

    # FastSR classification
    if ef and not _fastsr_needs_ai(ef):
        fastsr = ef
        print("  ✔ Reusing existing fastsr")
    elif client:
        try:
            fastsr = ai_classify_fastsr(client, note_text)
            print(f"  ✔ AI FastSR: S({len(fastsr['S'])}) O({len(fastsr['O'])}) A({len(fastsr['A'])}) P({len(fastsr['P'])})")
        except Exception as e:
            print(f"  ⚠️ AI FastSR failed: {e}")
            fastsr = build_fastsr(note_text)
    else:
        fastsr = build_fastsr(note_text)

    # Tags
    if existing_tags and len(existing_tags) >= 3:
        tags = existing_tags
        print("  ✔ Reusing existing tags")
    elif client:
        try:
            tags = ai_generate_tags(client, note_text, title)
            print(f"  ✔ AI tags: {tags}")
        except Exception as e:
            print(f"  ⚠️ AI tags failed: {e}")
            tags = existing_tags or []
    else:
        tags = existing_tags or []

    prototype = build_prototypes(title=title, tags=tags, fastsr=fastsr)

    return {
        "title": title,
        "tags": tags,
        "source_url": source_url,
        "source_label": source_label,
        "source_urls": urls,
        "fastsr": fastsr,
        "prototype": prototype,
        "versions": {
            "simple_zh": simple_zh,
            "professional_zh": professional_zh,
            "english": english,
        },
    }


def process_document(
    text: str,
    html: str,
    filename: str,
    existing_title: Optional[str] = None,
    extra_urls: Optional[list] = None,
    existing_versions: Optional[dict] = None,
    existing_fastsr: Optional[dict] = None,
) -> dict:
    """
    Process a document (text + HTML) and return a v2 edu entry dict.

    If GITHUB_TOKEN is set (always the case in GitHub Actions), performs AI translation via GitHub Models.
    Falls back to existing translated versions (if provided) or placeholder content if API is unavailable.

    Args:
        text: Plain text extracted from the document.
        html: HTML conversion of the document.
        filename: Stem of the source filename (used as title fallback).
        existing_title: Title from an existing JSON entry (preserved if set).
        extra_urls: Additional source URLs to merge in (e.g. from a sidecar .meta.json).
        existing_versions: Existing translated versions dict to use as fallback when AI fails.
        existing_fastsr: Existing FastSR dict to reuse if quality is acceptable.
    """
    lang = detect_language(text)
    urls = list(dict.fromkeys(extract_urls(text) + (extra_urls or [])))
    source_url = urls[0] if urls else ""
    source_label = ""
    # Try to infer source label from URL
    if source_url:
        domain = re.sub(r"https?://(www\.)?", "", source_url).split("/")[0]
        source_label = domain

    ev = existing_versions or {}
    ef = existing_fastsr or {}
    client = _get_client()

    # Determine which versions are already complete so we skip unnecessary AI calls
    has_english   = bool(ev.get("english", "").strip())
    has_simple_zh = bool(ev.get("simple_zh", "").strip())

    if lang == "zh":
        professional_zh = html
        if client:
            # Only call AI for versions that are missing or match the raw HTML (not yet simplified)
            try:
                if has_simple_zh and ev.get("simple_zh", "").strip() != html.strip():
                    simple_zh = ev["simple_zh"]
                    print("  ✔ Reusing existing simple_zh")
                else:
                    simple_zh = ai_translate_to_simple_zh(client, html)

                if has_english:
                    english = ev["english"]
                    print("  ✔ Reusing existing english")
                else:
                    english = ai_translate_to_english(client, html)

                title = existing_title or ai_extract_title(client, text)
            except Exception as e:
                print(f"  ⚠️ AI translation failed: {e}")
                # Preserve existing translations; only fall back to raw HTML as last resort
                simple_zh = ev.get("simple_zh") or html
                english   = ev.get("english") or ""
                title = existing_title or filename
        else:
            simple_zh = ev.get("simple_zh") or html
            english   = ev.get("english") or ""
            title = existing_title or filename
    else:
        # English source
        professional_en = html
        if client:
            try:
                if ev.get("professional_zh", "").strip():
                    professional_zh = ev["professional_zh"]
                    print("  ✔ Reusing existing professional_zh")
                else:
                    professional_zh = ai_translate_zh_from_en(client, html)

                if has_simple_zh:
                    simple_zh = ev["simple_zh"]
                    print("  ✔ Reusing existing simple_zh")
                else:
                    simple_zh = ai_translate_to_simple_zh_from_en(client, html)

                if has_english and ev.get("english", "").strip() != html.strip():
                    english = ev["english"]
                    print("  ✔ Reusing existing english")
                else:
                    english = professional_en
                title = existing_title or ai_extract_title(client, text)
            except Exception as e:
                print(f"  ⚠️ AI translation failed: {e}")
                professional_zh = ev.get("professional_zh") or ""
                simple_zh       = ev.get("simple_zh") or ""
                english = ev.get("english") or professional_en
                title = existing_title or filename
        else:
            professional_zh = ev.get("professional_zh") or ""
            simple_zh       = ev.get("simple_zh") or ""
            english = ev.get("english") or professional_en
            title = existing_title or filename

    # FastSR classification — prefer AI when available; reuse existing if quality is OK
    if ef and not _fastsr_needs_ai(ef):
        fastsr = ef
        print("  ✔ Reusing existing fastsr")
    elif client:
        try:
            fastsr = ai_classify_fastsr(client, text)
            print(f"  ✔ AI FastSR: S({len(fastsr['S'])}) O({len(fastsr['O'])}) A({len(fastsr['A'])}) P({len(fastsr['P'])})")
        except Exception as e:
            print(f"  ⚠️ AI FastSR failed: {e} — using keyword classifier")
            fastsr = build_fastsr(text)
    else:
        fastsr = build_fastsr(text)

    prototype = build_prototypes(
        title=title,
        tags=[],
        fastsr=fastsr,
    )

    return {
        "title": title,
        "source_url": source_url,
        "source_label": source_label,
        "source_urls": urls,  # all URLs for multi-URL display
        "fastsr": fastsr,
        "prototype": prototype,
        "versions": {
            "simple_zh": simple_zh,
            "professional_zh": professional_zh,
            "english": english,
        },
    }
