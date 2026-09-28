/* eslint-env jest, node */
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
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
      'CREATE TABLE predefined_agents (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, iconFilename TEXT, description TEXT NOT NULL DEFAULT "", welcomeMessage TEXT, examplePrompts TEXT NOT NULL DEFAULT "[]", tools TEXT, skillIds TEXT NOT NULL DEFAULT "[]", systemPrompt TEXT NOT NULL, runtimeKey TEXT NOT NULL DEFAULT "governed-agent", runtimeConfig TEXT NOT NULL DEFAULT "{}", isBuiltinDefault BOOLEAN NOT NULL DEFAULT false, enabled BOOLEAN NOT NULL DEFAULT true, showInRoster BOOLEAN NOT NULL DEFAULT true, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, lastUpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE predefined_agent_skills (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT "", instructions TEXT NOT NULL, activeRevision TEXT, archived BOOLEAN NOT NULL DEFAULT false, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, lastUpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE agent_skill_revisions (id TEXT PRIMARY KEY, skillId INTEGER NOT NULL, sha256 TEXT NOT NULL, manifest TEXT NOT NULL, fileManifest TEXT NOT NULL DEFAULT "[]", packagePath TEXT NOT NULL, createdBy INTEGER, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(skillId, sha256))',
    ])
      await mockPrisma.$executeRawUnsafe(sql);
    await mockPrisma.$executeRawUnsafe(
      "ALTER TABLE predefined_agents ADD COLUMN wizard TEXT"
    );
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
    expect(SEED_SETTING).toBe("agent_config_seed_v13");
    await seedRepositoryConfig();
    expect(await mockPrisma.predefined_agents.count()).toBe(10);
    expect(await mockPrisma.predefined_agent_skills.count()).toBe(9);
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
    expect(experimental.runtimeKey).toBe("default-react");
    expect(JSON.parse(experimental.tools)).not.toContain("agent.call");
    expect(JSON.parse(experimental.skillIds)).toHaveLength(2);
    const child = await mockPrisma.predefined_agents.findFirst({
      where: { name: "3GPP 提案前后分析助手" },
    });
    expect(child).toMatchObject({ enabled: true, showInRoster: false, tools: null });
    const evolution = await mockPrisma.predefined_agent_skills.findFirst({
      where: { name: "3gpp-proposal-evolution" },
    });
    const general = await mockPrisma.predefined_agents.findFirst({
      where: { name: "3GPP 通用助手" },
    });
    expect(JSON.parse(child.skillIds)).toContain(evolution.id);
    expect(JSON.parse(general.skillIds)).toContain(evolution.id);
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
    expect(await mockPrisma.predefined_agents.count()).toBe(10);
    expect(await mockPrisma.predefined_agent_skills.count()).toBe(9);
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
    expect(await mockPrisma.agent_skill_revisions.count()).toBe(9);
  });

  it("reads cache-bearing historical revisions without changing pinned identities or accepting tampering", async () => {
    await seedRepositoryConfig();
    const {
      PredefinedAgentSkill,
    } = require("../../models/predefinedAgentSkill");
    const { globalRevisionRoot } = require("../../agent-skills/package");
    const record = await mockPrisma.predefined_agent_skills.findFirst({
      where: { name: "3gpp-review" },
    });
    const current = await PredefinedAgentSkill.get(record.id);
    const cachePath = "scripts/__pycache__/3gpp_tdocs.cpython-310.pyc";
    const cache = Buffer.from("historical interpreter bytes");
    const manifest = [
      ...current.files,
      {
        path: cachePath,
        size: cache.length,
        text: false,
        sha256: crypto.createHash("sha256").update(cache).digest("hex"),
      },
    ].sort((a, b) => a.path.localeCompare(b.path));
    const hasher = crypto.createHash("sha256");
    for (const file of manifest)
      hasher.update(`${file.path}\0${file.sha256}\0`);
    const legacyHash = hasher.digest("hex");
    const legacyRoot = globalRevisionRoot(record.id, legacyHash);
    await fs.cp(current.root, legacyRoot, { recursive: true });
    await fs.mkdir(path.dirname(path.join(legacyRoot, cachePath)), {
      recursive: true,
    });
    await fs.writeFile(path.join(legacyRoot, cachePath), cache);
    await mockPrisma.agent_skill_revisions.create({
      data: {
        id: crypto.randomUUID(),
        skillId: record.id,
        sha256: legacyHash,
        manifest: JSON.stringify(current.manifest),
        fileManifest: JSON.stringify(manifest),
        packagePath: `${record.id}/revisions/${legacyHash}`,
      },
    });
    await mockPrisma.predefined_agent_skills.update({
      where: { id: record.id },
      data: { activeRevision: legacyHash },
    });
    for (const editor of [false, true]) {
      const loaded = await PredefinedAgentSkill.get(record.id, { editor });
      expect(loaded.revision).toBe(legacyHash);
      expect(
        loaded.files.some((file) => file.path.includes("__pycache__"))
      ).toBe(false);
    }
    expect(
      (await PredefinedAgentSkill.getRevision(record.id, legacyHash)).revision
    ).toBe(legacyHash);
    const disk = await new ConfigFiles(CONFIG_ROOT).list();
    const database = await new ConfigDatabase(mockPrisma).list(
      { entries: {}, keys: {} },
      disk
    );
    expect(hash(database["skills/3gpp-review"].value)).toBe(
      hash(disk["skills/3gpp-review"].value)
    );
    await fs.writeFile(path.join(legacyRoot, cachePath), "changed cache");
    await expect(
      PredefinedAgentSkill.getRevision(record.id, legacyHash)
    ).rejects.toThrow("modified");
    await fs.writeFile(path.join(legacyRoot, cachePath), cache);
    await fs.appendFile(
      path.join(legacyRoot, "SKILL.md"),
      "\nchanged instructions\n"
    );
    await expect(
      PredefinedAgentSkill.getRevision(record.id, legacyHash)
    ).rejects.toThrow("modified");
  });

  it.each(["agent_config_seed_v1", "agent_config_seed_v2"])(
    "upgrades %s and binds every shared Skill dependency",
    async (previousVersion) => {
      await mockPrisma.system_settings.create({
        data: { label: previousVersion, value: "complete" },
      });
      await seedRepositoryConfig();
      const definitions = await new ConfigFiles(CONFIG_ROOT).list();
      for (const key of [
        "3gpp-feature-matrix",
        "3gpp-position-evolution",
        "3gpp-review-experimental",
        "3gpp-markdown",
        "3gpp-general",
      ]) {
        const definition = definitions[`agents/${key}`].value;
        const agent = await mockPrisma.predefined_agents.findFirst({
          where: { name: definition.name },
        });
        const skills = await mockPrisma.predefined_agent_skills.findMany({
          where: { id: { in: JSON.parse(agent.skillIds) } },
        });
        expect(skills.map((skill) => skill.name)).toContain("3gpp-review");
      }
      const split = definitions["agents/3gpp-split-docx"].value;
      expect(split.runtimeConfig.attachmentMode).toBe("workspace_file");
    }
  );

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
