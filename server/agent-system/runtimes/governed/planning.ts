const { tool } = require("@langchain/core/tools");
const { z } = require("zod");
const { createChatModel } = require("../../../resources/models");
const {
  legacySelectionAllows,
  normalizeToolId,
  toolRegistry,
} = require("../../../tools");
const { AgentToolContext } = require("../../../tools/context");
const { toLangChainTool } = require("../../../tools/descriptor");
const { activatedSkillSnapshot } = require("../../activatedSkills");
const {
  allowedToolIds: skillAllowedToolIds,
} = require("../../../agent-skills/registry");
const { contentText, userContent } = require("../../message");
const { childRunnableConfig } = require("../../observability");
const { parseJsonObject } = require("../evidenceResearch");
const { DEFAULTS, planSchema } = require("./types.ts");
const {
  scopedTaskId,
  taskHasWriteTool,
  taskRequestsArtifactWrite,
  taskRequestsKnowledgePublish,
} = require("./grounding.ts");
const { requestAllowsWrite } = require("./workflows.ts");

type ActivatedSkillRecord = import("./types.ts").ActivatedSkillRecord;
type ContextItem = import("./types.ts").ContextItem;
type GovernedPlan = import("./types.ts").GovernedPlan;

const DELEGATED_FALLBACK_WRITE_TOOLS = new Set([
  "bash",
  "python",
  "filesystem.write",
]);

function controllerDirectActionsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    String(env.ENABLE_CONTROLLER_DIRECT_ACTIONS || "").toLowerCase() === "true"
  );
}

function normalizedActionPlan({
  descriptor,
  args = {},
  request,
}: {
  descriptor: {
    id: string;
    name: string;
    effect?: string;
    capabilities?: string[];
  };
  args?: Record<string, unknown>;
  request: string;
}): GovernedPlan {
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

function normalizeControllerAction(
  call: { name?: string; args?: Record<string, unknown> } | null | undefined,
  descriptors: Array<{
    id: string;
    name: string;
    effect?: string;
    capabilities?: string[];
  }> = [],
  request = ""
) {
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

function delegatedControllerActionPlan({
  call,
  descriptor,
  descriptors = [],
  request = "",
  hasAvailableAgents = false,
  agentTools = null,
}: {
  call?: { args?: Record<string, unknown> };
  descriptor: { id: string };
  descriptors?: Array<{ id: string; effect?: string }>;
  request?: string;
  hasAvailableAgents?: boolean;
  agentTools?: string[] | null;
}): GovernedPlan {
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

function skillToolRestrictionsEnabled(run: Record<string, any> = {}): boolean {
  return (
    run?.policySnapshot?.enforceSkillToolRestrictions === true ||
    run?.configuration?.enforceSkillToolRestrictions === true
  );
}

function activatedSkillToolIds(
  skills: ActivatedSkillRecord[] = [],
  enforceRestrictions = false
): Set<string> | null {
  if (!enforceRestrictions || !skills.length) return null;
  return new Set(
    skills.flatMap((skill) =>
      skillAllowedToolIds(skill).map((toolId: string) =>
        normalizeToolId(toolId)
      )
    )
  );
}

function descriptorsForActivatedSkills<T extends { id: string }>(
  descriptors: T[] = [],
  skills: ActivatedSkillRecord[] = [],
  enforceRestrictions = false
): T[] {
  const allowed = activatedSkillToolIds(skills, enforceRestrictions);
  if (!allowed) return descriptors;
  return descriptors.filter((descriptor) => allowed.has(descriptor.id));
}

function effectiveTaskToolIds(
  requestedToolIds: string[] = [],
  workerAgent: { tools?: string[] | null } = {},
  activatedSkills: ActivatedSkillRecord[] = [],
  enforceRestrictions = false
): string[] {
  const configuredTools = Array.isArray(workerAgent?.tools)
    ? new Set(workerAgent.tools)
    : null;
  const skillTools = activatedSkillToolIds(
    activatedSkills,
    enforceRestrictions
  );
  return [
    ...new Set(requestedToolIds.map((id) => normalizeToolId(id) as string)),
  ].filter((toolId) => {
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
  });
}

function validatePlan(
  rawPlan: unknown,
  {
    run,
    agent,
    availableAgents = [],
    activatedSkills = [],
  }: {
    run: Record<string, any>;
    agent: Record<string, any>;
    availableAgents?: Array<{ id: number | string }>;
    activatedSkills?: ActivatedSkillRecord[];
  }
): GovernedPlan {
  const parsed = planSchema.parse(rawPlan);
  const knownAgents = new Set([
    Number(agent.id),
    ...availableAgents.map((item) => Number(item.id)),
  ]);
  const registryIds = new Set<string>(
    toolRegistry.list().map((item: { id: string }) => item.id)
  );
  registryIds.add("agent.call");
  const configuredTools = Array.isArray(agent.tools)
    ? new Set(agent.tools)
    : null;
  const activeSkillTools = activatedSkillToolIds(
    activatedSkills,
    skillToolRestrictionsEnabled(run)
  );
  const localToScoped = new Map<string, string>(
    parsed.tasks.map((task: any) => [task.id, scopedTaskId(run.id, task.id)])
  );
  if (localToScoped.size !== parsed.tasks.length)
    throw new Error("Plan contains duplicate task IDs.");
  const allowWrites = requestAllowsWrite(run.prompt);
  const tasks = parsed.tasks.map((task: any) => {
    if (task.assignedAgentId && !knownAgents.has(Number(task.assignedAgentId)))
      throw new Error(`Task ${task.id} selected an unavailable Agent.`);
    for (const dependency of task.dependsOn) {
      if (!localToScoped.has(dependency))
        throw new Error(`Task ${task.id} has an unknown dependency.`);
    }
    const normalizedAllowedToolIds: string[] = [
      ...new Set(task.allowedToolIds.map(normalizeToolId)),
    ] as string[];
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
      id: localToScoped.get(task.id)!,
      dependsOn: task.dependsOn.map((id: string) => localToScoped.get(id)!),
      assignedAgentId: task.assignedAgentId || null,
      writeIntent: effectiveWriteIntent,
      budget: {
        maxToolCalls: DEFAULTS.maxTaskToolCalls,
        maxModelCalls: DEFAULTS.maxTaskModelCalls,
        maxElapsedMs: DEFAULTS.maxTaskMs,
      },
    };
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map<string, any>(tasks.map((task: any) => [task.id, task]));
  const visit = (id: string) => {
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

function planValidationRetry(error: unknown, planningAttempts = 0) {
  if (planningAttempts >= 1) return null;
  return {
    control: { kind: "retry_planning" },
    planningFeedback: String((error as Error)?.message || error),
    planningAttempts: planningAttempts + 1,
  };
}

function roleModel(run: Record<string, any>, role: string): string | null {
  return (
    run.runtimeSnapshot?.roleModels?.[role] ||
    run.runtimeSnapshot?.selectedModel ||
    null
  );
}

function modelMessages(
  system: string,
  state: { history?: unknown[] },
  userText: string,
  attachments: unknown[] = []
) {
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

function activateSkillControlTool(skills: Array<{ name: string }> = []) {
  const names = skills.map((skill) => skill.name);
  return tool(async () => "Skill selection accepted.", {
    name: "activate_skill",
    description: `Activate one relevant Skill before planning so its complete instructions are available. Use the exact name from this list: ${names.join(", ") || "none"}. Never represent Skill activation as a plan task.`,
    schema: z.object({
      name: z
        .string()
        .trim()
        .min(1)
        .refine((name: string) => names.includes(name), {
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
}: {
  name: string;
  skills: ActivatedSkillRecord[];
  run: Record<string, any>;
  workspace: Record<string, any>;
  user: Record<string, any> | null;
  agent: Record<string, any>;
  emit: (event: string, payload?: Record<string, unknown>) => Promise<void>;
  signal?: AbortSignal;
  budget?: Record<string, any>;
  visibleToolIds: Set<string>;
  activatedSkillScope?: Map<string, any> | null;
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

async function streamControllerDecision(
  model: { stream: (messages: unknown[], options?: unknown) => Promise<any> },
  messages: unknown[],
  {
    onToken,
    streamOptions,
  }: {
    onToken: (token: string) => Promise<void> | void;
    streamOptions?: Record<string, unknown>;
  }
) {
  let combined: any = null;
  let directText = "";
  const stream = await model.stream(messages, streamOptions);
  for await (const chunk of stream) {
    combined = combined ? combined.concat(chunk) : chunk;
    const token = contentText(chunk.content);
    if (token) directText += token;
  }
  const calls = combined?.tool_calls || [];
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
}: {
  primaryModel: any;
  createFallbackModel: () => any;
  messages: unknown[];
  onToken: (token: string) => Promise<void> | void;
  emit: (event: string, payload?: Record<string, unknown>) => Promise<void>;
  primaryStreamOptions?: Record<string, unknown>;
  fallbackStreamOptions?: Record<string, unknown>;
}) {
  const decision = await streamControllerDecision(primaryModel, messages, {
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

async function invokeStructured({
  run,
  workspace,
  role,
  schema,
  name,
  system,
  user,
  runnableConfig,
}: {
  run: Record<string, any>;
  workspace: Record<string, any>;
  role: string;
  schema: any;
  name: string;
  system: string;
  user: string;
  runnableConfig?: Record<string, unknown>;
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

function contextPrompt(items: ContextItem[] = []): string {
  if (!items.length) return "";
  return `\n\n<context_evidence>\n${items
    .map(
      (item, index) =>
        `[C${index + 1}] ${item.title}\n${item.text || item.excerpt || ""}`
    )
    .join("\n\n")}\n</context_evidence>`;
}

function usedContextSources(text: string, items: ContextItem[] = []) {
  const used = new Set(
    [...String(text).matchAll(/\[C(\d+)\]/g)].map(
      (match) => Number(match[1]) - 1
    )
  );
  return [...used].map((index) => items[index]?.source).filter(Boolean);
}

module.exports = {
  DELEGATED_FALLBACK_WRITE_TOOLS,
  activateSkillBeforePlanning,
  activateSkillControlTool,
  activatedSkillToolIds,
  askUserTool,
  contextPrompt,
  controllerDecisionWithFallback,
  controllerDirectActionsEnabled,
  delegatedControllerActionPlan,
  descriptorsForActivatedSkills,
  effectiveTaskToolIds,
  invokeStructured,
  modelMessages,
  normalizeControllerAction,
  normalizedActionPlan,
  planTool,
  planValidationRetry,
  roleModel,
  skillToolRestrictionsEnabled,
  streamControllerDecision,
  usedContextSources,
  validatePlan,
};
