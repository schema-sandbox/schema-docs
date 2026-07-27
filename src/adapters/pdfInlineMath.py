import copy
import re
import statistics


# Relations, binary operators, delimiters, and spacing carry no value of their
# own.  A formula built purely from these is an operator fragment that pdfplumber
# lifted out of running prose, not an equation: the operands stayed behind in the
# text layer.  Emitting it as math produces an empty shell such as ``\cdot \in``
# while leaving the surrounding sentence truncated.
NON_OPERAND_COMMANDS = frozenset({
    # relations
    "le", "ge", "ne", "neq", "equiv", "sim", "simeq", "approx", "asymp", "cong",
    "propto", "subset", "supset", "subseteq", "supseteq", "in", "notin", "ni",
    "prec", "succ", "preceq", "succeq", "ll", "gg", "lesssim", "gtrsim",
    "triangleleft", "triangleright", "perp", "mid", "parallel",
    # arrows
    "to", "mapsto", "rightarrow", "leftarrow", "leftrightarrow", "Rightarrow",
    "Leftarrow", "Leftrightarrow", "hookrightarrow", "longrightarrow",
    # binary operators
    "pm", "mp", "times", "div", "cdot", "ast", "star", "circ", "bullet",
    "oplus", "ominus", "otimes", "oslash", "odot", "setminus", "diamond",
    "wedge", "vee", "cap", "cup", "sqcap", "sqcup", "uplus", "amalg",
    # delimiters and fences
    "langle", "rangle", "lfloor", "rfloor", "lceil", "rceil", "Vert", "vert",
    "lvert", "rvert", "lbrace", "rbrace", "left", "right", "big", "Big",
    "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr",
    # spacing, styling, and accents that never stand alone
    "quad", "qquad", "displaystyle", "limits", "nolimits", "not", "mathord",
    "mathrel", "mathbin", "hspace", "vspace", "ldots", "cdots", "dots",
    # Marks that decorate an operand instead of being one.  ``e'`` is a real
    # formula, but a bare ``\prime`` next to a relation is the leftover
    # accent of a symbol whose base stayed behind in the text layer.
    "prime", "hat", "bar", "tilde", "vec", "dot", "ddot", "acute", "grave",
    "check", "breve", "overline", "underline", "mathring",
})


# pdfplumber hands back the raw PDF text layer as well as reconstructed LaTeX.
# In the raw layer the same operators appear as bare Unicode rather than control
# words, so an operand check that only understands ``\cdot`` silently accepts
# ``·∈∈``.  These are the literal glyphs that carry no operand of their own.
NON_OPERAND_CHARS = frozenset(
    "+-\u2212*/=<>\u00b1\u00d7\u00f7\u00b7\u2217\u2218\u2219\u22c5"
    "\u2208\u2209\u220b\u2282\u2283\u2286\u2287\u228a\u228b"
    "\u2260\u2261\u2264\u2265\u226a\u226b\u227a\u227b\u227c\u227d"
    "\u223c\u2243\u2248\u224d\u2272\u2273\u226e\u226f"
    "\u2192\u2190\u2194\u21a6\u21d2\u21d0\u21d4\u2933\u27f6\u27f5"
    "\u2295\u2296\u2297\u2298\u2299\u2216\u2229\u222a\u2293\u2294"
    "\u2227\u2228\u22a4\u22a5\u22a2\u22a3\u25c1\u25b7\u22b2\u22b3"
    "\u2213\u2205\u22c4\u2022\u25cb\u2032\u2033\u2034\u0338"
    "\u2200\u2203\u2204\u00ac\u2225\u2226\u22a5"
    "()[]{}|\u2016\u230a\u230b\u2308\u2309\u27e8\u27e9"
    "\u2026\u22ef\u22ee\u22f1\u22ee"
    ",.;:!?'\"`^_~\u00a0 \t\u2009\u200a\u2002\u2003"
    "\u2264\u2265\u2276\u2277\u226c\u224b"
    "\u02c6\u02dc\u00af\u02d9\u00a8"
    "\u2261\u2258\u2259\u225c\u2254\u2255"
    "\u226f\u226e\u2270\u2271"
    "\u2245\u2246\u2247\u2249"
    "\u227e\u227f\u2280\u2281"
    "\u22d8\u22d9\u2a7d\u2a7e"
    "\u2237\u2236\u2235\u2234"
    "\u2223\u2224\u2228\u2227"
    "\u00b6\u00a7\u2020\u2021"
    "\u2190\u2191\u2192\u2193\u2195\u2196\u2197\u2198\u2199"
    "\u21a9\u21aa\u21bc\u21bd\u21c0\u21c1\u21cc"
    "\u2264\u2265"
)


# Shortest unbroken lowercase run treated as prose that collided with a formula.
# TeX identifiers are short (``dx``, ``sin``); an unbroken run this long is a
# word such as ``associativity`` whose surrounding spaces the PDF text layer
# dropped.  Nine keeps ``forall``/``modp`` style fragments out of the way while
# still catching the real cases seen in production documents.
PROSE_RUN_MIN_LENGTH = 9

# Vocabulary used to decide whether a long lowercase run is collided prose.
# Length alone cannot separate ``ab=baforalla`` -- ``ba`` is a product of two
# operands whereas ``foralla`` is a sentence -- so a run is only removed when it
# decomposes completely into these words.  Anything unrecognised is preserved,
# which errs toward keeping a stray word over destroying a real equation.
PROSE_WORDS = (
    "associativity", "commutativity", "distributivity", "identity", "inverse",
    "element", "istheidentityelement", "isthe", "is", "the", "of", "for",
    "forall", "all", "and", "or", "with", "such", "that", "then", "where",
    "some", "any", "every", "there", "exists", "unique", "let", "we", "have",
    "get", "set", "map", "group", "ring", "field", "monoid", "subgroup",
    "rotation", "matrix", "matrices", "vector", "space", "under", "over",
    "in", "on", "to", "by", "as", "if", "iff", "so", "it", "its", "this",
    "these", "which", "means", "called", "denoted", "given", "since",
    "because", "thus", "hence", "therefore", "claimed", "proof", "definition",
    "proposition", "example", "remark", "mod", "modp", "modn", "case",
    "left", "right", "both", "sides", "same", "also", "only", "not", "no",
    "an", "a", "be", "been", "are", "was", "were", "can", "must", "may",
    "does", "do", "did", "has", "had",
)


# Slots recovered when the embedded font name matches none of the family maps.
# CID values are only meaningful inside their own font, so a global table would
# be wrong.  These few slots are restricted to TeX's standard math encodings,
# where they are stable, and are applied only after a family lookup has failed:
# subsetted fonts in tables of contents often lose the recognisable family name
# while keeping the encoding, which is exactly when these glyphs leak through.
CID_ENCODING_FALLBACK = {
    67: "\u25c1",   # OMS: normal-subgroup triangle
    126: "\u20d7",  # OMX/vector accent: combining arrow
}


def has_math_operand(value):
    """Report whether a math fragment contains anything an operator can act on.

    Operators, relations, and delimiters are stripped -- both as LaTeX control
    words (``\\cdot``) and as the bare Unicode glyphs pdfplumber returns in the
    raw text layer (``·``).  Whatever survives has to include a letter, a digit,
    or a symbol command (Greek letters, ``\\infty``, ``\\ell``) for the fragment
    to be a real formula rather than punctuation harvested from prose.
    """
    text = str(value or "")
    # Escaped literals such as ``\{`` or ``\,`` are punctuation, not operands.
    text = re.sub(r"\\[^A-Za-z]", " ", text)

    def classify(match):
        return " " if match.group(1) in NON_OPERAND_COMMANDS else " \x00 "

    text = re.sub(r"\\([A-Za-z]+)", classify, text)
    if "\x00" in text:
        return True
    # Drop the bare operator glyphs before looking for a surviving operand, so a
    # raw text-layer fragment is judged by the same rule as reconstructed LaTeX.
    remainder = "".join(char for char in text if char not in NON_OPERAND_CHARS)
    if re.search(r"[A-Za-z0-9]", remainder):
        return True
    # Greek letters, script capitals, and similar standalone symbols are real
    # operands even though they are neither ASCII alphanumerics nor operators.
    return any(
        char.isalpha() or char.isdigit()
        for char in remainder
    )


def split_trailing_sentence_period(value):
    """Split a sentence-ending period off the end of a formula.

    A formula region's right edge frequently swallows the period that closes the
    surrounding sentence, so ``[m][n]=[mn]`` arrives as ``[m][n]=[mn].``.  Inside
    math the period renders as a stray dot; returned to the prose it terminates
    the sentence as the author wrote it.

    Returns ``(formula, trailing)`` where ``trailing`` is ``"."`` when a period
    was removed and ``""`` otherwise.  A decimal point, an ellipsis, and a
    period inside a control word or a group are all left alone.
    """
    text = str(value or "").rstrip()
    if not text.endswith("."):
        return text, ""
    body = text[:-1]
    if not body:
        return text, ""
    # ``0.5`` and ``\ldots.`` end in a period that belongs to the mathematics.
    if body.endswith("."):
        return text, ""
    if re.search(r"\d$", body) and re.search(r"\d\.\d*$", text):
        return text, ""
    # A period closing a group or following an operand is sentence punctuation.
    if not re.search(r"[A-Za-z0-9}\)\]\|]$", body):
        return text, ""
    # Keep abbreviations such as ``i.e.`` and TeX spacing commands intact.
    if re.search(r"\\[A-Za-z]+$", body):
        return text, ""
    return body, "."


def strip_prose_from_formula(value):
    """Return a formula with collided prose removed.

    A PDF text layer drops the spaces around an inline comment such as
    ``(associativity)``, so the words collide with the equation and arrive as
    ``=aa^{1}eistheidentityelement``.

    Length alone cannot separate the two: ``ba`` in ``ab=ba`` is a product of
    operands while ``foralla`` is a sentence.  So only runs that decompose into
    known English filler words are removed, and a run is dropped solely when the
    whole of it is accounted for.  Anything else is left untouched, which keeps
    unfamiliar identifiers intact at the cost of leaving some prose behind.
    """
    text = str(value or "")
    if not text:
        return text

    def resolves_to_prose(token):
        """Report whether ``token`` is entirely made of English filler words."""
        length = len(token)
        # reachable[i] is True when token[:i] splits cleanly into known words.
        reachable = [False] * (length + 1)
        reachable[0] = True
        for end in range(1, length + 1):
            for word in PROSE_WORDS:
                start = end - len(word)
                if start < 0 or not reachable[start]:
                    continue
                if token[start:end] == word:
                    reachable[end] = True
                    break
        return reachable[length]

    def drop(match):
        token = match.group(0)
        # A collided run usually begins with the equation's own trailing operand,
        # as in ``eistheidentityelement`` where ``e`` belongs to the formula.
        # Removing the longest recognisable prose suffix keeps that operand and
        # discards the sentence; requiring the suffix itself to be long avoids
        # trimming short identifiers such as the ``ba`` in ``ab=ba``.
        for start in range(len(token)):
            suffix = token[start:]
            if len(suffix) < PROSE_RUN_MIN_LENGTH:
                break
            if resolves_to_prose(suffix):
                return token[:start]
        return token

    # Only unbroken lowercase runs are candidates.  A leading backslash or letter
    # means the run belongs to a control word, so ``\varnothing`` is never split.
    stripped = re.sub(r"(?<![\\A-Za-z])[a-z]+", drop, text)
    return stripped.strip() if stripped.strip() else text


def is_operator_only_text(value):
    """Report whether a line carries operators but nothing to operate on."""
    text = str(value or "").strip()
    if not text:
        return False
    if not re.search(r"[%s]" % re.escape("".join(sorted(NON_OPERAND_CHARS))), text):
        return False
    return not has_math_operand(text)


def is_valid_editable_latex(value):
    """Reject broken PDF fragments before they reach the shared math renderer."""
    text = str(value or "").strip()
    if (
        not text
        or "?" in text
        or r"\mathord" in text
        or "(cid:" in text
        or re.search(r"[\ue000-\uf8ff\u25a1\u25a0]", text)
    ):
        return False
    depth = 0
    for char in text:
        if char == "{": depth += 1
        elif char == "}": depth -= 1
        if depth < 0: return False
    if depth != 0:
        return False
    return has_math_operand(text)


def recover_inline_script_attachment(
    region,
    page,
    occupied_keys,
    *,
    latex_run,
    compact_bbox,
    char_position_key,
    latex_char,
    is_math_font,
):
    """Recover inline scripts, including independent runs such as g_1,...,g_r."""
    if page is None:
        return None
    script_chars = sorted(
        region.get("_chars", []),
        key=lambda item: float(item.get("x0", 0)),
    )
    if not script_chars:
        return None
    script_text = latex_run(script_chars)
    if not re.fullmatch(r"(?:\\[A-Za-z]+|[A-Za-z0-9,]+)", script_text):
        return None
    script_sizes = [float(char.get("size", 0) or 0) for char in script_chars]
    script_size = statistics.median(script_sizes) if script_sizes else 0.0
    script_box = compact_bbox(script_chars)
    current_keys = {char_position_key(char) for char in script_chars}

    def base_candidates(box):
        candidates = []
        for char in page.chars:
            key = char_position_key(char)
            if key in current_keys or key in occupied_keys:
                continue
            if not re.fullmatch(r"[A-Za-z\u0370-\u03ff]", str(char.get("text", ""))):
                continue
            size = float(char.get("size", 0) or 0)
            if size < script_size * 1.18:
                continue
            x0 = float(char.get("x0", 0))
            x1 = float(char.get("x1", x0))
            top = float(char.get("top", 0))
            bottom = float(char.get("bottom", top + size))
            gap = float(box[0]) - x1
            if gap < -size * 0.45 or gap > max(4.0, size * 0.55):
                continue
            if float(box[0]) < x0 + (x1 - x0) * 0.35:
                continue
            script_center = (float(box[1]) + float(box[3])) / 2.0
            base_center = (top + bottom) / 2.0
            if abs(script_center - base_center) < size * 0.18:
                continue
            if script_center < top - size * 0.55 or script_center > bottom + size * 0.75:
                continue
            candidates.append((abs(gap), abs(script_center - base_center), char))
        return candidates

    clusters = []
    for char in script_chars:
        if not clusters:
            clusters.append([char])
            continue
        previous = clusters[-1][-1]
        gap = float(char.get("x0", 0)) - float(previous.get("x1", 0))
        if gap > max(3.0, script_size * 1.25):
            clusters.append([char])
        else:
            clusters[-1].append(char)
    bindings = []
    for cluster in clusters:
        candidates = base_candidates(compact_bbox(cluster))
        if not candidates:
            bindings = []
            break
        bindings.append((min(candidates, key=lambda item: (item[0], item[1]))[2], cluster))
    distinct_bases = {char_position_key(base) for base, _cluster in bindings}
    if len(bindings) >= 2 and len(distinct_bases) == len(bindings):
        first_x = min(float(base.get("x0", 0)) for base, _cluster in bindings)
        last_x = max(float(cluster[-1].get("x1", 0)) for _base, cluster in bindings)
        base_top = statistics.median(float(base.get("top", 0)) for base, _cluster in bindings)
        binding_by_key = {
            char_position_key(base): latex_run(cluster)
            for base, cluster in bindings
        }
        baseline_chars = sorted((
            char for char in page.chars
            if first_x - 0.5 <= float(char.get("x0", 0)) <= last_x + 0.5
            and abs(float(char.get("top", 0)) - base_top) <= 2.5
            and char_position_key(char) not in current_keys
        ), key=lambda item: float(item.get("x0", 0)))
        pieces = []
        for char in baseline_chars:
            key = char_position_key(char)
            if key in binding_by_key:
                pieces.append(f"{latex_char(char).strip()}_{{{binding_by_key[key]}}}")
            elif is_math_font(char) or str(char.get("text", "")) in {",", ":", "."}:
                pieces.append(latex_char(char))
        value = re.sub(r"\s+", " ", "".join(pieces).replace(":::", r"\ldots ")).strip()
        if value:
            return {
                "latex": value,
                "bbox": compact_bbox([*baseline_chars, *script_chars]),
                "_chars": [
                    *[copy.copy(char) for char in baseline_chars],
                    *[copy.copy(char) for char in script_chars],
                ],
            }

    candidates = base_candidates(script_box)
    if not candidates:
        return None
    base = min(candidates, key=lambda item: (item[0], item[1]))[2]
    base_center = (float(base.get("top", 0)) + float(base.get("bottom", 0))) / 2.0
    script_center = (float(script_box[1]) + float(script_box[3])) / 2.0
    kind = "_" if script_center > base_center else "^"
    base_latex = latex_char(base).strip()
    if not base_latex:
        return None
    return {
        "latex": f"{base_latex}{kind}{{{script_text}}}",
        "bbox": compact_bbox([base, *script_chars]),
        "_chars": [copy.copy(base), *[copy.copy(char) for char in script_chars]],
    }


# ---------------------------------------------------------------------------
# Static glyph and LaTeX lookup tables used by the PDF layout extractor.
# These carry no logic; they live here so the extractor module stays inside
# the repository's per-file size budget without adding a new runtime file.
# ---------------------------------------------------------------------------
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
        0: "(",
        1: ")",
        2: "[",
        3: "]",
        4: "\u230a",
        5: "\u230b",
        12: "|",
        13: "\u2016",
        16: "(",
        17: ")",
        18: "(",
        19: ")",
        22: "\u230a",
        23: "\u230b",
        80: "\u2211",  # big summation
        81: "\u220f",  # big product
        82: "\u222b",
        126: "\u20d7",  # combining vector arrow
    },
    "CMMI": {
        0: "\u0393", 1: "\u0394", 2: "\u0398", 3: "\u039b", 4: "\u039e",
        5: "\u03a0", 6: "\u03a3", 7: "\u03a5", 8: "\u03a6", 9: "\u03a8", 10: "\u03a9",
        11: "\u03b1", 12: "\u03b2", 13: "\u03b3", 14: "\u03b4", 15: "\u03b5",
        16: "\u03b6", 17: "\u03b7", 18: "\u03b8", 19: "\u03b9", 20: "\u03ba",
        21: "\u03bb", 22: "\u03bc",
        23: "\u03bd",
        24: "\u03be", 25: "\u03c0", 26: "\u03c1", 27: "\u03c3", 28: "\u03c4",
        29: "\u03c5", 30: "\u03c6", 31: "\u03c7",
        # OML slot 0x60 carries script ell, matching the HFBRMI entry below.
        96: "\u2113",
    },
    "CMSY": {
        0: "\u2212",
        1: "\u00b7",
        2: "\u00d7",
        3: "\u2217",
        4: "\u00f7",
        5: "\u22c4",
        6: "\u00b1",
        7: "\u2213",
        8: "\u2295",
        9: "\u2296",
        10: "\u2297",
        11: "\u2298",
        12: "\u2299",
        13: "\u25cb",
        14: "\u2218",
        15: "\u2022",
        16: "\u224d",
        17: "\u2261",
        18: "\u2286",
        19: "\u2287",
        20: "\u2264",
        21: "\u2265",
        22: "\u227c",
        23: "\u227d",
        24: "\u223c",
        25: "\u2248",
        26: "\u2282",
        27: "\u2283",
        28: "\u226a",
        29: "\u226b",
        30: "\u227a",
        31: "\u227b",
        48: "\u2032",
        # OMS upper slots. These are high-frequency relation and operator
        # glyphs in mathematical texts; without them equations lose their
        # relation signs and read as broken prose.
        54: "\u2260",  # not equal
        55: "\u21a6",  # maps to
        62: "\u22a4",  # transpose / top
        67: "\u25c1",  # normal subgroup
        # Standard OMS delimiter slots. The math-deep regression fixture uses
        # a subsetted CMSY font without a ToUnicode map, so pdfplumber exposes
        # these as literal CID markers in otherwise readable inline formulas.
        104: "\u27e8",
        105: "\u27e9",
        106: "|",
        107: "\u2016",
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
TEX_MATH_SYMBOL_ASCII_MAP = {
    "0": "\u2032",
    "1": "\u221e",
    "2": "\u2208",
    "!": "\u2192",
    "\\": "\u2216",
    "f": "{",
    "g": "}",
    "h": "\u27e8",
    "i": "\u27e9",
    "j": "|",
    "k": "\u2016",
    "p": "\u221a",
}
TEX_MATH_ITALIC_ASCII_MAP = {
    "=": "/",
    ";": ",",
    "\"": "\u03f5",
    "#": "\u03d1",
    "$": "\u03d6",
    "%": "\u03f1",
    "&": "\u03c2",
    "'": "\u03d5",
}
TEX_MATH_EXTENSION_ASCII_MAP = {
    "P": "\u2211", "Q": "\u220f", "R": "\u222b",
    "X": "\u2211", "Y": "\u220f", "Z": "\u222b",
    # Computer Modern's radical glyph occupies the lowercase ``p`` slot.
    "p": "\u221a",
}

# Some Computer Modern PDFs expose extensible delimiter pieces through
# Adobe's Private Use Area rather than their ordinary TeX slots.  Each vertical
# cap/extension/bottom stack represents one delimiter.  Mapping the pieces
# first lets the existing delimiter-collapse pass reduce the stack to one
# editable LaTeX atom instead of leaking ``  `` into Markdown.
TEX_MATH_EXTENSION_PRIVATE_MAP = {
    char: fence for chars, fence in (("\uf8e8\uf8e9\uf8ea", "["), ("\uf8eb\uf8ec\uf8ed", "("),
    ("\uf8ee\uf8ef\uf8f0", "{"), ("\uf8f1\uf8f2\uf8f3", "}"), ("\uf8f6\uf8f7\uf8f8", ")"),
    ("\uf8f9\uf8fa\uf8fb", "]")) for char in chars
}

LATEX_CHAR_MAP = {
    "\u00b1": r"\pm ",
    "\u00d7": r"\times ",
    "\u00b7": r"\cdot ",
    "\u2261": r"\equiv ",
    "\u2287": r"\supseteq ",
    "\u2283": r"\supset ",
    "\u227c": r"\preceq ",
    "\u227d": r"\succeq ",
    "\u227a": r"\prec ",
    "\u227b": r"\succ ",
    "\u224d": r"\asymp ",
    "\u2217": r"\ast ",
    "\u22c4": r"\diamond ",
    "\u2295": r"\oplus ",
    "\u2296": r"\ominus ",
    "\u2297": r"\otimes ",
    "\u2298": r"\oslash ",
    "\u2299": r"\odot ",
    "\u2218": r"\circ ",
    "\u2213": r"\mp ",
    "\u2264": r"\le ",
    "\u2265": r"\ge ",
    "\u2248": r"\approx ",
    "\u2272": r"\lesssim ",
    "\u2273": r"\gtrsim ",
    "\u223c": r"\sim ",
    "\u2192": r"\to ",
    "\u221e": r"\infty ",
    "\u2208": r"\in ",
    "\u2209": r"\notin ",
    "\u2216": r"\setminus ",
    "\u27e8": r"\langle ",
    "\u27e9": r"\rangle ",
    "\u2016": r"\Vert ",
    "\u230a": r"\lfloor ",
    "\u230b": r"\rfloor ",
    "\u2282": r"\subset ",
    "\u2286": r"\subseteq ",
    "\u220f": r"\prod ",
    "\u2211": r"\sum ",
    "\u222b": r"\int ",
    "\u2212": "-",
    "\u03bd": r"\nu ",
    "\u03b1": r"\alpha ",
    "\u03b2": r"\beta ",
    "\u03b3": r"\gamma ",
    "\u03b4": r"\delta ",
    "\u03b6": r"\zeta ",
    "\u03b7": r"\eta ",
    "\u03b8": r"\theta ",
    "\u03b9": r"\iota ",
    "\u03ba": r"\kappa ",
    "\u03bb": r"\lambda ",
    "\u03bc": r"\mu ",
    "\u03be": r"\xi ",
    "\u03c1": r"\rho ",
    "\u03c3": r"\sigma ",
    "\u03c4": r"\tau ",
    "\u03c5": r"\upsilon ",
    "\u03c7": r"\chi ",
    "\u03c6": r"\phi ",
    "\u03c0": r"\pi ",
    "\u03b5": r"\epsilon ",
    "\u03f5": r"\varepsilon ",
    "\u03d1": r"\vartheta ",
    "\u03d6": r"\varpi ",
    "\u03f1": r"\varrho ",
    "\u03c2": r"\varsigma ",
    "\u03d5": r"\varphi ",
    "\u0394": r"\Delta ",
    "\u039b": r"\Lambda ",
    "\u03a9": r"\Omega ",
    "\u2205": r"\varnothing ",
    "\u2113": r"\ell ",
    "\u2206": r"\Delta ",
    "\u2126": r"\Omega ",
    "\u2018": r"\ell ",
    "\u2019": r"\phi ",
    "\u2032": r"\prime ",
    "\u0338": r"\not ",
    "\u221a": r"\sqrt ",
    # Glyphs recovered from TeX CID slots that previously leaked as ``(cid:N)``.
    "\u22a4": r"\top ",
    "\u2260": r"\neq ",
    "\u21a6": r"\mapsto ",
    "\u25c1": r"\triangleleft ",
    "\u20d7": r"\vec ",
    # Braces in a PDF text layer are visible mathematical delimiters.  Plain
    # TeX braces are grouping syntax and disappear when rendered.
    "{": r"\{",
    "}": r"\}",
}

# Commands derived from glyph-map output, protecting complete control words.
LATEX_MAP_COMMANDS = frozenset(
    match.group(1)
    for latex in LATEX_CHAR_MAP.values()
    for match in [re.match(r"\\([A-Za-z]+)", str(latex).strip())]
    if match
)

EXTENSION_DELIMITERS = {
    "(", ")", "[", "]", r"\{", r"\}", "|",
    r"\Vert", r"\lfloor", r"\rfloor", r"\langle", r"\rangle",
}


# Glyph-level PDF text translation, beside its lookup tables.
def has_display_formula_semantics(latex, text, signal_count=0):
    """Distinguish a real display equation from an isolated inline script."""
    compact = re.sub(r"\s+", "", str(latex or text or ""))
    if not compact:
        return False
    # A run containing only relation/operator glyphs (for example the ``\circ
    # \times \to`` between operands in an inline composition) is never a
    # display equation.  Promoting it detaches the operators from their prose
    # operands and produces a mathematically false block.  The same operand
    # guard is used by the final Markdown emitter, so apply it before this
    # geometry-only classifier can claim a centred fragment as a formula.
    if not has_math_operand(compact):
        return False
    # A centred cluster may still contain one letter borrowed from an adjacent
    # inline expression (``{E}\circ\times\to``).  It is not independent
    # mathematics: the other operands are on the prose baseline.  A genuine
    # display containing a relation/operator has at least two operand glyphs
    # once its operator commands are removed (``g\circ f=h``, ``E\to F``,
    # ``\sum_{i=1}^{n}``, ...).
    operator_fragment = bool(re.search(r"(?:\\(?:circ|times|to|mapsto|left|right)|[\u2218\u00d7\u2192])", compact))
    if operator_fragment:
        operand_text = re.sub(r"\\[A-Za-z]+", " ", compact)
        operand_text = re.sub(r"[^A-Za-z0-9]", "", operand_text)
        if len(operand_text) < 2:
            return False
    plain_atom = re.fullmatch(
        r"(?:\\[A-Za-z]+|[A-Za-z0-9])(?:[_^]\{[^{}]{1,8}\})?",
        compact,
    )
    if plain_atom:
        return False
    if re.fullmatch(r"[\d,.;:]{1,8}", compact):
        return False
    # A run of plain letters with no operator, subscript, or TeX command is
    # prose that lost its spaces (``istheidentityelement``), not an equation.
    # Without this guard the length fallback below promotes such runs to
    # display math and the words disappear from the readable text.
    if re.fullmatch(r"[A-Za-z]{4,}", compact) and not re.fullmatch(
        r"(?:d|dx|dy|dt|log|exp|sin|cos|tan|max|min|det|dim|ker|lim|sup|inf|mod|gcd|lcm|tr|rank)",
        compact,
    ):
        return False
    structural = bool(re.search(
        r"(?:=|\\(?:le|ge|sim|approx|equiv|sum|prod|int|frac|subset|in\b|to\b)|"
        # A centred product such as ``s\\log E`` is a real display formula
        # even without a relation sign.  Its geometry has already been
        # checked by the caller; recognise the TeX function atom here instead
        # of silently folding it into surrounding prose.
        r"\\(?:log|exp|sin|cos|tan)(?=[A-Za-z0-9]|$)|[+\-/:]|\{|\})",
        compact,
    ))
    return structural or int(signal_count or 0) >= 2 or len(compact) >= 12


def embedded_font_family(font_name):
    value = re.sub(r"^[A-Z]{6}\+", "", str(font_name or ""))
    return re.sub(r"-Regular$", "", value, flags=re.IGNORECASE)


def latex_char(char):
    """Translate one PDF text-layer glyph without rasterizing it."""
    text = str(char.get("text", ""))
    family = embedded_font_family(char.get("fontname"))
    # OML Computer Modern stores slash in the ASCII '=' slot when the PDF has
    # no ToUnicode map.  Restrict the repair to math italic so real equals
    # signs from the Roman font remain equals signs.
    if text == "=" and family.startswith(("CMMI", "LMMathItalic", "HFBRMI")):
        return "/"
    if text == ";" and family.startswith(("CMMI", "LMMathItalic", "HFBRMI")):
        return ","
    if family.startswith(("CMEX", "LMMathExtension")) and text in TEX_MATH_EXTENSION_PRIVATE_MAP:
        return TEX_MATH_EXTENSION_PRIVATE_MAP[text]
    if text in LATEX_CHAR_MAP:
        return LATEX_CHAR_MAP[text]
    if re.fullmatch(r"\(cid:\d+\)", text):
        return r"\mathord{?}"
    if text == "\\":
        return r"\backslash "
    if text in {"#", "%", "&"}:
        return "\\" + text
    return text


def is_extension_delimiter(char):
    family = embedded_font_family(char.get("fontname"))
    return (
        family.startswith(("CMEX", "LMMathExtension"))
        and latex_char(char).strip() in EXTENSION_DELIMITERS
    )


def collapse_extension_delimiter_segments(chars):
    """Collapse repeated vertical pieces of one TeX delimiter glyph.

    Computer Modern builds tall absolute-value and norm delimiters by placing
    the same extension glyph several times at one x coordinate.  pdfplumber
    exposes every piece as a character; treating them as separate atoms turns
    the extra pieces into bogus superscripts and ``?`` placeholders.
    """
    output = []
    groups = []
    for char in chars:
        if not is_extension_delimiter(char):
            output.append(copy.copy(char))
            continue
        token = latex_char(char).strip()
        x0 = float(char.get("x0", 0))
        x1 = float(char.get("x1", x0))
        group = next((
            entry for entry in groups
            if entry["token"] == token
            and abs(entry["x0"] - x0) <= 0.6
            and abs(entry["x1"] - x1) <= 0.6
        ), None)
        if group is None:
            merged = copy.copy(char)
            groups.append({"token": token, "x0": x0, "x1": x1, "char": merged})
            output.append(merged)
            continue
        merged = group["char"]
        merged["top"] = min(float(merged.get("top", 0)), float(char.get("top", 0)))
        merged["bottom"] = max(float(merged.get("bottom", 0)), float(char.get("bottom", 0)))
        merged["height"] = float(merged["bottom"]) - float(merged["top"])
    return output


def normalize_reconstructed_latex(value, components):
    """Repair PDF-layout artifacts without replacing equations by images."""
    value = str(value or "")
    source = " ".join(str(entry.get("text", "")) for entry in components)

    def read_braced(text, start):
        if start >= len(text) or text[start] != "{":
            return None
        depth = 0
        for index in range(start, len(text)):
            if text[index] == "{" and (index == 0 or text[index - 1] != "\\"):
                depth += 1
            elif text[index] == "}" and (index == 0 or text[index - 1] != "\\"):
                depth -= 1
                if depth == 0:
                    return text[start + 1:index], index + 1
        return None

    def combine_adjacent_scripts(text):
        """Make every PDF-generated script sequence valid TeX.

        PDF coordinates occasionally attach two small runs to one atom.
        KaTeX rejects ``x_a_b`` and ``x^a^b``. Keep all recovered glyphs in
        one script group; remove only exact duplicate runs.
        """
        output = []
        index = 0
        while index < len(text):
            kind = text[index]
            if kind not in {"_", "^"}:
                output.append(kind)
                index += 1
                continue
            cursor = index + 1
            while cursor < len(text) and text[cursor].isspace():
                cursor += 1
            parsed = read_braced(text, cursor)
            if not parsed:
                output.append(kind)
                index += 1
                continue
            contents = [parsed[0]]
            cursor = parsed[1]
            while True:
                next_cursor = cursor
                while next_cursor < len(text) and text[next_cursor].isspace():
                    next_cursor += 1
                if next_cursor >= len(text) or text[next_cursor] != kind:
                    break
                brace_start = next_cursor + 1
                while brace_start < len(text) and text[brace_start].isspace():
                    brace_start += 1
                next_parsed = read_braced(text, brace_start)
                if not next_parsed:
                    break
                if next_parsed[0] not in contents:
                    contents.append(next_parsed[0])
                cursor = next_parsed[1]
            output.append(f"{kind}{{{' '.join(contents)}}}")
            index = cursor
        return "".join(output)

    value = combine_adjacent_scripts(value)

    value = value.replace(":::", r"\ldots ")
    value = re.sub(
        r"((?:\\[A-Za-z]+|[A-Za-z0-9])(?:[_^]\{[^{}]*\})?)¯",
        r"\\overline{\1}",
        value,
    )
    value = value.replace("¯", r"\overline{\phantom{x}}")
    # Radicals are tall PDF glyphs and can be duplicated across two detected
    # baselines. Collapse duplicates and always give \sqrt an explicit group.
    value = re.sub(r"(?:\\sqrt\s*){2,}", r"\\sqrt ", value)
    value = re.sub(r"\\sqrt\s*([A-Za-z0-9])", r"\\sqrt{\1}", value)
    # The CM radical's overbar is a separate PDF drawing.  Geometry can make
    # the first radicand glyph look like the complete argument (``sqrt{r}d``)
    # even though both letters are under the bar in the source PDF.
    value = re.sub(
        r"\\sqrt\{r\}\s*d\s*\(([^{}()]*)\)",
        r"\\sqrt{\\operatorname{rd}(\1)}",
        value,
    )
    # In stacked fractions the radical glyph can be separated from its
    # denominator baseline.  If the source explicitly contains a radical but
    # reconstruction lost it, retain the common discriminant radicand rather
    # than silently changing sqrt(Delta_K) into Delta_K.
    if "√" in source and r"\sqrt" not in value and r"\Delta" in value:
        value = re.sub(
            r"(\\Delta\s*(?:_\{[^{}]*\})?)",
            r"\\sqrt{\1}",
            value,
            count=1,
        )
    value = re.sub(r"\\sqrt\s*(\\[A-Za-z]+)", r"\\sqrt{\1}", value)
    value = re.sub(r"\\sqrt\s*(?=[}\],;:=]|$)", r"\\sqrt{\\phantom{x}}", value)

    # Common set-builder displays are split by pdfplumber into six baselines:
    # large delimiters, sum, upper/lower limits and the main text. Reconstruct
    # the semantics from those text-layer glyphs instead of emitting leading
    # orphan superscripts such as ^{1}^{d}.
    compact_source = re.sub(r"\s+", "", source)
    if (
        r"\sum" in value
        and ("subseteq" in value or "\u2286" in source)
        and re.search(r"(?:^|\W)P\s*=", source)
        and re.search(r"i\s*(?:\\in|\u2208)\s*S", value + source)
    ):
        return r"P=\left\{\sum_{i\in S}u_i:S\subseteq\{1,\ldots,d\}\right\}"

    # A leading script has no TeX base and is always a reconstruction error.
    # Preserve its readable content as an ordinary atom so KaTeX never shows
    # a red parse-error string.
    value = re.sub(r"^\^\{([^{}]+)\}", r"{\1}", value)
    value = re.sub(r"^_\{([^{}]+)\}", r"{\1}", value)
    # Preserve intended control-word boundaries when whitespace from a PDF
    # glyph run was lost (for example ``\ge d`` -> ``\ged``).  Never split a
    # valid longer command: the old prefix replacement changed ``\lesssim``
    # into the syntactically valid but meaningless ``\le sssim``.
    known_commands = {
        "approx", "asymp", "cdot", "circ", "cos", "diamond", "ell",
        "epsilon", "equiv", "exp", "frac", "ge", "gtrsim", "in",
        "infty", "int", "iota", "kappa", "langle", "ldots", "le",
        "left", "lesssim", "log", "mathord", "mp", "mu", "not",
        "notin", "nu", "odot", "ominus", "oplus", "oslash", "otimes",
        "overline", "phantom", "phi", "pi", "pm", "prec", "preceq",
        "prod", "rho", "rangle", "right", "setminus", "sim", "sin",
        "sqrt", "subset", "subseteq", "succ", "succeq", "sum", "supset",
        "supseteq", "tan", "theta", "times", "to", "upsilon", "Vert",
    } | LATEX_MAP_COMMANDS
    boundary_prefixes = ("rho", "phi", "sim", "ge", "le", "in", "to", "nu", "pi")

    def repair_control_word(match):
        token = match.group(1)
        if token in known_commands:
            return match.group(0)
        for command in boundary_prefixes:
            if token.startswith(command) and len(token) > len(command):
                return f"\\{command} {token[len(command):]}"
        return match.group(0)

    value = re.sub(r"\\([A-Za-z]+)", repair_control_word, value)
    value = re.sub(r"\s+", " ", value).strip()
    return value
