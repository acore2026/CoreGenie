const crypto = require("crypto");
const { tool } = require("@langchain/core/tools");
const { z } = require("zod");
const {
  Annotation,
  Command,
  END,
  Send,
  START,
  StateGraph,
  interrupt,
  isGraphInterrupt,
} = require("@langchain/langgraph");
const { Memory } = require("../../models/memory");
const { AgentRunTask } = require("../../models/agentRunTask");
const { AgentRunEvidence } = require("../../models/agentRunEvidence");
const { AgentToolExecution } = require("../../models/agentToolExecution");
const { ModelCapability } = require("../../models/modelCapability");
const { resolveAgent, agentListForPrompt } = require("../../resources/agents");
const { createChatModel, selectedProvider } = require("../../resources/models");
const {
  legacySelectionAllows,
  normalizeToolId,
  toolRegistry,
  visibleToolDescriptorsForAgent,
} = require("../../tools");
const { AgentToolContext } = require("../../tools/context");
const { toLangChainTool } = require("../../tools/descriptor");
const { retrieveWorkspaceContext } = require("../../tools/rag");
const { buildAgentGraph } = require("../graph");
const { agentMaxConcurrency } = require("../concurrency");
const {
  executionLimitsDisabled,
  recursionLimitFor,
} = require("../executionLimits");
const {
  activatedSkillSnapshot,
  activatedSkillsPrompt,
  mergeActivatedSkills,
  restoreActivatedSkills,
} = require("../activatedSkills");
const {
  allowedToolIds: skillAllowedToolIds,
  availableSkills,
  resolveAvailableSkill,
  skillCatalogPrompt,
} = require("../../agent-skills/registry");
const { getCheckpointer } = require("../checkpointer");
const {
  contentText,
  finalText,
  userContent,
  isImageAttachment,
} = require("../message");
const {
  childRunnableConfig,
  withAgentStepTrace,
  withAgentToolTrace,
  withRetrieverTrace,
} = require("../observability");
const { consumeGraphStream } = require("./stream");
const { workspaceFileRelativePath } = require("../attachments");
const {
  evidenceSchema,
  normalizeEvidence,
  parseJsonObject,
  sourceFromEvidence,
} = require("./evidenceResearch");

const DEFAULTS = Object.freeze({
  maxTasks: 8,
  maxConcurrency: agentMaxConcurrency(),
  maxReviewRounds: 1,
  maxTaskToolCalls: 40,
  maxTaskModelCalls: 16,
  maxTaskMs: 8 * 60 * 1_000,
  maxRunMs: 15 * 60 * 1_000,
  maxConsecutiveNoProgress: 3,
  maxQuickLookupToolCalls: 12,
  maxQuickLookupModelCalls: 8,
});

function controllerDirectActionsEnabled(env = process.env) {
  return (
    String(env.ENABLE_CONTROLLER_DIRECT_ACTIONS || "").toLowerCase() === "true"
  );
}

const taskSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(180),
  objective: z.string().trim().min(1).max(2_000),
  dependsOn: z.array(z.string().trim().min(1)).max(12).default([]),
  assignedAgentId: z.number().int().positive().nullable().optional(),
  allowedToolIds: z.array(z.string().trim().min(1)).max(40).default([]),
  requiredCapabilities: z.array(z.string().trim().min(1)).max(20).default([]),
  successCriteria: z.array(z.string().trim().min(1)).max(12).default([]),
  acceptsPartialDependencies: z.boolean().default(false),
  writeIntent: z.boolean().default(false),
});

const planSchema = z.object({
  goal: z.string().trim().min(1).max(1_000),
  tasks: z.array(taskSchema).min(1).max(DEFAULTS.maxTasks),
});

function rethrowWorkerInterrupt(error) {
  if (isGraphInterrupt(error)) throw error;
}

function taskHasWriteTool(allowedToolIds = []) {
  return allowedToolIds.some((toolId) => {
    if (toolId === "agent.call") return true;
    const descriptor = toolRegistry.get(toolId);
    return descriptor && descriptor.effect !== "read";
  });
}

function taskRequestsArtifactWrite(task = {}) {
  const text = [task.title, task.objective, ...(task.successCriteria || [])]
    .filter(Boolean)
    .join("\n")
    .replace(
      /\bwrite\b.{0,50}\bworker\s+json\b(?:\s+(?:result|response))?|写入.{0,30}worker\s*JSON(?:\s*(?:结果|返回))?/gi,
      "return the analysis"
    );
  const explicitOutputWrite =
    /\b(?:write|create|edit|update|append|save|publish|generate|produce|complete|copy|move|archive)\b.{0,60}\b(?:report|file|document|source|original|index|tdoc|docx|xlsx|json|ledger|manifest|markdown|zip|artifact)\b|(?:撰写|创建|写入|更新|编辑|追加|保存|发布|生成|复制|移动|归档|打包).{0,30}(?:报告|文件|文档|原文|源文件|Index|TDoc|DOCX|XLSX|JSON|台账|清单|Markdown|ZIP|ledger|manifest)|(?<!已)完成\s*(?:报告|文件|台账|清单|ledger)/i;
  const artifactAcquisition =
    /\b(?:download|unpack|convert)\b.{0,60}\b(?:file|document|source|original|index|tdoc|docx|xlsx|json|manifest|markdown|zip|artifact)\b|(?:下载|解压).{0,30}(?:报告|文件|文档|原文|源文件|Index|TDoc|DOCX|XLSX|JSON|清单|Markdown|ZIP|manifest)|转换(?!后).{0,30}(?:文件|文档|原文|源文件|DOCX|XLSX|JSON|Markdown|ZIP)/i;
  const artifactExtraction =
    /\bextract\b.{0,60}\b(?:file|document|source|original|docx|xlsx|zip|attachment|image|media|object|artifact)\b|提取(?!后).{0,30}(?:文件|文档|原文|源文件|DOCX|XLSX|ZIP|压缩包|附件|图片|图像|媒体|对象)/i;
  return (
    explicitOutputWrite.test(text) ||
    artifactAcquisition.test(text) ||
    artifactExtraction.test(text)
  );
}

function taskRequestsKnowledgePublish(task = {}) {
  const text = [task.title, task.objective, ...(task.successCriteria || [])]
    .filter(Boolean)
    .join("\n");
  return /\bpublish\b.{0,80}\b(?:knowledge\s*base|workspace)\b|\b(?:knowledge\s*base|workspace)\b.{0,80}\bpublish\b|发布.{0,40}(?:知识库|Workspace)|(?:知识库|Workspace).{0,40}发布/i.test(
    text
  );
}

function taskTerminalError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}

function isTerminalTaskError(error) {
  return ["TASK_NO_PROGRESS", "TASK_TIME_BUDGET_EXHAUSTED"].includes(
    error?.code
  );
}

const workerResultSchema = z.object({
  summary: z.string().trim().min(1).max(12_000),
  evidence: z.array(evidenceSchema).max(50).default([]),
  unresolved: z.array(z.string().trim().min(1)).max(30).default([]),
});

const reviewSchema = z.object({
  status: z.enum(["accept", "partial", "revise"]),
  gaps: z.array(z.string().trim().min(1)).max(20).default([]),
  replacementTasks: z.array(taskSchema).max(6).default([]),
});

function normalizeReviewDecision(decision, taskResults = []) {
  const allTasksComplete =
    taskResults.length > 0 &&
    taskResults.every(
      (result) =>
        result.status === "completed" &&
        (!Array.isArray(result.unresolved) || result.unresolved.length === 0)
    );
  if (
    decision?.status === "partial" &&
    (!Array.isArray(decision.gaps) || decision.gaps.length === 0) &&
    allTasksComplete
  )
    return { ...decision, status: "accept" };
  return decision;
}

function mergeById(current = [], updates = []) {
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const item of updates || []) merged.set(item.id, item);
  return [...merged.values()];
}

function resolvedTaskDependencies(taskItem, resultsById) {
  const dependencies = taskItem.dependsOn.map((id) => resultsById.get(id));
  return dependencies.every(Boolean) ? dependencies : null;
}

function blockedTaskResults(tasks = [], taskResults = []) {
  const results = new Map(taskResults.map((item) => [item.id, item]));
  const skipped = [];
  let foundBlockedTask = true;
  while (foundBlockedTask) {
    foundBlockedTask = false;
    for (const taskItem of tasks) {
      if (results.has(taskItem.id)) continue;
      const dependencies = resolvedTaskDependencies(taskItem, results);
      if (!dependencies) continue;
      const failed = dependencies.filter((item) => item.status !== "completed");
      if (!failed.length || taskItem.acceptsPartialDependencies) continue;
      const result = {
        id: taskItem.id,
        status: "skipped",
        summary: "前置任务没有完成，已跳过这一步。",
        unresolved: failed.map((item) => item.error || item.summary),
        evidence: [],
      };
      skipped.push(result);
      results.set(taskItem.id, result);
      foundBlockedTask = true;
    }
  }
  return skipped;
}

function taskCanDispatch(taskItem, resultsById) {
  const dependencies = resolvedTaskDependencies(taskItem, resultsById);
  if (!dependencies) return false;
  return (
    taskItem.acceptsPartialDependencies ||
    dependencies.every((item) => item.status === "completed")
  );
}

function normalizedActionToolId(taskItem = {}) {
  const objective = String(taskItem?.objective || "");
  const match = objective.match(
    /^Use ([a-z0-9._-]+) to complete this request:/i
  );
  const localizedMatch = objective.match(/^使用 ([a-z0-9._-]+) 完成此请求：/i);
  const toolId = normalizeToolId(match?.[1] || localizedMatch?.[1] || null);
  const allowedToolIds = taskItem?.allowedToolIds || [];
  return toolId &&
    (allowedToolIds.length === 0 || allowedToolIds.includes(toolId))
    ? toolId
    : null;
}

function taskRequiredCompletionTools(
  run,
  allowedToolIds = [],
  taskItem = null
) {
  const requiredToolIds =
    run.runtimeSnapshot?.runtimeConfig?.requiredCompletionTools || [];
  const normalizedToolId = normalizedActionToolId(taskItem);
  return [
    ...new Set([
      ...requiredToolIds.filter((toolId) => allowedToolIds.includes(toolId)),
      ...(normalizedToolId ? [normalizedToolId] : []),
    ]),
  ];
}

function toolExecutionEvidence(executions = [], requiredToolIds = []) {
  const required = new Set(requiredToolIds);
  return executions
    .filter(
      (item) =>
        required.has(item.tool_id) &&
        item.status === "completed" &&
        item.result?.ok !== false
    )
    .flatMap((item) => {
      if (
        item.tool_id === "knowledge.search" &&
        Array.isArray(item.result?.data)
      )
        return item.result.data.slice(0, 12).map((entry, index) => ({
          kind: "rag",
          title:
            entry?.source?.title ||
            entry?.source?.name ||
            `Workspace 搜索结果 ${index + 1}`,
          uri: entry?.source?.url || entry?.source?.chunkSource || null,
          excerpt: String(entry?.text || entry?.source?.text || "").slice(
            0,
            8_000
          ),
          metadata: {
            toolId: item.tool_id,
            query: item.arguments?.query || null,
            ...(entry?.source || {}),
          },
        }));
      if (item.tool_id === "web.search" && Array.isArray(item.result?.data))
        return item.result.data.slice(0, 12).map((entry, index) => ({
          kind: "web",
          title: entry?.title || `在线搜索结果 ${index + 1}`,
          uri: entry?.url || null,
          excerpt: String(
            entry?.snippet || entry?.text || entry?.title || ""
          ).slice(0, 8_000),
          metadata: {
            toolId: item.tool_id,
            query: item.arguments?.query || null,
          },
        }));
      const excerpt = String(
        item.result?.summary ||
          item.result_summary ||
          "Tool completed successfully."
      ).slice(0, 8_000);
      return excerpt
        ? [
            {
              kind: "tool",
              title: `${item.tool_id} 结果`,
              uri: null,
              excerpt,
              metadata: { toolId: item.tool_id },
            },
          ]
        : [];
    });
}

function claimSaysToolDidNotRun(value = "") {
  return /(?:no\s+[^.\n]*tool call|tool\s+(?:was|has)\s+not\s+(?:been\s+)?executed|never\s+(?:actually\s+)?executed|not\s+executed|未[^。\n]{0,20}(?:执行|调用)|从未[^。\n]{0,20}(?:发起|执行|调用)|没有[^。\n]{0,20}工具(?:调用|输出)|工具调用[^。\n]{0,12}(?:被)?跳过|均[^。\n]{0,40}(?:失败|未返回)|未返回任何[^。\n]{0,30}(?:数据|结果))/i.test(
    String(value)
  );
}

function toolExecutionHasUsableResult(execution = {}) {
  const data = execution.result?.data;
  if (Array.isArray(data)) return data.length > 0;
  if (typeof data === "string")
    return !["", "[]", "{}", "null"].includes(data.trim().toLowerCase());
  if (data && typeof data === "object") return Object.keys(data).length > 0;
  const summary = String(
    execution.result?.summary || execution.result_summary || ""
  )
    .trim()
    .toLowerCase();
  return !["", "[]", "{}", "null"].includes(summary);
}

function claimSaysNoToolResults(value = "") {
  return /(?:no\s+(?:usable\s+)?(?:results?|data|documents?|files?)\s+(?:were\s+)?(?:found|returned|retrieved)|(?:没有|未)(?:成功)?(?:检索|搜索|查找|读取|获得|获取|返回)(?:到)?[^。\n]{0,50}(?:结果|报告|资料|数据|全文|文件|文档|TDoc))/i.test(
    String(value)
  );
}

function groundWorkerResultInToolExecutions(
  parsed,
  taskItem,
  requiredToolIds,
  executions = []
) {
  if (!parsed) return parsed;
  const completedExecutions = executions.filter(
    (item) => item.status === "completed" && item.result?.ok !== false
  );
  if (!completedExecutions.length) return parsed;
  const relevantCompletedExecutions = requiredToolIds.length
    ? completedExecutions.filter((item) =>
        requiredToolIds.includes(item.tool_id)
      )
    : completedExecutions;
  const contradictsNoResultClaim = (value) =>
    claimSaysNoToolResults(value) &&
    relevantCompletedExecutions.some(toolExecutionHasUsableResult);
  const contradictsDurableExecutions =
    claimSaysToolDidNotRun(parsed.summary) ||
    contradictsNoResultClaim(parsed.summary) ||
    (parsed.unresolved || []).some(
      (item) => claimSaysToolDidNotRun(item) || contradictsNoResultClaim(item)
    );
  const evidenceToolIds = requiredToolIds.length
    ? requiredToolIds
    : contradictsDurableExecutions
      ? [...new Set(completedExecutions.map((item) => item.tool_id))]
      : [];
  if (!evidenceToolIds.length) return parsed;
  const completed = completedExecutions.filter((item) =>
    evidenceToolIds.includes(item.tool_id)
  );
  if (!completed.length) return parsed;
  const durableEvidence = toolExecutionEvidence(
    executions,
    evidenceToolIds
  ).slice(-12);
  const evidence = [...(parsed.evidence || [])];
  const seen = new Set(
    evidence.map((item) =>
      [item.kind, item.uri || "", item.title, item.excerpt].join("\u0000")
    )
  );
  for (const item of durableEvidence) {
    const key = [item.kind, item.uri || "", item.title, item.excerpt].join(
      "\u0000"
    );
    if (!seen.has(key)) evidence.push(item);
    seen.add(key);
  }
  const completedIds = [...new Set(completed.map((item) => item.tool_id))];
  const resultCount = durableEvidence.length;
  return {
    ...parsed,
    summary: contradictsDurableExecutions
      ? `已成功执行 ${completedIds.join(", ")}，共 ${completed.length} 次完成调用${resultCount ? `，并获得 ${resultCount} 条可用结果` : ""}。请以以下实际工具结果为准。`
      : parsed.summary,
    evidence,
    unresolved: (parsed.unresolved || []).filter(
      (item) => !claimSaysToolDidNotRun(item) && !contradictsNoResultClaim(item)
    ),
  };
}

async function streamControllerDecision(
  model,
  messages,
  { onToken, streamOptions }
) {
  let combined = null;
  let directText = "";
  const stream = await model.stream(messages, streamOptions);
  for await (const chunk of stream) {
    combined = combined ? combined.concat(chunk) : chunk;
    const token = contentText(chunk.content);
    if (token) directText += token;
  }
  const calls = combined?.tool_calls || [];
  // Providers may emit a natural-language preamble before the first tool-call
  // chunk. Do not expose that unfinished controller text when the completed
  // response is a control action such as create_plan or activate_skill.
  const streamedDirect = calls.length === 0 && directText.length > 0;
  if (streamedDirect) await onToken(directText);
  return {
    message: combined,
    calls,
    response: contentText(combined?.content) || directText,
    streamedDirect,
  };
}

async function controllerDecisionWithFallback({
  primaryModel,
  createFallbackModel,
  messages,
  onToken,
  emit,
  primaryStreamOptions,
  fallbackStreamOptions,
}) {
  let decision = await streamControllerDecision(primaryModel, messages, {
    onToken,
    streamOptions: primaryStreamOptions,
  });
  if (decision.calls.length || decision.response.trim()) return decision;
  await emit("model.fallback", {
    role: "controller",
    reason: "empty_visible_response",
    thinking: false,
  });
  await emit("activity.updated", {
    phase: "planning",
    summary: "Retrying with a standard visible response",
    summaryKey: "retrying_visible_response",
  });
  return streamControllerDecision(createFallbackModel(), messages, {
    onToken,
    streamOptions: fallbackStreamOptions,
  });
}

const GovernedState = Annotation.Root({
  request: Annotation({ default: () => "" }),
  history: Annotation({ default: () => [] }),
  attachments: Annotation({ default: () => [] }),
  controllerAttachments: Annotation({ default: () => [] }),
  clarification: Annotation({ default: () => "" }),
  contextItems: Annotation({ reducer: mergeById, default: () => [] }),
  activatedSkills: Annotation({
    reducer: mergeActivatedSkills,
    default: () => [],
  }),
  planningFeedback: Annotation({ default: () => "" }),
  planningAttempts: Annotation({ default: () => 0 }),
  control: Annotation({ default: () => null }),
  plan: Annotation({ default: () => null }),
  workItem: Annotation({ default: () => null }),
  taskResults: Annotation({ reducer: mergeById, default: () => [] }),
  evidence: Annotation({ reducer: mergeById, default: () => [] }),
  review: Annotation({ default: () => null }),
  reviewRound: Annotation({ default: () => 0 }),
  finalResponse: Annotation({ default: () => "" }),
  sources: Annotation({ default: () => [] }),
});

function scopedTaskId(runId, value) {
  const clean = String(value || "task")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${runId}:${clean || "task"}`;
}

function requestAllowsWrite(request = "") {
  return /\b(?:write|edit|delete|remove|create|save|store|upload|download|generate|export|convert|split|extract|send|execute|run|modify|ingest|embed|index|add)\b|(?:写入|编辑|删除|创建|保存|存储|上传|下载|生成|输出|导出|转换|拆分|提取|发送|执行|修改|加入|导入|入库|嵌入|索引)/i.test(
    String(request)
  );
}

function isKnowledgeIngestionRequest(request = "") {
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
  { autoRecall = true, userId = null } = {}
) {
  return Boolean(
    autoRecall !== false && userId && !isKnowledgeIngestionRequest(request)
  );
}

function knowledgeToolGuidance(visibleToolIds = new Set()) {
  const visible = new Set(visibleToolIds);
  const operations = [
    ["knowledge.ingest", "adds regular document files"],
    ["knowledge.search", "retrieves already indexed passages"],
    ["knowledge.publish", "embeds one final Markdown report"],
  ]
    .filter(([toolId]) => visible.has(toolId))
    .map(([toolId, purpose]) => `${toolId} ${purpose}`);
  return operations.length
    ? `Workspace knowledge is the RAG knowledge base: ${operations.join("; ")}. Personal memory is only for user facts and preferences; document ingestion always belongs to Workspace RAG.`
    : "Workspace knowledge is the RAG knowledge base. Personal memory is only for user facts and preferences; document ingestion always belongs to Workspace RAG.";
}

function shouldRetrieveWorkspaceContext(
  request = "",
  { autoRecall = true, mode = null } = {}
) {
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
  return autoRecall !== false || ["query", "chat"].includes(mode);
}

function classify3gppRequest(request = "") {
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

function parse3gppMeetingRequest(request = "") {
  const match = String(request).match(/\b(SA[1235]|CT[14])\s*#?\s*(\d+)\b/i);
  if (!match) return null;
  return { group: match[1].toUpperCase(), meetingNumber: Number(match[2]) };
}

function parse3gppConversionRequest(request = "", attachments = []) {
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
    .filter((relative) => relative && relative.toLowerCase().endsWith(".docx"))
    .map((relative) => `/workspace/${relative}`);
  if (tdocs.length === 1 && uploads.length === 0) return { tdoc: tdocs[0] };
  if (uploads.length === 1 && tdocs.length === 0)
    return { input_path: uploads[0] };
  return null;
}

function is3gppMarkdownConversionAgent(agent = {}) {
  return agent.runtimeConfig?.workflow === "3gpp-markdown-conversion";
}

function parse3gppInvitationFacts(text = "") {
  const value = String(text);
  const date = value.match(
    /from\s+\w+\s+(\d{1,2})\s+to\s+\w+\s+(\d{1,2})\s+of\s+([A-Za-z]+)\s+(\d{4})/i
  );
  const place = value.match(/\bin\s+([A-Za-z]+),\s*([A-Za-z]+)\b/i);
  if (!date && !place) return null;
  const months = {
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

function quick3gppResponse({ meeting, data }) {
  const candidate = data?.candidates?.[0] || null;
  const details = data?.officialDetails || null;
  const facts = parse3gppInvitationFacts(details?.invitationText);
  const label = `${meeting.group}#${meeting.meetingNumber}`;
  if (facts?.year && facts?.month && facts?.startDay && facts?.endDay) {
    const countryNames = { china: "中国" };
    const cityNames = {
      athens: "雅典",
      dalian: "大连",
      gothenburg: "哥德堡",
      paris: "巴黎",
    };
    const country = facts.country
      ? countryNames[facts.country.toLowerCase()] || facts.country
      : "";
    const city = cityNames[facts.city?.toLowerCase()] || facts.city || "";
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
}) {
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
  const invoke = async (toolId, args, suffix) => {
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
}) {
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
  const invoke = async (toolId, toolArgs, suffix, traceName) => {
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
  // A resumed graph may reuse the stored skill.activate result without running
  // its in-memory side effect again. Restore that state before conversion.
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
  const warnings = Array.isArray(data.warnings) ? data.warnings : [];
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

function normalized3gppLookupPlan(request, allowedToolIds) {
  const tools = (ids) => ids.filter((id) => allowedToolIds.has(id));
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

function isQuick3gppLookupTask(taskItem = {}) {
  const allowedToolIds = taskItem.allowedToolIds || [];
  const quickLookupTools = new Set(["3gpp.resolve-meeting", "web.fetch"]);
  return (
    taskItem.writeIntent !== true &&
    allowedToolIds.includes("3gpp.resolve-meeting") &&
    allowedToolIds.every((toolId) => quickLookupTools.has(toolId))
  );
}

function workerContinuationInstruction({
  reasons = [],
  missingToolIds = [],
  completedToolIds = [],
  writeEnabled = false,
}) {
  if (!missingToolIds.length)
    return `${reasons.join(" ")} The task evidence and tool work are already complete. Do not call any tool again and do not repeat discovery. Return exactly one JSON object with summary, evidence, and unresolved, using only the results already present in this conversation.`;
  const completionGuidance = writeEnabled
    ? "Locate the existing draft or write the requested artifact now in filesystem.write chunks no larger than 3,000 characters, using append=true after the first chunk. Read it back to verify it, then execute every missing completion tool."
    : "This is a read-only task. Do not create, update, or publish a report, ledger, manifest, Markdown file, or any other artifact. Use the available results and read tools only, then return the analysis in the worker JSON result.";
  return `${reasons.join(" ")} Continue the same task now. Reuse the already downloaded, extracted, and analyzed workspace artifacts; do not restart meeting discovery or document analysis unless a specific required artifact is missing. ${completionGuidance} Return exactly one JSON object with summary, evidence, and unresolved. Completed tool IDs so far: ${completedToolIds.join(", ") || "none"}.`;
}

function priorToolResultsContext(executions = [], maxChars = 12_000) {
  const completed = executions.filter(
    (item) => item.status === "completed" && item.result?.ok !== false
  );
  if (!completed.length) return "";

  const unique = new Map();
  for (const execution of completed) {
    const key =
      execution.operation_key || execution.operationKey || execution.id;
    unique.set(key, execution);
  }

  const entries = [];
  let remaining = Math.max(1_000, Number(maxChars) || 12_000);
  for (const execution of [...unique.values()].reverse()) {
    const result = execution.result || {};
    const value = String(result.data ?? result.summary ?? "").trim();
    if (!value) continue;
    const entry = `- ${execution.tool_id || execution.toolId} (${result.code || "OK"})\n${value}`;
    if (entry.length > remaining && entries.length) break;
    entries.push(entry.slice(0, remaining));
    remaining -= Math.min(entry.length, remaining);
    if (remaining <= 0) break;
  }
  if (!entries.length) return "";

  return `\n\nA previous worker made useful progress before repeating an operation. Continue from the successful tool results below. Treat them as completed work, do not run the same command again, and move directly to the next unmet success criterion.\n\n${entries.reverse().join("\n\n")}`;
}

function shouldRetryNoProgressTask({
  error,
  attempt,
  maxAttempts,
  executions = [],
}) {
  return Boolean(
    error?.code === "TASK_NO_PROGRESS" &&
      attempt < maxAttempts &&
      executions.some(
        (item) => item.status === "completed" && item.result?.ok !== false
      )
  );
}

function workerSystemPrompt({
  basePrompt,
  userRequest = "",
  taskItem,
  allowedToolIds,
  requiredToolIds,
  dependencyResults,
  activatedSkillContext = "",
  priorToolResults = "",
}) {
  const writeEnabled =
    taskItem.writeIntent === true && taskHasWriteTool(allowedToolIds);
  const artifactGuidance = writeEnabled
    ? "This task may write the requested artifact. Write long files incrementally: create the file with a first filesystem.write call of at most 3,000 characters, append each remaining section with append=true in chunks of at most 3,000 characters, and read the completed file back before publishing it. Do not place a complete long report in one tool argument."
    : "This is a read-only task. Return the completed analysis in the final worker JSON object. Do not create, update, save, or publish a report, ledger, manifest, Markdown file, or any other artifact. If the objective uses words such as complete a ledger or report, interpret that as completing the analysis fields in your JSON result, not modifying a file.";
  return `${basePrompt}${activatedSkillContext ? `\n\n${activatedSkillContext}` : ""}\n\nYou are a bounded worker in a governed task graph. Complete only the assigned task. The relevant Skills were activated before planning and their complete instructions are included above. Follow them without calling activate_skill again. Use only allowed tools. The required completion tools for this task are: ${requiredToolIds.join(", ") || "none"}. When that list is none, do not publish, search for a publication tool, or try to satisfy the Agent's run-level publication rule; publication belongs only to a task whose allowed tool list explicitly includes that publication tool. Do not write the final user response. Stop after the success criteria and every required completion tool are satisfied, or when progress is genuinely blocked. Never end with future intent such as “I will create or publish the report.” ${artifactGuidance} Reuse existing workspace artifacts instead of repeating discovery, downloads, extraction, or visual analysis. Reuse the exact workspace paths returned in dependency results and tool outputs. Never reconstruct a directory from only a filename; when an exact path is unavailable, resolve it with filesystem.search or filesystem.list before reading. For Skill resources, use only exact paths from the activated Skill file lists above; never probe guessed directory or extension variants. If the original request asks to list items or fields and this task creates or reads that dataset, include every requested row and field in the summary; a count or file path alone is not sufficient. Use a compact table when the list is long. If one source or directory applies to many rows, state it once outside the table instead of repeating the same long URL or path in every row. Never omit a requested row or field merely to stay concise. Return one JSON object with summary, evidence, and unresolved. Evidence entries require kind, title, uri, excerpt, and metadata. Never invent sources.\n\nOriginal user request: ${userRequest}\n\nTask: ${taskItem.title}\nObjective: ${taskItem.objective}\nSuccess criteria: ${taskItem.successCriteria.join("; ") || "Satisfy the objective"}\nDependency results: ${JSON.stringify(dependencyResults)}${priorToolResults}`;
}

function workerResultFromPlainText(resultState, missingToolIds = []) {
  if (missingToolIds.length) return null;
  const summary = finalText(resultState).trim();
  if (!summary) return null;
  return { summary, evidence: [], unresolved: [] };
}

function normalized3gppReviewPlan(request, _requestedName, allowedToolIds) {
  const tools = (ids) => ids.filter((id) => allowedToolIds.has(id));
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

function normalizedActionPlan({ descriptor, args = {}, request }) {
  if (descriptor.id === "skill.activate")
    throw new Error(
      "Skill activation is a pre-planning controller action and cannot be normalized into a plan."
    );
  const allowedToolIds = new Set([descriptor.id]);
  const objective = `使用 ${descriptor.id} 完成此请求：${request}\n\n控制器建议参数：\n${JSON.stringify(args)}`;
  const successCriteria = ["记录工具结果，并说明实际发生的执行错误。"];

  return {
    goal: `使用 ${descriptor.name} 完成请求`,
    tasks: [
      {
        id: `${descriptor.id}-request`,
        title: `使用 ${descriptor.name} 完成请求`,
        objective,
        dependsOn: [],
        allowedToolIds: [...allowedToolIds],
        requiredCapabilities: descriptor.capabilities || [],
        successCriteria,
        acceptsPartialDependencies: false,
        writeIntent: descriptor.effect !== "read",
      },
    ],
  };
}

function normalizeControllerAction(call, descriptors = [], request = "") {
  const requestedAction = String(call?.name || "").trim();
  const normalizedAction = normalizeToolId(requestedAction);
  const descriptor = descriptors.find(
    (candidate) =>
      normalizeToolId(candidate.id) === normalizedAction ||
      candidate.name === requestedAction
  );
  if (!descriptor) return null;
  return {
    descriptor,
    plan: normalizedActionPlan({
      descriptor,
      args: call?.args,
      request,
    }),
  };
}

const DELEGATED_FALLBACK_WRITE_TOOLS = new Set([
  "bash",
  "python",
  "filesystem.write",
]);

function delegatedControllerActionPlan({
  call,
  descriptor,
  descriptors = [],
  request = "",
  hasAvailableAgents = false,
  agentTools = null,
}) {
  const writeIntent = requestAllowsWrite(request);
  const allowedToolIds = descriptors
    .filter((candidate) => candidate.id !== "skill.activate")
    .filter(
      (candidate) =>
        candidate.effect === "read" ||
        (writeIntent &&
          (DELEGATED_FALLBACK_WRITE_TOOLS.has(candidate.id) ||
            candidate.id === descriptor.id))
    )
    .map((candidate) => candidate.id);
  const configuredTools = Array.isArray(agentTools)
    ? new Set(agentTools)
    : agentTools;
  if (
    hasAvailableAgents &&
    legacySelectionAllows(configuredTools, {
      id: "agent.call",
      name: "call_agent",
    })
  )
    allowedToolIds.push("agent.call");

  return {
    goal: `完成用户请求：${request}`,
    tasks: [
      {
        id: "complete-request-with-inherited-tools",
        title: "执行并验证用户请求",
        objective: [
          `完整执行用户请求：${request}`,
          `控制器曾尝试调用 ${descriptor.id}，参数为 ${JSON.stringify(call?.args || {})}。这只是一条定位线索，不是任务的完成条件。`,
          "请自行选择已继承的工具或合适的专用 Agent，继续执行到用户要求的结果实际生成并完成验证。",
        ].join("\n\n"),
        dependsOn: [],
        allowedToolIds: [...new Set(allowedToolIds)],
        requiredCapabilities: [],
        successCriteria: [
          "完成用户的完整请求，而不是只返回初始搜索结果。",
          "检查生成或修改的结果是否真实存在且可读取。",
          "保留实际工具错误和仍未解决的问题。",
        ],
        acceptsPartialDependencies: false,
        writeIntent,
      },
    ],
  };
}

function skillToolRestrictionsEnabled(run = {}) {
  return (
    run?.policySnapshot?.enforceSkillToolRestrictions === true ||
    run?.configuration?.enforceSkillToolRestrictions === true
  );
}

function activatedSkillToolIds(skills = [], enforceRestrictions = false) {
  if (!enforceRestrictions || !skills.length) return null;
  return new Set(
    skills.flatMap((skill) =>
      skillAllowedToolIds(skill).map((toolId) => normalizeToolId(toolId))
    )
  );
}

function descriptorsForActivatedSkills(
  descriptors = [],
  skills = [],
  enforceRestrictions = false
) {
  const allowed = activatedSkillToolIds(skills, enforceRestrictions);
  if (!allowed) return descriptors;
  return descriptors.filter((descriptor) => allowed.has(descriptor.id));
}

function effectiveTaskToolIds(
  requestedToolIds = [],
  workerAgent = {},
  activatedSkills = [],
  enforceRestrictions = false
) {
  const configuredTools = Array.isArray(workerAgent?.tools)
    ? new Set(workerAgent.tools)
    : null;
  const skillTools = activatedSkillToolIds(
    activatedSkills,
    enforceRestrictions
  );
  return [...new Set(requestedToolIds.map(normalizeToolId))].filter(
    (toolId) => {
      if (toolId === "skill.activate") return false;
      if (skillTools && !skillTools.has(toolId)) return false;
      if (toolId === "agent.call")
        return legacySelectionAllows(configuredTools, {
          id: "agent.call",
          name: "call_agent",
        });
      const descriptor = toolRegistry.get(toolId);
      if (!descriptor) return false;
      if (descriptor.id.startsWith("skill.")) return true;
      return legacySelectionAllows(configuredTools, descriptor);
    }
  );
}

function validatePlan(
  rawPlan,
  { run, agent, availableAgents = [], activatedSkills = [] }
) {
  const parsed = planSchema.parse(rawPlan);
  const knownAgents = new Set([
    Number(agent.id),
    ...availableAgents.map((item) => Number(item.id)),
  ]);
  const registryIds = new Set(toolRegistry.list().map((item) => item.id));
  registryIds.add("agent.call");
  const configuredTools = Array.isArray(agent.tools)
    ? new Set(agent.tools)
    : null;
  const activeSkillTools = activatedSkillToolIds(
    activatedSkills,
    skillToolRestrictionsEnabled(run)
  );
  const localToScoped = new Map(
    parsed.tasks.map((task) => [task.id, scopedTaskId(run.id, task.id)])
  );
  if (localToScoped.size !== parsed.tasks.length)
    throw new Error("Plan contains duplicate task IDs.");
  const allowWrites = requestAllowsWrite(run.prompt);
  const tasks = parsed.tasks.map((task) => {
    if (task.assignedAgentId && !knownAgents.has(Number(task.assignedAgentId)))
      throw new Error(`Task ${task.id} selected an unavailable Agent.`);
    for (const dependency of task.dependsOn) {
      if (!localToScoped.has(dependency))
        throw new Error(`Task ${task.id} has an unknown dependency.`);
    }
    const normalizedAllowedToolIds = [
      ...new Set(task.allowedToolIds.map(normalizeToolId)),
    ];
    const publishDescriptor = toolRegistry.get("knowledge.publish");
    const shouldAddPublishTool = Boolean(
      allowWrites &&
        taskRequestsKnowledgePublish(task) &&
        publishDescriptor &&
        legacySelectionAllows(configuredTools, publishDescriptor)
    );
    if (
      shouldAddPublishTool &&
      !normalizedAllowedToolIds.includes(publishDescriptor.id)
    )
      normalizedAllowedToolIds.push(publishDescriptor.id);
    for (const toolId of normalizedAllowedToolIds) {
      if (toolId === "skill.activate")
        throw new Error(
          "Skill activation must complete before create_plan and cannot be a plan task."
        );
      if (activeSkillTools && !activeSkillTools.has(toolId))
        throw new Error(
          `Task ${task.id} selected tool ${toolId}, which is not declared by the activated Skills.`
        );
      if (!registryIds.has(toolId))
        throw new Error(`Task ${task.id} selected unknown tool ${toolId}.`);
      const descriptor =
        toolId === "agent.call"
          ? { id: "agent.call", name: "call_agent" }
          : toolRegistry.get(toolId);
      if (
        !descriptor.id.startsWith("skill.") &&
        !legacySelectionAllows(configuredTools, descriptor)
      )
        throw new Error(`Task ${task.id} selected disallowed tool ${toolId}.`);
    }
    const hasWriteTool = taskHasWriteTool(normalizedAllowedToolIds);
    const requestsArtifactWrite = Boolean(
      allowWrites && taskRequestsArtifactWrite(task)
    );
    const effectiveWriteIntent = Boolean(
      (task.writeIntent ||
        shouldAddPublishTool ||
        (requestsArtifactWrite && hasWriteTool)) &&
        allowWrites
    );
    if (effectiveWriteIntent && !hasWriteTool)
      throw new Error(
        `Task ${task.id} declares writeIntent but has no write-capable tool.`
      );
    if (requestsArtifactWrite && (!effectiveWriteIntent || !hasWriteTool))
      throw new Error(
        `Task ${task.id} requires an artifact write but its writeIntent or allowed tools are read-only.`
      );
    if (
      /\b(?:final answer|synthesi[sz]e|respond to (?:the )?user)\b/i.test(
        task.objective
      )
    )
      throw new Error("Final answer synthesis cannot be a worker task.");
    return {
      ...task,
      allowedToolIds: normalizedAllowedToolIds,
      id: localToScoped.get(task.id),
      dependsOn: task.dependsOn.map((id) => localToScoped.get(id)),
      assignedAgentId: task.assignedAgentId || null,
      writeIntent: effectiveWriteIntent,
      budget: {
        maxToolCalls: DEFAULTS.maxTaskToolCalls,
        maxModelCalls: DEFAULTS.maxTaskModelCalls,
        maxElapsedMs: DEFAULTS.maxTaskMs,
      },
    };
  });

  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visit = (id) => {
    if (visiting.has(id)) throw new Error("Plan contains a dependency cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn || []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
  return { goal: parsed.goal, tasks };
}

function planValidationRetry(error, planningAttempts = 0) {
  if (planningAttempts >= 1) return null;
  return {
    control: { kind: "retry_planning" },
    planningFeedback: String(error?.message || error),
    planningAttempts: planningAttempts + 1,
  };
}

function roleModel(run, role) {
  return (
    run.runtimeSnapshot?.roleModels?.[role] ||
    run.runtimeSnapshot?.selectedModel ||
    null
  );
}

function modelMessages(system, state, userText, attachments = []) {
  return [
    { role: "system", content: system },
    ...(state.history || []),
    { role: "user", content: userContent(userText, attachments) },
  ];
}

function planTool() {
  return tool(async () => "Plan accepted.", {
    name: "create_plan",
    description:
      "Create a bounded dependency-aware plan when the request needs tools, multiple independent tasks, delegated Agents, or verification.",
    schema: planSchema,
  });
}

function askUserTool() {
  return tool(async () => "Input requested.", {
    name: "ask_user",
    description:
      "Pause and ask the user only when a missing answer would materially change the work. Provide exactly three concise, mutually exclusive choices with the recommended choice first. Do not add an Other or custom choice; the client adds a fourth Custom answer option and lets the user leave notes.",
    schema: z.object({
      question: z.string().trim().min(1).max(1_000),
      choices: z
        .array(z.string().trim().min(1).max(240))
        .length(3)
        .describe(
          "Exactly three mutually exclusive choices, recommended choice first."
        ),
    }),
  });
}

function activateSkillControlTool(skills = []) {
  const names = skills.map((skill) => skill.name);
  return tool(async () => "Skill selection accepted.", {
    name: "activate_skill",
    description: `Activate one relevant Skill before planning so its complete instructions are available. Use the exact name from this list: ${names.join(", ") || "none"}. Never represent Skill activation as a plan task.`,
    schema: z.object({
      name: z
        .string()
        .trim()
        .min(1)
        .refine((name) => names.includes(name), {
          message: "Select an available Skill by its exact name.",
        }),
    }),
  });
}

async function activateSkillBeforePlanning({
  name,
  skills,
  run,
  workspace,
  user,
  agent,
  emit,
  signal,
  budget,
  visibleToolIds,
  activatedSkillScope = null,
}) {
  const selected = skills.find((skill) => skill.name === name);
  if (!selected) throw new Error(`Skill "${name}" is not available.`);
  const context = new AgentToolContext({
    run,
    workspace,
    user,
    agent,
    emit,
    signal,
    approvalMode: "always_allow",
    budget,
    maxLocalToolCalls: 1,
    taskId: null,
    taskTitle: null,
    visibleToolIds,
    activatedSkillScope,
  });
  const descriptor = toolRegistry.get("skill.activate");
  const result = JSON.parse(
    await toLangChainTool(descriptor, context).func({ name }, undefined, {
      toolCall: {
        id: `${run.id}:preplan:activate:${name}:${selected.revision}`,
      },
    })
  );
  if (!result?.ok)
    throw new Error(result?.summary || `Unable to activate Skill "${name}".`);
  const activated = context.activatedSkill(name) || selected;
  context.activateSkill(activated);
  return activatedSkillSnapshot(activated);
}

async function invokeStructured({
  run,
  workspace,
  role,
  schema,
  name,
  system,
  user,
  runnableConfig,
}) {
  const model = createChatModel({
    workspace,
    model: roleModel(run, role),
    temperature: 0,
    thinking: run.configuration?.thinking !== false,
  });
  const config = {
    ...childRunnableConfig(runnableConfig, {
      tags: ["governed-agent", `role:${role}`],
      metadata: { role },
    }),
    runName: name,
  };
  try {
    return await model.withStructuredOutput(schema, { name }).invoke(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      config
    );
  } catch {
    const response = await model.invoke(
      [
        {
          role: "system",
          content: `${system}\nReturn only JSON matching: ${JSON.stringify(z.toJSONSchema(schema))}`,
        },
        { role: "user", content: user },
      ],
      config
    );
    return schema.parse(parseJsonObject(contentText(response.content)));
  }
}

function contextPrompt(items = []) {
  if (!items.length) return "";
  return `\n\n<context_evidence>\n${items
    .map(
      (item, index) =>
        `[C${index + 1}] ${item.title}\n${item.text || item.excerpt || ""}`
    )
    .join("\n\n")}\n</context_evidence>`;
}

function usedContextSources(text, items = []) {
  const used = new Set(
    [...String(text).matchAll(/\[C(\d+)\]/g)].map(
      (match) => Number(match[1]) - 1
    )
  );
  return [...used].map((index) => items[index]?.source).filter(Boolean);
}

async function createGovernedGraph(context) {
  const {
    run,
    workspace,
    user,
    thread,
    agent,
    emit,
    signal,
    runnableConfig,
    onToken,
  } = context;
  const basePrompt =
    run.runtimeSnapshot?.systemPrompt || agent.systemPrompt || "";
  const sharedBudget = context.budget || {
    calls: 0,
    subagentCalls: 0,
    actionTail: Promise.resolve(),
    operationCounts: new Map(),
  };
  if (!sharedBudget.activatedSkills) sharedBudget.activatedSkills = new Map();
  const activatedSkillScope =
    context.activatedSkillScope || sharedBudget.activatedSkills;

  const prepareContext = async (state) => {
    if (is3gppMarkdownConversionAgent(agent)) {
      await emit("activity.updated", {
        phase: "context",
        summaryKey: "preparing",
      });
      await emit("context.used", { taskId: null, items: [] });
      return { contextItems: [], controllerAttachments: [] };
    }
    const recallMemory = shouldRecallPersonalMemory(state.request, {
      autoRecall: run.configuration?.autoRecall,
      userId: user?.id,
    });
    const recallWorkspace = shouldRetrieveWorkspaceContext(state.request, {
      autoRecall: run.configuration?.autoRecall,
      mode: run.mode,
    });
    const summaryKey = recallMemory
      ? recallWorkspace
        ? "recalling_workspace_and_memory"
        : "recalling_memory"
      : recallWorkspace
        ? "recalling_workspace"
        : "preparing";
    await emit("activity.updated", {
      phase: "context",
      summaryKey,
    });
    const items = [];
    if (recallMemory) {
      const [global, workspaceMemories] = await Promise.all([
        Memory.globalForUser(user.id),
        Memory.forUserWorkspace(user.id, workspace.id),
      ]).catch(() => [[], []]);
      const memories = [...global, ...workspaceMemories].slice(0, 30);
      if (memories.length) {
        await Memory.updateLastUsed(memories.map((item) => item.id));
        await emit("context.memory.recalled", {
          count: memories.length,
          memories: memories.map(({ id, scope }) => ({ id, scope })),
        });
        for (const memory of memories)
          items.push({
            id: `memory:${memory.id}`,
            kind: "memory",
            title: `${memory.scope === "global" ? "Global" : "Workspace"} memory`,
            text: String(memory.content || "").slice(0, 4_000),
            source: {
              id: `memory:${memory.id}`,
              url: `memory://${memory.scope}/${memory.id}`,
              title: "Recalled memory",
              text: String(memory.content || "").slice(0, 1_000),
              docSource: "memory",
            },
          });
      }
    }

    if (recallWorkspace) {
      try {
        const retrieved = await withRetrieverTrace(
          "retrieve-workspace-context",
          { query: state.request, workspaceId: workspace.id },
          () =>
            retrieveWorkspaceContext({
              workspace,
              user,
              thread,
              query: state.request,
            })
        );
        await emit("context.rag.recalled", {
          count: retrieved.length,
          sources: retrieved.map((item) => item.source).filter(Boolean),
        });
        retrieved.slice(0, 12).forEach((item, index) =>
          items.push({
            id: `rag:${index}:${crypto
              .createHash("sha1")
              .update(String(item.text || ""))
              .digest("hex")
              .slice(0, 12)}`,
            kind: "rag",
            title: item.source?.title || `Workspace source ${index + 1}`,
            text: String(item.text || "").slice(0, 12_000),
            source: item.source,
          })
        );
      } catch (error) {
        await emit("context.failed", { kind: "rag", error: error.message });
      }
    }
    let controllerAttachments = [];
    const imageAttachments = (state.attachments || []).filter(
      isImageAttachment
    );
    if (imageAttachments.length) {
      await ModelCapability.seedBuiltins();
      const provider = selectedProvider(workspace);
      const controllerModel = roleModel(run, "controller");
      const controllerCapability = controllerModel
        ? await ModelCapability.get(provider, controllerModel)
        : null;
      if (controllerCapability?.vision) {
        controllerAttachments = imageAttachments;
        await emit("model.routed", {
          role: "controller",
          model: controllerModel,
          capability: "vision",
          direct: true,
        });
      } else {
        const visionModel = roleModel(run, "vision");
        const visionCapability = visionModel
          ? await ModelCapability.get(provider, visionModel)
          : null;
        if (visionCapability?.vision) {
          await emit("activity.updated", {
            phase: "vision",
            summary: `Inspecting ${imageAttachments.length} visual attachment${imageAttachments.length === 1 ? "" : "s"}`,
          });
          const visionResponse = await createChatModel({
            workspace,
            model: visionModel,
            temperature: 0,
            thinking: false,
          }).invoke(
            [
              {
                role: "system",
                content:
                  "Analyze the supplied images for another Agent. Return concise factual observations, visible text, diagram relationships, and uncertainty. Do not answer the user's broader request.",
              },
              {
                role: "user",
                content: userContent(state.request, imageAttachments),
              },
            ],
            {
              ...childRunnableConfig(runnableConfig, {
                tags: ["governed-agent", "role:vision"],
                metadata: {
                  role: "vision",
                  attachmentCount: imageAttachments.length,
                },
              }),
              runName: "analyze-visual-attachments",
              signal,
            }
          );
          const analysis = contentText(visionResponse.content);
          if (analysis)
            items.push({
              id: `vision:${run.id}`,
              kind: "vision",
              title: "Visual attachment analysis",
              text: analysis,
              source: null,
            });
          await emit("model.routed", {
            role: "vision",
            model: visionModel,
            capability: "vision",
            direct: false,
          });
        } else {
          items.push({
            id: `vision-unavailable:${run.id}`,
            kind: "warning",
            title: "Visual attachments were not analyzed",
            text: "No explicitly vision-capable model is configured. Tell the user that visual content could not be inspected.",
            source: null,
          });
          await emit("model.capability_missing", {
            capability: "vision",
            controllerModel,
            visionModel,
          });
        }
      }
    }
    await emit("context.used", {
      taskId: null,
      items: items.map(({ id, kind, title }) => ({ id, kind, title })),
    });
    return { contextItems: items, controllerAttachments };
  };

  const controller = async (state) =>
    withAgentStepTrace(
      "govern-request",
      { input: { request: state.request }, metadata: { role: "controller" } },
      async () => {
        if (run.mode === "query" && !state.contextItems.length) {
          const response =
            workspace.queryRefusalResponse ||
            "There is no relevant information in this workspace to answer your query.";
          await onToken(response);
          return { control: { kind: "direct" }, finalResponse: response };
        }
        await emit("activity.updated", {
          phase: "planning",
          summary: `Determining the best approach for ${state.request.replace(/\s+/g, " ").slice(0, 120)}`,
          summaryKey: "determining_approach",
          summaryArgs: {
            request: state.request.replace(/\s+/g, " ").slice(0, 120),
          },
        });
        const conversionArgs = is3gppMarkdownConversionAgent(agent)
          ? parse3gppConversionRequest(state.request, run.attachments)
          : null;
        if (conversionArgs) {
          await emit("request.classified", {
            kind: "3gpp_markdown_conversion",
            execution: "deterministic",
          });
          const converted = await execute3gppMarkdownConversion({
            args: conversionArgs,
            run,
            workspace,
            user,
            agent,
            emit,
            signal,
            budget: sharedBudget,
            activatedSkillScope,
          });
          await onToken(converted.text);
          return {
            control: { kind: "direct", streamed: true },
            finalResponse: converted.text,
            sources: converted.sources,
            review: converted.partial ? { status: "partial" } : null,
          };
        }
        const agents = await agentListForPrompt(agent.id);
        const allControllerToolDescriptors = visibleToolDescriptorsForAgent(
          agent,
          {
            allowActions:
              !["query", "chat"].includes(run.mode) && run.source !== "embed",
          }
        );
        await restoreActivatedSkills(
          state.activatedSkills,
          workspace,
          activatedSkillScope
        );
        const controllerToolDescriptors = descriptorsForActivatedSkills(
          allControllerToolDescriptors,
          state.activatedSkills,
          skillToolRestrictionsEnabled(run)
        );
        const controllerVisibleToolIds = new Set(
          controllerToolDescriptors.map((descriptor) => descriptor.id)
        );
        const knowledgeGuidance = knowledgeToolGuidance(
          controllerVisibleToolIds
        );
        const skills = await availableSkills(agent, workspace);
        const activatedNames = new Set(
          state.activatedSkills.map((skill) => skill.name)
        );
        const selectableSkills = skills.filter(
          (skill) => !activatedNames.has(skill.name)
        );
        const currentSkillCatalog = await skillCatalogPrompt(
          agent,
          workspace,
          selectableSkills,
          {
            visibleToolIds: controllerVisibleToolIds,
            enforceAllowedTools: skillToolRestrictionsEnabled(run),
          }
        );
        const activatedSkillContext = activatedSkillsPrompt(
          state.activatedSkills,
          controllerVisibleToolIds
        );
        const lookupSkill = skills.find(
          (skill) => skill.name === "3gpp-lookup"
        );
        if (
          lookupSkill &&
          classify3gppRequest(state.request) === "3gpp_fact_lookup"
        ) {
          await emit("request.classified", {
            kind: "3gpp_fact_lookup",
            skill: lookupSkill.name,
            execution: "deterministic",
          });
          const quickResult = await executeQuick3gppLookup({
            request: state.request,
            run,
            workspace,
            user,
            agent,
            emit,
            signal,
            budget: sharedBudget,
            activatedSkillScope,
          });
          if (quickResult) {
            await onToken(quickResult.text);
            return {
              control: { kind: "direct", streamed: true },
              finalResponse: quickResult.text,
              sources: quickResult.sources,
            };
          }
          const configuredTools = Array.isArray(agent?.tools)
            ? new Set(agent.tools)
            : null;
          const lookupSnapshot = activatedSkillScope.get(lookupSkill.name)
            ? activatedSkillSnapshot(activatedSkillScope.get(lookupSkill.name))
            : null;
          const lookupToolIds = new Set();
          const candidateLookupTools = skillToolRestrictionsEnabled(run)
            ? skillAllowedToolIds(lookupSkill)
            : [...controllerVisibleToolIds];
          for (const toolId of candidateLookupTools) {
            const descriptor = toolRegistry.get(normalizeToolId(toolId));
            if (
              descriptor &&
              (descriptor.id.startsWith("skill.") ||
                legacySelectionAllows(configuredTools, descriptor))
            )
              lookupToolIds.add(descriptor.id);
          }
          const plan = validatePlan(
            normalized3gppLookupPlan(state.request, lookupToolIds),
            {
              run,
              agent,
              availableAgents: agents,
              activatedSkills: lookupSnapshot ? [lookupSnapshot] : [],
            }
          );
          await AgentRunTask.upsertPlan(run.id, plan.tasks);
          await emit("request.classified", {
            kind: "3gpp_fact_lookup",
            skill: lookupSkill.name,
          });
          await emit("plan.created", {
            goal: plan.goal,
            tasks: plan.tasks,
            reviewRound: state.reviewRound,
          });
          for (const taskItem of plan.tasks)
            await emit("task.created", { task: taskItem });
          return {
            control: { kind: "plan" },
            plan,
            activatedSkills: lookupSnapshot ? [lookupSnapshot] : [],
          };
        }
        const toolList = controllerToolDescriptors
          .map(
            (item) =>
              `${item.id} (${item.effect || (item.action ? "write" : "read")}): ${item.description}`
          )
          .join("\n");
        const agentList = agents
          .map((item) => `${item.id}: ${item.name} — ${item.description || ""}`)
          .join("\n");
        const createControlModel = (thinking) =>
          createChatModel({
            workspace,
            model: roleModel(run, "controller"),
            temperature: run.configuration?.temperature ?? 0.2,
            thinking,
          }).bindTools(
            [
              ...(selectableSkills.length
                ? [activateSkillControlTool(selectableSkills)]
                : []),
              planTool(),
              askUserTool(),
            ],
            { parallel_tool_calls: false }
          );
        const directActionGuidance = controllerDirectActionsEnabled()
          ? ""
          : " The controller API exposes only activate_skill, create_plan, and ask_user. The execution tools listed below belong to workers and cannot be called by the controller. When any execution tool is needed, call create_plan and put its exact ID in a worker task; never emit an execution-tool call directly.";
        const messages = modelMessages(
          `${basePrompt}${currentSkillCatalog ? `\n\n${currentSkillCatalog}` : ""}${activatedSkillContext ? `\n\n${activatedSkillContext}` : ""}\n\nYou are the controller for a governed Agent runtime. Before creating a plan, call activate_skill for every relevant available Skill whose full instructions are not already present above. Skill activation is a pre-planning control action: never include skill.activate or a Skill activation/bootstrap task in create_plan. After all relevant Skills are activated, create the actual work plan from their complete instructions. Answer ordinary questions directly. Call create_plan only when tools, independent work, delegation, or verification are genuinely useful. Call ask_user only when a missing answer materially changes the work. Every ask_user call must contain exactly three concise, mutually exclusive choices with the recommended choice first; the client supplies the fourth custom-answer option and notes field. Never combine normal answer text with a control tool call. Plans must contain concrete evidence or action tasks, not a final-answer task. Give each worker the smallest relevant allowedToolIds set. An empty allowedToolIds list means that worker receives no tools. When the user requests a list or named fields, make the task that reads or creates the dataset require those complete rows and fields in its worker summary; storing them only in an artifact does not satisfy the request. A task that must create, update, save, or publish an artifact must set writeIntent=true and include the exact write-capable tool. A read-only task must return its analysis in the worker JSON result; never tell it to complete, write, or update a report, ledger, manifest, Markdown file, or other artifact. When the user explicitly limits the request to uploaded files, use only filesystem and document-processing tools; exclude Workspace knowledge, memory, and public-web tools unless the user asks for them. Worker tools below are the complete tool boundary for this run: refer to them only inside create_plan.allowedToolIds, use only those exact IDs, and never invent or infer another tool.${directActionGuidance} ${knowledgeGuidance} For a long Skill workflow, split discovery and manifest creation, acquisition and processing, validation, and final publication into dependency tasks; allow a final-report publication tool only when it appears in Available tools, and only in the final task. For read-only requests, exclude unrelated state-changing tools, but retain Skill-declared execution or file tools required to create the workflow's cache and requested artifacts. Direct answers using context evidence must cite it as [C1], [C2], and so on.${state.planningFeedback ? `\n\nPrevious planning attempt was rejected: ${state.planningFeedback}` : ""}\n\nWorker tools for create_plan (not controller-callable):\n${toolList || "None"}\n\nAvailable specialist Agents:\n${agentList || "None"}`,
          state,
          `${state.request}${state.clarification ? `\n\nUser clarification:\n${state.clarification}` : ""}${contextPrompt(state.contextItems)}`,
          state.controllerAttachments
        );
        const primaryStreamOptions = {
          ...childRunnableConfig(runnableConfig, {
            tags: ["governed-agent", "role:controller"],
            metadata: { role: "controller" },
          }),
          runName: "govern-request",
          signal,
        };
        const controllerThinking =
          run.configuration?.thinking ??
          run.runtimeSnapshot?.runtimeConfig?.thinking ??
          true;
        const decision = await controllerDecisionWithFallback({
          primaryModel: createControlModel(controllerThinking !== false),
          createFallbackModel: () => createControlModel(false),
          messages,
          onToken,
          emit,
          primaryStreamOptions,
          fallbackStreamOptions: {
            ...childRunnableConfig(runnableConfig, {
              tags: [
                "governed-agent",
                "role:controller",
                "fallback:thinking-disabled",
              ],
              metadata: {
                role: "controller",
                fallbackReason: "empty_visible_response",
              },
            }),
            runName: "govern-request-fallback",
            signal,
          },
        });
        const { calls, response, streamedDirect } = decision;
        if (!calls.length) {
          if (!response.trim())
            throw new Error(
              "The controller returned no visible response after retrying with thinking disabled."
            );
          return {
            control: { kind: "direct", streamed: streamedDirect },
            finalResponse: response,
            sources: usedContextSources(response, state.contextItems),
          };
        }
        const call = calls[0];
        if (call.name === "activate_skill") {
          if (activatedNames.has(call.args?.name))
            return {
              control: { kind: "retry_planning" },
              planningFeedback: `Skill "${call.args?.name}" is already activated. Create the actual work plan now.`,
              planningAttempts: state.planningAttempts + 1,
            };
          await emit("activity.updated", {
            phase: "skill",
            summary: `正在加载 ${call.args?.name} 的说明`,
          });
          const snapshot = await activateSkillBeforePlanning({
            name: call.args?.name,
            skills,
            run,
            workspace,
            user,
            agent,
            emit,
            signal,
            budget: sharedBudget,
            visibleToolIds: new Set(
              allControllerToolDescriptors.map((descriptor) => descriptor.id)
            ),
            activatedSkillScope,
          });
          await emit("activity.updated", {
            phase: "planning",
            summary: `${snapshot.name} 已加载，正在制定任务计划`,
          });
          return {
            control: { kind: "skill_activated" },
            activatedSkills: [snapshot],
            planningFeedback: "",
          };
        }
        if (call.name === "ask_user")
          return {
            control: {
              kind: "input",
              question: call.args?.question,
              choices: call.args?.choices || [],
            },
          };
        let rawPlan = call.args;
        if (call.name !== "create_plan") {
          const normalizedAction = normalizeControllerAction(
            call,
            controllerToolDescriptors,
            state.request
          );
          if (!normalizedAction)
            throw new Error(`Unsupported controller action: ${call.name}`);
          if (!controllerDirectActionsEnabled()) {
            const reason = `Direct controller action "${normalizedAction.descriptor.id}" is disabled. Create a normal work plan and let the worker choose among its inherited tools.`;
            await emit("plan.rejected", { reason });
            if (state.planningAttempts < 1)
              return {
                control: { kind: "retry_planning" },
                planningFeedback: reason,
                planningAttempts: state.planningAttempts + 1,
              };
            rawPlan = delegatedControllerActionPlan({
              call,
              descriptor: normalizedAction.descriptor,
              descriptors: controllerToolDescriptors,
              request: state.request,
              hasAvailableAgents: agents.length > 0,
              agentTools: agent.tools,
            });
            await emit("controller.action_delegated", {
              requestedAction: call.name,
              toolId: normalizedAction.descriptor.id,
              reason,
            });
          } else {
            await emit("controller.action_normalized", {
              requestedAction: call.name,
              toolId: normalizedAction.descriptor.id,
            });
            rawPlan = normalizedAction.plan;
          }
        }
        let plan;
        try {
          plan = validatePlan(rawPlan, {
            run,
            agent,
            availableAgents: agents,
            activatedSkills: state.activatedSkills,
          });
        } catch (error) {
          const retry = planValidationRetry(error, state.planningAttempts);
          await emit("plan.rejected", { reason: error.message });
          if (retry) return retry;
          throw error;
        }
        await AgentRunTask.upsertPlan(run.id, plan.tasks);
        await emit("plan.created", {
          goal: plan.goal,
          tasks: plan.tasks,
          reviewRound: state.reviewRound,
        });
        for (const taskItem of plan.tasks)
          await emit("task.created", { task: taskItem });
        return {
          control: { kind: "plan" },
          plan,
          planningFeedback: "",
        };
      }
    );

  const requestInput = async (state) => {
    const response = interrupt({
      kind: "input",
      requestId: `${run.id}:controller-input:${state.reviewRound}`,
      questions: [
        {
          kind: "choice",
          question: state.control?.question || "What should the Agent use?",
          options: state.control?.choices || [],
          multiSelect: false,
          allowOther: true,
        },
      ],
    });
    const answers = Array.isArray(response?.answers)
      ? response.answers
          .map((answer) => answer?.answer ?? answer?.value ?? answer)
          .filter(Boolean)
          .join("\n")
      : "";
    return {
      clarification: response?.skipped
        ? "User skipped this question."
        : answers,
      control: null,
    };
  };

  const schedule = async (state) => {
    const skipped = blockedTaskResults(
      state.plan?.tasks || [],
      state.taskResults
    );
    for (const result of skipped) {
      await AgentRunTask.update(result.id, {
        status: "skipped",
        resultSummary: result.summary,
        completedAt: new Date(),
      });
      await emit("task.skipped", {
        taskId: result.id,
        reason: result.summary,
      });
    }
    return { taskResults: skipped };
  };

  const dispatch = (state) => {
    const results = new Map(state.taskResults.map((item) => [item.id, item]));
    const ready = (state.plan?.tasks || []).filter(
      (taskItem) =>
        !results.has(taskItem.id) && taskCanDispatch(taskItem, results)
    );
    if (!ready.length) return "review_results";
    return ready.slice(0, DEFAULTS.maxConcurrency).map(
      (workItem) =>
        new Send("worker", {
          ...state,
          workItem,
        })
    );
  };

  const worker = async (state, config) => {
    const taskItem = state.workItem;
    const startedAt = Date.now();
    const workerAgent = taskItem.assignedAgentId
      ? await resolveAgent(taskItem.assignedAgentId)
      : agent;
    if (!workerAgent) {
      return {
        taskResults: [
          {
            id: taskItem.id,
            status: "failed",
            summary: "The assigned Agent is unavailable.",
            error: "Assigned Agent is unavailable.",
            evidence: [],
            unresolved: ["Assigned Agent is unavailable."],
          },
        ],
      };
    }
    await AgentRunTask.update(taskItem.id, {
      status: "running",
      progress: taskItem.title,
      startedAt: new Date(),
    });
    await emit("task.started", {
      taskId: taskItem.id,
      title: taskItem.title,
      agent: { id: workerAgent.id, name: workerAgent.name },
      activatedSkills: state.activatedSkills.map((skill) => ({
        name: skill.name,
        revision: skill.revision || null,
      })),
    });
    await emit("task.progress", {
      taskId: taskItem.id,
      phase: "working",
      summary: taskItem.title,
    });
    try {
      await restoreActivatedSkills(
        state.activatedSkills,
        workspace,
        activatedSkillScope
      );
    } catch (error) {
      const failed = {
        id: taskItem.id,
        status: "failed",
        summary: `Could not start ${taskItem.title}.`,
        error: error.message,
        evidence: [],
        unresolved: [error.message],
        durationMs: Date.now() - startedAt,
        agent: { id: workerAgent.id, name: workerAgent.name },
      };
      await AgentRunTask.update(taskItem.id, {
        status: "failed",
        error: failed.error,
        resultSummary: failed.summary,
        progress: null,
        completedAt: new Date(),
      });
      await emit("task.failed", { taskId: taskItem.id, error: failed.error });
      return { taskResults: [failed] };
    }
    const dependencyResults = state.taskResults.filter((item) =>
      taskItem.dependsOn.includes(item.id)
    );
    const requestedToolIds = taskItem.allowedToolIds;
    const allowedToolIds = effectiveTaskToolIds(
      requestedToolIds,
      workerAgent,
      state.activatedSkills,
      skillToolRestrictionsEnabled(run)
    );
    const requiredToolIds = taskRequiredCompletionTools(
      run,
      allowedToolIds,
      taskItem
    );
    const quick3gppLookupTask = isQuick3gppLookupTask(taskItem);
    const limitsDisabled = executionLimitsDisabled(run);
    const workerRun = {
      ...run,
      configuration: {
        ...run.configuration,
        thinking:
          run.configuration?.thinking ??
          workerAgent.runtimeConfig?.thinking ??
          run.runtimeSnapshot?.runtimeConfig?.thinking ??
          true,
        model: roleModel(run, "worker"),
        toolOverrides: allowedToolIds,
        maxModelCallsPerTask: limitsDisabled
          ? null
          : run.configuration?.maxModelCallsPerTask ||
            (quick3gppLookupTask
              ? DEFAULTS.maxQuickLookupModelCalls
              : DEFAULTS.maxTaskModelCalls),
      },
    };
    let lastError = null;
    const maxWorkerAttempts = quick3gppLookupTask ? 1 : 2;
    for (let attempt = 1; attempt <= maxWorkerAttempts; attempt += 1) {
      const taskController = new AbortController();
      const taskSignal = AbortSignal.any([
        signal || new AbortController().signal,
        taskController.signal,
      ]);
      const maxTaskMs = limitsDisabled
        ? null
        : Math.min(
            Math.max(
              Number(taskItem.budget?.maxElapsedMs) || DEFAULTS.maxTaskMs,
              60_000
            ),
            DEFAULTS.maxTaskMs
          );
      const taskTimeout = limitsDisabled
        ? null
        : setTimeout(
            () =>
              taskController.abort(
                taskTerminalError(
                  "TASK_TIME_BUDGET_EXHAUSTED",
                  `任务“${taskItem.title}”运行超过 ${Math.round(maxTaskMs / 60_000)} 分钟，已停止当前步骤。`
                )
              ),
            maxTaskMs
          );
      taskTimeout?.unref?.();
      try {
        const durableTask = await AgentRunTask.get(taskItem.id);
        if (["cancelled", "skipped"].includes(durableTask?.status)) {
          const stopped = {
            id: taskItem.id,
            status: durableTask.status,
            summary:
              durableTask.resultSummary ||
              `Task ${durableTask.status} by the user.`,
            error: durableTask.error,
            evidence: [],
            unresolved: [],
          };
          return { taskResults: [stopped] };
        }
        const priorExecutions =
          attempt > 1
            ? await AgentToolExecution.listForTask(run.id, taskItem.id)
            : [];
        const workerGraph = await buildAgentGraph({
          run: workerRun,
          workspace,
          user,
          agent: workerAgent,
          emit,
          signal: taskSignal,
          maxConsecutiveNoProgress: DEFAULTS.maxConsecutiveNoProgress,
          onNoProgress: (error) => taskController.abort(error),
          budget: sharedBudget,
          depth: context.depth || 0,
          maxLocalToolCalls: limitsDisabled
            ? null
            : quick3gppLookupTask
              ? DEFAULTS.maxQuickLookupToolCalls
              : DEFAULTS.maxTaskToolCalls,
          systemPromptOverride: workerSystemPrompt({
            basePrompt: workerAgent.systemPrompt || basePrompt,
            userRequest: state.request,
            taskItem,
            allowedToolIds,
            requiredToolIds,
            dependencyResults,
            activatedSkillContext: activatedSkillsPrompt(
              state.activatedSkills,
              new Set(allowedToolIds)
            ),
            priorToolResults: priorToolResultsContext(priorExecutions),
          }),
          includeSkillCatalog: false,
          activatedSkillScope,
          checkpointerOverride: await getCheckpointer(),
          taskId: taskItem.id,
          taskTitle: taskItem.title,
        });
        const invocationConfig = {
          ...childRunnableConfig(config, {
            tags: ["governed-worker"],
            metadata: {
              taskId: taskItem.id,
              agentId: String(workerAgent.id),
              attempt: String(attempt),
            },
          }),
          configurable: {
            thread_id: `${run.checkpointThreadId}:task:${taskItem.id}:attempt:${attempt}`,
          },
          // A tool round consumes several LangGraph steps. Complex Skills
          // (for example, document extraction plus visual verification)
          // legitimately need more than the framework's small default.
          recursionLimit: recursionLimitFor(
            run,
            DEFAULTS.maxTaskToolCalls * 4 + 200
          ),
          signal: taskSignal,
        };
        let invocationInput = {
          messages: [
            {
              role: "user",
              content: `${taskItem.objective}${contextPrompt(state.contextItems)}`,
            },
          ],
        };
        let resultState;
        let parsed = null;
        let parseError = null;
        let missingToolIds = [];
        for (let continuation = 0; continuation < 3; continuation += 1) {
          resultState = await workerGraph.invoke(
            invocationInput,
            invocationConfig
          );
          try {
            parsed = workerResultSchema.parse(
              parseJsonObject(finalText(resultState))
            );
            parseError = null;
          } catch (error) {
            parsed = null;
            parseError = error;
          }
          const taskExecutions = await AgentToolExecution.listForTask(
            run.id,
            taskItem.id
          );
          const completedToolIds = new Set(
            taskExecutions
              .filter(
                (item) =>
                  item.status === "completed" && item.result?.ok !== false
              )
              .map((item) => item.tool_id)
          );
          missingToolIds = requiredToolIds.filter(
            (toolId) => !completedToolIds.has(toolId)
          );
          if (!parsed) {
            parsed = workerResultFromPlainText(resultState, missingToolIds);
          }
          if (parsed) {
            parseError = null;
          }
          if (parsed && !missingToolIds.length) break;
          if (continuation === 2) break;

          const reasons = [
            parseError
              ? "Your previous response was not the required JSON worker result."
              : null,
            missingToolIds.length
              ? `Required completion tools have not succeeded: ${missingToolIds.join(", ")}.`
              : null,
          ].filter(Boolean);
          await emit("task.progress", {
            taskId: taskItem.id,
            phase: "continuing",
            summary: "Continuing unfinished worker actions before review",
          });
          const continuationInstruction = workerContinuationInstruction({
            reasons,
            missingToolIds,
            completedToolIds: [...completedToolIds],
            writeEnabled:
              taskItem.writeIntent === true && taskHasWriteTool(allowedToolIds),
          });
          invocationInput = {
            messages: [
              ...(Array.isArray(resultState?.messages)
                ? resultState.messages
                : []),
              {
                role: "user",
                content: continuationInstruction,
              },
            ],
          };
        }
        if (!parsed) {
          parsed = {
            summary:
              finalText(resultState) || "Worker completed without a summary.",
            evidence: [],
            unresolved: [
              `Structured result was unavailable: ${parseError?.message || "unknown parse error"}`,
              ...(missingToolIds.length
                ? [`Missing completion tools: ${missingToolIds.join(", ")}`]
                : []),
            ],
          };
        }
        if (missingToolIds.length)
          throw new Error(
            `此任务缺少成功的必要工具调用：${missingToolIds.join(", ")}`
          );
        parsed = groundWorkerResultInToolExecutions(
          parsed,
          taskItem,
          requiredToolIds,
          await AgentToolExecution.listForTask(run.id, taskItem.id)
        );
        const evidence = normalizeEvidence(parsed.evidence, {
          id: taskItem.id,
        });
        const latestTask = await AgentRunTask.get(taskItem.id);
        if (["cancelled", "skipped"].includes(latestTask?.status)) {
          return {
            taskResults: [
              {
                id: taskItem.id,
                status: latestTask.status,
                summary:
                  latestTask.resultSummary ||
                  `Task ${latestTask.status} by the user.`,
                error: latestTask.error,
                evidence: [],
                unresolved: [],
              },
            ],
          };
        }
        await AgentRunEvidence.upsertMany(run.id, taskItem.id, evidence);
        const result = {
          id: taskItem.id,
          status: "completed",
          summary: parsed.summary,
          unresolved: parsed.unresolved,
          evidence,
          durationMs: Date.now() - startedAt,
          agent: { id: workerAgent.id, name: workerAgent.name },
        };
        await AgentRunTask.update(taskItem.id, {
          status: "completed",
          resultSummary: result.summary,
          progress: null,
          completedAt: new Date(),
          attempt,
        });
        await emit("task.completed", { taskId: taskItem.id, result });
        return { taskResults: [result], evidence };
      } catch (error) {
        rethrowWorkerInterrupt(error);
        const taskError = isTerminalTaskError(taskController.signal.reason)
          ? taskController.signal.reason
          : error;
        lastError = taskError;
        if (signal?.aborted) throw taskError;
        const priorExecutions =
          taskError?.code === "TASK_NO_PROGRESS"
            ? await AgentToolExecution.listForTask(run.id, taskItem.id)
            : [];
        const retryNoProgress = shouldRetryNoProgressTask({
          error: taskError,
          attempt,
          maxAttempts: maxWorkerAttempts,
          executions: priorExecutions,
        });
        if (isTerminalTaskError(taskError) && !retryNoProgress) break;
        if (attempt < maxWorkerAttempts) {
          await AgentRunTask.update(taskItem.id, {
            status: "retrying",
            attempt: attempt + 1,
            progress: retryNoProgress
              ? `Continuing ${taskItem.title} from completed tool results`
              : `Retrying ${taskItem.title} with a fresh model call`,
          });
          await emit("task.retrying", {
            taskId: taskItem.id,
            attempt: attempt + 1,
            error: taskError.message,
          });
        }
      } finally {
        clearTimeout(taskTimeout);
      }
    }
    const failed = {
      id: taskItem.id,
      status: "failed",
      summary: `Could not complete ${taskItem.title}.`,
      error: lastError?.message || "Task failed.",
      evidence: [],
      unresolved: [lastError?.message || "Task failed."],
      durationMs: Date.now() - startedAt,
      agent: { id: workerAgent.id, name: workerAgent.name },
    };
    await AgentRunTask.update(taskItem.id, {
      status: "failed",
      error: failed.error,
      resultSummary: failed.summary,
      progress: null,
      completedAt: new Date(),
    });
    await emit("task.failed", { taskId: taskItem.id, error: failed.error });
    return { taskResults: [failed] };
  };

  const review = async (state) => {
    await emit("activity.updated", {
      phase: "review",
      summary: `检查 ${state.taskResults.length} 个任务结果`,
    });
    try {
      const activatedSkillContext = activatedSkillsPrompt(
        state.activatedSkills
      );
      const decision = await invokeStructured({
        run,
        workspace,
        role: "reviewer",
        schema: reviewSchema,
        name: "review-agent-work",
        system: `${basePrompt}${activatedSkillContext ? `\n\n${activatedSkillContext}` : ""}\n\nReview completed and failed tasks against the user's request and the activated Skill instructions. Accept when supported, partial when the best possible answer should be returned with explicit gaps, or revise only for a material repair that can succeed with a different task. If the user requested a list or named fields but task results contain only a count, artifact path, truncated table, or incomplete rows, revise with a focused read task that returns every requested row and field in a compact form. Shared sources and directories should be stated once instead of repeated in every row. Do not accept a file path, output-length truncation, or fields omitted by truncation as a substitute for requested user-visible content. Do not repeat failed work unchanged.`,
        user: `Request:\n${state.request}\n\nPlan:\n${JSON.stringify(state.plan)}\n\nResults:\n${JSON.stringify(state.taskResults)}\n\nEvidence:\n${JSON.stringify(state.evidence)}`,
        runnableConfig,
      });
      return {
        review: normalizeReviewDecision(decision, state.taskResults),
      };
    } catch (error) {
      return {
        review: {
          status: "partial",
          gaps: [`Review model failed: ${error.message}`],
          replacementTasks: [],
        },
      };
    }
  };

  const afterReview = (state) => {
    if (
      state.review?.status === "revise" &&
      state.reviewRound < DEFAULTS.maxReviewRounds &&
      state.review?.replacementTasks?.length
    )
      return "apply_revision";
    return "synthesize";
  };

  const applyRevision = async (state) => {
    const availableAgents = await agentListForPrompt(agent.id);
    const revised = validatePlan(
      {
        goal: state.plan.goal,
        tasks: state.review.replacementTasks.map((taskItem, index) => ({
          ...taskItem,
          id: `repair-${state.reviewRound + 1}-${taskItem.id || index + 1}`,
          dependsOn: [],
        })),
      },
      {
        run,
        agent,
        availableAgents,
        activatedSkills: state.activatedSkills,
      }
    );
    const plan = {
      ...state.plan,
      tasks: [...state.plan.tasks, ...revised.tasks],
    };
    await AgentRunTask.upsertPlan(run.id, revised.tasks);
    await emit("plan.updated", {
      goal: plan.goal,
      tasks: plan.tasks,
      reviewRound: state.reviewRound + 1,
    });
    for (const taskItem of revised.tasks)
      await emit("task.created", { task: taskItem, repair: true });
    return { plan, reviewRound: state.reviewRound + 1, review: null };
  };

  const synthesize = async (state) =>
    withAgentStepTrace(
      "synthesize-agent-response",
      {
        input: {
          request: state.request,
          tasks: state.taskResults.length,
          evidence: state.evidence.length,
        },
        metadata: { role: "controller", reviewRound: state.reviewRound },
      },
      async () => {
        await emit("activity.updated", {
          phase: "writing",
          summary: "根据已完成的工作和可用资料整理回答",
        });
        const evidence = state.evidence.map((item, index) => ({
          citation: `E${index + 1}`,
          ...item,
        }));
        const activatedSkillContext = activatedSkillsPrompt(
          state.activatedSkills
        );
        const model = createChatModel({
          workspace,
          model: roleModel(run, "controller"),
          temperature: run.configuration?.temperature ?? 0.2,
          thinking: run.configuration?.thinking !== false,
        });
        let text = "";
        try {
          const stream = await model.stream(
            [
              {
                role: "system",
                content: `${basePrompt}${activatedSkillContext ? `\n\n${activatedSkillContext}` : ""}\n\nWrite the final user response from the task results while following the activated Skill instructions. Preserve successful work when some tasks failed. State material gaps plainly. Cite evidence inline as [E1], [E2], and so on. When the user requested a list or named fields and task results contain them, include every complete row in the answer; never replace requested user-visible content with only an artifact path, an offer to retrieve it later, or a truncation notice. Keep long tables compact by stating a shared source or directory once outside the table instead of repeating the same URL or path in every row. Do not expose internal plans or JSON. You have no tools in this step.`,
              },
              {
                role: "user",
                content: `Request:\n${state.request}\n\nReview:\n${JSON.stringify(state.review)}\n\nTask results:\n${JSON.stringify(state.taskResults)}\n\nEvidence:\n${JSON.stringify(evidence)}`,
              },
            ],
            {
              ...childRunnableConfig(runnableConfig, {
                tags: ["governed-agent", "role:controller", "synthesis"],
                metadata: { role: "controller" },
              }),
              runName: "synthesize-agent-response",
              signal,
            }
          );
          for await (const chunk of stream) {
            const token = contentText(chunk.content);
            if (!token) continue;
            text += token;
            await onToken(token);
          }
        } catch (error) {
          await emit("model.failed", {
            role: "controller",
            error: error.message,
          });
        }
        if (!text.trim()) {
          const completed = state.taskResults.filter(
            (item) => item.status === "completed"
          );
          const failed = state.taskResults.filter(
            (item) => item.status !== "completed"
          );
          text = completed.length
            ? `${completed.map((item) => item.summary).join("\n\n")}\n\n${failed.length ? `Incomplete work:\n${failed.map((item) => `- ${item.summary}`).join("\n")}` : ""}`.trim()
            : `I could not complete this request. ${failed
                .map((item) => item.error || item.summary)
                .filter(Boolean)
                .join(" ")}`;
          await onToken(text);
        }
        const used = new Set(
          [...text.matchAll(/\[E(\d+)\]/g)].map((match) => Number(match[1]) - 1)
        );
        const usedEvidence = [...used]
          .map((index) => evidence[index])
          .filter(Boolean);
        await AgentRunEvidence.markUsed(usedEvidence.map((item) => item.id));
        return {
          finalResponse: text,
          sources: usedEvidence.map(sourceFromEvidence),
        };
      }
    );

  const routeControl = (state) => {
    if (state.control?.kind === "input") return "request_input";
    if (["skill_activated", "retry_planning"].includes(state.control?.kind))
      return "controller";
    if (state.control?.kind === "plan") return "schedule";
    return END;
  };

  return new StateGraph(GovernedState)
    .addNode("prepare_context", prepareContext)
    .addNode("controller", controller)
    .addNode("request_input", requestInput)
    .addNode("schedule", schedule)
    .addNode("worker", worker)
    .addNode("review_results", review)
    .addNode("apply_revision", applyRevision)
    .addNode("synthesize", synthesize)
    .addEdge(START, "prepare_context")
    .addEdge("prepare_context", "controller")
    .addConditionalEdges("controller", routeControl)
    .addEdge("request_input", "controller")
    .addConditionalEdges("schedule", dispatch)
    .addEdge("worker", "schedule")
    .addConditionalEdges("review_results", afterReview)
    .addEdge("apply_revision", "schedule")
    .addEdge("synthesize", END)
    .compile({ checkpointer: await getCheckpointer() });
}

async function executeSegment(context) {
  const { run, history, signal, runnableConfig } = context;
  const graph = await createGovernedGraph(context);
  const resume = run.configuration?.resume || null;
  const graphInput = run.configuration?.recover
    ? null
    : resume
      ? new Command({ resume })
      : {
          request: run.prompt,
          history,
          attachments: run.attachments || [],
          controllerAttachments: [],
          reviewRound: 0,
          taskResults: [],
          evidence: [],
          contextItems: [],
          activatedSkills: context.inheritedSkills || [],
          planningFeedback: "",
          planningAttempts: 0,
        };
  const graphRun = await graph.stream(graphInput, {
    ...runnableConfig,
    streamMode: ["values"],
    configurable: { thread_id: run.checkpointThreadId },
    recursionLimit: recursionLimitFor(run, 800),
    maxConcurrency: DEFAULTS.maxConcurrency,
    signal,
  });
  const finalState = await consumeGraphStream(graphRun, async () => null);
  const pendingInterrupt = finalState?.__interrupt__?.[0]?.value;
  if (pendingInterrupt)
    return { kind: "interrupt", interrupt: pendingInterrupt, sources: [] };
  return {
    kind: "completed",
    text: finalState?.finalResponse || "",
    sources: finalState?.sources || [],
    partial: finalState?.review?.status === "partial",
  };
}

module.exports = {
  DEFAULTS,
  GovernedState,
  activateSkillBeforePlanning,
  activateSkillControlTool,
  activatedSkillToolIds,
  askUserTool,
  blockedTaskResults,
  controllerDecisionWithFallback,
  controllerDirectActionsEnabled,
  createGovernedGraph,
  classify3gppRequest,
  delegatedControllerActionPlan,
  execute3gppMarkdownConversion,
  executeQuick3gppLookup,
  executeSegment,
  effectiveTaskToolIds,
  groundWorkerResultInToolExecutions,
  isQuick3gppLookupTask,
  is3gppMarkdownConversionAgent,
  mergeById,
  normalizeReviewDecision,
  normalizeControllerAction,
  normalizedActionPlan,
  normalized3gppLookupPlan,
  parse3gppInvitationFacts,
  parse3gppConversionRequest,
  parse3gppMeetingRequest,
  planValidationRetry,
  priorToolResultsContext,
  quick3gppResponse,
  rethrowWorkerInterrupt,
  normalized3gppReviewPlan,
  requestAllowsWrite,
  resolvedTaskDependencies,
  scopedTaskId,
  shouldRetrieveWorkspaceContext,
  skillToolRestrictionsEnabled,
  shouldRecallPersonalMemory,
  shouldRetryNoProgressTask,
  streamControllerDecision,
  isKnowledgeIngestionRequest,
  knowledgeToolGuidance,
  taskHasWriteTool,
  taskCanDispatch,
  taskRequestsArtifactWrite,
  taskRequestsKnowledgePublish,
  taskRequiredCompletionTools,
  taskSchema,
  toolExecutionEvidence,
  validatePlan,
  workerContinuationInstruction,
  workerResultFromPlainText,
  workerSystemPrompt,
};
