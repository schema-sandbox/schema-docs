"""Render supported DrawingML geometry with the existing private PDFium engine.

No Office process, network resource or document-supplied code is executed.
Unsupported geometry/fonts fail the whole drawing, rather than dropping shapes.
"""
import ctypes as C
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as E

import pypdfium2 as pdfium
import pypdfium2.raw as raw

NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main",
      "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"}
EMU = 12700
IDENTITY = (1, 0, 0, 1, 0, 0)


def local(node):
    return node.tag.split("}")[-1]


def child(node, name):
    return next((n for n in node if local(n) == name), None) if node is not None else None


def number(node, key, default=0):
    value = node.get(key, str(default)) if node is not None else str(default)
    if not re.fullmatch(r"-?\d+(?:\.\d+)?", value):
        raise ValueError("geometry_guide_not_supported")
    value = float(value)
    if not math.isfinite(value) or abs(value) > 1e10:
        raise ValueError("drawing_coordinate_limit")
    return value


def mul(left, right):
    a, b, c, d, e, f = left
    g, h, i, j, k, l = right
    return (a*g+c*h, b*g+d*h, a*i+c*j, b*i+d*j, a*k+c*l+e, b*k+d*l+f)


def translate(x, y):
    return (1, 0, 0, 1, x, y)


def transform(xfrm, group=False):
    off, ext = child(xfrm, "off"), child(xfrm, "ext")
    x, y, w, h = number(off, "x"), number(off, "y"), number(ext, "cx"), number(ext, "cy")
    result = translate(x, y)
    if xfrm is not None:
        angle = math.radians(number(xfrm, "rot") / 60000)
        cosine, sine = math.cos(angle), math.sin(angle)
        flip_x = -1 if xfrm.get("flipH") in ("1", "true") else 1
        flip_y = -1 if xfrm.get("flipV") in ("1", "true") else 1
        result = mul(result, mul(translate(w/2, h/2), mul(
            (cosine*flip_x, sine*flip_x, -sine*flip_y, cosine*flip_y, 0, 0), translate(-w/2, -h/2))))
    if group:
        origin, extent = child(xfrm, "chOff"), child(xfrm, "chExt")
        cw, ch = number(extent, "cx", w), number(extent, "cy", h)
        if not cw or not ch:
            raise ValueError("zero_group_extent")
        result = mul(result, mul((w/cw, 0, 0, h/ch, 0, 0), translate(-number(origin, "x"), -number(origin, "y"))))
    return result, w, h


def color(node, default=(0, 0, 0, 255)):
    if node is None:
        return default
    if child(node, "noFill") is not None:
        return (0, 0, 0, 0)
    solid = child(node, "solidFill")
    target = solid if solid is not None else node
    rgb = child(target, "srgbClr")
    if rgb is None:
        if any(local(n) in ("schemeClr", "sysClr", "gradFill", "pattFill", "blipFill") for n in target):
            raise ValueError("drawing_color_not_supported")
        return default
    value = rgb.get("val", "")
    if not re.fullmatch(r"[0-9a-fA-F]{6}", value):
        raise ValueError("invalid_drawing_color")
    if any(local(n) != "alpha" for n in rgb):
        raise ValueError("drawing_color_transform_not_supported")
    alpha = min(255, max(0, round(number(child(rgb, "alpha"), "val", 100000) * 255 / 100000)))
    return (*[int(value[i:i+2], 16) for i in (0, 2, 4)], alpha)


class Renderer:
    def __init__(self):
        self.pdf = pdfium.PdfDocument.new()
        self.fonts = {}

    def close(self):
        for font, _ in self.fonts.values():
            raw.FPDFFont_Close(font)
        self.pdf.close()

    def font(self, family, italic=False, bold=False):
        # Only trusted system font paths. No document-provided path is opened.
        suffix = "bi" if bold and italic else "bd" if bold else "i" if italic else ""
        families = {"times new roman": f"times{suffix}.ttf", "arial": f"arial{suffix}.ttf",
                    "calibri": f"calibri{suffix}.ttf", "segoe ui symbol": "seguisym.ttf",
                    "simsun": "simsun.ttc", "\u5b8b\u4f53": "simsun.ttc"}
        filename = families.get(family.lower())
        if filename == "simsun.ttc" and (italic or bold):
            raise ValueError("drawing_font_style_not_available")
        if not filename or os.name != "nt":
            raise ValueError("drawing_font_not_available")
        if filename not in self.fonts:
            data = (Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / filename).read_bytes()
            buffer = (C.c_ubyte * len(data)).from_buffer_copy(data)
            font = raw.FPDFText_LoadFont(self.pdf, buffer, len(data), raw.FPDF_FONT_TRUETYPE, True)
            if not font:
                raise ValueError("drawing_font_load_failed")
            self.fonts[filename] = font, buffer
        return self.fonts[filename][0]

    def insert(self, page, obj, matrix):
        if not obj:
            raise ValueError("drawing_object_creation_failed")
        raw.FPDFPageObj_Transform(obj, *matrix)
        page.insert_obj(pdfium.PdfObject(obj))

    def path(self, page, commands, matrix, fill, stroke, width, cap="flat", join="miter"):
        obj = raw.FPDFPageObj_CreateNewPath(0, 0)
        if not obj:
            raise ValueError("drawing_path_creation_failed")
        try:
            for command, coords in commands:
                if command == "M": ok = raw.FPDFPath_MoveTo(obj, *coords)
                elif command == "L": ok = raw.FPDFPath_LineTo(obj, *coords)
                elif command == "C": ok = raw.FPDFPath_BezierTo(obj, *coords)
                elif command == "Z": ok = raw.FPDFPath_Close(obj)
                else: raise ValueError("drawing_path_command_not_supported")
                if not ok: raise ValueError("drawing_path_failed")
            raw.FPDFPageObj_SetFillColor(obj, *fill)
            raw.FPDFPageObj_SetStrokeColor(obj, *stroke)
            raw.FPDFPageObj_SetStrokeWidth(obj, width)
            raw.FPDFPageObj_SetLineCap(obj, {"flat": 0, "rnd": 1, "sq": 2}.get(cap, 0))
            raw.FPDFPageObj_SetLineJoin(obj, {"miter": 0, "round": 1, "bevel": 2}.get(join, 0))
            raw.FPDFPath_SetDrawMode(obj, raw.FPDF_FILLMODE_WINDING if fill[3] else raw.FPDF_FILLMODE_NONE, bool(stroke[3]))
            self.insert(page, obj, matrix)
        except Exception:
            raw.FPDFPageObj_Destroy(obj)
            raise

    def text(self, page, shape, matrix, default_font):
        box = child(shape, "txbx")
        if box is None:
            return
        body = child(shape, "bodyPr")
        direction = body.get("vert", "horz") if body is not None else "horz"
        if direction not in ("horz", "vert", "vert270", "eaVert") or number(body, "rot"):
            raise ValueError("drawing_text_direction_not_supported")
        # eaVert rotates Western text. CJK needs vertical glyph substitutions
        # and metrics; reject that case until those are supported explicitly.
        if direction == "eaVert" and any(ord(c) > 127 for node in box.iter("{"+NS["w"]+"}t") for c in node.text or ""):
            raise ValueError("drawing_vertical_glyph_layout_not_supported")
        _, width, height = transform(child(child(shape, "spPr"), "xfrm"))
        left, top = number(body, "lIns", 91440), number(body, "tIns", 45720)
        if direction in ("vert", "eaVert"):
            matrix = mul(matrix, (0, 1, -1, 0, width, 0))
            left, top = top, number(body, "rIns", 91440)
        elif direction == "vert270":
            matrix = mul(matrix, (0, -1, 1, 0, 0, height))
            left, top = number(body, "bIns", 45720), left
        y = top
        for paragraph in box.findall(".//w:p", NS):
            x, line_height = left, 0
            for run in paragraph.findall("w:r", NS):
                text = "".join(n.text or "" for n in run.findall("w:t", NS))
                if not text: continue
                if any(0xE000 <= ord(c) <= 0xF8FF for c in text):
                    raise ValueError("drawing_private_glyph_unresolved")
                props = run.find("w:rPr", NS)
                fonts = child(props, "rFonts")
                script = "eastAsia" if any(0x2E80 <= ord(c) <= 0x9FFF for c in text) else "ascii"
                family = fonts.get("{"+NS["w"]+"}"+script, fonts.get("{"+NS["w"]+"}ascii", default_font)) if fonts is not None else default_font
                size_node = child(props, "sz")
                size = float(size_node.get("{"+NS["w"]+"}val", "22")) / 2 if size_node is not None else 11
                if not 0 < size <= 500: raise ValueError("drawing_font_size_limit")
                font = self.font(family, child(props, "i") is not None, child(props, "b") is not None)
                ascent = C.c_float()
                if not raw.FPDFFont_GetAscent(font, size, C.byref(ascent)):
                    raise ValueError("drawing_font_metrics_failed")
                obj = raw.FPDFPageObj_CreateTextObj(self.pdf, font, size)
                encoded = text.encode("utf-16-le") + b"\0\0"
                buffer = (C.c_ushort * (len(encoded)//2)).from_buffer_copy(encoded)
                if not raw.FPDFText_SetText(obj, buffer):
                    raw.FPDFPageObj_Destroy(obj)
                    raise ValueError("drawing_text_failed")
                text_color = child(props, "color")
                val = text_color.get("{"+NS["w"]+"}val", "000000") if text_color is not None else "000000"
                if not re.fullmatch(r"[\da-fA-F]{6}", val): val = "000000"
                raw.FPDFPageObj_SetFillColor(obj, *[int(val[i:i+2], 16) for i in (0, 2, 4)], 255)
                self.insert(page, obj, mul(matrix, (EMU, 0, 0, -EMU, x, y + ascent.value * EMU)))
                for character in text:
                    width = C.c_float()
                    if not raw.FPDFFont_GetGlyphWidth(font, ord(character), size, C.byref(width)):
                        raise ValueError("drawing_text_glyph_unresolved")
                    x += width.value * EMU
                line_height = max(line_height, size * EMU * 1.2)
            y += line_height

    def shape(self, page, shape, parent, default_font):
        props = child(shape, "spPr")
        matrix, w, h = transform(child(props, "xfrm"))
        matrix = mul(parent, matrix)
        if props is None: raise ValueError("drawing_shape_properties_missing")
        if any(local(n) in ("effectLst", "effectDag", "scene3d", "sp3d", "gradFill", "blipFill", "pattFill") for n in props):
            raise ValueError("drawing_effect_not_supported")
        style = child(shape, "style")
        fill = color(props, color(child(style, "fillRef"), (0, 0, 0, 0)))
        line = child(props, "ln")
        if line is not None and any(local(n) in ("headEnd", "tailEnd", "prstDash", "custDash") for n in line):
            raise ValueError("drawing_line_style_not_supported")
        stroke = color(line, color(child(style, "lnRef")))
        width = max(0, number(line, "w", 12700))
        cap = line.get("cap", "flat") if line is not None else "flat"
        join = next((local(n) for n in line if local(n) in ("miter", "round", "bevel")), "miter") if line is not None else "miter"
        geometry, preset = child(props, "custGeom"), child(props, "prstGeom")
        if preset is not None:
            kind = preset.get("prst")
            if kind == "rect": commands = [("M", (0, 0)), ("L", (w, 0)), ("L", (w, h)), ("L", (0, h)), ("Z", ())]
            elif kind == "line": commands = [("M", (0, 0)), ("L", (w, h))]
            else: raise ValueError("drawing_preset_not_supported:" + str(kind))
            self.path(page, commands, matrix, fill, stroke, width, cap, join)
        elif geometry is not None:
            if any(len(n) for n in geometry if local(n) in ("avLst", "gdLst")):
                raise ValueError("drawing_geometry_formula_not_supported")
            paths = child(geometry, "pathLst")
            if paths is None: raise ValueError("drawing_paths_missing")
            for source in paths:
                pw, ph = number(source, "w", w), number(source, "h", h)
                scale = (w/pw if pw else 1, 0, 0, h/ph if ph else 1, 0, 0)
                commands, last = [], (0, 0)
                for entry in source:
                    name = local(entry)
                    points = [(number(p, "x"), number(p, "y")) for p in entry]
                    if name in ("moveTo", "lnTo") and len(points) == 1:
                        commands.append(("M" if name == "moveTo" else "L", points[0]))
                    elif name == "cubicBezTo" and len(points) == 3:
                        commands.append(("C", tuple(v for point in points for v in point)))
                    elif name == "quadBezTo" and len(points) == 2:
                        control, end = points
                        commands.append(("C", (*[last[i]+2*(control[i]-last[i])/3 for i in (0,1)],
                                                *[end[i]+2*(control[i]-end[i])/3 for i in (0,1)], *end)))
                    elif name == "close": commands.append(("Z", ()))
                    else: raise ValueError("drawing_path_command_not_supported:" + name)
                    if points: last = points[-1]
                path_fill = fill if source.get("fill", "norm") == "norm" else (0,0,0,0)
                if source.get("fill", "norm") not in ("norm", "none"): raise ValueError("drawing_path_fill_not_supported")
                self.path(page, commands, mul(matrix, scale), path_fill,
                          (0,0,0,0) if source.get("stroke") in ("0", "false") else stroke, width, cap, join)
        else:
            raise ValueError("drawing_geometry_missing")
        self.text(page, shape, matrix, default_font)

    def group(self, page, group, parent, default_font):
        matrix, _, _ = transform(child(child(group, "grpSpPr"), "xfrm"), True)
        matrix = mul(parent, matrix)
        for node in group:
            kind = local(node)
            if kind in ("wsp", "sp"): self.shape(page, node, matrix, default_font)
            elif kind in ("wgp", "grpSp"): self.group(page, node, matrix, default_font)
            elif kind not in ("cNvGrpSpPr", "grpSpPr", "nvGrpSpPr", "cNvPr"):
                raise ValueError("drawing_group_child_not_supported:" + kind)

    def render(self, item, output):
        root = E.fromstring(item["xml"])
        extent = root.find(".//wp:extent", NS)
        w, h = number(extent, "cx")/EMU, number(extent, "cy")/EMU
        if not 0 < w < 10000 or not 0 < h < 10000:
            raise ValueError("drawing_extent_limit")
        data = root.find(".//a:graphicData", NS)
        if data is None or len(data) != 1: raise ValueError("drawing_graphic_data_unsupported")
        # Padding keeps strokes on the declared bounds from being clipped.
        margin = 2
        page = self.pdf.new_page(w+margin*2, h+margin*2)
        try:
            matrix = (1/EMU, 0, 0, -1/EMU, margin, h+margin)
            node = data[0]
            if local(node) in ("wgp", "grpSp"): self.group(page, node, matrix, item.get("defaultFont", "Times New Roman"))
            elif local(node) in ("wsp", "sp"): self.shape(page, node, matrix, item.get("defaultFont", "Times New Roman"))
            else: raise ValueError("drawing_type_not_supported")
            page.gen_content()
            scale = min(3, math.sqrt(16000000 / ((w+4)*(h+4))))
            bitmap = page.render(scale=scale)
            try:
                image = bitmap.to_pil()
                target = output / (item["id"] + ".png")
                image.save(target, dpi=(72*scale, 72*scale))
                return {"id": item["id"], "status": "rendered", "file": target.name,
                        "width": image.width, "height": image.height,
                        "sourceHash": hashlib.sha256(item["xml"].encode()).hexdigest(),
                        "representation": "source_geometry", "semanticRecognition": False}
            finally: bitmap.close()
        finally:
            page.close()
            del self.pdf[0]


def main():
    config = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    output = Path(config["output"]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    renderer, results = Renderer(), []
    try:
        for item in config["drawings"]:
            if not re.fullmatch(r"drawing-[a-f0-9]{20}", item["id"]): raise ValueError("invalid_drawing_id")
            try: results.append(renderer.render(item, output))
            except (ValueError, OSError, E.ParseError) as error:
                results.append({"id": item["id"], "status": "unsupported", "reason": str(error)})
    finally: renderer.close()
    Path(config["result"]).write_text(json.dumps(results), encoding="utf-8")


if __name__ == "__main__": main()
