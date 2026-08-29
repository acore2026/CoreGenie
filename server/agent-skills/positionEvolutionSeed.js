const fs = require("fs/promises");
const path = require("path");
const prisma = require("../utils/prisma");
const { PredefinedAgentSkill } = require("../models/predefinedAgentSkill");
const { PredefinedAgent } = require("../models/predefinedAgent");

const SEED_SETTING = "agent_skill_seed_3gpp_position_evolution_v11";
const SKILL_NAME = "3gpp-position-evolution";
const REVIEW_SKILL_NAMES = ["3gpp-review", "3gpp-tdocs"];
const AGENT_NAME = "3GPP 技术路线与立场分析助手";
const AGENT_TOOLS = [
  "skill.read_resource",
  "bash",
  "python",
  "filesystem.read",
  "filesystem.write",
  "filesystem.list",
  "filesystem.search",
  "web.fetch",
  "web.search",
  "3gpp.resolve-meeting",
  "knowledge.search",
  "knowledge.ingest",
  "user.ask",
  "vision.inspect",
  "knowledge.publish",
];

const AGENT_PROMPT = `你是一名面向 3GPP/6G 标准研究的公司技术路线与立场演进分析助手。

规划前先加载适用的 Skill。处理跨会议、跨时间的公司立场、技术路线、术语、支持者、反对者或标准化结果分析时使用 3gpp-position-evolution；需要定位、下载、提取或核验官方 TDoc 时，同时使用已绑定的 3GPP 提案分析 Skill（新名称 3gpp-review，旧安装可能名为 3gpp-tdocs）。运行时会把已加载 Skill 的说明传给后续所有助手，不要把 Skill 加载写成任务。

核心要求：
- Skill 加载必须在创建计划前完成；计划的第一步应直接处理范围或资料准备，不得出现 Skill 加载任务；
- 在相关资料准备任务中读取 status-semantics、evidence-taxonomy、report-contract 和 company-aliases；不要重复读取同一资源；
- 先冻结公司、主题/KI/WI、工作组、会议范围和数据快照时间，再开始分析；
- 先按会议整理 TDoc 清单和版本关系，再分析公司立场，不凭印象补齐会议或提案；
- 每项实质结论关联到 TDoc 或官方会议材料，并区分公司原始提案、共同署名文本、会议结果和分析推断；
- 只有明确反对证据才能将公司列为“主要反对者”，竞争方案和保留意见必须单独分类；
- 不把 Not Handled、Postponed、Merged、Withdrawn 或 Baseline 自动解释为“被拒绝”或“已批准”；
- 最新会议尚未结束或元数据未定稿时，明确标记结论为临时状态；
- 默认输出中文 Markdown 报告，完成 ledger、证据分类、coverage 和 validate 检查；
- Workspace 知识库就是 RAG 知识库：knowledge.search 只检索已入库资料，knowledge.ingest 才把普通文档加入 RAG；不得用个人记忆工具保存文档；
- 最终报告必须调用 knowledge.publish 发布到当前 Workspace 知识库，并在回复中说明报告路径、覆盖率、快照时间和入库结果。`;

async function packageFiles(root, directory = root) {
  const values = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === "SKILL.md" || entry.name === "__pycache__") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      values.push(...(await packageFiles(root, absolute)));
      continue;
    }
    if (!entry.isFile() || entry.name.endsWith(".pyc")) continue;
    values.push({
      path: path.relative(root, absolute).split(path.sep).join("/"),
      content: await fs.readFile(absolute, "utf8"),
      encoding: "utf8",
    });
  }
  return values.sort((a, b) => a.path.localeCompare(b.path));
}

async function activeSkillByName(name) {
  const record = await prisma.predefined_agent_skills.findFirst({
    where: { name, archived: false },
  });
  return record ? PredefinedAgentSkill.get(record.id) : null;
}

async function seed3gppPositionEvolution() {
  const completed = await prisma.system_settings.findUnique({
    where: { label: SEED_SETTING },
  });
  if (completed?.value === "complete") return;

  const exampleRoot = path.join(
    __dirname,
    "examples",
    "3gpp-position-evolution"
  );
  const packageInput = {
    skillMd: await fs.readFile(path.join(exampleRoot, "SKILL.md"), "utf8"),
    files: await packageFiles(exampleRoot),
    provenance: {
      adaptedFor: "AnythingLLM Agent Skills runtime",
      purpose: "Longitudinal 3GPP company position and TDoc lineage analysis",
    },
  };

  let skill = await activeSkillByName(SKILL_NAME);
  if (!skill) {
    const created = await PredefinedAgentSkill.createPackage(packageInput);
    if (!created.skill)
      throw new Error(created.error || "Unable to seed evolution skill.");
    skill = created.skill;
  } else {
    const updated = await PredefinedAgentSkill.updatePackage(
      skill.id,
      packageInput
    );
    if (!updated.skill)
      throw new Error(updated.error || "Unable to update evolution skill.");
    skill = updated.skill;
  }

  let reviewSkill = null;
  for (const name of REVIEW_SKILL_NAMES) {
    reviewSkill = await activeSkillByName(name);
    if (reviewSkill) break;
  }
  if (!reviewSkill)
    throw new Error(
      "A 3GPP review Skill must be seeded before 3gpp-position-evolution."
    );

  const agentData = {
    name: AGENT_NAME,
    description:
      "跨多次 3GPP 会议追踪公司立场、技术路线、术语演进、支持/反对关系和标准化结果。",
    welcomeMessage:
      "请告诉我工作组、公司、KI/WI/技术主题，以及希望分析的时间或会议范围。",
    examplePrompts: [
      "分析 Huawei 从 2025 年至今在 SA2 KI#18 Agentic Core 上的技术路线、术语演进、支持者、反对者和标准化结果。",
      {
        label:
          "比较 Huawei 与 Ericsson 在指定 KI 上跨多次会议的架构路线，并区分明确反对、保留意见和替代方案。",
        prompt:
          "聚焦 SA2 Rel-20 6G 研究中的 KI #18（Agentic Core）提案，比较 Huawei 与 Ericsson 从 2025 年至最近一次已结束会议的架构路线。请按会议梳理双方 TDoc 和版本关系，说明路线如何变化，并分别列出明确反对、保留意见和替代方案。",
      },
      "更新上一次公司路线分析，只总结最新会议新增提案、状态变化和未决问题。",
    ],
    tools: AGENT_TOOLS,
    skillIds: [skill.id, reviewSkill.id],
    systemPrompt: AGENT_PROMPT,
    runtimeKey: "governed-agent",
    runtimeConfig: {
      visionModel: "qwen3.7-plus",
      requiredCompletionTools: ["knowledge.publish"],
    },
    // Keep the Skill package and historical runs, but stop offering this Agent
    // until its long-running workflow is reliable enough to restore.
    enabled: false,
  };
  const existingAgent = (await PredefinedAgent.all()).find(
    (item) => item.name === AGENT_NAME
  );
  const agent = existingAgent
    ? await PredefinedAgent.update(existingAgent.id, agentData)
    : await PredefinedAgent.create(agentData);
  if (!agent) throw new Error("Unable to seed the 3GPP evolution Agent.");

  await prisma.system_settings.upsert({
    where: { label: SEED_SETTING },
    update: { value: "complete", lastUpdatedAt: new Date() },
    create: { label: SEED_SETTING, value: "complete" },
  });
}

module.exports = { seed3gppPositionEvolution };
