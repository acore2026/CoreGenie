const fs = require("fs/promises");
const path = require("path");
const prisma = require("../utils/prisma");
const { PredefinedAgentSkill } = require("../models/predefinedAgentSkill");
const { PredefinedAgent } = require("../models/predefinedAgent");

const SEED_SETTING = "agent_skill_seed_3gpp_review_direct_v3";
const SKILL_NAME = "3gpp-review-direct";
const AGENT_NAME = "3GPP 提案分析助手（实验版）";

const AGENT_TOOLS = [
  "skill.activate",
  "skill.read_resource",
  "3gpp.resolve-meeting",
  "bash",
  "python",
  "filesystem.read",
  "filesystem.write",
  "filesystem.list",
  "filesystem.search",
  "web.fetch",
  "user.ask",
  "vision.inspect",
];

const AGENT_PROMPT = `你是 3GPP 提案分析实验助手。你的目的不是调用其他助手，而是在一个连续会话中完整执行原版 3GPP Skill。

开始处理后：
- 只激活一次 3gpp-review-direct Skill，然后按其中的步骤继续；
- 不创建任务计划，不调用其他 Agent，不把工作拆给新的模型上下文；
- 上一步得到的会议 URL、文件路径和命令结果要直接用于下一步，不要重新查找；
- 使用 Skill 自带的 scripts/3gpp_tdocs.py，保持原来的下载、提取、检查和分析流程；
- 中间文件和报告保存在 /workspace/3gpp-review-direct；
- 完成用户要求的报告后直接回复，不发布到知识库；
- 如果某一份文件下载失败，保留已经完成的文件，只重试失败项；
- 公司提案不等于 3GPP 已采纳结论，会议结果不明确时直接说明。

除非缺失信息会导致选错会议或提案范围，否则不要中途询问用户。`;

async function seedDirect3gppReview() {
  const completed = await prisma.system_settings.findUnique({
    where: { label: SEED_SETTING },
  });
  if (completed?.value === "complete") return;

  const exampleRoot = path.join(__dirname, "examples", "3gpp-review-direct");
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
      adaptedFor: "AnythingLLM single-context Agent runtime",
    },
  };

  const existingSkillRecord = await prisma.predefined_agent_skills.findFirst({
    where: { name: SKILL_NAME, archived: false },
  });
  let skill;
  if (existingSkillRecord) {
    const updated = await PredefinedAgentSkill.updatePackage(
      existingSkillRecord.id,
      packageInput
    );
    skill = updated.skill;
    if (!skill)
      throw new Error(updated.error || "Unable to update direct 3GPP Skill.");
  } else {
    const created = await PredefinedAgentSkill.createPackage(packageInput);
    skill = created.skill;
    if (!skill)
      throw new Error(created.error || "Unable to create direct 3GPP Skill.");
  }

  const agents = await PredefinedAgent.all();
  const existingAgent = agents.find((item) => item.name === AGENT_NAME);
  const agentData = {
    name: AGENT_NAME,
    description:
      "使用原版 3GPP Skill，在一个连续任务中查找、下载、解析和分析提案。",
    welcomeMessage:
      "请告诉我工作组、准确的会议名称、KI/议程项和公司名称。我会在一个连续任务中完成查找和分析。",
    examplePrompts: [
      "查找 SA2#175 KI#22 中华为相关提案，总结 Solution/Variant、关键流程和未决问题。",
      "分析 SA2#175 KI#22 中的华为提案，并列出所用 TDoc。",
      "比较指定 3GPP 提案中的网络功能、接口、信息元素和信令流程。",
    ],
    tools: AGENT_TOOLS,
    skillIds: [skill.id],
    systemPrompt: AGENT_PROMPT,
    runtimeKey: "default-react",
    runtimeConfig: {
      maxRuntimeMs: 60 * 60 * 1_000,
      disableModelCallLimit: true,
      visionModel: "qwen3.7-plus",
    },
    enabled: true,
  };
  const agent = existingAgent
    ? await PredefinedAgent.update(existingAgent.id, agentData)
    : await PredefinedAgent.create(agentData);
  if (!agent) throw new Error("Unable to seed direct 3GPP review Agent.");

  await prisma.system_settings.upsert({
    where: { label: SEED_SETTING },
    update: { value: "complete", lastUpdatedAt: new Date() },
    create: { label: SEED_SETTING, value: "complete" },
  });
}

module.exports = { seedDirect3gppReview };
