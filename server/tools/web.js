const { z } = require("zod");
const { load } = require("cheerio");
const { defineTool } = require("./descriptor");

function threeGppDirectoryFailureFamily({ url } = {}) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== "www.3gpp.org") return null;
    const match = parsed.pathname.match(/^\/ftp\/(tsg_sa|tsg_ct)(?:\/|$)/i);
    if (!match) return null;
    const rootPath = `/ftp/${match[1].toLowerCase()}/`;
    const normalizedPath = `${parsed.pathname.replace(/\/+$/, "")}/`;
    return {
      key: `3gpp-directory:${parsed.origin}${rootPath}`,
      recovery: normalizedPath.toLowerCase() === rootPath,
      blockedSummary: `Several guessed 3GPP directory paths under ${rootPath} have already failed. Open the official parent directory ${parsed.origin}${rootPath} and follow its listed links instead of trying another alias.`,
    };
  } catch {
    return null;
  }
}

const webFetch = defineTool({
  id: "web.fetch",
  name: "web_fetch",
  description:
    "Fetch an HTTP or HTTPS URL and return readable page text. Outbound network access follows the server proxy configuration.",
  schema: z.object({
    url: z.string().url(),
    max_characters: z.number().int().min(1_000).max(100_000).default(30_000),
  }),
  action: false,
  failureFamily: threeGppDirectoryFailureFamily,
  maxFailureFamilyAttempts: 2,
  execute: async ({ url, max_characters }, context) => {
    if (context.signal?.aborted) throw new Error("Agent run was cancelled.");
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.any([
        context.signal || new AbortController().signal,
        AbortSignal.timeout(30_000),
      ]),
      headers: { "User-Agent": "AnythingLLM-Agent/1.0" },
    });
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500)
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return {
        ok: false,
        code: `HTTP_${response.status}`,
        summary: `HTTP ${response.status} ${response.statusText}`,
        data: { url, status: response.status },
        retryable: false,
        countsTowardFailureFamily: [401, 403, 404].includes(response.status),
      };
    }
    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();
    if (!contentType.includes("html")) return body.slice(0, max_characters);
    const $ = load(body);
    $("script,style,noscript,svg").remove();
    return $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max_characters);
  },
});

module.exports = { threeGppDirectoryFailureFamily, webFetch };
