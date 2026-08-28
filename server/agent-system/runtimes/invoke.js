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
  maxLocalToolCalls = 250,
  resume = null,
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
      resume,
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
  return result;
}

module.exports = { invokeAgentRuntime };
