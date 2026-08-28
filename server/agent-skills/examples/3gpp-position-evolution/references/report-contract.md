# Longitudinal report contract

Generate a Chinese Markdown report whose claims can be audited without rereading every document.

## Required sections

1. **执行摘要** — stable company thesis, most important evolution, primary explicit opposition, and latest standardization state.
2. **范围与时效性** — WG, study/KI/topic, company aliases, meeting interval, snapshot time, and whether latest evidence is provisional.
3. **来源覆盖** — expected/obtained/extracted/failed TDocs and meetings with zero relevant documents.
4. **公司立场** — distinguish stable principles, changed positions, co-signed text, and analyst inference.
5. **演进时间线** — meeting, TDoc lineage, technical change, terminology change, external response, and outcome.
6. **技术路线演进** — functions, interfaces, procedures, operator control, fallback/determinism, and deployment assumptions.
7. **术语演进** — observed terms, definition changes, first/last evidence, and whether rename/replacement is proven or inferred.
8. **支持、反对与竞争路线** — issue-dimension matrix with evidence strength. Do not mix explicit opposition, concerns, and alternatives.
9. **标准化结果** — accepted, merged, revised, postponed, not handled, withdrawn, baseline, rejected with explicit evidence, or unknown.
10. **未决问题与置信度** — missing documents, unreadable figures, conflicting metadata, and provisional conclusions.
11. **证据附录** — complete TDoc ledger and relation chains used in the report.

## Citation and wording rules

- Attach a TDoc number or official meeting artifact to every material factual claim.
- Use short evidence paraphrases; quote only when exact wording is necessary to prove stance.
- Label interpretations as interpretations.
- Do not use document count as a proxy for company influence or consensus.
- Do not call a draft contribution “3GPP decided” without meeting outcome evidence.
- Report opposition by dimension: a company may support the goal and oppose one mechanism.
- State the report snapshot time prominently so an incremental rerun can explain later changes.

## Minimum timeline columns

| Meeting | Target-company TDocs | Technical change | Terminology change | External response | Outcome/evidence |
|---|---|---|---|---|---|

## Minimum stance columns

| Company | Dimension | Stance | Strength | Evidence | Interpretation |
|---|---|---|---|---|---|
