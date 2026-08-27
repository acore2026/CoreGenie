const WINDOW_MS = 15 * 60 * 1_000;
const MAX_ATTEMPTS = 20;
const attempts = new Map();

function publicRegistrationRateLimit(request, response, next) {
  const now = Date.now();
  const key = request.ip || request.socket?.remoteAddress || "unknown";
  const current = attempts.get(key);

  // Keep the in-memory limiter bounded when the service is exposed directly
  // to the internet and receives traffic from many unique addresses.
  if (attempts.size > 10_000) {
    for (const [address, entry] of attempts) {
      if (entry.resetAt <= now) attempts.delete(address);
    }
  }

  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }

  if (current.count >= MAX_ATTEMPTS) {
    response.setHeader(
      "Retry-After",
      String(Math.max(1, Math.ceil((current.resetAt - now) / 1_000)))
    );
    response.status(429).json({
      success: false,
      error: "Too many registration attempts. Please try again later.",
    });
    return;
  }

  current.count += 1;
  next();
}

module.exports = {
  publicRegistrationRateLimit,
  WINDOW_MS,
  MAX_ATTEMPTS,
  attempts,
};
