const DEFAULT_REQUEST_HEADERS = {
  Accept: "text/html,text/plain;q=0.9,*/*;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (compatible; CoreGenie/1.0; +https://github.com/Mintplex-Labs/anything-llm)",
};

async function fetchPageHtml(url, { headers = {} } = {}) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      ...DEFAULT_REQUEST_HEADERS,
      ...headers,
    },
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  return await response.text();
}

module.exports = { fetchPageHtml };
