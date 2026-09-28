# Repository configuration sync

An optional, single-process synchronizer connects the admin web editors to a
writable local repository directory. It scans every two seconds, and also
reconciles after web saves. Git commits, pushes and pulls remain normal developer
operations.

## Configuration

Set `AGENT_CONFIG_SYNC_ENABLED=true` and `AGENT_CONFIG_SYNC_DIR` to an absolute
directory visible to the server. The directory must be writable by the server
user. Only grant access to trusted configuration authors: Skill scripts are
executable application configuration.

For Docker, the startup script accepts an existing host directory and mounts it
at `/app/agent-config`. For example, when deploying an image containing this code:

```bash
AGENT_CONFIG_SYNC_ENABLED=true \
AGENT_CONFIG_SYNC_DIR=/root/anything-llm/agent-config \
APP_RECREATE=true ./start-anythingllm.sh
```

The environment is read when the server starts. Recreate an existing container
when changing mounts or environment settings. Keep the configuration directory
separate from `STORAGE_DIR`. Do not run multiple synchronizers against the same
directory/database.

## Files

```text
agent-config/
  global-prompt.md
  agents/<stable-key>.yaml
  quick-tasks/<stable-key>.yaml
  skills/<stable-key>/SKILL.md
  skills/<stable-key>/scripts/...
  skills/<stable-key>/references/...
```

Agent YAML fields are `name`, `description`, `welcomeMessage`, `examplePrompts`,
`tools` (null for all enabled tools), `skills` (directory keys),
`quickTasks` (shared task file keys), `systemPrompt`,
`runtimeKey`, `runtimeConfig`, `enabled`, and `showInRoster`. `enabled` controls
whether the Agent can run or receive delegated work. `showInRoster` controls
user-facing Agent lists only and defaults to `true`. Store multiline prompts
with YAML block strings. Keys are lowercase letters/numbers separated by
hyphens. Keep file/directory keys stable when changing display names.
Agent delegation is available to callers with `tools: null`; callers using an
explicit tool list must include `agent.call`. Hidden, enabled Agents remain
valid delegation targets.

Skill packages keep normal SKILL.md frontmatter, instructions, scripts and binary
assets. An optional top-level `archived: true` frontmatter field controls archive
state and is stripped from the runtime package. Resource removal creates a full
replacement revision. Existing revisions remain in runtime storage.

Shared prompts and Agent/Skill/quick-task configuration are synchronized. User/workspace
private content, credentials, chat history, icons and the installation's default
Agent selection are not exported.

Quick tasks live in `quick-tasks/<stable-key>.yaml`; the file key must match the
form's `id`. A task contains `version`, `id`, `title`, `instructions`, `fields`,
and optional `description` and `archived`. Bind the same task to multiple Agents
using, for example, `quickTasks: [proposal-topic-analysis]`. The database stores
these bindings as `quickTaskIds`; numeric database IDs do not belong in YAML.
Skills and quick tasks are imported before Agents. A binding must refer to an
existing task. Each Agent supports at most 12 tasks and 180000 serialized
characters in total (40000 per task). Archived tasks keep their bindings but
are hidden from users. Edit and preview tasks at `/settings/agents/quick-tasks`.

Legacy inline `wizard` forms are migrated to shared tasks while preserving their
contents. See [任务向导配置](agent-wizard.md) for the form schema and client
compatibility rules.

## First synchronization and conflicts

An empty directory is populated from the database. Existing files are compared
before use. Existing Agents are associated by an unambiguous name on first use;
after that, a mapping in system settings preserves their database identity.
Ambiguous initial names must be made unique before importing.

The last synchronized hash is stored in the database. A change on one side is
copied to the other. Different changes on both sides create a conflict. The admin
Agent, Skill and global Prompt pages contain **仓库配置同步**: expand it, choose
**比较版本**, inspect the versions, then select **使用文件版本** or
**使用数据库版本**. Resolution checks both hashes again, so stale comparison
screens cannot overwrite newer content.

Invalid files keep the last valid database configuration active. Fix the file
and let the next scan retry. Missing definition files do not delete records; use
the database version in the panel to restore them. Retire an Agent using
`enabled: false`, or a Skill or quick task using `archived: true`. With sync enabled, the web
Agent delete operation disables the record so its file and run history survive.

Pending exports retry on subsequent scans and after restart. File writes use
temporary files/directory replacement. Successful imports and their identity
mapping commit together. One process serializes web configuration saves and sync
operations; unsupported direct SQL writes are detected by the periodic comparison
but do not participate in that lock.

`agent-config/` is the single maintained source for shared definitions. The old
`server/agent-skills/examples/` packages and embedded Agent seed prompts have been
removed. Docker bundles the same directory at `/app/agent-config`; the writable
repository mount takes its place when synchronization is enabled.

Without synchronization, initialization reads these files once per
`agent_config_seed_v11` version in `server/agent-skills/seed.js`. It imports all
bundled Skills, quick tasks and Agents, resolves portable bindings and legacy names, and
keeps existing IDs, icons and the installation's default Agent selection. Existing
global prompts are preserved. Later web edits survive restarts; bump the seed
version when intentionally updating bundled definitions for non-sync installs.
Skill/quick-task/Agent imports and the version marker share one database transaction.

Built-in seed updates are bypassed while synchronization is enabled. Historical
database migrations remain unchanged; they are not editable configuration sources.
Runtime database records and revision storage still exist outside the repository.
New runs pin assigned global Skill revisions; recovery loads those revisions
instead of the current edited package. Workspace-private Skills retain their
existing revision-change behavior.

Edits to the mounted working directory become live after validation, including
changes made by Git checkout. Update the complete Agent/Skill package together;
pause synchronization by disabling the feature and restarting before a large,
multi-step migration that must become visible as one release.
