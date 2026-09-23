"""Source page geometry: conservative column flow and explicit table grids.

Full-width blocks separate independently ordered column bands. Geometry is
inspected before synthetic markers are inserted.
"""


def source_table_grid(table, rows):
    """Recover spans only from real cell boundaries, never from empty text.

    Text remains assigned to its own cell anchor. Overlapping or inconsistent
    boxes decline structural reconstruction instead of hiding neighbouring text.
    """
    cells = [box for row in getattr(table, "rows", []) for box in row.cells if box]
    if not cells or len(cells) > 120000 or len(rows) > 2000:
        return None
    xs = sorted({round(float(box[i]), 3) for box in cells for i in (0, 2)})
    ys = sorted({round(float(box[i]), 3) for box in cells for i in (1, 3)})
    width, height = len(xs)-1, len(ys)-1
    if not 0 < width <= 60 or not 0 < height <= 2000:
        return None
    xi, yi = {value:i for i,value in enumerate(xs)}, {value:i for i,value in enumerate(ys)}
    boxes = []
    if len(rows) != len(table.rows):
        return None
    for source_row, values in zip(table.rows, rows):
        if len(values) != len(source_row.cells): return None
        for box, text in zip(source_row.cells, values):
            if box is None:
                if str(text or "").strip(): return None
                continue
            x0,y0,x1,y1 = [round(float(value),3) for value in box]
            c,r,end_c,end_r = xi[x0],yi[y0],xi[x1],yi[y1]
            if end_c <= c or end_r <= r or len(str(text or "")) > 2000: return None
            boxes.append({"row":r,"column":c,"rowSpan":end_r-r,"columnSpan":end_c-c,"bbox":list(box),"text":str(text or "")})
    from pdfTableStructure import table_grid
    return table_grid(height, width, boxes)


def column_flow(chars, width, height, origin=(0, 0), regions=()):
    import statistics
    boxes = [r.get("contentBbox") or r.get("bbox") for r in regions if not r.get("preserveSourceText")]
    boxes = [b for b in boxes if b and len(b) == 4]
    chars = [c for c in chars if not any(b[0] <= (c["x0"]+c["x1"])/2 <= b[2]
             and b[1] <= (c["top"]+c["bottom"])/2 <= b[3] for b in boxes)]
    rows = []
    for char in sorted(chars, key=lambda c: (float(c["top"]), float(c["x0"]))):
        if not str(char.get("text", "")).strip():
            continue
        top = float(char["top"])
        row = next((r for r in reversed(rows[-3:]) if abs(r["top"] - top) <= 3), None)
        if row is None:
            row = {"top": top, "chars": []}
            rows.append(row)
        row["chars"].append(char)
    # Columns need not share baselines. Use short horizontal bands to measure
    # repeated gutter support; keep original lines to detect spanning prose.
    band_height = max(12, 2 * statistics.median([float(c["bottom"]) - float(c["top"]) for c in chars] or [9]))
    bands = {}
    for row in rows:
        key = int((row["top"] - origin[1]) // band_height)
        bands.setdefault(key, {"top": row["top"], "chars": []})["chars"].extend(row["chars"])
    candidates = []
    for band in bands.values():
        ordered = sorted(band["chars"], key=lambda c: float(c["x0"]))
        endpoints = []
        for char in ordered:
            endpoints.append(max(float(char["x1"]), endpoints[-1] if endpoints else float("-inf")))
        for index in range(12, len(ordered) - 12):
            left = endpoints[index - 1]
            right = float(ordered[index]["x0"])
            if right - left >= 18 and origin[0] + width * .25 < (left + right) / 2 < origin[0] + width * .75:
                candidates.append((left + right) / 2)
    best = None
    for cut in sorted(set(round(c, 1) for c in candidates)):
        supported, crossing = [], []
        for row in rows:
            left = [c for c in row["chars"] if float(c["x1"]) <= cut]
            right = [c for c in row["chars"] if float(c["x0"]) >= cut]
            if not left or not right:
                continue
            gap = min(float(c["x0"]) for c in right) - max(float(c["x1"]) for c in left)
            if gap < 18 or any(float(c["x0"]) < cut < float(c["x1"]) for c in row["chars"]):
                crossing.append([min(float(c["top"]) for c in row["chars"]),
                                 max(float(c["bottom"]) for c in row["chars"])])
        for band in bands.values():
            left = [c for c in band["chars"] if float(c["x1"]) <= cut - 9]
            right = [c for c in band["chars"] if float(c["x0"]) >= cut + 9]
            clear = all(float(c["x1"]) <= cut - 9 or float(c["x0"]) >= cut + 9 for c in band["chars"])
            if clear and len(left) >= 12 and len(right) >= 12:
                supported.append(band)
        if len(supported) < max(6, len(rows) * .12):
            continue
        crossing += [[b[1], b[3]] for b in boxes if b[0] < cut < b[2] and b[2]-b[0] > width*.4]
        barriers = []
        for top, bottom in sorted(crossing):
            if barriers and top <= barriers[-1][1]+3:
                barriers[-1][1] = max(barriers[-1][1], bottom)
            else: barriers.append([top, bottom])
        zones, cursor, support = [], origin[1], 0
        for top, bottom in barriers + [[origin[1]+height, origin[1]+height]]:
            evidence = [b for b in supported if cursor <= b["top"] < top]
            # Each band needs its own evidence; one column below a heading
            # must not inherit two-column ordering from the preceding section.
            use_columns = len(evidence) >= 3
            if top > cursor: zones.append({"top": cursor, "bottom": top, "cut": cut if use_columns else None})
            if bottom > top: zones.append({"top": top, "bottom": bottom, "cut": None})
            if use_columns: support += len(evidence)
            cursor = bottom
        columns = [z for z in zones if z["cut"] is not None]
        if not columns: continue
        merged = []
        for z in zones:
            if merged and z["cut"] == merged[-1]["cut"]: merged[-1]["bottom"] = z["bottom"]
            else: merged.append(z)
        proposal = {"cut": cut, "top": columns[0]["top"], "bottom": columns[-1]["bottom"],
                    "supportingRows": support, "zones": merged,
                    "strategy": "segmented_columns" if len(columns) > 1 else "column_major"}
        if best is None or (support, -abs(cut-origin[0]-width/2)) > (best["supportingRows"], -abs(best["cut"]-origin[0]-width/2)):
            best = proposal
    return best


def extract_ordered_text(page, flow):
    if not flow:
        return page.extract_text(layout=False, x_tolerance=2, y_tolerance=3) or ""

    zones = flow.get("zones") or [
        {"top": float("-inf"), "bottom": flow["top"], "cut": None},
        {"top": flow["top"], "bottom": flow["bottom"], "cut": flow["cut"]},
        {"top": flow["bottom"], "bottom": float("inf"), "cut": None}]

    def zone(item):
        y = (float(item.get("top", 0)) + float(item.get("bottom", 0))) / 2
        # Synthetic markers can be wider than their source region. Their source
        # anchor is retained at x0, so do not use their artificial center.
        x = float(item.get("x0", 0)) if str(item.get("fontname", "")).startswith("SchemaDocs") else (float(item.get("x0", 0)) + float(item.get("x1", 0))) / 2
        for index, band in enumerate(zones):
            if y < band["bottom"] or index == len(zones)-1:
                return index*2 + int(band["cut"] is not None and x >= band["cut"])
        return 0

    parts = []
    for index in range(len(zones)*2):
        section = page.filter(lambda item: item.get("object_type") != "char" or zone(item) == index)
        text = section.extract_text(layout=False, x_tolerance=2, y_tolerance=3) or ""
        if text.strip():
            parts.append(text)
    return "\n\n".join(parts)


def extract_page_text(page, excluded_regions=None, flow=None):
    excluded = [r["contentBbox"] for r in excluded_regions or []
                if r.get("contentBbox") and not r.get("preserveSourceText")]
    if excluded:
        def keep(item):
            if item.get("object_type") != "char" or item.get("fontname") == "SchemaDocsImageMarker": return True
            x, y = (float(item["x0"])+float(item["x1"]))/2, (float(item["top"])+float(item["bottom"]))/2
            return not any(b[0] <= x <= b[2] and b[1] <= y <= b[3] for b in excluded)
        page = page.filter(keep)
    return extract_ordered_text(page, flow).replace(r"\n", "\n").replace(r"\r", "\r").replace(r"\t", "\t")


def inject_image_markers(page, images, page_number):
    if not page.chars: return
    template = dict(page.chars[0])
    for index, region in enumerate(images, 1):
        if not region.get("assetFile") or region.get("preserveSourceText"): continue
        x, top, right, bottom = region.get("contentBbox") or region["bbox"]
        marker = f"<!-- pdf-image: page={page_number} index={index} file={region['assetFile']} -->"
        # Keep the synthetic character inside its source region and separate
        # the image from any paragraph sharing its baseline.
        y = top + min(1, (bottom-top)/4)
        page.chars.append({**template, "text": "\n\n"+marker+"\n\n", "fontname": "SchemaDocsImageMarker",
                           "x0": x, "x1": min(x+1,right), "top": y, "bottom": min(y+1,bottom),
                           "doctop": float(page.initial_doctop)+y, "size": 1, "width": 1, "height": 1, "upright": True})
        region["inlinePlaceholder"] = True


def paragraph_edges(page, flow):
    """Keep source evidence for possible continuation across physical pages."""
    import statistics
    from pdfplumber.utils import cluster_objects
    words = page.extract_words(x_tolerance=2, y_tolerance=3, extra_attrs=["size"])
    if not words or len(words) > 12000: return None
    zones = (flow or {}).get("zones") or [{"bottom": float("inf"), "cut": None}]
    grouped = {}
    for w in words:
        y, x = (w["top"]+w["bottom"])/2, (w["x0"]+w["x1"])/2
        band = next((i for i,z in enumerate(zones) if y < z["bottom"]), len(zones)-1)
        key = band*2 + int(zones[band]["cut"] is not None and x >= zones[band]["cut"])
        grouped.setdefault(key, []).append(w)
    lines = []
    for key in sorted(grouped):
        for line in cluster_objects(grouped[key], "top", 3):
            fragments=[]
            for word in sorted(line,key=lambda w:w['x0']):
                if not fragments or (word['x0']-fragments[-1][-1]['x1']>18
                    and abs(word['size']-fragments[-1][-1]['size'])>min(word['size'],fragments[-1][-1]['size'])*.2):
                    fragments.append([])
                fragments[-1].append(word)
            lines.extend(fragments)
    def edge(line):
        return {"text": " ".join(w["text"] for w in sorted(line, key=lambda w:w["x0"])),
                "bbox": [min(w["x0"] for w in line), min(w["top"] for w in line), max(w["x1"] for w in line), max(w["bottom"] for w in line)],
                "fontSize": statistics.median(w["size"] for w in line)}
    leading, trailing = [edge(line) for line in lines[:4]], [edge(line) for line in lines[-4:]]
    margins = []
    for index in sorted(set(range(min(3, len(lines)))) | set(range(max(0, len(lines)-3), len(lines)))):
        item = edge(lines[index])
        top, bottom = item["bbox"][1]-page.bbox[1], item["bbox"][3]-page.bbox[1]
        position = "top" if bottom < page.height*.1 else "bottom" if top > page.height*.9 else None
        neighbor = index+1 if position == "top" else index-1
        if position and 0 <= neighbor < len(lines):
            other = edge(lines[neighbor])["bbox"]
            gap = other[1]-item["bbox"][3] if position == "top" else item["bbox"][1]-other[3]
            if gap >= max(8, item["fontSize"]*1.3): margins.append({**item, "position": position})
    return {"first": leading[0], "last": trailing[-1], "leading": leading, "trailing": trailing, "margins": margins,
            "lines": [edge(line) for line in lines]}


def body_span(page, body_size):
    """Horizontal extent of the body-size text, as the run holding the median char.

    Characters merge into runs wherever no gutter of ``GUTTER`` points separates
    them, so a page split into columns keeps one run per column and the body is
    the run the median character falls in.  Measuring only body-size characters
    keeps a smaller margin note from widening the body it sits beside.
    """
    GUTTER = 12
    spans = sorted((float(c["x0"]), float(c["x1"])) for c in page.chars
                   if str(c.get("text", "")).strip() and float(c.get("size", body_size)) >= body_size*.85)
    if not spans: return None
    run, runs = list(spans[0]), []
    runs.append(run)
    for x0, x1 in spans[1:]:
        if x0 - run[1] >= GUTTER: run = [x0, x1]; runs.append(run)
        else: run[1] = max(run[1], x1)
    centre = spans[len(spans)//2]
    return next((r for r in runs if r[0] <= (centre[0]+centre[1])/2 <= r[1]), None)


def margin_lines(page, body_size, span):
    """Whole small-font lines lying beside the body column, not inside it.

    The line is judged as a unit: a small-font line crossing the body span is
    body text carrying a small fragment, and splitting it at the span's edge
    would cut a single line into pieces.  Small text wholly inside the span is
    left in place, because geometry cannot tell a superscript from a margin
    label sitting in the same column.
    """
    small = sorted((c for c in page.chars if str(c.get("text", "")).strip()
                    and float(c.get("size", body_size)) < body_size*.85),
                   key=lambda c: float(c["top"]))
    lines, boxes = [], []
    for char in small:
        if lines and abs(float(char["top"]) - float(lines[-1][0])) <= 3: lines[-1][1].append(char)
        else: lines.append((float(char["top"]), [char]))
    for _, chars in lines:
        x0, x1 = min(float(c["x0"]) for c in chars), max(float(c["x1"]) for c in chars)
        if x1-x0 < page.width*.3 and (x1 <= span[0]-1 or x0 >= span[1]+1):
            boxes.append([x0, min(float(c["top"]) for c in chars),
                          x1, max(float(c["bottom"]) for c in chars)])
    return boxes


def _isolate_text(page, bbox):
    x0, top, x1, bottom = bbox
    chars = [c for c in page.chars if x0-.1 <= c['x0'] and c['x1'] <= x1+.1 and top-.1 <= c['top'] and c['bottom'] <= bottom+.1]
    if not chars: return
    chars.sort(key=lambda c: c['x0'])
    chars[0]['text'] = '\n\n' + chars[0]['text']
    chars[-1]['text'] += '\n\n'


def isolate_sidebars(page, edges):
    """Separate side text from the body block before text serialization.

    Three shapes, none of which removes or reorders a body word: a small-font
    line in the page's right margin, a small-font line lying entirely left of
    the body column, and a narrow body-size side band clear of the body block.
    The two left-hand shapes are keyed to the body column's own extent, so a
    small line inside the column -- a superscript, a label under a symbol -- is
    never split out of the prose.  A body-size band sharing the body's vertical
    extent cannot be told from the column of a split page, so it is left to
    ``column_flow``, and taken only while it is the minority of the lines.
    """
    import statistics
    lines=(edges or {}).get('lines',[])
    body_size=statistics.median(item['fontSize'] for item in lines) if lines else 0
    span = body_span(page, body_size) if body_size else None
    # Side text is only meaningful beside a body *block*; on a one- or two-line
    # page the run holding the median character is that line itself, and
    # anything beyond it would look like a margin.
    if span is None or len(lines) < 3: return
    band = [item for item in lines
            if item['fontSize'] >= body_size*.85
            and (item['bbox'][2] <= span[0]-12 or item['bbox'][0] >= span[1]+12)
            and item['bbox'][2]-item['bbox'][0] < page.width*.35]
    block = [item for item in lines if item['bbox'][0] < span[1] and item['bbox'][2] > span[0]]
    if block:
        top = min(item['bbox'][1] for item in block)
        bottom = max(item['bbox'][3] for item in block)
        band = [item for item in band if item['bbox'][3] <= top-3 or item['bbox'][1] >= bottom+3]
    chosen = [item['bbox'] for item in lines
              if item['fontSize'] < body_size*.85 and item['bbox'][2]-item['bbox'][0] < page.width*.3
              and item['bbox'][0]-page.bbox[0] > page.width*.6]
    extra = margin_lines(page, body_size, span) + [item['bbox'] for item in band if len(band)*3 <= len(lines)]
    # A right-margin note qualifies twice; bracket each box once.
    chosen += [box for box in extra
               if not any(b[0] <= box[2] and box[0] <= b[2] and b[1] <= box[3] and box[1] <= b[3] for b in chosen)]
    for box in chosen: _isolate_text(page, box)


def separate_margin_lines(text, edges):
    margins = {item["text"] for item in (edges or {}).get("margins", [])}
    return "\n".join("\n"+line+"\n" if line.strip() in margins else line for line in text.splitlines())


def bind_paragraph_edges(edges, markdown):
    if not edges: return None
    lines = [s.strip() for s in markdown.splitlines() if s.strip()]
    if not lines: return None
    def bind(item, candidates, leading):
        matches = [text for text in candidates if len(text) <= 2000 and
                   (text.startswith(item["text"]) if leading else text.endswith(item["text"]))]
        return {**item, "text": matches[0]} if len(matches) == 1 else None
    return {"first": bind(edges["first"], lines[:1], True), "last": bind(edges["last"], lines[-1:], False),
            "leading": [value for item in edges["leading"] if (value := bind(item, lines[:8], True))],
            "trailing": [value for item in edges["trailing"] if (value := bind(item, lines[-8:], False))],
            "margins": [item for item in edges["margins"] if item["text"] in lines], "lines": edges.get("lines", [])}
