const { PredefinedAgent } = require("../../models/predefinedAgent");
const { PredefinedAgentSkill } = require("../../models/predefinedAgentSkill");
const { PredefinedQuickTask } = require("../../models/predefinedQuickTask");
const { reqBody } = require("../../utils/http");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
} = require("../../utils/middleware/multiUserProtected");
const { publicSkill } = require("../agentSkills");
const {
  EDIT_ROLES,
  validateQuickTaskPayload,
  validateSkillPayload,
} = require("./validation.ts");

function registerPredefinedSkillsAndTasksEndpoints(
  app: Record<string, any>
): void {
  app.post(
    "/admin/predefined-quick-tasks/validate",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES)],
    (request: Record<string, any>, response: Record<string, any>) => {
      const { data, error } = validateQuickTaskPayload(reqBody(request));
      return response
        .status(error ? 400 : 200)
        .json({ success: !error, error, definition: data?.definition });
    }
  );

  app.post(
    "/admin/predefined-quick-tasks",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES)],
    async (request: Record<string, any>, response: Record<string, any>) => {
      const { data, error } = validateQuickTaskPayload(reqBody(request));
      if (error) return response.status(400).json({ success: false, error });
      try {
        const task = await PredefinedQuickTask.create(data);
        return response.status(200).json({ success: true, quickTask: task });
      } catch (e: unknown) {
        return response
          .status(400)
          .json({ success: false, error: (e as Error).message });
      }
    }
  );

  app.put(
    "/admin/predefined-quick-tasks/:id",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES)],
    async (request: Record<string, any>, response: Record<string, any>) => {
      const { data, error } = validateQuickTaskPayload(reqBody(request));
      if (error) return response.status(400).json({ success: false, error });
      try {
        const task = await PredefinedQuickTask.update(request.params.id, data);
        return response
          .status(task ? 200 : 404)
          .json({ success: !!task, quickTask: task });
      } catch (e: unknown) {
        return response
          .status(400)
          .json({ success: false, error: (e as Error).message });
      }
    }
  );

  app.post(
    "/admin/predefined-agent-skills",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES)],
    async (request: Record<string, any>, response: Record<string, any>) => {
      const body = reqBody(request);
      let skill;
      let error;
      if (body.skillMd) {
        const result = await PredefinedAgentSkill.createPackage(
          body,
          response.locals?.user?.id
        );
        skill = result.skill;
        error = result.error;
      } else {
        const validated = validateSkillPayload(body);
        error = validated.error;
        if (!error) skill = await PredefinedAgentSkill.create(validated.data);
      }
      if (error) return response.status(400).json({ success: false, error });
      return response.status(skill ? 200 : 500).json({
        success: !!skill,
        skill: publicSkill(skill, { includeContent: true }),
        error: skill ? null : "Unable to create skill.",
      });
    }
  );

  app.put(
    "/admin/predefined-agent-skills/:id",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES)],
    async (request: Record<string, any>, response: Record<string, any>) => {
      const body = reqBody(request);
      let skill;
      let error;
      if (body.skillMd) {
        const result = await PredefinedAgentSkill.updatePackage(
          request.params.id,
          body,
          response.locals?.user?.id
        );
        skill = result.skill;
        error = result.error;
      } else {
        const validated = validateSkillPayload(body);
        error = validated.error;
        if (!error)
          skill = await PredefinedAgentSkill.update(
            request.params.id,
            validated.data
          );
      }
      if (error) return response.status(400).json({ success: false, error });
      return response.status(skill ? 200 : 404).json({
        success: !!skill,
        skill: publicSkill(skill, { includeContent: true }),
        error: skill ? null : "Skill not found.",
      });
    }
  );

  app.get(
    "/admin/predefined-agent-skills/:id",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES)],
    async (request: Record<string, any>, response: Record<string, any>) => {
      const skill = await PredefinedAgentSkill.get(request.params.id, {
        editor: true,
      });
      return response.status(skill ? 200 : 404).json({
        success: !!skill,
        skill: publicSkill(skill, { includeContent: true }),
        error: skill ? null : "Skill not found.",
      });
    }
  );

  app.delete(
    "/admin/predefined-agent-skills/:id",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES)],
    async (request: Record<string, any>, response: Record<string, any>) => {
      const id = Number(request.params.id);
      const agents = await PredefinedAgent.all();
      await Promise.all(
        agents
          .filter((agent: { skillIds: number[] }) =>
            agent.skillIds.includes(id)
          )
          .map((agent: { id: number; skillIds: number[] }) =>
            PredefinedAgent.update(agent.id, {
              skillIds: agent.skillIds.filter((skillId) => skillId !== id),
            })
          )
      );
      const success = await PredefinedAgentSkill.delete(id);
      return response.status(success ? 200 : 500).json({ success });
    }
  );
}

module.exports = { registerPredefinedSkillsAndTasksEndpoints };
