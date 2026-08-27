const { WorkspaceChats } = require("../../../../models/workspaceChats");
const { WorkspaceThread } = require("../../../../models/workspaceThread");

function completedAgentTrace(aibitat) {
  const trace = (aibitat.getAgentTrace?.() ?? []).filter(
    (entry) => !["finalizing", "completed"].includes(entry.phase)
  );
  if (!trace.length) return [];
  return [
    ...trace,
    {
      id: "agent-trace-complete",
      summary: "Agent session complete",
      phase: "completed",
      createdAt: new Date().toISOString(),
    },
  ];
}

/**
 * Plugin to save chat history to AnythingLLM DB.
 */
const chatHistory = {
  name: "chat-history",
  startupConfig: {
    params: {},
  },
  plugin: function () {
    return {
      name: this.name,
      setup: function (aibitat) {
        const logPersistenceError = (stage, error) => {
          const message = error?.message || String(error);
          aibitat.handlerProps?.log?.(
            `[chat-history] ${stage} failed: ${message}`
          );
          console.error(`[chat-history] ${stage} failed: ${message}`);
        };

        // Message events are synchronous, but the database operations they
        // start are not. Keep explicit promises so a fast model cannot save a
        // response before the placeholder row has returned its ID, and so the
        // socket can remain open until the final write has settled.
        aibitat._chatHistoryReady = Promise.resolve(true);
        aibitat._chatHistorySavePromise = Promise.resolve();
        aibitat.waitForChatHistory = async () => {
          await aibitat._chatHistoryReady;
          await aibitat._chatHistorySavePromise;
        };

        // If the agent is aborted (e.g. user sent /reset mid-response), skip
        // the pending save so a completing in-flight response doesn't reappear.
        aibitat.onAbort(() => {
          aibitat._aborted = true;
        });

        // pre-register a workspace chat ID to secure it in the DB
        aibitat.onMessage((message) => {
          if (message.from !== "USER") return;

          /**
           * If we don't have a tracked chat ID, we need to create a new one so we can upsert the response later.
           * Normally, if this was a totally fresh chat from the user, we can assume that the message from the socket is
           * the message we want to store for the prompt. However, if this is a regeneration of a previous message and that message
           * called tools the history could include intermediate messages so need to search backwards to find the most recent user message
           * as that is actually the prompt.
           */
          if (!aibitat.trackedChatId) {
            let userMessage = message.content;
            if (userMessage.startsWith("@agent:")) {
              const lastUserMsgIndex = aibitat._chats.findLastIndex(
                (c) => c.from === "USER" && !c.content.startsWith("@agent:")
              );

              // When regenerating a message, we need to use the last user message as the prompt.
              // Also prune the chats array to only include the messages before target prompt to re-run
              // or else tool call results from the previous run will be included in the history and the model will not re-call tools
              // that previously worked for the to-be-regenerated prompt.
              if (lastUserMsgIndex !== -1) {
                userMessage = aibitat._chats[lastUserMsgIndex].content;
                aibitat._chats = aibitat._chats.slice(0, lastUserMsgIndex + 1);
              }
            }

            aibitat._chatHistoryReady = (async () => {
              const { chat, message: errorMessage } = await WorkspaceChats.new({
                workspaceId: Number(
                  aibitat.handlerProps.invocation.workspace_id
                ),
                user: {
                  id: aibitat.handlerProps.invocation.user_id || null,
                },
                threadId: aibitat.handlerProps.invocation.thread_id || null,
                include: false,
                prompt: userMessage,
                response: {},
              });
              if (!chat)
                throw new Error(
                  errorMessage || "Workspace chat row was not created."
                );
              aibitat.registerChatId(chat.id);
              return true;
            })().catch((error) => {
              logPersistenceError("creating the pending chat", error);
              return false;
            });
          }
        });

        aibitat.onMessage(() => {
          if (aibitat._aborted) return;
          const lastResponses = aibitat.chats.slice(-2);
          if (lastResponses.length !== 2) return;
          const [prev, last] = lastResponses;

          // We need a full conversation reply with prev being from
          // the USER and the last being from anyone other than the user.
          if (prev.from !== "USER" || last.from === "USER") return;

          // Assign this synchronously during the message event so a terminate
          // event emitted immediately afterwards can wait for the write.
          aibitat._chatHistorySavePromise = (async () => {
            const ready = await aibitat._chatHistoryReady;
            if (!ready || aibitat._aborted) return;
            if (!aibitat.trackedChatId)
              throw new Error("No workspace chat ID is available for saving.");

            // Extract attachments from user message if present
            const attachments = prev.attachments || [];

            // If we have a post-reply flow we should save the chat using this special flow
            // so that post save cleanup and other unique properties can be run as opposed to regular chat.
            if (aibitat.hasOwnProperty("_replySpecialAttributes")) {
              await this._storeSpecial(aibitat, {
                prompt: prev.content,
                response: last.content,
                attachments,
                options: aibitat._replySpecialAttributes,
              });
              delete aibitat._replySpecialAttributes;
              return;
            }

            await this._store(aibitat, {
              prompt: prev.content,
              response: last.content,
              attachments,
            });
          })().catch((error) => {
            logPersistenceError("saving the completed chat", error);
          });
        });
      },
      _store: async function (
        aibitat,
        { prompt, response, attachments = [] } = {}
      ) {
        const invocation = aibitat.handlerProps.invocation;
        const metrics = aibitat.providerInstance?.getUsage?.() ?? {};
        const citations = aibitat._pendingCitations ?? [];
        const outputs = aibitat._pendingOutputs ?? [];
        const clarifyingQuestions =
          aibitat._pendingClarifyingQuestionSurveys ?? [];
        const subagentRuns = aibitat.getSubagentRuns?.() ?? [];
        const contextTraces = aibitat.getContextTraces?.() ?? [];
        const agentTrace = completedAgentTrace(aibitat);
        const { chat, message } = await WorkspaceChats.upsert(
          aibitat.trackedChatId,
          {
            workspaceId: Number(invocation.workspace_id),
            prompt,
            response: {
              text: response,
              sources: citations,
              type: "chat",
              attachments,
              metrics,
              ...(agentTrace.length > 0 ? { agentTrace } : {}),
              ...(outputs.length > 0 ? { outputs } : {}),
              ...(clarifyingQuestions.length > 0
                ? { clarifyingQuestions }
                : {}),
              ...(subagentRuns.length > 0 ? { subagentRuns } : {}),
              ...(contextTraces.length > 0 ? { contextTraces } : {}),
            },
            user: { id: invocation?.user_id || null },
            threadId: invocation?.thread_id || null,
            include: true,
          }
        );
        if (!chat)
          throw new Error(message || "Workspace chat response was not saved.");

        if (!aibitat._threadRenamed) {
          aibitat._threadRenamed = await this._autoRenameThread(aibitat);
        }
        this._cleanup(aibitat);
      },
      _storeSpecial: async function (
        aibitat,
        { prompt, response, attachments = [], options = {} } = {}
      ) {
        const invocation = aibitat.handlerProps.invocation;
        const metrics = aibitat.providerInstance?.getUsage?.() ?? {};
        const citations = aibitat._pendingCitations ?? [];
        const outputs = aibitat._pendingOutputs ?? [];
        const clarifyingQuestions =
          aibitat._pendingClarifyingQuestionSurveys ?? [];
        const subagentRuns = aibitat.getSubagentRuns?.() ?? [];
        const contextTraces = aibitat.getContextTraces?.() ?? [];
        const agentTrace = completedAgentTrace(aibitat);
        const existingSources = options?.sources ?? [];
        const { chat, message } = await WorkspaceChats.upsert(
          aibitat.trackedChatId,
          {
            workspaceId: Number(invocation.workspace_id),
            prompt,
            response: {
              sources: [...existingSources, ...citations],
              // when we have a _storeSpecial called the options param can include a storedResponse() function
              // that will override the text property to store extra information in, depending on the special type of chat.
              text: options.hasOwnProperty("storedResponse")
                ? options.storedResponse(response)
                : response,
              type: options?.saveAsType ?? "chat",
              attachments,
              metrics,
              ...(agentTrace.length > 0 ? { agentTrace } : {}),
              ...(outputs.length > 0 ? { outputs } : {}),
              ...(clarifyingQuestions.length > 0
                ? { clarifyingQuestions }
                : {}),
              ...(subagentRuns.length > 0 ? { subagentRuns } : {}),
              ...(contextTraces.length > 0 ? { contextTraces } : {}),
            },
            user: { id: invocation?.user_id || null },
            threadId: invocation?.thread_id || null,
            include: true,
          }
        );
        if (!chat)
          throw new Error(message || "Workspace chat response was not saved.");

        if (!aibitat._threadRenamed) {
          aibitat._threadRenamed = await this._autoRenameThread(aibitat);
        }
        options?.postSave();
        this._cleanup(aibitat);
      },

      _autoRenameThread: async function (aibitat) {
        const invocation = aibitat.handlerProps.invocation;
        if (!invocation?.thread_id) return true;

        const thread = await WorkspaceThread.get({ id: invocation.thread_id });
        if (!thread) return true;

        const { Workspace } = require("../../../../models/workspace");
        const workspace = await Workspace.get({ id: invocation.workspace_id });
        if (!workspace) return true;

        await WorkspaceThread.autoRenameThread({
          thread,
          workspace,
          user: invocation.user_id ? { id: invocation.user_id } : null,
          onRename: (updatedThread) => {
            aibitat.socket?.send("rename_thread", {
              slug: updatedThread.slug,
              name: updatedThread.name,
            });
          },
        });
        return true;
      },

      _cleanup: function (aibitat) {
        aibitat.clearCitations?.();
        aibitat._pendingOutputs = [];
        aibitat.clearClarifyingQuestionSurveys?.();
        aibitat.clearSubagentRuns?.();
        aibitat.clearContextTraces?.();
        aibitat.clearTrackedChatId();
      },
    };
  },
};

module.exports = { chatHistory };
