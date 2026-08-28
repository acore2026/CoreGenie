const fs = require("fs/promises");
const path = require("path");
const { PredefinedAgentSkill } = require("../models/predefinedAgentSkill");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validWorkspaceSlug } = require("../utils/middleware/validWorkspace");
const { handleSkillAssetUpload } = require("../utils/files/multer");
const {
  listWorkspacePackages,
  packageForEditor,
  parseSkillMarkdown,
  SKILL_NAME_PATTERN,
  saveWorkspacePackage,
  workspaceSkillsRoot,
} = require("../agent-skills/package");

function publicSkill(skill, { includeContent = false } = {}) {
  if (!skill) return null;
  return {
    id: skill.id || null,
    scope: skill.scope,
    name: skill.manifest?.name || skill.name,
    description: skill.manifest?.description || skill.description || "",
    revision: skill.revision || skill.sha256 || null,
    manifest: skill.manifest || {},
    skillMd: includeContent ? skill.skillMd || skill.source : undefined,
    instructions: includeContent ? skill.instructions ?? skill.body : undefined,
    files: (skill.files || []).map((file) => ({
      path: file.path,
      size: file.size,
      text: file.text,
      sha256: file.sha256,
      ...(includeContent && file.content != null
        ? { content: file.content, encoding: file.encoding }
        : {}),
    })),
    valid: skill.valid !== false,
    warnings: skill.warnings || [],
    errors: skill.errors || [],
    lastUpdatedAt: skill.lastUpdatedAt || null,
  };
}

async function globalNameCollision(name) {
  const skills = await PredefinedAgentSkill.all();
  return skills.some((skill) => skill.name === name);
}

function workspaceSkillEndpoints(app) {
  if (!app) return;
  const workspaceMiddleware = [
    validatedRequest,
    flexUserRoleValid([ROLES.all]),
    validWorkspaceSlug,
  ];

  app.post(
    "/admin/predefined-agent-skills/:id/file",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin]),
      handleSkillAssetUpload,
    ],
    async (request, response) => {
      if (!request.file || !request.body?.path)
        return response.status(400).json({
          success: false,
          error: "File and package path are required.",
        });
      const current = await PredefinedAgentSkill.get(request.params.id, {
        editor: true,
      });
      if (!current)
        return response
          .status(404)
          .json({ success: false, error: "Skill not found." });
      const result = await PredefinedAgentSkill.updatePackage(
        request.params.id,
        {
          skillMd: current.skillMd,
          files: [
            {
              path: request.body.path,
              content: request.file.buffer.toString("base64"),
              encoding: "base64",
            },
          ],
        },
        response.locals?.user?.id
      );
      return response.status(result.skill ? 200 : 400).json({
        success: !!result.skill,
        skill: publicSkill(result.skill, { includeContent: true }),
        error: result.error,
      });
    }
  );

  app.post(
    "/agent-skills/validate",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      const result = parseSkillMarkdown(request.body?.skillMd);
      return response.status(result.valid ? 200 : 400).json({
        success: result.valid,
        manifest: result.manifest,
        warnings: result.warnings,
        errors: result.errors,
      });
    }
  );

  app.get(
    "/workspace/:slug/agent-skills",
    workspaceMiddleware,
    async (_request, response) => {
      const packages = await listWorkspacePackages(
        response.locals.workspace.id
      );
      const globalNames = new Set(
        (await PredefinedAgentSkill.all()).map((skill) => skill.name)
      );
      const skills = packages.map((skill) => {
        if (globalNames.has(skill.manifest.name)) {
          skill.valid = false;
          skill.errors = [
            ...skill.errors,
            `Workspace skill conflicts with global skill "${skill.manifest.name}".`,
          ];
        }
        return publicSkill(skill);
      });
      return response.status(200).json({ success: true, skills });
    }
  );

  app.get(
    "/workspace/:slug/agent-skills/:name",
    workspaceMiddleware,
    async (request, response) => {
      if (!SKILL_NAME_PATTERN.test(request.params.name))
        return response
          .status(400)
          .json({ success: false, error: "Invalid skill name." });
      try {
        const root = path.join(
          workspaceSkillsRoot(response.locals.workspace.id),
          request.params.name
        );
        const skill = await packageForEditor(root, {
          directoryName: request.params.name,
        });
        return response.status(200).json({
          success: true,
          skill: publicSkill(
            { ...skill, scope: "workspace" },
            { includeContent: true }
          ),
        });
      } catch (error) {
        return response
          .status(404)
          .json({ success: false, error: error.message });
      }
    }
  );

  app.post(
    "/workspace/:slug/agent-skills",
    workspaceMiddleware,
    async (request, response) => {
      const parsed = parseSkillMarkdown(request.body?.skillMd);
      if (!parsed.valid)
        return response.status(400).json({
          success: false,
          error: parsed.errors.join(" "),
          errors: parsed.errors,
          warnings: parsed.warnings,
        });
      if (await globalNameCollision(parsed.manifest.name))
        return response.status(409).json({
          success: false,
          error: `Workspace skill conflicts with global skill "${parsed.manifest.name}".`,
        });
      try {
        const skill = await saveWorkspacePackage(
          response.locals.workspace.id,
          request.body,
          request.body?.previousName || null
        );
        return response.status(200).json({
          success: true,
          skill: publicSkill(
            { ...skill, scope: "workspace" },
            { includeContent: true }
          ),
        });
      } catch (error) {
        return response
          .status(400)
          .json({ success: false, error: error.message });
      }
    }
  );

  app.delete(
    "/workspace/:slug/agent-skills/:name",
    workspaceMiddleware,
    async (request, response) => {
      if (!SKILL_NAME_PATTERN.test(request.params.name))
        return response
          .status(400)
          .json({ success: false, error: "Invalid skill name." });
      const root = workspaceSkillsRoot(response.locals.workspace.id);
      const target = path.join(root, request.params.name);
      if (path.dirname(target) !== root)
        return response
          .status(400)
          .json({ success: false, error: "Invalid skill name." });
      await fs.rm(target, { recursive: true, force: true });
      return response.status(200).json({ success: true });
    }
  );

  app.post(
    "/workspace/:slug/agent-skills/:name/file",
    [...workspaceMiddleware, handleSkillAssetUpload],
    async (request, response) => {
      if (!SKILL_NAME_PATTERN.test(request.params.name))
        return response
          .status(400)
          .json({ success: false, error: "Invalid skill name." });
      if (!request.file || !request.body?.path)
        return response.status(400).json({
          success: false,
          error: "File and package path are required.",
        });
      try {
        const root = path.join(
          workspaceSkillsRoot(response.locals.workspace.id),
          request.params.name
        );
        const current = await packageForEditor(root, {
          directoryName: request.params.name,
        });
        const skill = await saveWorkspacePackage(
          response.locals.workspace.id,
          {
            skillMd: current.source,
            files: [
              {
                path: request.body.path,
                content: request.file.buffer.toString("base64"),
                encoding: "base64",
              },
            ],
          },
          request.params.name
        );
        return response.status(200).json({
          success: true,
          skill: publicSkill(
            { ...skill, scope: "workspace" },
            { includeContent: true }
          ),
        });
      } catch (error) {
        return response
          .status(400)
          .json({ success: false, error: error.message });
      }
    }
  );
}

module.exports = { publicSkill, workspaceSkillEndpoints };
