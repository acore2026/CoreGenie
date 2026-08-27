const { PublicChatShare } = require("../models/publicChatShare");
const { Workspace } = require("../models/workspace");
const { WorkspaceThread } = require("../models/workspaceThread");
const { WorkspaceChats } = require("../models/workspaceChats");
const { userFromSession, reqBody } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validWorkspaceSlug } = require("../utils/middleware/validWorkspace");
const { convertToChatHistory } = require("../utils/helpers/chat/responses");

function publicChatShareEndpoints(app) {
  if (!app) return;

  app.post(
    "/workspace/:slug/share-chat",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const user = await userFromSession(request, response);
        const { threadSlug = null } = reqBody(request);
        let thread = null;

        if (threadSlug) {
          thread = await WorkspaceThread.get({
            slug: String(threadSlug),
            workspace_id: workspace.id,
            user_id: user?.id || null,
          });
          if (!thread)
            return response.status(404).json({
              success: false,
              error: "Workspace thread does not exist.",
            });
        }

        const share = await PublicChatShare.createOrGet({
          workspaceId: workspace.id,
          threadId: thread?.id || null,
          userId: user?.id || null,
        });

        return response.status(200).json({
          success: true,
          shareUrlPath: `/share/chat/${share.token}`,
        });
      } catch (error) {
        console.error("Failed to create public chat share:", error);
        return response.status(500).json({
          success: false,
          error: "Failed to create public chat link.",
        });
      }
    }
  );

  app.get("/public-chat-share/:token", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const share = await PublicChatShare.get({ token: request.params.token });
      if (!share)
        return response.status(404).json({
          success: false,
          error: "This shared conversation is unavailable.",
        });

      const workspace = await Workspace.get({ id: share.workspace_id });
      const thread = share.thread_id
        ? await WorkspaceThread.get({
            id: share.thread_id,
            workspace_id: share.workspace_id,
          })
        : null;
      if (!workspace || (share.thread_id && !thread))
        return response.status(404).json({
          success: false,
          error: "This shared conversation is unavailable.",
        });

      const chats = await WorkspaceChats.where(
        {
          workspaceId: share.workspace_id,
          user_id: share.user_id || null,
          thread_id: share.thread_id || null,
          api_session_id: null,
          include: true,
        },
        null,
        { id: "asc" }
      );

      return response.status(200).json({
        success: true,
        share: {
          title: thread?.name || workspace.name,
          workspaceName: workspace.name,
          createdAt: share.createdAt,
        },
        history: convertToChatHistory(chats),
      });
    } catch (error) {
      console.error("Failed to load public chat share:", error);
      return response.status(500).json({
        success: false,
        error: "Failed to load shared conversation.",
      });
    }
  });
}

module.exports = { publicChatShareEndpoints };
