const { LangfuseClient } = require("@langfuse/client");
const { v5: uuidv5 } = require("uuid");
const {
  AgentFeedbackReason,
  AgentResponseFeedback,
} = require("../models/agentFeedback");
const { agentTraceId, langfuseConfiguration } = require("./observability");

const LOG_PREFIX = "\x1b[36m[Langfuse feedback]\x1b[0m";
const RATING_SCORE_NAME = "user-response-rating";
const SYNC_INTERVAL_MS = 60_000;
const TRACE_INGESTION_GRACE_MS = 5 * 60_000;
const SCORE_NAMESPACE = uuidv5.URL;

let client = null;
let started = false;
let syncTimer = null;
let configuredScoreIds = new Map();
const queuedIds = new Set();

function scoreNameForReason(code) {
  return `user-reason-${code}`;
}

function scoreId(feedbackId, scoreName) {
  return uuidv5(
    `anythingllm-feedback:${feedbackId}:${scoreName}`,
    SCORE_NAMESPACE
  );
}

function feedbackComment(record) {
  const reasonLabels = JSON.parse(record.reasons || "[]")
    .map((reason) => reason.label)
    .filter(Boolean);
  return (
    [
      reasonLabels.length ? `原因：${reasonLabels.join("、")}` : null,
      record.comment,
    ]
      .filter(Boolean)
      .join("\n") || undefined
  );
}

function getClient(environment = process.env) {
  const configuration = langfuseConfiguration(environment);
  if (!configuration.enabled) return null;
  if (!client)
    client = new LangfuseClient({
      publicKey: configuration.publicKey,
      secretKey: configuration.secretKey,
      baseUrl: configuration.baseUrl,
      timeout: configuration.timeoutSeconds,
    });
  return client;
}

async function findScoreConfigs(langfuse) {
  const response = await langfuse.api.scoreConfigs.get({ limit: 100 });
  return new Map(
    (response.data || [])
      .filter((config) => !config.isArchived)
      .map((config) => [config.name, config])
  );
}

async function ensureScoreConfigs(langfuse, reasons) {
  const names = [
    RATING_SCORE_NAME,
    ...reasons.map(({ code }) => scoreNameForReason(code)),
  ];
  if (names.every((name) => configuredScoreIds.has(name)))
    return configuredScoreIds;

  let existing = await findScoreConfigs(langfuse);
  const definitions = [
    {
      name: RATING_SCORE_NAME,
      dataType: "CATEGORICAL",
      categories: [
        { label: "bad", value: -1 },
        { label: "neutral", value: 0 },
        { label: "good", value: 1 },
      ],
      description: "用户对单条 Agent 回复的评价。",
    },
    ...reasons.map(({ code, label }) => ({
      name: scoreNameForReason(code),
      dataType: "BOOLEAN",
      description: `用户是否选择评价原因：${label}`,
    })),
  ];

  for (const definition of definitions) {
    let config = existing.get(definition.name);
    if (!config) {
      try {
        config = await langfuse.api.scoreConfigs.create(definition);
      } catch (error) {
        if (error?.statusCode !== 409 && error?.status !== 409) throw error;
        existing = await findScoreConfigs(langfuse);
        config = existing.get(definition.name);
      }
    }
    if (config?.id) configuredScoreIds.set(definition.name, config.id);
  }
  return configuredScoreIds;
}

async function deleteRemoteScoresByName(langfuse, record, names) {
  await Promise.all(
    names.map(async (name) => {
      try {
        await langfuse.api.legacy.scoreV1.delete(scoreId(record.id, name));
      } catch (error) {
        if (error?.statusCode !== 404 && error?.status !== 404) throw error;
      }
    })
  );
}

async function deleteRemoteScores(langfuse, record, reasons) {
  return deleteRemoteScoresByName(langfuse, record, [
    RATING_SCORE_NAME,
    ...reasons.map(({ code }) => scoreNameForReason(code)),
  ]);
}

async function remoteTraceExists(langfuse, traceId) {
  const response = await langfuse.api.observations.getMany({
    traceId,
    limit: 1,
  });
  return Boolean(response.data?.length);
}

function traceMayStillBeIngesting(record) {
  const createdAt = new Date(record.createdAt).getTime();
  return (
    Number.isFinite(createdAt) &&
    Date.now() - createdAt < TRACE_INGESTION_GRACE_MS
  );
}

async function syncFeedbackRecord(record, { langfuse = getClient() } = {}) {
  if (!record || !langfuse) return false;
  try {
    const reasons = await AgentFeedbackReason.list({ enabledOnly: false });
    if (record.deletedAt) {
      await deleteRemoteScores(langfuse, record, reasons);
      await AgentResponseFeedback.markSynced(record.id);
      return true;
    }

    const traceId = await agentTraceId(record.run_id);
    if (!(await remoteTraceExists(langfuse, traceId))) {
      if (traceMayStillBeIngesting(record)) {
        await AgentResponseFeedback.markSyncError(
          record.id,
          "Langfuse trace is not available yet."
        );
        return false;
      }
      await deleteRemoteScores(langfuse, record, reasons);
      await AgentResponseFeedback.markSynced(record.id);
      console.warn(
        `${LOG_PREFIX} Skipped feedback ${record.id}: trace ${traceId} does not exist.`
      );
      return true;
    }

    let configs = new Map();
    try {
      configs = await ensureScoreConfigs(langfuse, reasons);
    } catch (error) {
      console.warn(
        `${LOG_PREFIX} Score configs unavailable; syncing without config IDs: ${error.message}`
      );
    }
    const comment = feedbackComment(record);
    langfuse.score.create({
      id: scoreId(record.id, RATING_SCORE_NAME),
      traceId,
      name: RATING_SCORE_NAME,
      value: record.rating,
      dataType: "CATEGORICAL",
      configId: configs.get(RATING_SCORE_NAME),
      comment,
      metadata: {
        source: record.source,
        workspaceId: record.workspace_id,
        agentId: record.agent_id,
        chatId: record.chat_id,
      },
    });

    const selectedCodes = new Set(
      JSON.parse(record.reasons || "[]").map((reason) => reason.code)
    );
    const selectedReasons = reasons.filter((reason) =>
      selectedCodes.has(reason.code)
    );
    const unselectedNames = reasons
      .filter((reason) => !selectedCodes.has(reason.code))
      .map((reason) => scoreNameForReason(reason.code));
    await deleteRemoteScoresByName(langfuse, record, unselectedNames);
    for (const reason of selectedReasons) {
      const name = scoreNameForReason(reason.code);
      langfuse.score.create({
        id: scoreId(record.id, name),
        traceId,
        name,
        value: 1,
        dataType: "BOOLEAN",
        configId: configs.get(name),
      });
    }
    await langfuse.score.flush();
    await AgentResponseFeedback.markSynced(record.id);
    return true;
  } catch (error) {
    await AgentResponseFeedback.markSyncError(record.id, error.message);
    console.error(`${LOG_PREFIX} ${record.id}: ${error.message}`);
    return false;
  }
}

async function syncPendingAgentFeedback() {
  if (!getClient()) return 0;
  const records = await AgentResponseFeedback.pending();
  let synced = 0;
  for (const record of records) {
    if (await syncFeedbackRecord(record)) synced += 1;
  }
  return synced;
}

function queueAgentFeedbackSync(id) {
  if (!id || queuedIds.has(id)) return;
  queuedIds.add(id);
  setImmediate(async () => {
    try {
      const record = await AgentResponseFeedback.get(id);
      if (record) await syncFeedbackRecord(record);
    } finally {
      queuedIds.delete(id);
    }
  });
}

function startAgentFeedbackSync() {
  if (started || process.env.NODE_ENV === "test") return;
  started = true;
  syncPendingAgentFeedback().catch((error) =>
    console.error(`${LOG_PREFIX} Initial sync failed: ${error.message}`)
  );
  syncTimer = setInterval(() => {
    syncPendingAgentFeedback().catch((error) =>
      console.error(`${LOG_PREFIX} Retry failed: ${error.message}`)
    );
  }, SYNC_INTERVAL_MS);
  syncTimer.unref?.();
}

function resetFeedbackSyncForTests() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
  started = false;
  client = null;
  configuredScoreIds = new Map();
  queuedIds.clear();
}

module.exports = {
  RATING_SCORE_NAME,
  deleteRemoteScores,
  ensureScoreConfigs,
  feedbackComment,
  queueAgentFeedbackSync,
  resetFeedbackSyncForTests,
  scoreId,
  scoreNameForReason,
  startAgentFeedbackSync,
  syncFeedbackRecord,
  syncPendingAgentFeedback,
};
