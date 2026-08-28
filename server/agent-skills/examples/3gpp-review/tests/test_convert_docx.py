import importlib.util
import json
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / "scripts" / "3gpp_tdocs.py"
SPEC = importlib.util.spec_from_file_location("threegpp_tdocs", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


DOCUMENT_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
 <w:body>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Test proposal</w:t></w:r></w:p>
  <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:t> text</w:t></w:r>
   <w:hyperlink r:id="rIdLink"><w:r><w:t>source</w:t></w:r></w:hyperlink></w:p>
  <w:p><w:r><w:drawing><a:blip r:embed="rIdImage"/></w:drawing></w:r></w:p>
  <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc></w:tr>
   <w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
 </w:body>
</w:document>"""

RELS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
 <Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.3gpp.org/" TargetMode="External"/>
 <Relationship Id="rIdObject" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/object1.bin"/>
</Relationships>"""

STYLES_XML = """<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
 <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
</w:styles>"""


def make_docx(path, document=DOCUMENT_XML, relationships=RELS_XML):
    with zipfile.ZipFile(path, "w") as package:
        package.writestr("[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>")
        package.writestr("word/document.xml", document)
        package.writestr("word/_rels/document.xml.rels", relationships)
        package.writestr("word/styles.xml", STYLES_XML)
        package.writestr("word/media/image1.png", b"\x89PNG\r\n\x1a\nfixture")
        package.writestr("word/embeddings/object1.bin", b"embedded")


class ConvertDocxTest(unittest.TestCase):
    def test_converts_structure_and_builds_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "S2-2600001.docx"
            output = root / "result"
            make_docx(source)

            with patch.object(MODULE.shutil, "which", return_value=None):
                summary = MODULE.convert_docx_to_markdown(source, output)
            markdown = (output / "S2-2600001.md").read_text(encoding="utf-8")

            self.assertIn("# Test proposal", markdown)
            self.assertIn("**Bold** text[source](https://www.3gpp.org/)", markdown)
            self.assertIn("![文档图片](assets/image1.png)", markdown)
            self.assertIn("| Item | Value |", markdown)
            self.assertEqual(summary["images"], ["assets/image1.png"])
            self.assertEqual(summary["embedded"], ["embedded/object1.bin"])
            self.assertEqual(summary["engine"], "legacy-ooxml")
            self.assertTrue(
                any("没有安装 Pandoc" in warning for warning in summary["warnings"])
            )
            self.assertTrue((root / "result.zip").is_file())
            with zipfile.ZipFile(root / "result.zip") as archive:
                self.assertIn("S2-2600001.md", archive.namelist())
                self.assertIn("assets/image1.png", archive.namelist())
                self.assertIn("conversion-summary.json", archive.namelist())
            saved = json.loads((output / "conversion-summary.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["schema"], MODULE.CONVERSION_SCHEMA)

    def test_reports_broken_image_reference(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "broken.docx"
            make_docx(
                source,
                relationships=RELS_XML.replace(
                    "media/image1.png", "media/missing.png"
                ),
            )
            with patch.object(MODULE.shutil, "which", return_value=None):
                summary = MODULE.convert_docx_to_markdown(source, root / "result")
            self.assertTrue(any("不存在" in warning for warning in summary["warnings"]))

    def test_uses_pandoc_for_lists_and_keeps_the_3gpp_package(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "S2-2600002.docx"
            output = root / "result"
            make_docx(source)
            calls = []

            def fake_pandoc(command, **options):
                calls.append((command, options))
                working_directory = Path(options["cwd"])
                (working_directory / "assets" / "media").mkdir(parents=True)
                (working_directory / "assets" / "media" / "image1.png").write_bytes(
                    b"image"
                )
                (working_directory / "S2-2600002.md").write_text(
                    "# Procedure\n\n1.  First step\n\n2\\.    Second step\n\n3\\. Third step\n",
                    encoding="utf-8",
                )
                return subprocess.CompletedProcess(command, 0, "", "")

            with (
                patch.object(
                    MODULE.shutil,
                    "which",
                    side_effect=lambda name: "/usr/bin/pandoc"
                    if name == "pandoc"
                    else None,
                ),
                patch.object(MODULE.subprocess, "run", side_effect=fake_pandoc),
            ):
                summary = MODULE.convert_docx_to_markdown(source, output)

            markdown = (output / "S2-2600002.md").read_text(encoding="utf-8")
            self.assertEqual(summary["engine"], "pandoc")
            self.assertIn(
                "1.  First step\n2.  Second step\n3.  Third step", markdown
            )
            self.assertNotIn("2\\.", markdown)
            self.assertNotIn("- First step", markdown)
            self.assertEqual(summary["images"], ["assets/media/image1.png"])
            self.assertEqual(summary["embedded"], ["embedded/object1.bin"])
            self.assertEqual(len(calls), 1)
            self.assertIn("--from=docx", calls[0][0])
            self.assertIn("--to=gfm", calls[0][0])
            self.assertIn("--extract-media=assets", calls[0][0])
            with zipfile.ZipFile(root / "result.zip") as archive:
                self.assertIn("S2-2600002.md", archive.namelist())
                self.assertIn("assets/media/image1.png", archive.namelist())
                self.assertIn("embedded/object1.bin", archive.namelist())

    def test_rejects_non_docx_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "invalid.docx"
            source.write_bytes(b"not a zip")
            with self.assertRaises(zipfile.BadZipFile):
                MODULE.convert_docx_to_markdown(source, root / "result")


if __name__ == "__main__":
    unittest.main()
