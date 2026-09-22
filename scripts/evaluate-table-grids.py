"""Replay fixed table expectations and saved model sequences without inference.

Crop scores measure topology only. Full-page detections are recorded separately
and must not be treated as end-to-end content accuracy or a blind benchmark.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/adapters"))
import pdfplumber
import pypdfium2 as pdfium
from pdfLayoutExtractor import table_regions
from pdfTableStructure import otsl_table_grid


def digest(file):
    with Path(file).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def score(cells, expected):
    def topology(items):
        return {(c["row"], c["column"], c["rowSpan"], c["columnSpan"]) for c in items}
    actual, target = topology(cells), topology(expected)
    hits = len(actual & target)
    return {"exact": actual == target and len(actual) == len(cells),
            "predicted": len(cells), "expected": len(target),
            "f1": 2*hits/(len(actual)+len(target)) if actual or target else 1.0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--raw-results", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(args.inputs.read_text(encoding="utf-8"))
    args.output.mkdir(parents=True, exist_ok=True)
    checked, results = {}, []
    for sample in manifest["samples"]:
        source = sample["source"]
        if source not in checked: checked[source] = digest(source)
        if checked[source] != sample["sourceSha256"]: raise ValueError("Changed source: " + source)
        window = args.output / (sample["id"] + ".pdf")
        with pdfium.PdfDocument(source) as original, pdfium.PdfDocument.new() as small:
            small.import_pages(original, pages=[sample["page"]-1])
            small.save(window)
        with pdfplumber.open(window) as doc:
            started = time.perf_counter()
            regions = table_regions(doc.pages[0].crop(sample["bbox"]), sample["page"])
            seconds = time.perf_counter()-started
            full_page = table_regions(doc.pages[0], sample["page"])
        cells = [c for region in regions for c in region.get("cellBoxes", [])]
        baseline = [c for region in sample["ruleBaseline"] for c in region.get("cellBoxes", [])]
        raw_path = args.raw_results / (sample["id"] + "-raw.json")
        raw = json.loads(raw_path.read_text(encoding="utf-8"))
        grid = otsl_table_grid(raw["predict_details"]["prediction"]["rs_seq"])
        result = {"id": sample["id"], "sourceSha256": checked[source], "page": sample["page"],
                  "crop": sample["bbox"], "isTable": sample["isTable"], "seconds": seconds,
                  "baselineTopology": score(baseline, sample["expectedCells"]),
                  "currentTopology": score(cells, sample["expectedCells"]),
                  "falsePositive": not sample["isTable"] and bool(regions), "regions": regions,
                  "fullPageDetections": full_page,
                  "modelSequence": {"rawSha256": digest(raw_path), "valid": grid is not None,
                                    "topology": score(grid["cellBoxes"] if grid else [], sample["expectedCells"])}}
        results.append(result)
        print(json.dumps({k: result[k] for k in ("id", "currentTopology", "falsePositive", "modelSequence")}))
    report = {"schema": "schema-docs.table-grid-replay.v1", "inputsSha256": digest(args.inputs),
              "scope": "fixed development crops; full-page region detection listed separately; not blind accuracy",
              "sourceFiles": {p.name: digest(p) for p in Path(sys.path[0]).glob("pdf*.py")}, "results": results}
    (args.output / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
