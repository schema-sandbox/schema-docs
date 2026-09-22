"""Bounded table grids: topology first, source text second.

Native cell geometry remains authoritative. Borderless recognition requires
repeated numeric columns, row labels and a geometrically consistent header;
ambiguous prose/math stays in the original extraction path.
"""
import math
import re
import statistics


def visible_table_objects(page):
    """Filled backgrounds have no stroked border; thin filled rules are visible."""
    def visible(item):
        if item.get('object_type') not in ('rect','curve','line'): return True
        if item.get('stroke'): return True
        return bool(item.get('fill') and min(abs(item.get('width',100)),abs(item.get('height',100))) <= 2)
    original=page.find_tables()
    filtered=page.filter(visible).find_tables()
    # Replace only the same bounded grid. Removing a fill must never unprotect
    # an enclosing illustration or turn its internal labels into formulas.
    result=[]
    for table in original:
        matches=[candidate for candidate in filtered
                 if all(abs(a-b)<=3 for a,b in zip(table.bbox,candidate.bbox))]
        result.append(matches[0] if len(matches)==1 else table)
    return result


def table_grid(row_count, column_count, cells, fill_empty=False):
    if (type(row_count) is not int or type(column_count) is not int
            or not 0 < row_count <= 2000 or not 0 < column_count <= 60
            or row_count * column_count > 120000 or len(cells) > 120000):
        return None
    rows = [[""] * column_count for _ in range(row_count)]
    boxes, spans, occupied = [], [], set()
    for source in cells:
        cell = dict(source)
        r, c, rs, cs = [cell.get(k, 1 if k.endswith("Span") else None)
                        for k in ("row", "column", "rowSpan", "columnSpan")]
        if (any(type(v) is not int for v in (r, c, rs, cs)) or min(r, c) < 0 or min(rs, cs) < 1
                or r + rs > row_count or c + cs > column_count):
            return None
        covered = {(y, x) for y in range(r, r + rs) for x in range(c, c + cs)}
        if occupied & covered:
            return None
        bbox = cell.get("bbox")
        if bbox is not None and (len(bbox) != 4 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in bbox)
                                 or bbox[2] <= bbox[0] or bbox[3] <= bbox[1]):
            return None
        text = str(cell.pop("text", ""))
        if len(text) > 2000:
            return None
        rows[r][c] = text
        cell.update(row=r, column=c, rowSpan=rs, columnSpan=cs)
        boxes.append(cell)
        if rs > 1 or cs > 1:
            spans.append([r, c, rs, cs])
        occupied.update(covered)
    if fill_empty:
        for r in range(row_count):
            for c in range(column_count):
                if (r, c) not in occupied:
                    boxes.append({"row": r, "column": c, "rowSpan": 1, "columnSpan": 1})
                    occupied.add((r, c))
    return {"rows": rows, "spans": sorted(spans), "cellBoxes": sorted(boxes, key=lambda b: (b["row"], b["column"])),
            "completeGrid": len(occupied) == row_count * column_count}


def otsl_table_grid(sequence):
    """Decode structure including empty cells, before any token matching.

    Continuations must form rectangles with one anchor; malformed sequences
    are rejected instead of changing row/column numbers to fit matched text.
    """
    if not isinstance(sequence, list) or not 0 < len(sequence) <= 124002:
        return None
    tokens = list(sequence)
    if tokens and tokens[0] == "<start>": tokens.pop(0)
    if tokens and tokens[-1] == "<end>": tokens.pop()
    matrix, row = [], []
    for token in tokens:
        if token == "nl":
            if not row or len(matrix) >= 2000 or (matrix and len(row) != len(matrix[0])): return None
            matrix.append(row)
            row = []
        else:
            if token not in {"fcel", "ecel", "ched", "rhed", "srow", "lcel", "ucel", "xcel"} or len(row) >= 60: return None
            row.append(token)
    if row or not matrix: return None
    owners, anchors = {}, {}
    for r, row in enumerate(matrix):
        for c, token in enumerate(row):
            if token in {"fcel", "ecel", "ched", "rhed", "srow"}:
                owner = (r, c)
                anchors[owner] = {"row": r, "column": c, "rowSpan": 1, "columnSpan": 1}
            else:
                left, above = owners.get((r, c-1)), owners.get((r-1, c))
                owner = left if token == "lcel" else above
                if owner is None or (token == "xcel" and left != above): return None
                anchor = anchors[owner]
                if token == "lcel" and r != anchor["row"]: return None
                if token == "ucel" and c != anchor["column"]: return None
                anchor["rowSpan"] = max(anchor["rowSpan"], r-anchor["row"]+1)
                anchor["columnSpan"] = max(anchor["columnSpan"], c-anchor["column"]+1)
            owners[(r, c)] = owner
    result = table_grid(len(matrix), len(matrix[0]), list(anchors.values()))
    return result if result and result["completeGrid"] else None


def _box(item):
    return [float(item[k]) for k in ("x0", "top", "x1", "bottom")]


def _union(items):
    return [min(i["x0"] for i in items), min(i["top"] for i in items),
            max(i["x1"] for i in items), max(i["bottom"] for i in items)]


def _lines(words):
    lines = []
    for word in sorted(words, key=lambda w: (w["top"], w["x0"])):
        middle = (word["top"] + word["bottom"]) / 2
        line = next((line for line in reversed(lines[-4:])
                     if abs(line["middle"] - middle) <= max(2, (word["bottom"]-word["top"]) * .3)), None)
        if line is None:
            line = {"middle": middle, "words": []}
            lines.append(line)
        line["words"].append(word)
    return sorted(lines, key=lambda line: line["middle"])


def _runs(words, height):
    groups = []
    for word in sorted(words, key=lambda w: w["x0"]):
        if not groups or word["x0"] - groups[-1][-1]["x1"] > max(10, height * 1.3): groups.append([])
        groups[-1].append(word)
    return [{"text": " ".join(w["text"] for w in group), "words": group,
             **dict(zip(("x0", "top", "x1", "bottom"), _union(group)))} for group in groups]


_NUMBER = re.compile(r"^(?:[$\u00a3\u00a5\u20ac+\-\u2212]?\d+(?:,\d{3})*(?:\.\d+)?(?:[eE][+\-]?\d+)?(?:\s?[%\u2030])?|\(\d+(?:,\d{3})*(?:\.\d+)?\))$")


def _data_row(runs):
    return (3 <= len(runs) <= 12 and any(c.isalpha() for c in runs[0]["text"])
            and len(runs[0]["text"]) <= 60
            and not re.search(r"[=+*/^<>]", runs[0]["text"])
            and all(_NUMBER.fullmatch(item["text"].strip()) for item in runs[1:]))


def assign_table_words(grid, words):
    """Assign every word exactly once without changing the grid's topology."""
    groups = [[] for _ in grid["cellBoxes"]]
    word_indices={id(word):index for index,word in enumerate(words)}
    # Sweep down the page: only vertically intersecting cells can own a word.
    # A large table must not compare every word with every cell.
    ordered = sorted(((i, c["bbox"]) for i, c in enumerate(grid["cellBoxes"]) if c.get("bbox")), key=lambda pair: pair[1][1])
    active, position = {}, 0
    for word in sorted(words, key=lambda w: w["top"]):
        box = _box(word)
        while position < len(ordered) and ordered[position][1][1] <= box[3]:
            index, target = ordered[position]
            active[index] = target
            position += 1
        active = {i: b for i, b in active.items() if b[3] >= box[1]}
        area = max(.01, (box[2]-box[0]) * (box[3]-box[1]))
        matches = []
        for index, target in active.items():
            overlap = max(0, min(box[2], target[2])-max(box[0], target[0])) * max(0, min(box[3], target[3])-max(box[1], target[1]))
            if overlap / area >= .85: matches.append(index)
        if len(matches) != 1: return False
        groups[matches[0]].append(word)
    texts = []
    for assigned in groups:
        text = "\n".join(" ".join(w["text"] for w in sorted(line["words"], key=lambda w: w["x0"])) for line in _lines(assigned))
        if len(text) > 2000: return False
        texts.append(text)
    for cell, text in zip(grid["cellBoxes"], texts):
        grid["rows"][cell["row"]][cell["column"]] = text
    grid['wordAssignments']=[{'word':word.get('id',word_indices[id(word)]),'row':grid['cellBoxes'][cell_index]['row'],
                             'column':grid['cellBoxes'][cell_index]['column']} for cell_index,group in enumerate(groups)
                            for index,word in enumerate(group)]
    grid['unmatchedWords']=[]
    return True


def scanned_table_grid(image, source_words):
    """Read ruled topology from pixels before assigning OCR words. No model dependency."""
    gray=image.convert('L')
    ratio=min(1,1200/max(gray.size))
    if ratio<1:
        scaled=gray.resize((round(gray.width*ratio),round(gray.height*ratio)))
        gray.close()
        gray=scaled
    pixels=gray.load()
    width,height=gray.size
    def groups(values):
        runs=[]
        for value in values:
            if not runs or value>runs[-1][-1]+2: runs.append([])
            runs[-1].append(value)
        return [round(statistics.mean(run)) for run in runs]
    ys=groups([y for y in range(height) if sum(pixels[x,y]<150 for x in range(width))>width*.35])
    xs=groups([x for x in range(width) if ys and sum(pixels[x,y]<150 for y in range(ys[0],ys[-1]+1))>max(1,ys[-1]-ys[0])*.5])
    if 3<=len(xs)<=31 and ys:
        # A merged header can have a rule across only some columns. Discover
        # those local rules after the vertical grid, using continuous coverage.
        local=[]
        for y in range(ys[0],ys[-1]+1):
            covered=sum(b-a for a,b in zip(xs,xs[1:])
                        if sum(pixels[x,y]<150 for x in range(a+2,b-1))>max(1,b-a-3)*.9)
            if covered>=(xs[-1]-xs[0])*.25: local.append(y)
        ys=groups(local)
    try:
        if not 3<=len(xs)<=31 or not 3<=len(ys)<=101 or (len(xs)-1)*(len(ys)-1)>1500: return None
        if min(b-a for a,b in zip(xs,xs[1:]))<8 or min(b-a for a,b in zip(ys,ys[1:]))<8: return None
        def vertical(x,top,bottom):
            return sum(any(pixels[min(width-1,max(0,x+dx)),y]<150 for dx in (-1,0,1))
                       for y in range(top+2,bottom-1))/max(1,bottom-top-3)>.8
        def horizontal(y,left,right):
            return sum(any(pixels[x,min(height-1,max(0,y+dy))]<150 for dy in (-1,0,1))
                       for x in range(left+2,right-1))/max(1,right-left-3)>.8
        if not all(vertical(x,ys[0],ys[-1]) for x in (xs[0],xs[-1])): return None
        if not all(horizontal(y,xs[0],xs[-1]) for y in (ys[0],ys[-1])): return None
        rows,cols=len(ys)-1,len(xs)-1
        owners=list(range(rows*cols))
        def find(n):
            while owners[n]!=n:
                owners[n]=owners[owners[n]]
                n=owners[n]
            return n
        def join(a,b): owners[find(a)]=find(b)
        for r in range(rows):
            for c in range(cols):
                if c and not vertical(xs[c],ys[r],ys[r+1]): join(r*cols+c,r*cols+c-1)
                if r and not horizontal(ys[r],xs[c],xs[c+1]): join(r*cols+c,(r-1)*cols+c)
        cells={}
        for r in range(rows):
            for c in range(cols): cells.setdefault(find(r*cols+c),[]).append((r,c))
        anchors=[]
        for members in cells.values():
            r0,c0=min(r for r,c in members),min(c for r,c in members)
            r1,c1=max(r for r,c in members)+1,max(c for r,c in members)+1
            if len(members)!=(r1-r0)*(c1-c0): return None
            anchors.append({'row':r0,'column':c0,'rowSpan':r1-r0,'columnSpan':c1-c0,
                            'bbox':[xs[c0]/ratio,ys[r0]/ratio,xs[c1]/ratio,ys[r1]/ratio]})
        grid=table_grid(rows,cols,anchors)
        box=[xs[0]/ratio,ys[0]/ratio,xs[-1]/ratio,ys[-1]/ratio]
        if source_words is None:
            if grid: grid.update(type='table',bbox=box,rowCount=rows,columnCount=cols)
            return grid
        words=[{'id':i,'text':w['text'],**dict(zip(('x0','top','x1','bottom'),w['bbox']))}
               for i,w in enumerate(source_words) if box[0]<=(w['bbox'][0]+w['bbox'][2])/2<=box[2]
               and box[1]<=(w['bbox'][1]+w['bbox'][3])/2<=box[3]]
        if not grid or not words or not assign_table_words(grid,words): return None
        if sum(any(ch.isalpha() for ch in value) for value in grid['rows'][0])<2: return None
        grid.update(type='table',bbox=box,rowCount=rows,columnCount=cols,headerRowCount=1,
                    wordCount=len(words),assignedWordCount=len(words),detection='ocr_ruled_pixels',
                    confidence='medium',needsVisualFallback=False)
        return grid
    finally:
        gray.close()


def _candidate_grid(body, previous, height):
    reference = max(body, key=lambda line: len(line["runs"]))["runs"]
    count = len(reference)
    centers = [(r["x0"]+r["x1"])/2 for r in reference]
    groups = [[] for _ in centers]
    for line in body:
        seen = set()
        for run in line["runs"]:
            center = (run["x0"]+run["x1"])/2
            c = min(range(count), key=lambda i: abs(centers[i]-center))
            if c in seen: return None
            seen.add(c)
            groups[c].append(run)
    for group in groups:
        # Left-, right- and center-aligned fields are all legitimate.
        deviations = [max(values)-min(values) for values in
                      ([r["x0"] for r in group], [r["x1"] for r in group], [(r["x0"]+r["x1"])/2 for r in group])]
        if min(deviations) > max(3, height*.65): return None
    centers = [statistics.median((r["x0"]+r["x1"])/2 for r in group) for group in groups]
    lefts, rights = [min(r["x0"] for r in g) for g in groups], [max(r["x1"] for r in g) for g in groups]
    if any(lefts[i+1]-rights[i] < height*1.3 for i in range(count-1)): return None
    pitch = statistics.median(body[i+1]["middle"]-body[i]["middle"] for i in range(len(body)-1))
    headers = []
    for line in reversed(previous):
        if body[0]["middle"]-line["middle"] > pitch*3 or len(headers) > 3*count: break
        if any(len(r["text"]) > 80 or len(r["words"]) > 5 or re.search(r"[.!?;]$", r["text"]) for r in line["runs"]): break
        headers = line["runs"] + headers
    if not headers or sum(sum(ch.isalpha() for ch in h["text"]) >= 2 for h in headers) < max(2, count//2): return None
    all_items = headers + [r for line in body for r in line["runs"]]
    boundaries = [(rights[i]+lefts[i+1])/2 for i in range(count-1)]
    x_edges = [min(r["x0"] for r in all_items)-height*.5] + boundaries + [max(r["x1"] for r in all_items)+height*.5]
    for h in headers:
        center = (h["x0"]+h["x1"])/2
        crossed = [i for i, boundary in enumerate(boundaries) if h["x0"] < boundary < h["x1"]]
        if crossed:
            c0, end = min(crossed), max(crossed)+2
            if abs(center-(centers[c0]+centers[end-1])/2) > height: return None
        else:
            c0 = sum(center > edge for edge in boundaries)
            end = c0+1
        h["columns"] = (c0, end)
        h["middle"] = (h["top"]+h["bottom"])/2
        if h["x0"] < x_edges[c0] or h["x1"] > x_edges[end]: return None
    chains = [sorted([h for h in headers if h["columns"][0] <= c < h["columns"][1]], key=lambda h: h["middle"]) for c in range(count)]
    if any(not chain for chain in chains): return None
    depth = max(len(chain) for chain in chains)
    if depth > 3: return None
    if depth > 1 and not any(h["columns"][1]-h["columns"][0] > 1 for h in headers): return None
    levels = [statistics.median(chain[i]["middle"] for chain in chains if len(chain) == depth) for i in range(depth)]
    if any(levels[i+1]-levels[i] < height*.8 for i in range(depth-1)): return None
    y_centers = levels + [line["middle"] for line in body]
    y_edges = [min(h["top"] for h in headers)-height*.4] + [(a+b)/2 for a, b in zip(y_centers, y_centers[1:])] + [max(r["bottom"] for r in body[-1]["runs"])+height*.4]
    anchors = []
    for h in headers:
        c, end = h["columns"]
        choices = []
        for row in range(depth):
            for rs in range(1, depth-row+1):
                if rs > 1 and any(other is not h for chain in chains[c:end] for other in chain): continue
                delta = abs(h["middle"]-(levels[row]+levels[row+rs-1])/2)
                if delta <= max(2, height*.35): choices.append((delta, row, rs))
        if not choices: return None
        _, row, rs = min(choices)
        anchors.append({"row": row, "column": c, "rowSpan": rs, "columnSpan": end-c})
    for row in range(depth, depth+len(body)):
        anchors.extend({"row": row, "column": c} for c in range(count))
    grid = table_grid(depth+len(body), count, anchors, fill_empty=True)
    if not grid: return None
    for cell in grid["cellBoxes"]:
        r, c = cell["row"], cell["column"]
        cell["bbox"] = [x_edges[c], y_edges[r], x_edges[c+cell["columnSpan"]], y_edges[r+cell["rowSpan"]]]
    words = [w for item in all_items for w in item["words"]]
    if not assign_table_words(grid, words): return None
    grid.update(bbox=[x_edges[0], y_edges[0], x_edges[-1], y_edges[-1]], headerRowCount=depth,
                wordCount=len(words), assignedWordCount=len(words))
    return grid


def borderless_table_regions(page, page_number, protected=()):
    words = page.extract_words(x_tolerance=2, y_tolerance=3) or []
    if not words or len(words) > 12000: return []
    words = [w for w in words if str(w.get("text", "")).strip() and w.get("upright", True)]
    if not words: return []
    height = statistics.median(w["bottom"]-w["top"] for w in words)
    if height <= 0: return []
    lines = _lines(words)
    for line in lines: line["runs"] = _runs(line["words"], height)
    output, index = [], 0
    while index < len(lines):
        if not _data_row(lines[index]["runs"]): index += 1; continue
        start = index
        index += 1
        while index < len(lines) and _data_row(lines[index]["runs"]) and lines[index]["middle"]-lines[index-1]["middle"] <= height*4.5:
            index += 1
        if index-start < 3: continue
        grid = None
        for header_lines in range(1, min(4, start)+1):
            grid = _candidate_grid(lines[start:index], lines[start-header_lines:start], height)
            if grid: break
        if not grid: continue
        box = grid["bbox"]
        # Any intersection with established geometry prevents replacement or
        # boundary expansion over figures, native tables or mathematical grids.
        if any(min(box[2], b[2]) > max(box[0], b[0]) and min(box[3], b[3]) > max(box[1], b[1])
               for b in protected if b and len(b) == 4): continue
        # Include every source word in the proposed rectangle, not only the
        # aligned subset. An unassigned note or neighboring paragraph rejects it.
        inside = [w for w in words if box[0] <= (w["x0"]+w["x1"])/2 <= box[2] and box[1] <= (w["top"]+w["bottom"])/2 <= box[3]]
        if len(inside) != grid["wordCount"] or not assign_table_words(grid, inside): continue
        output.append({"type": "table", "page": page_number, **grid,
                       "rowCount": len(grid["rows"]), "columnCount": len(grid["rows"][0]),
                       "detection": "borderless_alignment", "confidence": "medium", "needsVisualFallback": False})
    return output + textual_table_regions(words, page_number, list(protected)+[r['bbox'] for r in output])


def textual_table_regions(words, page_number, protected=()):
    """Caption-anchored text/sparse/multiline grids. Uncaptioned prose stays prose.

    A real table caption supplies context; consistent column alignment and row
    spacing still have to establish a complete grid before words are assigned.
    """
    if not words: return []
    height=statistics.median(w['bottom']-w['top'] for w in words)
    if height<=0: return []
    lines=_lines(words)
    for line in lines: line['runs']=_runs(line['words'],height)
    output=[]
    for start in range(1,len(lines)-3):
        caption=' '.join(w['text'] for w in lines[start-1]['words'])
        if not re.match(r'^(?:Table|\u8868)\s*[A-Za-z]?\d+(?:[.：:\s]|$)',caption,re.I): continue
        headers=lines[start]['runs']
        if not 2<=len(headers)<=12 or lines[start]['middle']-lines[start-1]['middle']>height*5: continue
        if any(not any(ch.isalpha() for ch in r['text']) or len(r['text'])>60 or re.search(r'[=+*/^<>]',r['text']) for r in headers): continue
        anchors=[r['x0'] for r in headers]
        if min(b-a for a,b in zip(anchors,anchors[1:]))<height*4: continue
        logical=[]
        previous=lines[start]
        for line in lines[start+1:start+201]:
            if line['middle']-previous['middle']>height*5: break
            assigned={}
            valid=True
            for run in line['runs']:
                column=min(range(len(anchors)),key=lambda c:abs(anchors[c]-run['x0']))
                if abs(anchors[column]-run['x0'])>height*.65 or column in assigned or len(run['text'])>120 or re.search(r'[.!?;=^]$',run['text']):
                    valid=False;break
                if column+1<len(anchors) and run['x1']>anchors[column+1]-height: valid=False;break
                assigned[column]=run
            if not valid or not assigned: break
            continuation=logical and (0 not in assigned or (line['middle']-previous['middle']<height*1.4 and len(assigned)<len(headers)))
            if continuation:
                logical[-1].extend(line['runs'])
            elif 0 in assigned:
                logical.append(list(line['runs']))
            else: break
            previous=line
        if len(logical)<3: continue
        if sum(len({min(range(len(anchors)),key=lambda c:abs(anchors[c]-run['x0'])) for run in row})>=2 for row in logical)<3: continue
        row_items=[headers]+logical
        right=max(run['x1'] for row in row_items for run in row)
        xs=[anchors[0]-height*.4]+[x-height*.5 for x in anchors[1:]]+[right+height*.4]
        ys=[min(r['top'] for r in headers)-height*.4]
        for before,after in zip(row_items,row_items[1:]): ys.append((max(r['bottom'] for r in before)+min(r['top'] for r in after))/2)
        ys.append(max(r['bottom'] for r in row_items[-1])+height*.4)
        if any(b<=a for a,b in zip(ys,ys[1:])): continue
        box=[xs[0],ys[0],xs[-1],ys[-1]]
        if any(_intersects(box,b) for b in protected if b): continue
        cells=[{'row':r,'column':c,'bbox':[xs[c],ys[r],xs[c+1],ys[r+1]]} for r in range(len(row_items)) for c in range(len(headers))]
        grid=table_grid(len(row_items),len(headers),cells)
        selected=[w for row in row_items for run in row for w in run['words']]
        inside=[w for w in words if box[0]<=(w['x0']+w['x1'])/2<=box[2] and box[1]<=(w['top']+w['bottom'])/2<=box[3]]
        if len(inside)!=len(selected): continue
        if not grid or not assign_table_words(grid,selected): continue
        grid.update(type='table',page=page_number,bbox=box,rowCount=len(row_items),columnCount=len(headers),headerRowCount=1,
                    wordCount=len(selected),assignedWordCount=len(selected),detection='caption_text_alignment',confidence='medium',needsVisualFallback=False)
        output.append(grid)
    return output


def _intersects(a,b):
    return b and min(a[2],b[2])>max(a[0],b[0]) and min(a[3],b[3])>max(a[1],b[1])
