---
name: 3gpp-review
description: Download, extract, summarize, and compare 3GPP contribution documents (TDocs) for a meeting or Key Issue (KI). Use for requests such as reading TDocs, summarizing KI proposals, comparing company positions, analyzing 3GPP contributions, or “总结提案/分析KI”.
allowed-tools: skill.activate skill.read_resource bash python filesystem.read filesystem.write filesystem.list filesystem.search web.fetch rag.search user.ask vision.inspect knowledge.publish
---

# 3GPP TDoc review

Use this workflow on Linux to turn a 3GPP meeting index and its contribution documents into a traceable Chinese Markdown analysis. The helper script is [scripts/3gpp_tdocs.py](scripts/3gpp_tdocs.py); resolve that path relative to this file.

Do not guess meeting directory names, agenda mappings, document metadata, or proposal content. Keep the source TDoc number attached to every substantive claim.

## Environment

The Skill package is mounted read-only and the AnythingLLM workspace persists at `/workspace`. For every `bash` call that uses a bundled script, pass the exact `skillRoot` returned by `skill.activate` as the tool's `cwd` (normally `skill://3gpp-review`; an upgraded installation may return a legacy name such as `skill://3gpp-tdocs`) and invoke the script by its relative path `scripts/3gpp_tdocs.py`. A `skill://` URI is a virtual `cwd`, not a shell filesystem path: never pass it to `ls`, `find`, Python, or another shell command. Never copy the bundled helper into the workspace. Keep all mutable data in the workspace:

```bash
export TDP_CACHE="/workspace/3gpp-review"
export PY="python3"
mkdir -p "$TDP_CACHE" "$TDP_CACHE/reports"
```

Required system commands are `curl`, `unzip`, and `zip`. `libreoffice` and `pdftoppm` are optional fallbacks for diagrams. Check dependencies before downloading anything:

```bash
command -v python3 curl unzip zip
command -v libreoffice || true
command -v pdftoppm || true
```

If network access is unavailable, continue from user-provided local Index/TDoc files when possible and state the missing capability. Do not install packages at runtime; required Python dependencies are already in the sandbox image.

## 1. Resolve the meeting directory

Parse the working group, meeting identifier, and KI from the request. Default to SA2 only when the user gives a bare meeting number in an SA2 context.

| WG  | 3GPP directory        | TDoc prefix |
| --- | --------------------- | ----------- |
| SA1 | `tsg_sa/WG1_Serv`     | `S1`        |
| SA2 | `tsg_sa/WG2_Arch`     | `S2`        |
| SA3 | `tsg_sa/WG3_Security` | `S3`        |
| SA5 | `tsg_sa/WG5_OAM`      | `S5`        |
| CT1 | `tsg_ct/WG1_NAS`      | `C1`        |
| CT4 | `tsg_ct/WG4_MAP`      | `C4`        |

Browse `https://www.3gpp.org/ftp/<directory>/` and search the returned directory listing for the exact meeting number. Folder names contain location, date, and sometimes `AH-e`; they are not safely predictable. Prefer the available web browsing tool. A shell fallback is:

```bash
curl --fail --location --retry 3 --silent --show-error \
  "https://www.3gpp.org/ftp/tsg_sa/WG2_Arch/" > "$TDP_CACHE/sa2-index.html"
rg -o 'TSGS2_[^"< ]+' "$TDP_CACHE/sa2-index.html" | sort -u | rg '175'
```

Record `wg_path`, exact `meeting_folder`, meeting number/location/date, and document prefix.

## 2. Download and inspect the meeting Index

Browse the exact meeting directory and locate the published Index ZIP; do not synthesize its filename. Download with validation and cache reuse:

```bash
meeting_url="https://www.3gpp.org/ftp/<wg_path>/<meeting_folder>"
meeting_cache="$TDP_CACHE/<meeting_folder>"
mkdir -p "$meeting_cache/index"
curl --fail --location --retry 3 --output "$meeting_cache/index/<index.zip>" \
  "$meeting_url/<index.zip>"
unzip -o "$meeting_cache/index/<index.zip>" -d "$meeting_cache/index/extracted"
find "$meeting_cache/index/extracted" -type f -iname '*.xlsx' -print
```

Inspect workbook sheets and the first rows before choosing columns:

```bash
"$PY" scripts/3gpp_tdocs.py inspect-index \
  --excel "$meeting_cache/index/extracted/<index.xlsx>"
```

The index often has duplicate or multi-row headings. The helper reads raw cells and discovers likely columns without treating a row as a unique schema.

## 3. Identify the KI agenda and filter documents

Find the agenda item from the workbook content, meeting agenda, or explicit KI heading. Do not assume that `KI#22` always maps to `20.6.22`; mappings change between studies and meetings.

Inspect candidate rows using `rg` on the `inspect-index` output or rerun it with a larger row limit. Then filter:

```bash
"$PY" scripts/3gpp_tdocs.py filter-index \
  --excel "$meeting_cache/index/extracted/<index.xlsx>" \
  --sheet '<sheet name>' \
  --agenda '20.6.22' \
  --output "$meeting_cache/proposals.json"
```

When the user names specific TDocs, preserve the KI filter and add them explicitly instead of analyzing the full KI:

```bash
"$PY" scripts/3gpp_tdocs.py filter-index \
  --excel "$meeting_cache/index/extracted/<index.xlsx>" \
  --sheet '<sheet name>' \
  --agenda '20.6.22' \
  --documents S2-2606085 S2-2606481 \
  --output "$meeting_cache/proposals.json"
```

When the user names a contributor, filter the Index `Source` field in the same canonical command. `--source` uses case-insensitive substring matching, so joint-source rows containing the company name remain included:

```bash
"$PY" scripts/3gpp_tdocs.py filter-index \
  --excel "$meeting_cache/index/extracted/<index.xlsx>" \
  --sheet '<sheet name>' \
  --agenda '20.6.18' \
  --source 'Huawei' \
  --output "$meeting_cache/proposals.json"
```

Review the resulting JSON. Confirm that document numbers, titles, sources, and statuses are plausible. Exclude withdrawn/unavailable documents unless the user asks to include them. If filtering returns zero or an implausible count, stop and re-inspect the workbook rather than widening the filter silently.

`filter-index` is the only supported way to create a proposal manifest. Do not hand-write, rename fields in, or replace `proposals.json` with an ad-hoc JSON list. Validate the generated contract before using it:

```bash
"$PY" scripts/3gpp_tdocs.py validate-manifest \
  --manifest "$meeting_cache/proposals.json"
```

After any tool returns a workspace path, keep and reuse that exact path in later calls. Do not reconstruct it from a filename or move it to a guessed directory. If a path is no longer known, use `filesystem.search` or `filesystem.list` to resolve it before calling `filesystem.read`.

## 4. Download and extract TDocs

The standard contribution location is the meeting's `Docs/` directory. The helper downloads ZIPs concurrently, validates archives, extracts DOCX files, and reports failures without deleting cached successes:

```bash
"$PY" scripts/3gpp_tdocs.py download \
  --manifest "$meeting_cache/proposals.json" \
  --base-url "$meeting_url/Docs" \
  --output "$meeting_cache/docs" \
  --workers 5
```

Extract paragraphs, tables, VML/WPS text, embedded Visio text, and raster/vector media:

```bash
"$PY" scripts/3gpp_tdocs.py extract \
  --input "$meeting_cache/docs" \
  --texts "$meeting_cache/texts" \
  --figures "$meeting_cache/figures"
```

The extractor writes markers such as `[TABLE START]`, `[VML/WPS TEXT]`, `[VISIO TEXT]`, and `[FIGURE: ...]`. Treat diagram text recovered from OOXML as evidence, but verify ambiguous topology or arrow direction visually.

For unsupported EMF/WMF or unclear embedded diagrams, render the original DOCX and inspect relevant pages:

```bash
mkdir -p "$meeting_cache/rendered"
libreoffice --headless --convert-to pdf --outdir "$meeting_cache/rendered" \
  "$meeting_cache/docs/<document>.docx"
pdftoppm -png -r 150 "$meeting_cache/rendered/<document>.pdf" \
  "$meeting_cache/rendered/<document>-page"
```

Use `vision.inspect` for extracted/rendered raster images. Inspect every figure that materially affects architecture or procedure interpretation. Do not infer a signaling direction solely from nearby text when an arrow is not visible. Record unsupported or unreadable figures as explicit limitations.

## 5. Analyze every proposal

List expected and extracted documents and reconcile them before analysis:

```bash
"$PY" scripts/3gpp_tdocs.py coverage \
  --manifest "$meeting_cache/proposals.json" \
  --texts "$meeting_cache/texts" \
  --receipt "$meeting_cache/coverage.json"
```

The command succeeds only when the extracted TDoc set exactly matches the manifest and writes `coverage.json` only after that exact check passes. Preserve this receipt; the final publication call verifies its manifest hash and document set.

For a large set, analyze batches of roughly 10–15 documents. Parallel agents may be used only when the host environment and current instructions permit delegation. Each proposal analysis must capture:

- TDoc number, title, source, and status;
- target KI bullet and Solution/Variant, when explicitly supported;
- proposed architecture, new or changed network functions, interfaces, identifiers, and information elements;
- procedure steps and diagrams;
- changes requested to the target TR/TS;
- open editor's notes, assumptions, and unresolved issues;
- relationships to earlier or joint proposals.

For a signaling flow, normalize it as:

| Step | Sender → receiver | Message              | Purpose                              |
| ---- | ----------------- | -------------------- | ------------------------------------ |
| 1    | UE → AMF          | Registration request | Describe only what the TDoc supports |

Mark uncertain reconstruction as uncertain. Distinguish a contributor's proposal from agreed 3GPP text.

## 6. Produce the report

Write the final Markdown under `/workspace/3gpp-review/reports/<meeting>/<ki>/` using a versioned filename such as `<meeting>_KI<ki>_<UTC timestamp>.md` unless the user requests another workspace path.

Recommended structure:

1. Scope, meeting, KI, source count, and coverage;
2. solution/variant overview;
3. company-position comparison;
4. one subsection per proposal;
5. agreements, disagreements, dependencies, and open questions;
6. source/coverage appendix.

Every proposal in the manifest must be either analyzed or listed under failures with a reason. Do not silently omit a TDoc, collapse distinct variants, invent consensus, or present a draft contribution as an adopted specification.

Before delivery, rerun `coverage`, check all figure markers have been considered, and verify that counts in the prose match the manifest. Then call `knowledge.publish` exactly once with the report path, meeting, KI, complete TDoc list, exact manifest path, and exact coverage receipt path. The TDoc list must be the complete manifest set; publication rejects a partial or different list. The task is not complete until the tool confirms that the report is embedded in the current Workspace knowledge base. A run has one canonical final report: if publication succeeds or reports `ALREADY_PUBLISHED`, do not publish another path in the same run.

## Troubleshooting

- HTTP 404: re-open the directory listing and verify case, folder, Index filename, and `Docs/`; do not guess another URL.
- Workbook parse failure: confirm the file is a real XLSX/ZIP and select the correct sheet.
- No matches: inspect raw workbook rows and verify agenda formatting; some cells contain numeric values or surrounding spaces.
- Corrupt TDoc ZIP: delete only that cached ZIP and retry it; preserve other downloads.
- Missing diagram detail: inspect extracted media, then render the original DOCX to PDF/PNG.
- Legacy binary `.vsd`: structured XML extraction is unavailable; use its preview image or rendered document.
- Large KI: maintain a manifest-based coverage ledger and assemble only after every batch reports its handled document numbers.
