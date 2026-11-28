const { SystemSettings } = require("../../models/systemSettings");

const SUPPORTED_SEARCH_PROVIDERS = Object.freeze([
  "tavily-search",
  "exa-search",
  "baidu-search",
  "searxng-engine",
  "duckduckgo-engine",
]);

function middleTruncate(str, length = 5) {
  const value = String(str || "");
  if (value.length <= length) return value;
  const half = Math.floor(length / 2);
  return `${value.slice(0, half)}...${value.slice(-half)}`;
}

function extractDuckDuckGoUrl(ddgLink) {
  if (!ddgLink) return ddgLink;
  try {
    const fullUrl = ddgLink.startsWith("//") ? `https:${ddgLink}` : ddgLink;
    const url = new URL(fullUrl);
    const actualUrl = url.searchParams.get("uddg");
    return actualUrl ? decodeURIComponent(actualUrl) : ddgLink;
  } catch {
    return ddgLink;
  }
}

function normalizeBaiduReferences(references = []) {
  if (!Array.isArray(references)) return [];
  const seenLinks = new Set();
  return references
    .filter((ref) => {
      if (!ref) return false;
      const type = String(ref.type || ref.resource_type || "web").toLowerCase();
      return type === "web";
    })
    .map((ref) => {
      const title = String(ref.title || ref.web_anchor || "").trim();
      const link = String(ref.url || "").trim();
      const snippet = String(ref.snippet || ref.content || "").trim();
      if (!title || !link || seenLinks.has(link)) return null;
      seenLinks.add(link);
      return { title, link, snippet };
    })
    .filter(Boolean);
}

async function tavilySearch(query) {
  if (!process.env.AGENT_TAVILY_API_KEY)
    return "Search is disabled and no content was found. Tavily API key is not configured.";

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.AGENT_TAVILY_API_KEY,
        query,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `${res.status} - ${res.statusText}. params: ${JSON.stringify({ auth: middleTruncate(process.env.AGENT_TAVILY_API_KEY), q: query })}`
      );
    }
    const response = await res.json();
    const data = (response.results || []).map(({ title, url, content }) => ({
      title,
      link: url,
      snippet: content,
    }));
    if (data.length === 0)
      return "No information was found online for the search query.";
    return JSON.stringify(data);
  } catch (error) {
    console.error(`Tavily Search Error: ${error.message}`);
    return `There was an error searching for content. ${error.message}`;
  }
}

async function exaSearch(query) {
  if (!process.env.AGENT_EXA_API_KEY)
    return "Search is disabled and no content was found. Exa API key is not configured.";

  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.AGENT_EXA_API_KEY,
      },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: 10,
        contents: { text: true },
      }),
    });
    if (!res.ok) {
      throw new Error(
        `${res.status} - ${res.statusText}. params: ${JSON.stringify({ auth: middleTruncate(process.env.AGENT_EXA_API_KEY), q: query })}`
      );
    }
    const response = await res.json();
    const data = (response.results || []).map(
      ({ title, url, text, publishedDate }) => ({
        title,
        link: url,
        snippet: text,
        publishedDate,
      })
    );
    if (data.length === 0)
      return "No information was found online for the search query.";
    return JSON.stringify(data);
  } catch (error) {
    console.error(`Exa Search Error: ${error.message}`);
    return `There was an error searching for content. ${error.message}`;
  }
}

async function baiduSearch(query) {
  if (!process.env.AGENT_BAIDU_SEARCH_API_KEY)
    return "Search is disabled and no content was found. Baidu Search API key is not configured.";

  try {
    const res = await fetch(
      "https://qianfan.baidubce.com/v2/ai_search/web_search",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.AGENT_BAIDU_SEARCH_API_KEY}`,
          "X-Appbuilder-Authorization": `Bearer ${process.env.AGENT_BAIDU_SEARCH_API_KEY}`,
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: query }],
          resource_type_filter: [{ type: "web", top_k: 10 }],
        }),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `${res.status} - ${res.statusText}. params: ${JSON.stringify({
          auth: middleTruncate(process.env.AGENT_BAIDU_SEARCH_API_KEY),
          q: query,
          body: body.slice(0, 300),
        })}`
      );
    }
    const response = await res.json();
    if ((response?.code || response?.message) && !response?.references)
      return `There was an error searching for content. ${response?.message || response?.code}`;

    const data = normalizeBaiduReferences(response?.references);
    if (data.length === 0)
      return "No information was found online for the search query.";
    return JSON.stringify(data);
  } catch (error) {
    console.error(`Baidu Search Error: ${error.message}`);
    return `There was an error searching for content. ${error.message}`;
  }
}

async function searxngSearch(query) {
  if (!process.env.AGENT_SEARXNG_API_URL)
    return "Search is disabled and no content was found. SearXNG API base URL is not configured.";

  let searchURL;
  try {
    searchURL = new URL(process.env.AGENT_SEARXNG_API_URL);
    searchURL.searchParams.append("q", query);
    searchURL.searchParams.append("format", "json");
  } catch (error) {
    console.error(`SearXNG Search: ${error.message}`);
    return "Search is disabled and no content was found. SearXNG API base URL is invalid.";
  }

  try {
    const res = await fetch(searchURL.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "anything-llm",
      },
    });
    if (!res.ok) {
      throw new Error(
        `${res.status} - ${res.statusText}. params: ${JSON.stringify({ url: searchURL.toString() })}`
      );
    }
    const response = await res.json();
    const data = (response.results || []).map(
      ({ url, title, content, publishedDate }) => ({
        title,
        link: url,
        snippet: content,
        publishedDate,
      })
    );
    if (data.length === 0)
      return "No information was found online for the search query.";
    return JSON.stringify(data);
  } catch (error) {
    console.error(`SearXNG Search Error: ${error.message}`);
    return `There was an error searching for content. ${error.message}`;
  }
}

async function duckDuckGoSearch(query) {
  const searchURL = new URL("https://html.duckduckgo.com/html");
  searchURL.searchParams.append("q", query);

  try {
    const res = await fetch(searchURL.toString());
    if (!res.ok) {
      throw new Error(
        `${res.status} - ${res.statusText}. params: ${JSON.stringify({ url: searchURL.toString() })}`
      );
    }
    const html = await res.text();
    const data = [];
    const results = html.split('<div class="result results_links');
    for (let i = 1; i < results.length; i++) {
      const result = results[i];
      const titleMatch = result.match(
        /<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/
      );
      const urlMatch = result.match(
        /<a[^>]*class="result__a"[^>]*href="([^"]*)">/
      );
      const snippetMatch = result.match(
        /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/
      );
      const title = titleMatch ? titleMatch[1].trim() : "";
      const link = extractDuckDuckGoUrl(urlMatch ? urlMatch[1] : "");
      const snippet = snippetMatch
        ? snippetMatch[1].replace(/<\/?b>/g, "").trim()
        : "";
      if (title && link && snippet) data.push({ title, link, snippet });
    }
    if (data.length === 0)
      return "No information was found online for the search query.";
    return JSON.stringify(data);
  } catch (error) {
    console.error(`DuckDuckGo Search Error: ${error.message}`);
    return "There was an error searching DuckDuckGo.";
  }
}

const PROVIDERS = {
  "tavily-search": tavilySearch,
  "exa-search": exaSearch,
  "baidu-search": baiduSearch,
  "searxng-engine": searxngSearch,
  "duckduckgo-engine": duckDuckGoSearch,
};

async function searchWeb(query) {
  const provider =
    (await SystemSettings.get({ label: "agent_search_provider" }))?.value ??
    "duckduckgo-engine";
  const runner = PROVIDERS[provider] || duckDuckGoSearch;
  return runner(query);
}

module.exports = {
  SUPPORTED_SEARCH_PROVIDERS,
  searchWeb,
};
