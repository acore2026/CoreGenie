#!/usr/bin/env python3
"""Split DOCX body blocks while retaining original OPC parts and relationships."""

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import posixpath
import re
import tempfile
from urllib.parse import unquote
import zipfile

from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"w": W}
MAX_BYTES = 250 * 1024 * 1024


def parse_xml(data):
    return etree.fromstring(data, etree.XMLParser(resolve_entities=False, no_network=True))


def text(element):
    return "".join(element.xpath(".//w:t/text()", namespaces=NS)).strip()


def section_number(title):
    match = re.match(r"^(?:Annex\s+)?([A-Za-z](?:\.\d+)*|\d+(?:\.\d+)*)(?=\s|$)", title)
    return match.group(1) if match else None


def heading_level(element, styles):
    if element.tag != f"{{{W}}}p":
        return None
    properties = element.find("w:pPr", NS)
    visited = set()
    while properties is not None:
        outline = properties.find("w:outlineLvl", NS)
        if outline is not None:
            value = int(outline.get(f"{{{W}}}val", "9"))
            return value + 1 if 0 <= value < 9 else None
        style = properties.find("w:pStyle", NS)
        style_id = style.get(f"{{{W}}}val") if style is not None else None
        if not style_id or style_id in visited:
            return None
        visited.add(style_id)
        definition = styles.get(style_id)
        if definition is None:
            return None
        name = definition.find("w:name", NS)
        style_name = name.get(f"{{{W}}}val", "") if name is not None else style_id
        level = re.fullmatch(r"(?:Heading|标题)\s*([1-9])", style_name, re.I)
        properties = definition.find("w:pPr", NS)
        if properties is not None and properties.find("w:outlineLvl", NS) is not None:
            continue
        if level:
            return int(level.group(1))
        based = definition.find("w:basedOn", NS)
        if based is None:
            return None
        properties = etree.Element(f"{{{W}}}pPr")
        etree.SubElement(properties, f"{{{W}}}pStyle").set(f"{{{W}}}val", based.get(f"{{{W}}}val"))
    return None


def chunks_for(blocks, styles, level):
    chunks, ancestors = [], []
    current = {"title": "前言", "ancestors": [], "indices": []}
    for index, block in enumerate(blocks):
        depth = heading_level(block, styles)
        if depth is not None and depth <= level:
            if current["indices"]:
                chunks.append(current)
            ancestors = [(d, i) for d, i in ancestors if d < depth]
            current = {"title": text(block) or "未命名章节", "ancestors": [i for _, i in ancestors], "indices": []}
            ancestors.append((depth, index))
        current["indices"].append(index)
    if current["indices"]:
        chunks.append(current)
    if not ancestors:
        raise ValueError("未检测到符合所选级别的标题，请检查标题样式和拆分级别。")
    if [i for chunk in chunks for i in chunk["indices"]] != list(range(len(blocks))):
        raise ValueError("正文块分配检查失败。")
    return chunks


def package_parts(source):
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(names) != len(set(names)) or sum(e.file_size for e in entries) > MAX_BYTES:
            raise ValueError("DOCX 包含重复部件或解压后超过 250 MiB。")
        if any(n.startswith("/") or ".." in n.split("/") for n in names):
            raise ValueError("DOCX 部件路径无效。")
        return {e.filename: archive.read(e) for e in entries if not e.is_dir()}


def validate_relationships(parts):
    for name, content in parts.items():
        if not name.endswith(".rels"):
            continue
        base = posixpath.dirname(posixpath.dirname(name))
        for relation in parse_xml(content):
            if relation.get("TargetMode") == "External":
                continue
            target = unquote(relation.get("Target", "").split("#", 1)[0])
            resolved = posixpath.normpath(posixpath.join(base, target)) if not target.startswith("/") else target.lstrip("/")
            if resolved not in parts:
                raise ValueError(f"DOCX 关系指向不存在的部件：{name} → {target}")
    rels = parse_xml(parts.get("word/_rels/document.xml.rels", b'<Relationships/>'))
    ids = {rel.get("Id") for rel in rels}
    for node in parse_xml(parts["word/document.xml"]).iter():
        for attribute, value in node.attrib.items():
            if attribute.startswith(f"{{{R}}}") and value not in ids:
                raise ValueError(f"正文引用了不存在的关系：{value}")


def split_docx(source, level, output=None):
    source = Path(source).resolve()
    if source.suffix.lower() != ".docx" or level not in (1, 2, 3):
        raise ValueError("请提供 DOCX 文件和 1、2 或 3 级标题。")
    parts = package_parts(source)
    if "word/document.xml" not in parts or "[Content_Types].xml" not in parts:
        raise ValueError("文件不是有效的 DOCX 包。")
    validate_relationships(parts)
    document = parse_xml(parts["word/document.xml"])
    body = document.find("w:body", NS)
    if body is None:
        raise ValueError("DOCX 缺少正文。")
    blocks = [child for child in body if child.tag != f"{{{W}}}sectPr"]
    styles_root = parse_xml(parts.get("word/styles.xml", f'<w:styles xmlns:w="{W}"/>'.encode()))
    styles = {node.get(f"{{{W}}}styleId"): node for node in styles_root}
    chunks = chunks_for(blocks, styles, level)
    # Section properties describe preceding content, including across split points.
    sections = [(i, node.find("w:pPr/w:sectPr", NS)) for i, node in enumerate(blocks)]
    sections = [(i, node) for i, node in sections if node is not None]
    sections.append((len(blocks), body.find("w:sectPr", NS)))
    if output is None:
        output = Path(tempfile.mkdtemp(prefix=f"{source.stem}-split-", dir=source.parent))
    else:
        output = Path(output).resolve()
        output.mkdir(parents=True, exist_ok=False)
    warnings = [
        "输出保留原包的全部辅助部件，可能含当前章节未引用的媒体、批注和脚注；不适合用于删除敏感内容。",
        "独立文档的页码、目录、跨章节引用和自动编号可能需要更新；未自动验证视觉排版。",
    ]
    results = []
    for sequence, chunk in enumerate(chunks, 1):
        root = deepcopy(document)
        new_body = root.find("w:body", NS)
        for child in list(new_body):
            new_body.remove(child)
        chosen = chunk["ancestors"] + chunk["indices"]
        for index in chosen:
            element = deepcopy(blocks[index])
            if index in chunk["ancestors"]:
                for section in element.findall("w:pPr/w:sectPr", NS):
                    section.getparent().remove(section)
            new_body.append(element)
        terminal = next(node for i, node in sections if i >= chunk["indices"][-1])
        if terminal is not None:
            new_body.append(deepcopy(terminal))
        slug = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", chunk["title"]).strip(" .")[:80] or "章节"
        number = (section_number(chunk["title"]) or "0").replace(".", "_")
        destination = output / f"{sequence:04d}_{number}_{slug}.docx"
        new_parts = {**parts, "word/document.xml": etree.tostring(root, encoding="UTF-8", xml_declaration=True, standalone=True)}
        validate_relationships(new_parts)
        with zipfile.ZipFile(destination, "x", zipfile.ZIP_DEFLATED) as archive:
            for name, data in new_parts.items():
                archive.writestr(name, data)
        saved = package_parts(destination)
        validate_relationships(saved)
        saved_body = parse_xml(saved["word/document.xml"]).find("w:body", NS)
        actual = [e for e in saved_body if e.tag != f"{{{W}}}sectPr"]
        if len(actual) != len(chosen) or any(
            etree.tostring(a, method="c14n") != etree.tostring(b, method="c14n")
            for a, b in zip(actual[len(chunk["ancestors"]):], [blocks[i] for i in chunk["indices"]])
        ):
            raise ValueError(f"保存后的正文与原件不一致：{destination.name}")
        results.append({"path": str(destination), "title": chunk["title"], "sourceBlocks": chunk["indices"], "ancestorBlocks": chunk["ancestors"], "tables": len(new_body.findall(".//w:tbl", NS))})
    summary = {"schema": "3gpp-split-docx/v1", "status": "passed", "source": str(source), "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "level": level, "sourceBlockCount": len(blocks), "assignedBlockCount": sum(len(c["indices"]) for c in chunks), "outputCount": len(results), "outputs": results, "warnings": warnings, "createdAt": datetime.now(timezone.utc).isoformat()}
    (output / "split-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--level", type=int, choices=(1, 2, 3), required=True)
    parser.add_argument("--output")
    args = parser.parse_args()
    try:
        result = split_docx(args.input, args.level, args.output)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, etree.XMLSyntaxError) as error:
        raise SystemExit(f"拆分失败：{error}") from error
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
