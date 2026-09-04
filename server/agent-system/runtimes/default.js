const { Command } = require("@langchain/langgraph");
const { buildAgentGraph } = require("../graph");
const { finalText, userContent } = require("../message");
const { retrieveWorkspaceContext } = require("../../tools/rag");
const { withRetrieverTrace } = require("../observability");
const { consumeGraphStream } = require("./stream");
const {
  activatedSkillsPrompt,
  restoreActivatedSkills,
} = require("../activatedSkills");
const { recursionLimitFor } = require("../executionLimits");

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
  onAssistantTurn,
  budget = null,
  activatedSkillScope = null,
  inheritedSkills = [],
  depth = 0,
  maxLocalToolCalls = null,
}) {
  const sharedBudget = budget || {
    calls: 0,
    subagentCalls: 0,
    actionTail: Promise.resolve(),
  };
  const skillScope =
    activatedSkillScope || sharedBudget.activatedSkills || new Map();
  await restoreActivatedSkills(inheritedSkills, workspace, skillScope);
  const inheritedSkillContext = activatedSkillsPrompt(inheritedSkills);
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
    await onAssistantTurn?.({ turnId: "turn-1" });
    await onToken(text, { turnId: "turn-1" });
    return { kind: "completed", text, sources: [] };
  }

  const graph = await buildAgentGraph({
    run,
    workspace,
    user,
    agent,
    emit,
    signal,
    budget: sharedBudget,
    activatedSkillScope: skillScope,
    depth,
    maxLocalToolCalls,
    systemPromptOverride: [
      run.runtimeSnapshot?.systemPrompt || null,
      inheritedSkillContext || null,
    ]
      .filter(Boolean)
      .join("\n\n"),
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
  let currentTurnId = null;
  const graphRun = await graph.stream(graphInput, {
    ...runnableConfig,
    streamMode: ["messages", "values"],
    configurable: { thread_id: run.checkpointThreadId },
    recursionLimit: recursionLimitFor(
      run,
      Math.min((run.configuration?.maxToolCalls || 2_500) * 2 + 100, 5_500)
    ),
    signal,
  });
  const finalState = await consumeGraphStream(
    graphRun,
    async (token, { turnId } = {}) => {
      if (currentTurnId && currentTurnId !== turnId)
        streamedText += streamedText.endsWith("\n") ? "\n" : "\n\n";
      currentTurnId = turnId || currentTurnId;
      streamedText += token;
      await onToken(token, { turnId });
    },
    {
      onTurnStart: async ({ turnId }) => {
        await onAssistantTurn?.({ turnId });
      },
    }
  );
  const pendingInterrupt = finalState?.__interrupt__?.[0]?.value;
  if (pendingInterrupt)
    return { kind: "interrupt", interrupt: pendingInterrupt, sources };
  return {
    kind: "completed",
    text: streamedText || finalText(finalState),
    sources,
  };
}

module.exports = { executeSegment };
