import argparse
import html
import json
import re
from pathlib import Path

from PIL import Image
from surya.common.surya.schema import TaskNames
from surya.foundation import FoundationPredictor
from surya.recognition import RecognitionPredictor


MATH_WRAPPER = re.compile(r"^<math\b[^>]*>([\s\S]*?)</math>$", re.IGNORECASE)


def latex_from_prediction(value):
    text = html.unescape(str(value or "").strip())
    match = MATH_WRAPPER.match(text)
    if not match:
        return ""
    latex = re.sub(r"<br\s*/?>", "", match.group(1), flags=re.IGNORECASE).strip()
    if not latex or len(latex) > 6000 or "<" in latex or ">" in latex:
        return ""
    if re.search(r"(?:NOMATH|\[UNK\]|<unk>)", latex, re.IGNORECASE):
        return ""
    return latex


def formula_regions(manifest, asset_dir):
    candidates = []
    for page in manifest.get("pages", []):
        for region in page.get("regions", []):
            asset_file = region.get("assetFile")
            if (
                region.get("type") == "formula"
                and region.get("needsVisualFallback")
                and asset_file
                and (asset_dir / asset_file).is_file()
            ):
                candidates.append((page, region, asset_dir / asset_file))
    return candidates


def recognize(predictor, entries, batch_size):
    predictions = {}
    for offset in range(0, len(entries), batch_size):
        chunk = entries[offset:offset + batch_size]
        images = []
        boxes = []
        for _page, _region, image_path in chunk:
            image = Image.open(image_path).convert("RGB")
            images.append(image)
            boxes.append([[0, 0, image.width, image.height]])
        results = predictor(
            images,
            [TaskNames.block_without_boxes] * len(images),
            bboxes=boxes,
            recognition_batch_size=batch_size,
        )
        for (_page, region, image_path), result in zip(chunk, results):
            raw = result.text_lines[0].text if result.text_lines else ""
            latex = latex_from_prediction(raw)
            if latex:
                predictions[region["assetFile"]] = latex
        for image in images:
            image.close()
    return predictions


def replace_formula_markers(markdown, predictions):
    marker = re.compile(
        r"<!-- pdf-formula: page=(\d+) index=(\d+) file=([^\s>]+) -->"
    )

    def replacement(match):
        asset_file = match.group(3)
        latex = predictions.get(asset_file)
        if not latex:
            return match.group(0)
        return (
            f"<!-- pdf-formula-source: page={match.group(1)} "
            f"index={match.group(2)} file={asset_file} -->\n\n$$\n{latex}\n$$"
        )

    return marker.sub(replacement, markdown)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("markdown")
    parser.add_argument("manifest")
    parser.add_argument("asset_dir")
    parser.add_argument("--batch-size", type=int, default=6)
    args = parser.parse_args()

    markdown_path = Path(args.markdown)
    manifest_path = Path(args.manifest)
    asset_dir = Path(args.asset_dir)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = formula_regions(manifest, asset_dir)
    if not entries:
        print(json.dumps({"ok": True, "candidates": 0, "recognized": 0}))
        return

    predictor = RecognitionPredictor(FoundationPredictor())
    predictions = recognize(predictor, entries, max(1, args.batch_size))
    markdown = markdown_path.read_text(encoding="utf-8")
    markdown_path.write_text(replace_formula_markers(markdown, predictions), encoding="utf-8")

    for _page, region, _image_path in entries:
        latex = predictions.get(region.get("assetFile"))
        if latex:
            region["latex"] = latex
            region["formulaOcrStatus"] = "recognized"
            region["editableMathCandidate"] = True
            region["needsVisualFallback"] = False
        else:
            region["formulaOcrStatus"] = "visual_fallback"
    summary = manifest.setdefault("summary", {})
    summary["formulaOcrCandidates"] = len(entries)
    summary["formulaOcrRecognized"] = len(predictions)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "candidates": len(entries), "recognized": len(predictions)}))


if __name__ == "__main__":
    main()
