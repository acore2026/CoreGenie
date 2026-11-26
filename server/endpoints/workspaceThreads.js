const {
  multiUserMode,
  userFromSession,
  reqBody,
  safeJsonParse,
} = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { EventLogs } = require("../models/eventLogs");
const { WorkspaceThread } = require("../models/workspaceThread");
const {
  validWorkspaceSlug,
  validWorkspaceAndThreadSlug,
  canManageWorkspaceThread,
  manageWorkspaceThread,
} = require("../utils/middleware/validWorkspace");
const { WorkspaceChats } = require("../models/workspaceChats");
const { User } = require("../models/user");
const { convertToChatHistory } = require("../utils/helpers/chat/responses");
const { canCollaborateOnThread } = require("../utils/workspaceCollaboration");
const {
  threadVisibility,
  updateDraftSession,
} = require("../models/threadLifecycle");

function workspaceThreadEndpoints(app) {
  if (!app) return;

  app.post(
    "/workspace/:slug/thread/new",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;
        const { thread, message } = await WorkspaceThread.new(
          workspace,
          user?.id
        );

        await EventLogs.logEvent(
          "workspace_thread_created",
          {
            workspaceName: workspace?.name || "Unknown Workspace",
          },
          user?.id
        );
        response.status(200).json({
          thread: thread
            ? {
                ...thread,
                owner: user
                  ? {
                      id: user.id,
                      username: user.username,
                      displayName: user.displayName,
                    }
                  : null,
                canModify: true,
              }
            : null,
          message,
        });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/workspace/:slug/threads",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;
        const threads = await WorkspaceThread.where(
          {
            workspace_id: workspace.id,
            ...(multiUserMode(response) ? threadVisibility(user?.id) : {}),
          },
          null,
          { createdAt: "asc" },
          { user: { select: { id: true, username: true, displayName: true } } }
        );
        const visibleThreads = threads.map(({ user: owner, ...thread }) => ({
          ...thread,
          owner,
          canModify:
            !multiUserMode(response) ||
            canCollaborateOnThread(user, workspace, thread) ||
            thread.user_id === user?.id ||
            [ROLES.admin, ROLES.manager].includes(user?.role),
        }));

        const defaultThreadChatCount = await WorkspaceChats.count({
          workspaceId: workspace.id,
          user_id: user?.id || null,
          thread_id: null,
          api_session_id: null,
          include: true,
        });

        response.status(200).json({
          threads: visibleThreads,
          defaultThreadChatCount,
        });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/thread/:threadSlug",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.all]),
      validWorkspaceAndThreadSlug,
      manageWorkspaceThread,
    ],
    async (_, response) => {
      try {
        const thread = response.locals.thread;
        await WorkspaceThread.delete({ id: thread.id });
        response.sendStatus(200).end();
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/thread/:threadSlug/draft-session",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.all]),
      validWorkspaceAndThreadSlug,
    ],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const thread = response.locals.thread;
        // Only the creator can request automatic cleanup, regardless of role.
        if (multiUserMode(response) && thread.user_id !== user?.id)
          return response.status(404).end();
        const { sessionId, action, retain = false } = reqBody(request);
        if (
          typeof sessionId !== "string" ||
          !/^[a-f0-9-]{36}$/.test(sessionId) ||
          !["enter", "touch", "leave", "release"].includes(action)
        )
          return response.status(400).end();
        response.setHeader("Cache-Control", "no-store");
        return response.status(200).json(
          await updateDraftSession({
            threadId: thread.id,
            userId: thread.user_id,
            sessionId: `${thread.id}:${sessionId}`,
            action,
            retain: retain === true,
          })
        );
      } catch (error) {
        console.error("Draft session update failed:", error.message);
        return response.status(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/thread-bulk-delete",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const { slugs = [] } = reqBody(request);
        if (slugs.length === 0) return response.sendStatus(200).end();

        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;
        await WorkspaceThread.delete({
          slug: { in: slugs },
          ...(user?.id && workspace.accessMode === "public_collaborative"
            ? {}
            : { user_id: user?.id ?? null }),
          workspace_id: workspace.id,
          ...(multiUserMode(response) ? threadVisibility(user?.id) : {}),
        });
        response.sendStatus(200).end();
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/workspace/:slug/thread/:threadSlug/chats",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.all]),
      validWorkspaceAndThreadSlug,
    ],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const thread = response.locals.thread;
        const history = await WorkspaceChats.where(
          {
            workspaceId: workspace.id,
            thread_id: thread.id,
            api_session_id: null, // Do not include API session chats.
            include: true,
          },
          null,
          { id: "asc" }
        );

        const owner = thread.user_id
          ? await User.get({ id: thread.user_id })
          : null;
        response.status(200).json({
          history: convertToChatHistory(history),
          thread: {
            ...thread,
            owner: owner
              ? {
                  id: owner.id,
                  username: owner.username,
                  displayName: owner.displayName,
                }
              : null,
            canModify: await canManageWorkspaceThread(request, response),
          },
        });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/thread/:threadSlug/update",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.all]),
      validWorkspaceAndThreadSlug,
      manageWorkspaceThread,
    ],
    async (request, response) => {
      try {
        const data = reqBody(request);
        const currentThread = response.locals.thread;
        const { thread, message } = await WorkspaceThread.update(
          currentThread,
          data
        );
        response.status(200).json({ thread, message });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/thread/:threadSlug/delete-edited-chats",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.all]),
      validWorkspaceAndThreadSlug,
      manageWorkspaceThread,
    ],
    async (request, response) => {
      try {
        const { startingId } = reqBody(request);
        const workspace = response.locals.workspace;
        const thread = response.locals.thread;

        await WorkspaceChats.delete({
          workspaceId: Number(workspace.id),
          thread_id: Number(thread.id),
          id: { gte: Number(startingId) },
        });

        response.sendStatus(200).end();
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/thread/:threadSlug/update-chat",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.all]),
      validWorkspaceAndThreadSlug,
      manageWorkspaceThread,
    ],
    async (request, response) => {
      try {
        const { chatId, newText = null, role = "assistant" } = reqBody(request);
        if (!newText || !String(newText).trim())
          throw new Error("Cannot save empty edit");

        const workspace = response.locals.workspace;
        const thread = response.locals.thread;
        const existingChat = await WorkspaceChats.get({
          workspaceId: workspace.id,
          thread_id: thread.id,
          id: Number(chatId),
        });
        if (!existingChat) throw new Error("Invalid chat.");

        if (role === "user") {
          await WorkspaceChats._update(existingChat.id, {
            prompt: String(newText),
          });
        } else {
          const chatResponse = safeJsonParse(existingChat.response, null);
          if (!chatResponse) throw new Error("Failed to parse chat response");
          await WorkspaceChats._update(existingChat.id, {
            response: JSON.stringify({
              ...chatResponse,
              text: String(newText),
              parts: undefined,
            }),
          });
        }

        response.sendStatus(200).end();
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { workspaceThreadEndpoints };
