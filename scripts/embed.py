import argparse
import json
from pathlib import Path

from sentence_transformers import SentenceTransformer


def load_pairs(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"{path} must contain a JSON array")
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
    questions = [item.get("question", "") for item in pairs]
    answers = [item.get("answer", "") for item in pairs]
    question_vectors = model.encode(questions).tolist() if questions else []
    answer_vectors = model.encode(answers).tolist() if answers else []

    output = []
    for index, item in enumerate(pairs):
        question = questions[index]
        answer = answers[index]
        output.append(
            {
                "question": question,
                "answer": answer,
                "keywords": item.get("keywords", ""),
                "enabled": item.get("enabled", True),
                "q_vec": question_vectors[index] if question else [],
                "a_vec": answer_vectors[index] if answer else [],
            }
        )

    output_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
