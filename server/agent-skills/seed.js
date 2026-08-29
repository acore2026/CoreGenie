const fs = require("fs/promises");
const path = require("path");
const prisma = require("../utils/prisma");
const { PredefinedAgentSkill } = require("../models/predefinedAgentSkill");
const { PredefinedAgent } = require("../models/predefinedAgent");
const { seed3gppPositionEvolution } = require("./positionEvolutionSeed");

const SEED_SETTING = "agent_skill_seed_3gpp_review_v15";
const AGENT_NAME = "3GPP 提案分析助手";
const LEGACY_AGENT_NAMES = ["3GPP 提案分析助手（Skill）"];
const CONVERTER_AGENT_NAME = "3GPP 提案转 Markdown 助手";
const SKILL_NAME = "3gpp-review";
const LOOKUP_SKILL_NAME = "3gpp-lookup";
const LEGACY_SKILL_NAMES = ["3gpp-tdocs"];
const AGENT_TOOLS = [
  "bash",
  "python",
  "filesystem.read",
  "filesystem.write",
  "filesystem.list",
  "filesystem.search",
  "web.fetch",
  "3gpp.resolve-meeting",
  "knowledge.search",
  "knowledge.ingest",
  "user.ask",
  "vision.inspect",
  "knowledge.publish",
];

const AGENT_PROMPT = `你是一名面向 3GPP/6G 标准研究的提案分析助手。

规划前先选择适用的 Skill：查询会议时间、地点或目录等简短事实时使用 3gpp-lookup；下载、筛选或分析 TDoc，以及处理 KI、公司立场或 Solution/Variant 时使用 3gpp-review。运行时会在创建任务计划前加载所选 Skill 的完整说明，后续步骤直接遵循这些说明，不要把 Skill 加载写成任务。

核心要求：
- 不猜测会议目录、议程映射、TDoc 元数据或提案内容；
- 将每项实质结论关联到明确的 TDoc 编号；
- 区分提案方主张、编辑说明和已达成的 3GPP 共识；
- 对流程图使用视觉工具核验实体、箭头和消息顺序，无法辨认时明确标注不确定；
- 默认输出中文 Markdown 报告；
- 使用 filter-index 生成并验证 proposals.json，不得手写或改造 manifest；
- 将工作拆为会议与清单、下载与提取、分析与严格 coverage、报告与发布四个有依赖关系的阶段；
- Workspace 知识库就是 RAG 知识库：用 knowledge.search 检索已入库资料，用 knowledge.ingest 将普通文档文件加入 RAG；不得用个人记忆工具保存文档；
- 调用 Skill 自带脚本时，bash 的 cwd 必须使用已加载 Skill 提供的 skill:// 路径，并通过相对路径 scripts/3gpp_tdocs.py 执行；禁止调用 /workspace/3gpp-review/scripts/3gpp_tdocs.py 或其他工作区脚本副本；
- 后续工具调用必须复用上一步返回的准确文件路径，路径不确定时先搜索，不得根据文件名猜目录；
- 最终报告必须通过严格 coverage 并生成 receipt，再将 manifest、receipt 和完整 TDoc 列表一并传给 knowledge.publish；
- 每次运行只发布一份最终报告，发布成功后不得换路径再次发布；
- knowledge.publish 成功后，在最终回复中说明报告路径、覆盖率和入库结果。`;
const CONVERTER_TOOLS = [
  "3gpp.convert-markdown",
  "bash",
  "python",
  "filesystem.read",
  "filesystem.write",
  "filesystem.list",
  "filesystem.search",
  "web.fetch",
  "user.ask",
];
const CONVERTER_PROMPT = `你负责把 3GPP 提案 DOCX 转成 Markdown 和图片压缩包。

规划前必须加载 3gpp-review Skill，并使用其中的 conversion mode 和 convert-docx 命令。不要创建单独的 Skill 加载任务。

核心要求：
- 输入可以是用户上传的 DOCX 工作区路径，也可以是 TDoc 编号、工作组和会议信息；
- 输入能够确定一个文件时，调用 3gpp.convert-markdown 一次完成下载、转换、检查和 ZIP 登记；工具成功后不要再用 bash 重复转换；
- 用户提供 TDoc 信息时，只从 3GPP 官方网站查找和下载；结果不唯一时先询问，不要猜文件；
- 只做格式转换，不总结、比较或分析提案观点；
- 保留标题、段落、列表、表格、链接、图片和可导出的嵌入对象；
- 不把图片改写成 Mermaid，也不根据模糊图片补画内容；
- 每次转换使用 /workspace/3gpp-markdown/results/ 下的新目录；
- 完成后检查 Markdown、conversion-summary.json 和 ZIP 是否存在；
- 最终回复说明 ZIP 路径和转换警告，不把转换结果发布到知识库。`;
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

  const lookupRoot = path.join(__dirname, "examples", LOOKUP_SKILL_NAME);
  const lookupSkillMd = await fs.readFile(
    path.join(lookupRoot, "SKILL.md"),
    "utf8"
  );
  const lookupRecord = await prisma.predefined_agent_skills.findFirst({
    where: { name: LOOKUP_SKILL_NAME, archived: false },
  });
  let lookupSkill = lookupRecord
    ? await PredefinedAgentSkill.get(lookupRecord.id)
    : null;
  const lookupPackageInput = {
    skillMd: lookupSkillMd,
    provenance: {
      derivedFrom: "3gpp-review",
      adaptedFor: "AnythingLLM fast 3GPP fact lookup",
    },
  };
  if (!lookupSkill) {
    const created =
      await PredefinedAgentSkill.createPackage(lookupPackageInput);
    if (!created.skill)
      throw new Error(created.error || "Unable to seed 3GPP lookup skill.");
    lookupSkill = created.skill;
  } else {
    const updated = await PredefinedAgentSkill.updatePackage(
      lookupSkill.id,
      lookupPackageInput
    );
    if (!updated.skill)
      throw new Error(updated.error || "Unable to update 3GPP lookup skill.");
    lookupSkill = updated.skill;
  }

  const agents = await PredefinedAgent.all();
  let agent = agents.find(
    (item) => item.name === AGENT_NAME || LEGACY_AGENT_NAMES.includes(item.name)
  );
  const agentData = {
    name: AGENT_NAME,
    description:
      "按 3GPP 会议和 KI 查找、下载、解析和比较 TDoc，生成中文分析报告，并列出所用 TDoc。",
    welcomeMessage:
      "请告诉我工作组、会议号、KI/议程项，或直接给出需要比较的 TDoc 编号。",
    examplePrompts: [
      "分析 SA2#175 KI#22 中 S2-2606085、S2-2606481、S2-2605964、S2-2605867、S2-2606356，并比较公司技术路线。",
      "查找 SA2#175 KI#22 中华为相关提案，总结 Solution/Variant、关键流程和未决问题。",
      "比较指定 3GPP 提案中的网络功能、接口、信息元素和信令流程，并输出中文报告。",
    ],
    tools: AGENT_TOOLS,
    skillIds: [skill.id, lookupSkill.id],
    systemPrompt: AGENT_PROMPT,
    runtimeKey: "governed-agent",
    runtimeConfig: {
      visionModel: "qwen3.7-plus",
      requiredCompletionTools: ["knowledge.publish"],
      publicationRequiresCoverage: true,
    },
    enabled: true,
  };
  agent = agent
    ? await PredefinedAgent.update(agent.id, agentData)
    : await PredefinedAgent.create(agentData);
  if (!agent) throw new Error("Unable to seed the 3GPP review Agent.");

  let converterAgent = agents.find(
    (item) => item.name === CONVERTER_AGENT_NAME
  );
  const converterData = {
    name: CONVERTER_AGENT_NAME,
    description:
      "把 3GPP 提案 DOCX 转成 Markdown，并将原图和无法直接转换的嵌入对象一起打包。",
    welcomeMessage:
      "上传 DOCX 提案，或告诉我 TDoc 编号、工作组和会议，我会生成 Markdown 和图片压缩包。",
    examplePrompts: [
      "请把我上传的提案转换成 Markdown 和图片压缩包。",
      "请下载 S2-2606085，并转换成 Markdown 和图片压缩包。",
      "把这个 DOCX 的表格、图片和 Visio 图按原文顺序整理成 Markdown。",
    ],
    tools: CONVERTER_TOOLS,
    skillIds: [skill.id],
    systemPrompt: CONVERTER_PROMPT,
    runtimeKey: "governed-agent",
    runtimeConfig: {
      attachmentMode: "workspace_file",
      workflow: "3gpp-markdown-conversion",
      thinking: false,
    },
    enabled: true,
  };
  converterAgent = converterAgent
    ? await PredefinedAgent.update(converterAgent.id, converterData)
    : await PredefinedAgent.create(converterData);
  if (!converterAgent)
    throw new Error("Unable to seed the 3GPP Markdown converter Agent.");

  // v1 briefly attached the skill to the installation-wide default Agent.
  // Keep the specialized workflow isolated while preserving the chosen default.
  const defaultId = await PredefinedAgent.defaultId();
  const defaultAgent = defaultId
    ? await PredefinedAgent.get(defaultId)
    : agents.find(
        (item) => item.isBuiltinDefault || item.name === "通用助手"
      ) || null;
  if (defaultAgent && defaultAgent.id !== agent.id) {
    const defaultSkillIds = new Set(defaultAgent.skillIds);
    defaultSkillIds.delete(skill.id);
    defaultSkillIds.add(lookupSkill.id);
    await PredefinedAgent.update(defaultAgent.id, {
      skillIds: [...defaultSkillIds],
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
