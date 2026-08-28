const fs = require("fs/promises");
const path = require("path");
const prisma = require("../utils/prisma");
const { PredefinedAgentSkill } = require("../models/predefinedAgentSkill");
const { PredefinedAgent } = require("../models/predefinedAgent");
const { seed3gppPositionEvolution } = require("./positionEvolutionSeed");

const SEED_SETTING = "agent_skill_seed_3gpp_review_v4";
const AGENT_NAME = "3GPP 提案分析助手（Skill）";
const SKILL_NAME = "3gpp-review";
const LEGACY_SKILL_NAMES = ["3gpp-tdocs"];
const AGENT_TOOLS = [
  "bash",
  "python",
  "filesystem.read",
  "filesystem.write",
  "filesystem.list",
  "filesystem.search",
  "web.fetch",
  "rag.search",
  "user.ask",
  "vision.inspect",
  "knowledge.publish",
];

const AGENT_PROMPT = `你是一名面向 3GPP/6G 标准研究的提案分析助手。

处理 TDoc、会议、KI、公司立场或 Solution/Variant 分析时，必须先激活 3gpp-review Skill，并完整遵循其证据、覆盖率、图表核验和报告流程。

核心要求：
- 不猜测会议目录、议程映射、TDoc 元数据或提案内容；
- 将每项实质结论关联到明确的 TDoc 编号；
- 区分提案方主张、编辑说明和已达成的 3GPP 共识；
- 对流程图使用视觉工具核验实体、箭头和消息顺序，无法辨认时明确标注不确定；
- 默认输出中文 Markdown 报告；
- 最终报告必须先通过 coverage 检查，再调用 knowledge.publish 自动发布到当前 Workspace 知识库；
- knowledge.publish 成功后，在最终回复中说明报告路径、覆盖率和入库结果。`;
let seedPromise = null;

async function seed3gppReview() {
  const completed = await prisma.system_settings.findUnique({
    where: { label: SEED_SETTING },
  });
  if (completed?.value === "complete") return;

  let skillRecord = null;
  for (const name of [SKILL_NAME, ...LEGACY_SKILL_NAMES]) {
    skillRecord = await prisma.predefined_agent_skills.findFirst({
      where: { name, archived: false },
    });
    if (skillRecord) break;
  }
  let skill = skillRecord
    ? await PredefinedAgentSkill.get(skillRecord.id)
    : null;
  const exampleRoot = path.join(__dirname, "examples", "3gpp-review");
  const [skillMd, script] = await Promise.all([
    fs.readFile(path.join(exampleRoot, "SKILL.md"), "utf8"),
    fs.readFile(path.join(exampleRoot, "scripts", "3gpp_tdocs.py"), "utf8"),
  ]);
  const packageInput = {
    skillMd,
    files: [
      {
        path: "scripts/3gpp_tdocs.py",
        content: script,
        encoding: "utf8",
      },
    ],
    provenance: {
      derivedFrom: "https://github.com/acore2026/3GPP-contributions",
      upstreamCommit: "22e33773f6394ffb4c4baa5abd7df29dec11fade",
      adaptedFor: "AnythingLLM Agent Skills runtime",
    },
  };
  if (!skill) {
    const created = await PredefinedAgentSkill.createPackage(packageInput);
    if (!created.skill)
      throw new Error(created.error || "Unable to seed skill.");
    skill = created.skill;
  } else {
    const updated = await PredefinedAgentSkill.updatePackage(
      skill.id,
      packageInput
    );
    if (!updated.skill)
      throw new Error(updated.error || "Unable to update the seeded skill.");
    skill = updated.skill;
  }

  let agent = (await PredefinedAgent.all()).find(
    (item) => item.name === AGENT_NAME
  );
  const agentData = {
    name: AGENT_NAME,
    description:
      "按 3GPP 会议和 KI 自动定位、下载、解析、比较 TDoc，并生成可追踪中文报告。",
    welcomeMessage:
      "请告诉我工作组、会议号、KI/议程项，或直接给出需要比较的 TDoc 编号。",
    examplePrompts: [
      "分析 SA2#175 KI#22 中 S2-2606085、S2-2606481、S2-2605964、S2-2605867、S2-2606356，并比较公司技术路线。",
      "查找 SA2#175 KI#22 中华为相关提案，总结 Solution/Variant、关键流程和未决问题。",
      "比较指定 3GPP 提案中的网络功能、接口、信息元素和信令流程，并输出中文报告。",
    ],
    tools: AGENT_TOOLS,
    skillIds: [skill.id],
    systemPrompt: AGENT_PROMPT,
    runtimeKey: "governed-agent",
    runtimeConfig: {
      visionModel: "qwen3.7-plus",
      requiredCompletionTools: ["knowledge.publish"],
    },
    enabled: true,
  };
  agent = agent
    ? await PredefinedAgent.update(agent.id, agentData)
    : await PredefinedAgent.create(agentData);
  if (!agent) throw new Error("Unable to seed the 3GPP review Agent.");

  // v1 briefly attached the skill to the installation-wide default Agent.
  // Keep the specialized workflow isolated while preserving the chosen default.
  const defaultId = await PredefinedAgent.defaultId();
  const defaultAgent = defaultId ? await PredefinedAgent.get(defaultId) : null;
  if (
    defaultAgent &&
    defaultAgent.id !== agent.id &&
    defaultAgent.skillIds.includes(skill.id)
  ) {
    await PredefinedAgent.update(defaultAgent.id, {
      skillIds: defaultAgent.skillIds.filter((id) => id !== skill.id),
    });
  }

  await prisma.system_settings.upsert({
    where: { label: SEED_SETTING },
    update: { value: "complete", lastUpdatedAt: new Date() },
    create: { label: SEED_SETTING, value: "complete" },
  });
}

async function seedBuiltinSkills() {
  if (process.env.NODE_ENV === "test") return;
  if (!seedPromise) {
    seedPromise = (async () => {
      await seed3gppReview();
      await seed3gppPositionEvolution();
    })().catch((error) => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

module.exports = { seed3gppReview, seedBuiltinSkills };
