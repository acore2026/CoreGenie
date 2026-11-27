const { validatedRequest } = require("../utils/middleware/validatedRequest");
const { PersonalAgentSkill } = require("../models/personalAgentSkill");
const { publicSkill } = require("./agentSkills");

function present(skill) {
  return {
    ...publicSkill(skill, { includeContent: true }),
    id: skill.id,
    name: skill.name,
    description: skill.description,
    owner: skill.owner,
    isOwner: skill.isOwner,
    isShared: skill.isShared,
    enabled: skill.enabled,
    revision: skill.revision,
  };
}
function personalSkillEndpoints(app) {
  const route = (method, path, handler) =>
    app[method](path, [validatedRequest], async (req, res) => {
      const uid = res.locals?.user?.id;
      if (!Number.isSafeInteger(uid) || uid < 1)
        return res
          .status(401)
          .json({ success: false, error: "请登录个人账号后使用 Skill。" });
      try {
        const result = await handler(req, uid);
        return res.json({ success: true, ...result });
      } catch (error) {
        const status = error.status || (error.code === "P2002" ? 409 : 400);
        return res.status(status).json({
          success: false,
          error: error.status
            ? error.message
            : "操作失败，请检查 Skill 内容后重试。",
        });
      }
    });
  route("get", "/personal-skills", async (req, uid) => {
    const view = req.query.view || "mine";
    if (!["mine", "shared", "enabled"].includes(view)) {
      const error = new Error("无效的 Skill 分类。");
      error.status = 400;
      throw error;
    }
    return {
      skills: (await PersonalAgentSkill.list(uid, view)).map(present),
      template: require("../../agent-config/personal-skill-template.json")
        .skillMd,
    };
  });
  route("get", "/personal-skills/:id", async (req, uid) => ({
    skill: present(await PersonalAgentSkill.get(req.params.id, uid)),
  }));
  route("post", "/personal-skills", async (req, uid) => ({
    skill: present(await PersonalAgentSkill.save(uid, null, req.body || {})),
  }));
  route("put", "/personal-skills/:id", async (req, uid) => ({
    skill: present(
      await PersonalAgentSkill.save(uid, req.params.id, req.body || {})
    ),
  }));
  route("patch", "/personal-skills/:id/sharing", async (req, uid) => {
    await PersonalAgentSkill.share(req.params.id, uid, req.body?.isShared);
    return {};
  });
  route("put", "/personal-skills/:id/enabled", async (req, uid) => {
    await PersonalAgentSkill.enable(req.params.id, uid, req.body?.enabled);
    return {};
  });
  route("delete", "/personal-skills/:id", async (req, uid) => {
    await PersonalAgentSkill.remove(req.params.id, uid);
    return {};
  });
}
module.exports = { personalSkillEndpoints };
