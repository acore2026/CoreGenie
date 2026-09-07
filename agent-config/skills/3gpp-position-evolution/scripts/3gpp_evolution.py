#!/usr/bin/env python3
"""Deterministic evidence ledger utilities for 3GPP longitudinal studies."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


TDOC_RE = re.compile(r"\b([A-Z]\d-\d{6,8})\b", re.IGNORECASE)
RELATION_TYPES = {
    "revises",
    "revised_to",
    "merged_into",
    "supersedes",
    "alternative_to",
    "supports",
    "objects_to",
    "contributes_to_baseline",
    "approved_as",
}
STANCE_TYPES = {"support", "oppose", "concern", "alternative", "neutral"}
STRENGTH_TYPES = {"explicit", "strong", "weak"}

STATUS_SEMANTICS = {
    "available": {
        "disposition": "submitted",
        "rejected": False,
        "provisional": True,
    },
    "not_handled": {
        "disposition": "unresolved",
        "rejected": False,
        "provisional": True,
    },
    "postponed": {
        "disposition": "deferred",
        "rejected": False,
        "provisional": True,
    },
    "revised": {
        "disposition": "superseded_or_reworked",
        "rejected": False,
        "provisional": True,
    },
    "merged": {
        "disposition": "incorporated",
        "rejected": False,
        "provisional": True,
    },
    "withdrawn": {
        "disposition": "withdrawn_by_source",
        "rejected": False,
        "provisional": False,
    },
    "baseline": {
        "disposition": "draft_baseline",
        "rejected": False,
        "provisional": True,
    },
    "approved": {
        "disposition": "accepted",
        "rejected": False,
        "provisional": False,
    },
    "rejected": {
        "disposition": "rejected",
        "rejected": True,
        "provisional": False,
    },
    "unknown": {
        "disposition": "unknown",
        "rejected": False,
        "provisional": True,
    },
}


def now_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def read_json(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path: str | Path, value: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def read_jsonl(path: str | Path) -> list[dict[str, Any]]:
    values = []
    for line_number, raw in enumerate(
        Path(path).read_text(encoding="utf-8").splitlines(), start=1
    ):
        text = raw.strip()
        if not text or text.startswith("#"):
            continue
        try:
            value = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path}:{line_number}: invalid JSON: {exc}") from exc
        if not isinstance(value, dict):
            raise ValueError(f"{path}:{line_number}: each JSONL row must be an object")
        value["_line"] = line_number
        values.append(value)
    return values


def normalize_tdoc(value: Any) -> str | None:
    match = TDOC_RE.search(str(value or ""))
    return match.group(1).upper() if match else None


def normalize_status(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip()).casefold()
    if not text:
        return "unknown"
    if "not handled" in text or "not-handled" in text:
        return "not_handled"
    if "postpon" in text:
        return "postponed"
    if "withdraw" in text:
        return "withdrawn"
    if "merged" in text or "merge into" in text:
        return "merged"
    if "revis" in text:
        return "revised"
    if "reject" in text:
        return "rejected"
    if "approv" in text or "agreed" in text:
        return "approved"
    if "baseline" in text:
        return "baseline"
    if "available" in text or "submitted" in text:
        return "available"
    return "unknown"


def split_sources(value: Any) -> list[str]:
    if isinstance(value, list):
        parts = value
    else:
        parts = re.split(r"\s*(?:;|,|\+|\s/\s)\s*", str(value or ""))
    result = []
    seen = set()
    for part in parts:
        name = re.sub(r"\s+", " ", str(part).strip())
        if not name or name.casefold() in seen:
            continue
        seen.add(name.casefold())
        result.append(name)
    return result


def target_company(scope: dict[str, Any]) -> tuple[str, set[str]]:
    company = scope.get("company") or scope.get("targetCompany") or {}
    if isinstance(company, str):
        canonical = company.strip()
        aliases = [canonical]
    else:
        canonical = str(company.get("canonical") or company.get("name") or "").strip()
        aliases = company.get("aliases") or []
        aliases = [canonical, *aliases]
    normalized = {str(value).strip().casefold() for value in aliases if str(value).strip()}
    if not canonical:
        raise ValueError("scope.company.canonical is required")
    return canonical, normalized


def authorship_role(sources: list[str], aliases: set[str]) -> str:
    target = [source for source in sources if source.casefold() in aliases]
    if not target:
        return "context"
    external = [source for source in sources if source.casefold() not in aliases]
    return "target_cosigned" if external else "target_authored"


def relation_from_value(kind: str, value: Any, evidence: Any = None) -> dict | None:
    target = normalize_tdoc(value)
    if not target:
        return None
    relation = {"type": kind, "target": target}
    if evidence:
        relation["evidence"] = evidence
    return relation


def extract_relations(item: dict[str, Any]) -> list[dict[str, Any]]:
    values = []
    explicit = item.get("relations") or []
    if isinstance(explicit, dict):
        explicit = [explicit]
    for relation in explicit:
        if not isinstance(relation, dict):
            continue
        kind = str(relation.get("type") or "").strip()
        if kind not in RELATION_TYPES:
            continue
        normalized = relation_from_value(
            kind,
            relation.get("target"),
            relation.get("evidence") or relation.get("evidenceSource"),
        )
        if normalized:
            values.append(normalized)

    field_types = {
        "revision_of": "revises",
        "revises": "revises",
        "revised_to": "revised_to",
        "merged_into": "merged_into",
        "supersedes": "supersedes",
        "alternative_to": "alternative_to",
        "approved_as": "approved_as",
    }
    for field, kind in field_types.items():
        raw = item.get(field)
        if not raw:
            continue
        for target in raw if isinstance(raw, list) else [raw]:
            normalized = relation_from_value(kind, target, "manifest")
            if normalized:
                values.append(normalized)

    unique = []
    seen = set()
    for relation in values:
        key = (relation["type"], relation["target"])
        if key not in seen:
            seen.add(key)
            unique.append(relation)
    return unique


def status_relations(raw_status: str, status: str) -> list[dict[str, Any]]:
    kind = {"merged": "merged_into", "revised": "revised_to"}.get(status)
    if not kind:
        return []
    return [
        {
            "type": kind,
            "target": match.group(1).upper(),
            "evidence": f"meeting-index status: {raw_status}",
        }
        for match in TDOC_RE.finditer(raw_status)
    ]


def merge_relations(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    seen = set()
    for relation in (item for group in groups for item in group):
        key = (relation["type"], relation["target"])
        if key in seen:
            continue
        seen.add(key)
        result.append(relation)
    return result


def proposal_items(manifest: Any) -> list[dict[str, Any]]:
    if isinstance(manifest, list):
        values = manifest
    elif isinstance(manifest, dict):
        values = manifest.get("proposals") or manifest.get("documents") or []
    else:
        values = []
    if not isinstance(values, list):
        raise ValueError("manifest proposals/documents must be a list")
    return [value for value in values if isinstance(value, dict)]


def parse_meeting_manifest(value: str) -> tuple[str, Path]:
    if "=" not in value:
        raise ValueError("--meeting-manifest must use MEETING=/path/to/manifest.json")
    meeting, path = value.split("=", 1)
    meeting = meeting.strip()
    if not meeting or not path.strip():
        raise ValueError("--meeting-manifest requires both meeting and path")
    return meeting, Path(path.strip())


def build_ledger(scope_path: str, manifest_specs: list[str]) -> dict[str, Any]:
    scope = read_json(scope_path)
    if not isinstance(scope, dict):
        raise ValueError("scope must be a JSON object")
    canonical, aliases = target_company(scope)
    documents = []
    seen = {}
    meetings = []

    for meeting_order, spec in enumerate(manifest_specs):
        meeting, manifest_path = parse_meeting_manifest(spec)
        manifest = read_json(manifest_path)
        items = proposal_items(manifest)
        meetings.append(
            {
                "meeting": meeting,
                "order": meeting_order,
                "manifest": str(manifest_path),
                "documentCount": len(items),
            }
        )
        for item_order, item in enumerate(items):
            tdoc = normalize_tdoc(
                item.get("document")
                or item.get("tdoc")
                or item.get("documentNumber")
            )
            if not tdoc:
                raise ValueError(f"{manifest_path}: proposal row has no valid TDoc: {item}")
            if tdoc in seen:
                raise ValueError(
                    f"duplicate {tdoc} in {manifest_path}; first seen in {seen[tdoc]}"
                )
            seen[tdoc] = meeting
            sources = split_sources(item.get("source") or item.get("sources"))
            raw_status = str(item.get("status") or item.get("availability") or "").strip()
            status = normalize_status(raw_status)
            documents.append(
                {
                    "tdoc": tdoc,
                    "meeting": meeting,
                    "meetingOrder": meeting_order,
                    "documentOrder": item_order,
                    "title": str(item.get("title") or item.get("subject") or "").strip(),
                    "sources": sources,
                    "role": authorship_role(sources, aliases),
                    "agenda": str(item.get("agenda") or item.get("agendaItem") or "").strip(),
                    "statusRaw": raw_status,
                    "status": status,
                    "statusSemantics": STATUS_SEMANTICS[status],
                    "relations": merge_relations(
                        extract_relations(item), status_relations(raw_status, status)
                    ),
                    "manifest": str(manifest_path),
                }
            )

    return {
        "schemaVersion": 1,
        "generatedAt": now_utc(),
        "scope": scope,
        "targetCompany": {"canonical": canonical, "aliases": sorted(aliases)},
        "meetings": meetings,
        "documents": documents,
    }


def text_files_by_tdoc(directory: str | Path) -> dict[str, Path]:
    result = {}
    root = Path(directory)
    if not root.exists():
        return result
    for path in sorted(root.rglob("*.txt")):
        tdoc = normalize_tdoc(path.name)
        if tdoc and tdoc not in result:
            result[tdoc] = path
    return result


def normalize_terms(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        value = value.get("terms") or []
    if not isinstance(value, list):
        raise ValueError("terms must be a list or an object containing a terms list")
    result = []
    for item in value:
        if isinstance(item, str):
            canonical, variants = item, [item]
        elif isinstance(item, dict):
            canonical = str(item.get("canonical") or "").strip()
            variants = item.get("variants") or [canonical]
        else:
            continue
        variants = [str(part).strip() for part in variants if str(part).strip()]
        if canonical and variants:
            result.append({"canonical": canonical, "variants": variants})
    return result


def build_term_timeline(ledger: dict, texts: str, terms: Any) -> dict:
    files = text_files_by_tdoc(texts)
    normalized_terms = normalize_terms(terms)
    output = []
    for term in normalized_terms:
        occurrences = []
        for document in ledger.get("documents", []):
            tdoc = document.get("tdoc")
            path = files.get(tdoc)
            if not path:
                continue
            content = path.read_text(encoding="utf-8", errors="replace").casefold()
            counts = {
                variant: content.count(variant.casefold())
                for variant in term["variants"]
                if variant and variant.casefold() in content
            }
            if counts:
                occurrences.append(
                    {
                        "meeting": document.get("meeting"),
                        "tdoc": tdoc,
                        "counts": counts,
                    }
                )
        output.append(
            {
                **term,
                "firstSeen": occurrences[0] if occurrences else None,
                "lastSeen": occurrences[-1] if occurrences else None,
                "occurrences": occurrences,
            }
        )
    return {
        "schemaVersion": 1,
        "generatedAt": now_utc(),
        "note": "Occurrences do not by themselves prove a rename or semantic replacement.",
        "terms": output,
    }


def validate_evidence(
    ledger: dict, events: list[dict[str, Any]], texts: str | None = None
) -> dict[str, Any]:
    errors = []
    warnings = []
    documents = ledger.get("documents") or []
    known = {item.get("tdoc") for item in documents}

    for document in documents:
        tdoc = document.get("tdoc") or "<unknown>"
        status = document.get("status")
        if status not in STATUS_SEMANTICS:
            errors.append(f"{tdoc}: unsupported normalized status {status!r}")
        if status == "unknown":
            warnings.append(f"{tdoc}: status is unknown; do not infer an outcome")
        for relation in document.get("relations") or []:
            kind = relation.get("type")
            target = relation.get("target")
            if kind not in RELATION_TYPES:
                errors.append(f"{tdoc}: unsupported relation type {kind!r}")
            if not normalize_tdoc(target):
                errors.append(f"{tdoc}: invalid relation target {target!r}")
            elif target not in known:
                warnings.append(f"{tdoc}: relation target {target} is outside this ledger")
            if kind in {"objects_to", "supports", "alternative_to"} and not relation.get(
                "evidence"
            ):
                warnings.append(f"{tdoc}: {kind} relation has no evidence locator")

    for event in events:
        line = event.get("_line", "?")
        prefix = f"event line {line}"
        stance = event.get("stance")
        strength = event.get("strength")
        evidence = event.get("evidence")
        if not str(event.get("company") or "").strip():
            errors.append(f"{prefix}: company is required")
        if not str(event.get("dimension") or "").strip():
            errors.append(f"{prefix}: dimension is required")
        if stance not in STANCE_TYPES:
            errors.append(f"{prefix}: unsupported stance {stance!r}")
        if strength not in STRENGTH_TYPES:
            errors.append(f"{prefix}: unsupported strength {strength!r}")
        if stance == "oppose" and strength != "explicit":
            errors.append(
                f"{prefix}: oppose requires explicit evidence; use concern or alternative otherwise"
            )
        if event.get("primaryOpponent") and not (
            stance == "oppose" and strength == "explicit"
        ):
            errors.append(
                f"{prefix}: primaryOpponent requires explicit opposition evidence"
            )
        if not isinstance(evidence, dict):
            errors.append(f"{prefix}: evidence object is required")
            continue
        tdoc = normalize_tdoc(evidence.get("tdoc"))
        if not tdoc:
            errors.append(f"{prefix}: evidence.tdoc is invalid")
        elif tdoc not in known:
            warnings.append(f"{prefix}: evidence TDoc {tdoc} is outside this ledger")
        if not str(evidence.get("locator") or "").strip():
            warnings.append(f"{prefix}: evidence locator is missing")
        evidence_text = str(evidence.get("text") or "")
        if len(evidence_text) > 500:
            warnings.append(f"{prefix}: evidence text exceeds 500 characters; shorten it")

    coverage = None
    if texts:
        extracted = text_files_by_tdoc(texts)
        expected = set(known)
        coverage = {
            "expected": len(expected),
            "extracted": len(expected & set(extracted)),
            "missing": sorted(expected - set(extracted)),
            "extra": sorted(set(extracted) - expected),
        }
        if coverage["missing"]:
            warnings.append(
                f"{len(coverage['missing'])} ledger TDocs have no extracted text"
            )

    return {
        "schemaVersion": 1,
        "validatedAt": now_utc(),
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "coverage": coverage,
        "counts": {
            "meetings": len(ledger.get("meetings") or []),
            "documents": len(documents),
            "events": len(events),
            "primaryOppositionEvents": sum(
                1
                for event in events
                if event.get("primaryOpponent")
                and event.get("stance") == "oppose"
                and event.get("strength") == "explicit"
            ),
        },
    }


def relation_keys(document: dict) -> set[tuple[str, str]]:
    return {
        (str(item.get("type")), str(item.get("target")))
        for item in document.get("relations") or []
    }


def snapshot_diff(previous: dict, current: dict) -> dict[str, Any]:
    before = {item["tdoc"]: item for item in previous.get("documents") or []}
    after = {item["tdoc"]: item for item in current.get("documents") or []}
    status_changes = []
    relation_changes = []
    for tdoc in sorted(set(before) & set(after)):
        if before[tdoc].get("status") != after[tdoc].get("status"):
            status_changes.append(
                {
                    "tdoc": tdoc,
                    "from": before[tdoc].get("status"),
                    "to": after[tdoc].get("status"),
                }
            )
        old_relations = relation_keys(before[tdoc])
        new_relations = relation_keys(after[tdoc])
        if old_relations != new_relations:
            relation_changes.append(
                {
                    "tdoc": tdoc,
                    "added": sorted(new_relations - old_relations),
                    "removed": sorted(old_relations - new_relations),
                }
            )
    return {
        "schemaVersion": 1,
        "generatedAt": now_utc(),
        "addedDocuments": sorted(set(after) - set(before)),
        "removedDocuments": sorted(set(before) - set(after)),
        "statusChanges": status_changes,
        "relationChanges": relation_changes,
        "addedMeetings": [
            item
            for item in current.get("meetings") or []
            if item.get("meeting")
            not in {value.get("meeting") for value in previous.get("meetings") or []}
        ],
    }


def cmd_build_ledger(args: argparse.Namespace) -> None:
    ledger = build_ledger(args.scope, args.meeting_manifest)
    write_json(args.output, ledger)
    print(
        f"Saved {len(ledger['documents'])} documents from "
        f"{len(ledger['meetings'])} meetings to {args.output}"
    )


def cmd_term_timeline(args: argparse.Namespace) -> None:
    result = build_term_timeline(read_json(args.ledger), args.texts, read_json(args.terms))
    write_json(args.output, result)
    print(f"Saved {len(result['terms'])} term timelines to {args.output}")


def cmd_validate(args: argparse.Namespace) -> None:
    ledger = read_json(args.ledger)
    events = read_jsonl(args.events) if args.events else []
    result = validate_evidence(ledger, events, args.texts)
    write_json(args.output, result)
    print(
        f"Validation: {len(result['errors'])} error(s), "
        f"{len(result['warnings'])} warning(s); saved to {args.output}"
    )
    if result["errors"]:
        raise SystemExit(2)


def cmd_snapshot_diff(args: argparse.Namespace) -> None:
    result = snapshot_diff(read_json(args.previous), read_json(args.current))
    write_json(args.output, result)
    print(
        f"Saved delta with {len(result['addedDocuments'])} added document(s) "
        f"to {args.output}"
    )


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    ledger = commands.add_parser("build-ledger")
    ledger.add_argument("--scope", required=True)
    ledger.add_argument(
        "--meeting-manifest",
        action="append",
        required=True,
        help="Repeat in oldest-to-newest order as MEETING=/path/manifest.json",
    )
    ledger.add_argument("--output", required=True)
    ledger.set_defaults(func=cmd_build_ledger)

    terms = commands.add_parser("term-timeline")
    terms.add_argument("--ledger", required=True)
    terms.add_argument("--texts", required=True)
    terms.add_argument("--terms", required=True)
    terms.add_argument("--output", required=True)
    terms.set_defaults(func=cmd_term_timeline)

    validation = commands.add_parser("validate")
    validation.add_argument("--ledger", required=True)
    validation.add_argument("--events")
    validation.add_argument("--texts")
    validation.add_argument("--output", required=True)
    validation.set_defaults(func=cmd_validate)

    diff = commands.add_parser("snapshot-diff")
    diff.add_argument("--previous", required=True)
    diff.add_argument("--current", required=True)
    diff.add_argument("--output", required=True)
    diff.set_defaults(func=cmd_snapshot_diff)
    return parser


def main() -> None:
    args = make_parser().parse_args()
    try:
        args.func(args)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
