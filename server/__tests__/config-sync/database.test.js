const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { PrismaClient } = require("@prisma/client");
let mockPrisma;
jest.mock(
  "../../utils/prisma",
  () => new Proxy({}, { get: (_target, key) => mockPrisma[key] })
);
const { ConfigDatabase } = require("../../config-sync/database");
const { ConfigFiles } = require("../../config-sync/files");
const { Synchronizer } = require("../../config-sync/engine");

describe("configuration sync with an isolated database", () => {
  let root, previousStorage, database, sync, files;
  const saveState = async (state, client = mockPrisma) => {
    await client.system_settings.upsert({
      where: { label: "test_sync_state" },
      create: { label: "test_sync_state", value: JSON.stringify(state) },
      update: { value: JSON.stringify(state) },
    });
  };
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "config-sync-db-test-"));
    previousStorage = process.env.STORAGE_DIR;
    process.env.STORAGE_DIR = path.join(root, "storage");
    mockPrisma = new PrismaClient({
      datasources: { db: { url: `file:${path.join(root, "test.db")}` } },
    });
    for (const sql of [
      "CREATE TABLE system_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL UNIQUE, value TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, lastUpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)",
      'CREATE TABLE predefined_agents (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, iconFilename TEXT, description TEXT NOT NULL DEFAULT "", welcomeMessage TEXT, examplePrompts TEXT NOT NULL DEFAULT "[]", tools TEXT, skillIds TEXT NOT NULL DEFAULT "[]", systemPrompt TEXT NOT NULL, runtimeKey TEXT NOT NULL DEFAULT "governed-agent", runtimeConfig TEXT NOT NULL DEFAULT "{}", isBuiltinDefault BOOLEAN NOT NULL DEFAULT false, enabled BOOLEAN NOT NULL DEFAULT true, showInRoster BOOLEAN NOT NULL DEFAULT true, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, lastUpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE predefined_agent_skills (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT "", instructions TEXT NOT NULL, activeRevision TEXT, archived BOOLEAN NOT NULL DEFAULT false, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, lastUpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE agent_skill_revisions (id TEXT PRIMARY KEY, skillId INTEGER NOT NULL, sha256 TEXT NOT NULL, manifest TEXT NOT NULL, fileManifest TEXT NOT NULL DEFAULT "[]", packagePath TEXT NOT NULL, createdBy INTEGER, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(skillId, sha256))',
    ])
      await mockPrisma.$executeRawUnsafe(sql);
    await mockPrisma.$executeRawUnsafe(
      "ALTER TABLE predefined_agents ADD COLUMN wizard TEXT"
    );
    database = new ConfigDatabase(mockPrisma, saveState);
    for (const sql of (
      await fs.readFile(
        path.resolve(
          __dirname,
          "../../prisma/migrations/20260922100000_standalone_quick_tasks/migration.sql"
        ),
        "utf8"
      )
    )
      .split(";")
      .filter((sql) => sql.trim()))
      await mockPrisma.$executeRawUnsafe(sql);
    files = new ConfigFiles(path.join(root, "config"));
    sync = new Synchronizer({
      files,
      database,
      saveState,
      loadState: async () => {
        const record = await mockPrisma.system_settings.findUnique({
          where: { label: "test_sync_state" },
        });
        return record ? JSON.parse(record.value) : { keys: {}, entries: {} };
      },
    });
  });

  it("accepts shared quick task bindings in Agent YAML", async () => {
    const source = await new ConfigFiles(
      path.resolve(__dirname, "../../../agent-config")
    ).read("agents/3gpp-review");

    expect(source.quickTasks).toEqual([
      "proposal-topic-analysis",
      "proposal-company-comparison",
      "proposal-tdoc-analysis",
    ]);
  });

  afterEach(async () => {
    await mockPrisma.$disconnect();
    if (previousStorage === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = previousStorage;
    await fs.rm(root, { recursive: true, force: true });
  });

  it("imports production definitions with portable bindings and converges", async () => {
    await fs.cp(path.resolve(__dirname, "../../../agent-config"), files.root, {
      recursive: true,
    });
    // An empty database's default empty prompt should be explicitly resolved on initial import.
    const first = await sync.reconcile();
    expect(first.items.filter((item) => item.status === "error")).toEqual([]);
    expect(await mockPrisma.predefined_agents.count()).toBe(10);
    expect(await mockPrisma.predefined_agent_skills.count()).toBe(9);
    const second = await sync.reconcile();
    expect(
      second.items.filter(
        (item) => item.key !== "global-prompt" && item.status !== "synced"
      )
    ).toEqual([]);
    const agent = await mockPrisma.predefined_agents.findFirst({
      where: { name: "3GPP 文档拆分助手" },
    });
    const skill = await mockPrisma.predefined_agent_skills.findFirst({
      where: { name: "3gpp-split-docx" },
    });
    expect(JSON.parse(agent.skillIds)).toEqual([skill.id]);
  });

  it("adopts an existing Agent by name and does not duplicate it", async () => {
    const agent = await mockPrisma.predefined_agents.create({
      data: { name: "Sample", systemPrompt: "original" },
    });
    await files.write("agents/sample", {
      name: "Sample",
      systemPrompt: "repo edit",
    });
    const first = await sync.reconcile();
    expect(
      first.items.find((item) => item.key === "agents/sample").status
    ).toBe("conflict");
    expect(await mockPrisma.predefined_agents.count()).toBe(1);
    const item = first.items.find((value) => value.key === "agents/sample");
    await sync.reconcile({ ...item, side: "file" });
    expect(
      (
        await mockPrisma.predefined_agents.findUnique({
          where: { id: agent.id },
        })
      ).systemPrompt
    ).toBe("repo edit");
    expect(await mockPrisma.predefined_agents.count()).toBe(1);
  });

  it("shares edits across agents, preserves bindings when archived, and exports edits", async () => {
    const task = {
      id: "shared-task",
      version: 1,
      title: "任务",
      instructions: "请分析",
      fields: [{ id: "topic", type: "text", label: "主题" }],
    };
    await files.write("quick-tasks/shared-task", task);
    for (const name of ["first", "second"])
      await files.write(`agents/${name}`, {
        name,
        systemPrompt: "test",
        quickTasks: [task.id],
      });
    expect(
      (await sync.reconcile()).items.filter((item) => item.status === "error")
    ).toEqual([]);
    const { PredefinedQuickTask } = require("../../models/predefinedQuickTask");
    const { PredefinedAgent } = require("../../models/predefinedAgent");
    const record = (await PredefinedQuickTask.all())[0];
    await PredefinedQuickTask.update(record.id, {
      ...record,
      title: "新标题",
      definition: { ...task, instructions: "新说明" },
    });
    const agents = await PredefinedAgent.all();
    expect(agents.map((agent) => agent.wizard[0].instructions)).toEqual([
      "新说明",
      "新说明",
    ]);
    await sync.reconcile();
    expect((await files.read("quick-tasks/shared-task")).title).toBe("新标题");
    await PredefinedQuickTask.update(record.id, {
      ...(await PredefinedQuickTask.get(record.id)),
      archived: true,
    });
    expect(
      (await PredefinedAgent.all()).every(
        (agent) => !agent.wizard.length && agent.quickTaskIds[0] === record.id
      )
    ).toBe(true);
    await sync.reconcile();
    expect((await files.read("quick-tasks/shared-task")).archived).toBe(true);
  });

  it("migrates legacy forms once and preserves their customized contents", async () => {
    const task = {
      version: 1,
      title: "自定义旧任务",
      instructions: "自定义说明",
      fields: [{ id: "topic", type: "text", label: "主题" }],
    };
    const agent = await mockPrisma.predefined_agents.create({
      data: {
        name: "legacy",
        systemPrompt: "test",
        wizard: JSON.stringify(task),
      },
    });
    const { migrateLegacy } = require("../../models/predefinedQuickTask");
    await mockPrisma.$transaction((client) => migrateLegacy(client));
    await mockPrisma.$transaction((client) => migrateLegacy(client));
    expect(await mockPrisma.predefined_quick_tasks.count()).toBe(1);
    const updated = await mockPrisma.predefined_agents.findUnique({
      where: { id: agent.id },
    });
    expect(updated.wizard).toBeNull();
    expect(JSON.parse(updated.quickTaskIds)).toHaveLength(1);
    const result =
      await require("../../models/predefinedAgent").PredefinedAgent.get(
        agent.id
      );
    expect(result.wizard[0]).toEqual(expect.objectContaining(task));
  });

  it("imports legacy YAML forms on the first sync and exports shared bindings", async () => {
    const wizard = {
      version: 1,
      title: "旧配置",
      instructions: "保留此说明",
      fields: [{ id: "topic", type: "text", label: "主题" }],
    };
    await files.write("agents/legacy-yaml", {
      name: "legacy yaml",
      systemPrompt: "test",
      wizard,
    });
    expect(
      (await sync.reconcile()).items.filter((item) => item.status === "error")
    ).toEqual([]);
    const agent = await mockPrisma.predefined_agents.findFirst();
    expect(agent.wizard).toBeNull();
    expect(JSON.parse(agent.quickTaskIds)).toHaveLength(1);
    expect(
      JSON.parse(
        (await mockPrisma.predefined_quick_tasks.findFirst()).definition
      )
    ).toMatchObject(wizard);
    await sync.reconcile();
    expect((await files.read("agents/legacy-yaml")).quickTasks).toHaveLength(1);
    expect(await mockPrisma.predefined_quick_tasks.count()).toBe(1);
  });

  const taskInput = (key, large = false) => ({
    key,
    title: "任务",
    description: "",
    definition: {
      version: 1,
      title: "任务",
      instructions: "请分析",
      fields: large
        ? Array.from({ length: 30 }, (_, index) => ({
            id: `field_${index}`,
            type: "text",
            label: "主题",
            hint: "字".repeat(500),
            placeholder: "字".repeat(500),
          }))
        : [{ id: "topic", type: "text", label: "主题" }],
    },
  });

  async function request(method, route, body, id) {
    const routes = new Map();
    const app = Object.fromEntries(
      ["get", "post", "put", "delete"].map((verb) => [
        verb,
        (path, _middleware, handler) => routes.set(`${verb} ${path}`, handler),
      ])
    );
    require("../../endpoints/predefinedAgents").predefinedAgentEndpoints(app);
    const response = { status: jest.fn(() => response), json: jest.fn() };
    await routes.get(`${method} ${route}`)({ body, params: { id } }, response);
    return {
      status: response.status.mock.calls[0][0],
      ...response.json.mock.calls[0][0],
    };
  }

  it("rejects invalid forms, immutable keys and missing bindings through the API", async () => {
    const { PredefinedQuickTask } = require("../../models/predefinedQuickTask");
    const invalid = {
      ...taskInput("invalid"),
      definition: { version: 1, fields: [] },
    };
    for (const route of [
      "/admin/predefined-quick-tasks",
      "/admin/predefined-quick-tasks/validate",
    ])
      expect((await request("post", route, invalid)).status).toBe(400);
    const task = await PredefinedQuickTask.create(taskInput("original"));
    expect(
      (
        await request(
          "put",
          "/admin/predefined-quick-tasks/:id",
          taskInput("changed"),
          task.id
        )
      ).status
    ).toBe(400);
    expect((await PredefinedQuickTask.get(task.id)).key).toBe("original");
    const body = { name: "API", systemPrompt: "test" };
    const created = await request("post", "/admin/predefined-agents", body);
    for (const ids of [[99999], [task.id, task.id], ["1"], null]) {
      expect(
        (
          await request("post", "/admin/predefined-agents", {
            ...body,
            quickTaskIds: ids,
          })
        ).status
      ).toBe(400);
      expect(
        (
          await request(
            "put",
            "/admin/predefined-agents/:id",
            { ...body, quickTaskIds: ids },
            created.agent.id
          )
        ).status
      ).toBe(400);
    }
    expect(await mockPrisma.predefined_agents.count()).toBe(1);
  });

  it("distinguishes omitted and empty bindings and migrates old-client updates immediately", async () => {
    const { PredefinedQuickTask } = require("../../models/predefinedQuickTask");
    const task = await PredefinedQuickTask.create(taskInput("shared"));
    const body = { name: "API", systemPrompt: "test" };
    const created = await request("post", "/admin/predefined-agents", {
      ...body,
      quickTaskIds: [task.id],
    });
    const save = (patch) =>
      request(
        "put",
        "/admin/predefined-agents/:id",
        { ...body, ...patch },
        created.agent.id
      );
    expect((await save({})).agent.quickTaskIds).toEqual([task.id]);
    expect((await save({ quickTaskIds: [] })).agent.wizard).toBeNull();
    const legacy = taskInput("unused").definition;
    const migrated = await save({ wizard: legacy });
    expect(migrated.status).toBe(200);
    expect(migrated.agent.wizard[0]).toMatchObject(legacy);
    expect(
      (await save({ wizard: migrated.agent.wizard })).agent.quickTaskIds
    ).toEqual(migrated.agent.quickTaskIds);
    expect((await save({ wizard: legacy })).agent.quickTaskIds).toEqual(
      migrated.agent.quickTaskIds
    );
    const edited = await save({
      wizard: { ...legacy, instructions: "修改后的说明" },
    });
    expect(edited.agent.wizard[0].instructions).toBe("修改后的说明");
    expect(
      (await PredefinedQuickTask.get(task.id)).definition.instructions
    ).toBe("请分析");
    expect((await save({ wizard: null })).agent.quickTaskIds).toEqual([]);
    const explicit = await save({ wizard: legacy, quickTaskIds: [] });
    expect(explicit.agent.wizard).toBeNull();
    const oldCreate = await request("post", "/admin/predefined-agents", {
      ...body,
      wizard: legacy,
    });
    expect(oldCreate.agent.quickTaskIds).toEqual(migrated.agent.quickTaskIds);
    expect(
      (
        await mockPrisma.predefined_agents.findUnique({
          where: { id: oldCreate.agent.id },
        })
      ).wizard
    ).toBeNull();
  });

  it("preserves legacy submissions after the migrated shared task was edited", async () => {
    const { PredefinedQuickTask } = require("../../models/predefinedQuickTask");
    const body = {
      name: "Legacy",
      systemPrompt: "test",
      wizard: taskInput("unused").definition,
    };
    const first = await request("post", "/admin/predefined-agents", body);
    const task = await PredefinedQuickTask.get(first.agent.quickTaskIds[0]);
    await PredefinedQuickTask.update(task.id, {
      ...task,
      definition: { ...task.definition, instructions: "共享库中的修改" },
    });
    const second = await request("post", "/admin/predefined-agents", body);
    expect(second.agent.wizard[0].instructions).toBe(body.wizard.instructions);
    expect(second.agent.quickTaskIds).not.toEqual(first.agent.quickTaskIds);
    expect(
      (await PredefinedQuickTask.get(task.id)).definition.instructions
    ).toBe("共享库中的修改");
    const repeated = await request("post", "/admin/predefined-agents", body);
    expect(repeated.agent.quickTaskIds).toEqual(second.agent.quickTaskIds);
    expect(await mockPrisma.predefined_quick_tasks.count()).toBe(2);
  });

  it("rejects oversized combinations on binding and shared-task edits without partial writes", async () => {
    const { PredefinedQuickTask } = require("../../models/predefinedQuickTask");
    const tasks = [];
    for (let index = 0; index < 6; index++)
      tasks.push(
        await PredefinedQuickTask.create(taskInput(`large-${index}`, index < 5))
      );
    const body = {
      name: "API",
      systemPrompt: "test",
      quickTaskIds: tasks.map((task) => task.id),
    };
    const created = await request("post", "/admin/predefined-agents", body);
    expect(created.status).toBe(200);
    const edit = await request(
      "put",
      "/admin/predefined-quick-tasks/:id",
      taskInput("large-5", true),
      tasks[5].id
    );
    expect(edit.status).toBe(400);
    expect(edit.error).toContain("180000");
    expect(
      (await PredefinedQuickTask.get(tasks[5].id)).definition.fields
    ).toHaveLength(1);
    await expect(
      database.apply(
        mockPrisma,
        "quick-tasks/large-5",
        {
          ...taskInput("large-5", true).definition,
          id: "large-5",
        },
        tasks[5].id,
        { entries: {} }
      )
    ).rejects.toThrow("180000");
    const extra = await PredefinedQuickTask.create(taskInput("extra", true));
    const oversized = {
      ...body,
      quickTaskIds: [...body.quickTaskIds.slice(0, 5), extra.id],
    };
    expect(
      (await request("post", "/admin/predefined-agents", oversized)).status
    ).toBe(400);
    expect(
      (
        await request(
          "put",
          "/admin/predefined-agents/:id",
          oversized,
          created.agent.id
        )
      ).status
    ).toBe(400);
    expect(await mockPrisma.predefined_agents.count()).toBe(1);
    expect(
      JSON.parse(
        (
          await mockPrisma.predefined_agents.findUnique({
            where: { id: created.agent.id },
          })
        ).quickTaskIds
      )
    ).toEqual(body.quickTaskIds);
  });

  it("removes deleted resources and keeps old packages usable after archive", async () => {
    await files.write("skills/sample", {
      skillMd: "---\nname: sample\ndescription: Sample\n---\nText",
      archived: false,
      files: { "old.txt": Buffer.from("old").toString("base64") },
    });
    await sync.reconcile();
    const original = await mockPrisma.predefined_agent_skills.findFirst();
    await files.write("skills/sample", {
      skillMd: "---\nname: sample\ndescription: Sample\n---\nNew text",
      archived: true,
      files: {},
    });
    await sync.reconcile();
    const updated = await mockPrisma.predefined_agent_skills.findFirst();
    expect(updated.archived).toBe(true);
    expect(updated.activeRevision).not.toBe(original.activeRevision);
    const {
      PredefinedAgentSkill,
    } = require("../../models/predefinedAgentSkill");
    const historic = await PredefinedAgentSkill.getRevision(
      original.id,
      original.activeRevision
    );
    expect(historic.files.some((file) => file.path === "old.txt")).toBe(true);
    const current = await PredefinedAgentSkill.getRevision(
      updated.id,
      updated.activeRevision
    );
    expect(current.files.some((file) => file.path === "old.txt")).toBe(false);
  });

  it("rolls back imports if their identity mapping cannot be saved", async () => {
    database.saveState = async () => {
      throw new Error("state save failed");
    };
    await files.write("agents/sample", {
      name: "Sample",
      systemPrompt: "Hello",
    });
    const result = await sync.reconcile();
    expect(
      result.items.find((item) => item.key === "agents/sample").status
    ).toBe("error");
    expect(await mockPrisma.predefined_agents.count()).toBe(0);
  });
});
