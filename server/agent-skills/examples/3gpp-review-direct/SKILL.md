---
name: 3gpp-review-direct
description: Use the original single-agent 3GPP contribution workflow to download, extract, summarize, and compare TDocs for a meeting or KI. Use only with the experimental direct-execution proposal assistant.
allowed-tools: skill.activate skill.read_resource 3gpp.resolve-meeting bash python filesystem.read filesystem.write filesystem.list filesystem.search web.fetch user.ask vision.inspect
---

# 3GPP TDoc review

Complete this workflow in one continuous Agent conversation. Do not split it into worker tasks, delegate it to another Agent, publish it to a knowledge base, or restart discovery after a successful step. Keep the exact meeting URL and workspace paths from each tool result and reuse them directly.

Use this workflow on Linux to turn a 3GPP meeting index and its contribution documents into a traceable Chinese Markdown analysis. The helper script is [scripts/3gpp_tdocs.py](scripts/3gpp_tdocs.py); resolve that path relative to this file.

Do not guess meeting directory names, agenda mappings, document metadata, or proposal content. Keep the source TDoc number attached to every substantive claim.

## Environment

The Skill package is read-only and the persistent workspace is `/workspace`. Activate this Skill once, then run bundled commands with `cwd=skill://3gpp-review-direct`. Store all changing files under one persistent directory:

```bash
export TDP_CACHE="/workspace/3gpp-review-direct"
export PY="python3"
mkdir -p "$TDP_CACHE"
```

Each Bash call starts a fresh shell. Define the paths needed by that call inside the same command instead of assuming shell variables persist.

Required system commands are `curl`, `unzip`, and `zip`. `libreoffice` and `pdftoppm` are optional fallbacks for diagrams. Check dependencies before downloading anything:

```bash
command -v python3 curl unzip zip
command -v libreoffice || true
command -v pdftoppm || true
```

Python dependencies are already installed; do not create a virtual environment or install packages while handling a user request. If network access is unavailable, continue from user-provided local Index/TDoc files when possible and state the missing capability.

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
PY="python3"
"$PY" scripts/3gpp_tdocs.py inspect-index \
  --excel "$meeting_cache/index/extracted/<index.xlsx>"
```

The index often has duplicate or multi-row headings. The helper reads raw cells and discovers likely columns without treating a row as a unique schema.

## 3. Identify the KI agenda and filter documents

Find the agenda item from the workbook content, meeting agenda, or explicit KI heading. Do not assume that `KI#22` always maps to `20.6.22`; mappings change between studies and meetings.

When the user names a KI, search the complete selected meeting sheet directly instead of dumping successive row ranges:

```bash
"$PY" scripts/3gpp_tdocs.py inspect-index \
  --excel "$meeting_cache/index/extracted/<index.xlsx>" \
  --sheet '<sheet name>' \
  --query 'KI #18'
```

Use the matching heading to identify the agenda item. If no row matches, inspect the meeting agenda or try the exact KI title; do not scan the workbook in repeated fixed-size row windows. Then filter:

```bash
"$PY" scripts/3gpp_tdocs.py filter-index \
  --excel "$meeting_cache/index/extracted/<index.xlsx>" \
  --sheet '<sheet name>' \
  --agenda '20.6.22' \
  --source 'Huawei' \
  --output "$meeting_cache/proposals.json"
```

Only include `--source` when the user names a company. It performs a case-insensitive substring match against the Index Source field and keeps joint proposals containing that company name.

Review the resulting JSON. Confirm that document numbers, titles, sources, and statuses are plausible. Exclude withdrawn/unavailable documents unless the user asks to include them. If filtering returns zero or an implausible count, stop and re-inspect the workbook rather than widening the filter silently.

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

Use the available image-viewing tool for extracted/rendered images. Do not infer a signaling direction solely from nearby text when an arrow is not visible.

## 5. Analyze every proposal

List expected and extracted documents and reconcile them before analysis:

```bash
"$PY" scripts/3gpp_tdocs.py coverage \
  --manifest "$meeting_cache/proposals.json" \
  --texts "$meeting_cache/texts"
```

For a large set, analyze batches of roughly 10–15 documents in this same conversation. Do not delegate batches to another Agent. Each proposal analysis must capture:

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

Write the final Markdown under `/workspace/3gpp-review-direct/reports/` or another workspace path requested by the user. Use a descriptive filename such as `<meeting>_KI<ki>.md`. Read the saved report back once, then return the result directly to the user. Do not publish it to a knowledge base.

Recommended structure:

1. Scope, meeting, KI, source count, and coverage;
2. solution/variant overview;
3. company-position comparison;
4. one subsection per proposal;
5. agreements, disagreements, dependencies, and open questions;
6. source/coverage appendix.

Every proposal in the manifest must be either analyzed or listed under failures with a reason. Do not silently omit a TDoc, collapse distinct variants, invent consensus, or present a draft contribution as an adopted specification.

Before delivery, rerun `coverage`, check all figure markers have been considered, and verify that counts in the prose match the manifest.

## Troubleshooting

- HTTP 404: re-open the directory listing and verify case, folder, Index filename, and `Docs/`; do not guess another URL.
- Workbook parse failure: confirm the file is a real XLSX/ZIP and select the correct sheet.
- No matches: inspect raw workbook rows and verify agenda formatting; some cells contain numeric values or surrounding spaces.
- Corrupt TDoc ZIP: delete only that cached ZIP and retry it; preserve other downloads.
- Missing diagram detail: inspect extracted media, then render the original DOCX to PDF/PNG.
- Legacy binary `.vsd`: structured XML extraction is unavailable; use its preview image or rendered document.
- Large KI: maintain a manifest-based coverage ledger and assemble only after every batch reports its handled document numbers.
