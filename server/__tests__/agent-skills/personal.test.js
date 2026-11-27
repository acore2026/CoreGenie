const fs = require("fs");
const os = require("os");
const path = require("path");
const { createPgliteTestDb } = require("../helpers/pgliteTestDb");
const temporary = fs.mkdtempSync(
  path.join(os.tmpdir(), "personal-skills-test-")
);
const oldStorage = process.env.STORAGE_DIR;
process.env.STORAGE_DIR = path.join(temporary, "storage");
let testDb;
let mockPrisma;
jest.mock(
  "../../utils/prisma",
  () => new Proxy({}, { get: (_target, key) => mockPrisma[key] })
);
jest.mock("../../models/predefinedAgentSkill", () => ({
  PredefinedAgentSkill: {
    whereIds: jest.fn(async () => []),
    all: jest.fn(async () => []),
  },
}));
const {
  PersonalAgentSkill: skills,
} = require("../../models/personalAgentSkill");
const { PredefinedAgentSkill } = require("../../models/predefinedAgentSkill");
const {
  availableSkills,
  resolveAvailableSkill,
  resolveActivatedSkillSnapshot,
} = require("../../agent-skills/registry");
const {
  activatedSkillSnapshot,
  restoreActivatedSkills,
} = require("../../agent-system/activatedSkills");
const { personalSkillEndpoints } = require("../../endpoints/personalSkills");

const markdown = (name = "meeting-review", body = "先阅读资料，再输出结论。") =>
  `---\nname: ${name}\ndescription: 分析会议资料并列出行动项。\n---\n\n${body}\n`;
const input = (options = {}) => ({
  skillMd: markdown(),
  files: [
    { path: "scripts/check.py", content: "print('old')", encoding: "utf8" },
  ],
  ...options,
});
const routes = new Map();
personalSkillEndpoints(
  Object.fromEntries(
    ["get", "post", "put", "patch", "delete"].map((method) => [
      method,
      (url, middleware, handler) =>
        routes.set(method + " " + url, { middleware, handler }),
    ])
  )
);
async function api(
  method,
  url,
  uid,
  { body = {}, params = {}, query = {} } = {}
) {
  const res = {
    locals: { user: uid ? { id: uid, role: "default" } : null },
    code: 200,
    data: null,
  };
  res.status = (value) => {
    res.code = value;
    return res;
  };
  res.json = (value) => {
    res.data = value;
    return res;
  };
  await routes.get(method + " " + url).handler({ body, params, query }, res);
  return res;
}

beforeAll(async () => {
  testDb = await createPgliteTestDb();
  mockPrisma = testDb.prisma;
  await Promise.all(
    [
      { id: 1, username: "作者", password: "pw" },
      { id: 2, username: "读者", password: "pw" },
      { id: 3, username: "其他用户", password: "pw" },
    ].map((data) => mockPrisma.users.create({ data }))
  );
}, 30000);
beforeEach(async () => {
  await mockPrisma.personal_skill_subscriptions.deleteMany();
  await mockPrisma.personal_agent_skills.deleteMany();
  PredefinedAgentSkill.whereIds.mockResolvedValue([]);
  PredefinedAgentSkill.all.mockResolvedValue([]);
});
afterAll(async () => {
  await testDb?.close();
  if (oldStorage === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = oldStorage;
  fs.rmSync(temporary, { recursive: true, force: true });
});

test("new personal skills are shared by default, owned and available only to their author until enabled", async () => {
  const skill = await skills.save(1, null, input());
  expect(skill).toMatchObject({
    isShared: true,
    isOwner: true,
    enabled: true,
    owner: { id: 1 },
  });
  expect(await skills.list(2, "shared")).toHaveLength(1);
  expect(
    (await skills.get(skill.id, 2)).files.find((f) => f.path.endsWith(".py"))
      .content
  ).toContain("old");
  expect(await skills.available(1)).toHaveLength(1);
  expect(await skills.available(2)).toEqual([]);
});
test("private creation never exposes content or permits someone else to enable it", async () => {
  const skill = await skills.save(1, null, input({ isShared: false }));
  expect(await skills.list(2, "shared")).toEqual([]);
  await expect(skills.get(skill.id, 2)).rejects.toMatchObject({ status: 404 });
  await expect(skills.enable(skill.id, 2, true)).rejects.toMatchObject({
    status: 404,
  });
  expect(await skills.resolve(skill.id, 2, skill.revision)).toBeNull();
});
test("subscriptions belong to the authenticated reader and disabling removes runtime availability", async () => {
  const skill = await skills.save(1, null, input());
  await skills.enable(skill.id, 2, true);
  await skills.enable(skill.id, 2, true);
  expect(await skills.available(2)).toHaveLength(1);
  expect(await skills.available(3)).toEqual([]);
  expect(await skills.list(2, "enabled")).toHaveLength(1);
  await skills.enable(skill.id, 2, false);
  expect(await skills.available(2)).toEqual([]);
});
test("sharing off revokes reads, subscriptions and pinned runtime resolution; sharing on does not silently re-enable", async () => {
  const skill = await skills.save(1, null, input());
  await skills.enable(skill.id, 2, true);
  const [runtime] = await availableSkills({}, null, { userId: 2 });
  const snapshot = activatedSkillSnapshot(runtime);
  await skills.share(skill.id, 1, false);
  expect(await skills.list(2, "shared")).toEqual([]);
  expect(await skills.list(2, "enabled")).toEqual([]);
  expect(await resolveActivatedSkillSnapshot(snapshot, null, 2)).toBeNull();
  await expect(
    restoreActivatedSkills([snapshot], null, new Map(), 2)
  ).rejects.toMatchObject({ code: "ACTIVATED_SKILL_REVISION_CHANGED" });
  expect(await skills.get(skill.id, 1)).toMatchObject({ isShared: false });
  await skills.share(skill.id, 1, true);
  expect(await skills.available(2)).toEqual([]);
});
test("non-owners cannot edit, share or delete a shared skill", async () => {
  const skill = await skills.save(1, null, input());
  await expect(
    skills.save(2, skill.id, input({ revision: skill.revision }))
  ).rejects.toMatchObject({ status: 404 });
  await expect(skills.share(skill.id, 2, false)).rejects.toMatchObject({
    status: 404,
  });
  await expect(skills.remove(skill.id, 2)).rejects.toMatchObject({
    status: 404,
  });
  expect((await skills.get(skill.id, 1)).revision).toBe(skill.revision);
});
test("editing requires the latest revision and preserves existing files", async () => {
  const skill = await skills.save(1, null, input());
  const changed = await skills.save(1, skill.id, {
    skillMd: markdown("meeting-review", "新的操作要求"),
    revision: skill.revision,
  });
  expect(changed.revision).not.toBe(skill.revision);
  expect(changed.files.find((f) => f.path.endsWith(".py")).content).toContain(
    "old"
  );
  await expect(
    skills.save(1, skill.id, input({ revision: skill.revision }))
  ).rejects.toMatchObject({ status: 409 });
});
test("activated personal revisions survive author updates and restore only for an authorized user", async () => {
  const skill = await skills.save(1, null, input());
  await skills.enable(skill.id, 2, true);
  const [runtime] = await availableSkills({}, null, { userId: 2 });
  const snapshot = activatedSkillSnapshot(runtime);
  await skills.save(
    1,
    skill.id,
    input({
      skillMd: markdown("meeting-review", "新版"),
      revision: skill.revision,
    })
  );
  const restored = new Map();
  await restoreActivatedSkills([snapshot], null, restored, 2);
  expect(restored.get(runtime.name).instructions).toContain("先阅读资料");
  expect(await resolveActivatedSkillSnapshot(snapshot, null, 3)).toBeNull();
  expect(
    (await availableSkills({}, null, { userId: 2 }))[0].instructions
  ).toContain("新版");
});
test("same-named authors have separate aliases, and a built-in name cannot be replaced", async () => {
  const one = await skills.save(1, null, input());
  const two = await skills.save(2, null, input());
  await skills.enable(one.id, 3, true);
  await skills.enable(two.id, 3, true);
  const builtin = {
    id: 99,
    name: "personal-" + one.id,
    valid: true,
    manifest: { name: "personal-" + one.id, description: "builtin" },
    revision: "global",
    instructions: "builtin",
  };
  PredefinedAgentSkill.whereIds.mockResolvedValue([builtin]);
  const catalog = await availableSkills({}, null, { userId: 3 });
  expect(new Set(catalog.map((s) => s.name)).size).toBe(3);
  expect(catalog[0].scope).toBe("global");
  const first = catalog.find((s) => s.scope === "personal" && s.id === one.id);
  expect((await resolveAvailableSkill({}, null, first.name, 3)).id).toBe(
    one.id
  );
  expect(
    (await resolveAvailableSkill({}, null, builtin.manifest.name, 3)).scope
  ).toBe("global");
});
test("deletion removes subscriptions and denies all future content or revision resolution", async () => {
  const skill = await skills.save(1, null, input());
  await skills.enable(skill.id, 2, true);
  await skills.remove(skill.id, 1);
  expect(await mockPrisma.personal_skill_subscriptions.count()).toBe(0);
  expect(await skills.resolve(skill.id, 2, skill.revision)).toBeNull();
  await expect(skills.get(skill.id, 1)).rejects.toMatchObject({ status: 404 });
});
test("invalid packages and path traversal leave no visible record or external file", async () => {
  await expect(
    skills.save(
      1,
      null,
      input({ files: [{ path: "../../escape.py", content: "bad" }] })
    )
  ).rejects.toThrow();
  expect(await skills.list(1)).toEqual([]);
  expect(fs.existsSync(path.join(temporary, "escape.py"))).toBe(false);
  expect(await mockPrisma.personal_agent_skills.count()).toBe(0);
});
test("sharing can be switched off in the editor and revokes subscribers atomically", async () => {
  const skill = await skills.save(1, null, input());
  await skills.enable(skill.id, 2, true);
  await skills.save(
    1,
    skill.id,
    input({ revision: skill.revision, isShared: false })
  );
  expect(await skills.available(2)).toEqual([]);
  expect(await mockPrisma.personal_skill_subscriptions.count()).toBe(0);
});
test("HTTP endpoints require a real account and ignore forged owner and subscriber identities", async () => {
  const anonymous = await api("get", "/personal-skills", null);
  expect(anonymous.code).toBe(401);
  const created = await api("post", "/personal-skills", 1, {
    body: input({ ownerId: 2, isShared: true }),
  });
  expect(created.data.skill.owner.id).toBe(1);
  const id = created.data.skill.id;
  const enabled = await api("put", "/personal-skills/:id/enabled", 2, {
    params: { id },
    body: { enabled: true, userId: 3 },
  });
  expect(enabled.code).toBe(200);
  expect(await skills.available(3)).toEqual([]);
  expect(await skills.available(2)).toHaveLength(1);
  expect(
    (
      await api("patch", "/personal-skills/:id/sharing", 2, {
        params: { id },
        body: { isShared: false, ownerId: 1 },
      })
    ).code
  ).toBe(404);
  expect((await api("get", "/personal-skills", 1)).data.template).toContain(
    "name:"
  );
});
test("boolean flags are strict and duplicate names are scoped to the owner", async () => {
  const one = await skills.save(1, null, input());
  await expect(skills.share(one.id, 1, "false")).rejects.toMatchObject({
    status: 400,
  });
  await expect(skills.enable(one.id, 2, "true")).rejects.toMatchObject({
    status: 400,
  });
  await expect(skills.save(1, null, input())).rejects.toMatchObject({
    status: 409,
  });
  expect((await skills.save(2, null, input())).owner.id).toBe(2);
});

test("sandbox execution carries the authorized author and denies revoked shared scripts", async () => {
  const skill = await skills.save(1, null, input());
  await skills.enable(skill.id, 2, true);
  const [runtime] = await availableSkills({}, null, { userId: 2 });
  const library = require("../../services/sandbox");
  const run = jest.spyOn(library, "run").mockResolvedValue({
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    timedOut: false,
    truncated: false,
  });
  const context = {
    user: { id: 2 },
    run: { id: "test-run", user_id: 2 },
    workspace: { id: 12 },
    activatedSkill: () => runtime,
    emit: jest.fn(),
  };
  try {
    const { python } = require("../../tools/sandbox");
    const args = {
      code: "print('ok')",
      timeout_seconds: 10,
      cwd: "skill://" + runtime.name,
    };
    expect((await python.execute(args, context)).ok).toBe(true);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        skill: expect.objectContaining({
          id: skill.id,
          ownerId: 1,
          scope: "personal",
          revision: skill.revision,
        }),
      })
    );
    await skills.share(skill.id, 1, false);
    expect((await python.execute(args, context)).code).toBe(
      "SKILL_NOT_AVAILABLE"
    );
    expect(run).toHaveBeenCalledTimes(1);
  } finally {
    run.mockRestore();
  }
});
