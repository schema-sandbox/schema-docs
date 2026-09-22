"""Offline TableFormer feasibility experiment; never enables a production model.

Inputs are predeclared crops/expectations from prepare-table-model-trial.py.
Report topology, token retention, CPU time, process memory, package and weight
size separately. Oracle crops do not measure table detection or page ordering.
"""
import argparse
import copy
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import sys
import time

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
STARTED = time.perf_counter()


def digest(file):
    with Path(file).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def topology(cells):
    return {(int(c["row"]), int(c["column"]), int(c["rowSpan"]), int(c["columnSpan"])) for c in cells}


def score(cells, expected):
    actual, target = topology(cells), topology(expected)
    hits = len(actual & target)
    return {"exact": actual == target and len(actual) == len(cells), "matched": hits,
            "predicted": len(cells), "expected": len(target),
            "f1": 2*hits/(len(actual)+len(target)) if actual or target else 1.0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=2)
    args = parser.parse_args()
    import cv2
    import psutil
    from docling_ibm_models.tableformer.data_management.tf_predictor import TFPredictor

    weights = args.model_dir / "tableformer_fast.safetensors"
    if digest(weights) != "3119563aab5a7c96fda4d621119b63fd8806272b86c30936d15507616422f718":
        raise ValueError("TableFormer Fast weight identity mismatch")
    configuration = args.model_dir / "tm_config.json"
    if digest(configuration) != "dca6762508dddfae6d57d6cb4ef822c6000119dff0f3b6489db7413118c2622a":
        raise ValueError("TableFormer Fast config identity mismatch")
    config = json.loads(configuration.read_text(encoding="utf-8"))
    config["model"]["save_dir"] = str(args.model_dir.resolve())
    process = psutil.Process()
    load_start = time.perf_counter()
    predictor = TFPredictor(config, device="cpu", num_threads=args.threads)
    load_seconds = time.perf_counter() - load_start
    manifest = json.loads(args.inputs.read_text(encoding="utf-8"))
    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    for sample in manifest["samples"]:
        if digest(sample["image"]) != sample["imageSha256"]:
            raise ValueError("Input changed: " + sample["id"])
        image = cv2.imread(sample["image"])
        page = {"image": image, "width": sample["width"], "height": sample["height"], "tokens": sample["tokens"]}
        timings, prediction, signatures = [], None, []
        try:
            for _ in range(2):
                started = time.perf_counter()
                cpu = process.cpu_times()
                prediction = predictor.multi_table_predict(copy.deepcopy(page), [[0, 0, sample["width"], sample["height"]]],
                                                          do_matching=True, correct_overlapping_cells=False,
                                                          sort_row_col_indexes=True)[0]
                final_cpu = process.cpu_times()
                timings.append({"wallSeconds": time.perf_counter()-started,
                                "cpuSeconds": final_cpu.user+final_cpu.system-cpu.user-cpu.system})
                signatures.append(json.dumps(prediction["tf_responses"], sort_keys=True))
            responses = prediction["tf_responses"]
            cells = [{"row": c["start_row_offset_idx"], "column": c["start_col_offset_idx"],
                      "rowSpan": c["row_span"], "columnSpan": c["col_span"],
                      "text": " ".join(t["token"] for t in sorted(c["text_cell_bboxes"], key=lambda t: (round(t["t"]/4), t["l"]))),
                      "bbox": c["bbox"]} for c in responses]
            baseline = [cell for region in sample["ruleBaseline"] for cell in region.get("cellBoxes", [])]
            assigned = [tuple(token.get(k) for k in ("l", "t", "r", "b", "token"))
                        for cell in responses for token in cell["text_cell_bboxes"]]
            expected_text = {(c["row"], c["column"]): "".join(c["text"].split()) for c in sample["expectedCells"] if c["text"]}
            correct_text = sum("".join(c["text"].split()) == expected_text.get((c["row"], c["column"])) for c in cells)
            result = {"id": sample["id"], "kind": sample["kind"], "isTable": sample["isTable"], "timings": timings,
                      "repeatStable": signatures[0] == signatures[1],
                      "topology": score(cells, sample["expectedCells"]), "ruleBaselineTopology": score(baseline, sample["expectedCells"]),
                      "falsePositive": not sample["isTable"] and bool(cells), "cells": cells,
                      "tokens": {"input": len(sample["tokens"]), "assigned": len(assigned), "uniqueAssignments": len(set(assigned))},
                      "text": {"scope": sample.get("groundTruthScope", "cell text and topology"),
                               "correctNonemptyCells": correct_text, "expectedNonemptyCells": len(expected_text)}}
            (args.output / (sample["id"] + "-raw.json")).write_text(json.dumps(prediction, ensure_ascii=False, indent=2,
                default=lambda value: value.tolist() if hasattr(value, "tolist") else str(value)), encoding="utf-8")
        except Exception as error:
            result = {"id": sample["id"], "isTable": sample["isTable"], "error": str(error)}
        results.append(result)
        print(json.dumps({k: v for k, v in result.items() if k not in ("cells",)}, ensure_ascii=False), flush=True)
    memory = process.memory_info()
    packages = {d.metadata["Name"]: d.version for d in importlib.metadata.distributions()}
    environment_files = [p for p in Path(sys.prefix).rglob("*") if p.is_file()]
    report = {"schema": "schema-docs.table-model-trial.v1", "model": "docling-project/docling-models/tableformer/fast",
              "modelRevision": "2199320848bb9a8a519d22e4b528185a4f9a6f64", "weightSha256": digest(weights),
              "weightBytes": weights.stat().st_size, "inputSha256": digest(args.inputs),
              "host": {"platform": platform.platform(), "cpu": platform.processor(), "logicalCpuCount": os.cpu_count()},
              "python": sys.version, "threads": args.threads, "packages": packages,
              "environmentBytes": sum(p.stat().st_size for p in environment_files), "environmentFiles": len(environment_files),
              "modelLoadSeconds": load_seconds, "elapsedSeconds": time.perf_counter()-STARTED,
              "peakProcessRssBytes": getattr(memory, "peak_wset", memory.rss), "results": results,
              "productionEnabled": False, "limits": ["Oracle table crops; detector and page order not evaluated",
                "Small predeclared sample set, not an independent human-reviewed benchmark",
                "Text matching uses native PDF tokens; OCR quality not evaluated",
                "Environment size includes full experiment dependencies, not a minimized shipping runtime",
                "License declarations are recorded separately; not public redistribution approval"]}
    (args.output / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if any("error" in r for r in results): raise SystemExit(1)


if __name__ == "__main__":
    main()
