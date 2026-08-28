import importlib.util
import json
import sys
import zipfile
from argparse import Namespace
from pathlib import Path

import pytest
from openpyxl import Workbook


SCRIPT = (
    Path(__file__).parents[2]
    / "agent-skills"
    / "examples"
    / "3gpp-review"
    / "scripts"
    / "3gpp_tdocs.py"
)
SPEC = importlib.util.spec_from_file_location("threegpp_tdocs", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def workbook(path):
    book = Workbook()
    sheet = book.active
    sheet.title = "TDocs"
    sheet.append(["TDoc", "Agenda Item", "Title", "Source", "Status"])
    sheet.append(["S2-2606085", "20.6.22", "Coordination", "Huawei", "available"])
    sheet.append(["S2-2606481", "20.6.22", "Metrics", "Nokia", "available"])
    sheet.append(["S2-2600001", "20.6.19", "Other", "Example", "available"])
    book.save(path)


def test_filter_index_honors_agenda_and_explicit_documents(tmp_path):
    excel = tmp_path / "index.xlsx"
    output = tmp_path / "manifest.json"
    workbook(excel)
    MODULE.cmd_filter(
        Namespace(
            excel=str(excel),
            sheet="TDocs",
            agenda="20.6.22",
            documents=["S2-2606481"],
            output=str(output),
        )
    )
    payload = json.loads(output.read_text())
    assert [item["document"] for item in payload["proposals"]] == ["S2-2606481"]


def test_filter_index_rejects_requested_document_outside_agenda(tmp_path):
    excel = tmp_path / "index.xlsx"
    workbook(excel)
    with pytest.raises(SystemExit, match="were not found"):
        MODULE.cmd_filter(
            Namespace(
                excel=str(excel),
                sheet="TDocs",
                agenda="20.6.22",
                documents=["S2-2600001"],
                output=str(tmp_path / "manifest.json"),
            )
        )


def test_download_url_is_restricted_to_official_https_hosts():
    MODULE.validate_3gpp_url("https://www.3gpp.org/ftp/tsg_sa/file.zip")
    with pytest.raises(ValueError):
        MODULE.validate_3gpp_url("http://www.3gpp.org/ftp/file.zip")
    with pytest.raises(ValueError):
        MODULE.validate_3gpp_url("https://example.com/file.zip")


def test_archive_uncompressed_limit_is_enforced(tmp_path, monkeypatch):
    archive = tmp_path / "small.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("document.docx", b"12")
    monkeypatch.setattr(MODULE, "MAX_ARCHIVE_TOTAL_BYTES", 1)
    with zipfile.ZipFile(archive) as bundle, pytest.raises(ValueError):
        MODULE.validate_archive(bundle)
