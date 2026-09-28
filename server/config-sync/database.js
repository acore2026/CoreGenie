const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { hash } = require("./engine");
const { skillSource } = require("./files");
const {
  parseSkillMarkdown,
  saveGlobalRevision,
} = require("../agent-skills/package");

const AGENT_FIELDS = [
  "name",
  "description",
  "welcomeMessage",
  "examplePrompts",
  "wizard",
  "quickTasks",
  "tools",
  "skills",
  "systemPrompt",
  "runtimeKey",
  "runtimeConfig",
  "enabled",
  "showInRoster",
];

function agentValue(value) {
  if (
    value.quickTasks != null &&
    (!Array.isArray(value.quickTasks) ||
      value.quickTasks.length > 12 ||
      new Set(value.quickTasks).size !== value.quickTasks.length)
  )
    throw new Error("最多绑定 12 个不重复的快捷任务。");
  const wizard = require("../utils/agentWizard").validateWizard(value.wizard);
  for (const key of Object.keys(value))
    if (!AGENT_FIELDS.includes(key)) throw new Error(`未知 Agent 配置：${key}`);
  for (const [key, limit, required] of [
    ["name", 80, true],
    ["systemPrompt", 40000, true],
    ["description", 500, false],
    ["welcomeMessage", 300, false],
  ]) {
    if (
      (required && (typeof value[key] !== "string" || !value[key].trim())) ||
      (value[key] != null &&
        (typeof value[key] !== "string" || value[key].length > limit))
    )
      throw new Error(`无效的 ${key}，最多 ${limit} 字符。`);
  }
  for (const key of ["tools", "skills", "quickTasks"])
    if (
      value[key] != null &&
      (!Array.isArray(value[key]) ||
        value[key].some((item) => typeof item !== "string" || !item.trim()))
    )
      throw new Error(`${key} 必须是字符串列表。`);
  if (value.enabled != null && typeof value.enabled !== "boolean")
    throw new Error("enabled 必须是 true 或 false。");
  if (value.showInRoster != null && typeof value.showInRoster !== "boolean")
    throw new Error("showInRoster 必须是 true 或 false。");
  if (
    value.runtimeConfig != null &&
    (typeof value.runtimeConfig !== "object" ||
      Array.isArray(value.runtimeConfig))
  )
    throw new Error("runtimeConfig 必须是对象。");
  if (
    value.examplePrompts != null &&
    (!Array.isArray(value.examplePrompts) ||
      value.examplePrompts.length > 6 ||
      value.examplePrompts.some(
        (item) =>
          typeof item !== "string" && (!item || typeof item.prompt !== "string")
      ))
  )
    throw new Error("examplePrompts 必须包含最多 6 个有效示例。");
  const runtimeKey = value.runtimeKey || "governed-agent";
  require("../agent-system/runtimes/registry").normalizeRuntimeConfig(
    runtimeKey,
    value.runtimeConfig || {}
  );
  return {
    name: value.name,
    description: value.description || "",
    welcomeMessage: value.welcomeMessage || null,
    examplePrompts: value.examplePrompts || [],
    ...(wizard ? { wizard } : {}),
    tools: value.tools ?? null,
    skills: value.skills || [],
    ...(!wizard || Object.prototype.hasOwnProperty.call(value, "quickTasks")
      ? { quickTasks: value.quickTasks || [] }
      : {}),
    systemPrompt: value.systemPrompt,
    runtimeKey,
    runtimeConfig: value.runtimeConfig || {},
    enabled: value.enabled !== false,
    ...(value.showInRoster === false ? { showInRoster: false } : {}),
  };
}

function quickTaskValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("快捷任务必须是对象。");
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value.id || ""))
    throw new Error("快捷任务标识须使用小写字母、数字和短横线。");
  if (value.archived != null && typeof value.archived !== "boolean")
    throw new Error("archived 必须是布尔值。");
  const { archived = false, ...definition } = value;
  require("../utils/agentWizard").validateWizard([definition]);
  return { ...definition, archived };
}

class ConfigDatabase {
  constructor(prisma, saveState) {
    this.prisma = prisma;
    this.saveState = saveState;
  }

  async list(state, disk = {}) {
    const prisma = this.prisma;
    await prisma.$transaction((client) =>
      require("../models/predefinedQuickTask").migrateLegacy(client)
    );
    const agents = await prisma.predefined_agents.findMany();
    const skills = await prisma.predefined_agent_skills.findMany();
    const quickTasks = await prisma.predefined_quick_tasks.findMany();
    const output = {};
    const keyFor = (kind, record) => {
      const found = Object.entries(state.entries).find(
        ([key, entry]) => key.startsWith(`${kind}/`) && entry.id === record.id
      );
      if (found) return found[0];
      const identity = `${kind}:${record.id}`;
      if (!state.keys[identity] && kind === "agents") {
        const candidates = Object.entries(disk).filter(
          ([key, file]) =>
            key.startsWith("agents/") &&
            file.value?.name === record.name &&
            !state.entries[key]
        );
        if (
          candidates.length > 1 ||
          (candidates.length &&
            agents.filter((agent) => agent.name === record.name).length > 1)
        )
          throw new Error(`首次同步时 Agent 名称有歧义：${record.name}`);
        if (candidates.length === 1) state.keys[identity] = candidates[0][0];
      }
      if (!state.keys[identity])
        state.keys[identity] =
          kind === "skills"
            ? `skills/${record.name}`
            : kind === "quick-tasks"
              ? `quick-tasks/${record.key}`
              : `agents/agent-${randomUUID()}`;
      return state.keys[identity];
    };
    for (const record of skills) {
      const key = keyFor("skills", record);
      if (output[key]) throw new Error(`Skill 标识重复：${key}`);
      // Read directly; list methods that swallow DB/filesystem errors must not drive sync.
      const {
        PredefinedAgentSkill,
      } = require("../models/predefinedAgentSkill");
      const skill = record.activeRevision
        ? await PredefinedAgentSkill.getRevision(
            record.id,
            record.activeRevision
          )
        : await PredefinedAgentSkill.get(record.id, { includeArchived: true });
      if (!skill) throw new Error(`无法读取 Skill：${record.name}`);
      const files = {};
      for (const file of skill.files) {
        if (file.path === "SKILL.md") continue;
        files[file.path] = (
          await fs.readFile(path.join(skill.root, file.path))
        ).toString("base64");
      }
      output[key] = {
        id: record.id,
        value: {
          ...skillSource(skill.skillMd),
          archived: record.archived,
          files,
        },
      };
    }
    for (const record of quickTasks) {
      output[keyFor("quick-tasks", record)] = {
        id: record.id,
        value: quickTaskValue({
          ...JSON.parse(record.definition),
          id: record.key,
          archived: record.archived,
        }),
      };
    }
    for (const record of agents) {
      const key = keyFor("agents", record);
      const skillKeys = JSON.parse(record.skillIds).map((id) => {
        const skill = skills.find((item) => item.id === Number(id));
        if (!skill)
          throw new Error(`Agent ${record.name} 引用了不存在的 Skill：${id}`);
        return keyFor("skills", skill).slice(7);
      });
      const quickTaskKeys = JSON.parse(record.quickTaskIds || "[]").map(
        (id) => {
          const task = quickTasks.find((item) => item.id === Number(id));
          if (!task)
            throw new Error(
              `Agent ${record.name} 引用了不存在的快捷任务：${id}`
            );
          return keyFor("quick-tasks", task).slice(12);
        }
      );
      output[key] = {
        id: record.id,
        value: {
          name: record.name,
          description: record.description,
          welcomeMessage: record.welcomeMessage,
          examplePrompts: JSON.parse(record.examplePrompts),
          ...(record.wizard ? { wizard: JSON.parse(record.wizard) } : {}),
          tools: record.tools == null ? null : JSON.parse(record.tools),
          skills: skillKeys,
          quickTasks: quickTaskKeys,
          systemPrompt: record.systemPrompt,
          runtimeKey: record.runtimeKey,
          runtimeConfig: JSON.parse(record.runtimeConfig),
          enabled: record.enabled,
          ...(record.showInRoster === false ? { showInRoster: false } : {}),
        },
      };
    }
    const prompt = await prisma.system_settings.findUnique({
      where: { label: "global_system_prompt" },
    });
    if (prompt || !disk["global-prompt"])
      output["global-prompt"] = {
        id: null,
        value: (prompt?.value || "").trim(),
      };
    return output;
  }

  async put(key, value, id, state) {
    // Keep identity mapping and imported DB changes in the same transaction.
    // A crash must not create a second Agent on the next scan.
    return this.prisma.$transaction(
      async (prisma) => {
        const result = await this.apply(prisma, key, value, id, state);
        const next = {
          ...state,
          entries: {
            ...state.entries,
            [key]: { id: result, hash: hash(value) },
          },
        };
        await this.saveState(next, prisma);
        return result;
      },
      { timeout: 30000 }
    );
  }

  async apply(prisma, key, value, id, state) {
    if (key === "global-prompt") {
      await prisma.system_settings.upsert({
        where: { label: "global_system_prompt" },
        create: { label: "global_system_prompt", value },
        update: { value },
      });
      return null;
    }
    if (key.startsWith("agents/")) {
      const agent = agentValue(value);
      const skillIds = agent.skills.map((name) => {
        const entry = state.entries[`skills/${name}`];
        if (!entry?.id) throw new Error(`Skill 尚未同步：${name}`);
        return entry.id;
      });
      const quickTaskIds = (agent.quickTasks || []).map((name) => {
        const entry = state.entries[`quick-tasks/${name}`];
        if (!entry?.id) throw new Error(`快捷任务尚未同步：${name}`);
        return entry.id;
      });
      const bindings =
        await require("../models/predefinedQuickTask").prepareBindings(prisma, {
          ...(agent.wizard ? { wizard: agent.wizard } : {}),
          ...(!agent.wizard ||
          Object.prototype.hasOwnProperty.call(value, "quickTasks")
            ? { quickTaskIds }
            : {}),
        });
      const { skills: _skills, quickTasks: _quickTasks, ...data } = agent;
      Object.assign(data, {
        showInRoster: agent.showInRoster !== false,
        skillIds: JSON.stringify(skillIds),
        quickTaskIds: JSON.stringify(quickTaskIds),
        tools: agent.tools === null ? null : JSON.stringify(agent.tools),
        examplePrompts: JSON.stringify(agent.examplePrompts),
        wizard: null,
        ...bindings,
        runtimeConfig: JSON.stringify(agent.runtimeConfig),
        lastUpdatedAt: new Date(),
      });
      const result = id
        ? await prisma.predefined_agents.update({ where: { id }, data })
        : await prisma.predefined_agents.create({ data });
      return result.id;
    }
    if (key.startsWith("quick-tasks/")) {
      const task = quickTaskValue(value);
      if (key !== `quick-tasks/${task.id}`)
        throw new Error("文件名须与快捷任务 id 一致。");
      const collision = await prisma.predefined_quick_tasks.findFirst({
        where: { key: task.id, ...(id ? { NOT: { id } } : {}) },
      });
      if (collision) throw new Error(`快捷任务标识重复：${task.id}`);
      const { archived, ...definition } = task;
      const data = {
        key: task.id,
        title: task.title,
        description: task.description || "",
        definition: JSON.stringify(definition),
        archived,
        lastUpdatedAt: new Date(),
      };
      if (id) {
        const current = await prisma.predefined_quick_tasks.findUnique({
          where: { id },
        });
        if (current && current.key !== task.id)
          throw new Error("快捷任务标识不能修改。");
        await require("../models/predefinedQuickTask").validateTaskEdit(
          prisma,
          { id, ...data }
        );
      }
      const record = id
        ? await prisma.predefined_quick_tasks.update({ where: { id }, data })
        : await prisma.predefined_quick_tasks.create({ data });
      return record.id;
    }
    const parsed = parseSkillMarkdown(value.skillMd);
    if (!parsed.valid) throw new Error(parsed.errors.join(" "));
    const collision = await prisma.predefined_agent_skills.findFirst({
      where: { name: parsed.manifest.name, ...(id ? { NOT: { id } } : {}) },
    });
    if (collision) throw new Error(`Skill 名称重复：${parsed.manifest.name}`);
    if (
      await require("../agent-skills/package").workspaceSkillNameExists(
        parsed.manifest.name
      )
    )
      throw new Error("已有同名工作区 Skill。");
    const input = {
      skillMd: value.skillMd,
      files: Object.entries(value.files).map(([name, content]) => ({
        path: name,
        content,
        encoding: "base64",
      })),
    };
    if (!id) {
      const record = await prisma.predefined_agent_skills.create({
        data: {
          name: parsed.manifest.name,
          description: parsed.manifest.description,
          instructions: parsed.body,
        },
      });
      id = record.id;
    }
    {
      // Full replacement: resources removed from the repo must not survive from the old package.
      const pkg = await saveGlobalRevision(id, input);
      await prisma.agent_skill_revisions.upsert({
        where: { skillId_sha256: { skillId: id, sha256: pkg.sha256 } },
        update: {},
        create: {
          id: randomUUID(),
          skillId: id,
          sha256: pkg.sha256,
          manifest: JSON.stringify(pkg.manifest),
          fileManifest: JSON.stringify(pkg.files),
          packagePath: path.join(String(id), "revisions", pkg.sha256),
        },
      });
      await prisma.predefined_agent_skills.update({
        where: { id },
        data: {
          name: parsed.manifest.name,
          description: parsed.manifest.description,
          instructions: parsed.body,
          activeRevision: pkg.sha256,
          lastUpdatedAt: new Date(),
        },
      });
    }
    await prisma.predefined_agent_skills.update({
      where: { id },
      data: { archived: value.archived },
    });
    return id;
  }
}

module.exports = { ConfigDatabase, agentValue, quickTaskValue };
