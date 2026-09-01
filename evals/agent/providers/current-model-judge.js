const DEFAULT_TIMEOUT_MS = 600_000;

function completionUrl(baseUrl) {
  const normalized = String(baseUrl || "").replace(/\/+$/, "");
  if (!normalized) return "";
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

class CurrentModelJudgeProvider {
  constructor(options = {}) {
    this.providerId = options.id || "current-production-model";
    this.config = options.config || {};
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt, _context, options = {}) {
    const baseUrl = this.config.baseUrl || process.env.PROMPTFOO_JUDGE_BASE_URL;
    const apiKey = this.config.apiKey || process.env.PROMPTFOO_JUDGE_API_KEY;
    const model = this.config.model || process.env.PROMPTFOO_JUDGE_MODEL;
    const url = completionUrl(baseUrl);
    if (!url || !apiKey || !model)
      return {
        error:
          "The current-model judge is not configured. Set PROMPTFOO_JUDGE_BASE_URL, PROMPTFOO_JUDGE_API_KEY, and PROMPTFOO_JUDGE_MODEL, or select another judge in Promptfoo.",
      };

    const timeout = AbortSignal.timeout(
      Number(this.config.timeoutMs) || DEFAULT_TIMEOUT_MS
    );
    const signal = options.abortSignal
      ? AbortSignal.any([options.abortSignal, timeout])
      : timeout;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: String(prompt) }],
          temperature: 0,
        }),
        signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        return {
          error: `Judge request failed (${response.status}): ${payload?.error?.message || response.statusText}`,
          metadata: { httpStatus: response.status },
        };
      return {
        output: payload?.choices?.[0]?.message?.content || "",
        tokenUsage: payload?.usage
          ? {
              prompt: payload.usage.prompt_tokens,
              completion: payload.usage.completion_tokens,
              total: payload.usage.total_tokens,
            }
          : undefined,
        metadata: { model },
      };
    } catch (error) {
      return { error: `Judge request failed: ${error.message}` };
    }
  }
}

module.exports = CurrentModelJudgeProvider;
module.exports.completionUrl = completionUrl;
