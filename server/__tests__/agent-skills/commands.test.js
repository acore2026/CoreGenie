const { createPgliteTestDb } = require("../helpers/pgliteTestDb");
const {
  seedBuiltinCommands,
  COMMAND_SEED_SETTING,
} = require("../../agent-skills/commands");

describe("bundled command initialization", () => {
  let testDb;
  let prisma;

  beforeAll(async () => {
    testDb = await createPgliteTestDb();
    prisma = testDb.prisma;
  }, 30000);

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  afterAll(async () => {
    await testDb?.close();
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
