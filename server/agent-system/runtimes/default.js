const { Command } = require("@langchain/langgraph");
const { buildAgentGraph } = require("../graph");
const { finalText, userContent } = require("../message");
const { retrieveWorkspaceContext } = require("../../tools/rag");
const { withRetrieverTrace } = require("../observability");
const { consumeGraphStream } = require("./stream");

async function executeSegment({
  run,
  workspace,
  user,
  agent,
  history,
  emit,
  signal,
  runnableConfig,
  onToken,
  budget = null,
  depth = 0,
  maxLocalToolCalls = null,
}) {
  let sources = [];
  let retrievedContext = [];
  if (["query", "chat"].includes(run.mode)) {
    const retrieved = await withRetrieverTrace(
      "retrieve-workspace-context",
      { query: run.prompt, workspaceId: workspace.id },
      () =>
        retrieveWorkspaceContext({
          workspace,
          user,
          thread: run.thread_id ? { id: run.thread_id } : null,
          query: run.prompt,
        })
    );
    retrievedContext = retrieved.map((entry) => entry.text).filter(Boolean);
    sources = retrieved.map((entry) => entry.source).filter(Boolean);
    await emit("context.rag.recalled", {
      count: retrievedContext.length,
      sources,
    });
  }

  if (run.mode === "query" && retrievedContext.length === 0) {
    const text =
      workspace.queryRefusalResponse ||
      "There is no relevant information in this workspace to answer your query.";
    await onToken(text);
    return { kind: "completed", text, sources: [] };
  }

  const graph = await buildAgentGraph({
    run,
    workspace,
    user,
    agent,
    emit,
    signal,
    budget,
    depth,
    maxLocalToolCalls,
    systemPromptOverride: run.runtimeSnapshot?.systemPrompt || null,
  });
  const resume = run.configuration?.resume || null;
  const graphInput = run.configuration?.recover
    ? null
    : resume
      ? new Command({ resume })
      : {
          messages: [
            ...history,
            {
              role: "user",
              content: userContent(
                retrievedContext.length
                  ? `${run.prompt}\n\n<retrieved_context>\n${retrievedContext
                      .map(
                        (text, index) =>
                          `<document index="${index + 1}">\n${text}\n</document>`
                      )
                      .join("\n")}\n</retrieved_context>`
                  : run.prompt,
                run.attachments
              ),
            },
          ],
        };
  let streamedText = "";
  const graphRun = await graph.stream(graphInput, {
    ...runnableConfig,
    streamMode: ["messages", "values"],
    configurable: { thread_id: run.checkpointThreadId },
    recursionLimit: Math.min(
      (run.configuration?.maxToolCalls || 500) * 2 + 20,
      1_100
    ),
    signal,
  });
  const finalState = await consumeGraphStream(graphRun, async (token) => {
    streamedText += token;
    await onToken(token);
  });
  const pendingInterrupt = finalState?.__interrupt__?.[0]?.value;
  if (pendingInterrupt)
    return { kind: "interrupt", interrupt: pendingInterrupt, sources };
  return {
    kind: "completed",
    text: finalText(finalState) || streamedText,
    sources,
  };
}

module.exports = { executeSegment };
