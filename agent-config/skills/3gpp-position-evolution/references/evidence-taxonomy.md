# Position and opposition evidence

An event represents one company's stance toward one claim or issue dimension at one point in time. Do not assign one permanent stance to a company when evidence is issue-specific.

## Event schema

Write UTF-8 JSON Lines. Each non-empty line must be an object:

```json
{
  "company": "Example Corp",
  "targetCompany": "Huawei",
  "meeting": "SA2#175-AH-e",
  "dimension": "NW-Agent terminology",
  "stance": "oppose",
  "strength": "explicit",
  "primaryOpponent": true,
  "claim": "Requests removal of the proposed standardized term.",
  "evidence": {
    "tdoc": "S2-2606200",
    "sourceType": "meeting-comment",
    "locator": "TdocsByAgenda comment",
    "text": "Short quotation or precise paraphrase"
  }
}
```

`stance` is one of:

- `support`: explicitly endorses, co-proposes, or argues for the target claim;
- `oppose`: explicitly requests rejection, removal, replacement, or non-agreement;
- `concern`: raises a risk, question, dependency, reservation, or unresolved issue;
- `alternative`: proposes a competing design without explicit evidence of opposition;
- `neutral`: editorial or factual interaction without a directional position.

`strength` is one of:

- `explicit`: direct language or a formal meeting disposition supports the classification;
- `strong`: multiple concrete technical actions imply the classification, but no direct opposition language exists;
- `weak`: tentative inference or incomplete evidence.

## Hard classification rules

- `primaryOpponent: true` requires `stance: "oppose"` and `strength: "explicit"`.
- Use `oppose` only with explicit evidence. Reclassify inferred disagreement as `concern` or `alternative`.
- Co-signing a merged/baseline TDoc is support for that document, not automatically for every earlier proposal.
- A revision submitted by another company is not opposition unless its evidence explicitly rejects or replaces the target claim.
- Absence of a company's name is not opposition or support.
- Split mixed evidence into separate dimensions such as architecture, terminology, interface, procedure granularity, operator control, security, or deployment dependency.
- Keep `evidence.text` short. The TDoc plus locator is the durable citation; a long copied passage is not needed.

## Synthesis

List “主要反对者” only from validated primary-opponent events. Separately report:

1. explicit opponents and the exact issue opposed;
2. companies with material reservations;
3. competing-route proponents;
4. explicit supporters or co-proponents;
5. evidence gaps and changing positions over time.
