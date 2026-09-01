function result(pass, reason) {
  return { pass, score: pass ? 1 : 0, reason };
}

function text(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value || "");
  }
}

function checkTerminal(metadata) {
  const status = metadata.snapshot?.run?.status;
  return ["completed", "partial"].includes(status)
    ? null
    : `run status is ${status || "missing"}`;
}

function checkNoRuntimeError(output, metadata) {
  const corpus = [
    output,
    metadata.snapshot?.run?.error,
    ...(metadata.snapshot?.events || []).map((event) => event.payload),
  ]
    .map(text)
    .join("\n");
  const patterns = [
    /Direct controller action .* is disabled/i,
    /requires an artifact write but its writeIntent/i,
    /Unsupported controller action/i,
    /activate_skill has been running/i,
  ];
  const match = patterns.find((pattern) => pattern.test(corpus));
  return match ? `runtime exposed ${match}` : null;
}

function checkDirect(metadata) {
  const snapshot = metadata.snapshot || {};
  if ((snapshot.tasks || []).length) return "simple answer created tasks";
  if ((snapshot.toolExecutions || []).length)
    return "simple answer executed tools";
  return null;
}

function checkSkillPreplan(metadata) {
  const events =
    metadata.observedSnapshot?.events || metadata.snapshot?.events || [];
  const skillIndex = events.findIndex(
    (event) => event.type === "skill.activated"
  );
  const planIndex = events.findIndex((event) => event.type === "plan.created");
  if (skillIndex < 0) return "skill.activated event is missing";
  if (planIndex >= 0)
    return skillIndex < planIndex
      ? null
      : "Skill activation did not complete before planning";
  const deterministic = events.some(
    (event) =>
      event.type === "request.classified" &&
      event.payload?.execution === "deterministic"
  );
  const workIndex = events.findIndex(
    (event) =>
      event.type === "tool.started" &&
      event.payload?.toolId !== "skill.activate"
  );
  if (deterministic && workIndex >= 0)
    return skillIndex < workIndex
      ? null
      : "Skill activation did not complete before deterministic execution";
  return "plan.created event is missing";
}

function checkNoSkillTask(metadata) {
  const tasks =
    metadata.observedSnapshot?.tasks || metadata.snapshot?.tasks || [];
  const invalid = tasks.find((task) =>
    /activate[_ -]?skill|skill[ ._-]?activate|加载.*skill|激活.*skill/i.test(
      `${task.title || ""} ${task.objective || ""}`
    )
  );
  return invalid ? `Skill activation appeared as task ${invalid.id}` : null;
}

function checkWorkerTools(metadata) {
  const executions = (metadata.snapshot?.toolExecutions || []).filter(
    (execution) => execution.tool_id !== "skill.activate"
  );
  const invalid = executions.find((execution) => !execution.task_id);
  return invalid
    ? `tool ${invalid.tool_id} executed without a worker task`
    : executions.length
      ? null
      : "no worker tool execution was recorded";
}

function checkWriteIntent(metadata) {
  const tasks = metadata.snapshot?.tasks || [];
  const executions = metadata.snapshot?.toolExecutions || [];
  const events = metadata.snapshot?.events || [];
  const artifactTaskIds = new Set(
    (metadata.snapshot?.artifacts || [])
      .map((artifact) => artifact.task_id)
      .filter(Boolean)
  );
  const writeTools = new Set(
    executions
      .filter((execution) =>
        /(write|publish|convert|download|archive|move|delete|execute)/i.test(
          execution.tool_id || ""
        )
      )
      .map((execution) => execution.task_id)
  );
  const artifactWriteRequest =
    /\b(?:write|create|edit|update|append|save|publish|generate|produce|complete|download|extract|unpack|convert|copy|move|archive)\b.{0,60}\b(?:report|file|document|source|original|index|tdoc|docx|xlsx|json|ledger|manifest|markdown|zip|artifact)\b|(?:撰写|创建|写入|更新|编辑|追加|保存|发布|生成|下载|解压|提取|转换|复制|移动|归档|打包).{0,30}(?:报告|文件|文档|原文|源文件|Index|TDoc|DOCX|XLSX|JSON|台账|清单|Markdown|ZIP|ledger|manifest)/i;
  const relevant = tasks.filter(
    (task) =>
      artifactTaskIds.has(task.id) ||
      writeTools.has(task.id) ||
      artifactWriteRequest.test(
        [task.title, task.objective, ...(task.successCriteria || [])]
          .filter(Boolean)
          .join("\n")
      )
  );
  if (!relevant.length) {
    const deterministicWrite =
      events.some(
        (event) =>
          event.type === "request.classified" &&
          event.payload?.execution === "deterministic"
      ) &&
      executions.some(
        (execution) =>
          !execution.task_id &&
          /(write|publish|convert|download|archive|move|delete|execute)/i.test(
            execution.tool_id || ""
          )
      );
    return deterministicWrite ? null : "no artifact-writing task was observed";
  }
  const invalid = relevant.find(
    (task) => task.writeIntent !== true || !(task.allowedToolIds || []).length
  );
  return invalid
    ? `task ${invalid.id} wrote output without writeIntent and tools`
    : null;
}

function checkSubagentSkills(metadata) {
  const events = metadata.snapshot?.events || [];
  const primaryAgentId = Number(metadata.agent?.id);
  const started = events.filter(
    (event) =>
      event.type === "subagent.started" ||
      (event.type === "task.started" &&
        Number(event.payload?.agent?.id) !== primaryAgentId)
  );
  if (!started.length) return "no subagent was dispatched";
  const missing = started.find(
    (event) =>
      !Array.isArray(event.payload?.activatedSkills) ||
      !event.payload.activatedSkills.every(
        (skill) => skill.name && skill.revision
      )
  );
  return missing ? "a subagent did not inherit versioned Skills" : null;
}

function checkPortablePaths(metadata) {
  const values = [];
  const collect = (value) => {
    if (typeof value === "string") values.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object")
      Object.values(value).forEach(collect);
  };
  collect({
    output: metadata.snapshot?.run?.finalResponse,
    tasks: metadata.snapshot?.tasks,
    tools: (metadata.snapshot?.toolExecutions || []).filter(
      (execution) => execution.tool_id !== "skill.activate"
    ),
    artifacts: metadata.snapshot?.artifacts,
  });
  const hostPath =
    /(?:^|[\s("'])(?:[A-Za-z]:\\(?:Users|Windows|Program Files|ProgramData)\\|\/(?:root|home|Users|app\/server\/storage)\/)/;
  return values.some((value) => hostPath.test(value))
    ? "host-specific path leaked into run data"
    : null;
}

function checkArtifacts(metadata) {
  const artifacts =
    metadata.snapshot?.registeredOutputs || metadata.snapshot?.artifacts || [];
  if (!artifacts.length) return "no artifacts were registered";
  const validations = metadata.snapshot?.artifactValidation || [];
  const invalid = validations.find((item) => !item.valid);
  return invalid
    ? `artifact ${invalid.title || invalid.id} is invalid: ${invalid.error || invalid.checks?.join(", ")}`
    : validations.length
      ? null
      : "artifacts were not downloaded and validated";
}

function checkCancelRerun(metadata) {
  const cancelled = metadata.cancelledSnapshot;
  if (!cancelled) return "cancelled run snapshot is missing";
  if (cancelled.run?.status !== "cancelled")
    return `first run ended with ${cancelled.run?.status}`;
  const activeTask = (cancelled.tasks || []).find((task) =>
    ["pending", "queued", "running", "retrying"].includes(task.status)
  );
  if (activeTask) return `cancelled run left active task ${activeTask.id}`;
  const activeTool = (cancelled.toolExecutions || []).find((execution) =>
    ["requested", "running", "started", "retrying"].includes(execution.status)
  );
  if (activeTool) return `cancelled run left active tool ${activeTool.call_id}`;
  if (metadata.snapshot?.run?.status !== "completed")
    return "immediate rerun did not complete";
  const cancelledArtifactIds = new Set(
    (cancelled.artifacts || []).map((artifact) => artifact.id)
  );
  const stale = (metadata.snapshot?.artifacts || []).find((artifact) =>
    cancelledArtifactIds.has(artifact.id)
  );
  return stale ? "rerun contains an artifact from the cancelled run" : null;
}

function checkRag(metadata) {
  const uploads = metadata.uploads || [];
  if (!uploads.some((upload) => upload.destination === "rag"))
    return "fixture was not uploaded to RAG";
  if (uploads.some((upload) => upload.destination === "filesystem"))
    return "RAG case also uploaded the fixture to workspace files";
  const events = metadata.snapshot?.events || [];
  const recalled = events.some(
    (event) => event.type === "context.rag.recalled"
  );
  return recalled ? null : "Agent did not record RAG retrieval";
}

function checkOfficial3gpp(metadata) {
  const corpus = text({
    output: metadata.snapshot?.run?.finalResponse,
    tools: metadata.snapshot?.toolExecutions,
    artifacts: metadata.snapshot?.artifacts,
  });
  if (!/(3gpp\.org|3gpp\.ftp|ftp\.3gpp)/i.test(corpus))
    return "no official 3GPP source was recorded";
  if (!/\.(?:docx?|zip)\b/i.test(corpus))
    return "no Word or ZIP TDoc was recorded";
  return null;
}

const CHECKS = {
  terminal: (_output, metadata) => checkTerminal(metadata),
  noRuntimeError: checkNoRuntimeError,
  direct: (_output, metadata) => checkDirect(metadata),
  skillPreplan: (_output, metadata) => checkSkillPreplan(metadata),
  noSkillTask: (_output, metadata) => checkNoSkillTask(metadata),
  workerTools: (_output, metadata) => checkWorkerTools(metadata),
  writeIntent: (_output, metadata) => checkWriteIntent(metadata),
  subagentSkills: (_output, metadata) => checkSubagentSkills(metadata),
  portablePaths: (_output, metadata) => checkPortablePaths(metadata),
  artifacts: (_output, metadata) => checkArtifacts(metadata),
  cancelRerun: (_output, metadata) => checkCancelRerun(metadata),
  rag: (_output, metadata) => checkRag(metadata),
  official3gpp: (_output, metadata) => checkOfficial3gpp(metadata),
};

module.exports = function runtimeAssertion(output, context = {}) {
  const metadata = context.metadata || context.providerResponse?.metadata || {};
  const checks = Array.isArray(context.config?.checks)
    ? context.config.checks
    : ["terminal", "noRuntimeError"];
  const failures = [];
  for (const name of checks) {
    const check = CHECKS[name];
    if (!check) failures.push(`unknown runtime check ${name}`);
    else {
      const failure = check(output, metadata);
      if (failure) failures.push(`${name}: ${failure}`);
    }
  }
  return result(
    failures.length === 0,
    failures.length ? failures.join("; ") : `Passed: ${checks.join(", ")}`
  );
};

module.exports.CHECKS = CHECKS;
