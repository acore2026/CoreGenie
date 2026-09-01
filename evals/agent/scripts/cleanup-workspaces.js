const RETENTION_MS = 24 * 60 * 60 * 1_000;

function loadEnvFile(content) {
  return Object.fromEntries(
    String(content)
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

async function apiRequest(baseUrl, apiKey, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { Authorization: `Bearer ${apiKey}`, ...options.headers },
  });
  if (!response.ok)
    throw new Error(`${options.method || "GET"} ${route}: ${response.status}`);
  if (response.status === 204 || response.headers.get("content-length") === "0")
    return null;
  return response.json().catch(() => null);
}

async function main() {
  const fs = require("fs/promises");
  const secretFile =
    process.env.PROMPTFOO_SECRET_FILE || "/run/secrets/promptfoo.env";
  const needsSecretFile =
    !process.env.PROMPTFOO_ANYTHINGLLM_BASE_URL ||
    !process.env.PROMPTFOO_ANYTHINGLLM_API_KEY;
  const env = needsSecretFile
    ? loadEnvFile(await fs.readFile(secretFile, "utf8"))
    : {};
  const baseUrl =
    process.env.PROMPTFOO_ANYTHINGLLM_BASE_URL ||
    env.PROMPTFOO_ANYTHINGLLM_BASE_URL;
  const apiKey =
    process.env.PROMPTFOO_ANYTHINGLLM_API_KEY ||
    env.PROMPTFOO_ANYTHINGLLM_API_KEY;
  if (!baseUrl || !apiKey)
    throw new Error("Promptfoo API credentials are missing.");
  const removeAll = process.argv.includes("--all");
  const cutoff = Date.now() - RETENTION_MS;
  const payload = await apiRequest(baseUrl, apiKey, "/v1/workspaces");
  const targets = (payload.workspaces || []).filter((workspace) => {
    if (!String(workspace.slug || "").startsWith("eval-")) return false;
    if (removeAll) return true;
    const createdAt = new Date(workspace.createdAt).getTime();
    return Number.isFinite(createdAt) && createdAt < cutoff;
  });
  for (const workspace of targets) {
    await apiRequest(
      baseUrl,
      apiKey,
      `/v1/workspace/${encodeURIComponent(workspace.slug)}`,
      { method: "DELETE" }
    );
  }
  process.stdout.write(`Removed ${targets.length} evaluation workspace(s).\n`);
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

module.exports = { RETENTION_MS, loadEnvFile };
