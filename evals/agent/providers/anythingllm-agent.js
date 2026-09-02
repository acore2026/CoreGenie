const path = require("path");
const AdmZip = require("adm-zip");
const { fixtureBuffer } = require("./fixtures");

const TERMINAL = new Set(["completed", "partial", "failed", "cancelled"]);
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1_000;
const DEFAULT_EVALUATION_AGENT_NAME = "3GPP 提案分析助手";
const LEGACY_AGENT_ALIASES = new Map([
  ["通用助手", DEFAULT_EVALUATION_AGENT_NAME],
]);

function parseObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw new Error(`Invalid JSON test setup: ${error.message}`);
  }
}

function safeId(value, fallback) {
  const normalized = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || fallback;
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    if (!signal) return;
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason || new Error("Evaluation aborted."));
      },
      { once: true }
    );
  });
}

function reportedWorkspaceFiles(...values) {
  const paths = new Set();
  const visit = (value) => {
    if (typeof value === "string") {
      const matches = value.matchAll(
        /\/workspace\/[^\s"'`<>|]+?\.(?:docx|xlsx?|zip|md|json|txt|csv|png|jpe?g|emf|wmf|vsdx?)(?=$|[\s"'`)\]}>，。；、])/giu
      );
      for (const match of matches) paths.add(match[0]);
      return;
    }
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  values.forEach(visit);
  return [...paths]
    .filter((storagePath) => !/[?*\[\]]/.test(storagePath))
    .map((storagePath) => ({
      id: `reported:${storagePath}`,
      title: path.posix.basename(storagePath),
      storagePath,
      kind: "reportedWorkspaceFile",
    }));
}

function snapshotReportedWorkspaceFiles(snapshot = {}) {
  return reportedWorkspaceFiles(
    snapshot.run?.finalResponse,
    (snapshot.tasks || []).map((task) => task.resultSummary || task.result)
  );
}

class AnythingLLMAgentProvider {
  constructor(options = {}) {
    this.providerId = options.id || "anythingllm-live-agent";
    this.config = options.config || {};
    this.baseUrl = String(
      this.config.baseUrl ||
        process.env.PROMPTFOO_ANYTHINGLLM_BASE_URL ||
        "http://host.docker.internal:7555/api"
    ).replace(/\/+$/, "");
    this.apiKey =
      this.config.apiKey || process.env.PROMPTFOO_ANYTHINGLLM_API_KEY;
    this.fixtureRoot = this.config.fixtureRoot || "/opt/anythingllm-evals";
  }

  id() {
    return this.providerId;
  }

  headers(extra = {}) {
    if (!this.apiKey)
      throw new Error("PROMPTFOO_ANYTHINGLLM_API_KEY is not configured.");
    return { Authorization: `Bearer ${this.apiKey}`, ...extra };
  }

  async request(route, options = {}) {
    const { raw = false, ...fetchOptions } = options;
    const response = await fetch(`${this.baseUrl}${route}`, {
      ...fetchOptions,
      headers: this.headers(fetchOptions.headers),
    });
    const type = response.headers.get("content-type") || "";
    const payload =
      !raw && type.includes("application/json")
        ? await response.json()
        : await response.arrayBuffer();
    if (!response.ok) {
      const detail =
        payload?.error ||
        payload?.message ||
        response.statusText ||
        "Request failed";
      const error = new Error(
        `${options.method || "GET"} ${route} failed (${response.status}): ${detail}`
      );
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async resolveAgent(agentId, agentName) {
    const { agents, defaultAgentId } = await this.request("/v1/agents");
    const requestedName = String(agentName || "").trim();
    const resolvedName =
      LEGACY_AGENT_ALIASES.get(requestedName) || requestedName;
    const selected = agentId
      ? agents.find((agent) => agent.id === Number(agentId))
      : resolvedName
        ? agents.find((agent) => agent.name === resolvedName)
        : agents.find((agent) => agent.id === defaultAgentId) ||
          agents.find(
            (agent) => agent.name === DEFAULT_EVALUATION_AGENT_NAME
          ) ||
          agents[0];
    if (!selected)
      throw new Error(
        `Evaluation Agent is unavailable: ${requestedName || agentId || "default"}. Enabled Agents: ${agents.map((agent) => agent.name).join(", ") || "none"}`
      );
    return selected;
  }

  async createWorkspace(name) {
    const payload = await this.request("/v1/workspace/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, chatMode: "automatic" }),
    });
    if (!payload.workspace?.slug)
      throw new Error(
        payload.message || "AnythingLLM did not create a workspace."
      );
    return payload.workspace;
  }

  async createThread(workspace, name) {
    const slug = `${safeId(name, "attempt")}-${Date.now().toString(36)}`;
    const payload = await this.request(
      `/v1/workspace/${encodeURIComponent(workspace.slug)}/thread/new`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug }),
      }
    );
    if (!payload.thread?.slug)
      throw new Error(
        payload.message || "AnythingLLM did not create a thread."
      );
    return payload.thread;
  }

  async uploadFixture(workspace, spec) {
    const buffer = await fixtureBuffer(spec, this.fixtureRoot);
    const name = String(spec.name || spec.path || "fixture.txt");
    const form = new FormData();
    form.append("file", new Blob([buffer]), name);
    if (spec.destination === "rag") {
      form.append("addToWorkspaces", workspace.slug);
      const payload = await this.request("/v1/document/upload", {
        method: "POST",
        body: form,
      });
      return { destination: "rag", name, documents: payload.documents || [] };
    }
    form.append("destination", "attachment");
    const payload = await this.request(
      `/v1/workspace/${encodeURIComponent(workspace.slug)}/files/upload`,
      { method: "POST", body: form }
    );
    return {
      destination: "filesystem",
      name,
      file: payload.file,
      attachment: {
        name: payload.file.name,
        mime: payload.file.mime,
        contentString: `/workspace/${payload.file.path}`,
      },
    };
  }

  async startRun({
    workspace,
    thread,
    agent,
    prompt,
    attachments,
    evaluation,
  }) {
    return this.request(
      `/v1/workspace/${encodeURIComponent(workspace.slug)}/thread/${encodeURIComponent(thread.slug)}/agent-runs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: prompt,
          agentId: agent.id,
          mode: "automatic",
          attachments,
          maxRuntimeMs: evaluation.maxRuntimeMs,
          evaluation: {
            evaluationId: evaluation.evaluationId,
            suiteId: evaluation.suiteId,
            caseId: evaluation.caseId,
            attempt: evaluation.attempt,
          },
        }),
      }
    ).then((payload) => payload.run);
  }

  async cancelRun(runId) {
    let lastError;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        return await this.request(
          `/v1/agent-runs/${encodeURIComponent(runId)}/commands`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "cancel",
              commandId: `promptfoo-cancel-${runId}`,
            }),
          }
        );
      } catch (error) {
        lastError = error;
        if (attempt < 5) await delay(200 * attempt);
      }
    }
    return { success: false, error: lastError?.message || "Cancel failed." };
  }

  async waitForRun(
    run,
    { timeoutMs, signal, cancelAfterTaskStart = false, cancelAfterPlan = false }
  ) {
    const startedAt = Date.now();
    let cancellationSent = false;
    while (true) {
      const snapshot = await this.request(
        `/v1/agent-runs/${encodeURIComponent(run.id)}/snapshot?events=full`,
        { signal }
      );
      if (
        (cancelAfterTaskStart || cancelAfterPlan) &&
        !cancellationSent &&
        snapshot.events.some((event) =>
          cancelAfterPlan
            ? event.type === "plan.created"
            : event.type === "task.started"
        )
      ) {
        const cancelled = await this.cancelRun(run.id);
        if (cancelled?.success === false)
          throw new Error(cancelled.error || "Agent cancellation failed.");
        cancellationSent = true;
      }
      if (TERMINAL.has(snapshot.run.status))
        return { snapshot, cancellationSent };
      if (
        ["waiting_for_input", "waiting_for_approval"].includes(
          snapshot.run.status
        )
      )
        throw new Error(
          `Agent run stopped for interactive ${snapshot.run.status}.`
        );
      if (Date.now() - startedAt > timeoutMs) {
        await this.cancelRun(run.id);
        throw new Error(`Agent run timed out after ${timeoutMs} ms.`);
      }
      await delay(Number(this.config.pollIntervalMs) || 1_000, signal);
    }
  }

  async validateArtifacts(workspace, artifacts = []) {
    const results = [];
    for (const artifact of artifacts) {
      const storagePath = String(artifact.storagePath || "").replace(
        /^\/workspace\/?/,
        ""
      );
      const result = {
        id: artifact.id,
        title: artifact.title,
        storagePath,
        valid: false,
        checks: [],
      };
      if (!storagePath) {
        result.checks.push("no workspace file path");
        results.push(result);
        continue;
      }
      try {
        const payload = await this.request(
          `/v1/workspace/${encodeURIComponent(workspace.slug)}/files/download?path=${encodeURIComponent(storagePath)}`,
          { raw: true }
        );
        const buffer = Buffer.from(payload);
        result.byteSize = buffer.length;
        result.valid = buffer.length > 0;
        result.checks.push(result.valid ? "non-empty" : "empty");
        const extension = path.extname(storagePath).toLowerCase();
        if ([".docx", ".xlsx", ".zip"].includes(extension)) {
          const archive = new AdmZip(buffer);
          const entries = archive.getEntries().map((entry) => entry.entryName);
          result.entries = entries;
          result.valid = result.valid && entries.length > 0;
          result.checks.push("valid ZIP container");
          if (extension === ".docx") {
            const required = ["[Content_Types].xml", "word/document.xml"];
            const missing = required.filter(
              (entry) => !entries.includes(entry)
            );
            result.valid = result.valid && missing.length === 0;
            result.checks.push(
              missing.length
                ? `missing ${missing.join(", ")}`
                : "valid DOCX package"
            );
          }
          if (extension === ".xlsx") {
            const required = ["[Content_Types].xml", "xl/workbook.xml"];
            const missing = required.filter(
              (entry) => !entries.includes(entry)
            );
            result.valid = result.valid && missing.length === 0;
            result.checks.push(
              missing.length
                ? `missing ${missing.join(", ")}`
                : "valid XLSX package"
            );
          }
        }
      } catch (error) {
        result.error = error.message;
        result.valid = false;
      }
      results.push(result);
    }
    return results;
  }

  async execute(prompt, context, signal, overrides = {}) {
    const vars = context?.vars || {};
    const setup = parseObject(vars.setup, {});
    const caseId = safeId(
      overrides.caseId || vars.caseId || context?.testCaseId,
      "case"
    );
    const evaluationId = safeId(
      context?.evaluationId || `manual-${Date.now().toString(36)}`,
      "manual"
    );
    const attempt = Number(context?.repeatIndex ?? 0) + 1;
    const workspaceName = `eval-${evaluationId}-${caseId}-${attempt}`.slice(
      0,
      90
    );
    // Resolve first so a stale or disabled Agent reference cannot leave an
    // empty evaluation workspace behind.
    const agent = await this.resolveAgent(vars.agentId, vars.agentName);
    const workspace = await this.createWorkspace(workspaceName);
    const thread = await this.createThread(workspace, `${caseId}-${attempt}`);
    const uploads = [];
    for (const fixture of setup.files || [])
      uploads.push(await this.uploadFixture(workspace, fixture));
    const attachments = uploads
      .map((upload) => upload.attachment)
      .filter(Boolean);
    const evaluation = {
      evaluationId,
      suiteId: safeId(vars.suiteId, "runtime-3gpp-v0"),
      caseId,
      attempt,
      maxRuntimeMs: Math.min(
        Number(setup.timeoutMs) || DEFAULT_TIMEOUT_MS,
        DEFAULT_TIMEOUT_MS
      ),
    };
    const run = await this.startRun({
      workspace,
      thread,
      agent,
      prompt: overrides.prompt || String(prompt),
      attachments,
      evaluation,
    });
    let result;
    try {
      result = await this.waitForRun(run, {
        timeoutMs: evaluation.maxRuntimeMs,
        signal,
        cancelAfterTaskStart: overrides.cancelAfterTaskStart,
        cancelAfterPlan: overrides.cancelAfterPlan,
      });
    } catch (error) {
      await this.cancelRun(run.id);
      throw error;
    }
    result.snapshot.artifactValidation = await this.validateArtifacts(
      workspace,
      [
        ...(result.snapshot.artifacts || []),
        ...(result.snapshot.events || [])
          .filter(
            (event) =>
              event.type === "knowledge.published" && event.payload?.sourcePath
          )
          .map((event) => ({
            id: `publication:${event.payload.publicationId || event.id}`,
            title: path.basename(event.payload.sourcePath),
            storagePath: event.payload.sourcePath,
            kind: "publication",
          })),
        ...snapshotReportedWorkspaceFiles(result.snapshot),
      ].filter(
        (item, index, items) =>
          items.findIndex(
            (candidate) => candidate.storagePath === item.storagePath
          ) === index
      )
    );
    result.snapshot.registeredOutputs = result.snapshot.artifactValidation.map(
      (item) => ({
        id: item.id,
        title: item.title,
        storagePath: item.storagePath,
      })
    );
    return {
      ...result,
      agent,
      workspace,
      thread,
      uploads,
      evaluation,
    };
  }

  async callApi(prompt, context = {}, options = {}) {
    const timeout = AbortSignal.timeout(
      Number(parseObject(context.vars?.setup, {}).timeoutMs) ||
        DEFAULT_TIMEOUT_MS
    );
    const signal = options.abortSignal
      ? AbortSignal.any([options.abortSignal, timeout])
      : timeout;
    let currentRun = null;
    try {
      const setup = parseObject(context.vars?.setup, {});
      const controlledRerun = [
        "cancel-and-rerun",
        "cancel-after-plan-and-rerun",
      ].includes(setup.control);
      const primary = await this.execute(prompt, context, signal, {
        cancelAfterTaskStart: setup.control === "cancel-and-rerun",
        cancelAfterPlan: setup.control === "cancel-after-plan-and-rerun",
      });
      currentRun = primary.snapshot.run;
      let effective = primary;
      let cancelled = null;
      if (controlledRerun) {
        cancelled = primary;
        if (primary.snapshot.run.status !== "cancelled")
          throw new Error("Cancellation case did not reach cancelled state.");
        effective = await this.execute(
          setup.rerunPrompt || "Reply with exactly: rerun-ok",
          context,
          signal,
          { caseId: `${context.vars?.caseId || "cancel"}-rerun` }
        );
        currentRun = effective.snapshot.run;
      }
      const run = effective.snapshot.run;
      if (!["completed", "partial"].includes(run.status))
        throw new Error(run.error || `Agent run ended with ${run.status}.`);
      return {
        output: run.finalResponse || "",
        metadata: {
          evaluation: effective.evaluation,
          agent: effective.agent,
          workspace: effective.workspace,
          thread: effective.thread,
          uploads: effective.uploads,
          snapshot: effective.snapshot,
          cancelledSnapshot: cancelled?.snapshot || null,
          observedSnapshot: cancelled?.snapshot || null,
          traceId: effective.snapshot.traceId,
        },
      };
    } catch (error) {
      if (currentRun && !TERMINAL.has(currentRun.status))
        await this.cancelRun(currentRun.id);
      return {
        error: error.message,
        metadata: {
          evaluationId: context.evaluationId,
          testCaseId: context.testCaseId,
          runId: currentRun?.id || null,
        },
      };
    }
  }
}

module.exports = AnythingLLMAgentProvider;
module.exports.DEFAULT_EVALUATION_AGENT_NAME = DEFAULT_EVALUATION_AGENT_NAME;
module.exports.parseObject = parseObject;
module.exports.reportedWorkspaceFiles = reportedWorkspaceFiles;
module.exports.safeId = safeId;
module.exports.snapshotReportedWorkspaceFiles = snapshotReportedWorkspaceFiles;
