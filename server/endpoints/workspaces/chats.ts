const truncate = require("truncate");
const {
  reqBody,
  multiUserMode,
  userFromSession,
  safeJsonParse,
} = require("../../utils/http");
const { Workspace } = require("../../models/workspace");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { stripThinkingFromText } = require("../../utils/helpers");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../../utils/middleware/multiUserProtected");
const { EventLogs } = require("../../models/eventLogs");
const {
  WorkspaceSuggestedMessages,
} = require("../../models/workspacesSuggestedMessages");
const { validWorkspaceSlug } = require("../../utils/middleware/validWorkspace");
const { convertToChatHistory } = require("../../utils/helpers/chat/responses");
const { WorkspaceThread } = require("../../models/workspaceThread");
const {
  canViewThread,
  acceptThreadSubmission,
} = require("../../models/threadLifecycle");

async function canManageWorkspaceChat({
  chat,
  user,
  response,
}: {
  chat: {
    thread_id?: number | null;
    user_id?: number | null;
    workspaceId?: number;
  };
  user: { id?: number; role?: string } | null;
  response: Record<string, any>;
}): Promise<boolean> {
  if (!multiUserMode(response)) return true;
  if (!chat?.thread_id) return chat?.user_id === user?.id;
  if ([ROLES.admin, ROLES.manager].includes(user?.role)) return true;
  return Boolean(
    await WorkspaceThread.get({
      id: chat.thread_id,
      workspace_id: chat.workspaceId,
      user_id: user?.id,
    })
  );
}

function registerWorkspaceChatEndpoints(app: Record<string, any>): void {
  app.get(
    "/workspace/:slug/chats",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const { slug } = request.params;
        const user = await userFromSession(request, response);
        const workspace = multiUserMode(response)
          ? await Workspace.getAccessibleWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!workspace) {
          response.sendStatus(400).end();
          return;
        }

        const history = multiUserMode(response)
          ? workspace.viewerAccess === "public_readonly"
            ? []
            : await WorkspaceChats.forWorkspaceByUser(workspace.id, user.id)
          : await WorkspaceChats.forWorkspace(workspace.id);
        response.status(200).json({ history: convertToChatHistory(history) });
      } catch (e: unknown) {
        const err = e as Error;
        console.error(err.message, err);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/delete-chats",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const { chatIds = [] } = reqBody(request);
        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;

        if (!workspace || !Array.isArray(chatIds)) {
          response.sendStatus(400).end();
          return;
        }

        const requestedChats = await WorkspaceChats.where({
          id: { in: chatIds.map((id: unknown) => Number(id)) },
          workspaceId: workspace.id,
        });
        const manageableChatIds: number[] = [];
        for (const chat of requestedChats) {
          if (await canManageWorkspaceChat({ chat, user, response }))
            manageableChatIds.push(chat.id);
        }
        await WorkspaceChats.delete({
          id: { in: manageableChatIds },
          workspaceId: workspace.id,
        });

        response.sendStatus(200).end();
      } catch (e: unknown) {
        const err = e as Error;
        console.error(err.message, err);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/delete-edited-chats",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const { startingId } = reqBody(request);
        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;

        await WorkspaceChats.delete({
          workspaceId: workspace.id,
          thread_id: null,
          user_id: user?.id,
          id: { gte: Number(startingId) },
        });

        response.sendStatus(200).end();
      } catch (e: unknown) {
        const err = e as Error;
        console.error(err.message, err);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/update-chat",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const { chatId, newText = null, role = "assistant" } = reqBody(request);
        if (!newText || !String(newText).trim())
          throw new Error("Cannot save empty edit");

        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;
        const existingChat = await WorkspaceChats.get({
          workspaceId: workspace.id,
          thread_id: null,
          user_id: user?.id,
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
      } catch (e: unknown) {
        const err = e as Error;
        console.error(err.message, err);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/chat-feedback/:chatId",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const { chatId } = request.params;
        const { feedback = null } = reqBody(request);
        const user = await userFromSession(request, response);
        const existingChat = await WorkspaceChats.get({
          id: Number(chatId),
          workspaceId: response.locals.workspace.id,
        });

        if (
          !existingChat ||
          !(await canManageWorkspaceChat({
            chat: existingChat,
            user,
            response,
          }))
        ) {
          return response.status(404).json({ success: false });
        }
        await WorkspaceChats.updateFeedbackScore(chatId, feedback);
        return response.status(200).json({ success: true });
      } catch (error) {
        console.error("Error updating chat feedback:", error);
        response.status(500).end();
      }
    }
  );

  app.get(
    "/workspace/:slug/suggested-messages",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async function (
      request: Record<string, any>,
      response: Record<string, any>
    ) {
      try {
        const { slug } = request.params;
        const suggestedMessages =
          await WorkspaceSuggestedMessages.getMessages(slug);
        response.status(200).json({ success: true, suggestedMessages });
      } catch (error) {
        console.error("Error fetching suggested messages:", error);
        response
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    }
  );

  app.post(
    "/workspace/:slug/suggested-messages",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const { messages = [] } = reqBody(request);
        const { slug } = request.params;
        if (!Array.isArray(messages)) {
          return response.status(400).json({
            success: false,
            message: "Invalid message format. Expected an array of messages.",
          });
        }

        await WorkspaceSuggestedMessages.saveAll(messages, slug);
        return response.status(200).json({
          success: true,
          message: "Suggested messages saved successfully.",
        });
      } catch (error) {
        console.error("Error processing the suggested messages:", error);
        response.status(500).json({
          success: true,
          message: "Error saving the suggested messages.",
        });
      }
    }
  );

  app.post(
    "/workspace/:slug/thread/fork",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;
        const { chatId, threadSlug } = reqBody(request);
        if (!chatId)
          return response.status(400).json({ message: "chatId is required" });

        const sourceThread = threadSlug
          ? await WorkspaceThread.get({
              slug: String(threadSlug),
              workspace_id: workspace.id,
            })
          : null;
        if (
          threadSlug &&
          (!sourceThread ||
            (multiUserMode(response) && !canViewThread(sourceThread, user?.id)))
        ) {
          return response.sendStatus(404).end();
        }
        const threadId = sourceThread?.id ?? null;
        const chatsToFork = await WorkspaceChats.where(
          {
            workspaceId: workspace.id,
            ...(threadId ? {} : { user_id: user?.id }),
            include: true,
            thread_id: threadId,
            api_session_id: null,
            id: { lte: Number(chatId) },
          },
          null,
          { id: "asc" }
        );

        const { thread: newThread, message: threadError } =
          await WorkspaceThread.new(workspace, user?.id);
        if (threadError)
          return response.status(500).json({ error: threadError });

        let lastMessageText = "";
        const chatsData = chatsToFork.map(
          (chat: { prompt: string; response: string }) => {
            const chatResponse = safeJsonParse(chat.response, {});
            if (chatResponse?.text)
              lastMessageText = stripThinkingFromText(chatResponse.text);

            return {
              workspaceId: workspace.id,
              prompt: chat.prompt,
              response: JSON.stringify(chatResponse),
              user_id: user?.id,
              thread_id: newThread.id,
            };
          }
        );
        await WorkspaceChats.bulkCreate(chatsData);
        if (chatsData.length) await acceptThreadSubmission(newThread.id);
        await WorkspaceThread.update(newThread, {
          name: lastMessageText
            ? truncate(lastMessageText, 22)
            : "Forked Thread",
        });

        await EventLogs.logEvent(
          "thread_forked",
          {
            workspaceName: workspace?.name || "Unknown Workspace",
            threadName: newThread.name,
          },
          user?.id
        );
        response.status(200).json({ newThreadSlug: newThread.slug });
      } catch (e: unknown) {
        const err = e as Error;
        console.error(err.message, err);
        response.status(500).json({ message: "Internal server error" });
      }
    }
  );

  app.put(
    "/workspace/workspace-chats/:id",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const { id } = request.params;
        const user = await userFromSession(request, response);
        const validChat = await WorkspaceChats.get({
          id: Number(id),
          user_id: user?.id ?? null,
        });
        if (!validChat) {
          return response
            .status(404)
            .json({ success: false, error: "Chat not found." });
        }

        await WorkspaceChats._update(validChat.id, { include: false });
        response.json({ success: true, error: null });
      } catch (e: unknown) {
        const err = e as Error;
        console.error(err.message, err);
        response.status(500).json({ success: false, error: "Server error" });
      }
    }
  );

  app.get(
    "/workspace/:slug/prompt-history",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (_: Record<string, any>, response: Record<string, any>) => {
      try {
        response.status(200).json({
          history: await Workspace.promptHistory({
            workspaceId: response.locals.workspace.id,
          }),
        });
      } catch (error) {
        console.error("Error fetching prompt history:", error);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/prompt-history",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      validWorkspaceSlug,
    ],
    async (_: Record<string, any>, response: Record<string, any>) => {
      try {
        response.status(200).json({
          success: await Workspace.deleteAllPromptHistory({
            workspaceId: response.locals.workspace.id,
          }),
        });
      } catch (error) {
        console.error("Error clearing prompt history:", error);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/prompt-history/:id",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      validWorkspaceSlug,
    ],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const { id } = request.params;
        response.status(200).json({
          success: await Workspace.deletePromptHistory({
            workspaceId: response.locals.workspace.id,
            id: Number(id),
          }),
        });
      } catch (error) {
        console.error("Error deleting prompt history:", error);
        response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { canManageWorkspaceChat, registerWorkspaceChatEndpoints };
