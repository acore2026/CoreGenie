const { createRuntimeSnapshot } = require("../runtimeSnapshot");
const { requireRuntime } = require("./registry");

async function invokeAgentRuntime({
  parentRun,
  workspace,
  user,
  agent,
  prompt,
  checkpointThreadId,
  emit,
  signal,
  runnableConfig = {},
  budget = null,
  depth = 0,
  maxLocalToolCalls = 50,
}) {
  const snapshot = await createRuntimeSnapshot({
    agent,
    workspace,
    user,
    configuration: parentRun.configuration,
  });
  const run = {
    ...parentRun,
    agent_id: agent.id,
    prompt: String(prompt),
    attachments: [],
    checkpointThreadId,
    configuration: {
      ...parentRun.configuration,
      recover: false,
      resume: null,
    },
    ...snapshot,
  };
  const { runtime } = requireRuntime(run.runtimeKey, run.runtimeVersion);
  const result = await runtime.executeSegment({
    run,
    workspace,
    user,
    thread: null,
    agent: snapshot.runtimeSnapshot.agent,
    history: [],
    emit,
    signal,
    runnableConfig,
    onToken: async () => null,
    budget,
    depth,
    maxLocalToolCalls,
  });
  if (result.kind === "interrupt")
    throw new Error(
      "A delegated Agent requested interactive input; delegated runs must complete without interaction."
    );
  return result;
}

module.exports = { invokeAgentRuntime };
