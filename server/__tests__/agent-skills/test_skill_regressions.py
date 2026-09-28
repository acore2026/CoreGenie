"""Observable regressions in packaged document processing, without network access."""
import hashlib
import importlib.util
import json
from pathlib import Path
from argparse import Namespace
import zipfile

import pytest
from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[3] / "agent-config" / "skills"


def load(skill, script):
    spec = importlib.util.spec_from_file_location(skill, ROOT / skill / "scripts" / script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


REVIEW = load("3gpp-review", "3gpp_tdocs.py")
SPLIT = load("3gpp-split-docx", "split_docx.py")
MATRIX = load("3gpp-feature-matrix", "build_matrix.py")
EVOLUTION = load("3gpp-position-evolution", "3gpp_evolution.py")
W = REVIEW.NS["w"]
R = REVIEW.NS["r"]


def test_agenda_download_selection_is_not_strict_index_manifest(tmp_path):
    manifest = tmp_path / "selection.json"
    manifest.write_text(json.dumps({"schema": "3gpp-agenda-selection/v1", "count": 1, "proposals": [{"document": "S2-260001", "agenda": "5.1", "title": "sample", "source": "", "status": "unknown"}]}))
    assert len(REVIEW.manifest_payload(str(manifest), allow_agenda_selection=True)["proposals"]) == 1
    with pytest.raises(SystemExit):
        REVIEW.manifest_payload(str(manifest))


def make_docx(path, body):
    styles = ''.join(f'<w:style w:styleId="H{n}"><w:name w:val="Heading {n}"/></w:style>' for n in range(1, 5))
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')
        archive.writestr("word/document.xml", f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{body}<w:sectPr/></w:body></w:document>')
        archive.writestr("word/styles.xml", f'<w:styles xmlns:w="{W}">{styles}</w:styles>')
        archive.writestr("word/_rels/document.xml.rels", f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{R}/image" Target="media/image.png"/><Relationship Id="rId2" Type="{R}/oleObject" Target="embeddings/object.bin"/></Relationships>')
        archive.writestr("word/media/image.png", b"preserved image bytes")
        archive.writestr("word/embeddings/object.bin", b"preserved object bytes")


def paragraph(text, level=None):
    style = f'<w:pPr><w:pStyle w:val="H{level}"/></w:pPr>' if level else ''
    return f'<w:p>{style}<w:r><w:t>{text}</w:t></w:r></w:p>'


def test_extraction_preserves_revision_text_and_block_locators(tmp_path):
    docx = tmp_path / "S2-2606085.docx"
    make_docx(docx, '<w:p><w:r><w:t>Context </w:t></w:r><w:del><w:r><w:delText>old path</w:delText></w:r></w:del><w:ins><w:r><w:t>new path</w:t></w:r></w:ins></w:p><w:tbl><w:tr><w:tc><w:p><w:del><w:r><w:delText>old field</w:delText></w:r></w:del></w:p><w:p><w:r><w:t>next paragraph</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')
    texts = tmp_path / "texts"
    texts.mkdir()
    _, result = REVIEW.extract_docx(docx, texts, tmp_path / "figures")
    assert not result.startswith("ERROR")
    content = (texts / "S2-2606085.txt").read_text()
    assert "Context [DEL:old path][INS:new path]" in content
    assert "[BLOCK: 2 tbl]" in content
    assert "[DEL:old field]\nnext paragraph" in content


def coverage_setup(tmp_path, body):
    manifest = tmp_path / "proposals.json"
    excel = tmp_path / "index.xlsx"
    book = Workbook()
    sheet = book.active
    sheet.title = "TDocs"
    sheet.append(["TDoc", "Agenda Item", "Title", "Source", "Status"])
    sheet.append(["S2-2606085", "20.6.22", "Coordination", "Example", "available"])
    book.save(excel)
    REVIEW.cmd_filter(Namespace(excel=str(excel), sheet="TDocs", agenda="20.6.22", documents=["S2-2606085"], output=str(manifest)))
    texts = tmp_path / "texts"
    texts.mkdir()
    (texts / "S2-2606085.txt").write_text(body)
    return Namespace(manifest=str(manifest), texts=str(texts), receipt=str(tmp_path / "coverage.json"))


@pytest.mark.parametrize("body", ["", "  \n", "[SOURCE DOCX: /workspace/a.docx]\n[BLOCK: 1 p]\n[FIGURE: /workspace/a.png]\n"])
def test_coverage_rejects_empty_body_and_invalidates_old_receipt(tmp_path, body):
    args = coverage_setup(tmp_path, body)
    receipt = Path(args.receipt)
    receipt.write_text("stale success")
    with pytest.raises(SystemExit):
        REVIEW.cmd_coverage(args)
    assert not receipt.exists()


def test_coverage_binds_text_hash_and_rejects_duplicate_revisions(tmp_path):
    args = coverage_setup(tmp_path, "proposal text")
    REVIEW.cmd_coverage(args)
    receipt = Path(args.receipt)
    assert json.loads(receipt.read_text())["textFiles"][0]["sha256"] == hashlib.sha256(b"proposal text").hexdigest()
    (Path(args.texts) / "S2-2606085_rev2.txt").write_text("different text")
    with pytest.raises(SystemExit):
        REVIEW.cmd_coverage(args)
    assert not receipt.exists()


def test_split_keeps_parent_body_annex_and_all_package_parts(tmp_path):
    docx = tmp_path / "source.docx"
    body = paragraph("preface") + paragraph("1 Overview", 1) + paragraph("parent intro") + paragraph("1.1 Design", 2) + paragraph("section intro") + paragraph("1.1.1 Detail", 3) + paragraph("leaf body") + paragraph("1.1.1.1 More", 4) + paragraph("deep body")
    body += '<w:tbl><w:tr><w:tc>' + paragraph("table body") + '</w:tc></w:tr></w:tbl>'
    body += '<w:p><w:r><w:drawing r:id="rId1"/><w:object r:id="rId2"/></w:r></w:p>'
    body += paragraph("Annex A", 1) + paragraph("A.1 Appendix", 2) + paragraph("A.1.1 Detail", 3) + paragraph("annex body")
    make_docx(docx, body)
    original = docx.read_bytes()
    summary = SPLIT.split_docx(docx, 3)
    assert summary["sourceBlockCount"] == summary["assignedBlockCount"]
    assert summary["status"] == "passed"
    assert SPLIT.section_number("A.1.2 Annex heading") == "A.1.2"
    assert SPLIT.section_number("C.1 Heading") == "C.1"
    all_text = []
    source_parts = SPLIT.package_parts(docx)
    for item in summary["outputs"]:
        parts = SPLIT.package_parts(item["path"])
        assert {k: v for k, v in parts.items() if k != "word/document.xml"} == {k: v for k, v in source_parts.items() if k != "word/document.xml"}
        all_text.append(SPLIT.text(SPLIT.parse_xml(parts["word/document.xml"])))
    for text in ["preface", "parent intro", "section intro", "leaf body", "deep body", "table body", "annex body"]:
        assert sum(text in output for output in all_text) == 1
    assert docx.read_bytes() == original
    assert any("A_1_1" in item["path"] for item in summary["outputs"])
    second = SPLIT.split_docx(docx, 3)
    assert second["outputs"][0]["path"] != summary["outputs"][0]["path"]


def test_split_refuses_existing_output_and_missing_headings(tmp_path):
    docx = tmp_path / "source.docx"
    make_docx(docx, paragraph("plain text"))
    with pytest.raises(ValueError, match="标题"):
        SPLIT.split_docx(docx, 3)
    make_docx(docx, paragraph("1 Heading", 1))
    output = tmp_path / "existing"
    output.mkdir()
    with pytest.raises(FileExistsError):
        SPLIT.split_docx(docx, 1, output)


def test_batch_preserves_successes_and_namespaces_identical_filenames(tmp_path, monkeypatch):
    monkeypatch.setattr(REVIEW.shutil, "which", lambda _: None)
    files = []
    for name in ["one", "two"]:
        directory = tmp_path / name
        directory.mkdir()
        source = directory / "proposal.docx"
        make_docx(source, paragraph(name))
        files.append(str(source))
    files.append(str(tmp_path / "unsupported.pptx"))
    output = tmp_path / "converted"
    summary = REVIEW.convert_batch(files, output)
    assert summary["status"] == "partial"
    assert summary["successCount"] == 2
    assert summary["failureCount"] == 1
    assert len({item["archive"] for item in summary["results"] if item["status"] == "converted"}) == 2
    assert all(Path(item["archive"]).exists() for item in summary["results"] if item["status"] == "converted")
    assert json.loads((output / "batch-summary.json").read_text())["failureCount"] == 1
    with pytest.raises(FileExistsError):
        REVIEW.convert_batch(files, output)


def matrix_data():
    return {
        "scope": {"meeting": "Test meeting", "topic": "Request path", "snapshot": "2026-09-09"},
        "documents": [
            {"tdoc": "S2-2600001", "source": "Example", "path": "/workspace/a.txt"},
            {"tdoc": "S2-2600002", "source": "New Company", "path": "/workspace/b.txt"},
        ],
        "dimensions": [{"id": "path", "name": "请求路径", "options": ["NAS", "AF"], "exclusive": True}],
        "records": [{"company": "Example", "tdoc": "S2-2600001", "dimension": "path", "option": "NAS", "stance": "support", "strength": "explicit", "evidence": {"locator": "block 4", "text": "Use NAS"}}],
    }


def test_matrix_does_not_invent_opposition_or_fixed_company_lists():
    data = matrix_data()
    rendered = MATRIX.render(data)
    assert "| NAS | 支持 [E1] | 资料不足 |" in rendered
    assert "| AF | 资料不足 | 资料不足 |" in rendered
    assert "New Company" in rendered
    assert "Huawei" not in rendered
    assert "明确反对" not in rendered
    data["records"].append({**data["records"][0], "stance": "oppose", "evidence": {"locator": "block 5", "text": "Reject mandatory NAS"}})
    assert "存在不同主张" in MATRIX.render(data)


@pytest.mark.parametrize("update", [
    {"stance": "oppose", "strength": "strong"},
    {"evidence": {"locator": "", "text": ""}},
    {"company": "Unlisted Company"},
    {"tdoc": "S2-2600999"},
])
def test_matrix_rejects_unsupported_record_relationships(update):
    data = matrix_data()
    data["records"][0].update(update)
    with pytest.raises(ValueError):
        MATRIX.render(data)


def test_evolution_rejects_empty_or_out_of_ledger_evidence():
    event = {"company": "Example", "dimension": "NAS", "stance": "oppose", "strength": "explicit", "primaryOpponent": True, "evidence": {"tdoc": "S2-2600001", "locator": "", "text": ""}}
    result = EVOLUTION.validate_evidence({"documents": []}, [event])
    assert not result["valid"]
    assert len(result["errors"]) == 3


def test_agenda_filter_does_not_match_adjacent_ki_numbers(tmp_path):
    excel = tmp_path / "index.xlsx"
    book = Workbook()
    sheet = book.active
    sheet.append(["TDoc", "Agenda Item", "Title", "Source", "Status"])
    for tdoc, agenda in [("S2-2600001", "20.6.2"), ("S2-2600002", "20.6.22"), ("S2-2600003", "20.6.2.1")]:
        sheet.append([tdoc, agenda, "Title", "Example", "available"])
    book.save(excel)
    output = tmp_path / "proposals.json"
    REVIEW.cmd_filter(Namespace(excel=str(excel), sheet=None, agenda="20.6.2", documents=None, output=str(output)))
    assert [p["document"] for p in json.loads(output.read_text())["proposals"]] == ["S2-2600001", "S2-2600003"]
