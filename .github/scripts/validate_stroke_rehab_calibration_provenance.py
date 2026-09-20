#!/usr/bin/env python3
"""Validate the checked-in stroke rehab calibration provenance disclosure."""

from __future__ import annotations

import json
import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
PREDICTOR = REPO_ROOT / "Report" / "modules" / "stroke-rehab-predictor.js"
DOC = REPO_ROOT / "Report" / "stroke_rehab_calibration_provenance.md"
JSON_PATH = REPO_ROOT / "Report" / "data" / "stroke_rehab_calibration_provenance.json"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def extract_function_body(source: str, function_name: str) -> str:
    match = re.search(rf"function {re.escape(function_name)}\([^)]*\) \{{(.*?)\n\}}", source, re.S)
    require(match is not None, f"Could not find function body for {function_name}")
    return match.group(1)


def main() -> None:
    predictor_text = PREDICTOR.read_text(encoding="utf-8")
    doc_text = DOC.read_text(encoding="utf-8")
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))

    require("const SIX_MWT_MODEL" in predictor_text, "Missing SIX_MWT_MODEL definition")
    require("const AMBULATION_MODEL" in predictor_text, "Missing AMBULATION_MODEL definition")
    require("const POP_MEANS" in predictor_text, "Missing POP_MEANS reference values")
    require("compute6MWTContributions" in predictor_text, "Missing contribution visualization helper")
    require("Math.min(550, Math.max(0, raw))" in predictor_text, "Missing 6MWT clipping rule")
    require("1 / (1 + Math.exp(-logOdds))" in predictor_text, "Missing ambulation inverse-logit transform")

    six_body = extract_function_body(predictor_text, "predict6MWT")
    amb_body = extract_function_body(predictor_text, "predictAmbulation")

    forbidden_tokens = ("weight", "observ", "outcome", "recenter", "recalib", "offset")
    for token in forbidden_tokens:
        require(token not in six_body.lower(), f"Unexpected token {token!r} in predict6MWT")
        require(token not in amb_body.lower(), f"Unexpected token {token!r} in predictAmbulation")

    required_doc_phrases = (
        "no weighting, no outcome-driven offset adjustment, no recentering, and no post-hoc recalibration step",
        "visualization only",
        "calibration predictions of any of the following types",
        "not reproducible from the tracked repository alone",
        "weighted residual mean is zero",
    )
    for phrase in required_doc_phrases:
        require(phrase in doc_text, f"Documentation missing phrase: {phrase}")

    require(data["implemented_models"][0]["uses_post_hoc_recentering"] is False, "Model 1 recentering flag must be false")
    require(data["implemented_models"][1]["uses_post_hoc_recalibration"] is False, "Model 2 recalibration flag must be false")
    require(data["calibration_reproducibility"]["reproducible_from_repository_alone"] is False, "Calibration reproducibility flag must be false")
    require(data["calibration_reproducibility"]["calibration_plots_generated_in_tracked_repository"] is False, "Calibration-plot generation flag must be false")
    require(data["calibration_reproducibility"]["out_of_sample_predictions_available"] is False, "Out-of-sample flag must be false")
    require(data["mean_equality_and_zero_intercept"]["tracked_repository_confirms_exact_zero_intercepts"] is False, "Exact-zero confirmation flag must be false")
    require(data["plot_construction"]["status"] == "Unavailable in the tracked repository", "Unexpected plot status")

    print("stroke rehab calibration provenance validation passed")


if __name__ == "__main__":
    main()
