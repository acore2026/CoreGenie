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
  skills/<stable-key>/SKILL.md
  skills/<stable-key>/scripts/...
  skills/<stable-key>/references/...
```

Agent YAML fields are `name`, `description`, `welcomeMessage`, `examplePrompts`,
`tools` (null for all enabled tools), `skills` (directory keys), `systemPrompt`,
`runtimeKey`, `runtimeConfig`, and `enabled`. Store multiline prompts with YAML
block strings. Keys are lowercase letters/numbers separated by hyphens. Keep
file/directory keys stable when changing display names.

Skill packages keep normal SKILL.md frontmatter, instructions, scripts and binary
assets. An optional top-level `archived: true` frontmatter field controls archive
state and is stripped from the runtime package. Resource removal creates a full
replacement revision. Existing revisions remain in runtime storage.

Shared prompts and Agent/Skill configuration are synchronized. User/workspace
private content, credentials, chat history, icons and the installation's default
Agent selection are not exported.

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
`enabled: false`, or a Skill using `archived: true`. With sync enabled, the web
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
`agent_config_seed_v1` version in `server/agent-skills/seed.js`. It imports all
bundled Skills and Agents, resolves portable Skill bindings and legacy names, and
keeps existing IDs, icons and the installation's default Agent selection. Existing
global prompts are preserved. Later web edits survive restarts; bump the seed
version when intentionally updating bundled definitions for non-sync installs.
Skill/Agent imports and the version marker share one database transaction.

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
