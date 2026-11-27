// Restore download cards for an existing chat without changing its response text.
const fs = require("fs/promises");
const prisma = require("../../utils/prisma");
const { AgentRun } = require("../../models/agentRun");
const { AgentRunTask } = require("../../models/agentRunTask");
const { AgentRunArtifact } = require("../../models/agentRunArtifact");
const filesystem = require("../../services/workspaceFiles");
const {
  registerRunArtifacts,
  collectRunOutputs,
} = require("../../agent-system/artifactRegistration");

async function attachResultFiles(runId, { backupPath } = {}) {
  if (!backupPath) throw new Error("A response backup path is required.");
  const run = await AgentRun.get(runId);
  if (!run || !AgentRun.isTerminal(run.status))
    throw new Error("An existing terminal run is required.");
  const chat = await prisma.workspace_chats.findFirst({
    where: {
      workspaceId: run.workspace_id,
      thread_id: run.thread_id,
      include: true,
      response: { contains: `"agentRunId":${JSON.stringify(run.id)}` },
    },
  });
  if (!chat) return { runId, action: "no_chat" };
  const response = JSON.parse(chat.response);
  if (response.agentRunId !== run.id) throw new Error("Chat/run mismatch.");
  const workspace = await prisma.workspaces.findUnique({
    where: { id: run.workspace_id },
  });
  const workspaceManager = filesystem.forWorkspace(workspace.id);
  await workspaceManager.ensureInitialized();
  const registered = await registerRunArtifacts({
    runId,
    tasks: await AgentRunTask.list(runId),
    finalResponse: response.text,
    workspaceManager,
  });
  const artifacts = await AgentRunArtifact.forRun(runId);
  const outputs = await collectRunOutputs({
    runId,
    workspace,
    workspaceManager,
    artifacts: [...registered, ...artifacts],
  });
  const old = response.outputs || [];
  const key = (output) =>
    `${output.type}:${output.payload?.workspaceSlug}:${output.payload?.path || output.payload?.storageFilename}`;
  const seen = new Set(old.map(key));
  const added = outputs.filter((output) => !seen.has(key(output)));
  const managedIds = new Set(artifacts.map((artifact) => artifact.id));
  const preserved = old.filter(
    (output) => !managedIds.has(output.payload?.artifactId)
  );
  const preservedKeys = new Set(preserved.map(key));
  const nextOutputs = [
    ...preserved,
    ...outputs.filter((output) => !preservedKeys.has(key(output))),
  ];
  if (JSON.stringify(nextOutputs) === JSON.stringify(old))
    return { runId, action: "unchanged", count: old.length };
  await fs.appendFile(
    backupPath,
    JSON.stringify({ chatId: chat.id, runId, response: chat.response }) + "\n",
    { mode: 0o600 }
  );
  const changed = await prisma.workspace_chats.updateMany({
    where: { id: chat.id, response: chat.response },
    data: {
      response: JSON.stringify({ ...response, outputs: nextOutputs }),
    },
  });
  return {
    runId,
    chatId: chat.id,
    action: changed.count ? "attached" : "chat_changed",
    added: changed.count ? added.length : 0,
    count: nextOutputs.length,
  };
}

if (require.main === module) {
  const [runId, backupPath] = process.argv.slice(2);
  attachResultFiles(runId, { backupPath })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
module.exports = { attachResultFiles };
