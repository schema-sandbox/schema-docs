"""Assemble a private Windows runtime from explicitly supplied, pinned inputs.

No downloads, installation, or modification of the source runtimes. Generated
manifest inventories every shipped file; review native notices before publishing.
"""
import argparse
import hashlib
import importlib.metadata as metadata
import json
from pathlib import Path
import shutil
import struct
import sys
import zipfile

PACKAGES = {"pdfplumber": "0.11.9", "pdfminer.six": "20251230", "pypdfium2": "5.13.0",
            "Pillow": "12.3.0", "charset-normalizer": "3.5.1", "cryptography": "50.0.1",
            "cffi": "2.1.1", "pycparser": "3.0"}


def imports(file):
    """Read normal and delayed PE imports without executing downloaded code."""
    data = file.read_bytes()
    pe = struct.unpack_from("<I", data, 0x3c)[0]
    sections, optional_size = struct.unpack_from("<H12xH", data, pe + 6)
    optional = pe + 24
    directories = optional + (112 if struct.unpack_from("<H", data, optional)[0] == 0x20b else 96)
    rva = struct.unpack_from("<I", data, directories + 8)[0]
    table = optional + optional_size

    def offset(address):
        for index in range(sections):
            virtual_size, virtual, size, raw = struct.unpack_from("<IIII", data, table + index * 40 + 8)
            if virtual <= address < virtual + max(virtual_size, size):
                return raw + address - virtual
        raise ValueError(f"Invalid PE import address in {file.name}")

    names = []
    if rva:
        position = offset(rva)
        while any(data[position:position + 20]):
            name = offset(struct.unpack_from("<I", data, position + 12)[0])
            names.append(data[name:data.index(b"\0", name)].decode("ascii"))
            position += 20
    delay = struct.unpack_from("<I", data, directories + 13 * 8)[0]
    if delay:
        position = offset(delay)
        while any(data[position:position + 32]):
            flags, name_rva = struct.unpack_from("<II", data, position)
            if flags != 1:
                raise ValueError("Unsupported legacy delay-import address mode")
            name = offset(name_rva)
            names.append(data[name:data.index(b"\0", name)].decode("ascii"))
            position += 32
    return sorted(set(names))


def verify_native_build(source):
    receipt = json.loads((source / "build-receipt.json").read_text(encoding="utf-8"))
    if receipt.get("schema") != "schema-docs.native-ocr-build.v1":
        raise ValueError("Missing native source build receipt")
    paths = set()
    for entry in receipt["files"]:
        target = (source / entry["path"]).resolve()
        if not target.is_relative_to(source) or target in paths or target.is_symlink():
            raise ValueError("Invalid native build inventory path")
        if target.stat().st_size != entry["bytes"] or hashlib.sha256(target.read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError(f"Native build changed: {entry['path']}")
        paths.add(target)
    actual = {p.resolve() for p in source.rglob("*") if p.is_file() and p.name != "build-receipt.json"}
    if actual != paths:
        raise ValueError("Native build contains unlisted files")
    binaries = {p.name.lower(): p for p in paths if p.suffix in (".dll", ".exe")}
    if set(binaries) != {"tesseract.exe", "tesseract55.dll"}:
        raise ValueError("Unexpected native OCR binary closure")
    system = set()
    for binary in binaries.values():
        for dependency in imports(binary):
            if dependency.lower() not in binaries:
                if dependency.lower() != "kernel32.dll":
                    raise ValueError(f"Unreviewed native dependency: {dependency}")
                system.add(dependency)
    return receipt, sorted(system)


def assemble(args):
    root = Path(__file__).resolve().parent.parent
    output = (root / args.output).resolve()
    if not output.is_relative_to(root) or output == root:
        raise ValueError("Runtime output must be inside this workspace")
    native_source = Path(args.tesseract).resolve()
    receipt, system = verify_native_build(native_source)
    python_source = Path(sys.executable).resolve().parent
    if sys.version_info[:3] != (3, 12, 14):
        raise ValueError("This runtime lock requires Python 3.12.14")
    for name, version in PACKAGES.items():
        if metadata.version(name) != version:
            raise ValueError(f"Expected {name}=={version}")
    lock = json.loads((root / "config" / "conversion-runtime-inputs.json").read_text(encoding="utf-8"))
    for entry in lock["files"]:
        relative = Path(entry["path"])
        if relative.parts[0] == "python":
            target = python_source / Path(*relative.parts[1:])
        elif relative.parts[1] == "tessdata":
            target = output / relative
        else:
            target = native_source / Path(*relative.parts[1:])
        if hashlib.sha256(target.read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError(f"Runtime input checksum mismatch: {relative}")
    if any((output / name).exists() for name in ("python", "tesseract/tesseract.exe")):
        raise ValueError("A runtime is already assembled. Use a fresh checkout to rebuild; existing output is protected.")
    python = output / "python"

    def copy(source, destination):
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)

    for name in ("python.exe", "python3.dll", "python312.dll", "vcruntime140.dll", "vcruntime140_1.dll", "LICENSE.txt"):
        copy(python_source / name, python / name)
    excluded = {"site-packages", "test", "tests", "__pycache__", "idlelib", "tkinter", "turtledemo", "ensurepip"}
    with zipfile.ZipFile(python / "python312.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for source in sorted((python_source / "Lib").rglob("*")):
            relative = source.relative_to(python_source / "Lib")
            if source.is_file() and not set(relative.parts) & excluded and source.suffix != ".pyc":
                archive.write(source, relative.as_posix())
    for source in (python_source / "DLLs").iterdir():
        if source.is_file() and source.suffix in {".pyd", ".dll"} and not source.name.startswith(("_test", "_tkinter", "tcl", "tk")):
            copy(source, python / "DLLs" / source.name)
    for name in PACKAGES:
        distribution = metadata.distribution(name)
        for relative in distribution.files:
            if ".." in relative.parts or "__pycache__" in relative.parts or relative.suffix == ".pyc":
                continue
            source = Path(distribution.locate_file(relative))
            if source.is_file():
                copy(source, python / "Lib" / "site-packages" / str(relative))
    (python / "python312._pth").write_text("python312.zip\n.\nDLLs\nLib/site-packages\n../../src/adapters\n", encoding="utf-8")
    for source in native_source.rglob("*"):
        if source.is_file():
            copy(source, output / "tesseract" / source.relative_to(native_source))
    for language in ("chi_sim", "eng"):
        if not (output / "tesseract" / "tessdata" / f"{language}.traineddata").is_file():
            raise ValueError(f"Missing pinned language input {language}.traineddata")
    files = [{"path": p.relative_to(output).as_posix(), "bytes": p.stat().st_size,
              "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
             for p in sorted(output.rglob("*")) if p.is_file() and p.name != "manifest.json"]
    manifest = {"schema": "schema-docs.conversion-runtime.v1", "platform": "windows-x64",
                "python": "3.12.14", "packages": PACKAGES, "tesseract": "5.5.0-source-build",
                "nativeSourceBuild": "tesseract/build-receipt.json",
                "languageSource": "https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0",
                "nativeTransitiveNotices": "pending-review-before-public-distribution",
                "systemLibraries": sorted(system), "files": files, "bytes": sum(f["bytes"] for f in files)}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"files": len(files), "bytes": manifest["bytes"], "nativeBinaries": 2}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--tesseract", required=True, help="Directory containing the locked Tesseract build")
    parser.add_argument("--output", default="runtime", help="Fresh workspace-relative output; seed its tesseract/tessdata inputs first")
    assemble(parser.parse_args())
