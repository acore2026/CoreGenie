const { v4 } = require("uuid");
const {
  getVectorDbClass,
  resolveProviderConnector,
} = require("../../../helpers");
const { DocumentVectors } = require("../../../../models/vectors");
const { Deduplicator } = require("../utils/dedupe");

const GLOBAL_RAG_MEMORY_NAMESPACE = "anythingllm-global-rag-memory";
const MEMORY_TYPE = "rag-memory";
const VALID_SCOPES = new Set(["workspace", "global"]);

function normalizeScope(value = "workspace") {
  const normalized = String(value || "workspace")
    .trim()
    .toLowerCase();
  if (["global", "全局"].includes(normalized)) return "global";
  if (["workspace", "工作区"].includes(normalized)) return "workspace";
  return "workspace";
}

function namespaceForScope(scope, workspace) {
  return normalizeScope(scope) === "global"
    ? GLOBAL_RAG_MEMORY_NAMESPACE
    : workspace.slug;
}

function createMemoryId(scope, workspace) {
  if (normalizeScope(scope) === "global") return `global/${v4()}`;
  return `workspace/${encodeURIComponent(workspace.slug)}/${v4()}`;
}

function publicMemoryId(scope, workspace, docId) {
  if (normalizeScope(scope) === "global") return `global/${docId}`;
  return `workspace/${encodeURIComponent(workspace.slug)}/${docId}`;
}

function isLegacyAgentMemorySource(source = {}) {
  return (
    source?.docAuthor === "@agent" &&
    (source?.title === "agent-memory.txt" ||
      source?.url === "file://embed-via-agent.txt")
  );
}

function resolveMemoryIdentity(memoryId, workspace) {
  const value = String(memoryId || "").trim();
  const globalMatch = value.match(/^global\/([0-9a-f-]{36})$/i);
  if (globalMatch)
    return {
      id: value,
      legacyDocId: globalMatch[1],
      scope: "global",
      namespace: GLOBAL_RAG_MEMORY_NAMESPACE,
    };

  const workspaceMatch = value.match(/^workspace\/([^/]+)\/([0-9a-f-]{36})$/i);
  if (!workspaceMatch)
    throw new Error(
      "Invalid memoryId. Search memory first and use the returned memory ID."
    );

  const ownerSlug = decodeURIComponent(workspaceMatch[1]);
  if (ownerSlug !== workspace.slug)
    throw new Error("This workspace memory belongs to another workspace.");
  return {
    id: value,
    legacyDocId: workspaceMatch[2],
    scope: "workspace",
    namespace: workspace.slug,
  };
}

function scopedSearchResult(result, scope) {
  const contextTexts = Array.isArray(result?.contextTexts)
    ? result.contextTexts
    : [];
  const sources = Array.isArray(result?.sources) ? result.sources : [];
  return contextTexts.map((text, index) => ({
    text,
    scope,
    source: sources[index] ? { ...sources[index], ragScope: scope } : null,
  }));
}

function formatSearchEntry({ text, scope, source }) {
  const memoryId =
    source?.memoryType === MEMORY_TYPE
      ? source.memoryId || source.id || null
      : null;
  if (memoryId)
    return `[RAG MEMORY]\nscope: ${scope}\nmemoryId: ${memoryId}\ndeletable: true\ncontent:\n${text}`;
  return `[RAG DOCUMENT]\nscope: ${scope}\ndeletable: false\ncontent:\n${text}`;
}

async function enrichLegacyMemoryIdentity(entry, workspace) {
  if (!entry?.source || entry.source.memoryType === MEMORY_TYPE) return entry;
  if (!isLegacyAgentMemorySource(entry.source) || !entry.source.id)
    return entry;

  const [mapping] = await DocumentVectors.where(
    { vectorId: entry.source.id },
    1
  );
  if (!mapping?.docId) return entry;
  return {
    ...entry,
    source: {
      ...entry.source,
      memoryId: publicMemoryId(entry.scope, workspace, mapping.docId),
      memoryType: MEMORY_TYPE,
      memoryScope: entry.scope,
    },
  };
}

function mergeMemoryChunks(entries = []) {
  const merged = [];
  const byMemoryId = new Map();
  for (const entry of entries) {
    const memoryId = entry.source?.memoryId;
    if (!memoryId) {
      merged.push(entry);
      continue;
    }
    if (!byMemoryId.has(memoryId)) {
      const copy = { ...entry };
      byMemoryId.set(memoryId, copy);
      merged.push(copy);
      continue;
    }
    const existing = byMemoryId.get(memoryId);
    if (entry.text && !existing.text.includes(entry.text))
      existing.text = `${existing.text}\n\n${entry.text}`;
  }
  return merged;
}

const memory = {
  name: "rag-memory",
  startupConfig: { params: {} },
  plugin: function () {
    return {
      name: this.name,
      setup(aibitat) {
        aibitat.function({
          super: aibitat,
          tracker: new Deduplicator(),
          name: this.name,
          description:
            "Search workspace and global RAG knowledge transparently, store durable RAG memory, or delete a previously stored RAG memory. Search always checks both scopes. Store defaults to workspace; use scope global (全局) only when the user explicitly requests cross-workspace storage. Delete requires the memoryId returned by search or store.",
          examples: [
            {
              prompt: "Check everything we know about the project",
              call: JSON.stringify({
                action: "search",
                content: "project information",
              }),
            },
            {
              prompt: "Remember this for this workspace",
              call: JSON.stringify({
                action: "store",
                content: "The workspace uses release branch R19.",
              }),
            },
            {
              prompt: "全局记住我偏好简洁回答",
              call: JSON.stringify({
                action: "store",
                scope: "全局",
                content: "The user prefers concise answers.",
              }),
            },
            {
              prompt: "Delete the memory with the supplied ID",
              call: JSON.stringify({
                action: "delete",
                memoryId:
                  "workspace/example/00000000-0000-0000-0000-000000000000",
              }),
            },
          ],
          parameters: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["search", "store", "delete"],
                description: "The RAG memory operation to perform.",
              },
              content: {
                type: "string",
                description:
                  "Search query for search, or the exact durable content for store.",
              },
              scope: {
                type: "string",
                enum: ["workspace", "global", "工作区", "全局"],
                description:
                  "Storage scope for store. Omit for workspace. Use global/全局 only when explicitly requested. For delete, scope is inferred from memoryId and this field is only a consistency check.",
              },
              memoryId: {
                type: "string",
                description:
                  "For delete, the exact scope-bearing memoryId returned by search or store.",
              },
            },
            required: ["action"],
            additionalProperties: false,
          },
          handler: async function ({
            action = "",
            content = "",
            scope = "",
            memoryId = "",
          }) {
            try {
              const dedupePayload = { action, content, scope, memoryId };
              const { isDuplicate } = this.tracker.isDuplicate(
                this.name,
                dedupePayload
              );
              if (isDuplicate)
                return "This duplicated RAG memory operation was ignored.";

              let response = "There was nothing to do.";
              if (action === "search") response = await this.search(content);
              if (action === "store")
                response = await this.store(content, scope);
              if (action === "delete")
                response = await this.delete(memoryId, scope);

              this.tracker.trackRun(this.name, dedupePayload);
              return response;
            } catch (error) {
              this.super.handlerProps.log(
                `rag-memory ${action || "operation"} raised an error. ${error.message}`
              );
              return `The RAG memory operation failed: ${error.message}`;
            }
          },
          search: async function (query = "") {
            const cleanQuery = String(query || "").trim();
            if (!cleanQuery)
              return "A non-empty memory search query is required.";

            const workspace = this.super.handlerProps.invocation.workspace;
            const { connector: LLMConnector } = await resolveProviderConnector({
              workspace,
              prompt: cleanQuery,
            });
            const vectorDB = getVectorDbClass();
            const searchScope = async (scope) => {
              try {
                const result = await vectorDB.performSimilaritySearch({
                  namespace: namespaceForScope(scope, workspace),
                  input: cleanQuery,
                  LLMConnector,
                  topN: workspace?.topN ?? 4,
                  rerank: workspace?.vectorSearchMode === "rerank",
                });
                const scoped = scopedSearchResult(result, scope);
                return await Promise.all(
                  scoped.map((entry) =>
                    enrichLegacyMemoryIdentity(entry, workspace)
                  )
                );
              } catch (error) {
                this.super.handlerProps.log(
                  `rag-memory search skipped ${scope} scope: ${error.message}`
                );
                return [];
              }
            };

            const [workspaceResults, globalResults] = await Promise.all([
              searchScope("workspace"),
              searchScope("global"),
            ]);
            const results = mergeMemoryChunks([
              ...workspaceResults,
              ...globalResults,
            ]);
            if (!results.length) {
              this.super.introspect(
                `${this.caller}: No workspace or global RAG context matched.`
              );
              return "No matching workspace or global RAG context was found.";
            }

            const sources = results
              .map((entry) => entry.source)
              .filter(Boolean);
            this.super.addCitation?.(sources);
            const scopes = [...new Set(results.map((entry) => entry.scope))];
            this.super.addContextTrace?.({
              kind: "memory",
              title: "RAG memory recalled",
              detail: `${results.length} result${
                results.length === 1 ? "" : "s"
              } from ${scopes.join(" + ")}`,
              scopes,
              count: results.length,
            });
            this.super.introspect(
              `${this.caller}: Recalled ${results.length} result(s) from ${scopes.join(" and ")} RAG memory.`
            );

            return `Recalled RAG context:\n\n${results
              .map(formatSearchEntry)
              .join("\n\n")}`;
          },
          store: async function (content = "", requestedScope = "") {
            const cleanContent = String(content || "").trim();
            if (!cleanContent) return "Non-empty memory content is required.";

            const workspace = this.super.handlerProps.invocation.workspace;
            const scope = normalizeScope(requestedScope || "workspace");
            if (!VALID_SCOPES.has(scope)) return "Invalid memory scope.";
            const namespace = namespaceForScope(scope, workspace);
            const memoryId = createMemoryId(scope, workspace);
            const vectorDB = getVectorDbClass();
            const result = await vectorDB.addDocumentToNamespace(
              namespace,
              {
                docId: memoryId,
                id: memoryId,
                memoryId,
                memoryType: MEMORY_TYPE,
                memoryScope: scope,
                url: `memory://${scope}/${encodeURIComponent(memoryId)}`,
                title:
                  scope === "global"
                    ? "global-agent-memory.txt"
                    : "workspace-agent-memory.txt",
                docAuthor: "@agent",
                description: `${scope} RAG memory stored by the Agent.`,
                docSource: `${scope} RAG memory`,
                chunkSource: `memory://${scope}`,
                published: new Date().toISOString(),
                wordCount: cleanContent.split(/\s+/).length,
                pageContent: cleanContent,
                token_count_estimate: 0,
              },
              null
            );

            if (!result?.vectorized || result?.error)
              return `The ${scope} memory could not be embedded: ${
                result?.error || "unknown vector database error"
              }`;

            this.super.addContextTrace?.({
              kind: "memory-store",
              title: `${scope === "global" ? "Global" : "Workspace"} memory stored`,
              detail: `Memory ID ${memoryId}`,
              scopes: [scope],
              count: 1,
            });
            this.super.introspect(
              `${this.caller}: Stored durable ${scope} RAG memory.`
            );
            return `Stored ${scope} RAG memory successfully. memoryId: ${memoryId}`;
          },
          delete: async function (memoryId = "", requestedScope = "") {
            const workspace = this.super.handlerProps.invocation.workspace;
            const identity = resolveMemoryIdentity(memoryId, workspace);
            if (
              requestedScope &&
              normalizeScope(requestedScope) !== identity.scope
            )
              return `The requested scope does not match memoryId ${identity.id}.`;

            let storedDocId = identity.id;
            let knownVectors = await DocumentVectors.where({
              docId: storedDocId,
            });
            if (!knownVectors.length && identity.legacyDocId) {
              const vectorDB = getVectorDbClass();
              const legacyMetadata =
                (await vectorDB.getDocumentMetadata?.(
                  identity.namespace,
                  identity.legacyDocId
                )) || [];
              if (legacyMetadata.some(isLegacyAgentMemorySource)) {
                storedDocId = identity.legacyDocId;
                knownVectors = await DocumentVectors.where({
                  docId: storedDocId,
                });
              }
            }
            if (!knownVectors.length)
              return `No deletable RAG memory was found for memoryId ${identity.id}.`;

            const vectorDB = getVectorDbClass();
            const deleted = await vectorDB.deleteDocumentFromNamespace(
              identity.namespace,
              storedDocId
            );
            if (deleted === false)
              return `Failed to delete RAG memory ${identity.id}.`;
            await DocumentVectors.delete({ docId: storedDocId });

            this.super.addContextTrace?.({
              kind: "memory-delete",
              title: `${identity.scope === "global" ? "Global" : "Workspace"} memory deleted`,
              detail: `Memory ID ${identity.id}`,
              scopes: [identity.scope],
              count: 1,
            });
            this.super.introspect(
              `${this.caller}: Deleted ${identity.scope} RAG memory.`
            );
            return `Deleted ${identity.scope} RAG memory ${identity.id}.`;
          },
        });
      },
    };
  },
};

module.exports = {
  GLOBAL_RAG_MEMORY_NAMESPACE,
  createMemoryId,
  memory,
  mergeMemoryChunks,
  namespaceForScope,
  normalizeScope,
  publicMemoryId,
  resolveMemoryIdentity,
};
