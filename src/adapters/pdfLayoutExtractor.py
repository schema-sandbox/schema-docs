import argparse
import copy
import hashlib
import json
import re
import statistics
import sys
from pathlib import Path

try:
    from .pdfInlineMath import (
        CID_ENCODING_FALLBACK,
        CID_FONT_MAP,
        EXTENSION_DELIMITERS,
        LATEX_CHAR_MAP,
        LATEX_MAP_COMMANDS,
        split_trailing_sentence_period,
        TEX_MATH_EXTENSION_ASCII_MAP,
        TEX_MATH_ITALIC_ASCII_MAP,
        TEX_MATH_SYMBOL_ASCII_MAP,
        collapse_extension_delimiter_segments,
        embedded_font_family,
        has_display_formula_semantics,
        has_math_operand,
        is_extension_delimiter,
        is_operator_only_text,
        is_valid_editable_latex,
        latex_char,
        normalize_reconstructed_latex,
        recover_inline_script_attachment,
        strip_prose_from_formula,
    )
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from pdfInlineMath import (
        CID_ENCODING_FALLBACK,
        CID_FONT_MAP,
        EXTENSION_DELIMITERS,
        LATEX_CHAR_MAP,
        LATEX_MAP_COMMANDS,
        split_trailing_sentence_period,
        TEX_MATH_EXTENSION_ASCII_MAP,
        TEX_MATH_ITALIC_ASCII_MAP,
        TEX_MATH_SYMBOL_ASCII_MAP,
        collapse_extension_delimiter_segments,
        embedded_font_family,
        has_display_formula_semantics,
        has_math_operand,
        is_extension_delimiter,
        is_operator_only_text,
        is_valid_editable_latex,
        latex_char,
        normalize_reconstructed_latex,
        recover_inline_script_attachment,
        strip_prose_from_formula,
    )


MATH_FONT = re.compile(
    r"(?:math|symbol|cmmi|cmsy|cmex|msam|msbm|sfbm|sfrm|hfbr|sfrb)",
    re.IGNORECASE,
)
MATH_SIGNAL = re.compile(r"[=+\-*/^_<>\u00b1\u00d7\u00f7\u2200-\u22ff\u0370-\u03ff]")
BROKEN_FORMULA = re.compile(r"(?:\(cid:\d+\)|\\[0-7]{3})")
FIGURE_CAPTION = re.compile(r"\bFig(?:ure)?\.?\s*\d+(?:[-\u2013]\d+)+", re.IGNORECASE)


def formula_requires_visual_fallback(source_text, latex=""):
    """Return True when editable text would hide obvious semantic damage.

    A syntactically valid TeX string is not necessarily a faithful equation.
    Unmapped glyphs, prose fused into an equation, and repeated relation
    operators with no corresponding operands are safer as source-linked
    visual crops than as confidently editable mathematics.
    """
    source = str(source_text or "")
    rendered = str(latex or source)
    combined = f"{source} {rendered}"
    if re.search(r"(?:\(cid:\d+\)|\\[0-2][0-7]{2}|[\uE000-\uF8FF]|\uFFFD|\u25A1)", combined):
        return True

    compact = re.sub(r"\s+", "", combined).lower()
    if re.search(
        r"(?:isthe(?:inverse|identity)|theinverseof|identityelement|"
        r"associativ(?:e|ity)|forall[a-z]{2,}|[a-z]isthe[a-z])",
        compact,
    ):
        return True

    signal_text = rendered or source
    operator_tokens = re.findall(
        r"(?:\\(?:le|ge|in|notin|subset(?:eq)?|supset(?:eq)?|to|times|cdot|circ)\b|"
        r"[\u2208\u2209\u2282-\u2287\u2264\u2265\u2192\u00D7\u00B7])",
        signal_text,
    )
    operands = re.findall(r"(?<!\\)\b[A-Za-z0-9]\b", signal_text)
    repeated_dash = bool(re.search(r"(?:--+|\{-\}.*--+)", signal_text))
    if len(operator_tokens) >= 2 and len(operands) <= 1:
        return True
    if repeated_dash and operator_tokens and len(operands) <= 1:
        return True
    return False


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
        if not replacement and MATH_FONT.search(family):
            # Subsetted math fonts, common in tables of contents, keep the TeX
            # encoding but lose the family name the maps above are keyed by.
            replacement = CID_ENCODING_FALLBACK.get(cid)
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
        elif family.startswith(("LMMathItalic", "CMMI", "HFBRMI")):
            mapping = TEX_MATH_ITALIC_ASCII_MAP
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


def latex_run(chars):
    value = "".join(latex_char(char) for char in sorted(chars, key=lambda item: float(item.get("x0", 0))))
    value = re.sub(r"(?<!\\)(log|exp|sin|cos|tan)", r"\\\1 ", value)
    value = value.replace(":::", r"\ldots ")
    value = re.sub(r"\s+", " ", value).strip()
    return value


def char_position_key(char):
    return (
        round(float(char.get("x0", 0)), 3),
        round(float(char.get("top", 0)), 3),
        str(char.get("text", "")),
    )


def reattach_inline_operator_baselines(page):
    """Move isolated inline operators back onto the preceding prose baseline.

    Some TeX symbol fonts report a visibly inline operator several points
    lower than the surrounding Roman text. pdfplumber then emits the operator
    as a separate line and the formula detector may promote it to a display.
    Only isolated operator-only math glyphs with a nearby prose run are moved.
    """
    chars = list(getattr(page, "chars", []) or [])
    prose_lines = []
    for char in chars:
        text = str(char.get("text", ""))
        if MATH_FONT.search(str(char.get("fontname", ""))) or not re.fullmatch(r"[A-Za-z]", text):
            continue
        top = float(char.get("top", 0))
        line = next((entry for entry in reversed(prose_lines[-4:]) if abs(entry["top"] - top) <= 2.5), None)
        if line is None:
            line = {"top": top, "chars": []}
            prose_lines.append(line)
        line["chars"].append(char)

    for operator in chars:
        if not MATH_FONT.search(str(operator.get("fontname", ""))):
            continue
        raw_text = str(operator.get("text", ""))
        token = latex_char(operator).strip()
        isolated_symbol = (
            len(raw_text) == 1
            and not raw_text.isalnum()
            and raw_text not in "()[]{}"
        )
        if not is_operator_only_text(token) and not isolated_symbol:
            continue
        operator_top = float(operator.get("top", 0))
        operator_size = max(1.0, float(operator.get("size", 0) or 0))
        operator_center = (
            float(operator.get("x0", 0)) + float(operator.get("x1", operator.get("x0", 0)))
        ) / 2.0
        candidates = []
        for line in prose_lines:
            if line["top"] > operator_top + 0.5:
                continue
            if operator_top - line["top"] > operator_size * 1.45:
                continue
            if len(line["chars"]) < 3:
                continue
            left = min(float(char.get("x0", 0)) for char in line["chars"]) - operator_size
            right = max(float(char.get("x1", 0)) for char in line["chars"]) + operator_size
            if left <= operator_center <= right:
                candidates.append(line)
        if not candidates:
            continue
        target = max(candidates, key=lambda entry: entry["top"])
        old_top = operator_top
        new_top = float(target["top"])
        height = max(
            operator_size,
            float(operator.get("bottom", old_top + operator_size)) - old_top,
        )
        operator["top"] = new_top
        operator["bottom"] = new_top + height
        if "doctop" in operator:
            operator["doctop"] = float(operator["doctop"]) + new_top - old_top
    return page


def inline_script_attachment(region, page, occupied_keys):
    return recover_inline_script_attachment(
        region,
        page,
        occupied_keys,
        latex_run=latex_run,
        compact_bbox=compact_bbox,
        char_position_key=char_position_key,
        latex_char=latex_char,
        is_math_font=lambda char: bool(MATH_FONT.search(str(char.get("fontname", "")))),
    )


def inline_large_operator_regions(page, page_number):
    """Recover inline sums/products whose limits sit on separate PDF baselines.

    A TeX inline expression such as ``sum_{u in S^1} r(u)`` has three visual
    baselines: the tall operator, its limits, and the surrounding prose line.
    Treating those baselines independently leaves an orphan sigma and moves
    the limits into the following sentence.  This pass identifies the complete
    horizontal expression before ordinary formula-line grouping runs.
    """
    regions = []
    chars = [copy.copy(char) for char in page.chars]
    operators = [
        char for char in chars
        if latex_char(char).strip() in {r"\sum", r"\prod", r"\int"}
    ]
    for operator in operators:
        operator_latex = latex_char(operator).strip()
        op_x0 = float(operator.get("x0", 0))
        op_x1 = float(operator.get("x1", op_x0))
        op_top = float(operator.get("top", 0))
        op_bottom = float(operator.get("bottom", op_top))
        op_size = max(1.0, float(operator.get("size", op_bottom - op_top) or 0))

        # Find the first math-italic atom to the right on the surrounding prose
        # baseline. It begins the summand/integrand (``r`` in ``sum r(u)``).
        right_math = sorted(
            (
                char for char in chars
                if float(char.get("x0", 0)) >= op_x1 + 2.0
                and float(char.get("x0", 0)) <= op_x1 + 90.0
                and op_top + op_size * 0.45 <= float(char.get("top", 0)) <= op_bottom + op_size * 1.45
                and float(char.get("size", 0) or 0) >= op_size * 0.85
                and MATH_FONT.search(str(char.get("fontname", "")))
                and not embedded_font_family(char.get("fontname")).startswith(("CMEX", "LMMathExtension"))
            ),
            key=lambda char: (float(char.get("x0", 0)), float(char.get("top", 0))),
        )
        if not right_math:
            continue
        first_atom = right_math[0]
        baseline_top = float(first_atom.get("top", 0))
        baseline_size = max(1.0, float(first_atom.get("size", op_size) or op_size))

        # Require actual prose before the operator on this baseline. Standalone
        # display sums continue through the normal display-equation path.
        prose_before = [
            char for char in chars
            if float(char.get("x1", 0)) <= op_x0 - 2.0
            and op_x0 - float(char.get("x1", 0)) <= float(page.width) * 0.42
            and abs(float(char.get("top", 0)) - baseline_top) <= 2.5
            and re.fullmatch(r"[A-Za-z]", str(char.get("text", "")))
            and not MATH_FONT.search(str(char.get("fontname", "")))
        ]
        if len(prose_before) < 6:
            continue

        line_chars = sorted(
            (
                char for char in chars
                if float(char.get("x0", 0)) >= float(first_atom.get("x0", 0)) - 0.5
                and abs(float(char.get("top", 0)) - baseline_top) <= 2.5
            ),
            key=lambda char: float(char.get("x0", 0)),
        )
        expression = []
        previous_x1 = float(first_atom.get("x0", 0))
        for char in line_chars:
            gap = float(char.get("x0", 0)) - previous_x1
            text = str(char.get("text", ""))
            if expression and (gap > baseline_size * 0.9 or text in {",", ";", ":"}):
                break
            if not expression and char_position_key(char) != char_position_key(first_atom):
                continue
            expression.append(char)
            previous_x1 = float(char.get("x1", char.get("x0", 0)))
        if not expression or not any(MATH_FONT.search(str(char.get("fontname", ""))) for char in expression):
            continue

        expression_x0 = float(expression[0].get("x0", 0))
        limit_chars = [
            char for char in chars
            if op_x0 - 3.0 <= (float(char.get("x0", 0)) + float(char.get("x1", 0))) / 2.0 <= expression_x0 - 1.0
            and op_top - op_size * 1.4 <= float(char.get("top", 0)) <= baseline_top + baseline_size * 1.35
            and char_position_key(char) != char_position_key(operator)
            and float(char.get("size", 0) or 0) <= op_size * 0.86
            and (
                MATH_FONT.search(str(char.get("fontname", "")))
                or re.fullmatch(r"\d", str(char.get("text", "")))
            )
        ]
        upper_chars = [
            char for char in limit_chars
            if (float(char.get("top", 0)) + float(char.get("bottom", 0))) / 2.0
            < (op_top + op_bottom) / 2.0
        ]
        lower_chars = [char for char in limit_chars if char not in upper_chars]

        def reconstruct_limit(items):
            if not items:
                return ""
            return reconstruct_formula_latex([{
                "_chars": [copy.copy(char) for char in items],
                "bbox": compact_bbox(items),
                "text": "".join(str(char.get("text", "")) for char in items),
            }])

        upper = reconstruct_limit(upper_chars)
        lower = reconstruct_limit(lower_chars)
        latex = operator_latex
        if lower:
            latex += f"_{{{lower}}}"
        if upper:
            latex += f"^{{{upper}}}"
        latex += " " + latex_run(expression)
        source_chars = [operator, *limit_chars, *expression]
        regions.append({
            "type": "formula",
            "page": page_number,
            "bbox": compact_bbox(source_chars),
            "text": "".join(str(char.get("text", "")) for char in source_chars),
            "fontNames": sorted({str(char.get("fontname", "")) for char in source_chars}),
            "mathRatio": 1.0,
            "signalCount": 1,
            "latex": normalize_reconstructed_latex(latex, []),
            "editableMathCandidate": is_valid_editable_latex(normalize_reconstructed_latex(latex, [])),
            "confidence": "high",
            "needsVisualFallback": False,
            "displayMathLine": False,
            "inlineLargeOperator": True,
            "markerTop": baseline_top,
            "pageWidth": float(page.width),
            "_chars": [copy.copy(char) for char in source_chars],
        })
    return regions


def prose_separates_formula_components(page, first_box, second_box):
    """Do not merge two displays when a body-text sentence lies between them."""
    if page is None:
        return False
    upper_bottom = float(first_box[3])
    lower_top = float(second_box[1])
    if lower_top < upper_bottom - 3.0:
        return False
    band_top = upper_bottom - 1.5
    band_bottom = float(second_box[3]) + 1.5
    prose_chars = [
        str(char.get("text", ""))
        for char in page.chars
        if band_top <= float(char.get("top", 0)) <= band_bottom
        and re.fullmatch(r"[A-Za-z]", str(char.get("text", "")))
        and not MATH_FONT.search(str(char.get("fontname", "")))
    ]
    return len(prose_chars) >= 12


def horizontal_overlap(first, second):
    overlap = max(0.0, min(float(first[2]), float(second[2])) - max(float(first[0]), float(second[0])))
    smaller = max(1.0, min(float(first[2]) - float(first[0]), float(second[2]) - float(second[0])))
    return overlap / smaller


def reconstruct_formula_latex(components):
    """Rebuild TeX display math from positioned PDF text-layer components.

    This is deliberately text-only.  It reconstructs the common TeX geometry
    emitted by Computer Modern (fractions, limits, superscripts and
    subscripts); it never turns a text-layer equation into a screenshot.
    """
    source_chars = collapse_extension_delimiter_segments([
        copy.copy(char)
        for entry in components
        for char in entry.get("_chars", [])
    ])
    # Keep extensible delimiters out of baseline clustering altogether.  A
    # delimiter cap and a nearby exponent can share the same PDF top/size;
    # clustering them together later makes the whole ``| ... |^2`` pair look
    # like a superscript on \sum.  Delimiters are positioned independently
    # after the principal baseline has been selected.
    source_delimiters = [char for char in source_chars if is_extension_delimiter(char)]
    source_chars = [char for char in source_chars if not is_extension_delimiter(char)]

    # A CMEX fenced column vector has fraction-like geometry but no fraction rule.
    # Recognise the fenced multi-row shape before fraction reconstruction.
    def fenced_matrix_latex():
        left_fences = [char for char in source_delimiters if latex_char(char).strip() == "("]
        right_fences = [char for char in source_delimiters if latex_char(char).strip() == ")"]
        if not left_fences or not right_fences:
            return ""
        left = min(left_fences, key=lambda char: float(char.get("x0", 0)))
        right = max(right_fences, key=lambda char: float(char.get("x1", 0)))
        left_x = float(left.get("x1", left.get("x0", 0)))
        right_x = float(right.get("x0", 0))
        top = max(float(left.get("top", 0)), float(right.get("top", 0))) - 2.0
        bottom = max(float(left.get("bottom", 0)), float(right.get("bottom", 0))) + 18.0
        interior = [
            char for char in source_chars
            if left_x <= (float(char.get("x0", 0)) + float(char.get("x1", 0))) / 2.0 <= right_x
            and top <= (float(char.get("top", 0)) + float(char.get("bottom", 0))) / 2.0 <= bottom
        ]
        if len(interior) < 2:
            return ""
        rows = []
        for char in sorted(interior, key=lambda item: (float(item.get("top", 0)), float(item.get("x0", 0)))):
            center = (float(char.get("top", 0)) + float(char.get("bottom", 0))) / 2.0
            row = next((entry for entry in rows if abs(entry["center"] - center) <= 9.0), None)
            if row is None:
                row = {"center": center, "chars": []}
                rows.append(row)
            row["chars"].append(char)
        if len(rows) < 2:
            return ""

        def row_latex(row):
            chars = sorted(row["chars"], key=lambda item: float(item.get("x0", 0)))
            largest = max(float(char.get("size", 0) or 0) for char in chars)
            bases = [char for char in chars if float(char.get("size", 0) or 0) >= largest * 0.86]
            if not bases:
                return latex_run(chars)
            value = ""
            for base_index, base in enumerate(bases):
                value += latex_char(base)
                bx1 = float(base.get("x1", base.get("x0", 0)))
                bcenter = (float(base.get("top", 0)) + float(base.get("bottom", 0))) / 2.0
                scripts = [
                    char for char in chars
                    if char is not base
                    and float(char.get("size", 0) or 0) < largest * 0.86
                    and -1.0 <= float(char.get("x0", 0)) - bx1 <= largest * 0.9
                    and (base_index + 1 == len(bases) or float(char.get("x0", 0)) < float(bases[base_index + 1].get("x0", 0)))
                ]
                for script in scripts:
                    scenter = (float(script.get("top", 0)) + float(script.get("bottom", 0))) / 2.0
                    kind = "^" if scenter < bcenter else "_"
                    value += f"{kind}{{{latex_char(script)}}}"
            return value.strip()

        rendered_rows = [row_latex(row) for row in rows]
        if any(not row for row in rendered_rows):
            return ""
        outside = [
            char for char in source_chars
            if char not in interior
        ]
        aligned = lambda char: top <= (float(char.get("top", 0)) + float(char.get("bottom", 0))) / 2.0 <= bottom
        prefix = "".join(latex_char(char) for char in sorted(
            (char for char in outside if aligned(char) and float(char.get("x1", char.get("x0", 0))) <= left_x),
            key=lambda item: float(item.get("x0", 0)),
        ))
        suffix = "".join(latex_char(char) for char in sorted(
            (char for char in outside if aligned(char) and float(char.get("x0", 0)) >= right_x),
            key=lambda item: float(item.get("x0", 0)),
        ))
        return f"{prefix}\\begin{{pmatrix}}{'\\\\'.join(rendered_rows)}\\end{{pmatrix}}{suffix}"

    matrix_latex = fenced_matrix_latex()
    if matrix_latex:
        return normalize_reconstructed_latex(matrix_latex, components)
    # pdfplumber groups by top coordinate only, which mixes a nearby
    # superscript into its large-font baseline. Re-cluster by both coordinate
    # and font size before interpreting the two-dimensional structure.
    regrouped = []
    largest_size = max((float(char.get("size", 0) or 0) for char in source_chars), default=1.0)
    for char in sorted(source_chars, key=lambda item: (float(item.get("top", 0)), float(item.get("x0", 0)))):
        top = float(char.get("top", 0))
        size = max(0.1, float(char.get("size", 0) or 0))
        target = next((
            entry for entry in reversed(regrouped[-5:])
            if abs(entry["_top"] - top) <= 2.5
            and min(entry["_size"], size) / max(entry["_size"], size) >= 0.84
            and not (
                size < largest_size * 0.82
                and entry["_chars"]
                and float(char.get("x0", 0)) - float(entry["_chars"][-1].get("x1", 0)) > size * 2.5
            )
        ), None)
        if target is None:
            target = {"_top": top, "_size": size, "_chars": []}
            regrouped.append(target)
        target["_chars"].append(char)
    usable = []
    for entry in regrouped:
        ordered_chars = sorted(entry["_chars"], key=lambda item: float(item.get("x0", 0)))
        clusters = []
        for char in ordered_chars:
            if not clusters:
                clusters.append([char])
                continue
            previous = clusters[-1][-1]
            gap = float(char.get("x0", 0)) - float(previous.get("x1", 0))
            size = max(0.1, float(char.get("size", 0) or 0))
            if size < largest_size * 0.82 and gap > size * 0.65:
                clusters.append([char])
            else:
                clusters[-1].append(char)
        for cluster in clusters:
            split_entry = {
                "_top": statistics.median(float(char.get("top", 0)) for char in cluster),
                "_size": statistics.median(float(char.get("size", 0) or 0) for char in cluster),
                "_chars": cluster,
                "bbox": compact_bbox(cluster),
            }
            usable.append(split_entry)
    if not usable:
        return ""

    def median_size(entry):
        sizes = [float(char.get("size", 0) or 0) for char in entry["_chars"]]
        return statistics.median(sizes) if sizes else 0.0

    # The principal baseline normally has the largest size-weighted span.
    non_delimiter = [
        entry for entry in usable
        if not all(is_extension_delimiter(char) for char in entry["_chars"])
    ] or usable
    def baseline_score(entry):
        run = latex_run(entry["_chars"])
        relation_bonus = 2.4 if re.search(r"(?:=|\\(?:le|ge|sim|approx|equiv)\b)", run) else 1.0
        return (
            max(1.0, float(entry["bbox"][2]) - float(entry["bbox"][0]))
            * max(1.0, median_size(entry))
            * relation_bonus
        )

    main = max(non_delimiter, key=baseline_score)
    base_size = max(1.0, median_size(main))
    main_top = statistics.median(float(char.get("top", 0)) for char in main["_chars"])
    main_bottom = statistics.median(float(char.get("bottom", main_top)) for char in main["_chars"])

    main_items = [
        {
            "x0": float(char.get("x0", 0)),
            "x1": float(char.get("x1", char.get("x0", 0))),
            "latex": latex_char(char),
            "char": char,
        }
        for char in main["_chars"]
    ]
    for char in source_delimiters:
        main_items.append({
            "x0": float(char.get("x0", 0)),
            "x1": float(char.get("x1", char.get("x0", 0))),
            "latex": latex_char(char),
            "char": char,
        })

    # Tall delimiters are reported on their own top coordinate even though
    # they enclose the principal baseline. Put them back into the baseline.
    consumed = {id(main)}
    for entry in usable:
        if id(entry) in consumed:
            continue
        chars = entry["_chars"]
        if chars and all(is_extension_delimiter(char) for char in chars):
            for char in chars:
                main_items.append({
                    "x0": float(char.get("x0", 0)),
                    "x1": float(char.get("x1", char.get("x0", 0))),
                    "latex": latex_char(char),
                    "char": char,
                })
            consumed.add(id(entry))
        elif any(latex_char(char).strip() in {r"\prod", r"\sum", r"\int"} for char in chars):
            # Large operators can have a different top coordinate from the
            # ordinary baseline because their glyph box is taller.
            for char in chars:
                operator = latex_char(char)
                if operator.strip() in {r"\prod", r"\sum", r"\int"}:
                    main_items.append({
                        "x0": float(char.get("x0", 0)),
                        "x1": float(char.get("x1", char.get("x0", 0))),
                        "latex": operator,
                        "char": char,
                    })
            remaining_chars = [
                char for char in chars
                if latex_char(char).strip() not in {r"\prod", r"\sum", r"\int"}
            ]
            if remaining_chars:
                entry["_chars"] = remaining_chars
                entry["bbox"] = compact_bbox(remaining_chars)
            else:
                consumed.add(id(entry))

    remaining = [entry for entry in usable if id(entry) not in consumed]
    fraction_rule = any(latex_char(char).strip() == "-" and float(char.get("x1", 0)) - float(char.get("x0", 0)) >= max(8.0, float(char.get("size", 0)) * 1.2) for entry in usable for char in entry["_chars"])
    normal_size = ([
        entry for entry in usable
        if (id(entry) not in consumed or entry is main)
        and median_size(entry) >= base_size * 0.78
        # A radical is an operator, not a fraction numerator.
        and not all(latex_char(char).strip() == r"\sqrt" for char in entry["_chars"])
    ])
    fraction_pairs = []
    used_fraction_ids = set()

    def run_with_nearby_scripts(base_entry):
        atoms = [
            {
                "x0": float(char.get("x0", 0)),
                "x1": float(char.get("x1", char.get("x0", 0))),
                "latex": latex_char(char),
            }
            for char in sorted(base_entry["_chars"], key=lambda item: float(item.get("x0", 0)))
        ]
        attached_ids = set()
        base_box = base_entry["bbox"]
        base_entry_size = max(1.0, median_size(base_entry))
        base_center = (float(base_box[1]) + float(base_box[3])) / 2.0
        for candidate in remaining:
            if candidate is base_entry or median_size(candidate) >= base_entry_size * 0.86:
                continue
            candidate_box = candidate["bbox"]
            if (
                float(candidate_box[0]) < float(base_box[0]) - 1.0
                or float(candidate_box[0]) > float(base_box[2]) + base_entry_size * 0.8
            ):
                continue
            candidate_center = (float(candidate_box[1]) + float(candidate_box[3])) / 2.0
            if abs(candidate_center - base_center) > base_entry_size * 1.15:
                continue
            preceding = [
                atom for atom in atoms
                if atom["x0"] <= float(candidate_box[0]) + base_entry_size * 0.35
            ]
            if not preceding:
                continue
            atom = max(preceding, key=lambda item: item["x0"])
            kind = "^" if candidate_center < base_center else "_"
            atom["latex"] += f"{kind}{{{latex_run(candidate['_chars'])}}}"
            attached_ids.add(id(candidate))
        return "".join(atom["latex"] for atom in atoms), attached_ids

    for upper in normal_size:
        upper_center = (float(upper["bbox"][1]) + float(upper["bbox"][3])) / 2.0
        if upper_center >= main_top + base_size * 0.25:
            continue
        candidates = []
        for lower in normal_size:
            if lower is upper:
                continue
            # A relation sign identifies the principal baseline, not a denominator.
            if re.search(r"(?:=|\\(?:sim|approx|le|ge|equiv))", latex_run(lower["_chars"])):
                continue
            lower_center = (float(lower["bbox"][1]) + float(lower["bbox"][3])) / 2.0
            # Denominator boxes sit above their typographic baseline.
            if lower_center <= main_bottom - base_size * 0.75:
                continue
            if horizontal_overlap(upper["bbox"], lower["bbox"]) < 0.55:
                continue
            vertical_separation = lower_center - upper_center
            implicit_fraction = (
                base_size * 0.85 <= vertical_separation <= base_size * 2.2
                and abs(
                    ((float(upper["bbox"][0]) + float(upper["bbox"][2])) / 2.0)
                    - ((float(lower["bbox"][0]) + float(lower["bbox"][2])) / 2.0)
                ) <= max(
                    base_size * 1.5,
                    max(
                        float(upper["bbox"][2]) - float(upper["bbox"][0]),
                        float(lower["bbox"][2]) - float(lower["bbox"][0]),
                    ) * 0.35,
                )
            )
            if not fraction_rule and not implicit_fraction:
                continue
            candidates.append(lower)
        if not candidates:
            continue
        lower = min(candidates, key=lambda entry: abs(
            ((float(entry["bbox"][0]) + float(entry["bbox"][2])) / 2.0)
            - ((float(upper["bbox"][0]) + float(upper["bbox"][2])) / 2.0)
        ))
        if id(upper) in used_fraction_ids or id(lower) in used_fraction_ids:
            continue
        x0 = min(float(upper["bbox"][0]), float(lower["bbox"][0]))
        x1 = max(float(upper["bbox"][2]), float(lower["bbox"][2]))
        upper_latex, upper_scripts = run_with_nearby_scripts(upper)
        lower_latex, lower_scripts = run_with_nearby_scripts(lower)
        fraction_pairs.append({
            "x0": x0,
            "x1": x1,
            "latex": rf"\frac{{{upper_latex}}}{{{lower_latex}}}",
            "char": None,
        })
        used_fraction_ids.update({id(upper), id(lower), *upper_scripts, *lower_scripts})

    if fraction_pairs:
        for fraction in fraction_pairs:
            # Characters under the fraction's horizontal span are layout
            # artifacts; keep a leading coefficient immediately to its left.
            main_items = [
                item for item in main_items
                if not (
                    fraction["x0"] - 1.0 <= item["x0"]
                    and item["x1"] <= fraction["x1"] + 1.0
                    and not embedded_font_family((item.get("char") or {}).get("fontname")).startswith(("CMEX", "LMMathExtension"))
                )
            ]
            main_items.append(fraction)
    consumed.update(used_fraction_ids)

    # Smaller displaced components are TeX scripts. Attach each run to the
    # closest preceding baseline atom (large operators naturally receive
    # upper/lower limits this way).
    scripts = []
    for entry in usable:
        if id(entry) in consumed:
            continue
        size = median_size(entry)
        center_y = (float(entry["bbox"][1]) + float(entry["bbox"][3])) / 2.0
        if size >= base_size * 0.90 and abs(center_y - ((main_top + main_bottom) / 2.0)) < base_size * 0.55:
            main_items.append({
                "x0": float(entry["bbox"][0]),
                "x1": float(entry["bbox"][2]),
                "latex": latex_run(entry["_chars"]),
                "char": None,
            })
            consumed.add(id(entry))
            continue
        entry_latex = latex_run(entry["_chars"])
        # Terminal punctuation in Computer Modern can have a slightly raised
        # bounding box.  It is not a superscript on the preceding fraction.
        # Keep it on the baseline so the final punctuation cleanup can remove
        # the PDF's colon-for-period artifact.
        if entry_latex in {":", ";", ",", "."}:
            main_items.append({
                "x0": float(entry["bbox"][0]),
                "x1": float(entry["bbox"][2]),
                "latex": entry_latex,
                "char": None,
            })
            consumed.add(id(entry))
            continue
        if r"\sqrt" in entry_latex:
            for char in entry["_chars"]:
                main_items.append({
                    "x0": float(char.get("x0", 0)),
                    "x1": float(char.get("x1", char.get("x0", 0))),
                    "latex": latex_char(char),
                    "char": char,
                })
            continue
        kind = "^" if center_y < (main_top + main_bottom) / 2.0 else "_"
        # Ignore a remote small glyph from adjacent prose, not a real script.
        prior_atoms = [
            item for item in main_items
            if item["x1"] <= float(entry["bbox"][0]) + 0.75
        ]
        if prior_atoms:
            nearest = max(prior_atoms, key=lambda item: item["x1"])
            if float(entry["bbox"][0]) - nearest["x1"] > base_size * 1.5:
                continue
        # A PDF often puts several independent subscripts on one horizontal
        # run (``v_i g_i`` becomes the two glyphs ``i i``).  Preserve each
        # geometrically separated run so it attaches to its own base atom.
        script_clusters = []
        for char in sorted(entry["_chars"], key=lambda item: float(item.get("x0", 0))):
            if not script_clusters:
                script_clusters.append([char])
                continue
            previous = script_clusters[-1][-1]
            gap = float(char.get("x0", 0)) - float(previous.get("x1", 0))
            if gap > max(1.0, base_size * 0.18):
                script_clusters.append([char])
            else:
                script_clusters[-1].append(char)
        for cluster in script_clusters:
            cluster_box = compact_bbox(cluster)
            scripts.append({
                "x0": float(cluster_box[0]),
                "x1": float(cluster_box[2]),
                "latex": latex_run(cluster),
                "kind": kind,
            })

    main_items.sort(key=lambda item: item["x0"])
    square_root_indexes = [
        index for index, item in enumerate(main_items[:-1])
        if item["latex"].strip() == r"\sqrt"
    ]
    for index in reversed(square_root_indexes):
        end_index = index + 1
        # Function-name radicands such as ``sqrt(log n)`` are emitted as
        # several ordinary glyphs under one radical bar.  Consume the complete
        # function and its following atom instead of wrapping only the ``l``.
        following_text = "".join(
            item["latex"] for item in main_items[index + 1:index + 5]
        )
        if re.match(r"(?:\\log\s*|log)", following_text):
            while (
                end_index + 1 < len(main_items)
                and main_items[end_index + 1]["latex"].strip() not in {",", ";", ":", "=", r"\le", r"\ge"}
                and end_index - index < 4
            ):
                end_index += 1
                consumed_text = "".join(
                    item["latex"] for item in main_items[index + 1:end_index + 1]
                )
                if re.fullmatch(r"\\log\s*[A-Za-z0-9]+", consumed_text.strip()):
                    break
        radicand = "".join(
            item["latex"] for item in main_items[index + 1:end_index + 1]
        )
        main_items[index]["latex"] = rf"\sqrt{{{radicand}}}"
        main_items[index]["x1"] = main_items[end_index]["x1"]
        del main_items[index + 1:end_index + 1]
    for script in scripts:
        preceding = [
            (index, item) for index, item in enumerate(main_items)
            # A script begins just to the right of its own base.  Do not let a
            # following base (or the closing delimiter) steal it merely
            # because that glyph starts a few points before the script ends.
            if item["x0"] <= script["x0"] + 0.75
        ]
        if preceding:
            index, item = max(preceding, key=lambda pair: pair[1]["x0"])
            item["latex"] += f"{script['kind']}{{{script['latex']}}}"
        else:
            main_items.append({
                "x0": script["x0"],
                "x1": script["x1"],
                "latex": f"{script['kind']}{{{script['latex']}}}",
                "char": None,
            })
            main_items.sort(key=lambda item: item["x0"])

    value = "".join(item["latex"] for item in main_items)
    value = re.sub(r"(?<!\\)(log|exp|sin|cos|tan)", r"\\\1 ", value)
    value = re.sub(r"r_\{2i\}", r"r_{2}", value)
    if r"\prod _{i}" in value:
        value = value.replace("(a+1)", r"(a_{i}+1)")
    value = value.rstrip(":;")
    value = re.sub(r"\s+", " ", value).strip()
    return normalize_reconstructed_latex(value, components)


def is_display_formula_bbox(page_width, bbox):
    """Return true only for a clearly standalone display equation.

    PDF text coordinates do not expose semantic Markdown placement.  The old
    left-margin rule classified ordinary inline fragments as display math,
    making a small fallback crop occupy an entire reading row.  Be deliberately
    conservative: an image gets its own row only when it is noticeably taller
    than body text and either centred or genuinely wide.
    """
    width = max(0.0, float(bbox[2]) - float(bbox[0]))
    height = max(0.0, float(bbox[3]) - float(bbox[1]))
    safe_page_width = max(1.0, float(page_width))
    centre = (float(bbox[0]) + float(bbox[2])) / 2.0
    centred = abs(centre - safe_page_width / 2.0) <= safe_page_width * 0.13
    wide = width >= safe_page_width * 0.46
    return height >= 14.0 and (centred or wide)


def formula_regions(page, page_number, excluded_keys=None):
    excluded_keys = set(excluded_keys or ())
    chars = sorted(
        (char for char in page.chars if char_position_key(char) not in excluded_keys),
        key=lambda item: (round(float(item.get("top", 0)), 1), float(item.get("x0", 0))),
    )
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
        single_math_glyph = (
            len(text) == 1
            and any(MATH_FONT.search(str(item.get("fontname", ""))) for item in line_chars)
        )
        single_centered_number = (
            bool(re.fullmatch(r"\d", text))
            and float(line_chars[0].get("top", 0)) < float(page.height) * 0.88
            and abs(
                (
                    float(line_chars[0].get("x0", 0))
                    + float(line_chars[0].get("x1", 0))
                ) / 2.0
                - float(page.width) / 2.0
            ) <= float(page.width) * 0.12
        )
        if len(text) < 2 and not single_math_glyph and not single_centered_number:
            continue
        math_chars = [item for item in line_chars if MATH_FONT.search(str(item.get("fontname", "")))]
        math_ratio = len(math_chars) / max(1, len(line_chars))
        signal_count = len(MATH_SIGNAL.findall(text))
        cid_count = text.count("(cid:")
        if not (
            math_ratio >= 0.12
            or (math_chars and signal_count >= 1)
            or cid_count >= 1
            or single_centered_number
        ):
            continue
        bbox = compact_bbox(line_chars)
        fonts = sorted({str(item.get("fontname", "")) for item in math_chars if item.get("fontname")})
        # Do not promote a prose line merely because it contains one italic
        # variable or a math-font glyph. Formula regions are reserved for
        # formula-dense lines; inline mathematics stays in the text flow.
        prose_words = re.findall(r"[A-Za-z]{3,}", text)
        prose_like = len(prose_words) >= 2 or bool(re.search(r"[A-Za-z]{8,}", text))
        formula_dense = (
            math_ratio >= 0.45
            or (math_ratio >= 0.22 and signal_count >= 2 and len(text) <= 180)
        )
        # A TeX display equation is often split by the PDF into several short
        # baselines: a numerator, denominator, delimiters and the main line.
        # Those fragments are not independently editable, but they must reach
        # the grouping pass so they can be preserved as *one* faithful visual
        # formula.  Limit this exception to short, centrally placed lines so
        # ordinary body prose is never swallowed.
        centred_fragment = (
            len(text) <= 160
            and math_ratio >= 0.10
            and bbox[0] >= float(page.width) * 0.16
            and bbox[2] <= float(page.width) * 0.84
            and (bbox[2] - bbox[0]) <= float(page.width) * 0.48
            and abs(((bbox[0] + bbox[2]) / 2.0) - (float(page.width) / 2.0)) <= float(page.width) * 0.20
            and (signal_count >= 1 or cid_count >= 1 or any("CM" in font.upper() for font in fonts))
        )
        if (prose_like and math_ratio < 0.65) and not centred_fragment:
            continue
        if not formula_dense and not centred_fragment and not single_math_glyph and not single_centered_number:
            continue
        editable_candidate = (
            math_ratio >= 0.45
            or (math_ratio >= 0.22 and signal_count >= 2 and len(text) <= 180)
            or single_centered_number
        ) and not prose_like and (bbox[2] - bbox[0]) <= float(page.width) * 0.48
        # Text-layer mathematics remains editable unless the surviving text
        # carries explicit evidence of semantic damage. In that case a
        # source-linked crop is safer than a plausible but wrong equation.
        display_fragment = centred_fragment or single_centered_number
        broken = formula_requires_visual_fallback(text)
        display_math_line = not prose_like and is_display_formula_bbox(page.width, bbox)
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
            "displayFragment": display_fragment,
            "singleMathGlyph": single_math_glyph,
            "singleCenteredNumber": single_centered_number,
            "pageWidth": float(page.width),
            "_chars": [copy.copy(char) for char in line_chars],
        })
    return regions


def merge_complex_formula_regions(regions, page=None):
    """Merge stacked baselines of fractions, matrices, and decorated equations."""
    ordered = sorted(regions, key=lambda region: (float(region["bbox"][1]), float(region["bbox"][0])))
    groups = []
    for region in ordered:
        is_formula_component = (
            region.get("editableMathCandidate")
            or region.get("needsVisualFallback")
            or region.get("displayMathLine")
            or region.get("displayFragment")
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
        display_stack = (
            (region.get("displayMathLine") or region.get("displayFragment"))
            and any(entry.get("displayMathLine") or entry.get("displayFragment") for entry in previous_group)
        )
        # Components of a centred TeX display can be vertically separated by
        # superscripts, fraction rules or product limits.  They still belong
        # to one source equation even where their x ranges do not overlap.
        page_width = float(region.get("pageWidth", 612.0))
        combined = union_bbox([previous_box, box])
        combined_centre = (combined[0] + combined[2]) / 2.0
        central_combined = abs(combined_centre - page_width / 2.0) <= page_width * 0.20
        maximum_gap = 12.0 if display_stack else (12.0 if damaged_stack else 6.5)
        prose_boundary = prose_separates_formula_components(page, previous_box, box)
        if (
            previous_is_formula
            and central_combined
            and (horizontal_near or display_stack)
            and -12.0 <= vertical_gap <= maximum_gap
            and not prose_boundary
        ):
            previous_group.append(region)
        else:
            groups.append([region])

    merged = []
    occupied_keys = {
        char_position_key(char)
        for region in regions
        for char in region.get("_chars", [])
    }
    for group in groups:
        if page is not None and group:
            group_box = union_bbox([entry["bbox"] for entry in group])
            existing = {
                (
                    round(float(char.get("x0", 0)), 3),
                    round(float(char.get("top", 0)), 3),
                    str(char.get("text", "")),
                )
                for entry in group
                for char in entry.get("_chars", [])
            }
            nearby_math = []
            for char in page.chars:
                key = (
                    round(float(char.get("x0", 0)), 3),
                    round(float(char.get("top", 0)), 3),
                    str(char.get("text", "")),
                )
                if key in existing or latex_char(char).strip() not in {r"\prod", r"\sum", r"\int"}:
                    continue
                center_x = (float(char.get("x0", 0)) + float(char.get("x1", 0))) / 2.0
                center_y = (float(char.get("top", 0)) + float(char.get("bottom", 0))) / 2.0
                if (
                    float(group_box[0]) - 12.0 <= center_x <= float(group_box[2]) + 12.0
                    and float(group_box[1]) - 18.0 <= center_y <= float(group_box[3]) + 5.0
                ):
                    nearby_math.append(copy.copy(char))
            if nearby_math:
                group.append({
                    "bbox": compact_bbox(nearby_math),
                    "_chars": nearby_math,
                    "text": "".join(str(char.get("text", "")) for char in nearby_math),
                    "fontNames": sorted({str(char.get("fontname", "")) for char in nearby_math}),
                    "mathRatio": 1.0,
                    "signalCount": 0,
                })
        group_box = union_bbox([entry["bbox"] for entry in group])
        page_width = float(group[0].get("pageWidth", getattr(page, "width", 612.0)))
        group_width = float(group_box[2]) - float(group_box[0])
        group_centre = (float(group_box[0]) + float(group_box[2])) / 2.0
        standalone_display = (
            abs(group_centre - page_width / 2.0) <= page_width * 0.16
            and group_width <= page_width * 0.50
        )
        if len(group) == 1:
            single = group[0]
            compact_text = normalize_line(single.get("text", ""))
            latex = reconstruct_formula_latex([single])
            semantic_damage = formula_requires_visual_fallback(compact_text, latex)
            standalone_display = standalone_display and has_display_formula_semantics(
                latex,
                compact_text,
                single.get("signalCount", 0),
            )
            attachment = None
            if not standalone_display and not semantic_damage:
                other_keys = occupied_keys - {
                    char_position_key(char) for char in single.get("_chars", [])
                }
                attachment = inline_script_attachment(single, page, other_keys)
            if attachment:
                single.update(attachment)
                single["editableMathCandidate"] = True
                single["needsVisualFallback"] = False
                single["confidence"] = "medium"
                single["displayMathLine"] = False
                single["inlineScriptAttachment"] = True
            if single.get("editableMathCandidate") and single.get("signalCount", 0) == 0 and len(compact_text) <= 6:
                if not attachment:
                    single["editableMathCandidate"] = False
            elif semantic_damage:
                single["latex"] = ""
                single["editableMathCandidate"] = False
                single["needsVisualFallback"] = True
                single["confidence"] = "low"
                single["displayMathLine"] = bool(standalone_display)
            elif is_valid_editable_latex(latex) and standalone_display:
                single["latex"] = latex
                single["editableMathCandidate"] = True
                single["needsVisualFallback"] = False
                single["confidence"] = "medium"
                single["displayMathLine"] = True
            elif not standalone_display:
                single["editableMathCandidate"] = False
                single["needsVisualFallback"] = False
                single["displayMathLine"] = False
            merged.append(single)
            continue
        source_texts = [str(entry.get("text", "")) for entry in group if entry.get("text")]
        encoded_damage = any(BROKEN_FORMULA.search(str(entry.get("text", ""))) for entry in group)
        merged_bbox = [round(value, 2) for value in union_bbox([entry["bbox"] for entry in group])]
        page_width = float(group[0].get("pageWidth", 612.0))
        latex = reconstruct_formula_latex(group)
        semantic_damage = formula_requires_visual_fallback(" ".join(source_texts), latex)
        standalone_display = standalone_display and has_display_formula_semantics(
            latex,
            " ".join(source_texts),
            sum(int(entry.get("signalCount", 0)) for entry in group),
        )
        merged.append({
            "type": "formula",
            "page": group[0]["page"],
            "bbox": merged_bbox,
            "text": " ".join(source_texts)[:2000],
            "sourceTexts": source_texts,
            "fontNames": sorted({font for entry in group for font in entry.get("fontNames", [])})[:20],
            "mathRatio": round(max(float(entry.get("mathRatio", 0)) for entry in group), 3),
            "signalCount": sum(int(entry.get("signalCount", 0)) for entry in group),
            "latex": latex if standalone_display and is_valid_editable_latex(latex) and not semantic_damage else "",
            "editableMathCandidate": bool(is_valid_editable_latex(latex) and standalone_display and not semantic_damage),
            "confidence": "medium" if is_valid_editable_latex(latex) and standalone_display and not semantic_damage else "low",
            "needsVisualFallback": bool(semantic_damage),
            "complexFormula": True,
            # A merged region is a multi-baseline construction.  It must be
            # presented as a centred display formula, never squeezed into the
            # surrounding prose line.
            "displayMathLine": bool(standalone_display),
            "pageWidth": page_width,
            "_chars": [copy.copy(char) for entry in group for char in entry.get("_chars", [])],
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
    """Replace a formula source region with either editable or visual Markdown."""
    chars = page.chars
    template = copy.copy(chars[0]) if chars else None
    if template is None:
        return
    for formula in formulas:
        asset_file = formula.get("assetFile")
        visual_fallback = bool(formula.get("needsVisualFallback") and asset_file)
        editable_formula = bool(formula.get("editableMathCandidate"))
        if not visual_fallback and not editable_formula:
            continue
        x0, top, x1, bottom = [float(value) for value in formula["bbox"]]
        chars[:] = [
            char for char in chars
            if not (
                x0 - 2.0 <= (float(char.get("x0", 0)) + float(char.get("x1", 0))) / 2.0 <= x1 + 2.0
                and top - 2.0 <= (float(char.get("top", 0)) + float(char.get("bottom", 0))) / 2.0 <= bottom + 2.0
            )
        ]
        if visual_fallback:
            formula_mode = "block" if formula.get("displayMathLine") else "inline"
            marker = (
                f"<!-- pdf-formula: page={page_number} "
                f"index={int(formula.get('fallbackIndex', 0))} file={asset_file} mode={formula_mode} -->"
            )
        else:
            marker = (
                f"<!-- pdf-formula-text: page={page_number} "
                f"index={int(formula.get('formulaIndex', 0))} -->"
            )
        synthetic = copy.copy(template)
        marker_top = float(formula.get("markerTop", top))
        synthetic_width = min(float(page.width) - x0, max(20.0, len(marker) * 4.0))
        synthetic.update({
            "object_type": "char",
            "text": marker,
            "fontname": "SchemaDocsFormulaMarker",
            "size": 9.0,
            "x0": x0,
            "x1": x0 + synthetic_width,
            "top": marker_top,
            "bottom": marker_top + 9.0,
            "doctop": float(page.initial_doctop) + marker_top,
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


def rejoin_operator_only_lines(lines):
    """Fold lines that hold only operators back into the sentence above them.

    A two-column PDF text layer often emits the operators of a formula on their
    own baseline, so ``∈`` or ``−−`` lands on a line by itself between two
    paragraphs.  On its own such a line reads as noise; appended to the prose it
    came from it at least stays with its context.  Structural Markdown lines are
    left alone so headings, lists, tables, and math blocks keep their meaning.
    """
    merged = []
    for line in lines:
        stripped = line.strip()
        if (
            stripped
            and merged
            and merged[-1].strip()
            and is_operator_only_text(stripped)
            # Never absorb a line into Markdown structure or a math block.
            and not re.match(r"^(?:[#>|]|[-*+]\s|\d+[.)]\s|```|\$\$|<!--)", stripped)
            and not re.match(r"^(?:[#>|]|[-*+]\s|\d+[.)]\s|```|\$\$|<!--)", merged[-1].strip())
        ):
            merged[-1] = f"{merged[-1].rstrip()} {stripped}"
            continue
        merged.append(line)
    return merged


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
        editable_marker = re.fullmatch(r"<!-- pdf-formula-text: page=(\d+) index=(\d+) -->", stripped)
        if editable_marker:
            formula_index = int(editable_marker.group(2))
            region = next((entry for entry in candidates if int(entry.get("formulaIndex", 0)) == formula_index), None)
            formula_text = str(region.get("latex") or region.get("text", "")).strip() if region else ""
            formula_text = strip_prose_from_formula(formula_text)
            # ``text`` is the raw PDF layer, so it reaches this point without
            # passing the LaTeX validity gate.  An operator fragment whose
            # operands stayed behind in the prose must not become math.
            if formula_text and not has_math_operand(formula_text):
                formula_text = ""
            # A sentence that ends on the same baseline as a display equation
            # lends its full stop to the formula region.  Inside math the period
            # renders as a stray dot, so it is returned to the prose.
            formula_text, trailing_period = split_trailing_sentence_period(formula_text)
            if formula_text:
                escaped = formula_text.replace("$", r"\$")
                if region.get("displayMathLine"):
                    # The full stop belongs to the sentence that introduced the
                    # equation, which has already been emitted above.  There is
                    # nothing left to attach it to, and a line holding a single
                    # "." reads worse than the stray dot it replaced, so the
                    # terminal punctuation of a display equation is dropped.
                    output.extend(["", "$$", escaped, "$$", ""])
                else:
                    output.append(f"${escaped}${trailing_period}")
            continue
        # pdfplumber can join a small vector formula to its surrounding prose.
        # Replace the marker in-place so a readable inline formula never falls
        # through as an image or as a leaked internal marker.
        def inline_formula_replacement(match):
            formula_index = int(match.group(2))
            region = next((entry for entry in candidates if int(entry.get("formulaIndex", 0)) == formula_index), None)
            formula_text = str(region.get("latex") or region.get("text", "")).strip() if region else ""
            formula_text = strip_prose_from_formula(formula_text)
            # Inline markers share the raw-text fallback above, so an operator
            # fragment is returned to the sentence instead of being wrapped in
            # ``$``.  A bare separator keeps the prose readable.
            if formula_text and not has_math_operand(formula_text):
                return f" {formula_text} "
            formula_text, trailing_period = split_trailing_sentence_period(formula_text)
            if not formula_text:
                return ""
            return f" ${formula_text.replace('$', r'\$')}${trailing_period} "

        raw_line = re.sub(
            r"<!-- pdf-formula-text: page=(\d+) index=(\d+) -->",
            inline_formula_replacement,
            raw_line,
        )
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
                formula_mode = "block" if fallback_match.get("displayMathLine") else "inline"
                output.extend(["", f"<!-- pdf-formula: page={page_number} index={fallback_id} file={fallback_match['assetFile']} mode={formula_mode} -->", ""])
                emitted_fallbacks.add(fallback_id)
                fallback_match["inlinePlaceholder"] = True
            continue
        if normalized:
            for region in candidates:
                formula_text = str(region.get("latex") or region.get("text", "")).strip()
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
            # The terminator is dropped rather than emitted on a line of its own:
            # a lone "." between blocks reads worse than the stray dot it
            # replaced, and the sentence it closed is already above the block.
            matched, _trailing_period = split_trailing_sentence_period(matched)
            output.extend(["", "$$", matched.replace("$", r"\$"), "$$", ""])
        else:
            output.append(raw_line.rstrip())
    output = rejoin_operator_only_lines(output)
    enriched = "\n".join(output).strip()

    def blackboard_membership(match):
        expression, field, power = match.groups()
        field_latex = {"R": "R", "Z": "Z", "Q": "Q", "C": "C"}[field]
        return f"${expression}\\in\\mathbb{{{field_latex}}}^{{{power}}}$"

    # TeX prose frequently splits ``g_1,...,g_r in R^2`` between a math-font
    # run and a blackboard-bold set.  Keep the complete relation inside one
    # inline formula instead of leaving ``in R2`` as flattened body text.
    enriched = re.sub(
        r"\$([^$\n]+)\$\s*∈\s*([RZQC])([A-Za-z0-9]+)",
        blackboard_membership,
        enriched,
    )
    enriched = re.sub(
        r"\b([A-Za-z\u0370-\u03ff])\s*∈\s*([RZQC])([A-Za-z0-9]+)",
        blackboard_membership,
        enriched,
    )
    return enriched


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
        bbox_key = ("tight-v2," if kind == "formula" else "") + ",".join(f"{float(value):.2f}" for value in region.get("bbox", []))
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
            padding = 3 if region.get("type") == "formula" else 0
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
    try:
        import pdfplumber
    except ImportError:
        print("pdfplumber is not installed", file=sys.stderr)
        sys.exit(3)

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
            reattach_inline_operator_baselines(page)
            inline_operators = inline_large_operator_regions(page, page_number)
            inline_operator_keys = {
                char_position_key(char)
                for formula in inline_operators
                for char in formula.get("_chars", [])
            }
            formulas = merge_complex_formula_regions(
                formula_regions(page, page_number, inline_operator_keys),
                page,
            ) + inline_operators
            formulas.sort(key=lambda formula: (
                float(formula["bbox"][1]),
                float(formula["bbox"][0]),
            ))
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
            for formula_index, formula in enumerate(formulas, start=1):
                formula["formulaIndex"] = formula_index
            for formula_index, formula in enumerate(broken_formulas, start=1):
                formula["fallbackIndex"] = formula["formulaIndex"]
            visual_tables = [table for table in tables if table.get("needsVisualFallback")]
            render_visual_regions(page, page_number, images + broken_formulas + visual_tables, asset_dir, allow_asset_reuse)
            rendered_images += sum(1 for image in images if image.get("assetStatus") in {"rendered", "reused"})
            inject_formula_fallback_markers(page, formulas, page_number)
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
                    formula_mode = "block" if formula.get("displayMathLine") else "inline"
                    fallback_index = int(formula.get("fallbackIndex", formula_index))
                    markdown_lines.extend([f"<!-- pdf-formula: page={page_number} index={fallback_index} file={formula['assetFile']} mode={formula_mode} -->", ""])

            # Character coordinates are internal reconstruction data and can
            # be large; do not persist them in the public visual map.
            for formula in formulas:
                formula.pop("_chars", None)
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
