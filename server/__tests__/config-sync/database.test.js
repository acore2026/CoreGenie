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
      'CREATE TABLE predefined_agents (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, iconFilename TEXT, description TEXT NOT NULL DEFAULT "", welcomeMessage TEXT, examplePrompts TEXT NOT NULL DEFAULT "[]", tools TEXT, skillIds TEXT NOT NULL DEFAULT "[]", systemPrompt TEXT NOT NULL, runtimeKey TEXT NOT NULL DEFAULT "governed-agent", runtimeConfig TEXT NOT NULL DEFAULT "{}", isBuiltinDefault BOOLEAN NOT NULL DEFAULT false, enabled BOOLEAN NOT NULL DEFAULT true, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, lastUpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE predefined_agent_skills (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT "", instructions TEXT NOT NULL, activeRevision TEXT, archived BOOLEAN NOT NULL DEFAULT false, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, lastUpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE agent_skill_revisions (id TEXT PRIMARY KEY, skillId INTEGER NOT NULL, sha256 TEXT NOT NULL, manifest TEXT NOT NULL, fileManifest TEXT NOT NULL DEFAULT "[]", packagePath TEXT NOT NULL, createdBy INTEGER, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(skillId, sha256))',
    ])
      await mockPrisma.$executeRawUnsafe(sql);
    database = new ConfigDatabase(mockPrisma, saveState);
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
    expect(await mockPrisma.predefined_agents.count()).toBe(9);
    expect(await mockPrisma.predefined_agent_skills.count()).toBe(7);
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
