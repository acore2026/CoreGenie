const fs = require("fs/promises");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { ApiKey } = require("../models/apiKeys");

const KEY_NAME = "promptfoo-evaluation";

function oneLine(value) {
  return String(value || "")
    .replace(/[\r\n]/g, "")
    .trim();
}

function judgeConfiguration() {
  const provider = oneLine(process.env.LLM_PROVIDER).toLowerCase();
  if (
    ["generic-openai", "generic-open-ai"].includes(provider) ||
    process.env.GENERIC_OPEN_AI_BASE_PATH
  ) {
    return {
      baseUrl: oneLine(process.env.GENERIC_OPEN_AI_BASE_PATH),
      apiKey: oneLine(process.env.GENERIC_OPEN_AI_API_KEY),
      model: oneLine(process.env.GENERIC_OPEN_AI_MODEL_PREF),
    };
  }
  if (provider === "openai" || process.env.OPEN_AI_KEY) {
    return {
      baseUrl:
        oneLine(process.env.OPEN_AI_BASE_PATH) || "https://api.openai.com/v1",
      apiKey: oneLine(process.env.OPEN_AI_KEY),
      model: oneLine(
        process.env.OPEN_MODEL_PREF || process.env.OPEN_AI_MODEL_PREF
      ),
    };
  }
  return { baseUrl: "", apiKey: "", model: "" };
}

function containerReachableUrl(value) {
  return oneLine(value)
    .replace("http://localhost", "http://host.docker.internal")
    .replace("http://127.0.0.1", "http://host.docker.internal");
}

async function main() {
  const outputPath = path.resolve(
    process.env.PROMPTFOO_SECRET_FILE ||
      path.resolve(
        process.env.STORAGE_DIR || "storage",
        "promptfoo/secrets.env"
      )
  );
  let apiKey = await ApiKey.get({ name: KEY_NAME });
  if (!apiKey) {
    const created = await ApiKey.create(null, KEY_NAME);
    if (!created.apiKey)
      throw new Error(created.error || "Unable to create API key.");
    apiKey = created.apiKey;
  }
  const judge = judgeConfiguration();
  const values = {
    PROMPTFOO_ANYTHINGLLM_API_KEY: oneLine(apiKey.secret),
    PROMPTFOO_ANYTHINGLLM_BASE_URL: containerReachableUrl(
      process.env.PROMPTFOO_ANYTHINGLLM_BASE_URL ||
        "http://host.docker.internal:7555/api"
    ),
    PROMPTFOO_JUDGE_BASE_URL: containerReachableUrl(judge.baseUrl),
    PROMPTFOO_JUDGE_API_KEY: judge.apiKey,
    PROMPTFOO_JUDGE_MODEL: judge.model,
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${oneLine(value)}`)
      .join("\n")}\n`,
    { mode: 0o600 }
  );
  await fs.chmod(outputPath, 0o600);
  process.stdout.write(
    `Promptfoo evaluation credentials are ready at ${outputPath}.\n`
  );
}

if (require.main === module)
  main()
    .catch((error) => {
      console.error(
        `Unable to prepare Promptfoo credentials: ${error.message}`
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      const prisma = require("../utils/prisma");
      await prisma.$disconnect();
    });

module.exports = { containerReachableUrl, judgeConfiguration, main, oneLine };
