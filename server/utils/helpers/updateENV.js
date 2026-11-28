const { resetAllVectorStores } = require("../vectorStore/resetAllVectorStores");

const KEY_MAPPING = {
  LLMProvider: {
    envKey: "LLM_PROVIDER",
    checks: [isNotEmpty, supportedLLM],
  },
  // OpenAI Settings
  OpenAiKey: {
    envKey: "OPEN_AI_KEY",
    checks: [isNotEmpty, validOpenAIKey],
  },
  OpenAiModelPref: {
    envKey: "OPEN_MODEL_PREF",
    checks: [isNotEmpty],
  },
  // Generic OpenAI Inference Settings
  GenericOpenAiBasePath: {
    envKey: "GENERIC_OPEN_AI_BASE_PATH",
    checks: [isValidURL],
  },
  GenericOpenAiModelPref: {
    envKey: "GENERIC_OPEN_AI_MODEL_PREF",
    checks: [isNotEmpty],
  },
  GenericOpenAiTokenLimit: {
    envKey: "GENERIC_OPEN_AI_MODEL_TOKEN_LIMIT",
    checks: [nonZero],
  },
  GenericOpenAiKey: {
    envKey: "GENERIC_OPEN_AI_API_KEY",
    checks: [],
  },
  GenericOpenAiMaxTokens: {
    envKey: "GENERIC_OPEN_AI_MAX_TOKENS",
    checks: [nonZero],
  },

  // Embedding Settings
  EmbeddingEngine: {
    envKey: "EMBEDDING_ENGINE",
    checks: [supportedEmbeddingModel],
    postUpdate: [handleVectorStoreReset],
  },
  EmbeddingBasePath: {
    envKey: "EMBEDDING_BASE_PATH",
    checks: [isNotEmpty, validDockerizedUrl],
  },
  EmbeddingModelPref: {
    envKey: "EMBEDDING_MODEL_PREF",
    checks: [isNotEmpty],
    postUpdate: [handleVectorStoreReset, downloadEmbeddingModelIfRequired],
  },
  EmbeddingModelMaxChunkLength: {
    envKey: "EMBEDDING_MODEL_MAX_CHUNK_LENGTH",
    checks: [nonZero],
  },
  EmbeddingOutputDimensions: {
    envKey: "EMBEDDING_OUTPUT_DIMENSIONS",
    checks: [],
  },
  GenericOpenAiEmbeddingApiKey: {
    envKey: "GENERIC_OPEN_AI_EMBEDDING_API_KEY",
    checks: [],
  },
  GenericOpenAiEmbeddingMaxConcurrentChunks: {
    envKey: "GENERIC_OPEN_AI_EMBEDDING_MAX_CONCURRENT_CHUNKS",
    checks: [nonZero],
  },
  GenericOpenAiEmbeddingPassagePrefix: {
    envKey: "GENERIC_OPEN_AI_EMBEDDING_PASSAGE_PREFIX",
    checks: [],
  },
  GenericOpenAiEmbeddingQueryPrefix: {
    envKey: "GENERIC_OPEN_AI_EMBEDDING_QUERY_PREFIX",
    checks: [],
  },

  // Vector Database Selection Settings
  VectorDB: {
    envKey: "VECTOR_DB",
    checks: [isNotEmpty, supportedVectorDB],
    postUpdate: [handleVectorStoreReset],
  },
  PGVectorConnectionString: {
    envKey: "PGVECTOR_CONNECTION_STRING",
    checks: [isNotEmpty, looksLikePostgresConnectionString],
    preUpdate: [validatePGVectorConnectionString],
  },
  PGVectorTableName: {
    envKey: "PGVECTOR_TABLE_NAME",
    checks: [isNotEmpty],
    preUpdate: [validatePGVectorTableName],
  },

  // System Settings
  AuthToken: {
    envKey: "AUTH_TOKEN",
    checks: [requiresForceMode, noRestrictedChars],
  },
  JWTSecret: {
    envKey: "JWT_SECRET",
    checks: [requiresForceMode],
  },

  // Agent Web Search ENVs
  AgentTavilyApiKey: {
    envKey: "AGENT_TAVILY_API_KEY",
    checks: [],
  },
  AgentExaApiKey: {
    envKey: "AGENT_EXA_API_KEY",
    checks: [],
  },
  AgentBaiduSearchApiKey: {
    envKey: "AGENT_BAIDU_SEARCH_API_KEY",
    checks: [],
  },
  AgentSearXNGApiUrl: {
    envKey: "AGENT_SEARXNG_API_URL",
    checks: [],
  },

  // Agent Skill Settings
  AgentSkillMaxToolCalls: {
    envKey: "AGENT_MAX_TOOL_CALLS",
    checks: [nonZero],
  },
  AgentSkillRerankerEnabled: {
    envKey: "AGENT_SKILL_RERANKER_ENABLED",
    checks: [],
  },
  AgentSkillRerankerTopN: {
    envKey: "AGENT_SKILL_RERANKER_TOP_N",
    checks: [nonZero],
  },
};

function isNotEmpty(input = "") {
  return !input || input.length === 0 ? "Value cannot be empty" : null;
}

function nonZero(input = "") {
  if (isNaN(Number(input))) return "Value must be a number";
  return Number(input) <= 0 ? "Value must be greater than zero" : null;
}

function isValidURL(input = "") {
  try {
    new URL(input);
    return null;
  } catch {
    return "URL is not a valid URL.";
  }
}

function validOpenAIKey(input = "") {
  return input.startsWith("sk-") ? null : "OpenAI Key must start with sk-";
}

function supportedLLM(input = "") {
  const validSelection = ["openai", "generic-openai"].includes(input);
  return validSelection ? null : `${input} is not a valid LLM provider.`;
}

function supportedEmbeddingModel(input = "") {
  const supported = ["native", "openai", "generic-openai"];
  return supported.includes(input)
    ? null
    : `Invalid Embedding model type. Must be one of ${supported.join(", ")}.`;
}

function supportedVectorDB(input = "") {
  const supported = ["lancedb", "pgvector"];
  return supported.includes(input)
    ? null
    : `Invalid VectorDB type. Must be one of ${supported.join(", ")}.`;
}

function requiresForceMode(_, forceModeEnabled = false) {
  return forceModeEnabled === true ? null : "Cannot set this setting.";
}

async function validDockerizedUrl(input = "") {
  if (process.env.ANYTHING_LLM_RUNTIME !== "docker") return null;

  try {
    const { isPortInUse, getLocalHosts } = require("./portAvailabilityChecker");
    const localInterfaces = getLocalHosts();
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();
    const port = parseInt(url.port, 10);

    if (!localInterfaces.includes(hostname)) return null;
    if (isNaN(port)) return "Invalid URL: Port is not specified or invalid";

    const isPortAvailableFromDocker = await isPortInUse(port, hostname);
    if (isPortAvailableFromDocker)
      return "Port is not running a reachable service on loopback address from inside the container. Please use host.docker.internal (for linux use 172.17.0.1), a real machine ip, or domain to connect to your service.";
  } catch (error) {
    console.error(error.message);
    return "An error occurred while validating the URL";
  }

  return null;
}

function noRestrictedChars(input = "") {
  const regExp = new RegExp(/^[a-zA-Z0-9_\-!@$%^&*();]+$/);
  return !regExp.test(input)
    ? `Your password has restricted characters in it. Allowed symbols are _,-,!,@,$,%,^,&,*,(,),;`
    : null;
}

async function handleVectorStoreReset(key, prevValue, nextValue) {
  if (prevValue === nextValue) return;
  if (key === "VectorDB") {
    console.log(
      `Vector configuration changed from ${prevValue} to ${nextValue} - resetting ${prevValue} namespaces`
    );
    return await resetAllVectorStores({ vectorDbKey: prevValue });
  }

  if (key === "EmbeddingEngine" || key === "EmbeddingModelPref") {
    console.log(
      `${key} changed from ${prevValue} to ${nextValue} - resetting ${process.env.VECTOR_DB} namespaces`
    );
    return await resetAllVectorStores({ vectorDbKey: process.env.VECTOR_DB });
  }
  return false;
}

async function downloadEmbeddingModelIfRequired(key, prevValue, nextValue) {
  if (prevValue === nextValue) return;
  if (key !== "EmbeddingModelPref" || process.env.EMBEDDING_ENGINE !== "native")
    return;

  const { NativeEmbedder } = require("../EmbeddingEngines/native");
  if (!NativeEmbedder.supportedModels[nextValue]) return;
  new NativeEmbedder().embedderClient();
  return false;
}

async function looksLikePostgresConnectionString(connectionString = null) {
  if (!connectionString || !connectionString.startsWith("postgresql://"))
    return "Invalid Postgres connection string. Must start with postgresql://";
  if (connectionString.includes(" "))
    return "Invalid Postgres connection string. Must not contain spaces.";
  return null;
}

async function validatePGVectorConnectionString(key, prevValue, nextValue) {
  const envKey = KEY_MAPPING[key].envKey;
  if (
    prevValue === nextValue ||
    !nextValue ||
    nextValue === process.env[envKey]
  )
    return;

  const { PGVector } = require("../vectorDbProviders/pgvector");
  const { error, success } = await PGVector.validateConnection({
    connectionString: nextValue,
  });
  if (!success) return error;

  process.env[envKey] = nextValue;
  return null;
}

async function validatePGVectorTableName(key, prevValue, nextValue) {
  const envKey = KEY_MAPPING[key].envKey;
  if (
    prevValue === nextValue ||
    !nextValue ||
    nextValue === process.env[envKey] ||
    !process.env.PGVECTOR_CONNECTION_STRING
  )
    return;

  const { PGVector } = require("../vectorDbProviders/pgvector");
  const { error, success } = await PGVector.validateConnection({
    connectionString: process.env.PGVECTOR_CONNECTION_STRING,
    tableName: nextValue,
  });
  if (!success) return error;

  return null;
}

async function updateENV(newENVs = {}, force = false, userId = null) {
  let error = "";
  if (
    Object.hasOwn(newENVs, "LLMProvider") &&
    !["openai", "generic-openai"].includes(newENVs.LLMProvider)
  ) {
    return {
      newValues: {},
      error: "Only OpenAI and Generic OpenAI LLM providers are supported.",
    };
  }
  const runAfterAll = [];
  const validKeys = Object.keys(KEY_MAPPING);
  const ENV_KEYS = Object.keys(newENVs).filter(
    (key) => validKeys.includes(key) && !newENVs[key].includes("******")
  );
  const newValues = {};

  for (const key of ENV_KEYS) {
    const {
      envKey,
      checks,
      preUpdate = [],
      postUpdate = [],
      postSettled = [],
    } = KEY_MAPPING[key];
    runAfterAll.push(...postSettled);
    const prevValue = process.env[envKey];
    const nextValue = newENVs[key];
    let errors = await executeValidationChecks(checks, nextValue, force);

    if (errors.length > 0) {
      error += errors.join("\n");
      break;
    }

    errors = [];
    for (const preUpdateFunc of preUpdate) {
      const errorMsg = await preUpdateFunc(key, prevValue, nextValue);
      if (!!errorMsg && typeof errorMsg === "string") errors.push(errorMsg);
    }

    if (errors.length > 0) {
      error += errors.join("\n");
      break;
    }

    newValues[key] = nextValue;
    process.env[envKey] = nextValue;

    for (const postUpdateFunc of postUpdate)
      await postUpdateFunc(key, prevValue, nextValue);
  }

  for (const runAfterAllFunc of runAfterAll)
    await runAfterAllFunc(newValues, userId);

  await logChangesToEventLog(newValues, userId);
  if (process.env.NODE_ENV === "production") dumpENV();
  return { newValues, error: error?.length > 0 ? error : false };
}

async function executeValidationChecks(checks, value, force) {
  const results = await Promise.all(
    checks.map((validator) => validator(value, force))
  );
  return results.filter((err) => typeof err === "string");
}

async function logChangesToEventLog(newValues = {}, userId = null) {
  const { EventLogs } = require("../../models/eventLogs");
  const eventMapping = {
    LLMProvider: "update_llm_provider",
    EmbeddingEngine: "update_embedding_engine",
    VectorDB: "update_vector_db",
  };

  for (const [key, eventName] of Object.entries(eventMapping)) {
    if (!Object.prototype.hasOwnProperty.call(newValues, key)) continue;
    await EventLogs.logEvent(eventName, {}, userId);
  }
}

function dumpENV() {
  const fs = require("fs");
  const path = require("path");

  const frozenEnvs = {};
  const protectedKeys = [
    ...Object.values(KEY_MAPPING).map((values) => values.envKey),
    "JWT_EXPIRY",
    "STORAGE_DIR",
    "SERVER_PORT",
    "SIG_KEY",
    "SIG_SALT",
    "PASSWORDMINCHAR",
    "PASSWORDMAXCHAR",
    "PASSWORDLOWERCASE",
    "PASSWORDUPPERCASE",
    "PASSWORDNUMERIC",
    "PASSWORDSYMBOL",
    "PASSWORDREQUIREMENTS",
    "ENABLE_HTTPS",
    "HTTPS_CERT_PATH",
    "HTTPS_KEY_PATH",
    "DISABLE_VIEW_CHAT_HISTORY",
    "DISABLE_SWAGGER_DOCS",
    "SIMPLE_SSO_ENABLED",
    "SIMPLE_SSO_NO_LOGIN",
    "SIMPLE_SSO_NO_LOGIN_REDIRECT",
    "TARGET_OCR_LANG",
    "COLLECTOR_ALLOW_ANY_IP",
    "GENERIC_OPENAI_STREAMING_DISABLED",
    "GENERIC_OPEN_AI_CUSTOM_HEADERS",
    "MCP_NO_COOLDOWN",
    "PROVIDER_DISABLE_NATIVE_TOOL_CALLING",
    "PROVIDER_SUPPORTS_REASONING",
    "PROVIDER_SUPPORTS_IMAGE_GENERATION",
    "PROVIDER_SUPPORTS_VISION",
    "GENERIC_OPEN_AI_REPORT_USAGE",
    "AGENT_AUTO_APPROVED_SKILLS",
    "ANYTHINGLLM_FETCH_TIMEOUT",
    "ANYTHINGLLM_MAX_RETRIES",
  ];

  function sanitizeValue(value) {
    const offendingChars =
      /[\n\r\t\v\f\u0085\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000"'`#]/;
    const firstOffendingCharIndex = value.search(offendingChars);
    if (firstOffendingCharIndex === -1) return value;
    return value.substring(0, firstOffendingCharIndex);
  }

  for (const key of protectedKeys) {
    const envValue = process.env?.[key] || null;
    if (!envValue) continue;
    frozenEnvs[key] = envValue;
  }

  let envResult = `# Auto-dump ENV from system call on ${new Date().toTimeString()}\n`;
  envResult += Object.entries(frozenEnvs)
    .map(([key, value]) => `${key}='${sanitizeValue(value)}'`)
    .join("\n");

  const envPath = path.join(__dirname, "../../.env");
  fs.writeFileSync(envPath, envResult, { encoding: "utf8", flag: "w" });
  return true;
}

module.exports = {
  dumpENV,
  updateENV,
};
