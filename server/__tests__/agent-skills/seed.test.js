/* eslint-env jest, node */
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { PrismaClient } = require("@prisma/client");
let mockPrisma;
jest.mock(
  "../../utils/prisma",
  () => new Proxy({}, { get: (_target, key) => mockPrisma[key] })
);
const {
  seedRepositoryConfig,
  SEED_SETTING,
  CONFIG_ROOT,
} = require("../../agent-skills/seed");
const { ConfigFiles } = require("../../config-sync/files");
const { ConfigDatabase } = require("../../config-sync/database");
const { hash } = require("../../config-sync/engine");

describe("single-source repository seeds", () => {
  let root, previousStorage, previousSync;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-seed-test-"));
    previousStorage = process.env.STORAGE_DIR;
    previousSync = process.env.AGENT_CONFIG_SYNC_ENABLED;
    process.env.STORAGE_DIR = path.join(root, "storage");
    delete process.env.AGENT_CONFIG_SYNC_ENABLED;
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
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await mockPrisma.$disconnect();
    if (previousStorage === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = previousStorage;
    if (previousSync === undefined)
      delete process.env.AGENT_CONFIG_SYNC_ENABLED;
    else process.env.AGENT_CONFIG_SYNC_ENABLED = previousSync;
    await fs.rm(root, { recursive: true, force: true });
  });

  it("seeds exactly the canonical prompts, settings, bindings and complete packages", async () => {
    expect(SEED_SETTING).toBe("agent_config_seed_v1");
    await seedRepositoryConfig();
    expect(await mockPrisma.predefined_agents.count()).toBe(9);
    expect(await mockPrisma.predefined_agent_skills.count()).toBe(7);
    const disk = await new ConfigFiles(CONFIG_ROOT).list();
    const database = await new ConfigDatabase(mockPrisma).list(
      { entries: {}, keys: {} },
      disk
    );
    expect(Object.keys(database).sort()).toEqual(Object.keys(disk).sort());
    for (const key of Object.keys(disk)) {
      expect(disk[key].error).toBeUndefined();
      expect(hash(database[key].value)).toBe(hash(disk[key].value));
    }
    const experimental = await mockPrisma.predefined_agents.findFirst({
      where: { name: disk["agents/3gpp-review-experimental"].value.name },
    });
    expect(experimental.runtimeKey).toBe("evidence-research");
    expect(experimental.tools).toBeNull();
    expect(JSON.parse(experimental.skillIds)).toHaveLength(7);
    expect(
      (
        await mockPrisma.system_settings.findUnique({
          where: { label: SEED_SETTING },
        })
      ).value
    ).toBe("complete");
  });

  it("migrates legacy identities in place and keeps the installation default and global prompt", async () => {
    const skill = await mockPrisma.predefined_agent_skills.create({
      data: { name: "3gpp-tdocs", instructions: "Legacy" },
    });
    const review = await mockPrisma.predefined_agents.create({
      data: { name: "3GPP 提案分析助手（Skill）", systemPrompt: "Legacy" },
    });
    const general = await mockPrisma.predefined_agents.create({
      data: {
        name: "Custom fallback",
        systemPrompt: "Legacy",
        isBuiltinDefault: true,
        iconFilename: "keep.png",
      },
    });
    for (const data of [
      { label: "default_predefined_agent_id", value: String(review.id) },
      {
        label: "global_system_prompt",
        value: "Keep the administrator's prompt",
      },
      { label: "agent_skill_seed_3gpp_review_v17", value: "complete" },
    ])
      await mockPrisma.system_settings.create({ data });
    await seedRepositoryConfig();
    expect(await mockPrisma.predefined_agents.count()).toBe(9);
    expect(await mockPrisma.predefined_agent_skills.count()).toBe(7);
    expect(
      (
        await mockPrisma.predefined_agent_skills.findUnique({
          where: { id: skill.id },
        })
      ).name
    ).toBe("3gpp-review");
    expect(
      (
        await mockPrisma.predefined_agents.findUnique({
          where: { id: review.id },
        })
      ).name
    ).toBe("3GPP 提案分析助手");
    expect(
      await mockPrisma.predefined_agents.findUnique({
        where: { id: general.id },
      })
    ).toMatchObject({
      isBuiltinDefault: true,
      iconFilename: "keep.png",
      enabled: false,
    });
    expect(
      (
        await mockPrisma.system_settings.findUnique({
          where: { label: "default_predefined_agent_id" },
        })
      ).value
    ).toBe(String(review.id));
    expect(
      (
        await mockPrisma.system_settings.findUnique({
          where: { label: "global_system_prompt" },
        })
      ).value
    ).toBe("Keep the administrator's prompt");
  });

  it("does not overwrite later web edits on repeated initialization", async () => {
    await seedRepositoryConfig();
    const agent = await mockPrisma.predefined_agents.findFirst();
    await mockPrisma.predefined_agents.update({
      where: { id: agent.id },
      data: { systemPrompt: "Web edit" },
    });
    await seedRepositoryConfig();
    expect(
      (
        await mockPrisma.predefined_agents.findUnique({
          where: { id: agent.id },
        })
      ).systemPrompt
    ).toBe("Web edit");
    expect(await mockPrisma.agent_skill_revisions.count()).toBe(7);
  });

  it("never seeds while live repository sync is enabled", async () => {
    process.env.AGENT_CONFIG_SYNC_ENABLED = "true";
    await seedRepositoryConfig();
    expect(await mockPrisma.predefined_agents.count()).toBe(0);
    expect(await mockPrisma.system_settings.count()).toBe(0);
  });

  it.each([
    {},
    { "global-prompt": { value: "" } },
    {
      "global-prompt": { value: "" },
      "skills/test": { error: "Broken package" },
      "agents/test": { value: {} },
    },
    {
      "global-prompt": { value: "" },
      "skills/test": {
        value: { skillMd: "---\nname: test\ndescription: test\n---\nTest" },
      },
      "agents/test": { value: { name: "Test", skills: ["missing"] } },
    },
  ])(
    "rejects missing or invalid definitions before changing the database",
    async (definitions) => {
      jest.spyOn(ConfigFiles.prototype, "list").mockResolvedValue(definitions);
      await expect(seedRepositoryConfig()).rejects.toThrow();
      expect(await mockPrisma.predefined_agents.count()).toBe(0);
      expect(await mockPrisma.predefined_agent_skills.count()).toBe(0);
      expect(await mockPrisma.system_settings.count()).toBe(0);
    }
  );

  it("rejects ambiguous existing names instead of choosing an arbitrary record", async () => {
    for (const data of [
      { name: "3GPP 提案分析助手", systemPrompt: "First" },
      { name: "3GPP 提案分析助手", systemPrompt: "Second" },
    ])
      await mockPrisma.predefined_agents.create({ data });
    await expect(seedRepositoryConfig()).rejects.toThrow("Ambiguous");
    expect(await mockPrisma.predefined_agents.count()).toBe(2);
    expect(await mockPrisma.predefined_agent_skills.count()).toBe(0);
  });

  it("rejects a renamed fallback that also matches another definition", async () => {
    await mockPrisma.predefined_agents.create({
      data: {
        name: "3GPP 提案分析助手",
        systemPrompt: "Keep",
        isBuiltinDefault: true,
      },
    });
    await expect(seedRepositoryConfig()).rejects.toThrow(
      "multiple definitions"
    );
    expect(await mockPrisma.predefined_agents.count()).toBe(1);
    expect(await mockPrisma.predefined_agent_skills.count()).toBe(0);
  });

  it("rolls back database changes if a package import fails", async () => {
    const apply = ConfigDatabase.prototype.apply;
    jest.spyOn(ConfigDatabase.prototype, "apply").mockImplementation(function (
      ...args
    ) {
      if (args[1].startsWith("agents/")) throw new Error("Import failed");
      return apply.apply(this, args);
    });
    await expect(seedRepositoryConfig()).rejects.toThrow("Import failed");
    expect(await mockPrisma.predefined_agents.count()).toBe(0);
    expect(await mockPrisma.predefined_agent_skills.count()).toBe(0);
    expect(await mockPrisma.agent_skill_revisions.count()).toBe(0);
    expect(await mockPrisma.system_settings.count()).toBe(0);
  });
});
