# Shared Agent configuration

This directory contains the shared production Prompt, 9 Agent definitions and
7 Skill packages exported on 2026-09-07. It can be edited by Codex and synchronized
with the web admin editors when repository sync is enabled.

- Edit `global-prompt.md` for installation-wide instructions.
- Edit `agents/*.yaml` for prompts, runtime settings, tools and Skill bindings.
- Edit `skills/*/SKILL.md` and companion files for reusable Skills.
- Keep filenames and directory keys stable. `skills` in Agent YAML references
  Skill directory keys, not database IDs.
- Use `enabled: false` for an Agent or `archived: true` in Skill frontmatter to
  retire it. Deleting a definition file does not delete its database record.
- Resolve conflicting web/file edits through **仓库配置同步 → 比较版本** in the
  Agent, Skill, or global Prompt admin page.

See [setup and behavior](../docs/agent-config-sync.md). File edits become live
after validation when the directory is mounted and sync is enabled; Git commits
are independent of synchronization.
