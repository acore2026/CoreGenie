#!/usr/bin/env python3
"""Validate stance records and render a matrix without inventing opposite stances."""
import argparse
import json
from pathlib import Path

LABELS = {"support": "支持", "oppose": "明确反对", "concern": "保留意见", "alternative": "替代方案", "neutral": "中性说明"}


def validate(data):
    if not isinstance(data, dict):
        raise ValueError("立场记录必须是 JSON 对象。")
    scope = data.get("scope")
    if not isinstance(scope, dict) or any(not str(scope.get(k) or "").strip() for k in ("meeting", "topic", "snapshot")):
        raise ValueError("缺少会议、主题或资料快照时间。")
    documents = data.get("documents")
    dimensions = data.get("dimensions")
    records = data.get("records")
    if not isinstance(documents, list) or not documents or not isinstance(dimensions, list) or not dimensions or not isinstance(records, list):
        raise ValueError("需要文档列表、技术维度和立场记录列表。")
    docs, dims, companies = {}, {}, []
    for document in documents:
        if not isinstance(document, dict) or any(not isinstance(document.get(k), str) or not document[k].strip() for k in ("tdoc", "source", "path")):
            raise ValueError("每份文档需要 TDoc、Source 和原文路径。")
        if document["tdoc"] in docs:
            raise ValueError("同一矩阵不能重复或混合 TDoc 版本。")
        docs[document["tdoc"]] = document
        # Sources may be joint submissions. Explicit author arrays prevent guessing aliases.
        authors = document.get("companies", [document["source"]])
        if not isinstance(authors, list) or not authors or any(not isinstance(a, str) or not a.strip() for a in authors):
            raise ValueError("companies 必须是从原文确认的署名公司列表。")
        for company in authors:
            if company not in companies:
                companies.append(company)
    for dimension in dimensions:
        if not isinstance(dimension, dict) or not dimension.get("id") or not dimension.get("name"):
            raise ValueError("维度需要 id 和名称。")
        options = dimension.get("options")
        if not isinstance(options, list) or not options or any(not isinstance(o, str) or not o.strip() for o in options) or len(set(options)) != len(options):
            raise ValueError("维度需要非空、不重复的选项。")
        if dimension["id"] in dims:
            raise ValueError("维度 id 重复。")
        dims[dimension["id"]] = dimension
    for index, record in enumerate(records, 1):
        if not isinstance(record, dict):
            raise ValueError(f"记录 {index} 必须是对象。")
        document = docs.get(record.get("tdoc"))
        dimension = dims.get(record.get("dimension"))
        if not document or not dimension or record.get("option") not in dimension["options"]:
            raise ValueError(f"记录 {index} 引用了未定义的文档、维度或选项。")
        if record.get("company") not in document.get("companies", [document["source"]]):
            raise ValueError(f"记录 {index} 的公司不是该文档中确认的署名方。")
        stance, strength = record.get("stance"), record.get("strength")
        if stance not in LABELS or strength not in ("explicit", "strong", "weak"):
            raise ValueError(f"记录 {index} 的立场或证据强度无效。")
        if stance == "oppose" and strength != "explicit":
            raise ValueError(f"记录 {index}：反对需要明确证据。")
        evidence = record.get("evidence")
        if not isinstance(evidence, dict) or any(not isinstance(evidence.get(k), str) or not evidence[k].strip() for k in ("locator", "text")):
            raise ValueError(f"记录 {index} 缺少原文位置或依据。")
    return companies


def cell(value):
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("|", "&#124;").replace("\n", " ")


def render(data):
    companies = validate(data)
    scope = data["scope"]
    records = data["records"]
    lines = [f"# {cell(scope['meeting'])} {cell(scope['topic'])} 公司特性矩阵", "", f"资料快照：{cell(scope['snapshot'])}", "", "矩阵按已记录的具体主张展示；未找到记录表示资料不足，不表示反对。记录格式检查不能代替原文与结论的一致性检查。", ""]
    for dimension in data["dimensions"]:
        lines.extend([f"## {cell(dimension['name'])}", "", "| 选项 | " + " | ".join(map(cell, companies)) + " |", "| --- | " + " | ".join("---" for _ in companies) + " |"])
        for option in dimension["options"]:
            values = []
            for company in companies:
                matches = [(i, r) for i, r in enumerate(records, 1) if r["company"] == company and r["dimension"] == dimension["id"] and r["option"] == option]
                stances = {r["stance"] for _, r in matches}
                prefix = "存在不同主张：" if "support" in stances and "oppose" in stances else ""
                values.append(prefix + "；".join(f"{LABELS[r['stance']]} [E{i}]" for i, r in matches) if matches else "资料不足")
            lines.append("| " + cell(option) + " | " + " | ".join(values) + " |")
        lines.append("")
    lines.extend(["## 判断依据", ""])
    for index, record in enumerate(records, 1):
        evidence = record["evidence"]
        lines.append(f"- E{index}：{cell(record['company'])}，{cell(record['tdoc'])}，{cell(evidence['locator'])}：{cell(evidence['text'])}")
    lines.extend(["", "## 参考资料", ""])
    for document in data["documents"]:
        lines.append(f"- {cell(document['tdoc'])}：{cell(document['source'])}；原文：{cell(document['path'])}")
    if data.get("failures"):
        lines.extend(["", "## 缺失资料", "", *(f"- {cell(item)}" for item in data["failures"])])
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        content = render(json.loads(Path(args.input).read_text(encoding="utf-8")))
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("x", encoding="utf-8") as target:
            target.write(content)
    except (OSError, ValueError, TypeError) as error:
        raise SystemExit(f"矩阵生成失败：{error}") from error
    print(str(output.resolve()))


if __name__ == "__main__":
    main()
