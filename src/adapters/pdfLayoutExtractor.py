import argparse
import copy
import hashlib
import json
import re
import statistics
import sys
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    print("pdfplumber is not installed", file=sys.stderr)
    sys.exit(3)


MATH_FONT = re.compile(
    r"(?:math|symbol|cmmi|cmsy|cmex|msam|msbm|sfbm|sfrm|hfbr|sfrb)",
    re.IGNORECASE,
)
MATH_SIGNAL = re.compile(r"[=+\-*/^_<>\u00b1\u00d7\u00f7\u2200-\u22ff\u0370-\u03ff]")
BROKEN_FORMULA = re.compile(r"(?:\(cid:\d+\)|\\[0-7]{3})")
FIGURE_CAPTION = re.compile(r"\bFig(?:ure)?\.?\s*\d+(?:[-\u2013]\d+)+", re.IGNORECASE)

# pdfplumber exposes unmapped glyphs as ``(cid:N)``. The CID value is only
# meaningful inside its font, so these repairs are deliberately keyed by the
# embedded font family rather than applied globally.
CID_FONT_MAP = {
    "MSBM": {
        126: "\u210f",  # reduced Planck constant
    },
    "LMMathItalic": {
        15: "\u03b5",
    },
    "LMMathSymbols": {
        28: "\u226a",
        29: "\u226b",
    },
    "LMMathExtension": {
        0: "(",
        1: ")",
        18: "(",
        19: ")",
        20: "[",
        21: "]",
        26: "{",
    },
    "CMEX": {
        2: "[",
        3: "]",
        82: "\u222b",
    },
    "MSAM10": {
        0: "\u22a1",
        3: "\u25a1",
    },
    "HFBRSY": {
        28: "<",
        29: ">",
        31: "\u2299",
        48: "\u2032",
        105: "\u27e9",
    },
    "HFBRMI": {
        15: "\u03b5",
        96: "\u2113",
    },
}

# TeX's classic OMS/OML/OMX fonts place mathematical glyphs in ASCII slots.
# PDFs without ToUnicode maps therefore expose visually correct symbols as
# misleading ASCII. These compact maps cover the slots that materially affect
# readable equations while leaving ordinary Roman text untouched.
TEX_MATH_SYMBOL_ASCII_MAP = {"0": "\u2032"}
TEX_MATH_EXTENSION_ASCII_MAP = {
    "P": "\u2211", "Q": "\u220f", "R": "\u222b",
    "X": "\u2211", "Y": "\u220f", "Z": "\u222b",
}


def embedded_font_family(font_name):
    value = re.sub(r"^[A-Z]{6}\+", "", str(font_name or ""))
    return re.sub(r"-Regular$", "", value, flags=re.IGNORECASE)


def repair_known_cid_chars(page):
    repaired = 0
    for char in page.chars:
        match = re.fullmatch(r"\(cid:(\d+)\)", str(char.get("text", "")))
        if not match:
            continue
        family = embedded_font_family(char.get("fontname"))
        cid = int(match.group(1))
        matching_family = next((name for name in CID_FONT_MAP if family.startswith(name)), "")
        replacement = CID_FONT_MAP.get(matching_family, {}).get(cid)
        if replacement:
            char["text"] = replacement
            repaired += 1
    return repaired


def repair_tex_font_ascii_chars(page):
    repaired = 0
    for char in page.chars:
        text = str(char.get("text", ""))
        if len(text) != 1 or not text.isascii():
            continue
        family = embedded_font_family(char.get("fontname"))
        mapping = None
        if family.startswith(("LMMathSymbols", "CMSY", "HFBRSY")):
            mapping = TEX_MATH_SYMBOL_ASCII_MAP
        elif family.startswith(("LMMathExtension", "CMEX")):
            mapping = TEX_MATH_EXTENSION_ASCII_MAP
        replacement = mapping.get(text) if mapping else None
        if replacement and replacement != text:
            char["text"] = replacement
            repaired += 1
    return repaired


def compact_bbox(items):
    return [
        round(min(float(item.get("x0", 0)) for item in items), 2),
        round(min(float(item.get("top", 0)) for item in items), 2),
        round(max(float(item.get("x1", 0)) for item in items), 2),
        round(max(float(item.get("bottom", 0)) for item in items), 2),
    ]


def formula_regions(page, page_number):
    chars = sorted(page.chars, key=lambda item: (round(float(item.get("top", 0)), 1), float(item.get("x0", 0))))
    lines = []
    for char in chars:
        top = float(char.get("top", 0))
        target = None
        for line in reversed(lines[-3:]):
            if abs(line["top"] - top) <= 2.5:
                target = line
                break
        if target is None:
            target = {"top": top, "chars": []}
            lines.append(target)
        target["chars"].append(char)

    regions = []
    for line in lines:
        line_chars = sorted(line["chars"], key=lambda item: float(item.get("x0", 0)))
        text = "".join(str(item.get("text", "")) for item in line_chars).strip()
        if len(text) < 2:
            continue
        math_chars = [item for item in line_chars if MATH_FONT.search(str(item.get("fontname", "")))]
        math_ratio = len(math_chars) / max(1, len(line_chars))
        signal_count = len(MATH_SIGNAL.findall(text))
        cid_count = text.count("(cid:")
        if not (math_ratio >= 0.12 or (math_chars and signal_count >= 1) or cid_count >= 1):
            continue
        fonts = sorted({str(item.get("fontname", "")) for item in math_chars if item.get("fontname")})
        # TeX function names are short (sin/cos/exp/log). Longer alphabetic runs
        # are almost always captions, headings, diagram labels, or body prose.
        prose_like = bool(re.search(r"[A-Za-z]{5,}", text))
        editable_candidate = (
            math_ratio >= 0.45
            or (math_ratio >= 0.22 and signal_count >= 2 and len(text) <= 180)
        ) and not prose_like
        cjk_glyph = bool(re.search(r"[\u3400-\u9fff]", text))
        encoded_damage = bool(BROKEN_FORMULA.search(text)) and (math_ratio >= 0.2 or len(text) <= 40)
        broken = encoded_damage or (editable_candidate and cjk_glyph)
        bbox = compact_bbox(line_chars)
        display_math_line = (
            not prose_like
            and bbox[0] >= float(page.width) * 0.08
            and bbox[2] - bbox[0] <= float(page.width) * 0.78
        )
        regions.append({
            "type": "formula",
            "page": page_number,
            "bbox": bbox,
            "text": text[:500],
            "fontNames": fonts[:12],
            "mathRatio": round(math_ratio, 3),
            "signalCount": signal_count,
            "editableMathCandidate": editable_candidate and not broken,
            "confidence": "low" if broken else "medium",
            "needsVisualFallback": broken,
            "displayMathLine": display_math_line,
        })
    return regions


def merge_complex_formula_regions(regions):
    """Merge stacked baselines of fractions, matrices, and decorated equations."""
    ordered = sorted(regions, key=lambda region: (float(region["bbox"][1]), float(region["bbox"][0])))
    groups = []
    for region in ordered:
        is_formula_component = (
            region.get("editableMathCandidate")
            or region.get("needsVisualFallback")
            or region.get("displayMathLine")
        )
        if not is_formula_component:
            groups.append([region])
            continue
        if not groups:
            groups.append([region])
            continue
        previous_group = groups[-1]
        previous_box = union_bbox([entry["bbox"] for entry in previous_group])
        box = region["bbox"]
        vertical_gap = float(box[1]) - float(previous_box[3])
        horizontal_near = not (float(previous_box[2]) + 18.0 < float(box[0]) or float(box[2]) + 18.0 < float(previous_box[0]))
        previous_is_formula = any(
            entry.get("editableMathCandidate")
            or entry.get("needsVisualFallback")
            or entry.get("displayMathLine")
            for entry in previous_group
        )
        damaged_stack = region.get("needsVisualFallback") or any(entry.get("needsVisualFallback") for entry in previous_group)
        display_stack = region.get("displayMathLine") and any(entry.get("displayMathLine") for entry in previous_group)
        maximum_gap = 12.0 if damaged_stack or display_stack else 6.5
        if previous_is_formula and horizontal_near and -12.0 <= vertical_gap <= maximum_gap:
            previous_group.append(region)
        else:
            groups.append([region])

    merged = []
    for group in groups:
        if len(group) == 1:
            single = group[0]
            compact_text = normalize_line(single.get("text", ""))
            if single.get("editableMathCandidate") and single.get("signalCount", 0) == 0 and len(compact_text) <= 6:
                single["editableMathCandidate"] = False
            merged.append(single)
            continue
        source_texts = [str(entry.get("text", "")) for entry in group if entry.get("text")]
        merged.append({
            "type": "formula",
            "page": group[0]["page"],
            "bbox": [round(value, 2) for value in union_bbox([entry["bbox"] for entry in group])],
            "text": " ".join(source_texts)[:2000],
            "sourceTexts": source_texts,
            "fontNames": sorted({font for entry in group for font in entry.get("fontNames", [])})[:20],
            "mathRatio": round(max(float(entry.get("mathRatio", 0)) for entry in group), 3),
            "signalCount": sum(int(entry.get("signalCount", 0)) for entry in group),
            "editableMathCandidate": False,
            "confidence": "low",
            "needsVisualFallback": True,
            "complexFormula": True,
            "displayMathLine": True,
        })
    return merged


def image_regions(page, page_number):
    regions = []
    for image in page.images:
        regions.append({
            "type": "image",
            "subtype": "raster",
            "page": page_number,
            "bbox": [
                round(float(image.get("x0", 0)), 2),
                round(float(image.get("top", 0)), 2),
                round(float(image.get("x1", 0)), 2),
                round(float(image.get("bottom", 0)), 2),
            ],
            "confidence": "high",
            "needsVisualFallback": True,
        })
    return regions


def object_bbox(item):
    try:
        x0 = float(item.get("x0", 0))
        x1 = float(item.get("x1", x0))
        top = float(item.get("top", item.get("y0", 0)))
        bottom = float(item.get("bottom", item.get("y1", top)))
        if x1 < x0:
            x0, x1 = x1, x0
        if bottom < top:
            top, bottom = bottom, top
        return [x0, top, x1, bottom]
    except Exception:
        return None


def union_bbox(boxes):
    return [
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    ]


def boxes_near(first, second, margin=12.0):
    return not (
        first[2] + margin < second[0]
        or second[2] + margin < first[0]
        or first[3] + margin < second[1]
        or second[3] + margin < first[1]
    )


def bbox_overlap_ratio(first, second):
    left = max(float(first[0]), float(second[0]))
    top = max(float(first[1]), float(second[1]))
    right = min(float(first[2]), float(second[2]))
    bottom = min(float(first[3]), float(second[3]))
    if right <= left or bottom <= top:
        return 0.0
    intersection = (right - left) * (bottom - top)
    first_area = max(1.0, (float(first[2]) - float(first[0])) * (float(first[3]) - float(first[1])))
    return intersection / first_area


def prose_boundary_before_caption(lines, caption_top, body_size, page_width):
    """Return the bottom of the last body-text line before a figure."""
    boundary = 0.0
    for line in lines:
        ordered = sorted(line["words"], key=lambda item: float(item.get("x0", 0)))
        if not ordered:
            continue
        top = min(float(item.get("top", 0)) for item in ordered)
        bottom = max(float(item.get("bottom", top)) for item in ordered)
        if bottom > caption_top - 10.0:
            continue
        text = " ".join(str(item.get("text", "")) for item in ordered).strip()
        if not text or FIGURE_CAPTION.match(text):
            continue
        sizes = [float(item.get("size", 0)) for item in ordered if float(item.get("size", 0)) > 0]
        line_size = statistics.median(sizes) if sizes else 0.0
        if body_size and line_size < body_size - 0.25:
            continue
        words = re.findall(r"[A-Za-z]{2,}", text)
        alpha_count = sum(char.isalpha() for char in text)
        line_width = max(float(item.get("x1", 0)) for item in ordered) - min(float(item.get("x0", 0)) for item in ordered)
        sentence_end = bool(re.search(r"[.!?][\"')\]]?\s*$", text))
        dense_prose = len(words) >= 5 and alpha_count >= 20 and line_width >= page_width * 0.28
        compressed_prose = alpha_count >= 35 and line_width >= page_width * 0.28
        short_sentence = len(words) >= 1 and alpha_count >= 10 and sentence_end
        if dense_prose or compressed_prose or short_sentence:
            boundary = max(boundary, bottom)
    return boundary


def figure_regions(page, page_number):
    """Map vector figures that PDF image-object enumeration misses."""
    try:
        words = page.extract_words(
            use_text_flow=True,
            keep_blank_chars=False,
            extra_attrs=["fontname", "size"],
        ) or []
    except Exception:
        return []
    lines = []
    for word in sorted(words, key=lambda item: (round(float(item.get("top", 0)), 1), float(item.get("x0", 0)))):
        top = float(word.get("top", 0))
        target = next((line for line in reversed(lines[-3:]) if abs(line["top"] - top) <= 3.0), None)
        if target is None:
            target = {"top": top, "words": []}
            lines.append(target)
        target["words"].append(word)

    regions = []
    page_sizes = [float(word.get("size", 0)) for word in words if float(word.get("size", 0)) > 0]
    body_size = statistics.median(page_sizes) if page_sizes else 0.0
    for line in lines:
        ordered = sorted(line["words"], key=lambda item: float(item.get("x0", 0)))
        caption = " ".join(str(item.get("text", "")) for item in ordered).strip()
        if not re.match(r"^\s*Fig(?:ure)?\.?\s*\d+(?:[-\u2013]\d+)+", caption, re.IGNORECASE):
            continue
        caption_top = min(float(item.get("top", 0)) for item in ordered)
        caption_bottom = max(float(item.get("bottom", caption_top)) for item in ordered)
        caption_sizes = [float(item.get("size", 0)) for item in ordered if float(item.get("size", 0)) > 0]
        caption_size = statistics.median(caption_sizes) if caption_sizes else body_size
        caption_words = list(ordered)
        for following_line in sorted(lines, key=lambda entry: float(entry["top"])):
            following_words = sorted(following_line["words"], key=lambda item: float(item.get("x0", 0)))
            if not following_words:
                continue
            following_top = min(float(item.get("top", 0)) for item in following_words)
            if following_top <= caption_top + 1.0:
                continue
            gap = following_top - caption_bottom
            if gap > max(5.0, caption_size * 0.9):
                break
            following_sizes = [float(item.get("size", 0)) for item in following_words if float(item.get("size", 0)) > 0]
            following_size = statistics.median(following_sizes) if following_sizes else 0.0
            if following_size > caption_size + 0.5:
                break
            following_text = " ".join(str(item.get("text", "")) for item in following_words).strip()
            if not following_text or FIGURE_CAPTION.match(following_text):
                break
            caption_words.extend(following_words)
            caption_bottom = max(caption_bottom, max(float(item.get("bottom", following_top)) for item in following_words))
            caption = f"{caption} {following_text}".strip()
        ordered = caption_words
        previous_caption_bottom = 0.0
        for previous_line in lines:
            if float(previous_line["top"]) >= caption_top:
                continue
            previous_words = sorted(previous_line["words"], key=lambda item: float(item.get("x0", 0)))
            previous_text = " ".join(str(item.get("text", "")) for item in previous_words).strip()
            if re.match(r"^\s*Fig(?:ure)?\.?\s*\d+(?:[-\u2013]\d+)+", previous_text, re.IGNORECASE):
                previous_caption_bottom = max(
                    previous_caption_bottom,
                    max(float(item.get("bottom", 0)) for item in previous_words),
                )
        prose_boundary = prose_boundary_before_caption(lines, caption_top, body_size, float(page.width))
        figure_top_limit = max(
            0.0,
            caption_top - 360.0,
            previous_caption_bottom + 6.0,
            prose_boundary + 4.0,
        )
        primitive_boxes = []
        for primitive in list(page.lines) + list(page.curves) + list(page.rects):
            box = object_bbox(primitive)
            if not box:
                continue
            width = box[2] - box[0]
            height = box[3] - box[1]
            if width < 0.8 and height < 0.8:
                continue
            if box[1] < figure_top_limit or box[3] > caption_top + 8.0:
                continue
            primitive_boxes.append(box)

        # Start at the visual primitive closest to the caption, then grow through
        # connected primitives. This avoids the old fixed 220pt half-page crop.
        seeds = [box for box in primitive_boxes if caption_top - 70.0 <= box[3] <= caption_top + 8.0]
        if not seeds:
            continue
        selected = list(seeds)
        selected_ids = {id(box) for box in selected}
        changed = True
        while changed:
            changed = False
            current = union_bbox(selected)
            for box in primitive_boxes:
                if id(box) in selected_ids:
                    continue
                if boxes_near(current, box, margin=14.0):
                    selected.append(box)
                    selected_ids.add(id(box))
                    changed = True

        # Multi-panel figures often contain disconnected vector components. Add
        # components in the same horizontal figure column, but never cross an
        # earlier figure caption on the page.
        anchor = union_bbox(selected)
        for box in primitive_boxes:
            if id(box) in selected_ids or box[1] < figure_top_limit or box[3] > caption_top + 8.0:
                continue
            width = max(1.0, box[2] - box[0])
            anchor_width = max(1.0, anchor[2] - anchor[0])
            overlap = max(0.0, min(anchor[2], box[2]) - max(anchor[0], box[0]))
            center = (box[0] + box[2]) / 2.0
            horizontally_related = (
                overlap / min(width, anchor_width) >= 0.25
                or anchor[0] - 24.0 <= center <= anchor[2] + 24.0
            )
            page_rule = width >= float(page.width) * 0.85 and box[3] - box[1] <= 1.5
            if horizontally_related and not page_rule:
                selected.append(box)
                selected_ids.add(id(box))

        visual = union_bbox(selected)
        # Include labels that sit inside or immediately around the vector drawing.
        nearby_words = []
        expanded = [visual[0] - 14.0, visual[1] - 14.0, visual[2] + 14.0, visual[3] + 14.0]
        for word in words:
            box = object_bbox(word)
            word_sizes = [float(word.get("size", 0))] if float(word.get("size", 0)) > 0 else []
            word_size = statistics.median(word_sizes) if word_sizes else 0.0
            small_figure_label = bool(body_size and word_size <= body_size - 0.75)
            if (
                box
                and box[1] >= figure_top_limit - 1.0
                and box[1] >= visual[1] - 10.0
                and (small_figure_label or boxes_near(expanded, box, margin=0.0))
                and box[3] <= caption_top + 3.0
            ):
                nearby_words.append(box)
        if nearby_words:
            visual = union_bbox([visual] + nearby_words)
        crop_top = max(0.0, figure_top_limit, visual[1] - 10.0)
        figure_left = max(0.0, visual[0] - 10.0)
        figure_right = min(float(page.width), visual[2] + 10.0)
        figure_bottom = max(crop_top, caption_top - 2.0)
        regions.append({
            "type": "image",
            "subtype": "figure",
            "page": page_number,
            "bbox": [
                figure_left,
                crop_top,
                figure_right,
                figure_bottom,
            ],
            "contentBbox": [
                figure_left,
                crop_top,
                figure_right,
                figure_bottom,
            ],
            "caption": caption[:500],
            "confidence": "medium",
            "needsVisualFallback": True,
        })
    return regions


def normalized_table_cells(rows):
    cells = [[str(cell or "")[:2000] for cell in row[:60]] for row in rows[:2000]]
    return [row for row in cells if any(str(cell).strip() for cell in row)]


def table_region_from_object(table, page_number, detection="ruled"):
    rows = table.extract() or []
    cells = normalized_table_cells(rows)
    nonempty = sum(1 for row in cells for cell in row if str(cell).strip())
    if len(cells) < 2 or nonempty < 2:
        return None
    flattened = " ".join(cell for row in cells for cell in row)
    math_symbols = len(re.findall(r"[=+\-*/^_<>\u00b1\u00d7\u00f7\u2200-\u22ff\u0370-\u03ff\uf8e0-\uf8ff]", flattened))
    private_glyphs = len(re.findall(r"[\ue000-\uf8ff]", flattened))
    line_breaks = sum(str(cell).count("\n") for row in cells for cell in row)
    formula_dense = (
        private_glyphs > 0
        or math_symbols >= 18
        or (math_symbols >= 8 and line_breaks >= 12)
        or line_breaks >= 45
    )
    return {
        "type": "table",
        "page": page_number,
        "bbox": [round(float(value), 2) for value in table.bbox],
        "rows": cells,
        "rowCount": len(cells),
        "columnCount": max((len(row) for row in cells), default=0),
        "detection": detection,
        "confidence": "medium",
        "needsVisualFallback": formula_dense,
    }


def captioned_visual_table_region(page, page_number):
    """Preserve layout tables that have a caption but no reliable cell grid."""
    try:
        words = page.extract_words(use_text_flow=True, keep_blank_chars=False, extra_attrs=["size"]) or []
    except Exception:
        return None
    lines = []
    for word in sorted(words, key=lambda item: (round(float(item.get("top", 0)), 1), float(item.get("x0", 0)))):
        top = float(word.get("top", 0))
        line = next((entry for entry in reversed(lines[-3:]) if abs(entry["top"] - top) <= 3.0), None)
        if line is None:
            line = {"top": top, "words": []}
            lines.append(line)
        line["words"].append(word)
    caption_index = -1
    for index, line in enumerate(lines):
        text = " ".join(str(word.get("text", "")) for word in sorted(line["words"], key=lambda item: float(item.get("x0", 0)))).strip()
        if re.search(r"\bTable\s*\d+(?:[-\u2013]\d+)*\b", text, re.IGNORECASE):
            caption_index = index
            break
    if caption_index < 0:
        return None
    caption_words = lines[caption_index]["words"]
    top = max(0.0, min(float(word.get("top", 0)) for word in caption_words) - 3.0)
    bottom = None
    for line in lines[caption_index + 1:]:
        ordered = sorted(line["words"], key=lambda item: float(item.get("x0", 0)))
        text = " ".join(str(word.get("text", "")) for word in ordered).strip()
        if not text:
            continue
        alpha = sum(char.isalpha() for char in text)
        word_count = len(re.findall(r"[A-Za-z]{2,}", text))
        width = max(float(word.get("x1", 0)) for word in ordered) - min(float(word.get("x0", 0)) for word in ordered)
        if word_count >= 8 and alpha >= 45 and width >= float(page.width) * 0.55:
            bottom = min(float(word.get("top", 0)) for word in ordered) - 4.0
            break
    if bottom is None or bottom - top < 45.0:
        return None
    return {
        "type": "table",
        "page": page_number,
        "bbox": [18.0, round(top, 2), round(float(page.width) - 18.0, 2), round(bottom, 2)],
        "rows": [],
        "rowCount": 0,
        "columnCount": 0,
        "detection": "captioned_visual",
        "confidence": "medium",
        "needsVisualFallback": True,
    }


def table_regions(page, page_number, excluded_regions=None, formula_candidates=None):
    page_text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
    has_table_caption = bool(re.search(r"\bTable\s+\d+(?:[-\u2013]\d+)*\b", page_text, re.IGNORECASE))
    if len(page.lines) + len(page.rects) < 4 and not has_table_caption:
        return []
    try:
        tables = page.find_tables()
    except Exception:
        tables = []
    regions = []
    for table in tables:
        table_box = [float(value) for value in table.bbox]
        if any(
            bbox_overlap_ratio(table_box, region.get("contentBbox") or region.get("bbox")) >= 0.3
            for region in (excluded_regions or [])
        ):
            continue
        region = table_region_from_object(table, page_number)
        if region:
            regions.append(region)

    # Scientific tables often have vertical separators but no complete outer
    # grid. pdfplumber's ruled-table strategy then sees only a few inner
    # columns, while the formula detector sees the whole numeric block. When a
    # real Table caption is present, recover the columns from aligned text
    # inside that block instead of preserving half a page as a formula image.
    if has_table_caption:
        text_settings = {
            "vertical_strategy": "text",
            "horizontal_strategy": "text",
            "min_words_vertical": 2,
            "min_words_horizontal": 1,
            "text_tolerance": 3,
        }
        for formula in formula_candidates or []:
            box = [float(value) for value in formula.get("bbox", [])]
            if len(box) != 4 or not formula.get("needsVisualFallback"):
                continue
            if box[2] - box[0] < 80.0 or box[3] - box[1] < 45.0:
                continue
            numeric_tokens = re.findall(r"(?<![A-Za-z])[-+\u2212]?\d+(?:\.\d+)?", str(formula.get("text", "")))
            if len(numeric_tokens) < 8:
                continue
            crop_box = (
                max(0.0, box[0]),
                max(0.0, box[1]),
                min(float(page.width), box[2]),
                min(float(page.height), box[3]),
            )
            try:
                candidates = page.crop(crop_box).find_tables(text_settings)
            except Exception:
                continue
            recovered = [
                table_region_from_object(candidate, page_number, detection="aligned_text")
                for candidate in candidates
            ]
            recovered = [candidate for candidate in recovered if candidate and candidate.get("columnCount", 0) >= 3]
            if not recovered:
                continue
            candidate = max(
                recovered,
                key=lambda entry: entry.get("rowCount", 0) * entry.get("columnCount", 0),
            )
            overlapping = [
                entry for entry in regions
                if bbox_overlap_ratio(entry["bbox"], candidate["bbox"]) >= 0.5
            ]
            if overlapping and max(entry.get("columnCount", 0) for entry in overlapping) >= candidate.get("columnCount", 0):
                continue
            regions = [entry for entry in regions if entry not in overlapping]
            regions.append(candidate)
        if not regions:
            visual_table = captioned_visual_table_region(page, page_number)
            if visual_table:
                regions.append(visual_table)
    # Nested ruling lines can make pdfplumber report a second table wholly
    # inside the real one. Keep the richer candidate instead of emitting both.
    ranked = sorted(
        regions,
        key=lambda entry: (
            float(entry["bbox"][2] - entry["bbox"][0]) * float(entry["bbox"][3] - entry["bbox"][1]),
            entry.get("rowCount", 0) * entry.get("columnCount", 0),
        ),
        reverse=True,
    )
    deduplicated = []
    for candidate in ranked:
        if any(bbox_overlap_ratio(candidate["bbox"], kept["bbox"]) >= 0.72 for kept in deduplicated):
            continue
        deduplicated.append(candidate)
    return sorted(deduplicated, key=lambda entry: (entry["bbox"][1], entry["bbox"][0]))


def extract_page_text(page, excluded_regions=None):
    excluded_boxes = [
        region.get("contentBbox")
        for region in (excluded_regions or [])
        if region.get("contentBbox")
    ]
    if excluded_boxes:
        def keep_object(item):
            if item.get("object_type") != "char":
                return True
            center_x = (float(item.get("x0", 0)) + float(item.get("x1", 0))) / 2.0
            center_y = (float(item.get("top", 0)) + float(item.get("bottom", 0))) / 2.0
            return not any(
                float(box[0]) <= center_x <= float(box[2])
                and float(box[1]) <= center_y <= float(box[3])
                for box in excluded_boxes
            )

        page = page.filter(keep_object)
    return page.extract_text(layout=True, x_tolerance=2, y_tolerance=3) or ""


def inject_formula_fallback_markers(page, formulas, page_number):
    """Replace visually preserved equations in the text flow at their source Y position."""
    chars = page.chars
    template = copy.copy(chars[0]) if chars else None
    if template is None:
        return
    for formula in formulas:
        asset_file = formula.get("assetFile")
        if not formula.get("needsVisualFallback") or not asset_file:
            continue
        x0, top, x1, bottom = [float(value) for value in formula["bbox"]]
        chars[:] = [
            char for char in chars
            if not (
                x0 - 2.0 <= (float(char.get("x0", 0)) + float(char.get("x1", 0))) / 2.0 <= x1 + 2.0
                and top - 2.0 <= (float(char.get("top", 0)) + float(char.get("bottom", 0))) / 2.0 <= bottom + 2.0
            )
        ]
        marker = (
            f"<!-- pdf-formula: page={page_number} "
            f"index={int(formula.get('fallbackIndex', 0))} file={asset_file} -->"
        )
        synthetic = copy.copy(template)
        synthetic_width = min(float(page.width) - x0, max(20.0, len(marker) * 4.0))
        synthetic.update({
            "object_type": "char",
            "text": marker,
            "fontname": "SchemaDocsFormulaMarker",
            "size": 9.0,
            "x0": x0,
            "x1": x0 + synthetic_width,
            "top": top,
            "bottom": top + 9.0,
            "doctop": float(page.initial_doctop) + top,
            "width": synthetic_width,
            "height": 9.0,
            "upright": True,
        })
        chars.append(synthetic)
        formula["inlinePlaceholder"] = True


def inject_table_markers(page, tables, page_number):
    """Replace table source characters with one marker at the table's location."""
    chars = page.chars
    template = copy.copy(chars[0]) if chars else None
    if template is None:
        return
    for table_index, table in enumerate(tables, start=1):
        visual_file = table.get("assetFile") if table.get("needsVisualFallback") else ""
        if not visual_file and not markdown_table(table):
            continue
        x0, top, x1, bottom = [float(value) for value in table["bbox"]]
        chars[:] = [
            char for char in chars
            if not (
                x0 - 2.0 <= (float(char.get("x0", 0)) + float(char.get("x1", 0))) / 2.0 <= x1 + 2.0
                and top - 2.0 <= (float(char.get("top", 0)) + float(char.get("bottom", 0))) / 2.0 <= bottom + 2.0
            )
        ]
        marker = f"<!-- pdf-table: page={page_number} index={table_index}"
        if visual_file:
            marker += f" file={visual_file}"
        marker += " -->"
        synthetic = copy.copy(template)
        synthetic_width = min(float(page.width) - x0, max(20.0, len(marker) * 4.0))
        synthetic.update({
            "object_type": "char",
            "text": marker,
            "fontname": "SchemaDocsTableMarker",
            "size": 9.0,
            "x0": x0,
            "x1": x0 + synthetic_width,
            "top": top,
            "bottom": top + 9.0,
            "doctop": float(page.initial_doctop) + top,
            "width": synthetic_width,
            "height": 9.0,
            "upright": True,
        })
        chars.append(synthetic)
        table["inlinePlaceholder"] = True
        table["marker"] = marker


def normalize_line(value):
    return re.sub(r"\s+", "", str(value or "")).strip()


def normalize_layout_indentation(text):
    """Remove PDF page-coordinate indentation without changing inline spacing."""
    return "\n".join(line.lstrip(" \t").rstrip() for line in str(text or "").splitlines())


def enrich_text_with_math(text, formulas, page_number):
    """Replace intact formula-only lines with editable Markdown math blocks."""
    candidates = [region for region in formulas if region.get("editableMathCandidate")]
    fallbacks = [region for region in formulas if region.get("needsVisualFallback") and region.get("assetFile")]
    emitted_fallbacks = {
        int(region.get("fallbackIndex", 0))
        for region in fallbacks
        if region.get("inlinePlaceholder")
    }
    output = []
    for raw_line in str(text or "").splitlines():
        stripped = raw_line.strip()
        normalized = normalize_line(stripped)
        if "(cid:" in stripped and len(normalized) <= 180 and not re.search(r"[A-Za-z]{5,}", stripped):
            # These glyph IDs have no usable Unicode meaning. Their source region
            # is rendered as a formula image, so retaining the encoded line only
            # duplicates the equation as visible garbage.
            continue
        matched = None
        fallback_match = None
        if normalized:
            for region in fallbacks:
                source_texts = region.get("sourceTexts") or [region.get("text", "")]
                for source_text in source_texts:
                    source_normalized = normalize_line(source_text)
                    if not source_normalized:
                        continue
                    shorter = min(len(normalized), len(source_normalized))
                    longer = max(len(normalized), len(source_normalized))
                    same_line = normalized == source_normalized or source_normalized in normalized or normalized in source_normalized
                    if same_line and shorter / max(1, longer) >= 0.72:
                        fallback_match = region
                        break
                if fallback_match:
                    break
        if fallback_match:
            fallback_id = int(fallback_match.get("fallbackIndex", 0))
            if fallback_id not in emitted_fallbacks:
                output.extend(["", f"<!-- pdf-formula: page={page_number} index={fallback_id} file={fallback_match['assetFile']} -->", ""])
                emitted_fallbacks.add(fallback_id)
                fallback_match["inlinePlaceholder"] = True
            continue
        if normalized:
            for region in candidates:
                formula_text = str(region.get("text", "")).strip()
                formula_normalized = normalize_line(formula_text)
                if not formula_normalized:
                    continue
                shorter = min(len(normalized), len(formula_normalized))
                longer = max(len(normalized), len(formula_normalized))
                same_line = normalized == formula_normalized or formula_normalized in normalized or normalized in formula_normalized
                if same_line and shorter / max(1, longer) >= 0.72:
                    matched = formula_text
                    break
        if matched:
            output.extend(["", "$$", matched.replace("$", r"\$"), "$$", ""])
        else:
            output.append(raw_line.rstrip())
    return "\n".join(output).strip()


def markdown_table(region):
    if region.get("needsVisualFallback"):
        return ""
    rows = region.get("rows") or []
    if not rows:
        return ""
    width = max((len(row) for row in rows), default=0)
    if width <= 0:
        return ""
    normalized = []
    for row in rows:
        cells = [
            re.sub(r"\s*\n\s*", "; ", str(cell or "")).replace("|", r"\|").strip()
            for cell in row
        ]
        normalized.append(cells + [""] * (width - len(cells)))
    lines = [
        "| " + " | ".join(normalized[0]) + " |",
        "| " + " | ".join(["---"] * width) + " |",
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in normalized[1:])
    return "\n".join(lines)


def expand_table_markers(text, tables):
    output = str(text or "")
    for table in tables:
        marker = table.get("marker")
        rendered = markdown_table(table)
        if marker and rendered and marker in output:
            output = output.replace(marker, f"\n\n{rendered}\n\n", 1)
        elif marker:
            table["inlinePlaceholder"] = False
    return output


def render_visual_regions(page, page_number, regions, asset_dir, allow_reuse=False, resolution=144):
    if not asset_dir or not regions:
        return
    pending = []
    for index, region in enumerate(regions):
        kind = region.get("type") if region.get("type") in {"formula", "table"} else "figure"
        bbox_key = ",".join(f"{float(value):.2f}" for value in region.get("bbox", []))
        fingerprint = hashlib.sha1(bbox_key.encode("ascii", "ignore")).hexdigest()[:8]
        file_name = f"page-{page_number:06d}-{kind}-{index:03d}-{fingerprint}.png"
        target = asset_dir / file_name
        if allow_reuse and target.is_file() and target.stat().st_size > 0:
            region["assetFile"] = file_name
            region["assetStatus"] = "reused"
        else:
            pending.append((index, region, kind, file_name, target))
    if not pending:
        return
    try:
        page_image = page.to_image(resolution=resolution, antialias=True).original
    except Exception as error:
        for region in regions:
            region["assetStatus"] = "failed"
            region["assetError"] = str(error)
        return
    scale = float(resolution) / 72.0
    for index, region, kind, file_name, target in pending:
        try:
            x0, top, x1, bottom = [float(value) for value in region["bbox"]]
            padding = 8 if region.get("type") == "formula" else 0
            crop = (
                max(0, int(x0 * scale) - padding),
                max(0, int(top * scale) - padding),
                min(page_image.width, int(x1 * scale) + padding),
                min(page_image.height, int(bottom * scale) + padding),
            )
            if crop[2] <= crop[0] or crop[3] <= crop[1]:
                raise ValueError("empty visual crop")
            page_image.crop(crop).save(target, "PNG", optimize=True)
            region["assetFile"] = file_name
            region["assetStatus"] = "rendered"
        except Exception as error:
            region["assetStatus"] = "failed"
            region["assetError"] = str(error)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("markdown_output")
    parser.add_argument("manifest_output")
    parser.add_argument("--start-page", type=int, default=1)
    parser.add_argument("--max-pages", type=int, default=0)
    parser.add_argument("--asset-dir", default="")
    args = parser.parse_args()

    source = Path(args.source)
    markdown_path = Path(args.markdown_output)
    manifest_path = Path(args.manifest_output)
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    asset_dir = Path(args.asset_dir) if args.asset_dir else None
    allow_asset_reuse = False
    if asset_dir:
        asset_dir.mkdir(parents=True, exist_ok=True)
        previous_map = asset_dir / "visual-map.json"
        if previous_map.is_file():
            try:
                previous = json.loads(previous_map.read_text(encoding="utf-8"))
                allow_asset_reuse = previous.get("sourceFile") == source.name
            except Exception:
                allow_asset_reuse = False

    markdown_lines = [f"# {source.stem}", ""]
    pages_with_regions = []
    total_formula_regions = 0
    total_image_regions = 0
    total_table_regions = 0
    cid_artifacts = 0
    repaired_cid_artifacts = 0
    repaired_math_glyphs = 0
    rendered_images = 0

    with pdfplumber.open(source) as document:
        start_index = max(0, min(len(document.pages), args.start_page - 1))
        end_index = len(document.pages) if args.max_pages <= 0 else min(start_index + args.max_pages, len(document.pages))
        for page_index in range(start_index, end_index):
            page = document.pages[page_index]
            page_number = page_index + 1
            repaired_cid_artifacts += repair_known_cid_chars(page)
            repaired_math_glyphs += repair_tex_font_ascii_chars(page)
            formulas = merge_complex_formula_regions(formula_regions(page, page_number))
            images = image_regions(page, page_number) + figure_regions(page, page_number)
            tables = table_regions(page, page_number, images, formulas)
            formulas = [
                formula for formula in formulas
                if not any(
                    bbox_overlap_ratio(formula["bbox"], region["bbox"]) >= 0.55
                    for region in tables + images
                )
            ]
            broken_formulas = [formula for formula in formulas if formula.get("needsVisualFallback")]
            for formula_index, formula in enumerate(broken_formulas, start=1):
                formula["fallbackIndex"] = formula_index
            visual_tables = [table for table in tables if table.get("needsVisualFallback")]
            render_visual_regions(page, page_number, images + broken_formulas + visual_tables, asset_dir, allow_asset_reuse)
            rendered_images += sum(1 for image in images if image.get("assetStatus") in {"rendered", "reused"})
            inject_formula_fallback_markers(page, broken_formulas, page_number)
            inject_table_markers(page, tables, page_number)

            text = extract_page_text(page, images)
            text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text).rstrip()
            text = normalize_layout_indentation(text)
            enriched_text = enrich_text_with_math(text, formulas, page_number)
            enriched_text = expand_table_markers(enriched_text, tables)
            cid_artifacts += enriched_text.count("(cid:")
            markdown_lines.extend([f"<!-- pdf-page: {page_number} -->", "", enriched_text, ""])
            for table_index, table in enumerate(tables, start=1):
                rendered_table = markdown_table(table)
                if rendered_table and not table.get("inlinePlaceholder"):
                    markdown_lines.extend([f"<!-- pdf-table: page={page_number} index={table_index} -->", "", rendered_table, ""])
            for image_index, image in enumerate(images, start=1):
                if image.get("assetFile"):
                    markdown_lines.extend([f"<!-- pdf-image: page={page_number} index={image_index} file={image['assetFile']} -->", ""])
            for formula_index, formula in enumerate(broken_formulas, start=1):
                if formula.get("assetFile") and not formula.get("inlinePlaceholder"):
                    markdown_lines.extend([f"<!-- pdf-formula: page={page_number} index={formula_index} file={formula['assetFile']} -->", ""])

            regions = formulas + images + tables
            total_formula_regions += len(formulas)
            total_image_regions += len(images)
            total_table_regions += len(tables)
            if regions:
                pages_with_regions.append({
                    "page": page_number,
                    "width": round(float(page.width), 2),
                    "height": round(float(page.height), 2),
                    "regions": regions,
                })

        manifest = {
            "schema": "schema-docs.pdf-visual-map.v2",
            "sourceFile": source.name,
            "pageCount": len(document.pages),
            "pageRange": {
                "start": start_index + 1 if start_index < len(document.pages) else 0,
                "end": end_index,
            },
            "pagesAnalyzed": max(0, end_index - start_index),
            "summary": {
                "formulaRegions": total_formula_regions,
                "imageRegions": total_image_regions,
                "renderedImages": rendered_images,
                "tableRegions": total_table_regions,
                "cidArtifacts": cid_artifacts,
                "repairedCidArtifacts": repaired_cid_artifacts,
                "repairedMathGlyphs": repaired_math_glyphs,
                "pagesWithVisualRegions": len(pages_with_regions),
            },
            "pages": pages_with_regions,
        }

    markdown_path.write_text("\n".join(markdown_lines).strip() + "\n", encoding="utf-8")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, **manifest["summary"], "pageCount": manifest["pageCount"]}))


if __name__ == "__main__":
    main()
