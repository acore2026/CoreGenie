const fs = require("fs");
const path = require("path");
const { getType, getExtension } = require("mime");
const { v4 } = require("uuid");
const { PredefinedAgent } = require("../models/predefinedAgent");
const { PredefinedAgentSkill } = require("../models/predefinedAgentSkill");
const { reqBody } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { handleAgentIconUpload } = require("../utils/files/multer");
const { normalizePath, isWithin } = require("../utils/files");
const { toolRegistry } = require("../tools");
const MCPCompatibilityLayer = require("../utils/MCP");
const { ModelCapability } = require("../models/modelCapability");
const {
  DEFAULT_RUNTIME_KEY,
  normalizeRuntimeConfig,
  runtimeOptions,
} = require("../agent-system/runtimes/registry");
const { publicSkill } = require("./agentSkills");

const EDIT_ROLES = [ROLES.admin];
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;
const MAX_WELCOME = 300;
const MAX_EXAMPLE_PROMPTS = 6;
const MAX_EXAMPLE_PROMPT = 240;
const MAX_EXAMPLE_PROMPT_LABEL = 120;
const MAX_EXAMPLE_PROMPT_DETAIL = 1_000;
const MAX_PROMPT = 40_000;

function cleanText(value, max, { required = false } = {}) {
  const text = String(value ?? "")
    .trim()
    .slice(0, max);
  if (required && !text) return null;
  return text;
}

function uniqueIntegers(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(Number).filter(Number.isInteger))];
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .map(String)
        .map((v) => v.trim())
        .filter(Boolean)
    ),
  ];
}

function cleanExamplePrompts(values) {
  if (!Array.isArray(values)) return [];
  const prompts = [];
  const seen = new Set();
  for (const value of values) {
    const cleaned =
      typeof value === "string"
        ? cleanText(value, MAX_EXAMPLE_PROMPT)
        : {
            label: cleanText(
              value?.label || value?.prompt,
              MAX_EXAMPLE_PROMPT_LABEL
            ),
            prompt: cleanText(value?.prompt, MAX_EXAMPLE_PROMPT_DETAIL),
          };
    if (!cleaned || (typeof cleaned !== "string" && !cleaned.prompt)) continue;
    const normalized =
      typeof cleaned === "string"
        ? cleaned
        : { label: cleaned.label || cleaned.prompt, prompt: cleaned.prompt };
    const fingerprint = JSON.stringify(normalized);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    prompts.push(normalized);
    if (prompts.length >= MAX_EXAMPLE_PROMPTS) break;
  }
  return prompts;
}

function validateAgentPayload(body) {
  const name = cleanText(body.name, MAX_NAME, { required: true });
  const systemPrompt = cleanText(body.systemPrompt, MAX_PROMPT, {
    required: true,
  });
  if (!name) return { error: "Agent name is required." };
  if (!systemPrompt) return { error: "Agent system prompt is required." };
  const runtimeKey = DEFAULT_RUNTIME_KEY;
  let runtimeConfig;
  try {
    runtimeConfig = normalizeRuntimeConfig(runtimeKey, body.runtimeConfig);
  } catch (error) {
    return { error: error.message };
  }
  return {
    data: {
      name,
      description: cleanText(body.description, MAX_DESCRIPTION),
      welcomeMessage: cleanText(body.welcomeMessage, MAX_WELCOME) || null,
      examplePrompts: cleanExamplePrompts(body.examplePrompts),
      tools: body.tools === null ? null : uniqueStrings(body.tools),
      skillIds: uniqueIntegers(body.skillIds),
      systemPrompt,
      runtimeKey,
      runtimeConfig,
      enabled: body.enabled !== false,
    },
  };
}

function validateSkillPayload(body) {
  const name = cleanText(body.name, MAX_NAME, { required: true });
  const instructions = cleanText(body.instructions, MAX_PROMPT, {
    required: true,
  });
  if (!name) return { error: "Skill name is required." };
  if (!instructions) return { error: "Skill instructions are required." };
  return {
    data: {
      name,
      description: cleanText(body.description, MAX_DESCRIPTION),
      instructions,
    },
  };
}

function iconDirectory() {
  return process.env.STORAGE_DIR
    ? path.resolve(process.env.STORAGE_DIR, "assets", "agent-icons")
    : path.resolve(__dirname, "../storage/assets/agent-icons");
}

function iconPath(filename) {
  const root = iconDirectory();
  const target = path.resolve(root, normalizePath(filename));
  return isWithin(root, target) ? target : null;
}

function hasValidImageSignature(file) {
  const buffer = file?.buffer;
  if (!Buffer.isBuffer(buffer)) return false;
  switch (file.mimetype) {
    case "image/png":
      return buffer
        .subarray(0, 8)
        .equals(Buffer.from("89504e470d0a1a0a", "hex"));
    case "image/jpeg":
      return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
    case "image/gif":
      return ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString());
    case "image/webp":
      return (
        buffer.subarray(0, 4).toString() === "RIFF" &&
        buffer.subarray(8, 12).toString() === "WEBP"
      );
    default:
      return false;
  }
}

function labelForTool(identifier) {
  return String(identifier)
    .replace(/^@@mcp_/, "MCP · ")
    .replace(/^@@/, "Custom · ")
    .replace(/#/g, " · ")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function activeToolOptions() {
  const values = [
    ...toolRegistry.list().map((tool) => tool.id),
    ...(await new MCPCompatibilityLayer().activeMCPServers()),
  ];
  const identifiers = values
    .map((value) => (typeof value === "string" ? value : value?.name))
    .filter(Boolean);
  return [...new Set(identifiers)].map((id) => ({
    id,
    name: labelForTool(id),
  }));
}

function predefinedAgentEndpoints(app) {
  if (!app) return;

  app.get(
    "/predefined-agents",
    [validatedRequest, flexUserRoleValid(ROLES.all)],
    async (_request, response) => {
      await require("../agent-skills/seed").seedBuiltinSkills();
      const [agents, defaultAgentId] = await Promise.all([
        PredefinedAgent.all({ enabledOnly: true }),
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
            iconUrl,
            enabled,
            isBuiltinDefault,
            runtimeKey,
            runtimeConfig,
          }) => ({
            id,
            name,
            description,
            welcomeMessage,
            examplePrompts,
            iconUrl,
            enabled,
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
    async (_request, response) => {
      await require("../agent-skills/seed").seedBuiltinSkills();
      await ModelCapability.seedBuiltins();
      const [agents, skills, tools, defaultAgentId, modelCapabilities] =
        await Promise.all([
          PredefinedAgent.all(),
          PredefinedAgentSkill.all(),
          activeToolOptions(),
          PredefinedAgent.defaultId(),
          ModelCapability.list(),
        ]);
      return response.status(200).json({
        agents,
        skills: skills.map((skill) => publicSkill(skill)),
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
    async (_request, response) => {
      await ModelCapability.seedBuiltins();
      return response.status(200).json({
        modelCapabilities: await ModelCapability.list(),
      });
    }
  );

  app.put(
    "/admin/model-capabilities",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES)],
    async (request, response) => {
      const body = reqBody(request);
      if (!cleanText(body.provider, 120) || !cleanText(body.model, 300))
        return response
          .status(400)
          .json({ success: false, error: "Provider and model are required." });
      const capability = await ModelCapability.upsert(
        body,
        response.locals?.user?.id
      );
      return response.status(200).json({ success: true, capability });
    }
  );

  app.post(
    "/admin/predefined-agents",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES)],
    async (request, response) => {
      const { data, error } = validateAgentPayload(reqBody(request));
      if (error) return response.status(400).json({ success: false, error });
      const agent = await PredefinedAgent.create(data);
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
    async (request, response) => {
      const { data, error } = validateAgentPayload(reqBody(request));
      if (error) return response.status(400).json({ success: false, error });
      const current = await PredefinedAgent.get(request.params.id);
      if (!current)
        return response
          .status(404)
          .json({ success: false, error: "Agent not found." });
      if (current.isBuiltinDefault) data.enabled = true;
      if (
        Number(request.params.id) === (await PredefinedAgent.defaultId()) &&
        data.enabled === false
      )
        return response.status(400).json({
          success: false,
          error:
            "Choose another global default Agent before disabling this one.",
        });
      const agent = await PredefinedAgent.update(request.params.id, data);
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
    async (request, response) => {
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
      if (agent.iconFilename) {
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
    async (request, response) => {
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
    async (request, response) => {
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

  app.get("/predefined-agents/:id/icon", async (request, response) => {
    const agent = await PredefinedAgent.get(request.params.id);
    const target = agent?.iconFilename ? iconPath(agent.iconFilename) : null;
    if (!target || !fs.existsSync(target)) return response.sendStatus(404);
    response.setHeader("Content-Type", getType(target) || "image/png");
    response.setHeader("Cache-Control", "public, max-age=86400");
    return response.sendFile(target);
  });

  app.post(
    "/admin/predefined-agent-skills",
    [validatedRequest, flexUserRoleValid(EDIT_ROLES)],
    async (request, response) => {
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
    async (request, response) => {
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
    async (request, response) => {
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
    async (request, response) => {
      const id = Number(request.params.id);
      const agents = await PredefinedAgent.all();
      await Promise.all(
        agents
          .filter((agent) => agent.skillIds.includes(id))
          .map((agent) =>
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

module.exports = { cleanExamplePrompts, predefinedAgentEndpoints };
