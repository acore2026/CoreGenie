const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 16;
const DEFAULT_AGENT_CONCURRENCY = 6;

function boundedConcurrency(value, fallback = DEFAULT_AGENT_CONCURRENCY) {
  if (value === undefined || value === null || String(value).trim() === "")
    return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, MIN_CONCURRENCY), MAX_CONCURRENCY);
}

function agentMaxConcurrency() {
  return boundedConcurrency(process.env.AGENT_MAX_CONCURRENCY);
}

module.exports = {
  DEFAULT_AGENT_CONCURRENCY,
  MAX_CONCURRENCY,
  MIN_CONCURRENCY,
  agentMaxConcurrency,
  boundedConcurrency,
};
