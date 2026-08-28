# Meeting status semantics

Treat official Index and meeting-comment fields as evidence, but do not turn workflow states into technical verdicts.

| Normalized status | Meaning allowed in the report | Not justified by status alone |
|---|---|---|
| `available` | Submitted or available for discussion | Agreed, endorsed, or rejected |
| `not_handled` | Not handled in that meeting/session | Rejected on technical merit |
| `postponed` | Deferred to a later time | Rejected or abandoned |
| `revised` | A later revision exists or was requested | Original content was wholly accepted |
| `merged` | Content was incorporated into another TDoc | Every original claim survived the merge |
| `withdrawn` | Submitter withdrew the contribution | Meeting rejected it |
| `baseline` | Identified as draft/baseline material | Formally approved unless approval is separately recorded |
| `approved` | Official status explicitly records approval/agreement | Approval of related claims not present in the approved text |
| `rejected` | Official status explicitly records rejection | Which company opposed it, or why it was rejected |
| `unknown` | Status cannot be safely normalized | Any disposition |

## Outcome rules

- Prefer the final revision's status, but preserve the chain and the earlier document's own status.
- `Merged into X` creates a directed relation to X. Inspect X to determine which ideas remain.
- A co-signed baseline proves participation in that document, not authorship of every underlying idea.
- An Index status and a document's proposed-change wording answer different questions; cite the correct one.
- If the meeting is in progress, or the source list/status is visibly provisional, label the latest result provisional.
- A source name followed by `?`, blank status, missing revision target, or conflicting Index rows is unresolved evidence and must be reported as such.
- Use “未处理”“延期”“合并”“撤回”“基线文本” as the default Chinese labels. Use “被拒绝” only with explicit meeting evidence supporting rejection.
