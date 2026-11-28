process.env.NODE_ENV === "development"
  ? require("dotenv").config({ path: `.env.${process.env.NODE_ENV}` })
  : require("dotenv").config();

const { default: slugify } = require("slugify");
const { isValidUrl, safeJsonParse } = require("../utils/http");
const prisma = require("../utils/prisma");
const { MetaGenerator } = require("../utils/boot/MetaGenerator");
const { PGVector } = require("../utils/vectorDbProviders/pgvector");
const { NativeEmbedder } = require("../utils/EmbeddingEngines/native");
const { getBaseLLMProviderModel } = require("../utils/helpers");
const { ConnectionStringParser } = require("../services/sqlConnectors/utils");
const {
  DEFAULT_AGENT_CLARIFYING_QUESTIONS_ENABLED,
} = require("../utils/agents/skillDefaults");

function isNullOrNaN(value) {
  if (value === null) return true;
  return isNaN(value);
}

const SystemSettings = {
  /** A default system prompt that is used when no other system prompt is set or available to the function caller. */
  saneDefaultSystemPrompt:
    "Given the following conversation, relevant context, and a follow up question, reply with an answer to the current question the user is asking. Return only your response to the question given the above information following the users instructions as needed.",
  protectedFields: ["multi_user_mode", "hub_api_key", "onboarding_complete"],
  publicFields: [
    "footer_data",
    "support_email",
    "text_splitter_chunk_size",
    "text_splitter_chunk_overlap",
    "max_embed_chunk_size",
    "agent_search_provider",
    "agent_sql_connections",
    "default_agent_skills",
    "disabled_agent_skills",
    "disabled_filesystem_skills",
    "disabled_create_files_skills",
    "imported_agent_skills",
    "agent_clarifying_questions_enabled",
    "agent_clarifying_questions_max_per_turn",
    "agent_execution_limits_disabled",
    "agent_skill_tool_restrictions_enabled",
    "agent_context_compaction_enabled",
    "custom_app_name",
    "feature_flags",
    "meta_page_title",
    "meta_page_favicon",
    "memory_enabled",
    "memory_auto_extraction",
    "public_registration_enabled",
    "default_predefined_agent_id",
    "global_system_prompt",
    "lightweight_model_provider",
    "lightweight_model_name",
  ],
  supportedFields: [
    "logo_filename",
    "footer_data",
    "support_email",

    "text_splitter_chunk_size",
    "text_splitter_chunk_overlap",
    "agent_search_provider",
    "default_agent_skills",
    "disabled_agent_skills",
    "disabled_filesystem_skills",
    "disabled_create_files_skills",
    "agent_sql_connections",
    "agent_clarifying_questions_enabled",
    "agent_clarifying_questions_max_per_turn",
    "agent_execution_limits_disabled",
    "agent_skill_tool_restrictions_enabled",
    "agent_context_compaction_enabled",
    "custom_app_name",
    "default_predefined_agent_id",
    "global_system_prompt",
    "lightweight_model_provider",
    "lightweight_model_name",

    // Meta page customization
    "meta_page_title",
    "meta_page_favicon",

    // beta feature flags
    "experimental_live_file_sync",

    // Hub settings
    "hub_api_key",

    // Memory/Personalization
    "memory_enabled",
    "memory_auto_extraction",
    "public_registration_enabled",
  ],
  validations: {
    agent_context_compaction_enabled: (update) =>
      String(update) === "true" ? "true" : "false",
    agent_execution_limits_disabled: (update) =>
      String(update) === "true" ? "true" : "false",
    agent_skill_tool_restrictions_enabled: (update) =>
      String(update) === "true" ? "true" : "false",
    footer_data: (updates) => {
      try {
        const array = JSON.parse(updates)
          .filter((setting) => isValidUrl(setting.url))
          .slice(0, 3); // max of 3 items in footer.
        return JSON.stringify(array);
      } catch {
        console.error(`Failed to run validation function on footer_data`);
        return JSON.stringify([]);
      }
    },
    text_splitter_chunk_size: (update) => {
      try {
        if (isNullOrNaN(update)) throw new Error("Value is not a number.");
        if (Number(update) <= 0) throw new Error("Value must be non-zero.");
        const { purgeEntireVectorCache } = require("../utils/files");
        purgeEntireVectorCache();
        return Number(update);
      } catch (e) {
        console.error(
          `Failed to run validation function on text_splitter_chunk_size`,
          e.message
        );
        return 1000;
      }
    },
    text_splitter_chunk_overlap: (update) => {
      try {
        if (isNullOrNaN(update)) throw new Error("Value is not a number");
        if (Number(update) < 0) throw new Error("Value cannot be less than 0.");
        const { purgeEntireVectorCache } = require("../utils/files");
        purgeEntireVectorCache();
        return Number(update);
      } catch (e) {
        console.error(
          `Failed to run validation function on text_splitter_chunk_overlap`,
          e.message
        );
        return 20;
      }
    },
    agent_search_provider: (update) => {
      try {
        if (update === "none") return null;
        if (
          ![
            "tavily-search",
            "exa-search",
            "baidu-search",
            "searxng-engine",
            "duckduckgo-engine",
          ].includes(update)
        )
          throw new Error("Invalid SERP provider.");
        return String(update);
      } catch (e) {
        console.error(
          `Failed to run validation function on agent_search_provider`,
          e.message
        );
        return null;
      }
    },
    default_agent_skills: (updates) => {
      try {
        const skills = updates.split(",").filter((skill) => !!skill);
        return JSON.stringify(skills);
      } catch {
        console.error(`Could not validate agent skills.`);
        return JSON.stringify([]);
      }
    },
    memory_enabled: async (update) => {
      try {
        const enabled = String(update) === "true";
        const {
          BackgroundService,
        } = require("../utils/BackgroundWorkers/index.js");
        const bgService = new BackgroundService();
        const autoSetting = await SystemSettings.get({
          label: "memory_auto_extraction",
        });
        const autoOn = !autoSetting || autoSetting.value === "true";
        await bgService.syncMemoryJob(enabled && autoOn);
        return String(enabled);
      } catch (e) {
        console.error(
          `Failed to run validation function on memory_enabled`,
          e.message
        );
        return String(update);
      }
    },
    memory_auto_extraction: async (update) => {
      try {
        const enabled = String(update) === "true";
        const {
          BackgroundService,
        } = require("../utils/BackgroundWorkers/index.js");
        const bgService = new BackgroundService();
        const memoriesOn = await SystemSettings.memoriesEnabled();
        await bgService.syncMemoryJob(memoriesOn && enabled);
        return String(enabled);
      } catch (e) {
        console.error(
          `Failed to run validation function on memory_auto_extraction`,
          e.message
        );
        return String(update);
      }
    },
    disabled_agent_skills: (updates) => {
      try {
        const skills = updates.split(",").filter((skill) => !!skill);
        return JSON.stringify(skills);
      } catch {
        console.error(`Could not validate disabled agent skills.`);
        return JSON.stringify([]);
      }
    },
    disabled_filesystem_skills: (updates) => {
      try {
        const skills = updates.split(",").filter((skill) => !!skill);
        return JSON.stringify(skills);
      } catch {
        console.error(`Could not validate disabled filesystem skills.`);
        return JSON.stringify([]);
      }
    },
    disabled_create_files_skills: (updates) => {
      try {
        const skills = updates.split(",").filter((skill) => !!skill);
        return JSON.stringify(skills);
      } catch {
        console.error(`Could not validate disabled create files skills.`);
        return JSON.stringify([]);
      }
    },
    agent_sql_connections: async (updates) => {
      const existingConnections = safeJsonParse(
        (await SystemSettings.get({ label: "agent_sql_connections" }))?.value,
        []
      );
      try {
        const updatedConnections = mergeConnections(
          existingConnections,
          safeJsonParse(updates, [])
        );
        return JSON.stringify(updatedConnections);
      } catch {
        console.error(`Failed to merge connections`);
        return JSON.stringify(existingConnections ?? []);
      }
    },
    agent_clarifying_questions_enabled: (update) => {
      if (typeof update === "boolean") return update ? "true" : "false";
      return String(update) === "true" ? "true" : "false";
    },
    public_registration_enabled: (update) => {
      if (typeof update === "boolean") return update ? "true" : "false";
      return String(update) === "true" ? "true" : "false";
    },
    agent_clarifying_questions_max_per_turn: (update) => {
      const n = Number(update);
      if (!Number.isFinite(n) || n < 1) return 3;
      return Math.min(Math.floor(n), 10);
    },
    experimental_live_file_sync: (update) => {
      if (typeof update === "boolean")
        return update === true ? "enabled" : "disabled";
      if (!["enabled", "disabled"].includes(update)) return "disabled";
      return String(update);
    },
    meta_page_title: (newTitle) => {
      try {
        if (typeof newTitle !== "string" || !newTitle) return null;
        return String(newTitle);
      } catch {
        return null;
      } finally {
        new MetaGenerator().clearConfig();
      }
    },
    meta_page_favicon: (faviconUrl) => {
      if (!faviconUrl) return null;
      try {
        const url = new URL(faviconUrl);
        return url.toString();
      } catch {
        return null;
      } finally {
        new MetaGenerator().clearConfig();
      }
    },
    hub_api_key: (apiKey) => {
      if (!apiKey) return null;
      return String(apiKey);
    },
    default_predefined_agent_id: (id) => {
      const value = Number(id);
      return Number.isInteger(value) && value > 0 ? String(value) : null;
    },
    lightweight_model_provider: (provider) => {
      if (!["", "openai", "generic-openai"].includes(provider))
        throw new Error("请选择支持的轻量任务模型服务商。");
      return provider;
    },
    lightweight_model_name: (model) => {
      if (
        typeof model !== "string" ||
        model.trim().length > 200 ||
        /[\r\n]/.test(model)
      )
        throw new Error("模型名称不能超过 200 个字符，且不能包含换行。");
      return model.trim();
    },
    global_system_prompt: (prompt) =>
      String(prompt ?? "")
        .trim()
        .slice(0, 40_000),
  },
  currentSettings: async function () {
    const { hasVectorCachedFiles } = require("../utils/files");

    const llmProvider = process.env.LLM_PROVIDER;
    const vectorDB = process.env.VECTOR_DB;
    const embeddingEngine = process.env.EMBEDDING_ENGINE ?? "native";
    return {
      // --------------------------------------------------------
      // General Settings
      // --------------------------------------------------------
      RequiresAuth: !!process.env.AUTH_TOKEN,
      AuthToken: !!process.env.AUTH_TOKEN,
      JWTSecret: !!process.env.JWT_SECRET,
      StorageDir: process.env.STORAGE_DIR,
      MultiUserMode: await this.isMultiUserMode(),
      PublicRegistrationEnabled: await this.publicRegistrationEnabled(),
      MemoryEnabled: await this.memoriesEnabled(),
      MemoryAutoExtraction: await this.memoryAutoExtractionSetting(),

      // --------------------------------------------------------
      // Embedder Provider Selection Settings & Configs
      // --------------------------------------------------------
      EmbeddingEngine: embeddingEngine,
      HasExistingEmbeddings: await this.hasEmbeddings(), // check if they have any currently embedded documents active in workspaces.
      HasCachedEmbeddings: hasVectorCachedFiles(), // check if they any currently cached embedded docs.
      EmbeddingBasePath: process.env.EMBEDDING_BASE_PATH,
      EmbeddingModelPref:
        embeddingEngine === "native"
          ? NativeEmbedder._getEmbeddingModel()
          : process.env.EMBEDDING_MODEL_PREF,
      EmbeddingOutputDimensions:
        process.env.EMBEDDING_OUTPUT_DIMENSIONS || null,
      EmbeddingModelMaxChunkLength:
        process.env.EMBEDDING_MODEL_MAX_CHUNK_LENGTH,
      GenericOpenAiEmbeddingApiKey:
        !!process.env.GENERIC_OPEN_AI_EMBEDDING_API_KEY,
      GenericOpenAiEmbeddingMaxConcurrentChunks:
        process.env.GENERIC_OPEN_AI_EMBEDDING_MAX_CONCURRENT_CHUNKS || 500,
      GenericOpenAiEmbeddingPassagePrefix:
        process.env.GENERIC_OPEN_AI_EMBEDDING_PASSAGE_PREFIX || "",
      GenericOpenAiEmbeddingQueryPrefix:
        process.env.GENERIC_OPEN_AI_EMBEDDING_QUERY_PREFIX || "",

      // --------------------------------------------------------
      // VectorDB Provider Selection Settings & Configs
      // --------------------------------------------------------
      VectorDB: vectorDB,
      ...this.vectorDBPreferenceKeys(),

      // --------------------------------------------------------
      // LLM Provider Selection Settings & Configs
      // --------------------------------------------------------
      LLMProvider: llmProvider,
      LLMModel: getBaseLLMProviderModel({ provider: llmProvider }) || null,
      ...this.llmPreferenceKeys(),

      // --------------------------------------------------------
      // Agent Settings & Configs
      // --------------------------------------------------------
      AgentBaiduSearchApiKey: !!process.env.AGENT_BAIDU_SEARCH_API_KEY || null,
      AgentSearXNGApiUrl: process.env.AGENT_SEARXNG_API_URL || null,
      AgentTavilyApiKey: !!process.env.AGENT_TAVILY_API_KEY || null,
      AgentExaApiKey: !!process.env.AGENT_EXA_API_KEY || null,

      // --------------------------------------------------------
      // Compliance Settings
      // --------------------------------------------------------
      // Disable View Chat History for the whole instance.
      DisableViewChatHistory:
        "DISABLE_VIEW_CHAT_HISTORY" in process.env || false,
      WorkspaceDeletionProtection:
        "WORKSPACE_DELETION_PROTECTION" in process.env || false,

      // --------------------------------------------------------
      // Simple SSO Settings
      // --------------------------------------------------------
      SimpleSSOEnabled: "SIMPLE_SSO_ENABLED" in process.env || false,
      SimpleSSONoLogin: "SIMPLE_SSO_NO_LOGIN" in process.env || false,
      SimpleSSONoLoginRedirect: this.simpleSSO.noLoginRedirect(),

      // --------------------------------------------------------
      // Agent Skill Settings
      // --------------------------------------------------------
      AgentSkillMaxToolCalls: 500,
      AgentSkillRerankerEnabled: false,
      AgentSkillRerankerTopN: null,
      AgentClarifyingQuestionsEnabled:
        (await this.getValueOrFallback(
          { label: "agent_clarifying_questions_enabled" },
          DEFAULT_AGENT_CLARIFYING_QUESTIONS_ENABLED
        )) === "true",
      AgentClarifyingQuestionsMaxPerTurn: Number(
        (await this.getValueOrFallback(
          { label: "agent_clarifying_questions_max_per_turn" },
          "3"
        )) || 3
      ),
      AgentExecutionLimitsDisabled: await this.agentExecutionLimitsDisabled(),
      AgentContextCompactionEnabled: await this.agentContextCompactionEnabled(),
      AgentSkillToolRestrictionsEnabled:
        await this.agentSkillToolRestrictionsEnabled(),
    };
  },

  get: async function (clause = {}) {
    try {
      const setting = await prisma.system_settings.findFirst({ where: clause });
      return setting || null;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  getValueOrFallback: async function (clause = {}, fallback = null) {
    try {
      return (await this.get(clause))?.value ?? fallback;
    } catch (error) {
      console.error(error.message);
      return fallback;
    }
  },

  where: async function (clause = {}, limit) {
    try {
      const settings = await prisma.system_settings.findMany({
        where: clause,
        take: limit || undefined,
      });
      return settings;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  // Can take generic keys and will pre-filter invalid keys
  // from the set before sending to the explicit update function
  // that will then enforce validations as well.
  updateSettings: async function (updates = {}) {
    const validFields = Object.keys(updates).filter((key) =>
      this.supportedFields.includes(key)
    );

    Object.entries(updates).forEach(([key]) => {
      if (validFields.includes(key)) return;
      delete updates[key];
    });

    return this._updateSettings(updates);
  },

  delete: async function (clause = {}) {
    try {
      if (!Object.keys(clause).length)
        throw new Error("Clause cannot be empty");
      await prisma.system_settings.deleteMany({ where: clause });
      return true;
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  // Explicit update of settings + key validations.
  // Only use this method when directly setting a key value
  // that takes no user input for the keys being modified.
  _updateSettings: async function (updates = {}) {
    try {
      const updatePromises = [];
      for (const key of Object.keys(updates)) {
        let validatedValue = updates[key];
        if (this.validations.hasOwnProperty(key)) {
          if (this.validations[key].constructor.name === "AsyncFunction") {
            validatedValue = await this.validations[key](updates[key]);
          } else {
            validatedValue = this.validations[key](updates[key]);
          }
        }

        if (validatedValue === undefined) continue;

        updatePromises.push(
          prisma.system_settings.upsert({
            where: { label: key },
            update: {
              value: validatedValue === null ? null : String(validatedValue),
            },
            create: {
              label: key,
              value: validatedValue === null ? null : String(validatedValue),
            },
          })
        );
      }

      await Promise.all(updatePromises);
      return { success: true, error: null };
    } catch (error) {
      console.error("FAILED TO UPDATE SYSTEM SETTINGS", error.message);
      return { success: false, error: error.message };
    }
  },

  isMultiUserMode: async function () {
    try {
      const setting = await this.get({ label: "multi_user_mode" });
      return setting?.value === "true";
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  publicRegistrationEnabled: async function () {
    try {
      if (!(await this.isMultiUserMode())) return false;
      const setting = await this.get({ label: "public_registration_enabled" });
      return setting?.value === "true";
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  agentExecutionLimitsDisabled: async function () {
    try {
      return (
        (await this.getValueOrFallback(
          { label: "agent_execution_limits_disabled" },
          "false"
        )) === "true"
      );
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  agentContextCompactionEnabled: async function () {
    return (
      (await this.getValueOrFallback(
        { label: "agent_context_compaction_enabled" },
        "true"
      )) === "true"
    );
  },

  agentSkillToolRestrictionsEnabled: async function () {
    try {
      return (
        (await this.getValueOrFallback(
          { label: "agent_skill_tool_restrictions_enabled" },
          "false"
        )) === "true"
      );
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  memoriesEnabled: async function () {
    try {
      const setting = await this.get({ label: "memory_enabled" });
      return !setting || setting.value === "true";
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  autoMemoriesEnabled: async function () {
    try {
      if (!(await this.memoriesEnabled())) return false;
      const setting = await this.get({ label: "memory_auto_extraction" });
      return !setting || setting.value === "true";
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  memoryAutoExtractionSetting: async function () {
    try {
      const setting = await this.get({ label: "memory_auto_extraction" });
      return !setting || setting.value === "true";
    } catch (error) {
      console.error(error.message);
      return true;
    }
  },

  isOnboardingComplete: async function () {
    try {
      const setting = await this.get({ label: "onboarding_complete" });
      return setting?.value === "true";
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  markOnboardingComplete: async function () {
    try {
      const { success } = await this._updateSettings({
        onboarding_complete: true,
      });
      return success;
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  currentLogoFilename: async function () {
    try {
      const setting = await this.get({ label: "logo_filename" });
      return setting?.value || null;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  hasEmbeddings: async function () {
    try {
      const { Document } = require("./documents");
      const count = await Document.count({}, 1);
      return count > 0;
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  vectorDBPreferenceKeys: function () {
    return {
      // PGVector Keys
      PGVectorConnectionString: !!PGVector.connectionString() || false,
      PGVectorTableName: PGVector.tableName(),
    };
  },

  llmPreferenceKeys: function () {
    return {
      // OpenAI Keys
      OpenAiKey: !!process.env.OPEN_AI_KEY,
      OpenAiModelPref: process.env.OPEN_MODEL_PREF || "gpt-4.1-nano",

      // Generic OpenAI Keys
      GenericOpenAiBasePath: process.env.GENERIC_OPEN_AI_BASE_PATH,
      GenericOpenAiModelPref: process.env.GENERIC_OPEN_AI_MODEL_PREF,
      GenericOpenAiTokenLimit: process.env.GENERIC_OPEN_AI_MODEL_TOKEN_LIMIT,
      GenericOpenAiKey: !!process.env.GENERIC_OPEN_AI_API_KEY,
      GenericOpenAiMaxTokens: process.env.GENERIC_OPEN_AI_MAX_TOKENS,
    };
  },

  agent_sql_connections: async function () {
    const setting = await SystemSettings.get({
      label: "agent_sql_connections",
    });
    if (!setting) return [];

    const connections = safeJsonParse(setting.value, []).map((conn) => {
      let scheme = conn.engine;
      if (scheme === "sql-server") scheme = "mssql";
      if (scheme === "postgresql") scheme = "postgres";
      const parser = new ConnectionStringParser({ scheme });

      const parsed = parser.parse(conn.connectionString);
      return {
        ...conn,
        username: parsed.username,
        password: parsed.password,
        host: parsed.hosts?.[0]?.host,
        port: parsed.hosts?.[0]?.port,
        database: parsed.endpoint,
        scheme: parsed.scheme,
      };
    });

    return connections;
  },
  getFeatureFlags: async function () {
    return {
      experimental_live_file_sync:
        (await SystemSettings.get({ label: "experimental_live_file_sync" }))
          ?.value === "enabled",
    };
  },

  /**
   * Get user configured Community Hub Settings
   * Connection key is used to authenticate with the Community Hub API
   * for your account.
   * @returns {Promise<{connectionKey: string}>}
   */
  hubSettings: async function () {
    try {
      const hubKey = await this.get({ label: "hub_api_key" });
      return { connectionKey: hubKey?.value || null };
    } catch (error) {
      console.error(error.message);
      return { connectionKey: null };
    }
  },

  simpleSSO: {
    /**
     * Gets the no login redirect URL. If the conditions below are not met, this will return null.
     * - If simple SSO is not enabled.
     * - If simple SSO login page is not disabled.
     * - If the no login redirect is not a valid URL or is not set.
     * @returns {string | null}
     */
    noLoginRedirect: () => {
      if (!("SIMPLE_SSO_ENABLED" in process.env)) return null; // if simple SSO is not enabled, return null
      if (!("SIMPLE_SSO_NO_LOGIN" in process.env)) return null; // if the no login config is not set, return null
      if (!("SIMPLE_SSO_NO_LOGIN_REDIRECT" in process.env)) return null; // if the no login redirect is not set, return null

      try {
        let url = new URL(process.env.SIMPLE_SSO_NO_LOGIN_REDIRECT);
        return url.toString();
      } catch {}

      // if the no login redirect is not a valid URL or is not set, return null
      return null;
    },
  },
};

/**
 * Merges SQL connection updates from the frontend with existing backend connections.
 * Processes three types of actions: "remove", "update", and "add".
 *
 * @param {Array<Object>} existingConnections - Current connections stored in the database
 * @param {Array<Object>} updates - Connection updates from frontend, each with an action property
 * @returns {Array<Object>} - The merged connections array
 */
function mergeConnections(existingConnections = [], updates = []) {
  const connectionsMap = new Map(
    existingConnections.map((conn) => [conn.database_id, conn])
  );

  for (const update of updates) {
    const {
      action,
      database_id,
      originalDatabaseId,
      connectionString,
      engine,
      schema,
    } = update;

    switch (action) {
      case "remove": {
        connectionsMap.delete(database_id);
        break;
      }
      case "update": {
        if (!connectionString) continue;
        const newId = slugify(database_id);

        // Verify original connection exists
        if (!connectionsMap.has(originalDatabaseId)) {
          console.warn(
            `[mergeConnections] Update skipped: Original connection "${originalDatabaseId}" not found`
          );
          break;
        }

        // Check for name conflict (excluding the one being updated)
        if (newId !== originalDatabaseId && connectionsMap.has(newId)) {
          console.warn(
            `[mergeConnections] Update skipped: New name "${newId}" conflicts with existing connection`
          );
          break;
        }

        // Remove old and add updated connection
        connectionsMap.delete(originalDatabaseId);
        connectionsMap.set(newId, {
          engine,
          database_id: newId,
          connectionString,
          ...(schema && { schema }),
        });
        break;
      }

      case "add": {
        if (!connectionString) continue;
        const slugifiedId = slugify(database_id);

        // Skip if already exists
        if (connectionsMap.has(slugifiedId)) {
          console.warn(
            `[mergeConnections] Add skipped: Connection "${slugifiedId}" already exists`
          );
          break;
        }

        connectionsMap.set(slugifiedId, {
          engine,
          database_id: slugifiedId,
          connectionString,
          ...(schema && { schema }),
        });
        break;
      }

      default: {
        if (!action) continue;
        throw new Error("SQL connection update contains an invalid action.");
      }
    }
  }

  return Array.from(connectionsMap.values());
}

require("../config-sync").synchronizeWrites(
  SystemSettings,
  ["_updateSettings"],
  (updates = {}) =>
    Object.prototype.hasOwnProperty.call(updates, "global_system_prompt")
);
module.exports.SystemSettings = SystemSettings;
