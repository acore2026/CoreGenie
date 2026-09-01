const fs = require("fs/promises");
const path = require("path");

async function configuredAgentNames(configPath) {
  const source = await fs.readFile(configPath, "utf8");
  return [
    ...new Set(
      [...source.matchAll(/^\s+agentName:\s*(.+?)\s*$/gm)].map((match) =>
        match[1].replace(/^['"]|['"]$/g, "")
      )
    ),
  ];
}

async function main() {
  const baseUrl = String(
    process.env.PROMPTFOO_ANYTHINGLLM_BASE_URL || ""
  ).replace(/\/+$/, "");
  const apiKey = process.env.PROMPTFOO_ANYTHINGLLM_API_KEY;
  if (!baseUrl || !apiKey)
    throw new Error("AnythingLLM evaluation API is not configured.");
  const response = await fetch(`${baseUrl}/v1/agents`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(`Agent API failed (${response.status}): ${payload.error}`);
  if (!Array.isArray(payload.agents) || !payload.agents.length)
    throw new Error("Agent API returned no enabled Agents.");
  if (!payload.agents.some((agent) => agent.name === "3GPP 提案分析助手"))
    throw new Error("3GPP proposal analysis Agent is unavailable.");
  const configPath =
    process.env.PROMPTFOO_CONFIG ||
    path.join(__dirname, "..", "promptfooconfig.bootstrap.yaml");
  const requested = await configuredAgentNames(configPath);
  const available = new Set(payload.agents.map((agent) => agent.name));
  const missing = requested.filter((name) => !available.has(name));
  if (missing.length)
    throw new Error(
      `Evaluation config references unavailable Agent(s): ${missing.join(", ")}`
    );
  process.stdout.write(
    `Agent API ready: ${payload.agents.length} Agent(s); ${requested.length} configured Agent(s) validated.\n`
  );
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

module.exports = { configuredAgentNames };
