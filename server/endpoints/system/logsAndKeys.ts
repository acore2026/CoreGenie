const { z } = require("zod");
const { reqBody } = require("../../utils/http");
const { typedHandler } = require("../../utils/http/typedHandler.ts");
const { ApiKey } = require("../../models/apiKeys");
const { getCustomModels } = require("../../utils/helpers/customModels");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { EventLogs } = require("../../models/eventLogs");
const { exportChatsAsType } = require("../../utils/helpers/chat/convertTo");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../../utils/middleware/multiUserProtected");
const {
  chatHistoryViewable,
} = require("../../utils/middleware/chatHistoryViewable");

const sqlValidationSchema = z.object({
  engine: z
    .string()
    .trim()
    .min(1, "Both engine and connection details are required."),
  connectionString: z
    .string()
    .trim()
    .min(1, "Both engine and connection details are required."),
});

function registerSystemLogsAndKeysEndpoints(app: Record<string, any>) {
  app.get(
    "/system/api-keys",
    [validatedRequest],
    async (_: any, response: any) => {
      try {
        if (response.locals.multiUserMode) {
          return response.sendStatus(401).end();
        }

        const apiKeys = await ApiKey.where({});
        return response.status(200).json({
          apiKeys,
          error: null,
        });
      } catch (error) {
        console.error(error);
        response.status(500).json({
          apiKey: null,
          error: "Could not find an API Key.",
        });
      }
    }
  );

  app.post(
    "/system/generate-api-key",
    [validatedRequest],
    async (request: any, response: any) => {
      try {
        if (response.locals.multiUserMode) {
          return response.sendStatus(401).end();
        }

        const { name = null } = reqBody(request);
        const { apiKey, error } = await ApiKey.create(null, name);
        await EventLogs.logEvent(
          "api_key_created",
          { name: apiKey?.name },
          response?.locals?.user?.id
        );
        return response.status(200).json({
          apiKey,
          error,
        });
      } catch (error) {
        console.error(error);
        response.status(500).json({
          apiKey: null,
          error: "Error generating api key.",
        });
      }
    }
  );

  app.delete(
    "/system/api-key/:id",
    [validatedRequest],
    async (request: any, response: any) => {
      try {
        if (response.locals.multiUserMode)
          return response.sendStatus(401).end();
        const { id } = request.params;
        if (!id || isNaN(Number(id))) return response.sendStatus(400).end();

        await ApiKey.delete({ id: Number(id) });
        await EventLogs.logEvent(
          "api_key_deleted",
          { deletedBy: response.locals?.user?.username },
          response?.locals?.user?.id
        );
        return response.status(200).end();
      } catch (error) {
        console.error(error);
        response.status(500).end();
      }
    }
  );

  app.post(
    "/system/custom-models",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request: any, response: any) => {
      try {
        const {
          provider,
          apiKey = null,
          basePath = null,
          options = {},
        } = reqBody(request);
        const { models, error } = await getCustomModels(
          provider,
          apiKey,
          basePath,
          options
        );
        return response.status(200).json({
          models,
          error,
        });
      } catch (error) {
        console.error(error);
        response.status(500).end();
      }
    }
  );

  app.post(
    "/system/event-logs",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request: any, response: any) => {
      try {
        const { offset = 0, limit = 10 } = reqBody(request);
        const logs = await EventLogs.whereWithData({}, limit, offset * limit, {
          id: "desc",
        });
        const totalLogs = await EventLogs.count();
        const hasPages = totalLogs > (offset + 1) * limit;

        response.status(200).json({ logs, hasPages, totalLogs });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/system/event-logs",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_: any, response: any) => {
      try {
        await EventLogs.delete();
        await EventLogs.logEvent(
          "event_logs_cleared",
          {},
          response?.locals?.user?.id
        );
        response.json({ success: true });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/system/workspace-chats",
    [
      chatHistoryViewable,
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
    ],
    async (request: any, response: any) => {
      try {
        const { offset = 0, limit = 20 } = reqBody(request);
        const chats = await WorkspaceChats.whereWithData(
          {},
          limit,
          offset * limit,
          { id: "desc" }
        );
        const totalChats = await WorkspaceChats.count();
        const hasPages = totalChats > (offset + 1) * limit;

        response.status(200).json({ chats, hasPages, totalChats });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/system/workspace-chats/:id",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request: any, response: any) => {
      try {
        const { id } = request.params;
        if (Number(id) === -1) await WorkspaceChats.delete({}, true);
        else await WorkspaceChats.delete({ id: Number(id) });
        response.json({ success: true, error: null });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/system/export-chats",
    [
      chatHistoryViewable,
      validatedRequest,
      flexUserRoleValid([ROLES.manager, ROLES.admin]),
    ],
    async (request: any, response: any) => {
      try {
        const { type = "jsonl", chatType = "workspace" } = request.query;
        if (chatType !== "workspace")
          return response.status(400).json({ error: "Invalid chat type." });
        const { contentType, data } = await exportChatsAsType(type, chatType);
        await EventLogs.logEvent(
          "exported_chats",
          {
            type,
            chatType,
          },
          response.locals.user?.id
        );
        response.setHeader("Content-Type", contentType);
        response.status(200).send(data);
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/system/validate-sql-connection",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    typedHandler(
      { body: sqlValidationSchema },
      async (
        {
          body: { engine, connectionString },
        }: { body: { engine: string; connectionString: string } },
        response: any
      ) => {
        try {
          const {
            validateConnection,
          } = require("../../services/sqlConnectors");
          const result = await validateConnection(engine, { connectionString });

          if (!result.success) {
            return response.status(200).json({
              success: false,
              error: `Unable to connect to ${engine}. Please verify your connection details.`,
            });
          }

          response.status(200).json(result);
        } catch (error) {
          console.error("SQL validation error:", error);
          response.status(500).json({
            success: false,
            error: `Unable to connect to ${engine}. Please verify your connection details.`,
          });
        }
      }
    )
  );
}

module.exports = { registerSystemLogsAndKeysEndpoints };
