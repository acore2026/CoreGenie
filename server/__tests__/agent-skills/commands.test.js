const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const {
  seedBuiltinCommands,
  COMMAND_SEED_SETTING,
} = require("../../agent-skills/commands");

describe("bundled command initialization", () => {
  let root, prisma;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "command-seed-"));
    prisma = new PrismaClient({
      datasources: { db: { url: "file:" + path.join(root, "test.db") } },
    });
    await prisma.$executeRawUnsafe(
      "CREATE TABLE system_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL UNIQUE, value TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, lastUpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)"
    );
    await prisma.$executeRawUnsafe(
      "CREATE TABLE slash_command_presets (id INTEGER PRIMARY KEY AUTOINCREMENT, command TEXT NOT NULL, prompt TEXT NOT NULL, description TEXT NOT NULL, uid INTEGER NOT NULL DEFAULT 0, userId INTEGER, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, lastUpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(uid,command))"
    );
  });
  afterEach(async () => {
    await prisma.$disconnect();
    await fs.rm(root, { recursive: true, force: true });
  });
  test("a new installation receives the canonical command once", async () => {
    await seedBuiltinCommands(prisma);
    await seedBuiltinCommands(prisma);
    const rows = await prisma.slash_command_presets.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(
      require("../../../agent-config/commands/workspace-clean.json")
    );
    expect(
      (
        await prisma.system_settings.findUnique({
          where: { label: COMMAND_SEED_SETTING },
        })
      ).value
    ).toBe("complete");
  });
  test("an upgrade preserves the installation's customized command", async () => {
    await prisma.slash_command_presets.create({
      data: {
        uid: 0,
        command: "/workspace-clean",
        prompt: "custom prompt",
        description: "custom description",
      },
    });
    await seedBuiltinCommands(prisma);
    expect((await prisma.slash_command_presets.findMany())[0].prompt).toBe(
      "custom prompt"
    );
  });
  test("a deliberately deleted preset is not recreated on restart", async () => {
    await seedBuiltinCommands(prisma);
    await prisma.slash_command_presets.deleteMany();
    await seedBuiltinCommands(prisma);
    expect(await prisma.slash_command_presets.count()).toBe(0);
  });
});
