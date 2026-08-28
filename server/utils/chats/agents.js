const { writeResponseChunk } = require("../helpers/chat/responses");
const { Workspace } = require("../../models/workspace");
const { PredefinedAgent } = require("../../models/predefinedAgent");

const { submitAgentRun } = require("../../agent-system/service");
const { AgentSkillWhitelist } = require("../../models/agentSkillWhitelist");

async function grepAgents({
  uuid,
  response,
  message,
  workspace,
  user = null,
  thread = null,
  attachments = [],
  predefinedAgentId = null,
}) {
  let nativeToolingEnabled = false;

  // If the workspace is in automatic mode, check if the workspace supports native tooling
  // to determine if the agent flow should be used or not.
  if (workspace?.chatMode === "automatic")
    nativeToolingEnabled = await Workspace.supportsNativeToolCalling(workspace);

  const explicitlyInvoked = message.startsWith("@agent");
  const requestedAgent =
    Number(predefinedAgentId) > 0
      ? await PredefinedAgent.get(Number(predefinedAgentId), {
          enabledOnly: true,
        })
      : null;
  const defaultAgentId = requestedAgent
    ? null
    : await PredefinedAgent.defaultId();
  const predefinedAgent =
    requestedAgent ||
    (defaultAgentId
      ? await PredefinedAgent.get(defaultAgentId, { enabledOnly: true })
      : null);
  if (explicitlyInvoked || nativeToolingEnabled || predefinedAgent) {
    const approvalMode = await AgentSkillWhitelist.getApprovalMode();
    const run = await submitAgentRun({
      prompt: message,
      workspace,
      user,
      thread,
      agentId: predefinedAgent?.id || null,
      mode: workspace.chatMode || "automatic",
      source: "workspace",
      attachments,
      configuration: { approvalMode, maxToolCalls: 2_500 },
    });

    writeResponseChunk(response, {
      id: uuid,
      type: "agentInitWebsocketConnection",
      textResponse: null,
      sources: [],
      close: false,
      error: null,
      websocketUUID: run.id,
    });

    // Close HTTP stream-able chunk response method because we will swap to agents now.
    writeResponseChunk(response, {
      id: uuid,
      type: "statusResponse",
      // This frame only closes the original HTTP stream after the durable run
      // transport has been attached. Live activity.updated events own the
      // visible status line; persisting a placeholder here leaves a stale
      // "running in the background" bubble after the answer is complete.
      textResponse: null,
      sources: [],
      close: true,
      error: null,
      animate: true,
    });
    return true;
  }

  return false;
}

// Transitional no-op for old scheduled/Telegram handlers that still import the
// symbol while those callers are being moved to the durable run service.
function getAndClearInvocationAttachments() {
  return [];
}

module.exports = { grepAgents, getAndClearInvocationAttachments };
