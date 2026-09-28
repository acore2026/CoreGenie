# Shared Agent configuration

This directory contains the shared production Prompt, 10 Agent definitions and
9 Skill packages. It can be edited by Codex and synchronized
with the web admin editors when repository sync is enabled.

This is the only maintained source of shared Prompt, Agent and Skill definitions
in the repository. Server initialization and package tests read these same files;
there are no separate seed templates. Docker bundles this directory at
`/app/agent-config`, and the live repository mount replaces that bundle when sync
is enabled.

- Edit `global-prompt.md` for installation-wide instructions.
- Edit `agents/*.yaml` for prompts, runtime settings, tools and Skill bindings.
- Add reusable branching task forms under `quick-tasks/*.yaml`, then bind them
  to Agents with `quickTasks`. See [任务向导配置](../docs/agent-wizard.md).
  The generated prompt is added to a user-editable chat draft, never sent
  automatically.
- Edit `skills/*/SKILL.md` and companion files for reusable Skills.
- Keep filenames and directory keys stable. `skills` in Agent YAML references
  Skill directory keys, not database IDs.
- `enabled` controls whether an Agent can run or be called by another Agent.
  `showInRoster` only controls whether users see it in Agent lists. Keep an
  internal specialist enabled with `showInRoster: false` so other Agents can
  delegate to it without adding it to the user-facing roster.
- A caller with `tools: null` can use Agent delegation. For an explicit tool
  list, add `agent.call`; the target still must be enabled.
- Use `enabled: false` for an Agent or `archived: true` in Skill frontmatter to
  retire it. Deleting a definition file does not delete its database record.
- Resolve conflicting web/file edits through **仓库配置同步 → 比较版本** in the
  Agent, Skill, or global Prompt admin page.

See [setup and behavior](../docs/agent-config-sync.md). File edits become live
after validation when the directory is mounted and sync is enabled; Git commits
are independent of synchronization.

## Skill organization

Agent YAML defines the task scope, runtime, tools, and bound Skills. Keep analytical
rules in Skills rather than duplicating them in Agent prompts. `SKILL.md` selects
the mode and relevant references; deterministic document operations live in scripts.

| Skill | Responsibility | Dependencies |
| --- | --- | --- |
| `3gpp-lookup` | Short official meeting facts | Meeting resolver |
| `3gpp-review` | Source acquisition, revision-preserving extraction, DOCX conversion, proposal analysis | Packaged helper; mode references |
| `3gpp-feature-matrix` | Evidence records and company matrices | `3gpp-review` source preparation and stance rules |
| `3gpp-position-evolution` | Meeting timelines, relations and outcomes | `3gpp-review` source preparation and stance rules |
| `3gpp-proposal-evolution` | Two-meeting relations, new content and delegated per-chain analysis against user-supplied viewpoints | `3gpp-review`; hidden proposal analysis Agent |
| `3gpp-doc2md` | Batch conversion selection, checkpoints and failed-item retries | `3gpp-review` converter |
| `3gpp-review-direct` | Continuous execution experiment | `3gpp-review` helper; ReAct runtime |
| `3gpp-split-docx` | Preserve body blocks and DOCX relationships while splitting | Own packaged splitter |
| `3gpp-proposal-ppt` | Source-linked proposal cards, editable PPTX, rendered-page review | `3gpp-review` source indexes; Python PPTX and LibreOffice sandbox dependencies |

Shared stance definitions are maintained only in
`skills/3gpp-review/references/stance-evidence.md`. Dependent Agents must bind
`3gpp-review`; resource reads identify that activated package explicitly.
Data preparation does not publish intermediate reports. File-set/hash coverage
does not prove that a report's conclusions are supported: source interpretation
and citation checks remain separate.

The batch converter currently supports DOCX. Legacy DOC can be staged through an
available LibreOffice installation; PDF/PPTX are reported as unsupported, rather
than silently losing diagrams. Splitting retains all original auxiliary parts;
it is not a redaction tool and does not guarantee identical pagination.

The PPT Skill is bound to the existing `3gpp-general` Agent, whose uploads retain
the original workspace files so diagrams and embedded objects remain available. It generates PPTX
output; this does not add PPTX-to-Markdown input conversion. Rebuild the sandbox
image for python-pptx, Impress/Draw and Chinese fonts. Existing images are not
modified automatically. Deck generation and rendering leave a draft until an
actual page-by-page review is recorded against the exact deck and image hashes.
The source index produced by review maps images (including table-cell images)
to body blocks; proposal cards reuse this index rather than another extractor.

Regression tests live in `server/__tests__/agent-skills/`; the publication and
runtime configuration checks live in `server/__tests__/tools/knowledge.test.js`
and `server/__tests__/agent-system/runtimeRegistry.test.js`. Python cache files
are excluded from package resources and revision hashes.
