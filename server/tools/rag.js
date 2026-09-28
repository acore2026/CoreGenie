const { z } = require("zod");
const { defineTool } = require("./descriptor");
const {
  getVectorDbClass,
  resolveProviderConnector,
} = require("../utils/helpers");
const { WorkspaceParsedFiles } = require("../models/workspaceParsedFiles");
const { GLOBAL_KNOWLEDGE_NAMESPACE } = require("../utils/globalKnowledge");

function scopedEntries(result, scope) {
  return (result?.contextTexts || []).map((text, index) => ({
    text,
    source: result.sources?.[index]
      ? { ...result.sources[index], ragScope: scope }
      : { ragScope: scope },
  }));
}

function mergeVectorEntries(workspaceEntries, globalEntries, limit) {
  const merged = [];
  const seen = new Set();
  const queues = [workspaceEntries, globalEntries];
  while (merged.length < limit && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      const entry = queue.shift();
      if (!entry) continue;
      const key = `${entry.source?.id || entry.source?.url || ""}\0${entry.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(entry);
      if (merged.length >= limit) break;
    }
  }
  return merged;
}

async function searchNamespace(VectorDb, namespace, options, scope) {
  if (!(await VectorDb.hasNamespace(namespace))) return [];
  const result = await VectorDb.performSimilaritySearch({
    namespace,
    ...options,
  });
  if (result?.message) throw new Error(result.message);
  return scopedEntries(result, scope);
}

async function retrieveSharedVectorContext({
  workspace,
  user,
  thread,
  query,
  LLMConnector = null,
  filterIdentifiers = [],
  topN = workspace.topN || 4,
  similarityThreshold = workspace.similarityThreshold,
}) {
  const VectorDb = getVectorDbClass();
  const connector =
    LLMConnector ||
    (await resolveProviderConnector({ workspace, prompt: query, user, thread }))
      .connector;
  const common = {
    input: query,
    LLMConnector: connector,
    similarityThreshold,
    topN,
    rerank: workspace.vectorSearchMode === "rerank",
  };
  const [workspaceEntries, globalEntries] = await Promise.all([
    searchNamespace(
      VectorDb,
      workspace.slug,
      { ...common, filterIdentifiers },
      "workspace"
    ),
    searchNamespace(VectorDb, GLOBAL_KNOWLEDGE_NAMESPACE, common, "global"),
  ]);
  return mergeVectorEntries(workspaceEntries, globalEntries, topN);
}

async function retrieveWorkspaceContext({ workspace, user, thread, query }) {
  const parsed = await WorkspaceParsedFiles.getContextFiles(
    workspace,
    thread || null,
    user || null
  );
  const parsedContext = parsed.map(({ pageContent, ...metadata }) => ({
    text: pageContent,
    source: { ...metadata, text: pageContent.slice(0, 1_000) },
  }));

  const vectorContext = await retrieveSharedVectorContext({
    workspace,
    user,
    thread,
    query,
  });
  return [...parsedContext, ...vectorContext];
}

const knowledgeSearch = defineTool({
  id: "knowledge.search",
  name: "knowledge_search",
  description:
    "Search the current Workspace and shared global RAG knowledge bases. This retrieves relevant passages from documents that were previously ingested or published; it does not store personal memory or add new documents.",
  schema: z.object({ query: z.string().min(1) }),
  action: false,
  execute: async ({ query }, context) => {
    const results = await retrieveWorkspaceContext({
      workspace: context.workspace,
      user: context.user,
      thread: context.run.thread_id ? { id: context.run.thread_id } : null,
      query,
    });
    await context.emit("context.rag.recalled", {
      count: results.length,
      sources: results.map((entry) => entry.source).filter(Boolean),
    });
    return results;
  },
});

module.exports = {
  mergeVectorEntries,
  retrieveSharedVectorContext,
  retrieveWorkspaceContext,
  knowledgeSearch,
};
