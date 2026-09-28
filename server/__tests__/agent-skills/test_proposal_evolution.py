import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "proposal_evolution", ROOT / "agent-config/skills/3gpp-proposal-evolution/scripts/3gpp_proposal_evolution.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def doc(number, **kwargs):
    return {"tdoc": f"S2-260{number}", **kwargs}


def test_ki18_chains_use_actual_clauses_not_broad_title():
    old = [doc("5623", clauses=["6.18.16"]),
           doc("5624", title="18.16 18.17 18.18", clauses=["6.18.17", "6.18.18"])]
    new = [doc("6817", clauses=["6.18.16"], comments="Revised to S2-2609203."),
           doc("9203", clauses=["6.18.16"], result="Approved"),
           doc("7094", clauses=["6.18.17"], comments="Revised to S2-2609053."),
           doc("9053", clauses=["6.18.17"], result="Approved")]
    result = MODULE.build(old, new)
    assert len(result["tasks"]) == 2
    first = result["tasks"][0]
    assert first["current"] == ["S2-2606817", "S2-2609203"]
    assert {c["previous"] for c in first["previousCandidates"]} == {"S2-2605623"}
    assert {c["confidence"] for c in first["previousCandidates"]} == {"topic_candidate"}


def test_merge_is_not_revision_and_missing_is_not_new():
    result = MODULE.build([], [doc("6817"), doc("6976", comments="Merge into S2-2606817. Based on S2-2603648")])
    assert len(result["tasks"]) == 2
    assert {e["type"] for e in result["relations"]} == {"merged_into", "based_on"}
    assert result["warnings"] == ["Missing referenced document: S2-2603648"]
    assert result["tasks"][0]["novelty"] == "unmatched_in_supplied_sources"


def test_many_to_many_candidates_and_scope_conflicts():
    old = [doc("5623", clauses=["6.18.16"], rel="Rel-20"),
           doc("5624", clauses=["6.18.16", "6.18.17"], rel="Rel-20")]
    result = MODULE.build(old, [doc("6817", clauses=["6.18.16"], rel="Rel-20"),
                               doc("7094", clauses=["6.18.17"], rel="Rel-21")])
    assert len(result["tasks"][0]["previousCandidates"]) == 2
    assert not result["tasks"][1]["previousCandidates"]


def test_explicit_evidence_retains_locator_and_reference_is_not_revision():
    result = MODULE.build([doc("5623")], [doc("6817", relationEvidence=[
        {"text": "Revision of S2-2605623", "locator": "header, block 2"},
        {"text": "See S2-2605623", "locator": "block 9"}])])
    assert len(result["relations"]) == 1
    assert result["relations"][0]["evidence"]["locator"] == "header, block 2"
    assert result["tasks"][0]["previousCandidates"][0]["confidence"] == "explicit"


def test_duplicate_and_cycle_do_not_silently_pass():
    with pytest.raises(ValueError, match="Duplicate"):
        MODULE.build([], [doc("6817"), doc("6817")])
    result = MODULE.build([], [doc("6817", comments="Revised to S2-2609203"),
                               doc("9203", comments="Revised to S2-2606817")])
    assert result["tasks"][0]["status"] == "needs_review"
    assert result["warnings"]
