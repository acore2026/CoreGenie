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
} = require("@langchain/langgraph");
const { Memory } = require("../../models/memory");
const { AgentRunTask } = require("../../models/agentRunTask");
const { AgentRunEvidence } = require("../../models/agentRunEvidence");
const { AgentToolExecution } = require("../../models/agentToolExecution");
const { ModelCapability } = require("../../models/modelCapability");
const { resolveAgent, agentListForPrompt } = require("../../resources/agents");
const { createChatModel, selectedProvider } = require("../../resources/models");
const { legacySelectionAllows, toolRegistry } = require("../../tools");
const { retrieveWorkspaceContext } = require("../../tools/rag");
const { buildAgentGraph } = require("../graph");
const {
  allowedToolIds: skillAllowedToolIds,
  availableSkills,
  skillCatalogPrompt,
} = require("../../agent-skills/registry");
const { getCheckpointer } = require("../checkpointer");
const { contentText, finalText, userContent } = require("../message");
const {
  childRunnableConfig,
  withAgentStepTrace,
  withRetrieverTrace,
} = require("../observability");
const { consumeGraphStream } = require("./stream");
const {
  evidenceSchema,
  normalizeEvidence,
  parseJsonObject,
  sourceFromEvidence,
} = require("./evidenceResearch");

const DEFAULTS = Object.freeze({
  maxTasks: 12,
  maxConcurrency: 3,
  maxReviewRounds: 2,
  maxTaskToolCalls: 500,
  maxTaskModelCalls: 500,
  maxTaskMs: 100 * 60 * 1_000,
  maxRunMs: 150 * 60 * 1_000,
});

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

function mergeById(current = [], updates = []) {
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const item of updates || []) merged.set(item.id, item);
  return [...merged.values()];
}

function resolvedTaskDependencies(taskItem, resultsById) {
  const dependencies = taskItem.dependsOn.map((id) => resultsById.get(id));
  return dependencies.every(Boolean) ? dependencies : null;
}

function taskRequiredCompletionTools(run, allowedToolIds = []) {
  const requiredToolIds =
    run.runtimeSnapshot?.runtimeConfig?.requiredCompletionTools || [];
  return requiredToolIds.filter((toolId) => allowedToolIds.includes(toolId));
}

function isSkillBootstrapTask(taskItem) {
  const allowed = taskItem.allowedToolIds || [];
  return (
    allowed.includes("skill.activate") &&
    allowed.length > 0 &&
    allowed.every((toolId) =>
      ["skill.activate", "skill.read_resource"].includes(toolId)
    )
  );
}

function skillBootstrapCompletion(taskItem, skills = [], executions = []) {
  if (!isSkillBootstrapTask(taskItem)) return null;
  const objective =
    `${taskItem.title || ""}\n${taskItem.objective || ""}`.toLowerCase();
  const requestedSkills = skills.filter((skill) =>
    objective.includes(skill.name.toLowerCase())
  );
  const expectedSkills = requestedSkills.length ? requestedSkills : skills;
  const completed = executions.filter((item) => item.status === "completed");
  const missingSkills = expectedSkills.filter(
    (skill) =>
      !completed.some(
        (item) =>
          item.tool_id === "skill.activate" &&
          item.arguments?.name === skill.name
      )
  );
  const expectedResources = expectedSkills.flatMap((skill) =>
    (skill.files || [])
      .filter((file) => file.path !== "SKILL.md" && file.text !== false)
      .filter((file) => {
        const relative = file.path.toLowerCase();
        const filename = relative.split("/").at(-1);
        const stem = filename.replace(/\.[^.]+$/, "");
        return objective.includes(relative) || objective.includes(stem);
      })
      .map((file) => ({ skill: skill.name, path: file.path }))
  );
  const missingResources = expectedResources.filter(
    (resource) =>
      !completed.some(
        (item) =>
          item.tool_id === "skill.read_resource" &&
          item.arguments?.name === resource.skill &&
          item.result?.data?.path === resource.path &&
          item.result?.data?.nextOffset === null
      )
  );
  return {
    complete: !missingSkills.length && !missingResources.length,
    expectedSkills,
    expectedResources,
    missingSkills,
    missingResources,
  };
}

async function streamControllerDecision(
  model,
  messages,
  { onToken, streamOptions }
) {
  let combined = null;
  let directText = "";
  let streamedDirect = false;
  const stream = await model.stream(messages, streamOptions);
  for await (const chunk of stream) {
    combined = combined ? combined.concat(chunk) : chunk;
    const hasControl =
      (combined.tool_call_chunks?.length || combined.tool_calls?.length) > 0;
    const token = contentText(chunk.content);
    if (token && !hasControl) {
      directText += token;
      streamedDirect = true;
      await onToken(token);
    }
  }
  return {
    message: combined,
    calls: combined?.tool_calls || [],
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
  return /\b(?:write|edit|delete|remove|create|save|store|upload|download|generate|send|execute|run|modify)\b|(?:写入|编辑|删除|创建|保存|存储|上传|下载|生成|发送|执行|修改)/i.test(
    String(request)
  );
}

function normalized3gppReviewPlan(request, requestedName, allowedToolIds) {
  const tools = (ids) => ids.filter((id) => allowedToolIds.has(id));
  return {
    goal: "Complete the 3GPP TDoc workflow with a validated manifest and one canonical report",
    tasks: [
      {
        id: "activate-3gpp-review",
        title: "Activate the 3GPP review Skill",
        objective: `Activate ${requestedName}, retain its exact skillRoot and complete instructions, and do not start discovery or downloads in this task. User request: ${request}`,
        dependsOn: [],
        allowedToolIds: tools(["skill.activate", "skill.read_resource"]),
        requiredCapabilities: [],
        successCriteria: [
          "The requested Skill is activated exactly once.",
          "Its exact skillRoot and packaged file paths are available to dependent tasks.",
        ],
        acceptsPartialDependencies: false,
        writeIntent: false,
      },
      {
        id: "resolve-and-filter",
        title: "Resolve the meeting and create the proposal manifest",
        objective: `Resolve the exact meeting folder and Index from official data, determine the requested agenda/KI scope, and use filter-index to generate and validate the canonical proposals.json. Never hand-write a manifest. Reuse exact paths returned by tools. User request: ${request}`,
        dependsOn: ["activate-3gpp-review"],
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

function normalizedActionPlan({
  descriptor,
  args = {},
  request,
  agent,
  skills = [],
}) {
  const allowedToolIds = new Set([descriptor.id]);
  let objective = `Use ${descriptor.id} to complete this request: ${request}\n\nThe controller suggested these arguments:\n${JSON.stringify(args)}`;
  let successCriteria = [
    "Capture the tool result and explain any execution failure.",
  ];

  if (descriptor.id === "skill.activate") {
    allowedToolIds.add("skill.read_resource");
    const requestedName = String(args?.name || "").trim();
    const relevantSkills = requestedName
      ? skills.filter((skill) => skill.name === requestedName)
      : skills;
    const configuredTools = Array.isArray(agent?.tools)
      ? new Set(agent.tools)
      : null;
    for (const skill of relevantSkills) {
      for (const toolId of skillAllowedToolIds(skill)) {
        const toolDescriptor = toolRegistry.get(toolId);
        if (!toolDescriptor) continue;
        if (
          toolDescriptor.id.startsWith("skill.") ||
          legacySelectionAllows(configuredTools, toolDescriptor)
        )
          allowedToolIds.add(toolDescriptor.id);
      }
    }
    if (
      requestedName &&
      relevantSkills.some((skill) =>
        ["3gpp-review", "3gpp-tdocs"].includes(skill.name)
      )
    )
      return normalized3gppReviewPlan(
        request,
        relevantSkills[0]?.name || requestedName,
        allowedToolIds
      );
    objective = `Activate the relevant Agent Skill, follow its instructions, and complete the user's request with the skill-permitted tools: ${request}\n\nThe controller suggested these arguments:\n${JSON.stringify(args)}`;
    successCriteria = [
      "Activate and follow the relevant Agent Skill.",
      "Complete the requested workflow using the skill-permitted tools instead of stopping after activation.",
      "Capture verified results and explain only genuine execution failures.",
    ];
  }

  return {
    goal: `Complete the request using ${descriptor.name}`,
    tasks: [
      {
        id: `${descriptor.id}-request`,
        title: `Use ${descriptor.name} for the request`,
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

function validatePlan(rawPlan, { run, agent, availableAgents = [] }) {
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
    for (const toolId of task.allowedToolIds) {
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
    if (
      /\b(?:final answer|synthesi[sz]e|respond to (?:the )?user)\b/i.test(
        task.objective
      )
    )
      throw new Error("Final answer synthesis cannot be a worker task.");
    return {
      ...task,
      id: localToScoped.get(task.id),
      dependsOn: task.dependsOn.map((id) => localToScoped.get(id)),
      assignedAgentId: task.assignedAgentId || null,
      writeIntent: Boolean(task.writeIntent && allowWrites),
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

function createGovernedGraph(context) {
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

  const prepareContext = async (state) => {
    await emit("activity.updated", {
      phase: "context",
      summary: "Recalling relevant workspace knowledge and memory",
    });
    const items = [];
    if (run.configuration?.autoRecall !== false && user?.id) {
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

    if (
      run.configuration?.autoRecall !== false ||
      ["query", "chat"].includes(run.mode)
    ) {
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
      (attachment) => attachment?.contentString
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
        const agents = await agentListForPrompt(agent.id);
        const skills = await availableSkills(agent, workspace);
        const currentSkillCatalog = await skillCatalogPrompt(
          agent,
          workspace,
          skills
        );
        const toolList = toolRegistry
          .list()
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
          }).bindTools([planTool(), askUserTool()], {
            parallel_tool_calls: false,
          });
        const messages = modelMessages(
          `${basePrompt}${currentSkillCatalog ? `\n\n${currentSkillCatalog}` : ""}\n\nYou are the controller for a governed Agent runtime. Answer ordinary questions directly. Call create_plan only when tools, independent work, delegation, or verification are genuinely useful. Call ask_user only when a missing answer materially changes the work. Every ask_user call must contain exactly three concise, mutually exclusive choices with the recommended choice first; the client supplies the fourth custom-answer option and notes field. Never combine normal answer text with a control tool call. Plans must contain concrete evidence or action tasks, not a final-answer task. Give each worker the smallest relevant allowedToolIds set. For a long Skill workflow, split discovery and manifest creation, acquisition and processing, validation, and final publication into dependency tasks; allow knowledge.publish only in the final task. A dedicated activation-only task may contain only skill.activate and skill.read_resource; otherwise include the Skill tools needed by that task. For read-only requests, exclude unrelated state-changing tools, but retain skill-declared execution or file tools required to create the workflow's cache and requested artifacts. Direct answers using context evidence must cite it as [C1], [C2], and so on.\n\nAvailable tools:\n${toolList || "None"}\n\nAvailable specialist Agents:\n${agentList || "None"}`,
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
        const decision = await controllerDecisionWithFallback({
          primaryModel: createControlModel(
            run.configuration?.thinking !== false
          ),
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
          const descriptor = toolRegistry
            .list()
            .find(
              (candidate) =>
                candidate.id === call.name || candidate.name === call.name
            );
          if (!descriptor)
            throw new Error(`Unsupported controller action: ${call.name}`);
          await emit("controller.action_normalized", {
            requestedAction: call.name,
            toolId: descriptor.id,
          });
          rawPlan = normalizedActionPlan({
            descriptor,
            args: call.args,
            request: state.request,
            agent,
            skills,
          });
        }
        const plan = validatePlan(rawPlan, {
          run,
          agent,
          availableAgents: agents,
        });
        await AgentRunTask.upsertPlan(run.id, plan.tasks);
        await emit("plan.created", {
          goal: plan.goal,
          tasks: plan.tasks,
          reviewRound: state.reviewRound,
        });
        for (const taskItem of plan.tasks)
          await emit("task.created", { task: taskItem });
        return { control: { kind: "plan" }, plan };
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
    const results = new Map(state.taskResults.map((item) => [item.id, item]));
    const skipped = [];
    for (const taskItem of state.plan?.tasks || []) {
      if (results.has(taskItem.id)) continue;
      const dependencies = resolvedTaskDependencies(taskItem, results);
      if (!dependencies) continue;
      const failed = dependencies.filter((item) => item.status !== "completed");
      if (failed.length && !taskItem.acceptsPartialDependencies) {
        const result = {
          id: taskItem.id,
          status: "skipped",
          summary: "Skipped because a required dependency did not complete.",
          unresolved: failed.map((item) => item.error || item.summary),
          evidence: [],
        };
        skipped.push(result);
        await AgentRunTask.update(taskItem.id, {
          status: "skipped",
          resultSummary: result.summary,
          completedAt: new Date(),
        });
        await emit("task.skipped", {
          taskId: taskItem.id,
          reason: result.summary,
        });
      }
    }
    return { taskResults: skipped };
  };

  const dispatch = (state) => {
    const results = new Map(state.taskResults.map((item) => [item.id, item]));
    const ready = (state.plan?.tasks || []).filter(
      (taskItem) =>
        !results.has(taskItem.id) &&
        taskItem.dependsOn.every((id) => results.has(id))
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
    });
    await emit("task.progress", {
      taskId: taskItem.id,
      phase: "working",
      summary: taskItem.title,
    });
    const dependencyResults = state.taskResults.filter((item) =>
      taskItem.dependsOn.includes(item.id)
    );
    const readOnlyTools = toolRegistry
      .list()
      .filter((item) => item.effect === "read" || item.action === false)
      .map((item) => item.id);
    const allowedToolIds = taskItem.allowedToolIds.length
      ? taskItem.allowedToolIds
      : readOnlyTools;
    const requiredToolIds = taskRequiredCompletionTools(run, allowedToolIds);
    const skillBootstrapTask = isSkillBootstrapTask(taskItem);
    const workerRun = {
      ...run,
      configuration: {
        ...run.configuration,
        model: roleModel(run, "worker"),
        toolOverrides: allowedToolIds,
        maxModelCallsPerTask:
          run.configuration?.maxModelCallsPerTask || DEFAULTS.maxTaskModelCalls,
      },
    };
    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
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
        const workerGraph = await buildAgentGraph({
          run: workerRun,
          workspace,
          user,
          agent: workerAgent,
          emit,
          signal,
          budget: sharedBudget,
          depth: context.depth || 0,
          maxLocalToolCalls: skillBootstrapTask
            ? 120
            : DEFAULTS.maxTaskToolCalls,
          systemPromptOverride: `${basePrompt}\n\nYou are a bounded worker in a governed task graph. Complete only the assigned task. Use only allowed tools. The required completion tools for this task are: ${requiredToolIds.join(", ") || "none"}. When that list is none, do not publish, search for a publication tool, or try to satisfy the Agent's run-level publication rule; publication belongs only to a task that explicitly allows knowledge.publish. Do not write the final user response. Stop only after the success criteria and every required completion tool are satisfied, or progress is genuinely blocked. Never end a turn with future intent such as “I will create/publish the report”; execute that action with a tool in the same turn. When a report is required, write it incrementally: create the file with a first filesystem.write call of at most 3,000 characters, append each remaining section with append=true in chunks of at most 3,000 characters, read the completed file back to verify it, then publish it before returning. Do not attempt to place a complete long report in one tool argument. Reuse existing workspace artifacts and activated Skills instead of repeating discovery, downloads, extraction, or visual analysis. Reuse the exact workspace paths returned in dependency results and tool outputs. Never reconstruct a directory from only a filename; when an exact path is unavailable, resolve it with filesystem.search or filesystem.list before reading. For skill resources, use only exact paths from the files list returned by activate_skill; never probe guessed directory or extension variants. Return one JSON object with summary, evidence, and unresolved. Evidence entries require kind, title, uri, excerpt, and metadata. Never invent sources.\n\nTask: ${taskItem.title}\nObjective: ${taskItem.objective}\nSuccess criteria: ${taskItem.successCriteria.join("; ") || "Satisfy the objective"}\nDependency results: ${JSON.stringify(dependencyResults)}`,
          checkpointerOverride: getCheckpointer(),
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
          recursionLimit: DEFAULTS.maxTaskToolCalls * 4 + 200,
          signal,
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
          const completedToolIds = new Set(
            await AgentToolExecution.completedToolIds(run.id)
          );
          missingToolIds = requiredToolIds.filter(
            (toolId) => !completedToolIds.has(toolId)
          );
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
          invocationInput = {
            messages: [
              {
                role: "user",
                content: `${reasons.join(" ")} Continue the same task now. Your next response must begin with the tool calls needed to finish, not prose. Reuse the already downloaded, extracted, and analyzed workspace artifacts; do not restart meeting discovery or document analysis unless a specific required artifact is missing. Locate an existing report draft or write the final report now in filesystem.write chunks no larger than 3,000 characters, using append=true after the first chunk. Read the completed file back to verify it, execute every missing completion tool, and only then return exactly one JSON object with summary, evidence, and unresolved. Completed tool IDs so far: ${[...completedToolIds].join(", ") || "none"}.`,
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
        } else if (missingToolIds.length) {
          parsed.unresolved.push(
            `Missing completion tools: ${missingToolIds.join(", ")}`
          );
        }
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
        lastError = error;
        if (signal.aborted) throw error;
        if (skillBootstrapTask) {
          const bootstrap = skillBootstrapCompletion(
            taskItem,
            await availableSkills(workerAgent, workspace),
            await AgentToolExecution.listForTask(run.id, taskItem.id)
          );
          if (bootstrap?.complete) {
            const result = {
              id: taskItem.id,
              status: "completed",
              summary: `Activated ${bootstrap.expectedSkills.map((skill) => skill.name).join(", ")} and completely read ${bootstrap.expectedResources.map((resource) => resource.path).join(", ") || "the requested Skill resources"}.`,
              unresolved: [],
              evidence: [],
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
            await emit("task.completed", {
              taskId: taskItem.id,
              result,
              deterministic: true,
            });
            return { taskResults: [result] };
          }
        }
        if (attempt < 2) {
          await AgentRunTask.update(taskItem.id, {
            status: "retrying",
            attempt: attempt + 1,
            progress: `Retrying ${taskItem.title} with a fresh model call`,
          });
          await emit("task.retrying", {
            taskId: taskItem.id,
            attempt: attempt + 1,
            error: error.message,
          });
        }
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
      summary: `Reviewing ${state.taskResults.length} task results for coverage and gaps`,
    });
    try {
      const decision = await invokeStructured({
        run,
        workspace,
        role: "reviewer",
        schema: reviewSchema,
        name: "review-agent-work",
        system: `${basePrompt}\n\nReview completed and failed tasks against the user's request. Accept when supported, partial when the best possible answer should be returned with explicit gaps, or revise only for a material repair that can succeed with a different task. Do not repeat failed work unchanged.`,
        user: `Request:\n${state.request}\n\nPlan:\n${JSON.stringify(state.plan)}\n\nResults:\n${JSON.stringify(state.taskResults)}\n\nEvidence:\n${JSON.stringify(state.evidence)}`,
        runnableConfig,
      });
      return { review: decision };
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
      { run, agent, availableAgents }
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
          summary:
            "Writing the answer from completed work and verified evidence",
        });
        const evidence = state.evidence.map((item, index) => ({
          citation: `E${index + 1}`,
          ...item,
        }));
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
                content: `${basePrompt}\n\nWrite the final user response from the task results. Preserve successful work when some tasks failed. State material gaps plainly. Cite evidence inline as [E1], [E2], and so on. Do not expose internal plans or JSON. You have no tools in this step.`,
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
    .compile({ checkpointer: getCheckpointer() });
}

async function executeSegment(context) {
  const { run, history, signal, runnableConfig } = context;
  const graph = createGovernedGraph(context);
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
        };
  const graphRun = await graph.stream(graphInput, {
    ...runnableConfig,
    streamMode: ["values"],
    configurable: { thread_id: run.checkpointThreadId },
    recursionLimit: 800,
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
  askUserTool,
  controllerDecisionWithFallback,
  createGovernedGraph,
  executeSegment,
  mergeById,
  normalizedActionPlan,
  normalized3gppReviewPlan,
  requestAllowsWrite,
  resolvedTaskDependencies,
  scopedTaskId,
  streamControllerDecision,
  isSkillBootstrapTask,
  skillBootstrapCompletion,
  taskRequiredCompletionTools,
  taskSchema,
  validatePlan,
};
