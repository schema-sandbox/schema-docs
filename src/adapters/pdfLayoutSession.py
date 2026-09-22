"""Durable per-page layout processing; one parser session, verified resume."""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import sys
import uuid


def peak_resident_bytes():
    if os.name == "nt":
        import ctypes as c
        class Counters(c.Structure):
            _fields_ = [("size", c.c_ulong), ("page_faults", c.c_ulong)] + [(name, c.c_size_t) for name in
                ("peak_working_set", "working_set", "peak_paged", "paged", "peak_nonpaged", "nonpaged", "pagefile", "peak_pagefile")]
        values = Counters()
        values.size = c.sizeof(values)
        get_process = c.windll.kernel32.GetCurrentProcess
        get_process.restype = c.c_void_p
        query = c.windll.psapi.GetProcessMemoryInfo
        query.argtypes = [c.c_void_p, c.c_void_p, c.c_ulong]
        return values.peak_working_set if query(get_process(), c.byref(values), values.size) else None
    import resource
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == "darwin" else 1024)


def file_hash(target):
    digest = hashlib.sha256()
    with Path(target).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def atomic_write(target, data):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f"{target.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("xb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def safe_child(root, name):
    if not isinstance(name, str) or not name or Path(name).name != name or name in {".", ".."}:
        raise ValueError("Unsafe page asset name")
    target = root / name
    if target.is_symlink() or target.resolve().parent != root.resolve():
        raise ValueError("Page asset escapes its cache")
    return target


def restore_page(target, identity, page_number, assets):
    try:
        if target.is_symlink():
            return None
        envelope = json.loads(target.read_text(encoding="utf-8"))
        payload = envelope["payload"]
        if envelope["identity"] != identity or payload["page"]["page"] != page_number:
            return None
        if hashlib.sha256(json_bytes(payload)).hexdigest() != envelope["sha256"]:
            return None
        # Both the page structure and every referenced image must still match.
        for name, expected in payload["assets"].items():
            if file_hash(safe_child(assets, name)) != expected:
                return None
        names = {r["assetFile"] for r in payload["page"]["regions"] if r.get("assetFile")}
        if names != set(payload["assets"]):
            return None
        return payload
    except (OSError, ValueError, KeyError, TypeError):
        return None


def preserve_unknown_glyphs(page, page_number, asset_dir, render):
    """Replace only a still-unmapped glyph, never its neighbouring prose."""
    regions = []
    # A few PDFs expose the same Symbol glyph several times at nearly identical
    # coordinates (for example a layered ``>=`` sign).  Treat those records as
    # one visual glyph.  Without this guard each duplicate receives a crop,
    # marker, and manifest entry, which can multiply badly on damaged pages.
    def duplicate_of(raw, font, box):
        for region, _ in regions:
            if region.get("text") != raw or region.get("fontname") != font:
                continue
            prior = region.get("bbox") or []
            if len(prior) != 4:
                continue
            left = max(float(prior[0]), float(box[0]))
            top = max(float(prior[1]), float(box[1]))
            right = min(float(prior[2]), float(box[2]))
            bottom = min(float(prior[3]), float(box[3]))
            if right <= left or bottom <= top:
                continue
            intersection = (right - left) * (bottom - top)
            area = max(1.0, (float(box[2]) - float(box[0])) * (float(box[3]) - float(box[1])))
            if intersection / area >= 0.82:
                return region
        return None

    for char in page.chars:
        raw = str(char.get("text", ""))
        if str(char.get("fontname", "")).startswith("SchemaDocs"):
            continue
        font = str(char.get("fontname", ""))
        # A known CID may decode to a Unicode math symbol while still being
        # spatially detached from its surrounding formula. Leaving that glyph
        # in the prose stream can turn ``lower`` into ``lo√wer`` or insert an
        # arrow/infinity sign into an ordinary word. Formula markers are
        # injected before this function, so symbols belonging to an accepted
        # formula have already been removed from ``page.chars``. Preserve an
        # unattached symbol as a small visual fallback instead of exposing a
        # misleading text-layer placement.
        detached_math_symbol = bool(
            re.search(r"(?:math|symbol|cmmi|cmsy|cmex|msam|msbm|sfbm|sfrm|hfbr|sfrb)", font, re.IGNORECASE)
            and raw in {"√", "≤", "≥", "→", "←", "↔", "∞", "≲", "≳", "∼", "∈", "∉", "×", "÷", "±", "≡"}
        )
        if not re.search(r"\(cid:\d+\)|[\ue000-\uf8ff\ufffd]", raw) and not detached_math_symbol:
            continue
        region = {"type": "formula", "kind": "unmapped_glyph", "page": page_number,
                  "bbox": [float(char[k]) for k in ("x0", "top", "x1", "bottom")],
                  "text": raw, "fontname": char.get("fontname", ""),
                  "needsVisualFallback": True, "editableMathCandidate": False}
        duplicate = duplicate_of(raw, region["fontname"], region["bbox"])
        if duplicate is not None:
            duplicate["sourceDuplicateCount"] = int(duplicate.get("sourceDuplicateCount", 1)) + 1
            # The first record owns the source crop and marker.  Blank this
            # duplicate so it cannot leak the symbol into the prose stream.
            char["text"] = ""
            char["fontname"] = "SchemaDocsDuplicateGlyph"
            continue
        regions.append((region, char))
    # Render all crops from a single page bitmap. Distinct glyphs at different
    # coordinates have different asset fingerprints even when their CID agrees.
    render(page, page_number, [r for r, _ in regions], asset_dir)
    for index, (region, char) in enumerate(regions, 1):
        if region.get("assetFile"):
            char["text"] = (f"<!-- pdf-formula: page={page_number} index={index} "
                            f"file={region['assetFile']} mode=inline -->")
            char["fontname"] = "SchemaDocsGlyphMarker"
            region["inlinePlaceholder"] = True
        # A render failure leaves the original marker visible and measurable.
    return [r for r, _ in regions]


def run_layout_session(args, extract_page):
    from pdfPageWindow import PdfPageWindow, PdfiumTextImagePage
    source = Path(args.source)
    initial_stat = source.stat()
    versions = {}
    for name in ("pdfplumber", "pdfminer.six", "pypdfium2", "Pillow"):
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = "unavailable"
    engine = {p.name: file_hash(p) for p in Path(__file__).parent.glob("pdf*.py")}
    identity = hashlib.sha256(json_bytes({"schema": 1, "source": file_hash(source),
        "engine": engine, "versions": versions, "render": bool(args.asset_dir), "dpi": 144})).hexdigest()
    cache = Path(args.cache_dir) / identity if args.cache_dir else None
    assets = cache / "assets" if cache and args.asset_dir else (Path(args.asset_dir) if args.asset_dir else None)
    destination = Path(args.asset_dir) if args.asset_dir else None
    if assets:
        assets.mkdir(parents=True, exist_ok=True)
    if destination:
        destination.mkdir(parents=True, exist_ok=True)
    # Stream the assembled Markdown while page artifacts are committed. A
    # book-length document should not keep a second full-text copy in Python
    # memory merely to concatenate page fragments at the end.
    markdown_path = Path(args.markdown_output)
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_stream = markdown_path.open("w", encoding="utf-8", newline="\n")
    markdown_stream.write(f"# {source.stem}\n\n")
    summary = {}
    pages_path = markdown_path.with_name(f"{markdown_path.name}.pages.jsonl")
    pages_stream = pages_path.open("w", encoding="utf-8", newline="\n")
    reused = 0
    with PdfPageWindow(source, window_size=max(1, int(getattr(args, "window_size", 16) or 16))) as document:
        total = document.page_count
        start = args.start_page - 1
        if start < 0 or start >= total or args.max_pages < 0:
            raise ValueError("Invalid PDF page window")
        end = min(start + args.max_pages, total) if args.max_pages else total
        for index in range(start, end):
            number = index + 1
            target = cache / f"page-{number:06d}.json" if cache else None
            payload = restore_page(target, identity, number, assets) if target else None
            was_reused = payload is not None
            if payload is None:
                page = document.get_page(index, end)
                try:
                    try:
                        payload = extract_page(page, number, assets)
                    except Exception as error:
                        # Preserve already committed pages and the complete
                        # source appearance of this page. A page-local failure
                        # must not replace the entire document with plain OCR.
                        page.close()
                        page = PdfiumTextImagePage(document.source[index], number, 20_001)
                        payload = extract_page(page, number, assets)
                        payload["page"]["backendFailure"] = {
                            "backend": "pdfplumber", "code": type(error).__name__,
                            "message": str(error), "recovery": "source_page_preserved"}
                        payload["summary"]["backendFailurePages"] = 1
                finally:
                    page.close()
                payload["assets"] = {r["assetFile"]: file_hash(safe_child(assets, r["assetFile"]))
                                     for r in payload["page"]["regions"] if r.get("assetFile")}
                # Failed crops must be retried; never certify them as complete.
                if target and not payload["page"].get("backendFailure") and not any(r.get("assetStatus") == "failed" for r in payload["page"]["regions"]):
                    atomic_write(target, json_bytes({"identity": identity, "payload": payload,
                        "sha256": hashlib.sha256(json_bytes(payload)).hexdigest()}))
                elif target:
                    target.unlink(missing_ok=True)
            else:
                reused += 1
            if assets and destination and assets.resolve() != destination.resolve():
                for name, expected in payload["assets"].items():
                    output = safe_child(destination, name)
                    if not output.is_file() or file_hash(output) != expected:
                        atomic_write(output, safe_child(assets, name).read_bytes())
            markdown_stream.write(str(payload["markdown"]).rstrip("\n"))
            markdown_stream.write("\n\n")
            # Keep page metadata on disk as JSONL while the document runs. The
            # final manifest is assembled from this stream so a scan-heavy
            # book does not retain every region and OCR coordinate in memory.
            pages_stream.write(json.dumps(payload["page"], ensure_ascii=False, separators=(",", ":")))
            pages_stream.write("\n")
            for name, value in payload["summary"].items():
                # Page summaries are additive, while timing evidence is a
                # structured map.  Flatten numeric timing leaves so the
                # streamed aggregate remains backward compatible with the
                # numeric summary contract.
                if isinstance(value, dict):
                    for metric, metric_value in value.items():
                        if isinstance(metric_value, (int, float)):
                            key = f"{name}.{metric}"
                            summary[key] = summary.get(key, 0) + metric_value
                    continue
                if isinstance(value, (int, float)):
                    summary[name] = summary.get(name, 0) + value
            artifact = str(target.resolve()) if target and target.is_file() else ""
            print(json.dumps({"event": "layout_page", "pageNumber": number, "pageCount": total,
                "reused": was_reused, "artifactPath": artifact,
                "contentHash": f"sha256:{file_hash(target)}" if artifact else "",
                "requiresOcr": bool(payload["page"].get("requiresOcr")),
                "qualityStatus": "ocr_required" if payload["page"].get("requiresOcr") else "native_text"}), flush=True)
            budget = int(getattr(args, 'max_worker_resident_bytes', 0) or 0)
            if budget and (peak_resident_bytes() or 0) > budget * .75 and document.window_size > 1:
                # Reduce future parser windows only after this page has been
                # atomically committed. Never skip physical pages under pressure.
                document.window_size = max(1, document.window_size // 2)
                if document.document:
                    document.document.close()
                    document.document = None
                document.window_start = document.window_end = -1
        markdown_stream.flush()
        os.fsync(markdown_stream.fileno())
        markdown_stream.close()
        pages_stream.flush()
        os.fsync(pages_stream.fileno())
        pages_stream.close()
        final_stat = source.stat()
        if (initial_stat.st_size, initial_stat.st_mtime_ns) != (final_stat.st_size, final_stat.st_mtime_ns):
            raise ValueError("PDF source changed during conversion")
        manifest_meta = {"schema": "schema-docs.pdf-visual-map.v2", "sourceFile": source.name,
            "pageCount": total, "pageRange": {"start": start + 1, "end": end},
            "pagesAnalyzed": end - start, "summary": summary,
            "resources": {"peakResidentBytes": peak_resident_bytes(), "pageWindowSize": document.window_size},
            "cache": {"identity": identity, "reusedPages": reused, "processedPages": end - start - reused}}
    atomic_write(str(args.manifest_output) + '.meta.json', json_bytes(manifest_meta))
    # Insert the streamed page array as the final JSON property and publish it
    # atomically. The temporary JSONL file is private to this worker and is
    # removed with its surrounding extraction temp directory by the caller.
    metadata_text = json.dumps(manifest_meta, ensure_ascii=False, separators=(",", ":"))
    temporary_manifest = Path(args.manifest_output).with_name(f"{Path(args.manifest_output).name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary_manifest.open("w", encoding="utf-8", newline="\n") as output:
            output.write(metadata_text[:-1])
            output.write(',"pages":[')
            first = True
            with pages_path.open("r", encoding="utf-8") as page_lines:
                for line in page_lines:
                    line = line.strip()
                    if not line:
                        continue
                    if not first:
                        output.write(",")
                    output.write(line)
                    first = False
            output.write("]}")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_manifest, args.manifest_output)
    finally:
        temporary_manifest.unlink(missing_ok=True)
    print(json.dumps({"ok": True, **summary, "pageCount": total}), flush=True)
