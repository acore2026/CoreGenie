const fs = require("fs");
const path = require("path");
const { z } = require("zod");
const { getType, getExtension } = require("mime");
const { v4 } = require("uuid");
const { PredefinedAgent } = require("../../models/predefinedAgent");
const { PredefinedAgentSkill } = require("../../models/predefinedAgentSkill");
const { PredefinedQuickTask } = require("../../models/predefinedQuickTask");
const { reqBody } = require("../../utils/http");
const { typedHandler } = require("../../utils/http/typedHandler.ts");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../../utils/middleware/multiUserProtected");
const { handleAgentIconUpload } = require("../../utils/files/multer");
const { ModelCapability } = require("../../models/modelCapability");
const { runtimeOptions } = require("../../agent-system/runtimes/registry");
const { publicSkill } = require("../agentSkills");
const {
  EDIT_ROLES,
  activeToolOptions,
  hasValidImageSignature,
  iconDirectory,
  iconPath,
  validateAgentPayload,
} = require("./validation.ts");

const modelCapabilityBodySchema = z
  .object({
    provider: z
      .string()
      .trim()
      .min(1, "Provider and model are required.")
      .max(120),
    model: z
      .string()
      .trim()
      .min(1, "Provider and model are required.")
      .max(300),
  })
  .passthrough();

function registerPredefinedAgentCoreEndpoints(app: Record<string, any>): void {
  app.post(
    "/admin/display-order/:kind",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES)],
    async (request: Record<string, any>, response: Record<string, any>) => {
      if (!["agents", "quick-tasks"].includes(request.params.kind))
        return response.sendStatus(404);
      try {
        await require("../../models/displayOrder").DisplayOrder.save(
          request.params.kind,
          reqBody(request).ids
        );
        return response.json({ success: true });
      } catch (error: unknown) {
        return response
          .status(400)
          .json({ success: false, error: (error as Error).message });
      }
    }
  );

  app.get(
    "/predefined-agents",
    [validatedRequest, flexUserRoleValid(ROLES.all)],
    async (_request: Record<string, any>, response: Record<string, any>) => {
      await require("../../agent-skills/seed").seedBuiltinSkills();
      const [agents, defaultAgentId] = await Promise.all([
        PredefinedAgent.all({ enabledOnly: true, rosterOnly: true }),
        PredefinedAgent.defaultId(),
      ]);
      return response.status(200).json({
        agents: agents.map(
          ({
            id,
            name,
            description,
            welcomeMessage,
            examplePrompts,
            wizard,
            iconUrl,
            enabled,
            showInRoster,
            isBuiltinDefault,
            runtimeKey,
            runtimeConfig,
          }: Record<string, any>) => ({
            id,
            name,
            description,
            welcomeMessage,
            examplePrompts,
            wizard,
            iconUrl,
            enabled,
            showInRoster,
            isBuiltinDefault,
            runtimeKey,
            attachmentMode: runtimeConfig?.attachmentMode || "parsed",
          })
        ),
        defaultAgentId,
      });
    }
  );

  app.get(
    "/admin/predefined-agents",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES)],
    async (_request: Record<string, any>, response: Record<string, any>) => {
      await require("../../agent-skills/seed").seedBuiltinSkills();
      await ModelCapability.seedBuiltins();
      const [
        agents,
        skills,
        quickTasks,
        tools,
        defaultAgentId,
        modelCapabilities,
      ] = await Promise.all([
        PredefinedAgent.all(),
        PredefinedAgentSkill.all(),
        PredefinedQuickTask.all({ includeArchived: true }),
        activeToolOptions(),
        PredefinedAgent.defaultId(),
        ModelCapability.list(),
      ]);
      return response.status(200).json({
        agents,
        skills: skills.map((skill: Record<string, any>) => publicSkill(skill)),
        quickTasks,
        tools,
        runtimes: runtimeOptions(),
        defaultAgentId,
        modelCapabilities,
      });
    }
  );

  app.get(
    "/admin/model-capabilities",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES)],
    async (_request: Record<string, any>, response: Record<string, any>) => {
      await ModelCapability.seedBuiltins();
      return response.status(200).json({
        modelCapabilities: await ModelCapability.list(),
      });
    }
  );

  app.put(
    "/admin/model-capabilities",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES)],
    typedHandler(
      { body: modelCapabilityBodySchema },
      async (
        { body }: { body: Record<string, any> },
        response: Record<string, any>
      ) => {
        const capability = await ModelCapability.upsert(
          body,
          response.locals?.user?.id
        );
        return response.status(200).json({ success: true, capability });
      }
    )
  );

  app.post(
    "/admin/predefined-agents",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES)],
    async (request: Record<string, any>, response: Record<string, any>) => {
      const { data, error } = validateAgentPayload(reqBody(request));
      if (error) return response.status(400).json({ success: false, error });
      let agent;
      try {
        agent = await PredefinedAgent.create(data);
      } catch (err: unknown) {
        return response
          .status(400)
          .json({ success: false, error: (err as Error).message });
      }
      return response.status(agent ? 200 : 500).json({
        success: !!agent,
        agent,
        error: agent ? null : "Unable to create agent.",
      });
    }
  );

  app.put(
    "/admin/predefined-agents/:id",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES)],
    async (request: Record<string, any>, response: Record<string, any>) => {
      const { data, error } = validateAgentPayload(reqBody(request));
      if (error) return response.status(400).json({ success: false, error });
      const current = await PredefinedAgent.get(request.params.id);
      if (!current)
        return response
          .status(404)
          .json({ success: false, error: "Agent not found." });
      let agent;
      try {
        agent = await PredefinedAgent.update(request.params.id, data);
      } catch (err: unknown) {
        return response
          .status(400)
          .json({ success: false, error: (err as Error).message });
      }
      return response.status(agent ? 200 : 404).json({
        success: !!agent,
        agent,
        error: agent ? null : "Agent not found.",
      });
    }
  );

  app.delete(
    "/admin/predefined-agents/:id",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES)],
    async (request: Record<string, any>, response: Record<string, any>) => {
      const agent = await PredefinedAgent.get(request.params.id);
      if (!agent) return response.status(404).json({ success: false });
      if (agent.isBuiltinDefault)
        return response.status(400).json({
          success: false,
          error: "The built-in general-purpose Agent cannot be deleted.",
        });
      if (agent.id === (await PredefinedAgent.defaultId()))
        return response.status(400).json({
          success: false,
          error:
            "Choose another global default Agent before deleting this one.",
        });
      if (agent.iconFilename && !require("../../config-sync").enabled()) {
        const target = iconPath(agent.iconFilename);
        if (target && fs.existsSync(target)) fs.unlinkSync(target);
      }
      const success = await PredefinedAgent.delete(agent.id);
      return response.status(success ? 200 : 500).json({ success });
    }
  );

  app.post(
    "/admin/predefined-agents/default",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES)],
    async (request: Record<string, any>, response: Record<string, any>) => {
      const { agentId } = reqBody(request);
      const success = await PredefinedAgent.setDefault(agentId);
      return response.status(success ? 200 : 400).json({
        success,
        defaultAgentId: success ? Number(agentId) : null,
        error: success
          ? null
          : "The general-purpose Agent must be enabled and available.",
      });
    }
  );

  app.post(
    "/admin/predefined-agents/:id/icon",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES), handleAgentIconUpload],
    async (request: Record<string, any>, response: Record<string, any>) => {
      const agent = await PredefinedAgent.get(request.params.id);
      if (!agent || !request.file)
        return response
          .status(400)
          .json({ success: false, error: "Missing icon." });
      if (!hasValidImageSignature(request.file))
        return response.status(400).json({
          success: false,
          error: "Uploaded file is not a valid supported image.",
        });

      const ext = getExtension(request.file.mimetype) || "png";
      const filename = `${v4()}.${ext}`;
      const directory = iconDirectory();
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, filename), request.file.buffer);
      if (agent.iconFilename) {
        const oldTarget = iconPath(agent.iconFilename);
        if (oldTarget && fs.existsSync(oldTarget)) fs.unlinkSync(oldTarget);
      }
      const updated = await PredefinedAgent.update(agent.id, {
        iconFilename: filename,
      });
      return response.status(updated ? 200 : 500).json({
        success: !!updated,
        agent: updated,
      });
    }
  );

  app.get(
    "/predefined-agents/:id/icon",
    async (request: Record<string, any>, response: Record<string, any>) => {
      const agent = await PredefinedAgent.get(request.params.id);
      const target = agent?.iconFilename ? iconPath(agent.iconFilename) : null;
      if (!target || !fs.existsSync(target)) return response.sendStatus(404);
      response.setHeader("Content-Type", getType(target) || "image/png");
      response.setHeader("Cache-Control", "public, max-age=86400");
      return response.sendFile(target);
    }
  );
}

module.exports = { registerPredefinedAgentCoreEndpoints };
