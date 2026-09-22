"""A single PDFium source session feeding bounded pdfplumber windows.

PDFium copies only referenced page objects to a temporary internal PDF. This
avoids pdfminer walking/decompressing the entire page tree before a short retry.
The source file is never rewritten; callers retain its physical page numbers.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import copy
import ctypes
import gc
import statistics
import pdfplumber
import pypdfium2 as pdfium


# Keep the window decision aligned with pdfLayoutExtractor's geometry budget.
# Returning a PDFium text/image facade before opening pdfplumber avoids the
# expensive lazy parse for pages that would otherwise spend seconds in
# pdfminer while retaining a complete source-page visual fallback.
TEXT_IMAGE_OBJECT_BUDGET = 4_000
TEXT_IMAGE_RASTER_BUDGET = 500


class _PdfiumRenderedImage:
    def __init__(self, page, resolution):
        self.scale = float(resolution) / 72.0
        self.bbox = (0.0, 0.0, float(page.get_size()[0]), float(page.get_size()[1]))
        bitmap = page.render(scale=self.scale, rev_byteorder=True)
        try:
            view = bitmap.to_pil()
            try:
                self.original = view.copy()
            finally:
                view.close()
        finally:
            bitmap.close()


class PdfiumTextImagePage:
    """Small page facade for pages whose vector stream is too large for pdfminer.

    PDFium already has a text extractor and a renderer.  Keeping this facade
    deliberately free of pdfminer layout objects prevents a pathological
    vector stream from being materialized just to recover its text.  The
    layout extractor supplies a full-page visual fallback for the omitted
    vector geometry.
    """

    def __init__(self, raw_page, page_number, object_count, raster_count=0, performance_fallback=False):
        self._raw_page = raw_page
        self._text_page = raw_page.get_textpage()
        self._pdfium_text = str(self._text_page.get_text_range() or "")
        self.page_number = page_number
        self.initial_doctop = 0.0
        self._schema_docs_pdfium_object_count = int(object_count)
        self._schema_docs_vector_primitive_count = int(object_count)
        self._schema_docs_text_image_page = True
        self._schema_docs_performance_fallback = bool(performance_fallback)
        self.width, self.height = [float(value) for value in raw_page.get_size()]
        self.bbox = (0.0, 0.0, self.width, self.height)
        self.rotation = raw_page.get_rotation()
        self.images = ([{"x0": 0.0, "top": 0.0, "x1": self.width, "bottom": self.height,
                         "source": "pdfium_visible_page", "name": "unresolved-raster-placements"}]
                       if raster_count else [])
        self.lines = []
        self.curves = []
        self.rects = []
        self._chars = self._extract_chars()
        self.objects = {"char": self._chars}

    def _extract_chars(self):
        chars = []
        count = int(self._text_page.count_chars())
        for index in range(count):
            text = str(self._text_page.get_text_range(index, 1) or "")
            if not text or text in {"\r", "\n"}:
                continue
            try:
                x0, y0, x1, y1 = [float(value) for value in self._text_page.get_charbox(index)]
            except Exception:
                continue
            if x1 < x0:
                x0, x1 = x1, x0
            if y1 < y0:
                y0, y1 = y1, y0
            # PDFium text boxes use PDF coordinates. Convert via the same
            # visible-page transform used by its renderer (crop and rotation).
            points = []
            for x in (x0, x1):
                for y in (y0, y1):
                    dx, dy = ctypes.c_int(), ctypes.c_int()
                    if not pdfium.raw.FPDF_PageToDevice(self._raw_page, 0, 0,
                            round(self.width * 1000), round(self.height * 1000), 0,
                            x, y, ctypes.byref(dx), ctypes.byref(dy)):
                        raise ValueError("PDFium could not map a character to the visible page")
                    points.append((dx.value / 1000, dy.value / 1000))
            x0, top = min(p[0] for p in points), min(p[1] for p in points)
            x1, bottom = max(p[0] for p in points), max(p[1] for p in points)
            height = max(0.0, bottom - top)
            width = max(0.0, x1 - x0)
            size = height or 1.0
            chars.append({
                "matrix": (size, 0.0, 0.0, size, x0, y0),
                "fontname": "PDFiumText",
                "adv": width,
                "upright": True,
                "x0": x0,
                "y0": y0,
                "x1": x1,
                "y1": y1,
                "width": width,
                "height": height,
                "size": size,
                "mcid": None,
                "tag": None,
                "object_type": "char",
                "page_number": self.page_number,
                "top": top,
                "bottom": bottom,
                "doctop": top,
                "text": text,
                "stroking_color": (0.0, 0.0, 0.0),
                "non_stroking_color": (0.0, 0.0, 0.0),
                "_pdfium_index": index,
            })
        # PDFium reports glyph ink height, which varies between capitals,
        # ascenders, and descenders even when they share one font run.  A
        # stable line size is required by pdfplumber's word grouper; without
        # it every glyph becomes a separate word and captions cannot be
        # recognized for the coarse visual fallback.
        lines = []
        for char in sorted(chars, key=lambda item: (item["top"], item["x0"])):
            line = next((candidate for candidate in reversed(lines[-3:])
                         if abs(candidate["top"] - char["top"]) <= 4.5), None)
            if line is None:
                line = {"top": char["top"], "chars": []}
                lines.append(line)
            line["chars"].append(char)
        for line in lines:
            heights = [char["height"] for char in line["chars"] if char["height"] > 0]
            line_size = statistics.median(heights) if heights else 1.0
            for char in line["chars"]:
                char["size"] = line_size
                char["matrix"] = (line_size, 0.0, 0.0, line_size, char["x0"], char["y0"])
        return chars

    @property
    def chars(self):
        return self._chars

    def extract_words(self, **kwargs):
        from pdfplumber.utils import extract_words
        return extract_words(self._chars, **kwargs)

    def extract_text(self, **kwargs):
        # The layout pipeline repairs and inserts characters in place. Always
        # serialize that representation, including synthetic markers; PDFium
        # character indices are not Python string indices.
        from pdfplumber.utils import extract_text
        return extract_text(self._chars, **kwargs).replace("\ufffe", "")

    def filter(self, test):
        filtered = copy.copy(self)
        filtered._chars = [char for char in self._chars if test(char)]
        filtered.objects = {"char": filtered._chars}
        return filtered

    def to_image(self, resolution=144, antialias=True):
        return _PdfiumRenderedImage(self._raw_page, resolution)

    def close(self):
        try:
            if self._text_page is not None:
                self._text_page.close()
        finally:
            self._text_page = None
            if self._raw_page is not None:
                self._raw_page.close()
                self._raw_page = None


class PdfPageWindow:
    def __init__(self, source, window_size=16):
        self.source_path = source
        self.source = pdfium.PdfDocument(source)
        self.page_count = len(self.source)
        self.window_size = window_size
        self.temporary = TemporaryDirectory(prefix="schema-docs-page-window-")
        self.window_path = Path(self.temporary.name) / "window.pdf"
        self.document = None
        self._pathological_page = None
        self.window_start, self.window_end = -1, -1
        self._window_has_heavy_pages = False
        self._single_page_window = False

    def get_page(self, index, stop):
        same_window = self.window_start <= index < self.window_end
        had_previous_pathological_page = self._pathological_page is not None
        # A mixed window is materialized as a one-page PDF when the requested
        # page is ordinary but another page in the window is pathological.
        # That one-page document must never be reused for the next physical
        # page: doing so silently emitted page N's text under page N+1's
        # marker.  Close it before every subsequent request in the same
        # mixed window so the requested source index is copied afresh.
        if same_window and self._single_page_window and self.document:
            self.document.close()
            self.document = None
        if self._pathological_page:
            self._pathological_page.close()
            self._pathological_page = None
        if had_previous_pathological_page and same_window:
            # A window can contain several dense pages. PDFium retains parsed
            # page objects on the source document even after the previous
            # lightweight page closes; reopen between heavy pages so a
            # 4-page window does not become slower than four isolated pages.
            self.source.close()
            gc.collect()
            self.source = pdfium.PdfDocument(self.source_path)
        object_counts = getattr(self, "_window_object_counts", [])
        if not self.window_start <= index < self.window_end:
            if self.document:
                self.document.close()
                self.document = None
            if self._pathological_page:
                self._pathological_page.close()
                self._pathological_page = None
            if self.window_start >= 0:
                # PDFium keeps parsed source objects alive with the source
                # document, even after individual pages and copied windows
                # close. Reopen only between committed windows so a long,
                # image-heavy book cannot retain the entire parsed PDF graph.
                self.source.close()
                gc.collect()
                self.source = pdfium.PdfDocument(self.source_path)
            end = min(index + self.window_size, stop)
            window = pdfium.PdfDocument.new()
            object_counts = []
            raster_counts = []
            try:
                window.import_pages(self.source, list(range(index, end)))
                # PDFium can count page objects without constructing the
                # heavyweight pdfminer layout.  This preflight lets the
                # extractor select a text/image-only layout for pathological
                # vector pages before pdfplumber allocates tens of thousands
                # of paths.
                for raw_index in range(end - index):
                    raw_page = window[raw_index]
                    try:
                        total = raster = 0
                        for obj in raw_page.get_objects():
                            total += 1
                            raster += int(obj.type == pdfium.raw.FPDF_PAGEOBJ_IMAGE)
                        object_counts.append(total)
                        raster_counts.append(raster)
                    finally:
                        raw_page.close()
                window.save(self.window_path)
            finally:
                window.close()
            self.window_start, self.window_end = index, end
            self._window_object_counts = object_counts
            self._window_raster_counts = raster_counts
            self._window_has_heavy_pages = any(
                count > TEXT_IMAGE_OBJECT_BUDGET or raster > TEXT_IMAGE_RASTER_BUDGET
                for count, raster in zip(object_counts, raster_counts)
            )
            self._single_page_window = False
        offset = index - self.window_start
        raster_count = self._window_raster_counts[offset] if 0 <= offset < len(self._window_raster_counts) else 0
        use_text_image = (
            0 <= offset < len(object_counts)
            and (object_counts[offset] > TEXT_IMAGE_OBJECT_BUDGET or raster_count > TEXT_IMAGE_RASTER_BUDGET)
        )
        if use_text_image:
            if self.document:
                self.document.close()
                self.document = None
            raw_page = self.source[index]
            try:
                self._pathological_page = PdfiumTextImagePage(raw_page, index + 1,
                    object_counts[offset], raster_count,
                    performance_fallback=(object_counts[offset] <= TEXT_IMAGE_OBJECT_BUDGET
                                          and raster_count > TEXT_IMAGE_RASTER_BUDGET))
            except BaseException:
                raw_page.close()
                raise
            return self._pathological_page
        if self.document is None:
            if self._window_has_heavy_pages:
                # Opening the multi-page copy would make pdfplumber walk the
                # dense pages before reaching this ordinary page. Copy only
                # the requested page when a mixed window crosses the backend
                # boundary; this preserves the window size for normal runs
                # without importing heavy geometry into the parser. When the
                # previous request also used a one-page copy, the guard at
                # the top of this method closed that parser; create the new
                # one-page copy for this requested index as well.
                single_page = pdfium.PdfDocument.new()
                try:
                    single_page.import_pages(self.source, [index])
                    single_page.save(self.window_path)
                finally:
                    single_page.close()
                self._single_page_window = True
            self.document = pdfplumber.open(self.window_path)
        page_index = 0 if self._single_page_window else index - self.window_start
        page = self.document.pages[page_index]
        if 0 <= offset < len(object_counts) and object_counts[offset] > 0:
            setattr(page, "_schema_docs_pdfium_object_count", object_counts[offset])
        return page

    def __enter__(self):
        return self

    def __exit__(self, *_):
        try:
            if self.document:
                self.document.close()
            if self._pathological_page:
                self._pathological_page.close()
        finally:
            self.source.close()
            self.temporary.cleanup()
