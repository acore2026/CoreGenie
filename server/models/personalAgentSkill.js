const prisma = require("../utils/prisma");
const {
  parseSkillMarkdown,
  packageForEditor,
  loadPackage,
  personalRevisionRoot,
  savePersonalRevision,
} = require("../agent-skills/package");

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function userId(value) {
  if (!Number.isSafeInteger(value) || value < 1)
    fail(401, "请登录个人账号后使用 Skill。");
  return value;
}
function skillId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1)
    fail(404, "Skill 不存在或无权访问。");
  return id;
}
const visibleTo = (uid) => ({ OR: [{ ownerId: uid }, { isShared: true }] });
const author = { select: { id: true, username: true } };

// Serialize sharing changes against subscriptions, including PostgreSQL.
async function transaction(action) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(action, {
        isolationLevel: "Serializable",
        timeout: 30000,
      });
    } catch (error) {
      if (error.code !== "P2034" || attempt >= 2) throw error;
    }
  }
}
async function accessible(id, uid, { enabled = false, db = prisma } = {}) {
  userId(uid);
  const row = await db.personal_agent_skills.findFirst({
    where: {
      id: skillId(id),
      ...(enabled
        ? {
            OR: [
              { ownerId: uid },
              { isShared: true, subscriptions: { some: { userId: uid } } },
            ],
          }
        : visibleTo(uid)),
    },
    include: { owner: author },
  });
  if (!row) fail(404, "Skill 不存在或无权访问。");
  return row;
}
async function owned(id, uid, db = prisma) {
  userId(uid);
  const row = await db.personal_agent_skills.findFirst({
    where: { id: skillId(id), ownerId: uid },
  });
  if (!row) fail(404, "Skill 不存在或无权修改。");
  return row;
}
async function hydrate(
  row,
  { editor = false, revision = row.activeRevision } = {}
) {
  const root = personalRevisionRoot(row.ownerId, row.id, revision);
  const options = { expectedSha256: revision };
  const pkg = await (editor
    ? packageForEditor(root, options)
    : loadPackage(root, options));
  return {
    ...row,
    ...pkg,
    scope: "personal",
    revision: pkg.sha256,
    skillMd: pkg.source,
    instructions: pkg.body,
  };
}
const PersonalAgentSkill = {
  async list(uid, view = "mine") {
    userId(uid);
    const where =
      view === "mine"
        ? { ownerId: uid }
        : view === "enabled"
          ? { isShared: true, subscriptions: { some: { userId: uid } } }
          : { isShared: true, ownerId: { not: uid } };
    const rows = await prisma.personal_agent_skills.findMany({
      where: { ...where, activeRevision: { not: "" } },
      include: {
        owner: author,
        subscriptions: { where: { userId: uid }, select: { userId: true } },
      },
      orderBy: [{ lastUpdatedAt: "desc" }, { id: "desc" }],
    });
    return rows.map(({ subscriptions, ...row }) => ({
      ...row,
      scope: "personal",
      revision: row.activeRevision,
      isOwner: row.ownerId === uid,
      enabled: row.ownerId === uid || subscriptions.length > 0,
    }));
  },
  async get(id, uid) {
    const row = await accessible(id, uid);
    const subscription = await prisma.personal_skill_subscriptions.findUnique({
      where: { userId_skillId: { userId: uid, skillId: row.id } },
    });
    return {
      ...(await hydrate(row, { editor: true })),
      isOwner: row.ownerId === uid,
      enabled: row.ownerId === uid || !!subscription,
    };
  },
  async save(uid, id, input) {
    userId(uid);
    const previous = id == null ? null : await owned(id, uid);
    if (previous && input.revision !== previous.activeRevision)
      fail(409, "Skill 已被更新，请重新打开后再编辑。");
    if (input.isShared !== undefined && typeof input.isShared !== "boolean")
      fail(400, "共享开关必须为布尔值。");
    const parsed = parseSkillMarkdown(input.skillMd);
    if (!parsed.valid) fail(400, parsed.errors.join(" "));
    try {
      if (!previous) {
        // Keep new rows invisible until their immutable package exists. A
        // failed write or process exit rolls back the reserved ID/name.
        const createdId = await transaction(async (db) => {
          const row = await db.personal_agent_skills.create({
            data: {
              ownerId: uid,
              name: parsed.manifest.name,
              description: parsed.manifest.description,
              activeRevision: "",
              isShared: input.isShared ?? true,
            },
          });
          const pkg = await savePersonalRevision(uid, row.id, input);
          await db.personal_agent_skills.update({
            where: { id: row.id },
            data: {
              name: pkg.manifest.name,
              description: pkg.manifest.description,
              activeRevision: pkg.sha256,
            },
          });
          return row.id;
        });
        return await this.get(createdId, uid);
      }
      const baseRoot = personalRevisionRoot(
        uid,
        previous.id,
        previous.activeRevision
      );
      const pkg = await savePersonalRevision(uid, previous.id, input, baseRoot);
      await transaction(async (db) => {
        const updated = await db.personal_agent_skills.updateMany({
          where: {
            id: previous.id,
            ownerId: uid,
            activeRevision: previous.activeRevision,
          },
          data: {
            name: pkg.manifest.name,
            description: pkg.manifest.description,
            activeRevision: pkg.sha256,
            lastUpdatedAt: new Date(),
            ...(input.isShared !== undefined
              ? { isShared: input.isShared }
              : {}),
          },
        });
        if (updated.count !== 1)
          fail(409, "Skill 已被更新，请重新打开后再编辑。");
        if (input.isShared === false)
          await db.personal_skill_subscriptions.deleteMany({
            where: { skillId: previous.id },
          });
      });
      return await this.get(previous.id, uid);
    } catch (error) {
      if (error.code === "P2002")
        fail(409, "你已创建过同名 Skill，请使用其他名称。");
      throw error;
    }
  },
  async share(id, uid, isShared) {
    userId(uid);
    if (typeof isShared !== "boolean") fail(400, "共享开关必须为布尔值。");
    await transaction(async (db) => {
      const row = await owned(id, uid, db);
      await db.personal_agent_skills.update({
        where: { id: row.id },
        data: { isShared, lastUpdatedAt: new Date() },
      });
      if (!isShared)
        await db.personal_skill_subscriptions.deleteMany({
          where: { skillId: row.id },
        });
    });
  },
  async enable(id, uid, enabled) {
    userId(uid);
    if (typeof enabled !== "boolean") fail(400, "启用开关必须为布尔值。");
    const sid = skillId(id);
    await transaction(async (db) => {
      if (!enabled) {
        await db.personal_skill_subscriptions.deleteMany({
          where: { skillId: sid, userId: uid },
        });
        return;
      }
      const row = await accessible(sid, uid, { db });
      if (row.ownerId === uid) return;
      await db.personal_skill_subscriptions.upsert({
        where: { userId_skillId: { userId: uid, skillId: sid } },
        create: { userId: uid, skillId: sid },
        update: {},
      });
    });
  },
  async remove(id, uid) {
    const row = await owned(id, uid);
    await prisma.personal_agent_skills.delete({ where: { id: row.id } });
    // Immutable files remain for audit; deleted rows cannot be resolved or reused.
  },
  async available(uid) {
    if (!Number.isSafeInteger(uid) || uid < 1) return [];
    const rows = await prisma.personal_agent_skills.findMany({
      where: {
        activeRevision: { not: "" },
        OR: [
          { ownerId: uid },
          { isShared: true, subscriptions: { some: { userId: uid } } },
        ],
      },
      include: { owner: author },
      orderBy: { id: "asc" },
    });
    return Promise.all(rows.map((row) => hydrate(row)));
  },
  async resolve(id, uid, revision) {
    try {
      const row = await accessible(id, uid, { enabled: true });
      return await hydrate(row, { revision: revision || row.activeRevision });
    } catch (error) {
      if (error.status === 404 || error.status === 401) return null;
      throw error;
    }
  },
};
module.exports = { PersonalAgentSkill };
