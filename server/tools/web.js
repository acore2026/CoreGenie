const { z } = require("zod");
const { load } = require("cheerio");
const { defineTool } = require("./descriptor");

function normalizeWebSearchResults(value, { query, maxResults = 10 } = {}) {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return {
        ok: false,
        code: /no information was found/i.test(value)
          ? "NO_RESULTS"
          : "SEARCH_UNAVAILABLE",
        summary: value || "Online search returned no results.",
        data: { query, results: [] },
        retryable: false,
      };
    }
  }

  if (!Array.isArray(parsed) || !parsed.length)
    return {
      ok: false,
      code: "NO_RESULTS",
      summary: "Online search returned no results.",
      data: { query, results: [] },
      retryable: false,
    };

  const results = parsed.slice(0, maxResults).map((item) => ({
    title: String(
      item?.title || item?.name || item?.url || item?.link || "Result"
    ),
    url: item?.url || item?.link || item?.website || null,
    snippet: String(
      item?.snippet || item?.content || item?.description || item?.text || ""
    ),
  }));
  return {
    ok: true,
    code: "OK",
    summary: `Found ${results.length} online search results for "${query}".`,
    data: results,
    retryable: false,
  };
}

async function searchWithConfiguredProvider(query) {
  // Keep the governed runtime on the same provider and credentials as the
  // existing web-browsing Agent plugin instead of maintaining two provider
  // implementations that can drift apart.
  const {
    webBrowsing,
  } = require("../utils/agents/aibitat/plugins/web-browsing");
  let definition = null;
  const host = {
    function(value) {
      definition = value;
    },
    introspect() {},
    addCitation() {},
    handlerProps: { log() {} },
  };
  webBrowsing.plugin.call(webBrowsing).setup(host);
  if (!definition?.search)
    throw new Error("The configured online search provider is unavailable.");
  return definition.search.call(definition, query);
}

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

const webSearch = defineTool({
  id: "web.search",
  name: "web_search",
  description:
    "Search the public internet using the configured Agent search provider and return titles, URLs, and snippets.",
  schema: z.object({
    query: z.string().trim().min(1),
    max_results: z.number().int().min(1).max(20).default(10),
  }),
  action: false,
  execute: async ({ query, max_results }, context) => {
    if (context.signal?.aborted) throw new Error("Agent run was cancelled.");
    const value = await searchWithConfiguredProvider(query);
    return normalizeWebSearchResults(value, {
      query,
      maxResults: max_results,
    });
  },
});

module.exports = {
  normalizeWebSearchResults,
  searchWithConfiguredProvider,
  threeGppDirectoryFailureFamily,
  webFetch,
  webSearch,
};
