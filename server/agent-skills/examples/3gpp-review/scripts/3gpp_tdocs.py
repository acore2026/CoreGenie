#!/usr/bin/env python3
"""Linux helper for the 3gpp-review skill."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import re
import shutil
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from lxml import etree
from openpyxl import load_workbook


DOC_RE = re.compile(r"\b([A-Z]\d-\d{6,8})\b", re.I)
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
ALLOWED_3GPP_HOSTS = {"www.3gpp.org", "ftp.3gpp.org"}
MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
MAX_ARCHIVE_ENTRY_BYTES = 100 * 1024 * 1024
MAX_ARCHIVE_TOTAL_BYTES = 250 * 1024 * 1024
MANIFEST_SCHEMA = "3gpp-review-manifest/v1"
COVERAGE_SCHEMA = "3gpp-review-coverage/v1"


def cell_value(cell) -> str:
    return "" if cell.value is None else str(cell.value).strip()


def choose_sheet(workbook, requested: str | None):
    if requested:
        if requested not in workbook.sheetnames:
            raise SystemExit(f"Sheet not found: {requested!r}; choices={workbook.sheetnames}")
        return workbook[requested]
    if len(workbook.sheetnames) != 1:
        raise SystemExit(f"Specify --sheet; choices={workbook.sheetnames}")
    return workbook[workbook.sheetnames[0]]


def cmd_inspect(args) -> None:
    workbook = load_workbook(args.excel, read_only=True, data_only=True)
    print("Sheets:")
    for sheet in workbook:
        print(f"  {sheet.title}: rows={sheet.max_row}, columns={sheet.max_column}")
    sheets = [choose_sheet(workbook, args.sheet)] if args.sheet else list(workbook)
    for sheet in sheets:
        print(f"\n=== {sheet.title} ===")
        for row_no, row in enumerate(
            sheet.iter_rows(min_row=1, max_row=min(args.rows, sheet.max_row)), 1
        ):
            fields = [f"C{i}={cell_value(cell)}" for i, cell in enumerate(row, 1) if cell_value(cell)]
            if fields:
                print(f"R{row_no}: " + " | ".join(fields))


def detect_headers(rows: list[list[str]]) -> dict[str, tuple[int, int]]:
    patterns = {
        "status": ("status", "availability"),
        "agenda": ("agenda item", "agenda", "ai"),
        "document": ("tdoc", "document number", "doc number", "tdoc no"),
        "title": ("title", "subject"),
        "source": ("source", "company"),
    }
    found: dict[str, tuple[int, int]] = {}
    for row_idx, row in enumerate(rows):
        for col_idx, raw in enumerate(row):
            text = re.sub(r"\s+", " ", raw.lower()).strip()
            for field, labels in patterns.items():
                if field not in found and any(
                    text == label or text.startswith(label + " ") for label in labels
                ):
                    found[field] = (row_idx, col_idx)
    return found


def find_doc_column(rows: list[list[str]]) -> int | None:
    scores: dict[int, int] = {}
    for row in rows:
        for idx, text in enumerate(row):
            if DOC_RE.search(text):
                scores[idx] = scores.get(idx, 0) + 1
    return max(scores, key=scores.get) if scores else None


def cmd_filter(args) -> None:
    workbook = load_workbook(args.excel, read_only=True, data_only=True)
    sheet = choose_sheet(workbook, args.sheet)
    rows = [[cell_value(cell) for cell in row] for row in sheet.iter_rows()]
    headers = detect_headers(rows[: min(30, len(rows))])
    doc_col = headers.get("document", (0, find_doc_column(rows)))[1]
    if doc_col is None:
        raise SystemExit("Could not detect a document-number column; inspect the workbook first")
    agenda_col = headers.get("agenda", (0, None))[1]
    title_col = headers.get("title", (0, None))[1]
    source_col = headers.get("source", (0, None))[1]
    status_col = headers.get("status", (0, None))[1]
    start_row = max((position[0] for position in headers.values()), default=0) + 1

    def at(row, col):
        return row[col].strip() if col is not None and col < len(row) else ""

    requested = {
        match.group(1).upper()
        for value in (args.documents or [])
        if (match := DOC_RE.search(value))
    }
    if args.documents and len(requested) != len(args.documents):
        raise SystemExit("Every --documents value must be a valid TDoc number")
    proposals = []
    seen = set()
    for row in rows[start_row:]:
        match = DOC_RE.search(at(row, doc_col))
        if not match:
            continue
        if args.agenda and args.agenda.casefold() not in at(row, agenda_col).casefold():
            continue
        source_filter = getattr(args, "source", None)
        if source_filter and source_filter.casefold() not in at(row, source_col).casefold():
            continue
        doc = match.group(1).upper()
        if requested and doc not in requested:
            continue
        if doc in seen:
            continue
        seen.add(doc)
        proposals.append(
            {
                "document": doc,
                "agenda": at(row, agenda_col),
                "title": at(row, title_col),
                "source": at(row, source_col),
                "status": at(row, status_col),
            }
        )
    missing = sorted(requested - {item["document"] for item in proposals})
    if missing:
        raise SystemExit(
            "Requested TDocs were not found under the selected agenda: "
            + ", ".join(missing)
        )
    payload = {
        "schema": MANIFEST_SCHEMA,
        "excel": str(Path(args.excel).resolve()),
        "sheet": sheet.title,
        "agenda_filter": args.agenda,
        "source_filter": getattr(args, "source", None),
        "count": len(proposals),
        "proposals": proposals,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(proposals)} proposals to {output}")
    for item in proposals:
        print(f"{item['document']}\t{item['source']}\t{item['title']}")


def manifest_payload(path: str) -> dict:
    manifest = Path(path)
    try:
        payload = json.loads(manifest.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(f"Manifest not found: {manifest}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Manifest is not valid JSON: {manifest}: {exc}") from exc
    if not isinstance(payload, dict) or payload.get("schema") != MANIFEST_SCHEMA:
        raise SystemExit(
            f"Manifest must be generated by filter-index and use schema {MANIFEST_SCHEMA!r}"
        )
    proposals = payload.get("proposals")
    if not isinstance(proposals, list):
        raise SystemExit("Manifest field 'proposals' must be an array")
    if payload.get("count") != len(proposals):
        raise SystemExit("Manifest field 'count' does not match the proposals array")
    required = ("document", "agenda", "title", "source", "status")
    seen = set()
    for index, item in enumerate(proposals):
        if not isinstance(item, dict):
            raise SystemExit(f"Manifest proposal #{index + 1} must be an object")
        missing = [field for field in required if not isinstance(item.get(field), str)]
        if missing:
            raise SystemExit(
                f"Manifest proposal #{index + 1} has missing or non-string fields: "
                + ", ".join(missing)
            )
        match = DOC_RE.fullmatch(item["document"].strip())
        if not match:
            raise SystemExit(
                f"Manifest proposal #{index + 1} has invalid document: {item['document']!r}"
            )
        document = match.group(1).upper()
        if document in seen:
            raise SystemExit(f"Manifest contains duplicate document: {document}")
        seen.add(document)
        item["document"] = document
    return payload


def load_manifest(path: str) -> list[dict]:
    return manifest_payload(path)["proposals"]


def cmd_validate_manifest(args) -> None:
    payload = manifest_payload(args.manifest)
    print(f"Schema: {payload['schema']}")
    print(f"Proposals: {len(payload['proposals'])}")
    print("Documents: " + ", ".join(item["document"] for item in payload["proposals"]))


def validate_3gpp_url(url: str) -> None:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_3GPP_HOSTS:
        raise ValueError("Only HTTPS downloads from official 3GPP hosts are allowed")


def validate_archive(bundle: zipfile.ZipFile) -> None:
    total = 0
    for item in bundle.infolist():
        if item.file_size > MAX_ARCHIVE_ENTRY_BYTES:
            raise ValueError(f"Archive entry exceeds limit: {item.filename}")
        total += item.file_size
        if total > MAX_ARCHIVE_TOTAL_BYTES:
            raise ValueError("Archive uncompressed size exceeds limit")


def download_limited(response, target) -> None:
    validate_3gpp_url(response.geturl())
    declared = response.headers.get("Content-Length")
    if declared and int(declared) > MAX_DOWNLOAD_BYTES:
        raise ValueError("Download exceeds the 100 MiB limit")
    written = 0
    while chunk := response.read(1024 * 1024):
        written += len(chunk)
        if written > MAX_DOWNLOAD_BYTES:
            raise ValueError("Download exceeds the 100 MiB limit")
        target.write(chunk)


def download_one(item: dict, base_url: str, output: Path) -> tuple[str, str]:
    doc = item["document"].upper()
    archive = output / f"{doc}.zip"
    existing = list(output.glob(f"{doc}*.docx"))
    if existing:
        return doc, f"cached {existing[0].name}"
    url = f"{base_url.rstrip('/')}/{doc}.zip"
    try:
        validate_3gpp_url(url)
    except ValueError as exc:
        return doc, f"ERROR {exc}"
    if not archive.exists() or not zipfile.is_zipfile(archive):
        request = urllib.request.Request(url, headers={"User-Agent": "3gpp-review/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=120) as response, archive.open("wb") as target:
                download_limited(response, target)
        except (OSError, ValueError, urllib.error.URLError) as exc:
            archive.unlink(missing_ok=True)
            return doc, f"ERROR download {url}: {exc}"
    if not zipfile.is_zipfile(archive):
        archive.unlink(missing_ok=True)
        return doc, "ERROR invalid ZIP"
    if archive.stat().st_size > MAX_DOWNLOAD_BYTES:
        archive.unlink(missing_ok=True)
        return doc, "ERROR ZIP exceeds download limit"
    with zipfile.ZipFile(archive) as bundle:
        try:
            validate_archive(bundle)
        except ValueError as exc:
            archive.unlink(missing_ok=True)
            return doc, f"ERROR {exc}"
        names = [name for name in bundle.namelist() if name.lower().endswith(".docx")]
        if not names:
            return doc, "ERROR ZIP contains no DOCX"
        for index, name in enumerate(names, 1):
            suffix = "" if len(names) == 1 else f"-{index}"
            destination = output / f"{doc}{suffix}.docx"
            with bundle.open(name) as source, destination.open("wb") as target:
                shutil.copyfileobj(source, target)
    return doc, "downloaded"


def cmd_download(args) -> None:
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    proposals = load_manifest(args.manifest)
    failures = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(download_one, item, args.base_url, output) for item in proposals]
        for future in concurrent.futures.as_completed(futures):
            doc, result = future.result()
            print(f"{doc}: {result}")
            failures += result.startswith("ERROR")
    if failures:
        raise SystemExit(f"{failures} download(s) failed")


def xml_text(node) -> str:
    return "".join(node.xpath(".//w:t/text()", namespaces=NS)).strip()


def visio_text(data: bytes) -> list[str]:
    texts = []
    try:
        with zipfile.ZipFile(BytesIO(data)) as visio:
            pages = sorted(
                name for name in visio.namelist()
                if re.search(r"visio/pages/page\d+\.xml$", name)
            )
            for name in pages:
                root = etree.fromstring(visio.read(name))
                for node in root.xpath("//*[local-name()='Text']"):
                    text = "".join(node.itertext()).strip()
                    if text:
                        texts.append(text)
    except (zipfile.BadZipFile, etree.XMLSyntaxError):
        pass
    return texts


def safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", Path(name).name)


def extract_docx(docx: Path, texts: Path, figures: Path) -> tuple[str, str]:
    doc_id = docx.stem
    doc_figures = figures / doc_id
    doc_figures.mkdir(parents=True, exist_ok=True)
    lines = [f"[SOURCE DOCX: {docx.resolve()}]"]
    try:
        with zipfile.ZipFile(docx) as package:
            validate_archive(package)
            root = etree.fromstring(package.read("word/document.xml"))
            body = root.find("w:body", NS)
            if body is not None:
                for child in body:
                    kind = etree.QName(child).localname
                    if kind == "p":
                        text = xml_text(child)
                        if text:
                            lines.append(text)
                    elif kind == "tbl":
                        lines.append("[TABLE START]")
                        for row in child.xpath("./w:tr", namespaces=NS):
                            cells = [xml_text(cell) for cell in row.xpath("./w:tc", namespaces=NS)]
                            lines.append(" | ".join(cells))
                        lines.append("[TABLE END]")

            xml_root = etree.fromstring(package.read("word/document.xml"))
            shape_text = []
            for node in xml_root.xpath("//*[local-name()='textbox' or local-name()='txbx']"):
                text = xml_text(node)
                if text and text not in shape_text:
                    shape_text.append(text)
            if shape_text:
                lines.extend(["[VML/WPS TEXT]", *shape_text, "[END VML/WPS TEXT]"])

            for name in package.namelist():
                lower = name.lower()
                if lower.startswith("word/media/") and not lower.endswith("/"):
                    destination = doc_figures / safe_name(name)
                    destination.write_bytes(package.read(name))
                    lines.append(f"[FIGURE: {destination.resolve()}]")
                elif lower.startswith("word/embeddings/") and lower.endswith(".vsdx"):
                    data = package.read(name)
                    destination = doc_figures / safe_name(name)
                    destination.write_bytes(data)
                    extracted = visio_text(data)
                    lines.append(f"[VISIO: {destination.resolve()}]")
                    if extracted:
                        lines.extend(["[VISIO TEXT]", *extracted, "[END VISIO TEXT]"])
    except (KeyError, ValueError, zipfile.BadZipFile, etree.XMLSyntaxError) as exc:
        return doc_id, f"ERROR {exc}"
    target = texts / f"{doc_id}.txt"
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return doc_id, f"{target.name}: {len(lines)} lines"


def cmd_extract(args) -> None:
    source = Path(args.input)
    texts = Path(args.texts)
    figures = Path(args.figures)
    texts.mkdir(parents=True, exist_ok=True)
    figures.mkdir(parents=True, exist_ok=True)
    documents = sorted(source.glob("*.docx"))
    if not documents:
        raise SystemExit(f"No DOCX files found in {source}")
    failures = 0
    for docx in documents:
        doc, result = extract_docx(docx, texts, figures)
        print(f"{doc}: {result}")
        failures += result.startswith("ERROR")
    if failures:
        raise SystemExit(f"{failures} extraction(s) failed")


def cmd_coverage(args) -> None:
    manifest = Path(args.manifest)
    receipt = Path(args.receipt)
    payload = manifest_payload(str(manifest))
    expected = {item["document"].upper() for item in payload["proposals"]}
    extracted = set()
    for path in Path(args.texts).glob("*.txt"):
        match = DOC_RE.search(path.stem)
        if match:
            extracted.add(match.group(1).upper())
    missing = sorted(expected - extracted)
    extra = sorted(extracted - expected)
    print(f"Expected: {len(expected)}")
    print(f"Extracted: {len(expected & extracted)}")
    print("Missing: " + (", ".join(missing) if missing else "none"))
    print("Extra: " + (", ".join(extra) if extra else "none"))
    if missing or extra:
        receipt.unlink(missing_ok=True)
        raise SystemExit(1)
    manifest_bytes = manifest.read_bytes()
    coverage = {
        "schema": COVERAGE_SCHEMA,
        "status": "passed",
        "manifest": str(manifest.resolve()),
        "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "texts": str(Path(args.texts).resolve()),
        "expectedDocuments": sorted(expected),
        "extractedDocuments": sorted(extracted),
        "missing": [],
        "extra": [],
        "validatedAt": datetime.now(timezone.utc).isoformat(),
    }
    receipt.parent.mkdir(parents=True, exist_ok=True)
    receipt.write_text(
        json.dumps(coverage, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Coverage receipt: {receipt}")


def make_parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)

    inspect = commands.add_parser("inspect-index")
    inspect.add_argument("--excel", required=True)
    inspect.add_argument("--sheet")
    inspect.add_argument("--rows", type=int, default=20)
    inspect.set_defaults(func=cmd_inspect)

    filtering = commands.add_parser("filter-index")
    filtering.add_argument("--excel", required=True)
    filtering.add_argument("--sheet")
    filtering.add_argument("--agenda", required=True)
    filtering.add_argument("--source")
    filtering.add_argument("--documents", nargs="*")
    filtering.add_argument("--output", required=True)
    filtering.set_defaults(func=cmd_filter)

    download = commands.add_parser("download")
    download.add_argument("--manifest", required=True)
    download.add_argument("--base-url", required=True)
    download.add_argument("--output", required=True)
    download.add_argument("--workers", type=int, default=5)
    download.set_defaults(func=cmd_download)

    validating = commands.add_parser("validate-manifest")
    validating.add_argument("--manifest", required=True)
    validating.set_defaults(func=cmd_validate_manifest)

    extract = commands.add_parser("extract")
    extract.add_argument("--input", required=True)
    extract.add_argument("--texts", required=True)
    extract.add_argument("--figures", required=True)
    extract.set_defaults(func=cmd_extract)

    coverage = commands.add_parser("coverage")
    coverage.add_argument("--manifest", required=True)
    coverage.add_argument("--texts", required=True)
    coverage.add_argument("--receipt", required=True)
    coverage.set_defaults(func=cmd_coverage)
    return root


def main() -> None:
    args = make_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
