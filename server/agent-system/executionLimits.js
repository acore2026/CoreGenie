const UNBOUNDED_RECURSION_LIMIT = 1_000_000;

function executionLimitsDisabled(run = {}) {
  return run.configuration?.disableExecutionLimits === true;
}

function recursionLimitFor(run, boundedLimit) {
  return executionLimitsDisabled(run)
    ? UNBOUNDED_RECURSION_LIMIT
    : boundedLimit;
}

module.exports = {
  UNBOUNDED_RECURSION_LIMIT,
  executionLimitsDisabled,
  recursionLimitFor,
};
