---
archived: false
name: 3gpp-position-evolution
description: Trace a company's position, technical route, terminology, supporters, opponents, and standardization outcome across multiple 3GPP meetings. Use for longitudinal company/topic studies; use 3gpp-review instead for a single-meeting or document-by-document summary.
allowed-tools: skill.read_resource 3gpp.resolve-meeting bash python filesystem.read filesystem.write filesystem.list filesystem.search web.fetch knowledge.search knowledge.ingest user.ask vision.inspect knowledge.publish
---

# 3GPP position evolution

The Workspace knowledge base is the RAG knowledge base. Use `knowledge.search` to retrieve indexed material, `knowledge.ingest` to add regular document files to RAG, and `knowledge.publish` only for the canonical final Markdown report. Personal memory tools are not document storage.

Produce a longitudinal, evidence-linked Chinese analysis for one or more companies and a KI, WI, SID, solution, or technical topic. Separate deterministic source tracking from analytical synthesis: first build the TDoc ledger, then derive company positions from the ledger and extracted primary documents.

Before planning, also activate the bound 3GPP review Skill for shared stance rules and any needed source acquisition. Its current name is `3gpp-review`; an upgraded installation may retain the legacy name `3gpp-tdocs`. If neither is available, explain that the shared rules are unavailable and restrict work to organizing supplied source facts; do not invent a replacement opposition taxonomy.

The helper is [scripts/3gpp_evolution.py](scripts/3gpp_evolution.py). Before classifying opposition, use `read_skill_resource` to read `references/stance-evidence.md` from the activated review package. These are the shared stance rules for review and matrices; do not run its report workflow merely to read them. Before interpreting meeting outcomes, read [references/status-semantics.md](references/status-semantics.md). Before writing the report, read [references/report-contract.md](references/report-contract.md).

Skill activation is complete before the task plan is created and must never appear as a plan task. Read status rules, shared stance rules, the report contract, and company aliases when each becomes relevant. Reuse already read resources.

## Workspace

The Skill package is read-only. Use the exact activated skillRoot as the Bash tool's cwd. Keep ledgers, source snapshots, extracted texts and validation under `/workspace/_meta/tasks/<run-id>/evolution/`; keep downloaded proposal files in the meeting/KI directories returned by `3gpp.download`. The internal research layout is:

```text
/workspace/_meta/tasks/<run-id>/evolution/<company>/
├── scope.json
├── meetings/
├── texts/
├── tdoc-ledger.json
├── stance-events.jsonl
├── terminology.json
└── validation.json
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

Resolve every meeting in the requested interval from official sources. Use `3gpp.download` for meeting/KI acquisition through the bound review Skill. Its current selection is based on agenda references, not a complete Index. Retain actual official metadata separately; do not treat a download record as a complete meeting manifest. If official Index manifests are unavailable, analyze the supplied documents with explicit range limits and skip ledger commands requiring those manifests; never fabricate Index rows, company sources or meeting outcomes.

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
  --scope '/workspace/_meta/tasks/<run-id>/evolution/Huawei/scope.json' \
  --meeting-manifest 'SA2#170=/workspace/_meta/tasks/<run-id>/evolution/Huawei/meetings/SA2-170.json' \
  --meeting-manifest 'SA2#171=/workspace/_meta/tasks/<run-id>/evolution/Huawei/meetings/SA2-171.json' \
  --output '/workspace/_meta/tasks/<run-id>/evolution/Huawei/tdoc-ledger.json'
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

Write one JSON object per evidence event to `stance-events.jsonl` using the schema and classification rules in the review package's `references/stance-evidence.md`. An event addresses one issue dimension; a company can support the overall direction while opposing terminology or a mandatory dependency.

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

Occurrence is evidence that a term appears, not proof of a rename. Counts include tracked deletions and moves; check the surrounding revision markers before interpreting first/last appearance as current usage. Infer a rename, replacement, or semantic narrowing only after comparing normative definitions, architecture, and procedure changes. Track both stable principles and changes in function boundaries, interfaces, operator control, fallback behavior, determinism, and deployment assumptions.

## 7. Validate before synthesis

Run the evidence validator:

```bash
python3 scripts/3gpp_evolution.py validate \
  --ledger /workspace/.../tdoc-ledger.json \
  --events /workspace/.../stance-events.jsonl \
  --texts /workspace/.../texts \
  --output /workspace/.../validation.json
```

Resolve every validation error before reporting. Warnings must either be resolved or disclosed. Validation checks record structure and ledger membership; it does not prove the evidence text is genuine or that it supports the stance. Check each claim against the original source and locator separately. In particular, never convert `not_handled`, `postponed`, `merged`, `withdrawn`, or `baseline` into “rejected” without separate explicit evidence.

For an incremental rerun, preserve the previous ledger and generate a deterministic delta:

```bash
python3 scripts/3gpp_evolution.py snapshot-diff \
  --previous /workspace/.../tdoc-ledger.previous.json \
  --current /workspace/.../tdoc-ledger.json \
  --output /workspace/.../snapshot-diff.json
```

## 8. Report and publish

Follow `report-contract.md`. Every material conclusion must cite at least one TDoc or official meeting artifact. Provide coverage and evidence-strength tables, and mark analysis of an ongoing meeting as provisional.

Write the versioned final Markdown report under `/workspace/3gpp/comparisons/<run-id>/analysis/`. Run applicable checks for the actual inputs. Publish once only if the user requests knowledge-base storage, with the actual TDoc list; do not invent coverage receipts. If publication fails, preserve the report and state that it was not indexed. Download-only tasks do not enter this analysis workflow.
