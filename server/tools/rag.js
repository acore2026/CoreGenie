const { z } = require("zod");
const { defineTool } = require("./descriptor");
const {
  getVectorDbClass,
  resolveProviderConnector,
} = require("../utils/helpers");
const { WorkspaceParsedFiles } = require("../models/workspaceParsedFiles");

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

  const VectorDb = getVectorDbClass();
  const hasNamespace = await VectorDb.hasNamespace(workspace.slug);
  if (!hasNamespace) return parsedContext;
  const { connector: LLMConnector } = await resolveProviderConnector({
    workspace,
    prompt: query,
    user,
    thread,
  });
  const result = await VectorDb.performSimilaritySearch({
    namespace: workspace.slug,
    input: query,
    LLMConnector,
    similarityThreshold: workspace.similarityThreshold,
    topN: workspace.topN || 4,
    rerank: workspace.vectorSearchMode === "rerank",
  });
  if (result?.message) throw new Error(result.message);
  return [
    ...parsedContext,
    ...(result.contextTexts || []).map((text, index) => ({
      text,
      source: result.sources?.[index] || null,
    })),
  ];
}

const ragSearch = defineTool({
  id: "rag.search",
  name: "rag_search",
  description:
    "Search documents and parsed files in the current workspace knowledge base.",
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

module.exports = { retrieveWorkspaceContext, ragSearch };
