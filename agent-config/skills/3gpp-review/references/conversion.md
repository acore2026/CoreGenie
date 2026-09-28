## Conversion mode: DOCX to Markdown package

Use conversion mode when the active Agent or user asks to convert a proposal rather than analyze its technical position. Conversion mode is a faithful format conversion: do not add a proposal summary, infer missing diagram content, or publish the result to the knowledge base.

The input is either an uploaded DOCX at the exact path supplied in `<workspace_files>` (normally `/workspace/uploads/<upload-id>/<proposal>.docx`) or a DOCX downloaded from an official 3GPP meeting directory. Copy that complete path into the conversion call; never remove its upload ID or move it to a guessed inbox. Only accept DOCX in this mode. If a TDoc number does not identify one official file, ask for the working group or meeting instead of guessing.

When `3gpp.convert-markdown` is available, use it once with either the TDoc number or uploaded DOCX path. It searches the official yearly meeting directories, downloads the exact TDoc, runs the converter, checks the output files, and attaches the ZIP. Do not repeat the same work with Bash after this tool succeeds.

Create a new run directory and invoke the bundled converter:

```bash
run_id="$(date -u +%Y%m%dT%H%M%SZ)"
result="/workspace/3gpp-markdown/results/$run_id"
mkdir -p "$result"
python3 scripts/3gpp_tdocs.py convert-docx \
  --input "/workspace/uploads/<upload-id>/<proposal>.docx" \
  --output "$result"
```

The command creates Markdown, `assets/`, `embedded/`, `conversion-summary.json`, and a sibling ZIP. It preserves headings, paragraphs, common inline formatting, links, tables, images, and embedded objects where the DOCX contains them. VSD/VSDX objects are kept in `embedded/`; when LibreOffice and `pdftoppm` can render them, PNG previews are also added. EMF/WMF files and unreadable objects are kept as files and listed in the conversion warnings. Never replace a diagram with Mermaid.

After conversion, read `conversion-summary.json`, confirm the Markdown and ZIP exist, and report the ZIP path plus any warnings. Do not run the proposal-analysis coverage or `knowledge.publish` steps in conversion mode.
