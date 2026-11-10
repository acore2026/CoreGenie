/* eslint-env jest, node */
jest.mock("../../models/workspace", () => ({ Workspace: { get: jest.fn(), accessForUser: jest.fn() } }));
jest.mock("../../models/workspaceThread", () => ({ WorkspaceThread: { get: jest.fn() } }));
jest.mock("../../utils/http", () => ({
  reqBody: request => request.body,
  multiUserMode: response => Boolean(response.locals.multiUserMode),
  userFromSession: async (_request, response) => response.locals.user || null,
}));
jest.mock("../../models/agentRun", () => ({
  AgentRun: {
    get: jest.fn(),
    isTerminal: jest.fn((status) =>
      ["completed", "partial", "failed", "cancelled"].includes(status)
    ),
  },
}));
jest.mock("../../models/agentRunTask", () => ({
  AgentRunTask: { list: jest.fn() },
}));
jest.mock("../../models/agentRunEvidence", () => ({
  AgentRunEvidence: { list: jest.fn() },
}));
jest.mock("../../models/agentRunArtifact", () => ({
  AgentRunArtifact: { forRun: jest.fn() },
}));
jest.mock("../../models/agentRunEvent", () => ({
  AgentRunEvent: {
    after: jest.fn(),
    latestSequence: jest.fn(),
    traceSnapshot: jest.fn(),
  },
}));
jest.mock("../../utils/prisma", () => ({
  agent_tool_executions: { findMany: jest.fn() },
}));
jest.mock("../../agent-system/service", () => ({
  submitAgentRun: jest.fn(),
}));
jest.mock("../../agent-system/observability", () => ({
  agentTraceId: jest.fn(),
}));

const { AgentRun } = require("../../models/agentRun");
const { AgentRunTask } = require("../../models/agentRunTask");
const { AgentRunEvidence } = require("../../models/agentRunEvidence");
const { AgentRunArtifact } = require("../../models/agentRunArtifact");
const { AgentRunEvent } = require("../../models/agentRunEvent");
const prisma = require("../../utils/prisma");
const { submitAgentRun } = require("../../agent-system/service");
const { agentTraceId } = require("../../agent-system/observability");
const {
  createRun,
  sanitizeEvaluation,
  snapshotRun,
  authorizedRun,
} = require("../../endpoints/agentRuns");

describe("public workspace run visibility", () => {
  const { Workspace } = require("../../models/workspace");
  const { WorkspaceThread } = require("../../models/workspaceThread");
  beforeEach(() => {
    jest.clearAllMocks();
    AgentRun.get.mockResolvedValue({ id: "run", workspace_id: 1, thread_id: 2, user_id: 10 });
    Workspace.get.mockResolvedValue({ id: 1 });
    WorkspaceThread.get.mockResolvedValue(null);
  });
  const request = { params: { runId: "run" } };
  const response = { locals: { multiUserMode: true, user: { id: 7, role: "default" } } };
  it.each(["public_readonly", "public_collaborator", "member"])("allows %s to observe, but not control another user's run", async access => {
    Workspace.accessForUser.mockResolvedValue(access);
    await expect(authorizedRun(request, response)).resolves.toMatchObject({ id: "run" });
    await expect(authorizedRun(request, response, { requireManage: true })).resolves.toBeNull();
  });
  it("denies unrelated private workspace and personal default conversation reads", async () => {
    Workspace.accessForUser.mockResolvedValue(null);
    await expect(authorizedRun(request, response)).resolves.toBeNull();
    Workspace.accessForUser.mockResolvedValue("public_collaborator");
    AgentRun.get.mockResolvedValue({ id: "run", workspace_id: 1, thread_id: null, user_id: 10 });
    await expect(authorizedRun(request, response)).resolves.toBeNull();
  });
  it("allows a public collaborator to control their own run", async () => {
    Workspace.accessForUser.mockResolvedValue("public_collaborator");
    AgentRun.get.mockResolvedValue({ id: "run", workspace_id: 1, thread_id: 2, user_id: 7 });
    await expect(authorizedRun(request, response, { requireManage: true })).resolves.toMatchObject({ id: "run" });
  });
  it.each(["public_collaborator", "member"])("allows %s to control a shared run in an explicitly collaborative workspace", async access => {
    Workspace.get.mockResolvedValue({ id: 1, accessMode: "public_collaborative" });
    Workspace.accessForUser.mockResolvedValue(access);
    await expect(authorizedRun(request, response, { requireManage: true })).resolves.toMatchObject({ id: "run" });
  });
});

function responseWithLocals(locals = {}) {
  const json = jest.fn();
  const response = {
    locals,
    status: jest.fn(() => ({ json })),
  };
  return { response, json };
}

describe("developer Agent runs", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sanitizes bounded evaluation correlation fields", () => {
    expect(
      sanitizeEvaluation({
        evaluationId: ` eval-${"x".repeat(200)} `,
        suiteId: "runtime-v0",
        caseId: "direct-answer",
        attempt: 5000,
      })
    ).toEqual({
      evaluationId: `eval-${"x".repeat(123)}`,
      suiteId: "runtime-v0",
      caseId: "direct-answer",
      attempt: 1000,
    });
    expect(sanitizeEvaluation({})).toBeNull();
  });

  it("creates API-key evaluation runs with a forced source and correlation", async () => {
    const workspace = { id: 1, slug: "eval-space", chatMode: "automatic" };
    const thread = { id: 2, slug: "attempt-1" };
    const { response, json } = responseWithLocals({
      apiKey: { id: 9 },
      workspace,
      thread,
      multiUserMode: true,
    });
    submitAgentRun.mockResolvedValue({ id: "run-1", status: "queued" });

    await createRun(
      {
        body: {
          message: "Evaluate this",
          agentId: 3,
          evaluation: {
            evaluationId: "eval-1",
            suiteId: "suite-1",
            caseId: "case-1",
            attempt: 2,
          },
        },
      },
      response
    );

    expect(submitAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace,
        thread,
        user: null,
        agentId: 3,
        source: "evaluation",
        configuration: expect.objectContaining({
          approvalMode: "always_allow",
          evaluation: {
            evaluationId: "eval-1",
            suiteId: "suite-1",
            caseId: "case-1",
            attempt: 2,
          },
        }),
      })
    );
    expect(response.status).toHaveBeenCalledWith(202);
    expect(json).toHaveBeenCalledWith({
      run: { id: "run-1", status: "queued" },
    });
  });

  it("returns full events, artifacts, and trace correlation in API snapshots", async () => {
    const run = { id: "run-1", status: "completed" };
    AgentRun.get.mockResolvedValue(run);
    AgentRunTask.list.mockResolvedValue([{ id: "task-1" }]);
    AgentRunEvidence.list.mockResolvedValue([]);
    prisma.agent_tool_executions.findMany.mockResolvedValue([]);
    AgentRunEvent.after.mockResolvedValue([{ id: 1, type: "run.completed" }]);
    AgentRunArtifact.forRun.mockResolvedValue([{ id: "artifact-1" }]);
    AgentRunEvent.latestSequence.mockResolvedValue(1);
    agentTraceId.mockResolvedValue("trace-1");
    const { response, json } = responseWithLocals({ apiKey: { id: 9 } });

    await snapshotRun(
      { params: { runId: "run-1" }, query: { events: "full" } },
      response
    );

    expect(AgentRunEvent.after).toHaveBeenCalledWith("run-1", 0, 50_000);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        run,
        artifacts: [{ id: "artifact-1" }],
        traceId: "trace-1",
        events: [{ id: 1, type: "run.completed" }],
      })
    );
  });

  it("omits raw tool arguments and results from compact rail snapshots", async () => {
    const run = { id: "run-1", status: "completed" };
    const compactExecution = {
      id: "execution-1",
      call_id: "call-1",
      tool_id: "filesystem.read",
      status: "completed",
      result_summary: "Read one file",
    };
    AgentRun.get.mockResolvedValue(run);
    AgentRunTask.list.mockResolvedValue([]);
    AgentRunEvidence.list.mockResolvedValue([]);
    prisma.agent_tool_executions.findMany.mockResolvedValue([
      compactExecution,
    ]);
    AgentRunEvent.traceSnapshot.mockResolvedValue([]);
    AgentRunArtifact.forRun.mockResolvedValue([]);
    AgentRunEvent.latestSequence.mockResolvedValue(2);
    agentTraceId.mockResolvedValue("trace-1");
    const { response, json } = responseWithLocals({ apiKey: { id: 9 } });

    await snapshotRun(
      {
        params: { runId: "run-1" },
        query: { view: "rail", events: "full" },
      },
      response
    );

    const query = prisma.agent_tool_executions.findMany.mock.calls[0][0];
    expect(query.select).toEqual(
      expect.objectContaining({ result_summary: true })
    );
    expect(query.select).not.toHaveProperty("arguments");
    expect(query.select).not.toHaveProperty("result");
    expect(AgentRunEvent.traceSnapshot).toHaveBeenCalledWith("run-1");
    expect(AgentRunEvent.after).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ toolExecutions: [compactExecution] })
    );
  });
});
