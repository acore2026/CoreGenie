const { createRuntimeSnapshot } = require("../runtimeSnapshot");
const { requireRuntime } = require("./registry");
const { restoreActivatedSkills } = require("../activatedSkills");
const { AgentRun } = require("../../models/agentRun");

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
  inheritedSkills = [],
  depth = 0,
  maxLocalToolCalls = 250,
  resume = null,
  runId = null,
  runtimeKey = null,
}) {
  const snapshot = await createRuntimeSnapshot({
    agent,
    workspace,
    user,
    configuration: parentRun.configuration,
  });
  const effectiveRunId = runId || parentRun.id;
  const effectiveRuntimeKey =
    runtimeKey || parentRun.runtimeKey || "default-react";
  let childRun = await AgentRun.get(effectiveRunId);
  if (!childRun) {
    childRun = await AgentRun.create({
      id: effectiveRunId,
      workspaceId: parentRun.workspace_id,
      userId: parentRun.user_id,
      agentId: agent.id,
      source: "subagent",
      mode: parentRun.mode || "automatic",
      prompt,
      configuration: {
        ...parentRun.configuration,
        recover: false,
        resume,
      },
      runtimeKey: effectiveRuntimeKey,
      runtimeVersion: 1,
      runtimeSnapshot: snapshot.runtimeSnapshot,
      parentRunId: parentRun.id,
      policySnapshot: parentRun.policySnapshot || {},
    });
  }
  await AgentRun.update(effectiveRunId, {
    status: "running",
    startedAt: childRun.startedAt || new Date(),
  });
  const run = {
    ...childRun,
    id: effectiveRunId,
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
    runtimeKey: effectiveRuntimeKey,
    runtimeVersion: 1,
  };
  const { runtime } = requireRuntime(run.runtimeKey, run.runtimeVersion);
  const activatedSkillScope = new Map();
  await restoreActivatedSkills(inheritedSkills, workspace, activatedSkillScope);
  try {
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
      activatedSkillScope,
      inheritedSkills,
      depth,
      maxLocalToolCalls,
    });
    await AgentRun.update(effectiveRunId, {
      status: result.kind === "interrupt" ? "waiting_for_input" : "completed",
      completedAt: result.kind === "interrupt" ? null : new Date(),
      finalResponse: result.kind === "interrupt" ? null : result.text || "",
    });
    return result;
  } catch (error) {
    await AgentRun.update(effectiveRunId, {
      status: "failed",
      error: error.message,
      completedAt: new Date(),
    });
    throw error;
  }
}

module.exports = { invokeAgentRuntime };
