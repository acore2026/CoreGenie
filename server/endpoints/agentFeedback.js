const {
  AgentFeedbackReason,
  AgentResponseFeedback,
  MAX_COMMENT_LENGTH,
  VALID_RATINGS,
} = require("../models/agentFeedback");
const { AgentRun } = require("../models/agentRun");
const { WorkspaceChats } = require("../models/workspaceChats");
const { WorkspaceThread } = require("../models/workspaceThread");
const {
  reqBody,
  multiUserMode,
  safeJsonParse,
  userFromSession,
} = require("../utils/http");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const { validWorkspaceSlug } = require("../utils/middleware/validWorkspace");
const { queueAgentFeedbackSync } = require("../agent-system/feedbackSync");

async function canManageChat({ chat, user, response }) {
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

function publicFeedback(feedback) {
  return feedback
    ? {
        rating: feedback.rating,
        reasonCodes: feedback.reasonCodes,
        comment: feedback.comment,
      }
    : null;
}

function agentFeedbackEndpoints(app) {
  if (!app) return;

  app.get(
    "/agent-feedback/reasons",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (_request, response) => {
      try {
        return response.status(200).json({
          reasons: await AgentFeedbackReason.list({ enabledOnly: false }),
        });
      } catch (error) {
        console.error("Failed to list Agent feedback reasons:", error);
        return response.status(500).json({
          reasons: [],
          error: "无法读取评价原因。",
        });
      }
    }
  );

  app.get(
    "/admin/agent-feedback/reasons",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_request, response) => {
      try {
        return response.status(200).json({
          reasons: await AgentFeedbackReason.list({ enabledOnly: false }),
        });
      } catch (error) {
        console.error("Failed to list Agent feedback reasons:", error);
        return response.status(500).json({
          reasons: [],
          error: "无法读取评价原因。",
        });
      }
    }
  );

  app.post(
    "/admin/agent-feedback/reasons",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const { code, label } = reqBody(request);
        const result = await AgentFeedbackReason.create({
          code,
          label,
          createdBy: user?.id || null,
        });
        return response.status(result.reason ? 200 : 400).json(result);
      } catch (error) {
        console.error("Failed to create Agent feedback reason:", error);
        return response.status(500).json({
          reason: null,
          error: "无法新增评价原因。",
        });
      }
    }
  );

  app.patch(
    "/admin/agent-feedback/reasons/:id",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const result = await AgentFeedbackReason.update(
          request.params.id,
          reqBody(request)
        );
        return response.status(result.reason ? 200 : 400).json(result);
      } catch (error) {
        console.error("Failed to update Agent feedback reason:", error);
        return response.status(500).json({
          reason: null,
          error: "无法更新评价原因。",
        });
      }
    }
  );

  app.put(
    "/workspace/:slug/agent-feedback/:chatId",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const chat = await WorkspaceChats.get({
          id: Number(request.params.chatId),
          workspaceId: response.locals.workspace.id,
        });
        if (!chat || !(await canManageChat({ chat, user, response })))
          return response.status(404).json({
            success: false,
            error: "找不到这条 Agent 回复。",
          });

        const chatResponse = safeJsonParse(chat.response, {});
        const runId = chatResponse.agentRunId;
        if (!runId)
          return response.status(400).json({
            success: false,
            error: "只有 Agent 回复可以评价。",
          });
        const run = await AgentRun.get(runId);
        if (!run || run.workspace_id !== chat.workspaceId)
          return response.status(400).json({
            success: false,
            error: "这条回复没有可关联的 Agent 运行记录。",
          });

        const { rating = null } = reqBody(request);
        if (rating === null) {
          const { responseEvaluation: _removed, ...rest } = chatResponse;
          const record = await AgentResponseFeedback.remove(chat.id, {
            chatUpdate: {
              response: JSON.stringify(rest),
              feedbackScore: null,
            },
          });
          if (record) queueAgentFeedbackSync(record.id);
          return response.status(200).json({
            success: true,
            feedback: null,
          });
        }

        if (!VALID_RATINGS.has(rating))
          return response.status(400).json({
            success: false,
            error: "评价结果无效。",
          });

        const comment = String(reqBody(request).comment || "").trim();
        if (comment.length > MAX_COMMENT_LENGTH)
          return response.status(400).json({
            success: false,
            error: `补充说明不能超过 ${MAX_COMMENT_LENGTH} 个字符。`,
          });

        const reasonCodes = Array.isArray(reqBody(request).reasonCodes)
          ? [...new Set(reqBody(request).reasonCodes.map(String))]
          : [];
        const existingFeedback = await AgentResponseFeedback.getForChat(
          chat.id
        );
        const checkedReasonCodes = rating === "good" ? [] : reasonCodes;
        const reasons = await AgentFeedbackReason.getByCodes(
          checkedReasonCodes,
          { includeDisabled: true }
        );
        const allowedDisabled = new Set(
          existingFeedback?.reasons?.map((reason) => reason.code) || []
        );
        const validReasons = reasons.filter(
          (reason) => reason.enabled || allowedDisabled.has(reason.code)
        );
        if (validReasons.length !== checkedReasonCodes.length)
          return response.status(400).json({
            success: false,
            error: "部分评价原因已经不可用，请重新选择。",
          });
        if (["neutral", "bad"].includes(rating) && !validReasons.length)
          return response.status(400).json({
            success: false,
            error: "请选择至少一个原因。",
          });
        if (validReasons.some((reason) => reason.code === "other") && !comment)
          return response.status(400).json({
            success: false,
            error: "选择“其他”时，请填写补充说明。",
          });

        const selectedReasons = rating === "good" ? [] : validReasons;
        const feedback = {
          rating,
          reasonCodes: selectedReasons.map((reason) => reason.code),
          comment,
        };
        const result = await AgentResponseFeedback.upsert({
          chat,
          runId,
          agentId: chatResponse.agentId || run.agent_id,
          rating,
          reasons: selectedReasons,
          comment,
          chatUpdate: {
            response: JSON.stringify({
              ...chatResponse,
              responseEvaluation: feedback,
            }),
            feedbackScore:
              rating === "good" ? true : rating === "bad" ? false : null,
          },
        });
        queueAgentFeedbackSync(result.record.id);
        return response.status(200).json({ success: true, feedback });
      } catch (error) {
        console.error("Failed to save Agent feedback:", error);
        return response.status(500).json({
          success: false,
          error: "评价没有保存，请重试。",
        });
      }
    }
  );
}

module.exports = { agentFeedbackEndpoints, publicFeedback };
