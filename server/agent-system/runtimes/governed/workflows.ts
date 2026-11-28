const { toolRegistry } = require("../../../tools");
const { AgentToolContext } = require("../../../tools/context");
const { toLangChainTool } = require("../../../tools/descriptor");
const { resolveAvailableSkill } = require("../../../agent-skills/registry");
const { withAgentToolTrace } = require("../../observability");
const { workspaceFileRelativePath } = require("../../attachments");

type GovernedPlan = import("./types.ts").GovernedPlan;
type GovernedTask = import("./types.ts").GovernedTask;

function requestAllowsWrite(request = ""): boolean {
  return /\b(?:write|edit|delete|remove|create|save|store|upload|download|generate|export|convert|split|extract|send|execute|run|modify|ingest|embed|index|add)\b|(?:写入|编辑|删除|创建|保存|存储|上传|下载|生成|输出|导出|转换|拆分|提取|发送|执行|修改|加入|导入|入库|嵌入|索引)/i.test(
    String(request)
  );
}

function isKnowledgeIngestionRequest(request = ""): boolean {
  const value = String(request);
  const mentionsKnowledge =
    /\b(?:rag|knowledge\s*base)\b/i.test(value) ||
    /(?:RAG|知识库)/i.test(value);
  const requestsIngestion =
    /\b(?:add|upload|store|save|ingest|embed|index)\b/i.test(value) ||
    /(?:加入|上传|保存|存储|导入|入库|嵌入|索引)/i.test(value);
  const mentionsDocuments =
    /\b(?:documents?|files?|attachments?)\b/i.test(value) ||
    /(?:文档|文件|附件|资料)/i.test(value);
  return mentionsKnowledge && requestsIngestion && mentionsDocuments;
}

function shouldRecallPersonalMemory(
  request = "",
  {
    autoRecall = true,
    userId = null,
  }: { autoRecall?: boolean; userId?: number | null } = {}
): boolean {
  return Boolean(
    autoRecall !== false && userId && !isKnowledgeIngestionRequest(request)
  );
}

function knowledgeToolGuidance(
  visibleToolIds: Iterable<string> = new Set<string>()
): string {
  const visible = new Set(visibleToolIds);
  const workspaceOperations = [
    ["knowledge.ingest", "adds regular document files"],
    ["knowledge.search", "retrieves already indexed passages"],
    ["knowledge.publish", "embeds one final Markdown report"],
  ]
    .filter(([toolId]) => visible.has(toolId))
    .map(([toolId, purpose]) => `${toolId} ${purpose}`);
  const globalOperations = [
    ["knowledge.global.list", "lists shared documents"],
    ["knowledge.global.ingest", "adds explicitly shared files"],
    ["knowledge.global.replace", "replaces one shared document"],
    ["knowledge.global.remove", "removes one shared document"],
  ]
    .filter(([toolId]) => visible.has(toolId))
    .map(([toolId, purpose]) => `${toolId} ${purpose}`);
  const workspaceGuidance = workspaceOperations.length
    ? `Workspace knowledge is the RAG knowledge base: ${workspaceOperations.join("; ")}.`
    : "Workspace knowledge is the RAG knowledge base.";
  const globalGuidance = globalOperations.length
    ? ` Shared global RAG is visible in every Workspace: ${globalOperations.join("; ")}. Only change it when the user explicitly requests a global change.`
    : "";
  return `${workspaceGuidance}${globalGuidance} Personal memory is only for user facts and preferences; document ingestion belongs to Workspace RAG unless the user explicitly requests global sharing.`;
}

function shouldRetrieveWorkspaceContext(
  request = "",
  {
    autoRecall = true,
    mode = null,
  }: { autoRecall?: boolean; mode?: string | null } = {}
): boolean {
  const value = String(request);
  if (isKnowledgeIngestionRequest(value)) return false;
  const requestsPublicWeb =
    /\b(?:search|look|research|browse)\s+(?:the\s+)?(?:public\s+)?(?:web|internet|online)\b|\b(?:web|internet|online)\s+(?:search|research|lookup)\b/i.test(
      value
    ) ||
    /(?:(?:在线|联网|网上|互联网|网页)[^。；;\n]{0,6}(?:搜索|检索|查找|查询)|(?:搜索|检索|查找|查询)[^。；;\n]{0,6}(?:互联网|网页|网上))/.test(
      value
    );
  const requestsWorkspace =
    /\b(?:rag|workspace|knowledge\s*base|local\s+documents?)\b/i.test(value) ||
    /(?:RAG|工作区|知识库|本地文档|已有资料)/i.test(value);
  if (requestsPublicWeb && !requestsWorkspace) return false;
  return autoRecall !== false || ["query", "chat"].includes(mode || "");
}

function classify3gppRequest(request = ""): "3gpp_fact_lookup" | "general" {
  const value = String(request).trim();
  const mentionsMeeting =
    /\b(?:SA[1235]|CT[14])\s*#?\s*\d+\b/i.test(value) ||
    /3GPP[^\n]{0,40}(?:会议|meeting)/i.test(value);
  const asksMeetingFact =
    /(?:什么时候|何时|日期|时间|哪天|地点|在哪里|在哪[开举]行|会议目录|meeting\s+(?:date|time|location|venue|directory)|when|where)/i.test(
      value
    );
  const requestsDeepWork =
    /(?:下载|筛选|提案|TDoc|KI\s*#?\s*\d+|Solution|Variant|公司|华为|Huawei|分析|比较|总结|报告|转换|解析|批量|立场|路线|download|proposal|analy[sz]e|compare|report|convert|extract)/i.test(
      value
    );
  return mentionsMeeting && asksMeetingFact && !requestsDeepWork
    ? "3gpp_fact_lookup"
    : "general";
}

function parse3gppMeetingRequest(
  request = ""
): { group: string; meetingNumber: number } | null {
  const match = String(request).match(/\b(SA[1235]|CT[14])\s*#?\s*(\d+)\b/i);
  if (!match) return null;
  return { group: match[1].toUpperCase(), meetingNumber: Number(match[2]) };
}

function parse3gppConversionRequest(
  request = "",
  attachments: Array<{ mime?: string; contentString?: string }> = []
): { tdoc?: string; input_path?: string } | null {
  const tdocs = [
    ...new Set(
      [...String(request).matchAll(/\b([SC]\d-\d{6,8})\b/gi)].map((match) =>
        match[1].toUpperCase()
      )
    ),
  ];
  const uploads = (attachments || [])
    .filter(
      (attachment) =>
        attachment?.mime === "application/anythingllm-workspace-file"
    )
    .map((attachment) => workspaceFileRelativePath(attachment.contentString))
    .filter((relative): relative is string =>
      Boolean(relative && relative.toLowerCase().endsWith(".docx"))
    )
    .map((relative) => `/workspace/${relative}`);
  if (tdocs.length === 1 && uploads.length === 0) return { tdoc: tdocs[0] };
  if (uploads.length === 1 && tdocs.length === 0)
    return { input_path: uploads[0] };
  return null;
}

function is3gppMarkdownConversionAgent(
  agent: { runtimeConfig?: { workflow?: string } } = {}
): boolean {
  return agent.runtimeConfig?.workflow === "3gpp-markdown-conversion";
}

function parse3gppInvitationFacts(text = ""): {
  startDay: number | null;
  endDay: number | null;
  month: number | null;
  year: number | null;
  city: string | null;
  country: string | null;
} | null {
  const value = String(text);
  const date = value.match(
    /from\s+\w+\s+(\d{1,2})\s+to\s+\w+\s+(\d{1,2})\s+of\s+([A-Za-z]+)\s+(\d{4})/i
  );
  const place = value.match(/\bin\s+([A-Za-z]+),\s*([A-Za-z]+)\b/i);
  if (!date && !place) return null;
  const months: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  return {
    startDay: date ? Number(date[1]) : null,
    endDay: date ? Number(date[2]) : null,
    month: date ? months[date[3].toLowerCase()] || null : null,
    year: date ? Number(date[4]) : null,
    city: place?.[1] || null,
    country: place?.[2] || null,
  };
}

function quick3gppResponse({
  meeting,
  data,
}: {
  meeting: { group: string; meetingNumber: number };
  data: Record<string, any> | null | undefined;
}): { text: string; sources: Record<string, unknown>[] } | null {
  const candidate = data?.candidates?.[0] || null;
  const details = data?.officialDetails || null;
  const facts = parse3gppInvitationFacts(details?.invitationText);
  const label = `${meeting.group}#${meeting.meetingNumber}`;
  if (facts?.year && facts?.month && facts?.startDay && facts?.endDay) {
    const countryNames: Record<string, string> = { china: "中国" };
    const cityNames: Record<string, string> = {
      athens: "雅典",
      dalian: "大连",
      gothenburg: "哥德堡",
      paris: "巴黎",
    };
    const country = facts.country
      ? countryNames[facts.country.toLowerCase()] || facts.country
      : "";
    const city =
      (facts.city ? cityNames[facts.city.toLowerCase()] : null) ||
      facts.city ||
      "";
    const location = city ? `，地点为${country}${city}` : "";
    return {
      text: `${label} 于 **${facts.year} 年 ${facts.month} 月 ${facts.startDay} 日至 ${facts.endDay} 日**举行${location}。\n\n依据：[3GPP 官方会议邀请函](${details.invitationUrl})。`,
      sources: [
        {
          id: `3gpp-invitation:${meeting.group}:${meeting.meetingNumber}`,
          url: details.invitationUrl,
          title: `${label} 官方会议邀请函`,
          text: details.invitationText.slice(0, 1_000),
          docSource: "3gpp-official",
        },
      ],
    };
  }
  if (candidate) {
    return {
      text: `${label} 的官方会议目录为 [${candidate.folder}](${candidate.url})。目录名称只能确认月份或地点；当前未能从邀请函提取精确日期，因此不继续猜测。`,
      sources: [
        {
          id: `3gpp-meeting:${meeting.group}:${meeting.meetingNumber}`,
          url: candidate.url,
          title: `${label} 官方会议目录`,
          text: candidate.folder,
          docSource: "3gpp-official",
        },
      ],
    };
  }
  return null;
}

async function executeQuick3gppLookup({
  request,
  run,
  workspace,
  user,
  agent,
  emit,
  signal,
  budget,
  activatedSkillScope = null,
}: {
  request: string;
  run: Record<string, any>;
  workspace: Record<string, any>;
  user: Record<string, any> | null;
  agent: Record<string, any>;
  emit: (event: string, payload?: Record<string, unknown>) => Promise<void>;
  signal?: AbortSignal;
  budget?: Record<string, any>;
  activatedSkillScope?: Map<string, any> | null;
}): Promise<{ text: string; sources: Record<string, unknown>[] } | null> {
  const meeting = parse3gppMeetingRequest(request);
  if (!meeting) return null;
  const context = new AgentToolContext({
    run,
    workspace,
    user,
    agent,
    emit,
    signal,
    approvalMode: "always_allow",
    budget,
    maxLocalToolCalls: 2,
    taskId: null,
    taskTitle: "查询 3GPP 会议事实",
    activatedSkillScope,
  });
  const invoke = async (
    toolId: string,
    args: Record<string, unknown>,
    suffix: string
  ) => {
    const descriptor = toolRegistry.get(toolId);
    if (!descriptor) return null;
    return JSON.parse(
      await toLangChainTool(descriptor, context).func(args, undefined, {
        toolCall: { id: `${run.id}:quick-3gpp:${suffix}` },
      })
    );
  };
  const activation = await invoke(
    "skill.activate",
    { name: "3gpp-lookup" },
    "activate"
  );
  if (!activation?.ok) return null;
  const resolved = await invoke(
    "3gpp.resolve-meeting",
    {
      group: meeting.group,
      meeting_number: meeting.meetingNumber,
      include_invitation: true,
    },
    "resolve"
  );
  if (!resolved?.ok) return null;
  return quick3gppResponse({ meeting, data: resolved.data });
}

async function execute3gppMarkdownConversion({
  args,
  run,
  workspace,
  user,
  agent,
  emit,
  signal,
  budget,
  activatedSkillScope = null,
}: {
  args: { tdoc?: string; input_path?: string };
  run: Record<string, any>;
  workspace: Record<string, any>;
  user: Record<string, any> | null;
  agent: Record<string, any>;
  emit: (event: string, payload?: Record<string, unknown>) => Promise<void>;
  signal?: AbortSignal;
  budget?: Record<string, any>;
  activatedSkillScope?: Map<string, any> | null;
}): Promise<{
  text: string;
  sources: Record<string, unknown>[];
  partial: boolean;
}> {
  const context = new AgentToolContext({
    run,
    workspace,
    user,
    agent,
    emit,
    signal,
    approvalMode: "always_allow",
    budget,
    maxLocalToolCalls: 2,
    taskId: null,
    taskTitle: "转换 3GPP 提案",
    activatedSkillScope,
  });
  const invoke = async (
    toolId: string,
    toolArgs: Record<string, unknown>,
    suffix: string,
    traceName: string
  ) => {
    const descriptor = toolRegistry.get(toolId);
    if (!descriptor) return null;
    return withAgentToolTrace(
      traceName,
      { input: toolArgs, metadata: { toolId: descriptor.id } },
      async () =>
        JSON.parse(
          await toLangChainTool(descriptor, context).func(toolArgs, undefined, {
            toolCall: { id: `${run.id}:3gpp-convert:${suffix}` },
          })
        )
    );
  };
  const activation = await invoke(
    "skill.activate",
    { name: "3gpp-review" },
    "activate",
    "activate-skill"
  );
  if (!activation?.ok)
    return {
      text: `无法开始转换：${activation?.summary || "3gpp-review Skill 激活失败。"}`,
      sources: [],
      partial: true,
    };
  const currentSkill = await resolveAvailableSkill(
    agent,
    workspace,
    "3gpp-review"
  );
  if (currentSkill) context.activateSkill(currentSkill);
  const converted = await invoke(
    "3gpp.convert-markdown",
    args,
    "convert",
    "convert-3gpp-markdown"
  );
  if (!converted?.ok)
    return {
      text: `没有完成转换：${converted?.summary || "转换工具没有返回结果。"}`,
      sources: [],
      partial: true,
    };
  const data = converted.data || {};
  const warnings: string[] = Array.isArray(data.warnings) ? data.warnings : [];
  const text = [
    `已完成${data.tdoc ? ` **${data.tdoc}**` : " DOCX"} 的转换。`,
    "",
    `- 压缩包：\`${data.archivePath}\``,
    `- Markdown：\`${data.markdownPath}\``,
    `- 图片：${Number(data.imageCount) || 0} 张`,
    `- 嵌入对象：${Number(data.embeddedCount) || 0} 个`,
    warnings.length ? `- 转换提示：${warnings.join("；")}` : "- 转换提示：无",
  ].join("\n");
  const sources = data.officialUrl
    ? [
        {
          id: `3gpp-tdoc:${data.tdoc}`,
          url: data.officialUrl,
          title: `${data.tdoc} 官方文件`,
          text: data.meetingFolder || data.tdoc,
          docSource: "3gpp-official",
        },
      ]
    : [];
  return { text, sources, partial: false };
}

function normalized3gppLookupPlan(
  request: string,
  allowedToolIds: Set<string>
): GovernedPlan {
  const tools = (ids: string[]) => ids.filter((id) => allowedToolIds.has(id));
  return {
    goal: "Answer the 3GPP meeting fact with the smallest sufficient official evidence",
    tasks: [
      {
        id: "lookup-3gpp-meeting",
        title: "查询 3GPP 会议事实",
        objective: `Follow the already activated 3gpp-lookup Skill, resolve the canonical meeting directory without guessing paths, and answer only the requested meeting fact. Stop as soon as one sufficient official source is available; use a second source only when an exact date or ambiguous fact requires it. Do not run Bash or Python, install dependencies, download proposals, create files, or publish knowledge. User request: ${request}`,
        dependsOn: [],
        allowedToolIds: tools(["3gpp.resolve-meeting", "web.fetch"]),
        requiredCapabilities: [],
        successCriteria: [
          "The canonical meeting directory is resolved without guessed aliases.",
          "The requested fact is supported by the minimum sufficient official evidence.",
          "No proposal download, file creation, package installation, or report workflow is started.",
        ],
        acceptsPartialDependencies: false,
        writeIntent: false,
      },
    ],
  };
}

function isQuick3gppLookupTask(taskItem: Partial<GovernedTask> = {}): boolean {
  const allowedToolIds = taskItem.allowedToolIds || [];
  const quickLookupTools = new Set(["3gpp.resolve-meeting", "web.fetch"]);
  return (
    taskItem.writeIntent !== true &&
    allowedToolIds.includes("3gpp.resolve-meeting") &&
    allowedToolIds.every((toolId) => quickLookupTools.has(toolId))
  );
}

function normalized3gppReviewPlan(
  request: string,
  _requestedName: string,
  allowedToolIds: Set<string>
): GovernedPlan {
  const tools = (ids: string[]) => ids.filter((id) => allowedToolIds.has(id));
  return {
    goal: "Complete the 3GPP TDoc workflow with a validated manifest and one canonical report",
    tasks: [
      {
        id: "resolve-and-filter",
        title: "Resolve the meeting and create the proposal manifest",
        objective: `Resolve the exact meeting folder and Index from official data, determine the requested agenda/KI scope, and use filter-index to generate and validate the canonical proposals.json. Never hand-write a manifest. Reuse exact paths returned by tools. User request: ${request}`,
        dependsOn: [],
        allowedToolIds: tools([
          "bash",
          "web.fetch",
          "filesystem.read",
          "filesystem.write",
          "filesystem.list",
          "filesystem.search",
        ]),
        requiredCapabilities: [],
        successCriteria: [
          "The exact meeting and agenda mapping are supported by the meeting Index.",
          "filter-index generated proposals.json and validate-manifest succeeded.",
          "The exact manifest path and complete TDoc set are recorded for later tasks.",
        ],
        acceptsPartialDependencies: false,
        writeIntent: true,
      },
      {
        id: "download-extract-cover",
        title: "Download, extract, and verify exact coverage",
        objective:
          "Use the exact manifest and meeting URL from dependencies to download and extract every selected TDoc. Inspect material figures when needed. Run strict coverage with --receipt and preserve the exact manifest, texts, figures, and receipt paths. Do not change the selected TDoc set.",
        dependsOn: ["resolve-and-filter"],
        allowedToolIds: tools([
          "bash",
          "python",
          "filesystem.read",
          "filesystem.write",
          "filesystem.list",
          "filesystem.search",
          "vision.inspect",
        ]),
        requiredCapabilities: [],
        successCriteria: [
          "All selected TDocs are downloaded or a specific blocking failure is recorded.",
          "Text and material diagrams are extracted and reviewed as required.",
          "Strict coverage succeeds with no missing or extra TDocs and writes coverage.json.",
        ],
        acceptsPartialDependencies: false,
        writeIntent: true,
      },
      {
        id: "analyze-and-publish",
        title: "Analyze all proposals and publish one final report",
        objective:
          "Analyze the complete validated TDoc set, write and read back one versioned Chinese Markdown report, then call knowledge.publish exactly once with the report path, complete manifest TDoc list, exact manifestPath, and exact coverageReceiptPath. Reuse dependency paths and do not publish an alternate report.",
        dependsOn: ["download-extract-cover"],
        allowedToolIds: tools([
          "bash",
          "python",
          "filesystem.read",
          "filesystem.write",
          "filesystem.list",
          "filesystem.search",
          "vision.inspect",
          "knowledge.publish",
        ]),
        requiredCapabilities: [],
        successCriteria: [
          "Every manifest TDoc is analyzed or listed with a specific failure.",
          "Report counts and TDoc IDs exactly match the manifest and coverage receipt.",
          "knowledge.publish confirms the single canonical report publication.",
        ],
        acceptsPartialDependencies: false,
        writeIntent: true,
      },
    ],
  };
}

module.exports = {
  classify3gppRequest,
  execute3gppMarkdownConversion,
  executeQuick3gppLookup,
  is3gppMarkdownConversionAgent,
  isKnowledgeIngestionRequest,
  isQuick3gppLookupTask,
  knowledgeToolGuidance,
  normalized3gppLookupPlan,
  normalized3gppReviewPlan,
  parse3gppConversionRequest,
  parse3gppInvitationFacts,
  parse3gppMeetingRequest,
  quick3gppResponse,
  requestAllowsWrite,
  shouldRecallPersonalMemory,
  shouldRetrieveWorkspaceContext,
};
