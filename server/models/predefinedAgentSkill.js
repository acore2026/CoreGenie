const path = require("path");
const slugify = require("slugify");
const { v4: uuidv4 } = require("uuid");
const prisma = require("../utils/prisma");
const { safeJsonParse } = require("../utils/http");
const {
  SKILL_NAME_PATTERN,
  globalRevisionRoot,
  globalSkillsRoot,
  loadPackage,
  packageForEditor,
  parseSkillMarkdown,
  saveGlobalRevision,
  skillMarkdown,
  workspaceSkillNameExists,
} = require("../agent-skills/package");

function relativePackagePath(skillId, sha256) {
  return path.join(String(skillId), "revisions", sha256);
}

function normalizedLegacyName(value, id) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (SKILL_NAME_PATTERN.test(raw) && raw.length <= 64) return raw;
  const generated = slugify(raw, {
    lower: true,
    strict: true,
    trim: true,
  })
    .replace(/-+/g, "-")
    .slice(0, 54)
    .replace(/-$/, "");
  return `${generated || "legacy-skill"}-${id}`;
}

async function revisionRecord(skillId, sha256) {
  return prisma.agent_skill_revisions.findUnique({
    where: { skillId_sha256: { skillId: Number(skillId), sha256 } },
  });
}

async function createRevisionRecord(skillId, pkg, createdBy = null) {
  return prisma.agent_skill_revisions.upsert({
    where: {
      skillId_sha256: { skillId: Number(skillId), sha256: pkg.sha256 },
    },
    update: {},
    create: {
      id: uuidv4(),
      skillId: Number(skillId),
      sha256: pkg.sha256,
      manifest: JSON.stringify({
        ...pkg.manifest,
        ...(pkg.provenance ? { _source: pkg.provenance } : {}),
      }),
      fileManifest: JSON.stringify(pkg.files),
      packagePath: relativePackagePath(skillId, pkg.sha256),
      createdBy: createdBy ? Number(createdBy) : null,
    },
  });
}

async function ensurePackaged(record) {
  if (!record) return null;
  if (record.activeRevision) {
    const revision = await revisionRecord(record.id, record.activeRevision);
    if (revision) return record;
  }

  const name = normalizedLegacyName(record.name, record.id);
  const description =
    String(record.description || "").trim() ||
    `Reusable Agent skill migrated from ${record.name || `skill ${record.id}`}.`;
  const markdown = skillMarkdown({
    name,
    description,
    body: record.instructions,
    manifest: {
      metadata: { "legacy-display-name": String(record.name || name) },
    },
  });
  const pkg = await saveGlobalRevision(record.id, { skillMd: markdown });
  await createRevisionRecord(record.id, pkg);
  return prisma.predefined_agent_skills.update({
    where: { id: record.id },
    data: {
      name,
      description,
      instructions: pkg.body,
      activeRevision: pkg.sha256,
      lastUpdatedAt: new Date(),
    },
  });
}

async function hydrate(record, { editor = false } = {}) {
  const packaged = await ensurePackaged(record);
  if (!packaged?.activeRevision) return null;
  const root = globalRevisionRoot(packaged.id, packaged.activeRevision);
  const pkg = editor ? await packageForEditor(root) : await loadPackage(root);
  return {
    ...packaged,
    scope: "global",
    revision: pkg.sha256,
    skillMd: pkg.source,
    manifest: pkg.manifest,
    instructions: pkg.body,
    files: pkg.files,
    warnings: pkg.warnings,
    errors: pkg.errors,
    valid: pkg.valid,
    root,
  };
}

const PredefinedAgentSkill = {
  all: async function ({ editor = false, includeArchived = false } = {}) {
    try {
      const records = await prisma.predefined_agent_skills.findMany({
        where: includeArchived ? undefined : { archived: false },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      return (
        await Promise.all(records.map((item) => hydrate(item, { editor })))
      ).filter(Boolean);
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  get: async function (id, { editor = false, includeArchived = false } = {}) {
    try {
      const record = await prisma.predefined_agent_skills.findFirst({
        where: {
          id: Number(id),
          ...(includeArchived ? {} : { archived: false }),
        },
      });
      return hydrate(record, { editor });
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  whereIds: async function (ids = [], options = {}) {
    const normalized = [...new Set(ids.map(Number).filter(Number.isInteger))];
    if (!normalized.length) return [];
    try {
      const records = await prisma.predefined_agent_skills.findMany({
        where: { id: { in: normalized }, archived: false },
      });
      const values = await Promise.all(
        normalized.map((id) =>
          hydrate(
            records.find((skill) => skill.id === id),
            options
          )
        )
      );
      return values.filter(Boolean);
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  createPackage: async function (input, createdBy = null) {
    let record;
    try {
      const parsed = parseSkillMarkdown(input.skillMd);
      if (!parsed.valid) return { skill: null, error: parsed.errors.join(" ") };
      if (await workspaceSkillNameExists(parsed.manifest.name))
        return {
          skill: null,
          error: "A workspace skill with this name already exists.",
        };
      const existing = await prisma.predefined_agent_skills.findFirst({
        where: { name: parsed.manifest.name, archived: false },
      });
      if (existing)
        return {
          skill: null,
          error: "A global skill with this name already exists.",
        };
      record = await prisma.predefined_agent_skills.create({
        data: {
          name: parsed.manifest.name,
          description: parsed.manifest.description,
          instructions: parsed.body,
        },
      });
      const pkg = await saveGlobalRevision(record.id, input);
      pkg.provenance = input.provenance || null;
      await createRevisionRecord(record.id, pkg, createdBy);
      const updated = await prisma.predefined_agent_skills.update({
        where: { id: record.id },
        data: { activeRevision: pkg.sha256 },
      });
      return { skill: await hydrate(updated, { editor: true }), error: null };
    } catch (error) {
      if (record)
        await prisma.predefined_agent_skills
          .delete({ where: { id: record.id } })
          .catch(() => null);
      return { skill: null, error: error.message };
    }
  },

  updatePackage: async function (id, input, createdBy = null) {
    try {
      const current = await this.get(id);
      if (!current) return { skill: null, error: "Skill not found." };
      const parsed = parseSkillMarkdown(input.skillMd);
      if (!parsed.valid) return { skill: null, error: parsed.errors.join(" ") };
      if (
        parsed.manifest.name !== current.name &&
        (await workspaceSkillNameExists(parsed.manifest.name))
      )
        return {
          skill: null,
          error: "A workspace skill with this name already exists.",
        };
      const collision = await prisma.predefined_agent_skills.findFirst({
        where: {
          name: parsed.manifest.name,
          archived: false,
          NOT: { id: Number(id) },
        },
      });
      if (collision)
        return {
          skill: null,
          error: "A global skill with this name already exists.",
        };
      const pkg = await saveGlobalRevision(id, input, current.root);
      pkg.provenance = input.provenance || null;
      await createRevisionRecord(id, pkg, createdBy);
      const updated = await prisma.predefined_agent_skills.update({
        where: { id: Number(id) },
        data: {
          name: parsed.manifest.name,
          description: parsed.manifest.description,
          instructions: parsed.body,
          activeRevision: pkg.sha256,
          lastUpdatedAt: new Date(),
        },
      });
      return { skill: await hydrate(updated, { editor: true }), error: null };
    } catch (error) {
      return { skill: null, error: error.message };
    }
  },

  create: async function ({ name, description = "", instructions }) {
    const markdown = skillMarkdown({ name, description, body: instructions });
    return (await this.createPackage({ skillMd: markdown })).skill;
  },

  update: async function (id, data = {}) {
    const current = await this.get(id, { editor: true });
    if (!current) return null;
    const markdown = skillMarkdown({
      name: data.name || current.name,
      description: data.description || current.description,
      body: data.instructions ?? current.instructions,
      manifest: current.manifest,
    });
    return (await this.updatePackage(id, { skillMd: markdown })).skill;
  },

  delete: async function (id) {
    try {
      await prisma.predefined_agent_skills.update({
        where: { id: Number(id) },
        data: { archived: true, lastUpdatedAt: new Date() },
      });
      return true;
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  activeRoot: async function (id) {
    const skill = await this.get(id);
    return skill?.root || null;
  },

  revisions: async function (id) {
    try {
      const records = await prisma.agent_skill_revisions.findMany({
        where: { skillId: Number(id) },
        orderBy: { createdAt: "desc" },
      });
      return records.map((record) => ({
        ...record,
        manifest: safeJsonParse(record.manifest, {}),
        fileManifest: safeJsonParse(record.fileManifest, []),
        activeRoot: path.join(globalSkillsRoot(), record.packagePath),
      }));
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },
};

module.exports = { PredefinedAgentSkill, normalizedLegacyName };
