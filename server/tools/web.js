const { z } = require("zod");
const { load } = require("cheerio");
const { defineTool } = require("./descriptor");

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
    if (!response.ok)
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
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

module.exports = { webFetch };
