import argparse
import json
from pathlib import Path

from sentence_transformers import SentenceTransformer


def load_pairs(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("qa_pairs.json must contain a JSON array")
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="qa_pairs.json")
    parser.add_argument("--output", default="qa_pairs_with_embeddings.json")
    parser.add_argument("--model", default="all-MiniLM-L6-v2")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    pairs = load_pairs(input_path)
    model = SentenceTransformer(args.model)

    output = []
    for item in pairs:
        question = item.get("question", "")
        answer = item.get("answer", "")
        output.append(
            {
                "question": question,
                "answer": answer,
                "keywords": item.get("keywords", ""),
                "enabled": item.get("enabled", True),
                "q_vec": model.encode(question).tolist() if question else [],
                "a_vec": model.encode(answer).tolist() if answer else [],
            }
        )

    output_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
