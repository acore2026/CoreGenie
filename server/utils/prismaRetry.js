const TRANSIENT_PRISMA_CODES = new Set(["P1008", "P2024", "P2034"]);
let operationTail = Promise.resolve();

function isTransientPrismaError(error) {
  if (!error) return false;
  if (TRANSIENT_PRISMA_CODES.has(error.code)) return true;
  return /database is locked|timed out (?:during query execution|fetching a new connection)|transaction.*(?:timed out|write conflict)/i.test(
    String(error.message || "")
  );
}

async function retryPrismaOperation(operation, attempts) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientPrismaError(error) || attempt >= attempts) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, 25 * 2 ** (attempt - 1))
      );
    }
  }
  throw lastError;
}

function withPrismaRetry(operation, { attempts = 3 } = {}) {
  const pending = operationTail
    .catch(() => null)
    .then(() => retryPrismaOperation(operation, attempts));
  operationTail = pending;
  return pending;
}

module.exports = {
  TRANSIENT_PRISMA_CODES,
  isTransientPrismaError,
  withPrismaRetry,
};
