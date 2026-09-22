"""Bounded PDFium/Tesseract OCR session. No per-page child processes."""
import csv
import ctypes as c
import hashlib
import io
import json
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile
from contextlib import nullcontext

from pdfLayoutSession import atomic_write, file_hash, json_bytes


TERMINAL_REGION_STATUSES = {"completed", "non_text", "visual_only"}


class OcrEngine:
    def __init__(self, library, tessdata, languages, psm=3):
        self.dll_directory = os.add_dll_directory(str(Path(library).resolve().parent)) if os.name == "nt" else None
        self.lib = c.CDLL(str(library))
        signatures = {
            "TessVersion": (c.c_char_p, []),
            "TessBaseAPICreate": (c.c_void_p, []),
            "TessBaseAPIInit3": (c.c_int, [c.c_void_p, c.c_char_p, c.c_char_p]),
            "TessBaseAPISetPageSegMode": (None, [c.c_void_p, c.c_int]),
            "TessBaseAPISetVariable": (c.c_int, [c.c_void_p, c.c_char_p, c.c_char_p]),
            "TessBaseAPISetImage": (None, [c.c_void_p, c.c_void_p, c.c_int, c.c_int, c.c_int, c.c_int]),
            "TessBaseAPISetSourceResolution": (None, [c.c_void_p, c.c_int]),
            "TessBaseAPIRecognize": (c.c_int, [c.c_void_p, c.c_void_p]),
            "TessBaseAPIGetUTF8Text": (c.c_void_p, [c.c_void_p]),
            "TessBaseAPIGetTsvText": (c.c_void_p, [c.c_void_p, c.c_int]),
            "TessDeleteText": (None, [c.c_void_p]),
            "TessBaseAPIClear": (None, [c.c_void_p]),
            "TessBaseAPIDelete": (None, [c.c_void_p]),
        }
        for name, (result, args) in signatures.items():
            function = getattr(self.lib, name)
            function.restype, function.argtypes = result, args
        self.psm = psm
        self.api = self.lib.TessBaseAPICreate()
        if self.lib.TessBaseAPIInit3(self.api, os.fsencode(tessdata), languages.encode()) != 0:
            self.close()
            raise RuntimeError("Tesseract could not initialize the requested languages")
        self.lib.TessBaseAPISetPageSegMode(self.api, psm)
        self.lib.TessBaseAPISetVariable(self.api, b"debug_file", os.fsencode(os.devnull))

    def text(self, function, *args):
        pointer = function(self.api, *args)
        if not pointer:
            return ""
        try:
            return c.string_at(pointer).decode("utf-8")
        finally:
            self.lib.TessDeleteText(pointer)

    def recognize(self, image, dpi, page_number, scale):
        image = image.convert("RGB")
        data = image.tobytes()
        try:
            self.lib.TessBaseAPISetImage(self.api, data, image.width, image.height, 3, image.width * 3)
            self.lib.TessBaseAPISetSourceResolution(self.api, round(dpi))
            if self.lib.TessBaseAPIRecognize(self.api, None) != 0:
                raise RuntimeError("Tesseract recognition failed")
            text = self.text(self.lib.TessBaseAPIGetUTF8Text).strip()
            tsv = self.text(self.lib.TessBaseAPIGetTsvText, page_number - 1)
            if not tsv.startswith("level\t"):
                tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n" + tsv
            words = []
            for row in csv.DictReader(io.StringIO(tsv), delimiter="\t", quoting=csv.QUOTE_NONE):
                if row.get("level") != "5" or not row.get("text", "").strip():
                    continue
                left, top, width, height = [float(row[key]) / scale for key in ("left", "top", "width", "height")]
                words.append({"text": row["text"], "bbox": [left, top, left + width, top + height],
                              "confidence": float(row["conf"]) / 100,
                              "line": [int(row[key]) for key in ("block_num", "par_num", "line_num")]})
            return text, words
        finally:
            self.lib.TessBaseAPIClear(self.api)
            image.close()

    def close(self):
        if getattr(self, "api", None):
            self.lib.TessBaseAPIDelete(self.api)
            self.api = None
        if self.dll_directory:
            self.dll_directory.close()


def process_page(document, engine, config, cache, identity, number, total, dpi, max_pixels):
    from pdfRegionOcr import recognize_page
    settings = config.get('pageRegions', {}).get(str(number), {})
    region_identity = hashlib.sha256(json_bytes(settings)).hexdigest()
    target = cache / f'page-{number:06d}.json'
    cached = {}
    try:
        entry = json.loads(target.read_text(encoding='utf-8'))
        if (not target.is_symlink() and entry['identity'] == identity and
                entry.get('regionIdentity') == region_identity and entry['page']['page'] == number and
                entry['sha256'] == hashlib.sha256(json_bytes(entry['page'])).hexdigest()):
            cached = {str(r['id']): r for r in entry['page'].get('regions', [])}
    except (OSError, ValueError, KeyError, TypeError):
        pass
    page = document[number - 1]
    try:
        width, height = page.get_size()
        origin = settings.get('coordinateOrigin', [0, 0])
        requests = settings.get('regions')
        if requests is None:
            requests = [{'id': 'ocr-page', 'bbox': [origin[0], origin[1], origin[0]+width, origin[1]+height]}]
        if len({str(r['id']) for r in requests}) != len(requests):
            raise ValueError('Duplicate OCR region ids')
        folder = cache / f'page-{number:06d}-regions'
        folder.mkdir(exist_ok=True)
        paths = {}
        for region in requests:
            key = hashlib.sha256(json_bytes(region)).hexdigest()
            path = folder / f'{key}.json'
            paths[str(region['id'])] = path
            try:
                entry = json.loads(path.read_text(encoding='utf-8'))
                value = entry['region']
                if (not path.is_symlink() and entry['identity'] == identity and
                        entry['regionIdentity'] == region_identity and str(value['id']) == str(region['id']) and
                        entry['sha256'] == hashlib.sha256(json_bytes(value)).hexdigest()):
                    cached[str(region['id'])] = value
            except (OSError, ValueError, KeyError, TypeError):
                pass
        def reuse(region):
            if region.get('status') in TERMINAL_REGION_STATUSES:
                return True
            if region.get('status') == 'unresolved' and not config.get('retryUnresolved'):
                return region.get('retryPolicyVersion') == 2
            return int(region.get('attemptCount', 0)) >= max(1, int(config.get('maxRegionAttempts', 2)))
        reused_regions = sum(str(r['id']) in cached and reuse(cached[str(r['id'])]) for r in requests)
        def commit(region, processed, requested):
            atomic_write(paths[str(region['id'])], json_bytes({'identity': identity,
                'regionIdentity': region_identity, 'region': region,
                'sha256': hashlib.sha256(json_bytes(region)).hexdigest()}))
            print(json.dumps({'event': 'ocr_region', 'pageNumber': number, 'pageCount': total,
                'regionId': region['id'], 'regionsProcessed': processed, 'regionsRequested': requested,
                'status': region['status']}), flush=True)
        settings = {**settings, 'regions': requests}
        effective = {**config, 'pageRegions': {str(number): settings}, '_cachedRegions': cached,
                     '_reuseRegion': reuse, '_onRegion': commit}
        scale = min(dpi / 72, math.sqrt(max_pixels / (width * height)))
        while math.ceil(width * scale) * math.ceil(height * scale) > max_pixels:
            scale *= .999
        bitmap = image = None
        try:
            if reused_regions < len(requests):
                bitmap = page.render(scale=scale)
                image = bitmap.to_pil()
            payload = recognize_page(engine, image, number, scale, effective, width, height)
        finally:
            if image is not None: image.close()
            if bitmap is not None: bitmap.close()
        atomic_write(target, json_bytes({'identity': identity, 'regionIdentity': region_identity,
            'page': payload, 'sha256': hashlib.sha256(json_bytes(payload)).hexdigest()}))
        return payload, reused_regions, reused_regions == len(requests), str(target)
    finally:
        page.close()


def run(config):
    import pypdfium2 as pdfium
    languages = config.get("languages", "chi_sim+eng")
    tessdata = Path(config["tessdataDir"])
    for language in languages.split("+"):
        if not language.replace("_", "").isalnum() or not (tessdata / f"{language}.traineddata").is_file():
            raise ValueError(f"Missing OCR language: {language}")
    engine = OcrEngine(config["library"], tessdata, languages, config.get("psm", 3))
    temporary_cache_root = None
    completed = False
    try:
        if config.get("probe"):
            return {"version": engine.lib.TessVersion().decode(), "pdfiumVersion": str(pdfium.PYPDFIUM_INFO),
                    "languages": sorted(p.stem for p in tessdata.glob("*.traineddata"))}
        source = Path(config["source"])
        dpi = float(config.get("dpi", 220))
        max_pixels = int(config.get("maxPixels", 16_000_000))
        if not math.isfinite(dpi) or not 120 <= dpi <= 400 or not 1_000_000 <= max_pixels <= 40_000_000:
            raise ValueError("Invalid OCR render budget")
        identity = hashlib.sha256(json_bytes({"source": file_hash(source), "worker": file_hash(__file__),
            "regionWorker": file_hash(Path(__file__).with_name('pdfRegionOcr.py')),
            "tableWorker": file_hash(Path(__file__).with_name('pdfTableStructure.py')),
            "library": file_hash(config["library"]), "pdfium": str(pdfium.PYPDFIUM_INFO),
            "languages": {lang: file_hash(tessdata / f"{lang}.traineddata") for lang in languages.split("+")},
            "dpi": dpi, "maxPixels": max_pixels, "psm": config.get("psm", 3),
            "regionPolicy": 2, "transformVersion": 1})).hexdigest()
        temporary_cache_root = None
        if config.get("cacheDir"):
            cache = Path(config["cacheDir"]) / identity
        else:
            # Never put an OCR ledger beside the source PDF.  Source folders
            # are treated as read-only and a crashed run must not leave cache
            # files that are mistaken for user documents.
            temporary_cache_root = Path(tempfile.mkdtemp(prefix="schema-docs-ocr-cache-"))
            cache = temporary_cache_root / identity
        cache.mkdir(parents=True, exist_ok=True)
        failed, reused, reused_regions, resumed_pages, pages_processed, extracted_characters = [], 0, 0, 0, 0, 0
        # Keep OCR payloads on disk while the document is being processed.
        # Returning a list of every page here made long books retain all word
        # boxes and text in Python memory until the final JSON was written.
        page_stream = cache / "pages.jsonl"
        page_stream.parent.mkdir(parents=True, exist_ok=True)
        try:
            page_stream.unlink()
        except FileNotFoundError:
            pass
        with pdfium.PdfDocument(source) as document:
            total = len(document)
            start = int(config.get("startPage", 1))
            end = min(total, start + int(config["maxPages"]) - 1) if config.get("maxPages") else total
            numbers = config.get("pageNumbers") or list(range(start, end + 1))
            if not numbers or any(type(n) is not int or not 1 <= n <= total for n in numbers) or len(set(numbers)) != len(numbers):
                raise ValueError("Invalid OCR page window")
            with page_stream.open("ab") as stream:
              for number in numbers:
                try:
                    monitor=config.get('_resourceMonitor')
                    with monitor.deadline('page',config.get('pageTimeoutMs')) if monitor else nullcontext():
                        payload, page_reused_regions, was_reused, artifact = process_page(
                            document, engine, config, cache, identity, number, total, dpi, max_pixels)
                except Exception as error:
                    payload = {"page": number, "text": "", "words": [], "regions": [],
                               "status": "failed", "error": str(error)}
                    page_reused_regions, was_reused, artifact = 0, False, ""
                if payload.get("status") == "failed" or any(r.get("status") == "failed" for r in payload.get("regions", [])):
                    failed.append({"page": number, "error": payload.get("error", "OCR region failure")})
                reused += int(was_reused)
                reused_regions += page_reused_regions
                resumed_pages += int(page_reused_regions > 0 and not was_reused)
                stream.write(json_bytes(payload) + b"\n")
                stream.flush()
                pages_processed += 1
                extracted_characters += len(payload.get("text", ""))
                print(json.dumps({"event": "layout_page", "pageNumber": number, "pageCount": total,
                    "pagesProcessed": pages_processed, "pagesRequested": len(numbers), "reused": was_reused,
                    "resumed": page_reused_regions > 0 and not was_reused, "reusedRegions": page_reused_regions,
                    "status": payload["status"], "artifactPath": artifact}), flush=True)
        completed = True
        return {"_pageStream": str(page_stream), "sourceStem": source.stem, "markdownLanguages": languages,
                "pageCount": total, "pagesProcessed": pages_processed,
                "pageRange": {"start": min(numbers), "end": max(numbers)}, "languages": languages, "dpi": dpi,
                "extractedCharacters": extracted_characters, "failedPages": failed,
                "resources": {"peakResidentBytes": __import__("pdfLayoutSession").peak_resident_bytes()},
                "cache": {"identity": identity, "reusedPages": reused, "reusedRegions": reused_regions,
                          "resumedPages": resumed_pages},
                "_temporaryCacheRoot": str(temporary_cache_root) if temporary_cache_root else ""}
    finally:
        engine.close()
        if temporary_cache_root and not completed:
            shutil.rmtree(temporary_cache_root, ignore_errors=True)


def write_streamed_result(result, page_stream, output):
    """Assemble the consumer JSON from a page JSONL ledger with bounded RAM."""
    temporary = output.with_name(output.name + ".tmp")
    base = dict(result)
    source_stem = base.pop("sourceStem", "document")
    languages = base.pop("markdownLanguages", base.get("languages", ""))
    prefix = json.dumps(base, ensure_ascii=False, separators=(",", ":"))
    if not prefix.endswith("}"):
        raise ValueError("Invalid OCR result envelope")
    with page_stream.open("rb") as stream, temporary.open("w", encoding="utf-8", newline="") as target:
        target.write(prefix[:-1])
        target.write(',"pages":[')
        first = True
        for raw in stream:
            line = raw.decode("utf-8").strip()
            if not line:
                continue
            if not first:
                target.write(",")
            target.write(line)
            first = False
        target.write('],"markdown":"')
        target.write(json.dumps(f"# {source_stem}\n\n", ensure_ascii=False)[1:-1])
        # Replay the JSONL ledger for Markdown too; only one page payload is
        # decoded at a time, so the worker remains bounded for long books.
        with page_stream.open("rb") as replay:
            for raw in replay:
                line = raw.decode("utf-8").strip()
                if not line:
                    continue
                page = json.loads(line)
                status = "ocr" if page.get("status") == "completed" else ("ocr_partial" if page.get("text") else "ocr_failed")
                fragment = f"<!-- pdf-page: {page.get('page')}; extraction: {status}; languages: {languages} -->\n\n"
                if status == "ocr":
                    fragment += page.get("text", "")
                elif status == "ocr_partial":
                    fragment += page.get("text", "") + "\n\n> OCR incomplete for some source regions; review the retained PDF images."
                else:
                    fragment += "> OCR failed for this source page. Review the retained PDF."
                fragment += "\n"
                target.write(json.dumps(fragment, ensure_ascii=False)[1:-1])
            target.write('"}')
    os.replace(temporary, output)


if __name__ == "__main__":
    config = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    from pdfResources import ResourceMonitor
    with ResourceMonitor([Path(sys.argv[1]).parent, config.get('cacheDir')],
                         config.get('maxWorkerResidentBytes'), config.get('maxTemporaryBytes')) as monitor:
        config['_resourceMonitor'] = monitor
        result = run(config)
    page_stream = Path(result.pop("_pageStream", ""))
    temporary_cache_root = Path(result.pop("_temporaryCacheRoot", "")) if result.get("_temporaryCacheRoot") else None
    output = Path(sys.argv[2])
    try:
        if page_stream.is_file() and config.get('streamOutput'):
            # The JS owner consumes this journal one page at a time. Avoid a
            # second all-pages JSON and duplicated book-length Markdown.
            atomic_write(output, json_bytes({**result, 'pageStream': str(page_stream)}))
        elif page_stream.is_file():
            write_streamed_result(result, page_stream, output)
        else:
            atomic_write(sys.argv[2], json_bytes(result))
    finally:
        if temporary_cache_root:
            shutil.rmtree(temporary_cache_root, ignore_errors=True)
