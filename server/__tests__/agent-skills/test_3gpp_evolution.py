import importlib.util
import json
import sys
from pathlib import Path


SCRIPT = (
    Path(__file__).parents[2]
    / "agent-skills"
    / "examples"
    / "3gpp-position-evolution"
    / "scripts"
    / "3gpp_evolution.py"
)
SPEC = importlib.util.spec_from_file_location("threegpp_evolution", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def write_json(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def sample_scope():
    return {
        "workingGroup": "SA2",
        "company": {"canonical": "Huawei", "aliases": ["Huawei", "HiSilicon"]},
        "topic": {"ki": "18", "keywords": ["Agentic Core"]},
    }


def sample_ledger():
    return {
        "meetings": [{"meeting": "SA2#170"}],
        "documents": [
            {
                "tdoc": "S2-2507223",
                "meeting": "SA2#170",
                "status": "not_handled",
                "relations": [],
            }
        ],
    }


def test_build_ledger_preserves_non_rejection_semantics_and_authorship(tmp_path):
    scope = tmp_path / "scope.json"
    manifest = tmp_path / "manifest.json"
    write_json(scope, sample_scope())
    write_json(
        manifest,
        {
            "proposals": [
                {
                    "document": "s2-2507223",
                    "title": "Agentic Core",
                    "source": "Huawei; HiSilicon",
                    "status": "Not Handled",
                    "revised_to": "S2-2507333",
                },
                {
                    "document": "S2-2507333",
                    "title": "Revised Agentic Core",
                    "source": "Huawei, Ericsson",
                    "status": "Merged into S2-2507444",
                },
            ]
        },
    )

    ledger = MODULE.build_ledger(str(scope), [f"SA2#170={manifest}"])

    first, second = ledger["documents"]
    assert first["tdoc"] == "S2-2507223"
    assert first["role"] == "target_authored"
    assert first["status"] == "not_handled"
    assert first["statusSemantics"]["rejected"] is False
    assert first["relations"] == [
        {"type": "revised_to", "target": "S2-2507333", "evidence": "manifest"}
    ]
    assert second["role"] == "target_cosigned"
    assert second["status"] == "merged"
    assert second["relations"] == [
        {
            "type": "merged_into",
            "target": "S2-2507444",
            "evidence": "meeting-index status: Merged into S2-2507444",
        }
    ]


def test_validator_blocks_primary_opponent_without_explicit_opposition():
    event = {
        "_line": 1,
        "company": "Example Corp",
        "dimension": "architecture",
        "stance": "alternative",
        "strength": "strong",
        "primaryOpponent": True,
        "evidence": {
            "tdoc": "S2-2507223",
            "locator": "clause 6.1",
            "text": "Proposes a different architecture.",
        },
    }

    result = MODULE.validate_evidence(sample_ledger(), [event])

    assert result["valid"] is False
    assert any("primaryOpponent requires explicit" in item for item in result["errors"])


def test_only_explicit_rejected_status_has_rejection_semantics():
    assert MODULE.normalize_status("Rejected") == "rejected"
    assert MODULE.STATUS_SEMANTICS["rejected"]["rejected"] is True
    assert MODULE.normalize_status("Not Handled") == "not_handled"
    assert MODULE.STATUS_SEMANTICS["not_handled"]["rejected"] is False


def test_validator_accepts_explicit_issue_scoped_opposition():
    event = {
        "_line": 1,
        "company": "Example Corp",
        "dimension": "mandatory control-plane dependency",
        "stance": "oppose",
        "strength": "explicit",
        "primaryOpponent": True,
        "evidence": {
            "tdoc": "S2-2507223",
            "locator": "meeting comment",
            "text": "Requests removal of the mandatory dependency.",
        },
    }

    result = MODULE.validate_evidence(sample_ledger(), [event])

    assert result["valid"] is True
    assert result["counts"]["primaryOppositionEvents"] == 1


def test_term_timeline_reports_occurrence_without_claiming_rename(tmp_path):
    texts = tmp_path / "texts"
    texts.mkdir()
    (texts / "S2-2507223.txt").write_text(
        "The Network AI Agent is described as an NW-Agent.", encoding="utf-8"
    )
    terms = [
        {"canonical": "NW-Agent", "variants": ["NW-Agent", "Network AI Agent"]}
    ]

    result = MODULE.build_term_timeline(sample_ledger(), str(texts), terms)

    timeline = result["terms"][0]
    assert timeline["firstSeen"]["tdoc"] == "S2-2507223"
    assert timeline["firstSeen"]["counts"] == {
        "NW-Agent": 1,
        "Network AI Agent": 1,
    }
    assert "do not by themselves prove" in result["note"]


def test_snapshot_diff_reports_new_documents_and_status_changes():
    previous = sample_ledger()
    current = json.loads(json.dumps(previous))
    current["documents"][0]["status"] = "approved"
    current["documents"].append(
        {
            "tdoc": "S2-2507333",
            "meeting": "SA2#171",
            "status": "available",
            "relations": [],
        }
    )
    current["meetings"].append({"meeting": "SA2#171"})

    result = MODULE.snapshot_diff(previous, current)

    assert result["addedDocuments"] == ["S2-2507333"]
    assert result["statusChanges"] == [
        {"tdoc": "S2-2507223", "from": "not_handled", "to": "approved"}
    ]
    assert result["addedMeetings"] == [{"meeting": "SA2#171"}]
