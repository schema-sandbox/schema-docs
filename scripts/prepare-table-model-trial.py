"""Prepare local-only oracle table crops and independent, predeclared expectations.

Run with the development PDF dependencies, not the shipping private runtime.
Ground truth below is fixed before inference; source page numbers are evidence,
never production matching rules. Nothing is sent to a remote inference service.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import pdfplumber
import pypdfium2 as pdfium
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src/adapters"))
from pdfLayoutExtractor import ruled_table_regions


def digest(file):
    with Path(file).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def cells(rows, spans=()):
    covered = {(r+i, c+j) for r, c, rs, cs in spans for i in range(rs) for j in range(cs) if i or j}
    sizes = {(r, c): (rs, cs) for r, c, rs, cs in spans}
    return [{"row": r, "column": c, "rowSpan": sizes.get((r, c), (1, 1))[0],
             "columnSpan": sizes.get((r, c), (1, 1))[1], "text": text}
            for r, row in enumerate(rows) for c, text in enumerate(row) if (r, c) not in covered]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--materials", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    samples = []
    basic = [["Region", "Revenue", "Cost", "Margin"], ["North", "125", "75", "50"],
             ["South", "200", "90", "110"], ["East", "160", "100", "60"], ["West", "140", "85", "55"]]
    merged = [["Region", "Forecast", "", "Actual"], ["", "2026", "2027", ""],
              ["North", "125", "150", "118"], ["South", "200", "230", "194"],
              ["East", "160", "175", "151"], ["West", "140", "155", "136"]]
    empty = [row[:] for row in basic]
    empty[2][2] = ""
    empty[3][1] = ""
    chinese = [["地区", "收入", "成本", "利润"], ["华北", "125", "75", "50"],
               ["华南", "200", "90", "110"], ["华东", "160", "100", "60"], ["西部", "140", "85", "55"]]
    cases = [("unruled-simple", basic, [], False, "Helvetica"),
             ("unruled-merged-header", merged, [(0, 0, 2, 1), (0, 1, 1, 2), (0, 3, 2, 1)], False, "Helvetica"),
             ("unruled-empty", empty, [], False, "Helvetica"),
             ("ruled-control", basic, [], True, "Helvetica"),
             ("unruled-chinese", chinese, [], False, "SimSunTrial")]
    font_path = Path("C:/Windows/Fonts/simsun.ttc")
    pdfmetrics.registerFont(TTFont("SimSunTrial", str(font_path), subfontIndex=0))
    synthetic = out / "synthetic-tables.pdf"
    pdf = canvas.Canvas(str(synthetic), pagesize=(600, 400), invariant=1)
    for index, (name, rows, spans, ruled, font) in enumerate(cases):
        expectation = cells(rows, spans)
        x, top, cw, rh = 45, 60, 125, 42
        for cell in expectation:
            r, c, rs, cs = [cell[k] for k in ("row", "column", "rowSpan", "columnSpan")]
            if ruled:
                pdf.rect(x+c*cw, 400-top-(r+rs)*rh, cw*cs, rh*rs, stroke=1, fill=0)
            pdf.setFont(font, 13)
            pdf.drawCentredString(x+(c+cs/2)*cw, 400-top-(r+rs/2)*rh-4, cell["text"])
        pdf.showPage()
        samples.append({"id": name, "source": str(synthetic), "page": index+1,
                        "bbox": [x-8, top-8, x+4*cw+8, top+len(rows)*rh+8],
                        "expectedCells": expectation, "kind": "independent-synthetic", "isTable": True})
    pdf.setFont("Helvetica", 13)
    for i, line in enumerate(["Reliable conversion keeps source meaning intact.",
                              "This paragraph describes document processing.",
                              "It has no tabular rows or column relationships.",
                              "A structure recognizer must not invent a table."]):
        pdf.drawString(45, 330-i*23, line)
    pdf.showPage()
    pdf.save()
    samples.append({"id": "paragraph-negative", "source": str(synthetic), "page": 6,
                    "bbox": [35, 48, 530, 155], "expectedCells": [], "isTable": False, "kind": "negative-control"})
    # These physical regions were inspected in the rendered source before inference.
    def actual(name, file, page, image_box, rows, spans=()):
        samples.append({"id": name, "source": str(args.materials / file), "page": page,
                        "bbox": [v/1.5 for v in image_box], "expectedCells": cells(rows, spans),
                        "isTable": True, "kind": "source-visual-expectation", "groundTruthScope": "cell topology"})
    actual("bonanno-29-grid", "1512.06808v1.pdf", 29, [368, 182, 766, 342],
           [["0", "0", "0", "0", "0"], ["20", "0", "0", "0", "0"],
            ["20", "10", "0", "0", "0"], ["20", "10", "0", "0", "0"], ["20", "10", "0", "-10", "0"]])
    actual("bonanno-34-grid", "1512.06808v1.pdf", 34, [165, 129, 775, 269], [[""]*9 for _ in range(4)])
    actual("bonanno-581-nested", "1512.06808v1.pdf", 581, [232, 274, 859, 646], [[""]*4 for _ in range(4)])
    rows = [["Element", "Symbol", "Percentage of Body Mass (including water)", ""],
            ["Oxygen", "O", "65.0%", "96.3%"], ["Carbon", "C", "18.5%", ""],
            ["Hydrogen", "H", "9.5%", ""], ["Nitrogen", "N", "3.3%", ""],
            ["Calcium", "Ca", "1.5%", "3.7%"], ["Phosphorus", "P", "1.0%", ""],
            ["Potassium", "K", "0.4%", ""], ["Sulfur", "S", "0.3%", ""],
            ["Sodium", "Na", "0.2%", ""], ["Chlorine", "Cl", "0.2%", ""], ["Magnesium", "Mg", "0.1%", ""]]
    actual("campbell-78-grouped-percent", "Campbell Biology 12th.pdf", 78, [516, 685, 915, 994], rows,
           [(0, 2, 1, 2), (1, 3, 4, 1), (5, 3, 7, 1)])
    hashes = {}
    for sample in samples:
        source = sample["source"]
        if source not in hashes: hashes[source] = digest(source)
        sample["sourceSha256"] = hashes[source]
        window = out / (sample["id"] + ".pdf")
        with pdfium.PdfDocument(source) as original, pdfium.PdfDocument.new() as small:
            small.import_pages(original, pages=[sample["page"]-1])
            small.save(window)
        # A one-page window avoids loading the large source's full object tree.
        with pdfium.PdfDocument(window) as single, pdfplumber.open(window) as parsed:
            page = parsed.pages[0]
            image_box = sample["bbox"]
            # PDFium renders the visible page from (0, 0); pdfplumber retains
            # MediaBox/CropBox origins. Keep both coordinate frames explicit.
            media, crop = page.mediabox, page.cropbox or page.mediabox
            origin = [max(media[0], crop[0]), max(media[1], crop[1])]
            visible = [origin[0], origin[1], min(media[2], crop[2]), min(media[3], crop[3])]
            if any(abs(a-b) > .01 for a, b in zip(single[0].get_size(), [visible[2]-visible[0], visible[3]-visible[1]])):
                raise ValueError("Unverified render/parser coordinate transform")
            box = [value+origin[index % 2] for index, value in enumerate(image_box)]
            sample.update(bbox=box, imageBbox=image_box, imageOrigin=origin)
            scale = 2
            image = single[0].render(scale=scale).to_pil().convert("RGB")
            bounds = [round(v*scale) for v in image_box]
            crop = image.crop(bounds)
            image_path = out / (sample["id"] + ".png")
            crop.save(image_path)
            tokens = [{"id": n, "text": word["text"], "bbox": {
                "l": (word["x0"]-origin[0])*scale-bounds[0], "t": (word["top"]-origin[1])*scale-bounds[1],
                "r": (word["x1"]-origin[0])*scale-bounds[0], "b": (word["bottom"]-origin[1])*scale-bounds[1]}}
                for n, word in enumerate(page.crop(box).extract_words())]
            sample.update({"image": str(image_path), "imageSha256": digest(image_path), "tokens": tokens,
                           "width": crop.width, "height": crop.height,
                           "ruleBaseline": ruled_table_regions(page.crop(box), sample["page"])})
    manifest = {"schema": "schema-docs.table-model-trial-input.v2", "roiSource": "manually fixed oracle crop; excludes detector quality",
                "baselineMethod": "native ruled/aligned path before borderless inference; separate from the new production candidate",
                "fontSha256": digest(font_path), "samples": samples}
    (out / "inputs.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"samples": len(samples), "manifest": str(out / "inputs.json")}))


if __name__ == "__main__":
    main()
