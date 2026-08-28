const { AgentRun } = require("../models/agentRun");
const { AgentRunEvent } = require("../models/agentRunEvent");
const { AgentRunTask } = require("../models/agentRunTask");
const { AgentRunEvidence } = require("../models/agentRunEvidence");
const { AgentRunCommand } = require("../models/agentRunCommand");
const { normalizeExecution } = require("../models/agentToolExecution");
const prisma = require("../utils/prisma");
const { Workspace } = require("../models/workspace");
const { WorkspaceThread } = require("../models/workspaceThread");
const { User } = require("../models/user");
const { reqBody, userFromSession, multiUserMode } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const {
  validWorkspaceSlug,
  validWorkspaceAndThreadSlug,
  manageWorkspaceThread,
} = require("../utils/middleware/validWorkspace");
const { agentRunEventBus } = require("../agent-system/eventBus");
const { agentRunSupervisor } = require("../agent-system/supervisor");
const { AgentSkillWhitelist } = require("../models/agentSkillWhitelist");
const { submitAgentRun } = require("../agent-system/service");

const ACTIVE_STATUSES = [
  "queued",
  "running",
  "waiting_for_input",
  "waiting_for_approval",
];

async function authorizedRun(
  request,
  response,
  { requireManage = false } = {}
) {
  const run = await AgentRun.get(request.params.runId);
  if (!run) return null;
  if (!multiUserMode(response)) return run;
  const user = await userFromSession(request, response);
  if (!user) return null;
  const workspace = await Workspace.getWithUser(user, { id: run.workspace_id });
  if (!workspace) return null;
  if (requireManage) {
    const ownsThread = run.thread_id
      ? Boolean(
          await WorkspaceThread.get({
            id: run.thread_id,
            workspace_id: run.workspace_id,
            user_id: user.id,
          })
        )
      : false;
    if (
      run.user_id !== user.id &&
      !ownsThread &&
      ![ROLES.admin, ROLES.manager].includes(user.role)
    )
      return null;
  }
  return run;
}

async function createRun(request, response) {
  const body = reqBody(request);
  const prompt = String(body?.message || body?.prompt || "").trim();
  if (!prompt)
    return response.status(400).json({ error: "Message is required." });
  const user = await userFromSession(request, response);
  const workspace = response.locals.workspace;
  const thread = response.locals.thread || null;
  const approvalMode =
    body?.approvalMode || (await AgentSkillWhitelist.getApprovalMode());
  if (multiUserMode(response) && !(await User.canSendChat(user)))
    return response.status(429).json({ error: "Daily chat quota reached." });

  try {
    const run = await submitAgentRun({
      workspace,
      thread,
      user,
      agentId: body?.predefinedAgentId || body?.agentId || null,
      source: body?.source || "workspace",
      mode: body?.mode || workspace.chatMode || "automatic",
      prompt,
      attachments: Array.isArray(body?.attachments) ? body.attachments : [],
      configuration: {
        approvalMode,
        maxToolCalls: Math.min(Number(body?.maxToolCalls) || 2_500, 2_500),
      },
    });
    return response.status(202).json({ run });
  } catch (error) {
    if (error.code === "AGENT_RUN_ACTIVE")
      return response
        .status(409)
        .json({ error: error.message, run: error.run });
    throw error;
  }
}

function sendSSE(response, event) {
  response.write(`id: ${event.id}\n`);
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function streamEvents(request, response) {
  const run = await authorizedRun(request, response);
  if (!run) return response.status(404).json({ error: "Agent run not found." });

  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();

  let cursor = Number(
    request.headers["last-event-id"] || request.query.after || 0
  );
  const pending = [];
  let replaying = true;
  const unsubscribe = agentRunEventBus.subscribe(run.id, (event) => {
    if (event.id <= cursor) return;
    if (replaying) pending.push(event);
    else {
      sendSSE(response, event);
      cursor = event.id;
      if (AgentRun.isTerminal(event.payload?.status)) cleanup();
    }
  });
  const heartbeat = setInterval(
    () => response.write(": heartbeat\n\n"),
    15_000
  );
  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
    if (!response.writableEnded) response.end();
  };
  request.on("close", cleanup);

  for (const event of await AgentRunEvent.after(run.id, cursor)) {
    sendSSE(response, event);
    cursor = event.id;
  }
  replaying = false;
  for (const event of pending) {
    if (event.id <= cursor) continue;
    sendSSE(response, event);
    cursor = event.id;
  }
  const current = await AgentRun.get(run.id);
  if (AgentRun.isTerminal(current?.status)) cleanup();
}

async function activeRun(request, response) {
  const user = await userFromSession(request, response);
  const workspace = response.locals.workspace;
  const thread = response.locals.thread || null;
  const run = await AgentRun.activeForConversation({
    workspaceId: workspace.id,
    threadId: thread?.id || null,
    userId: user?.id || null,
  });
  return response.status(200).json({
    run,
    invocation: run ? { uuid: run.id, prompt: run.prompt, active: true } : null,
  });
}

function agentRunEndpoints(app) {
  if (!app) return;
  app.post(
    "/workspace/:slug/agent-runs",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    createRun
  );
  app.post(
    "/workspace/:slug/thread/:threadSlug/agent-runs",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.all]),
      validWorkspaceAndThreadSlug,
      manageWorkspaceThread,
    ],
    createRun
  );
  app.get("/agent-runs/:runId/events", [validatedRequest], streamEvents);
  app.get(
    "/agent-runs/:runId/snapshot",
    [validatedRequest],
    async (request, response) => {
      const run = await authorizedRun(request, response);
      if (!run)
        return response.status(404).json({ error: "Agent run not found." });
      const [tasks, evidence, toolExecutions, events] = await Promise.all([
        AgentRunTask.list(run.id),
        AgentRunEvidence.list(run.id),
        prisma.agent_tool_executions
          .findMany({
            where: { run_id: run.id },
            orderBy: { createdAt: "asc" },
          })
          .then((rows) => rows.map(normalizeExecution)),
        AgentRunEvent.traceSnapshot(run.id),
      ]);
      return response.status(200).json({
        run,
        tasks,
        evidence,
        toolExecutions,
        events,
        cursor: await AgentRunEvent.latestSequence(run.id),
      });
    }
  );
  app.post(
    "/agent-runs/:runId/commands",
    [validatedRequest],
    async (request, response) => {
      const run = await authorizedRun(request, response, {
        requireManage: true,
      });
      if (!run)
        return response.status(404).json({ error: "Agent run not found." });
      const command = reqBody(request);
      const commandType =
        command?.type === "cancel" ? "run.cancel" : command?.type;
      const persistedCommand = await AgentRunCommand.create({
        id: command?.commandId,
        runId: run.id,
        taskId: command?.taskId,
        type: commandType || "unknown",
        payload: command,
      });
      if (persistedCommand.status === "completed")
        return response.status(202).json({
          success: true,
          commandId: persistedCommand.id,
          duplicate: true,
        });
      if (commandType === "run.cancel") {
        const success = await agentRunSupervisor.cancel(run.id);
        await AgentRunCommand.complete(persistedCommand.id, { success });
        return response
          .status(success ? 202 : 409)
          .json({ success, commandId: persistedCommand.id });
      }
      if (
        ["toolApprovalResponse", "approval.respond"].includes(commandType) &&
        run.status === "waiting_for_approval"
      ) {
        const events = await AgentRunEvent.after(run.id, 0, 10_000);
        const approval = events
          .filter((event) => event.type === "approval.requested")
          .at(-1);
        const actionCount = Math.max(
          approval?.payload?.actionRequests?.length || 1,
          1
        );
        await AgentRun.update(run.id, {
          status: "queued",
          configuration: {
            ...run.configuration,
            recover: false,
            resume: {
              decisions: Array.from({ length: actionCount }, () =>
                command.approved
                  ? { type: "approve" }
                  : { type: "reject", message: "Rejected by user." }
              ),
            },
          },
        });
        await AgentRunEvent.append(run.id, "approval.resolved", {
          requestId: command.requestId,
          approved: Boolean(command.approved),
        });
        await AgentRunCommand.complete(persistedCommand.id, { success: true });
        setImmediate(() => agentRunSupervisor.enqueue(run.id));
        return response.status(202).json({ success: true });
      }
      if (
        ["clarificationResponse", "input.respond"].includes(commandType) &&
        run.status === "waiting_for_input"
      ) {
        await AgentRun.update(run.id, {
          status: "queued",
          configuration: {
            ...run.configuration,
            recover: false,
            resume: {
              skipped: Boolean(command.skipped),
              answers: command.answers || [],
            },
          },
        });
        await AgentRunEvent.append(run.id, "input.resolved", {
          requestId: command.requestId,
          skipped: Boolean(command.skipped),
        });
        await AgentRunCommand.complete(persistedCommand.id, { success: true });
        setImmediate(() => agentRunSupervisor.enqueue(run.id));
        return response.status(202).json({ success: true });
      }
      if (["task.cancel", "task.skip"].includes(commandType)) {
        const task = await AgentRunTask.get(command.taskId);
        if (!task || task.run_id !== run.id)
          return response.status(404).json({ error: "Agent task not found." });
        if (
          ["completed", "failed", "cancelled", "skipped"].includes(task.status)
        )
          return response
            .status(409)
            .json({ error: "Agent task is terminal." });
        const status = commandType === "task.skip" ? "skipped" : "cancelled";
        await AgentRunTask.update(task.id, {
          status,
          error: status === "cancelled" ? "Cancelled by user." : null,
          resultSummary:
            status === "cancelled" ? "Cancelled by user." : "Skipped by user.",
          completedAt: new Date(),
        });
        await AgentRunEvent.append(run.id, `task.${status}`, {
          taskId: task.id,
          reason:
            status === "cancelled" ? "Cancelled by user." : "Skipped by user.",
        });
        await AgentRunCommand.complete(persistedCommand.id, { success: true });
        return response.status(202).json({
          success: true,
          commandId: persistedCommand.id,
        });
      }
      return response
        .status(409)
        .json({ error: "This run is not waiting for that command." });
    }
  );
  app.get(
    "/workspace/:slug/agent-runs/active",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    activeRun
  );
  app.get(
    "/workspace/:slug/thread/:threadSlug/agent-runs/active",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.all]),
      validWorkspaceAndThreadSlug,
    ],
    activeRun
  );
}

module.exports = { agentRunEndpoints, ACTIVE_STATUSES };
