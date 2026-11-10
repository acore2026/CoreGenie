const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { PrismaClient } = require("@prisma/client");
const Database = require("better-sqlite3");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "thread-lifecycle-"));
const databasePath = path.join(directory, "test.db");
const mockPrisma = new PrismaClient({
  datasources: { db: { url: `file:${databasePath}` } },
});
jest.mock("../../utils/prisma", () => mockPrisma);
const {
  threadVisibility,
  canViewThread,
  acceptThreadSubmission,
  retainThreadDraft,
  updateDraftSession,
} = require("../../models/threadLifecycle");

describe("private draft lifecycle", () => {
  let thread;
  let schemaSql;
  const session = (action, extra = {}) =>
    updateDraftSession({
      threadId: thread.id,
      userId: 1,
      sessionId: "tab-a",
      action,
      ...extra,
    });
  beforeAll(async () => {
    const sql = execFileSync(
      process.execPath,
      [
        require.resolve("prisma/build/index.js"),
        "migrate",
        "diff",
        "--from-empty",
        "--to-schema-datamodel",
        path.resolve(__dirname, "../../prisma/schema.prisma"),
        "--script",
      ],
      { encoding: "utf8" }
    );
    schemaSql = sql;
    const db = new Database(databasePath);
    db.exec(sql);
    db.close();
    await Promise.all(
      [
        { id: 1, username: "owner", password: "test" },
        { id: 2, username: "member", password: "test" },
      ].map((data) => mockPrisma.users.create({ data }))
    );
    await mockPrisma.workspaces.create({
      data: { id: 10, name: "Test", slug: "test" },
    });
  }, 30000);
  beforeEach(async () => {
    await mockPrisma.workspace_chats.deleteMany();
    await mockPrisma.agent_runs.deleteMany();
    await mockPrisma.workspace_agent_invocations.deleteMany();
    await mockPrisma.workspace_threads.deleteMany();
    thread = await mockPrisma.workspace_threads.create({
      data: {
        workspace_id: 10,
        user_id: 1,
        name: "Thread",
        slug: "draft",
      },
    });
  });
  afterAll(async () => {
    await mockPrisma.$disconnect();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("migrates existing submitted and reset histories while leaving unused threads private", () => {
    const db = new Database(":memory:");
    try {
      db.exec(
        schemaSql
          .replace(/^.*"(?:submittedAt|draftTouchedAt)" DATETIME.*\n/gm, "")
          .replace(
            /CREATE TABLE "workspace_thread_sessions" \([\s\S]*?\);/g,
            ""
          )
          .replace(
            /^CREATE INDEX "workspace_thread_sessions_threadId_expiresAt_idx".*$/gm,
            ""
          )
      );
      db.exec(`
        INSERT INTO workspaces (id, name, slug) VALUES (1, 'Test', 'test');
        INSERT INTO workspace_threads (id, name, slug, workspace_id) VALUES
          (1, 'Thread', 'empty', 1), (2, 'Thread', 'reset', 1),
          (3, 'Thread', 'task', 1), (4, 'Thread', 'invocation', 1);
        INSERT INTO workspace_chats (workspaceId, thread_id, prompt, response, include) VALUES (1, 2, 'Hello', '{}', false);
        INSERT INTO agent_runs (id, workspace_id, thread_id, prompt, checkpointThreadId) VALUES ('run', 1, 3, 'Task', 'run');
        INSERT INTO workspace_agent_invocations (uuid, workspace_id, thread_id, prompt) VALUES ('invocation', 1, 4, 'Task');
      `);
      db.exec(
        fs.readFileSync(
          path.resolve(
            __dirname,
            "../../prisma/migrations/20261008120000_thread_drafts/migration.sql"
          ),
          "utf8"
        )
      );
      expect(
        db
          .prepare(
            "SELECT id FROM workspace_threads WHERE submittedAt IS NOT NULL ORDER BY id"
          )
          .all()
      ).toEqual([{ id: 2 }, { id: 3 }, { id: 4 }]);
      expect(
        db
          .prepare("SELECT draftTouchedAt FROM workspace_threads WHERE id = 1")
          .get()
      ).toEqual({ draftTouchedAt: null });
    } finally {
      db.close();
    }
  });

  it("keeps drafts private in both lists and direct access", async () => {
    expect(canViewThread(thread, 1)).toBe(true);
    expect(canViewThread(thread, 2)).toBe(false);
    expect(canViewThread(thread, null)).toBe(false);
    expect(
      await mockPrisma.workspace_threads.count({ where: threadVisibility(1) })
    ).toBe(1);
    expect(
      await mockPrisma.workspace_threads.count({ where: threadVisibility(2) })
    ).toBe(0);
    await acceptThreadSubmission(thread.id);
    const submitted = await mockPrisma.workspace_threads.findUnique({
      where: { id: thread.id },
    });
    expect(canViewThread(submitted, 2)).toBe(true);
    expect(
      await mockPrisma.workspace_threads.count({ where: threadVisibility(2) })
    ).toBe(1);
  });
  it("deletes a completely unused thread on departure", async () => {
    await session("enter");
    expect(await session("leave")).toEqual({ deleted: true });
    expect(await mockPrisma.workspace_threads.count()).toBe(0);
    expect(await mockPrisma.workspace_thread_sessions.count()).toBe(0);
  });
  it("retains a touched draft even after its text is cleared", async () => {
    await session("touch", { retain: true });
    expect(await session("leave")).toEqual({ deleted: false });
  });
  it("protects uploads before parsing finishes without publishing the thread", async () => {
    await retainThreadDraft(thread.id);
    expect(await session("leave")).toEqual({ deleted: false });
    expect(
      await mockPrisma.workspace_threads.count({ where: threadVisibility(2) })
    ).toBe(0);
  });
  it("retains accepted submissions even without persisted chat history", async () => {
    await acceptThreadSubmission(thread.id);
    expect(await session("leave")).toEqual({ deleted: false });
  });
  it("retains existing chats and files", async () => {
    await mockPrisma.workspace_chats.create({
      data: {
        workspaceId: 10,
        thread_id: thread.id,
        prompt: "Hello",
        response: "{}",
      },
    });
    expect(await session("leave")).toEqual({ deleted: false });
    await mockPrisma.workspace_chats.deleteMany();
    await mockPrisma.workspace_parsed_files.create({
      data: {
        filename: "attachment.json",
        workspaceId: 10,
        threadId: thread.id,
      },
    });
    expect(await session("leave")).toEqual({ deleted: false });
  });
  it("retains tasks and agent invocations", async () => {
    await mockPrisma.agent_runs.create({
      data: {
        id: "run",
        workspace_id: 10,
        thread_id: thread.id,
        prompt: "Task",
        checkpointThreadId: "run",
      },
    });
    expect(await session("leave")).toEqual({ deleted: false });
    await mockPrisma.agent_runs.deleteMany();
    await mockPrisma.workspace_agent_invocations.create({
      data: {
        uuid: "invocation",
        prompt: "Task",
        workspace_id: 10,
        thread_id: thread.id,
      },
    });
    expect(await session("leave")).toEqual({ deleted: false });
  });
  it("retains manually renamed threads", async () => {
    await mockPrisma.workspace_threads.update({
      where: { id: thread.id },
      data: { name: "My draft" },
    });
    expect(await session("leave")).toEqual({ deleted: false });
  });
  it("does not delete a thread still open in another tab", async () => {
    await session("enter");
    await session("enter", { sessionId: "tab-b" });
    expect(await session("leave")).toEqual({ deleted: false });
    expect(await session("leave", { sessionId: "tab-b" })).toEqual({
      deleted: true,
    });
  });
  it("allows refresh to renew a lease and ignores expired abandoned leases", async () => {
    await session("enter");
    await session("enter");
    expect(await mockPrisma.workspace_thread_sessions.count()).toBe(1);
    await mockPrisma.workspace_thread_sessions.create({
      data: {
        id: "abandoned",
        threadId: thread.id,
        expiresAt: new Date(0),
      },
    });
    expect(await session("leave")).toEqual({ deleted: true });
  });
  it("releases a refreshed page without deleting its thread or blocking later cleanup", async () => {
    await session("enter");
    expect(await session("release")).toEqual({ deleted: false });
    expect(await mockPrisma.workspace_threads.count()).toBe(1);
    expect(await mockPrisma.workspace_thread_sessions.count()).toBe(0);
    await session("enter", { sessionId: "refreshed" });
    expect(await session("leave", { sessionId: "refreshed" })).toEqual({
      deleted: true,
    });
  });
  it("rejects cleanup by another user and submissions to deleted threads", async () => {
    expect(await session("leave", { userId: 2 })).toEqual({ deleted: false });
    await session("leave");
    await expect(acceptThreadSubmission(thread.id)).rejects.toThrow(
      "会话不存在"
    );
  });
});
