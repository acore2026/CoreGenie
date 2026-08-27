const crypto = require("crypto");
const {
  LLMPerformanceMonitor,
} = require("../utils/helpers/chat/LLMPerformanceMonitor");
const { version: packageVersion } = require("../package.json");

const LOG_PREFIX = "\x1b[36m[Langfuse]\x1b[0m";
const REDACTED = "[REDACTED]";
const MEDIA_OMITTED = "[MEDIA OMITTED]";
const DEFAULT_LANGFUSE_BASE_URL = "https://cloud.langfuse.com";
const MAX_ATTRIBUTE_LENGTH = 200;
const DEFAULT_RELEASE = `anythingllm-${packageVersion}`;
const DEFAULT_SERVICE_NAME = "anythingllm-agent-runtime";
const NOISY_LANGCHAIN_SPANS = new Set([
  "__start__",
  "RunnableLambda",
  "ToolCallLimitMiddleware.after_agent",
  "ToolCallLimitMiddleware.after_model",
  "ToolCallLimitMiddleware.before_model",
  "ModelCallLimitMiddleware.after_agent",
  "ModelCallLimitMiddleware.after_model",
  "ModelCallLimitMiddleware.before_model",
]);

let runtime = null;
let initialized = false;
let shutdownRegistered = false;

function envBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

function numberBetween(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum)
    return fallback;
  return parsed;
}

function normalizedBaseUrl(value = DEFAULT_LANGFUSE_BASE_URL) {
  return String(value || DEFAULT_LANGFUSE_BASE_URL).replace(/\/+$/, "");
}

function noProxyMatches(url, noProxy = "") {
  const target = new URL(url);
  const hostname = target.hostname.toLowerCase();
  const port = target.port || (target.protocol === "https:" ? "443" : "80");
  return String(noProxy)
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") return true;
      const [rawHost, rawPort] = entry.split(":");
      if (rawPort && rawPort !== port) return false;
      const expected = rawHost.replace(/^\./, "");
      return hostname === expected || hostname.endsWith(`.${expected}`);
    });
}

function resolveProxyUrl(baseUrl, environment = process.env) {
  if (
    noProxyMatches(baseUrl, environment.NO_PROXY || environment.no_proxy || "")
  )
    return null;
  return (
    environment.LANGFUSE_PROXY_URL ||
    environment.HTTPS_PROXY ||
    environment.https_proxy ||
    environment.HTTP_PROXY ||
    environment.http_proxy ||
    null
  );
}

function isDataUri(value) {
  return /^data:[^;,]+(?:;[^,]*)?,/i.test(value);
}

function transformValue(value, { redact = false, key = "" } = {}) {
  if (typeof value === "string") {
    if (isDataUri(value)) return MEDIA_OMITTED;
    if (!redact) return value;
    const preserve = new Set([
      "agentId",
      "agentName",
      "id",
      "mode",
      "model",
      "name",
      "role",
      "runId",
      "runtimeKey",
      "runtimeVersion",
      "source",
      "status",
      "threadId",
      "tool",
      "toolId",
      "type",
      "userId",
      "workspaceId",
    ]);
    return preserve.has(key) ? value : REDACTED;
  }
  if (Array.isArray(value))
    return value.map((entry) => transformValue(entry, { redact, key }));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [
        entryKey,
        transformValue(entry, { redact, key: entryKey }),
      ])
    );
  return value;
}

function maskTraceData(data, { captureContent = true } = {}) {
  if (typeof data !== "string")
    return transformValue(data, { redact: !captureContent });
  try {
    return JSON.stringify(
      transformValue(JSON.parse(data), { redact: !captureContent })
    );
  } catch {
    if (isDataUri(data)) return MEDIA_OMITTED;
    return captureContent ? data : REDACTED;
  }
}

function langfuseConfiguration(environment = process.env) {
  const publicKey = environment.LANGFUSE_PUBLIC_KEY;
  const secretKey = environment.LANGFUSE_SECRET_KEY;
  const explicitlyEnabled = envBoolean(environment.LANGFUSE_ENABLED, true);
  const enabled = Boolean(explicitlyEnabled && publicKey && secretKey);
  const baseUrl = normalizedBaseUrl(environment.LANGFUSE_BASE_URL);
  return {
    enabled,
    publicKey,
    secretKey,
    baseUrl,
    proxyUrl: resolveProxyUrl(baseUrl, environment),
    captureContent: envBoolean(environment.LANGFUSE_CAPTURE_CONTENT, true),
    sampleRate: numberBetween(environment.LANGFUSE_SAMPLE_RATE, 1, 0, 1),
    timeoutSeconds: numberBetween(environment.LANGFUSE_TIMEOUT, 5, 1, 300),
    environment: environment.LANGFUSE_TRACING_ENVIRONMENT || undefined,
    release: environment.LANGFUSE_RELEASE || DEFAULT_RELEASE,
    serviceName: environment.OTEL_SERVICE_NAME || DEFAULT_SERVICE_NAME,
  };
}

function createProxyExporter(configuration) {
  const {
    OTLPTraceExporter,
  } = require("@opentelemetry/exporter-trace-otlp-http");
  const { HttpsProxyAgent } = require("https-proxy-agent");
  const authorization = Buffer.from(
    `${configuration.publicKey}:${configuration.secretKey}`
  ).toString("base64");
  const exporter = new OTLPTraceExporter({
    url: `${configuration.baseUrl}/api/public/otel/v1/traces`,
    headers: {
      Authorization: `Basic ${authorization}`,
      "x-langfuse-public-key": configuration.publicKey,
      "x-langfuse-sdk-name": "anythingllm",
    },
    timeoutMillis: configuration.timeoutSeconds * 1_000,
    httpAgentOptions: () => new HttpsProxyAgent(configuration.proxyUrl),
  });
  return {
    export(spans, callback) {
      exporter.export(spans, (result) => {
        if (result.code !== 0)
          console.error(
            `${LOG_PREFIX} Export failed: ${result.error?.message || "unknown OTLP error"}`
          );
        callback(result);
      });
    },
    shutdown: () => exporter.shutdown(),
  };
}

function shouldExportLangfuseSpan(otelSpan, defaultFilter) {
  if (NOISY_LANGCHAIN_SPANS.has(otelSpan?.name)) return false;
  return defaultFilter(otelSpan);
}

function initializeLangfuse(environment = process.env) {
  if (initialized) return runtime;
  initialized = true;
  const configuration = langfuseConfiguration(environment);
  if (!configuration.enabled) {
    console.log(`${LOG_PREFIX} Agent tracing disabled.`);
    return null;
  }

  try {
    const { NodeSDK } = require("@opentelemetry/sdk-node");
    const {
      TraceIdRatioBasedSampler,
    } = require("@opentelemetry/sdk-trace-base");
    const {
      LangfuseSpanProcessor,
      isDefaultExportSpan,
    } = require("@langfuse/otel");
    const processor = new LangfuseSpanProcessor({
      publicKey: configuration.publicKey,
      secretKey: configuration.secretKey,
      baseUrl: configuration.baseUrl,
      timeout: configuration.timeoutSeconds,
      environment: configuration.environment,
      release: configuration.release,
      exporter: configuration.proxyUrl
        ? createProxyExporter(configuration)
        : undefined,
      mask: ({ data }) =>
        maskTraceData(data, {
          captureContent: configuration.captureContent,
        }),
      shouldExportSpan: ({ otelSpan }) =>
        shouldExportLangfuseSpan(otelSpan, isDefaultExportSpan),
      mediaUploadEnabled: false,
    });
    const sdk = new NodeSDK({
      serviceName: configuration.serviceName,
      sampler: new TraceIdRatioBasedSampler(configuration.sampleRate),
      spanProcessors: [processor],
    });
    sdk.start();
    runtime = { configuration, processor, sdk };
    if (!shutdownRegistered) {
      shutdownRegistered = true;
      for (const signal of ["SIGTERM", "SIGINT"]) {
        process.once(signal, () => {
          const timer = setTimeout(() => process.exit(0), 2_000);
          shutdownLangfuse().finally(() => {
            clearTimeout(timer);
            process.exit(0);
          });
        });
      }
    }
    const destination = new URL(configuration.baseUrl).host;
    console.log(
      `${LOG_PREFIX} Agent tracing enabled for ${destination} (${configuration.proxyUrl ? "proxy" : "direct"}, content ${configuration.captureContent ? "enabled" : "hidden"}, sample ${configuration.sampleRate}).`
    );
    return runtime;
  } catch (error) {
    console.error(`${LOG_PREFIX} Initialization failed: ${error.message}`);
    runtime = null;
    return null;
  }
}

function langfuseEnabled() {
  return Boolean(runtime);
}

function compactIdentifier(value, prefix) {
  const normalized = String(value || "anonymous")
    .replace(/[^\x20-\x7E]/g, "_")
    .slice(0, 1_000);
  const candidate = `${prefix}:${normalized}`;
  if (candidate.length <= MAX_ATTRIBUTE_LENGTH) return candidate;
  return `${prefix}:sha256:${crypto.createHash("sha256").update(candidate).digest("hex")}`;
}

function traceAttributes(run) {
  const apiSessionId = run.configuration?.apiSessionId;
  const conversation = apiSessionId
    ? `api:${apiSessionId}:workspace:${run.workspace_id}:user:${run.user_id || "anonymous"}`
    : `workspace:${run.workspace_id}:thread:${run.thread_id || "root"}:user:${run.user_id || "anonymous"}`;
  const segment = run.configuration?.recover
    ? "recovery"
    : run.configuration?.resume
      ? "resume"
      : "initial";
  return {
    userId: compactIdentifier(run.user_id || "anonymous", "user"),
    sessionId: compactIdentifier(conversation, "conversation"),
    tags: [
      "anythingllm",
      `mode:${run.mode}`,
      `source:${run.source}`,
      `runtime:${run.runtimeKey || "default-react"}`,
      segment,
    ],
    metadata: {
      runId: String(run.id),
      workspaceId: String(run.workspace_id),
      threadId: String(run.thread_id || "root"),
      agentId: String(run.agent_id || "default"),
      mode: String(run.mode),
      source: String(run.source),
      approvalMode: String(run.configuration?.approvalMode || "always_allow"),
      segment,
      model: String(run.configuration?.model || "workspace-default"),
      runtimeKey: String(run.runtimeKey || "default-react"),
      runtimeVersion: String(run.runtimeVersion || 1),
    },
    version: `${run.runtimeKey || "default-react"}@${run.runtimeVersion || 1}`,
    segment,
  };
}

function stringContent(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hasReportedTokenUsage(output) {
  const tokenUsage = output?.llmOutput?.tokenUsage;
  if (
    tokenUsage &&
    Object.values(tokenUsage).some(
      (value) => typeof value === "number" && Number.isFinite(value)
    )
  )
    return true;
  return (output?.generations || []).some((group) =>
    (group || []).some((generation) => {
      const usage = generation?.message?.usage_metadata;
      return (
        usage &&
        Object.values(usage).some(
          (value) => typeof value === "number" && Number.isFinite(value)
        )
      );
    })
  );
}

function estimateTokenUsage(inputs = [], output = null) {
  const promptTokens = LLMPerformanceMonitor.countTokens(
    inputs.map((content) => ({ content: stringContent(content) }))
  );
  const completionText = (output?.generations || [])
    .flatMap((group) => group || [])
    .map((generation) =>
      stringContent(generation?.message?.content ?? generation?.text ?? "")
    )
    .join("\n");
  const completionTokens = LLMPerformanceMonitor.countTokens([
    { content: completionText },
  ]);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

function rootInput(run) {
  return {
    prompt: run.prompt,
    attachments: (run.attachments || []).map((attachment) => ({
      name: attachment?.name || attachment?.filename || null,
      type: attachment?.mime || attachment?.type || null,
    })),
  };
}

function subagentObservationName(input) {
  try {
    const parsed = typeof input === "string" ? JSON.parse(input) : input;
    const agentId = parsed?.agent_id;
    return agentId ? `subagent-${agentId}` : "subagent";
  } catch {
    return "subagent";
  }
}

function withLangfuseModel(
  extraParams,
  metadata,
  serializedModel = null,
  fallbackModel = null
) {
  const invocationParams = extraParams?.invocation_params || {};
  const model =
    invocationParams.model ||
    invocationParams.model_name ||
    metadata?.ls_model_name ||
    serializedModel?.kwargs?.model ||
    serializedModel?.kwargs?.modelName ||
    serializedModel?.kwargs?.model_name ||
    fallbackModel;
  if (!model) return extraParams;
  return {
    ...(extraParams || {}),
    invocation_params: { ...invocationParams, model },
  };
}

function ensureLangfuseResponseModel(output, model) {
  if (!model) return output;
  const generation = output?.generations?.at?.(-1)?.at?.(-1);
  const message = generation?.message;
  if (!message) return output;
  message.response_metadata = {
    ...(message.response_metadata || {}),
    model_name: message.response_metadata?.model_name || model,
  };
  return output;
}

function createAgentCallbackHandler({
  defaultModel = null,
  roleModels = {},
} = {}) {
  const { CallbackHandler } = require("@langfuse/langchain");
  const { startActiveObservation } = require("@langfuse/tracing");

  return new (class AgentCallbackHandler extends CallbackHandler {
    tokenInputs = new Map();

    async handleChatModelStart(
      llm,
      messages,
      runId,
      parentRunId,
      extraParams,
      tags,
      metadata,
      name
    ) {
      const role = metadata?.role || (metadata?.taskId ? "worker" : null);
      const normalizedParams = withLangfuseModel(
        extraParams,
        metadata,
        llm,
        roleModels?.[role] || defaultModel
      );
      this.tokenInputs.set(runId, {
        inputs: (messages || []).flatMap((group) =>
          (group || []).map((message) => message?.content ?? message)
        ),
        metadata: metadata || {},
        model: normalizedParams?.invocation_params?.model,
      });
      return super.handleChatModelStart(
        llm,
        messages,
        runId,
        parentRunId,
        normalizedParams,
        tags,
        metadata,
        name
      );
    }

    async handleLLMStart(
      llm,
      prompts,
      runId,
      parentRunId,
      extraParams,
      tags,
      metadata,
      name
    ) {
      const role = metadata?.role || (metadata?.taskId ? "worker" : null);
      const normalizedParams = withLangfuseModel(
        extraParams,
        metadata,
        llm,
        roleModels?.[role] || defaultModel
      );
      this.tokenInputs.set(runId, {
        inputs: prompts || [],
        metadata: metadata || {},
        model: normalizedParams?.invocation_params?.model,
      });
      return super.handleLLMStart(
        llm,
        prompts,
        runId,
        parentRunId,
        normalizedParams,
        tags,
        metadata,
        name
      );
    }

    async handleLLMEnd(output, runId, parentRunId) {
      const captured = this.tokenInputs.get(runId);
      this.tokenInputs.delete(runId);
      ensureLangfuseResponseModel(output, captured?.model || defaultModel);
      if (captured && !hasReportedTokenUsage(output)) {
        output.llmOutput = {
          ...(output.llmOutput || {}),
          tokenUsage: estimateTokenUsage(captured.inputs, output),
        };
        this.runMap.get(runId)?.update({
          metadata: {
            ...captured.metadata,
            usageEstimated: true,
            usageEstimator: "js-tiktoken/cl100k_base",
          },
        });
      }
      return super.handleLLMEnd(output, runId, parentRunId);
    }

    async handleToolStart(
      tool,
      input,
      runId,
      parentRunId,
      tags,
      metadata,
      name
    ) {
      const toolName = name ?? tool?.id?.at?.(-1)?.toString();
      if (toolName !== "call_agent")
        return super.handleToolStart(
          tool,
          input,
          runId,
          parentRunId,
          tags,
          metadata,
          name
        );

      try {
        const parentSpanContext = parentRunId
          ? this.runMap.get(parentRunId)?.otelSpan.spanContext()
          : undefined;
        const observation = startActiveObservation(
          subagentObservationName(input),
          (agent) => {
            agent.update({
              input,
              metadata: {
                ...(metadata || {}),
                ...(tags?.length ? { tags } : {}),
                dispatchTool: "call_agent",
              },
            });
            return agent;
          },
          { asType: "agent", parentSpanContext, endOnExit: false }
        );
        this.runMap.set(runId, observation);
      } catch (error) {
        this.logger.debug(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  })();
}

async function withAgentTrace(run, operation) {
  if (!runtime) return operation({});
  let operationStarted = false;
  let operationResult;
  let operationError;
  try {
    const {
      createTraceId,
      propagateAttributes,
      startActiveObservation,
    } = require("@langfuse/tracing");
    const attributes = traceAttributes(run);
    const traceId = await createTraceId(`anythingllm-agent-run:${run.id}`);
    const parentSpanContext = {
      traceId,
      spanId: crypto.randomBytes(8).toString("hex"),
      traceFlags: 1,
    };
    return await startActiveObservation(
      "agent-run",
      async (observation) => {
        const input = rootInput(run);
        observation.update({
          input,
          metadata: { segment: attributes.segment },
          version: attributes.version,
        });
        return propagateAttributes(
          {
            traceName: "anythingllm-agent-run",
            userId: attributes.userId,
            sessionId: attributes.sessionId,
            tags: attributes.tags,
            metadata: attributes.metadata,
            version: attributes.version,
          },
          async () => {
            const handler = createAgentCallbackHandler({
              defaultModel: run.runtimeSnapshot?.selectedModel || null,
              roleModels: run.runtimeSnapshot?.roleModels || {},
            });
            operationStarted = true;
            try {
              const result = await operation({
                callbacks: [handler],
                runName: "anythingllm-agent",
                tags: attributes.tags,
                metadata: attributes.metadata,
              });
              observation.update({
                output: {
                  status: result?.status || "completed",
                  response: result?.finalResponse || null,
                },
              });
              operationResult = result;
              return result;
            } catch (error) {
              operationError = error;
              observation.update({
                level: "ERROR",
                statusMessage: error.message,
                output: { status: "failed", error: error.message },
              });
              throw error;
            }
          }
        );
      },
      { asType: "agent", parentSpanContext }
    );
  } catch (error) {
    if (operationStarted) {
      if (operationError) throw operationError;
      console.error(
        `${LOG_PREFIX} Trace finalization failed: ${error.message}`
      );
      return operationResult;
    }
    console.error(`${LOG_PREFIX} Trace setup failed: ${error.message}`);
    return operation({});
  }
}

async function withRetrieverTrace(name, input, operation) {
  if (!runtime) return operation();
  const { startActiveObservation } = require("@langfuse/tracing");
  return startActiveObservation(
    name,
    async (observation) => {
      observation.update({ input });
      try {
        const result = await operation();
        observation.update({
          output: result,
          metadata: { resultCount: result?.length || 0 },
        });
        return result;
      } catch (error) {
        observation.update({
          level: "ERROR",
          statusMessage: error.message,
        });
        throw error;
      }
    },
    { asType: "retriever" }
  );
}

async function withAgentStepTrace(
  name,
  { input = null, metadata = {} } = {},
  operation
) {
  if (!runtime) return operation();
  const { startActiveObservation } = require("@langfuse/tracing");
  return startActiveObservation(
    name,
    async (observation) => {
      observation.update({ input, metadata });
      try {
        const result = await operation();
        observation.update({ output: result });
        return result;
      } catch (error) {
        observation.update({
          level: "ERROR",
          statusMessage: error.message,
          output: { error: error.message },
        });
        throw error;
      }
    },
    { asType: "agent" }
  );
}

function childRunnableConfig(config = {}, { tags = [], metadata = {} } = {}) {
  return {
    ...(config.callbacks ? { callbacks: config.callbacks } : {}),
    tags: [...(config.tags || []), ...tags],
    metadata: { ...(config.metadata || {}), ...metadata },
  };
}

async function flushLangfuse() {
  if (!runtime) return;
  await runtime.processor
    .forceFlush()
    .catch((error) =>
      console.error(`${LOG_PREFIX} Flush failed: ${error.message}`)
    );
}

async function shutdownLangfuse() {
  if (!runtime) return;
  const active = runtime;
  runtime = null;
  await active.sdk
    .shutdown()
    .catch((error) =>
      console.error(`${LOG_PREFIX} Shutdown failed: ${error.message}`)
    );
}

module.exports = {
  childRunnableConfig,
  compactIdentifier,
  envBoolean,
  estimateTokenUsage,
  ensureLangfuseResponseModel,
  hasReportedTokenUsage,
  flushLangfuse,
  initializeLangfuse,
  langfuseConfiguration,
  langfuseEnabled,
  maskTraceData,
  noProxyMatches,
  resolveProxyUrl,
  shouldExportLangfuseSpan,
  shutdownLangfuse,
  traceAttributes,
  subagentObservationName,
  withLangfuseModel,
  withAgentTrace,
  withAgentStepTrace,
  withRetrieverTrace,
};
