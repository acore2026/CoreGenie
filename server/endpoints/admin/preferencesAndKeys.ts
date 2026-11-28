const { ApiKey } = require("../../models/apiKeys");
const { EventLogs } = require("../../models/eventLogs");
const { SystemSettings } = require("../../models/systemSettings");
const { getEmbeddingEngineSelection } = require("../../utils/helpers");
const { reqBody, userFromSession, safeJsonParse } = require("../../utils/http");
const {
  strictMultiUserRoleValid,
  flexUserRoleValid,
  ROLES,
} = require("../../utils/middleware/multiUserProtected");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const {
  DEFAULT_ENABLED_CONFIGURABLE_SKILLS,
} = require("../../utils/agents/skillDefaults");

const MANAGER_ALLOWED_FIELDS = [
  "custom_app_name",
  "footer_data",
  "support_email",
  "meta_page_title",
  "meta_page_favicon",
];

function registerAdminPreferencesAndKeysEndpoints(
  app: Record<string, any>
): void {
  app.get(
    "/admin/system-preferences-for",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const user = await userFromSession(request, response);
        const requestedSettings: Record<string, unknown> = {};
        const labels: string[] = request.query.labels?.split(",") || [];
        const needEmbedder = [
          "text_splitter_chunk_size",
          "max_embed_chunk_size",
        ];
        const noRecord = [
          "max_embed_chunk_size",
          "agent_sql_connections",
          "imported_agent_skills",
          "feature_flags",
          "meta_page_title",
          "meta_page_favicon",
        ];

        for (const label of labels) {
          if (!SystemSettings.publicFields.includes(label)) continue;
          if (
            user?.role === ROLES.manager &&
            !MANAGER_ALLOWED_FIELDS.includes(label)
          )
            continue;

          const embedder = needEmbedder.includes(label)
            ? getEmbeddingEngineSelection()
            : null;
          const setting = noRecord.includes(label)
            ? null
            : await SystemSettings.get({ label });

          switch (label) {
            case "footer_data":
              requestedSettings[label] = setting?.value ?? JSON.stringify([]);
              break;
            case "support_email":
              requestedSettings[label] = setting?.value || null;
              break;
            case "text_splitter_chunk_size":
              requestedSettings[label] =
                setting?.value || embedder?.embeddingMaxChunkLength || null;
              break;
            case "text_splitter_chunk_overlap":
              requestedSettings[label] = setting?.value || null;
              break;
            case "max_embed_chunk_size":
              requestedSettings[label] =
                embedder?.embeddingMaxChunkLength || 1000;
              break;
            case "agent_search_provider":
              requestedSettings[label] = setting?.value || null;
              break;
            case "agent_sql_connections":
              requestedSettings[label] =
                await SystemSettings.agent_sql_connections();
              break;
            case "default_agent_skills":
              requestedSettings[label] = safeJsonParse(
                setting?.value,
                DEFAULT_ENABLED_CONFIGURABLE_SKILLS
              );
              break;
            case "disabled_agent_skills":
            case "disabled_filesystem_skills":
            case "disabled_create_files_skills":
              requestedSettings[label] = safeJsonParse(setting?.value, []);
              break;
            case "imported_agent_skills":
              requestedSettings[label] = [];
              break;
            case "custom_app_name":
              requestedSettings[label] = setting?.value || null;
              break;
            case "feature_flags":
              requestedSettings[label] =
                (await SystemSettings.getFeatureFlags()) || {};
              break;
            case "meta_page_title":
            case "meta_page_favicon":
              requestedSettings[label] =
                await SystemSettings.getValueOrFallback({ label }, null);
              break;
            case "memory_enabled":
            case "memory_auto_extraction":
            case "agent_context_compaction_enabled":
              requestedSettings[label] = setting?.value ?? "true";
              break;
            case "lightweight_model_provider":
            case "lightweight_model_name":
            case "global_system_prompt":
              requestedSettings[label] = setting?.value ?? "";
              break;
            case "agent_execution_limits_disabled":
            case "agent_skill_tool_restrictions_enabled":
              requestedSettings[label] = setting?.value ?? "false";
              break;
            default:
              break;
          }
        }

        response.status(200).json({ settings: requestedSettings });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/admin/system-preferences",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const user = await userFromSession(request, response);
        let updates = reqBody(request);

        if (user?.role === ROLES.manager) {
          const filteredUpdates: Record<string, unknown> = {};
          for (const key of Object.keys(updates)) {
            if (MANAGER_ALLOWED_FIELDS.includes(key)) {
              filteredUpdates[key] = updates[key];
            }
          }
          updates = filteredUpdates;
        }

        const result = await SystemSettings.updateSettings(updates);
        response
          .status(result?.success === false ? 400 : 200)
          .json(result || { success: true, error: null });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/admin/api-keys",
    [validatedRequest, strictMultiUserRoleValid([ROLES.admin])],
    async (_request: Record<string, any>, response: Record<string, any>) => {
      try {
        const apiKeys = await ApiKey.whereWithUser({});
        return response.status(200).json({
          apiKeys,
          error: null,
        });
      } catch (error) {
        console.error(error);
        response.status(500).json({
          apiKey: null,
          error: "Could not find an API Keys.",
        });
      }
    }
  );

  app.post(
    "/admin/generate-api-key",
    [validatedRequest, strictMultiUserRoleValid([ROLES.admin])],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const user = await userFromSession(request, response);
        const { name = null } = reqBody(request);
        const { apiKey, error } = await ApiKey.create(user.id, name);
        await EventLogs.logEvent(
          "api_key_created",
          { createdBy: user?.username, name: apiKey?.name },
          user?.id
        );
        return response.status(200).json({
          apiKey,
          error,
        });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/admin/delete-api-key/:id",
    [validatedRequest, strictMultiUserRoleValid([ROLES.admin])],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const { id } = request.params;
        if (!id || isNaN(Number(id))) return response.sendStatus(400).end();
        await ApiKey.delete({ id: Number(id) });

        await EventLogs.logEvent(
          "api_key_deleted",
          { deletedBy: response.locals?.user?.username },
          response?.locals?.user?.id
        );
        return response.status(200).end();
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { registerAdminPreferencesAndKeysEndpoints };
