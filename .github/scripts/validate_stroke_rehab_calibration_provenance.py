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
    signature = f"function {function_name}("
    start = source.find(signature)
    require(start != -1, f"Could not find function declaration for {function_name}")

    brace_start = source.find("{", start)
    require(brace_start != -1, f"Could not find opening brace for {function_name}")

    depth = 0
    for index in range(brace_start, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[brace_start + 1:index]

    raise AssertionError(f"Could not find closing brace for {function_name}")


def extract_model_coefficients(source: str, model_name: str) -> dict[str, float]:
    match = re.search(rf"const {re.escape(model_name)} = \{{(.*?)\n\}};", source, re.S)
    require(match is not None, f"Could not find model definition for {model_name}")

    coefficients: dict[str, float] = {}
    for key, value in re.findall(r"([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(-?\d+(?:\.\d+)?)", match.group(1)):
        coefficients[key] = float(value)

    require(coefficients, f"No coefficients parsed for {model_name}")
    return coefficients


def normalized_number_dict(values: dict[str, float]) -> dict[str, float]:
    return {key: float(value) for key, value in values.items()}


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

    six_coefficients = extract_model_coefficients(predictor_text, "SIX_MWT_MODEL")
    amb_coefficients = extract_model_coefficients(predictor_text, "AMBULATION_MODEL")
    require(
        six_coefficients == normalized_number_dict(data["implemented_models"][0]["coefficients"]),
        "SIX_MWT_MODEL coefficients do not match provenance metadata",
    )
    require(
        amb_coefficients == normalized_number_dict(data["implemented_models"][1]["coefficients"]),
        "AMBULATION_MODEL coefficients do not match provenance metadata",
    )

    require("Math.max(0, v.age - 60)" in six_body, "predict6MWT must derive age_over60 from raw age")
    require("Math.max(0, v.age - 60)" in amb_body, "predictAmbulation must derive age_over60 from raw age")
    require("Math.min(550, Math.max(0, raw))" in six_body, "predict6MWT must clip predictions to 0-550")
    require("1 / (1 + Math.exp(-logOdds))" in amb_body, "predictAmbulation must use the inverse-logit transform")

    expected_predictor_fields = {"age", "sex_male", "nihss", "days_delay", "fm_le", "bbs", "baseline_fac", "mmse", "rehab_hrs"}
    require(set(re.findall(r"v\.([A-Za-z_][A-Za-z0-9_]*)", six_body)) == expected_predictor_fields, "predict6MWT field references changed")
    require(set(re.findall(r"v\.([A-Za-z_][A-Za-z0-9_]*)", amb_body)) == expected_predictor_fields, "predictAmbulation field references changed")

    require(
        set(re.findall(r"SIX_MWT_MODEL\.([A-Za-z_][A-Za-z0-9_]*)", six_body)) == set(six_coefficients),
        "predict6MWT model-term references changed",
    )
    require(
        set(re.findall(r"AMBULATION_MODEL\.([A-Za-z_][A-Za-z0-9_]*)", amb_body)) == set(amb_coefficients),
        "predictAmbulation model-term references changed",
    )

    allowed_six_calls = {"Math.max", "Math.round", "Math.min"}
    allowed_amb_calls = {"Math.max", "Math.exp"}
    require(set(re.findall(r"\b([A-Za-z_][A-Za-z0-9_.]*)\s*\(", six_body)) <= allowed_six_calls, "predict6MWT introduces unexpected function calls")
    require(set(re.findall(r"\b([A-Za-z_][A-Za-z0-9_.]*)\s*\(", amb_body)) <= allowed_amb_calls, "predictAmbulation introduces unexpected function calls")
    require("POP_MEANS" not in six_body, "predict6MWT should not depend on POP_MEANS centering")
    require("POP_MEANS" not in amb_body, "predictAmbulation should not depend on POP_MEANS centering")

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
