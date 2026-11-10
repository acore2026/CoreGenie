// Preview one cancelled run; pass --apply explicitly to restore its chat.
const prisma = require("../../utils/prisma");
const { AgentRun } = require("../../models/agentRun");
const {
  interruptedAgentResponse,
  persistFailedAgentRun,
} = require("../../agent-system/executor");

async function recoverCancelledChat(runId, { apply = false } = {}) {
  const run = await AgentRun.get(runId);
  if (!run || run.status !== "cancelled")
    throw new Error("Only an existing cancelled run can be recovered.");
  if (run.configuration?.persistChat === false)
    throw new Error("This run explicitly disabled chat persistence.");
  const existing = await prisma.workspace_chats.findFirst({
    where: {
      workspaceId: run.workspace_id,
      thread_id: run.thread_id,
      response: { contains: `"agentRunId":${JSON.stringify(run.id)}` },
    },
    select: { id: true },
  });
  const summary = {
    runId: run.id,
    workspaceId: run.workspace_id,
    threadId: run.thread_id,
    completedAt: run.completedAt,
    apply,
  };
  if (existing)
    return { ...summary, action: "already_saved", chatId: existing.id };
  if (run.finalResponse !== null)
    throw new Error(
      "The run already has a final response; inspect it before recovery."
    );

  const error = new Error(run.error || "Cancelled by user.");
  const { response } = await interruptedAgentResponse(run, error, {
    cancelled: true,
  });
  const preview = {
    ...summary,
    action: "preview",
    responseCharacters: response.text.length,
    textParts:
      response.parts?.filter((part) => part.type === "text").length || 0,
    toolGroups:
      response.parts?.filter((part) => part.type === "toolGroup").length || 0,
  };
  if (!apply) return preview;
  const saved = await persistFailedAgentRun(run.id, error, {
    cancelled: true,
    recoverCancelled: true,
  });
  return {
    ...preview,
    action: saved ? "restored" : "unchanged",
    chatId: saved?.chatId || null,
  };
}

if (require.main === module) {
  require("dotenv").config();
  const [runId, flag, ...extra] = process.argv.slice(2);
  if (!runId || (flag && flag !== "--apply") || extra.length) {
    console.error(
      "Usage: node scripts/agent-runs/recover-cancelled-chat.js <run-id> [--apply]"
    );
    process.exitCode = 1;
  } else {
    recoverCancelledChat(runId, { apply: flag === "--apply" })
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      })
      .finally(() => prisma.$disconnect());
  }
}

module.exports = { recoverCancelledChat };
