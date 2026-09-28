"""Prepare conservative relation candidates; semantic conclusions need source review."""

import argparse
import json
import re
from pathlib import Path

TDOC = r"[A-Z]\d-\s*\d{7}"
RULES = (
    ("revision", rf"revision\s+of\s*(?:\(Unhandled\)\s*)?({TDOC})", True),
    ("revision", rf"revised\b[^.;\n]*?\bto\s+({TDOC})", False),
    ("merged_into", rf"merge(?:d)?\s+into\s+({TDOC})", False),
    ("based_on", rf"based\s+on\s+({TDOC})", True),
    ("resubmission", rf"resubmission\s+of\s+({TDOC})", True),
)


def tdoc(value):
    value = re.sub(r"\s", "", str(value).upper())
    if not re.fullmatch(TDOC, value):
        raise ValueError(f"Invalid TDoc: {value}")
    return value


def documents(rows, meeting):
    if not isinstance(rows, list):
        raise ValueError("Manifest must be a JSON array")
    result = {}
    for row in rows:
        key = tdoc(row["tdoc"])
        if key in result:
            raise ValueError(f"Duplicate TDoc in {meeting}: {key}")
        result[key] = {**row, "tdoc": key, "meeting": meeting}
    return result


def relations(doc):
    # Explicit source records may come from the review extractor. Never scan a
    # flattened tracked-changes document as though deleted text were current.
    sources = [{"text": doc.get("comments", ""), "locator": "manifest.comments"}]
    sources += doc.get("relationEvidence", [])
    for source in sources:
        for kind, pattern, reverse in RULES:
            for match in re.finditer(pattern, source["text"], re.I):
                other = tdoc(match.group(1))
                start, end = (other, doc["tdoc"]) if reverse else (doc["tdoc"], other)
                if start != end:
                    yield {"from": start, "to": end, "type": kind,
                           "confidence": "explicit", "evidence": {
                               "tdoc": doc["tdoc"], "locator": source["locator"],
                               "text": match.group(0)}}


def topics(doc):
    clauses = doc.get("clauses", [])
    if clauses:
        return {".".join(str(c).split(".")[:3]) for c in clauses}
    # Title tokens are deliberately weaker than actual changed clauses.
    return {"6." + v for v in re.findall(r"\b(\d+\.\d+)(?:\.\d+)*", doc.get("title", ""))}


def compatible(left, right):
    return all(not left.get(k) or not right.get(k) or
               str(left[k]).casefold() == str(right[k]).casefold()
               for k in ("spec", "wi", "rel", "workingGroup"))


def build(previous, current):
    old = documents(previous, "previous")
    new = documents(current, "next")
    if old.keys() & new.keys():
        raise ValueError("TDoc occurs in both meetings; resolve meeting membership first")
    docs = {**old, **new}
    edges = []
    for doc in docs.values():
        for edge in relations(doc):
            if edge not in edges:
                edges.append(edge)
    warnings = []
    for edge in edges:
        for key in (edge["from"], edge["to"]):
            if key not in docs:
                warnings.append(f"Missing referenced document: {key}")
        if edge["from"] in new and edge["to"] in old:
            warnings.append(f"Reverse meeting relation: {edge['from']} -> {edge['to']}")

    # Only same-meeting revision edges group tasks. Merge inputs remain distinct.
    adjacency = {key: set() for key in new}
    successors = {key: set() for key in new}
    for edge in edges:
        a, b = edge["from"], edge["to"]
        if edge["type"] == "revision" and a in new and b in new:
            adjacency[a].add(b)
            adjacency[b].add(a)
            successors[a].add(b)
    tasks, remaining = [], set(new)
    while remaining:
        pending, component = [min(remaining)], set()
        while pending:
            key = pending.pop()
            if key in component:
                continue
            component.add(key)
            pending.extend(adjacency[key] - component)
        remaining -= component
        indegree = {key: 0 for key in component}
        for key in component:
            for target in successors[key]:
                indegree[target] += 1
        ready = sorted(key for key, degree in indegree.items() if not degree)
        ordered = []
        while ready:
            key = ready.pop(0)
            ordered.append(key)
            for target in sorted(successors[key]):
                indegree[target] -= 1
                if not indegree[target]:
                    ready.append(target)
        cycle = len(ordered) != len(component)
        if cycle:
            warnings.append(f"Revision cycle: {','.join(sorted(component))}")
        candidates = []
        for key in sorted(component):
            for prior, doc in old.items():
                explicit = [e for e in edges if e["from"] == prior and e["to"] == key]
                shared = sorted(topics(doc) & topics(new[key]))
                if explicit or (shared and compatible(doc, new[key])):
                    candidates.append({"previous": prior, "next": key,
                                       "confidence": "explicit" if explicit else "topic_candidate",
                                       "relations": explicit, "sharedTopics": shared})
        tasks.append({"id": min(component), "current": ordered if not cycle else sorted(component),
                      "status": "needs_review" if cycle else "pending",
                      "previousCandidates": candidates,
                      "novelty": "unmatched_in_supplied_sources" if not candidates else "needs_content_review"})
    return {"schemaVersion": 1, "documents": list(docs.values()), "relations": edges,
            "tasks": tasks, "warnings": sorted(set(warnings)),
            "note": "Candidate retrieval only; no match does not prove a new proposal."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--previous", required=True)
    parser.add_argument("--next", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = build(json.loads(Path(args.previous).read_text(encoding="utf-8-sig")),
                   json.loads(Path(args.next).read_text(encoding="utf-8-sig")))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main()
