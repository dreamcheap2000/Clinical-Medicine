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


# ---------------------------------------------------------------------------
# FastSR Prototype computation (Global / Semantic / Fragment)
# ---------------------------------------------------------------------------

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


def ai_translate_to_simple_zh(client: "OpenAI", professional_zh_html: str) -> str:
    """Generate patient-friendly Simple Chinese from professional Chinese."""
    prompt = (
        "Convert the following professional Traditional Chinese medical content into "
        "a patient-friendly version (簡易版). Use plain language, add relevant emojis as "
        "section headers. Structure: brief intro, bullet-list key points, assessment bullet list, "
        "treatment/RICE instructions. Return only HTML.\n\n"
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
        "Traditional Chinese (繁體中文). Maintain all medical terminology and structure. "
        "Return only HTML.\n\n"
        + professional_en_html
    )
    return _chat(client, SYSTEM_TRANSLATE_EN, prompt)


def ai_translate_to_simple_zh_from_en(client: "OpenAI", professional_en_html: str) -> str:
    """Generate patient-friendly Simple Chinese from professional English HTML."""
    prompt = (
        "Translate the following professional English medical content into patient-friendly "
        "Traditional Chinese (繁體中文簡易版). Use plain language, add relevant emojis as "
        "section headers. Return only HTML.\n\n"
        + professional_en_html
    )
    return _chat(client, SYSTEM_TRANSLATE_EN, prompt)


def ai_extract_title(client: "OpenAI", text: str) -> str:
    """Use AI to extract a concise title from the text."""
    return _chat(client, SYSTEM_EXTRACT_TITLE, text[:2000])


# ---------------------------------------------------------------------------
# Main entry: process a single document text
# ---------------------------------------------------------------------------
def process_document(
    text: str,
    html: str,
    filename: str,
    existing_title: Optional[str] = None,
) -> dict:
    """
    Process a document (text + HTML) and return a v2 edu entry dict.

    If OPENAI_API_KEY is set, performs AI translation.
    Falls back to placeholder content if API is unavailable.
    """
    lang = detect_language(text)
    urls = extract_urls(text)
    source_url = urls[0] if urls else ""
    source_label = ""
    # Try to infer source label from URL
    if source_url:
        domain = re.sub(r"https?://(www\.)?", "", source_url).split("/")[0]
        source_label = domain

    client = _get_client()

    if lang == "zh":
        professional_zh = html
        if client:
            try:
                simple_zh = ai_translate_to_simple_zh(client, html)
                english = ai_translate_to_english(client, html)
                title = existing_title or ai_extract_title(client, text)
            except Exception as e:
                print(f"  ⚠️ AI translation failed: {e}")
                simple_zh = html
                english = ""
                title = existing_title or filename
        else:
            simple_zh = html
            english = ""
            title = existing_title or filename
    else:
        # English source
        professional_en = html
        if client:
            try:
                professional_zh = ai_translate_zh_from_en(client, html)
                simple_zh = ai_translate_to_simple_zh_from_en(client, html)
                english = professional_en
                title = existing_title or ai_extract_title(client, text)
            except Exception as e:
                print(f"  ⚠️ AI translation failed: {e}")
                professional_zh = ""
                simple_zh = ""
                english = professional_en
                title = existing_title or filename
        else:
            professional_zh = ""
            simple_zh = ""
            english = professional_en
            title = existing_title or filename

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
