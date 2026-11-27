/* eslint-env jest, node */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createPgliteTestDb } = require("../helpers/pgliteTestDb");

const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "agent-run-persistence-")
);
let testDb;
let mockPrisma;
jest.mock(
  "../../utils/prisma",
  () => new Proxy({}, { get: (_target, key) => mockPrisma[key] })
);
jest.mock("../../agent-system/runtimes/registry", () => ({
  requireRuntime: jest.fn(),
}));
const { AgentRun } = require("../../models/agentRun");
const { AgentRunEvent } = require("../../models/agentRunEvent");
const {
  executeAgentRunSegment,
  persistFailedAgentRun,
} = require("../../agent-system/executor");
const { requireRuntime } = require("../../agent-system/runtimes/registry");
const {
  recoverCancelledChat,
} = require("../../scripts/agent-runs/recover-cancelled-chat");

describe("atomic Agent response persistence", () => {
  let run;
  const response = { text: "已保存的内容。", agentRunId: "run-1", parts: [] };
  const cancellation = {
    response,
    status: "cancelled",
    terminationReason: "cancelled_by_user",
  };
  beforeAll(async () => {
    testDb = await createPgliteTestDb();
    mockPrisma = testDb.prisma;
    await mockPrisma.workspaces.create({
      data: { id: 7, name: "Test", slug: "test-cancellation" },
    });
    await mockPrisma.workspace_threads.create({
      data: { id: 3, workspace_id: 7, name: "Test", slug: "test-thread" },
    });
  }, 30000);
  beforeEach(async () => {
    await mockPrisma.workspace_chats.deleteMany();
    await mockPrisma.agent_runs.deleteMany();
    run = await AgentRun.create({
      id: "run-1",
      workspaceId: 7,
      threadId: 3,
      prompt: "请分析这些资料。",
      configuration: { autoTitle: false },
      runtimeSnapshot: { agent: { id: 1, name: "Test" } },
    });
  });
  afterAll(async () => {
    await testDb?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("commits the prompt, response and terminal status together", async () => {
    const saved = await AgentRun.finalizeWithResponse(run.id, cancellation);
    expect(saved.run.status).toBe("cancelled");
    expect(saved.chat.prompt).toBe(run.prompt);
    expect(saved.chat.thread_id).toBe(3);
    expect(saved.chat.workspaceId).toBe(7);
    expect(JSON.parse(saved.chat.response)).toEqual(response);
    expect((await AgentRun.get(run.id)).finalResponse).toBe(response.text);
  });

  it("rolls back the terminal state if chat creation fails", async () => {
    // There is no user 999: the real chat foreign key forces an insert failure.
    await AgentRun.update(run.id, { user_id: 999 });
    await expect(
      AgentRun.finalizeWithResponse(run.id, cancellation)
    ).rejects.toThrow();
    expect((await AgentRun.get(run.id)).status).toBe("queued");
    expect((await AgentRun.get(run.id)).finalResponse).toBeNull();
    expect(await mockPrisma.workspace_chats.count()).toBe(0);
    await AgentRun.update(run.id, { user_id: null });
    await expect(
      AgentRun.finalizeWithResponse(run.id, cancellation)
    ).resolves.toBeTruthy();
  });

  it("saves once for concurrent cancellations and rejects late completion", async () => {
    const results = await Promise.all([
      AgentRun.finalizeWithResponse(run.id, cancellation),
      AgentRun.finalizeWithResponse(run.id, cancellation),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(
      AgentRun.finalizeWithResponse(run.id, {
        response: { text: "迟到的完整回复" },
        status: "completed",
        terminationReason: "completed",
      })
    ).resolves.toBeNull();
    expect(await mockPrisma.workspace_chats.count()).toBe(1);
    expect((await AgentRun.get(run.id)).status).toBe("cancelled");
    expect((await AgentRun.get(run.id)).finalResponse).toBe(response.text);
  });

  it("cannot revive a cancelled run during initialization or input handling", async () => {
    await AgentRun.finalizeWithResponse(run.id, cancellation);
    for (const status of [
      "queued",
      "running",
      "waiting_for_input",
      "waiting_for_approval",
    ]) {
      await expect(
        AgentRun.update(run.id, { status }, { onlyActive: true })
      ).resolves.toBeNull();
    }
    expect((await AgentRun.get(run.id)).status).toBe("cancelled");
  });

  it("retains API runs that explicitly disable chat persistence", async () => {
    await AgentRun.update(run.id, { configuration: { persistChat: false } });
    const saved = await AgentRun.finalizeWithResponse(run.id, cancellation);
    expect(saved.chat).toBeNull();
    expect(saved.run.finalResponse).toBe(response.text);
    expect(await mockPrisma.workspace_chats.count()).toBe(0);
  });

  it("recovers an old cancellation once and keeps the original dates", async () => {
    const stoppedAt = new Date("2026-09-29T06:24:39Z");
    await AgentRun.update(run.id, {
      status: "cancelled",
      completedAt: stoppedAt,
    });
    const repair = { ...cancellation, recoverCancelled: true };
    const saved = await AgentRun.finalizeWithResponse(run.id, repair);
    expect(saved.run.completedAt).toEqual(stoppedAt);
    expect(saved.chat.createdAt).toEqual(run.createdAt);
    await expect(
      AgentRun.finalizeWithResponse(run.id, repair)
    ).resolves.toBeNull();
    expect(await mockPrisma.workspace_chats.count()).toBe(1);
  });

  it("keeps an existing edited or hidden chat during recovery", async () => {
    await AgentRun.update(run.id, { status: "cancelled" });
    const existing = await mockPrisma.workspace_chats.create({
      data: {
        workspaceId: 7,
        thread_id: 3,
        prompt: run.prompt,
        include: false,
        response: JSON.stringify({
          agentRunId: run.id,
          text: "用户修改后的回复",
        }),
      },
    });
    const saved = await AgentRun.finalizeWithResponse(run.id, {
      ...cancellation,
      recoverCancelled: true,
    });
    expect(saved.chat.id).toBe(existing.id);
    expect(saved.chat.include).toBe(false);
    expect(saved.run.finalResponse).toBe("用户修改后的回复");
    expect(await mockPrisma.workspace_chats.count()).toBe(1);
  });

  it("preserves a completion that wins the race with cancellation", async () => {
    await AgentRun.finalizeWithResponse(run.id, {
      response,
      status: "completed",
      terminationReason: "completed",
    });
    await expect(
      AgentRun.finalizeWithResponse(run.id, cancellation)
    ).resolves.toBeNull();
    await expect(
      AgentRun.finalizeWithResponse(run.id, {
        ...cancellation,
        recoverCancelled: true,
      })
    ).resolves.toBeNull();
    expect((await AgentRun.get(run.id)).status).toBe("completed");
    expect(await mockPrisma.workspace_chats.count()).toBe(1);
  });

  async function seedPartialReply() {
    await AgentRunEvent.append(run.id, "message.delta", {
      messageId: `${run.id}:assistant`,
      partId: "text:1",
      partDelta: "已下载部分资料。",
      delta: "已下载部分资料。",
    });
    await AgentRunEvent.append(run.id, "tool.started", {
      groupId: "tools:1",
      callId: "call-1",
    });
  }

  it("rebuilds the visible reply and tool order before saving cancellation", async () => {
    await seedPartialReply();
    const saved = await persistFailedAgentRun(
      run.id,
      new Error("Cancelled by user."),
      { cancelled: true }
    );
    const chat = await mockPrisma.workspace_chats.findUnique({
      where: { id: saved.chatId },
    });
    const stored = JSON.parse(chat.response);
    expect(stored.text).toBe(
      "已下载部分资料。\n\n任务已停止，以上是停止前的内容。"
    );
    expect(stored.parts.map((part) => part.type)).toEqual([
      "text",
      "toolGroup",
      "text",
    ]);
    expect(stored.parts[1].callIds).toEqual(["call-1"]);
    expect(stored.error).toBeNull();
    expect(stored.agentRunId).toBe(run.id);
  });

  it("keeps the question even if the run was stopped before any output", async () => {
    const saved = await persistFailedAgentRun(
      run.id,
      new Error("Cancelled by user."),
      { cancelled: true }
    );
    const chat = await mockPrisma.workspace_chats.findUnique({
      where: { id: saved.chatId },
    });
    expect(chat.prompt).toBe(run.prompt);
    expect(JSON.parse(chat.response).text).toBe("任务已停止。");
  });

  it("preserves downloadable files on failure and registers repeated outputs only once", async () => {
    const { AgentRunArtifact } = require("../../models/agentRunArtifact");
    const filesystem = require("../../services/workspaceFiles");
    const filePath = path.join(directory, "report.md");
    fs.writeFileSync(filePath, "# 已完成的部分结果");
    const manager = jest.spyOn(filesystem, "forWorkspace").mockReturnValue({
      ensureInitialized: async () => {},
      validatePath: async () => filePath,
    });
    try {
      const artifact = {
        runId: run.id,
        kind: "workspaceFile",
        title: "report.md",
        mimeType: "text/markdown",
        storagePath: "reports/report.md",
        byteSize: 24,
        metadata: { filename: "report.md" },
      };
      await Promise.all([
        AgentRunArtifact.registerWorkspaceOutput(artifact),
        AgentRunArtifact.registerWorkspaceOutput(artifact),
      ]);
      expect(
        await mockPrisma.agent_run_artifacts.count({
          where: { run_id: run.id },
        })
      ).toBe(1);
      const saved = await persistFailedAgentRun(
        run.id,
        new Error("later step failed")
      );
      const chat = await mockPrisma.workspace_chats.findUnique({
        where: { id: saved.chatId },
      });
      expect(JSON.parse(chat.response).outputs).toEqual([
        expect.objectContaining({
          type: "workspaceFile",
          payload: expect.objectContaining({
            path: "reports/report.md",
            workspaceSlug: "test-cancellation",
          }),
        }),
      ]);
      expect(saved.outputs).toHaveLength(1);
    } finally {
      manager.mockRestore();
    }
  });

  it("backfills a historical download once while preserving the original reply and a backup", async () => {
    const {
      attachResultFiles,
    } = require("../../scripts/agent-runs/attach-result-files");
    const filesystem = require("../../services/workspaceFiles");
    const filePath = path.join(directory, "final.md");
    const backupPath = path.join(directory, "outputs-backup.jsonl");
    fs.writeFileSync(filePath, "# 报告");
    const manager = jest
      .spyOn(filesystem, "forWorkspace")
      .mockReturnValue({
        ensureInitialized: async () => {},
        validatePath: async () => filePath,
      });
    try {
      const original = {
        text: "报告：`/workspace/reports/final.md`",
        agentRunId: run.id,
        sources: [{ title: "原资料" }],
      };
      const saved = await AgentRun.finalizeWithResponse(run.id, {
        status: "completed",
        terminationReason: "completed",
        response: original,
      });
      expect((await attachResultFiles(run.id, { backupPath })).added).toBe(1);
      expect((await attachResultFiles(run.id, { backupPath })).action).toBe(
        "unchanged"
      );
      const stored = JSON.parse(
        (
          await mockPrisma.workspace_chats.findUnique({
            where: { id: saved.chat.id },
          })
        ).response
      );
      expect(stored).toMatchObject(original);
      expect(stored.outputs).toHaveLength(1);
      expect(
        JSON.parse(
          JSON.parse(fs.readFileSync(backupPath, "utf8").trim()).response
        )
      ).toEqual(original);
    } finally {
      manager.mockRestore();
    }
  });

  it.each(["completion", "interrupt"])(
    "ignores a late runtime %s after cancellation",
    async (kind) => {
      await seedPartialReply();
      requireRuntime.mockReturnValue({
        definition: { id: "default-react", version: 1 },
        runtime: {
          executeSegment: async () => {
            await persistFailedAgentRun(
              run.id,
              new Error("Cancelled by user."),
              { cancelled: true }
            );
            return kind === "interrupt"
              ? { kind, interrupt: { kind: "input", requestId: "input-1" } }
              : { kind, text: "迟到的回复" };
          },
        },
      });
      const result = await executeAgentRunSegment(
        run,
        new AbortController().signal
      );
      expect(result.status).toBe("cancelled");
      expect(await mockPrisma.workspace_chats.count()).toBe(1);
      const events = await AgentRunEvent.after(run.id);
      expect(
        events.some((event) =>
          ["run.completed", "input.requested"].includes(event.type)
        )
      ).toBe(false);
    }
  );

  it("previews recovery without writes, then restores once when explicitly applied", async () => {
    await seedPartialReply();
    await AgentRun.update(run.id, { status: "cancelled" });
    const preview = await recoverCancelledChat(run.id);
    expect(preview).toMatchObject({
      action: "preview",
      textParts: 2,
      toolGroups: 1,
    });
    expect(await mockPrisma.workspace_chats.count()).toBe(0);
    expect((await AgentRun.get(run.id)).finalResponse).toBeNull();
    const restored = await recoverCancelledChat(run.id, { apply: true });
    expect(restored.action).toBe("restored");
    const repeated = await recoverCancelledChat(run.id, { apply: true });
    expect(repeated).toMatchObject({
      action: "already_saved",
      chatId: restored.chatId,
    });
    expect(await mockPrisma.workspace_chats.count()).toBe(1);
  });

  it("does not recover active runs or conversations with persistence disabled", async () => {
    await expect(recoverCancelledChat(run.id, { apply: true })).rejects.toThrow(
      "cancelled run"
    );
    await AgentRun.update(run.id, {
      status: "cancelled",
      configuration: { persistChat: false },
    });
    await expect(recoverCancelledChat(run.id, { apply: true })).rejects.toThrow(
      "disabled chat persistence"
    );
    expect(await mockPrisma.workspace_chats.count()).toBe(0);
  });
});
