const { isGraphInterrupt } = require("@langchain/langgraph");
const { normalizeToolId, toolRegistry } = require("../../../tools");
const { finalText } = require("../../message");

type EvidenceRecord = import("./types.ts").EvidenceRecord;
type GovernedTask = import("./types.ts").GovernedTask;
type ReviewDecision = import("./types.ts").ReviewDecision;
type TaskResult = import("./types.ts").TaskResult;
type ToolExecutionRecord = import("./types.ts").ToolExecutionRecord;

interface TerminalTaskError extends Error {
  code?: string;
  retryable?: boolean;
}

function rethrowWorkerInterrupt(error: unknown): void {
  if (isGraphInterrupt(error)) throw error;
}

function taskHasWriteTool(allowedToolIds: string[] = []): boolean {
  return allowedToolIds.some((toolId) => {
    if (toolId === "agent.call") return true;
    const descriptor = toolRegistry.get(toolId);
    return Boolean(descriptor && descriptor.effect !== "read");
  });
}

function taskRequestsArtifactWrite(task: Partial<GovernedTask> = {}): boolean {
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

function taskRequestsKnowledgePublish(
  task: Partial<GovernedTask> = {}
): boolean {
  const text = [task.title, task.objective, ...(task.successCriteria || [])]
    .filter(Boolean)
    .join("\n");
  return /\bpublish\b.{0,80}\b(?:knowledge\s*base|workspace)\b|\b(?:knowledge\s*base|workspace)\b.{0,80}\bpublish\b|发布.{0,40}(?:知识库|Workspace)|(?:知识库|Workspace).{0,40}发布/i.test(
    text
  );
}

function taskTerminalError(code: string, message: string): TerminalTaskError {
  const error: TerminalTaskError = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}

function isTerminalTaskError(error: unknown): boolean {
  const code = (error as TerminalTaskError | null | undefined)?.code;
  return Boolean(
    code && ["TASK_NO_PROGRESS", "TASK_TIME_BUDGET_EXHAUSTED"].includes(code)
  );
}

function normalizeReviewDecision(
  decision: ReviewDecision | null | undefined,
  taskResults: TaskResult[] = []
): ReviewDecision | null | undefined {
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

function scopedTaskId(runId: string, value: string): string {
  const clean = String(value || "task")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${runId}:${clean || "task"}`;
}

function resolvedTaskDependencies(
  taskItem: GovernedTask,
  resultsById: Map<string, TaskResult>
): TaskResult[] | null {
  const dependencies = taskItem.dependsOn.map((id) => resultsById.get(id));
  return dependencies.every(Boolean) ? (dependencies as TaskResult[]) : null;
}

function blockedTaskResults(
  tasks: GovernedTask[] = [],
  taskResults: TaskResult[] = []
): TaskResult[] {
  const results = new Map(taskResults.map((item) => [item.id, item]));
  const skipped: TaskResult[] = [];
  let foundBlockedTask = true;
  while (foundBlockedTask) {
    foundBlockedTask = false;
    for (const taskItem of tasks) {
      if (results.has(taskItem.id)) continue;
      const dependencies = resolvedTaskDependencies(taskItem, results);
      if (!dependencies) continue;
      const failed = dependencies.filter((item) => item.status !== "completed");
      if (!failed.length || taskItem.acceptsPartialDependencies) continue;
      const result: TaskResult = {
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

function taskCanDispatch(
  taskItem: GovernedTask,
  resultsById: Map<string, TaskResult>
): boolean {
  const dependencies = resolvedTaskDependencies(taskItem, resultsById);
  if (!dependencies) return false;
  return (
    taskItem.acceptsPartialDependencies ||
    dependencies.every((item) => item.status === "completed")
  );
}

function normalizedActionToolId(
  taskItem: Partial<GovernedTask> | null = {}
): string | null {
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
  run: Record<string, any>,
  allowedToolIds: string[] = [],
  taskItem: Partial<GovernedTask> | null = null
): string[] {
  const requiredToolIds: string[] =
    run.runtimeSnapshot?.runtimeConfig?.requiredCompletionTools || [];
  const normalizedToolId = normalizedActionToolId(taskItem);
  return [
    ...new Set([
      ...requiredToolIds.filter((toolId) => allowedToolIds.includes(toolId)),
      ...(normalizedToolId ? [normalizedToolId] : []),
    ]),
  ];
}

function toolExecutionEvidence(
  executions: ToolExecutionRecord[] = [],
  requiredToolIds: string[] = []
): EvidenceRecord[] {
  const required = new Set(requiredToolIds);
  return executions
    .filter(
      (item) =>
        Boolean(item.tool_id && required.has(item.tool_id)) &&
        item.status === "completed" &&
        item.result?.ok !== false
    )
    .flatMap((item): EvidenceRecord[] => {
      if (
        item.tool_id === "knowledge.search" &&
        Array.isArray(item.result?.data)
      )
        return item.result.data
          .slice(0, 12)
          .map((entry: any, index: number) => ({
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
        return item.result.data
          .slice(0, 12)
          .map((entry: any, index: number) => ({
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

function claimSaysToolDidNotRun(value = ""): boolean {
  return /(?:no\s+[^.\n]*tool call|tool\s+(?:was|has)\s+not\s+(?:been\s+)?executed|never\s+(?:actually\s+)?executed|not\s+executed|未[^。\n]{0,20}(?:执行|调用)|从未[^。\n]{0,20}(?:发起|执行|调用)|没有[^。\n]{0,20}工具(?:调用|输出)|工具调用[^。\n]{0,12}(?:被)?跳过|均[^。\n]{0,40}(?:失败|未返回)|未返回任何[^。\n]{0,30}(?:数据|结果))/i.test(
    String(value)
  );
}

function toolExecutionHasUsableResult(
  execution: ToolExecutionRecord = {}
): boolean {
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

function claimSaysNoToolResults(value = ""): boolean {
  return /(?:no\s+(?:usable\s+)?(?:results?|data|documents?|files?)\s+(?:were\s+)?(?:found|returned|retrieved)|(?:没有|未)(?:成功)?(?:检索|搜索|查找|读取|获得|获取|返回)(?:到)?[^。\n]{0,50}(?:结果|报告|资料|数据|全文|文件|文档|TDoc))/i.test(
    String(value)
  );
}

function groundWorkerResultInToolExecutions<
  T extends {
    summary: string;
    evidence?: EvidenceRecord[];
    unresolved?: string[];
  },
>(
  parsed: T | null | undefined,
  _taskItem: Partial<GovernedTask> | null,
  requiredToolIds: string[],
  executions: ToolExecutionRecord[] = []
): T | null | undefined {
  if (!parsed) return parsed;
  const completedExecutions = executions.filter(
    (item) => item.status === "completed" && item.result?.ok !== false
  );
  if (!completedExecutions.length) return parsed;
  const relevantCompletedExecutions = requiredToolIds.length
    ? completedExecutions.filter((item) =>
        Boolean(item.tool_id && requiredToolIds.includes(item.tool_id))
      )
    : completedExecutions;
  const contradictsNoResultClaim = (value: string) =>
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
      ? [
          ...new Set(
            completedExecutions
              .map((item) => item.tool_id)
              .filter((id): id is string => Boolean(id))
          ),
        ]
      : [];
  if (!evidenceToolIds.length) return parsed;
  const completed = completedExecutions.filter((item) =>
    Boolean(item.tool_id && evidenceToolIds.includes(item.tool_id))
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

function workerContinuationInstruction({
  reasons = [],
  missingToolIds = [],
  completedToolIds = [],
  writeEnabled = false,
}: {
  reasons?: string[];
  missingToolIds?: string[];
  completedToolIds?: string[];
  writeEnabled?: boolean;
}): string {
  if (!missingToolIds.length)
    return `${reasons.join(" ")} The task evidence and tool work are already complete. Do not call any tool again and do not repeat discovery. Return exactly one JSON object with summary, evidence, and unresolved, using only the results already present in this conversation.`;
  const completionGuidance = writeEnabled
    ? "Locate the existing draft or write the requested artifact now in filesystem.write chunks no larger than 3,000 characters, using append=true after the first chunk. Read it back to verify it, then execute every missing completion tool."
    : "This is a read-only task. Do not create, update, or publish a report, ledger, manifest, Markdown file, or any other artifact. Use the available results and read tools only, then return the analysis in the worker JSON result.";
  return `${reasons.join(" ")} Continue the same task now. Reuse the already downloaded, extracted, and analyzed workspace artifacts; do not restart meeting discovery or document analysis unless a specific required artifact is missing. ${completionGuidance} Return exactly one JSON object with summary, evidence, and unresolved. Completed tool IDs so far: ${completedToolIds.join(", ") || "none"}.`;
}

function priorToolResultsContext(
  executions: ToolExecutionRecord[] = [],
  maxChars = 12_000
): string {
  const completed = executions.filter(
    (item) => item.status === "completed" && item.result?.ok !== false
  );
  if (!completed.length) return "";

  const unique = new Map<string | undefined, ToolExecutionRecord>();
  for (const execution of completed) {
    const key =
      execution.operation_key || execution.operationKey || execution.id;
    unique.set(key, execution);
  }

  const entries: string[] = [];
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
}: {
  error?: TerminalTaskError | null;
  attempt: number;
  maxAttempts: number;
  executions?: ToolExecutionRecord[];
}): boolean {
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
}: {
  basePrompt: string;
  userRequest?: string;
  taskItem: GovernedTask;
  allowedToolIds: string[];
  requiredToolIds: string[];
  dependencyResults: TaskResult[];
  activatedSkillContext?: string;
  priorToolResults?: string;
}): string {
  const writeEnabled =
    taskItem.writeIntent === true && taskHasWriteTool(allowedToolIds);
  const artifactGuidance = writeEnabled
    ? "This task may write the requested artifact. Write long files incrementally: create the file with a first filesystem.write call of at most 3,000 characters, append each remaining section with append=true in chunks of at most 3,000 characters, and read the completed file back before publishing it. Do not place a complete long report in one tool argument."
    : "This is a read-only task. Return the completed analysis in the final worker JSON object. Do not create, update, save, or publish a report, ledger, manifest, Markdown file, or any other artifact. If the objective uses words such as complete a ledger or report, interpret that as completing the analysis fields in your JSON result, not modifying a file.";
  return `${basePrompt}${activatedSkillContext ? `\n\n${activatedSkillContext}` : ""}\n\nYou are a bounded worker in a governed task graph. Complete only the assigned task. The relevant Skills were activated before planning and their complete instructions are included above. Follow them without calling activate_skill again. Use only allowed tools. The required completion tools for this task are: ${requiredToolIds.join(", ") || "none"}. When that list is none, do not publish, search for a publication tool, or try to satisfy the Agent's run-level publication rule; publication belongs only to a task whose allowed tool list explicitly includes that publication tool. Do not write the final user response. Stop after the success criteria and every required completion tool are satisfied, or when progress is genuinely blocked. Never end with future intent such as “I will create or publish the report.” ${artifactGuidance} Reuse existing workspace artifacts instead of repeating discovery, downloads, extraction, or visual analysis. Reuse the exact workspace paths returned in dependency results and tool outputs. Never reconstruct a directory from only a filename; when an exact path is unavailable, resolve it with filesystem.search or filesystem.list before reading. For Skill resources, use only exact paths from the activated Skill file lists above; never probe guessed directory or extension variants. If the original request asks to list items or fields and this task creates or reads that dataset, include every requested row and field in the summary; a count or file path alone is not sufficient. Use a compact table when the list is long. If one source or directory applies to many rows, state it once outside the table instead of repeating the same long URL or path in every row. Never omit a requested row or field merely to stay concise. Return one JSON object with summary, evidence, and unresolved. Evidence entries require kind, title, uri, excerpt, and metadata. Never invent sources.\n\nOriginal user request: ${userRequest}\n\nTask: ${taskItem.title}\nObjective: ${taskItem.objective}\nSuccess criteria: ${taskItem.successCriteria.join("; ") || "Satisfy the objective"}\nDependency results: ${JSON.stringify(dependencyResults)}${priorToolResults}`;
}

function workerResultFromPlainText(
  resultState: unknown,
  missingToolIds: string[] = []
): {
  summary: string;
  evidence: EvidenceRecord[];
  unresolved: string[];
} | null {
  if (missingToolIds.length) return null;
  const summary = finalText(resultState).trim();
  if (!summary) return null;
  return { summary, evidence: [], unresolved: [] };
}

module.exports = {
  blockedTaskResults,
  claimSaysNoToolResults,
  claimSaysToolDidNotRun,
  groundWorkerResultInToolExecutions,
  isTerminalTaskError,
  normalizeReviewDecision,
  normalizedActionToolId,
  priorToolResultsContext,
  resolvedTaskDependencies,
  rethrowWorkerInterrupt,
  scopedTaskId,
  shouldRetryNoProgressTask,
  taskCanDispatch,
  taskHasWriteTool,
  taskRequestsArtifactWrite,
  taskRequestsKnowledgePublish,
  taskRequiredCompletionTools,
  taskTerminalError,
  toolExecutionEvidence,
  toolExecutionHasUsableResult,
  workerContinuationInstruction,
  workerResultFromPlainText,
  workerSystemPrompt,
};
