---
name: 3gpp-position-evolution
description: Trace a company's position, technical route, terminology, supporters, opponents, and standardization outcome across multiple 3GPP meetings. Use for longitudinal company/topic studies; use 3gpp-review instead for a single-meeting or document-by-document summary.
allowed-tools: skill.activate skill.read_resource bash python filesystem.read filesystem.write filesystem.list filesystem.search web.fetch rag.search user.ask vision.inspect knowledge.publish
---

# 3GPP position evolution

Produce a longitudinal, evidence-linked Chinese analysis for one or more companies and a KI, WI, SID, solution, or technical topic. Separate deterministic source tracking from analytical synthesis: first build the TDoc ledger, then derive company positions from the ledger and extracted primary documents.

Activate the bound 3GPP review Skill as well as this Skill when official meeting indexes or TDocs must be located, downloaded, or extracted. Its current name is `3gpp-review`; an upgraded installation may retain the legacy name `3gpp-tdocs`. If neither is available, work from user-provided indexes and documents and disclose the limitation.

The helper is [scripts/3gpp_evolution.py](scripts/3gpp_evolution.py). Before classifying opposition, read [references/evidence-taxonomy.md](references/evidence-taxonomy.md). Before interpreting meeting outcomes, read [references/status-semantics.md](references/status-semantics.md). Before writing the report, read [references/report-contract.md](references/report-contract.md).

When the governed runtime creates a task plan, keep Skill activation as a bounded bootstrap task. It may only activate the two 3GPP Skills and read `status-semantics.md`, `evidence-taxonomy.md`, `report-contract.md`, and `company-aliases.json`. Do not perform RAG searches, list Workspace directories, establish the meeting timeline, or discover TDocs in that task. Complete it immediately after the four resources are read; meeting scoping belongs to the next task. Do not activate the same Skill or read the same resource twice in one run.

## Workspace

The Skill package is read-only. Run its script with `cwd=skill://3gpp-position-evolution` and keep research artifacts under:

```text
/workspace/3gpp-position-evolution/<wg>/<topic>/<company>/
├── scope.json
├── meetings/
├── texts/
├── tdoc-ledger.json
├── stance-events.jsonl
├── terminology.json
├── validation.json
└── reports/
```

Reuse cached official sources. Never overwrite an earlier report; use a UTC timestamp in the filename.

## 1. Freeze the research scope

Write `scope.json` before collecting documents. Record:

- working group and study/work item when known;
- canonical company name and only verified source aliases;
- KI/WI/SID, agenda items, solution identifiers, and search terms;
- starting and ending date or meeting, with `latest` resolved to a named meeting;
- snapshot time and whether the final meeting is still in progress;
- requested comparison companies and analysis depth.

Do not silently broaden a named KI into the entire study. A source alias means that the name in the meeting index is attributable to the target company; do not infer corporate ownership from memory. [references/company-aliases.json](references/company-aliases.json) is a conservative starting point, not an exhaustive authority.

For a company comparison, build one scope and ledger per target company from the same cached meeting manifests, then compare the validated outputs. Do not reuse one company's `target_authored` labels for another company.

## 2. Build a complete meeting evidence set

Resolve every meeting in the requested interval from the official 3GPP FTP listing. For each meeting, use the bound 3GPP review Skill (`3gpp-review` or legacy `3gpp-tdocs`) to retain the official Index, relevant agenda page or `TdocsByAgenda` page, and extracted TDocs.

The candidate set must include more than target-company documents:

1. target-company authored and co-signed proposals;
2. revisions, merged baselines, and conclusion/change documents linked to them;
3. comments or discussion documents that explicitly address the target proposal;
4. competing architectures covering the same key issue;
5. meeting status/comment evidence needed to interpret the outcome.

Keep one manifest per meeting. Record an unavailable document as a failure instead of silently omitting it. A meeting with zero target documents is still part of coverage if it falls inside the requested interval.

## 3. Construct the TDoc ledger

Build the ordered ledger from the per-meeting manifests. Preserve manifest order from oldest to newest:

```bash
python3 scripts/3gpp_evolution.py build-ledger \
  --scope /workspace/3gpp-position-evolution/SA2/KI18/Huawei/scope.json \
  --meeting-manifest 'SA2#170=/workspace/.../SA2-170/proposals.json' \
  --meeting-manifest 'SA2#171=/workspace/.../SA2-171/proposals.json' \
  --output /workspace/3gpp-position-evolution/SA2/KI18/Huawei/tdoc-ledger.json
```

The script normalizes TDoc identifiers, source roles, status semantics, and explicit relation fields already present in manifests. Add missing `revises`, `revised_to`, `merged_into`, `supersedes`, `alternative_to`, `supports`, `objects_to`, `contributes_to_baseline`, or `approved_as` edges only when an Index row, meeting comment, or document explicitly supports the relation. Attach the evidence TDoc or official page to each manually added edge.

Do not treat co-authorship of a later baseline as proof that every part of that baseline was the company's original position.

## 4. Create per-document fact cards

For every target, response, alternative, and outcome document, record:

- TDoc, meeting, title, sources, status, and document role;
- affected KI bullet, solution/variant, clause, or work-task scope;
- proposed functions, interfaces, procedures, information elements, and safeguards;
- terms introduced, renamed, narrowed, generalized, or removed;
- explicit relation to earlier documents;
- meeting outcome and unresolved editor's notes;
- short evidence locator such as section, table, meeting comment, or Index row.

Distinguish the contributor's proposal, jointly authored text, meeting agreement, and your own inference. Verify material architecture or procedure diagrams using the visual workflow in `3gpp-review`.

## 5. Record stance evidence

Write one JSON object per evidence event to `stance-events.jsonl` using the schema and classification rules in `evidence-taxonomy.md`. An event addresses one issue dimension; a company can support the overall direction while opposing terminology or a mandatory dependency.

Only an event with `stance: "oppose"` and `strength: "explicit"` may support the label “主要反对者”. Use `alternative` for a competing design without explicit rejection language, and `concern` for questions, risks, or reservations. Keep quoted evidence short; prefer a precise paraphrase plus locator.

## 6. Measure terminology and route evolution

Create a JSON term registry, for example:

```json
[
  {"canonical": "NW-Agent", "variants": ["NW-Agent", "Network AI Agent"]},
  {"canonical": "AI Agent", "variants": ["AI Agent", "agentic function"]}
]
```

Generate an occurrence timeline from extracted texts:

```bash
python3 scripts/3gpp_evolution.py term-timeline \
  --ledger /workspace/.../tdoc-ledger.json \
  --texts /workspace/.../texts \
  --terms /workspace/.../terms.json \
  --output /workspace/.../terminology.json
```

Occurrence is evidence that a term appears, not proof of a rename. Infer a rename, replacement, or semantic narrowing only after comparing normative definitions, architecture, and procedure changes. Track both stable principles and changes in function boundaries, interfaces, operator control, fallback behavior, determinism, and deployment assumptions.

## 7. Validate before synthesis

Run the evidence validator:

```bash
python3 scripts/3gpp_evolution.py validate \
  --ledger /workspace/.../tdoc-ledger.json \
  --events /workspace/.../stance-events.jsonl \
  --texts /workspace/.../texts \
  --output /workspace/.../validation.json
```

Resolve every validation error before reporting. Warnings must either be resolved or disclosed. In particular, never convert `not_handled`, `postponed`, `merged`, `withdrawn`, or `baseline` into “rejected” without separate explicit evidence.

For an incremental rerun, preserve the previous ledger and generate a deterministic delta:

```bash
python3 scripts/3gpp_evolution.py snapshot-diff \
  --previous /workspace/.../tdoc-ledger.previous.json \
  --current /workspace/.../tdoc-ledger.json \
  --output /workspace/.../snapshot-diff.json
```

## 8. Report and publish

Follow `report-contract.md`. Every material conclusion must cite at least one TDoc or official meeting artifact. Provide coverage and evidence-strength tables, and mark analysis of an ongoing meeting as provisional.

Write the versioned Markdown report under `reports/`, rerun validation, and call `knowledge.publish` exactly once with the report path and the complete TDoc list. The task is not complete until publication to the current Workspace knowledge base succeeds. If publication fails, preserve the report and state the failure without claiming it was published.
