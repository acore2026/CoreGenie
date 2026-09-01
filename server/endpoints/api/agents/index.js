const { Workspace } = require("../../../models/workspace");
const { WorkspaceThread } = require("../../../models/workspaceThread");
const { PredefinedAgent } = require("../../../models/predefinedAgent");
const {
  PredefinedAgentSkill,
} = require("../../../models/predefinedAgentSkill");
const { validApiKey } = require("../../../utils/middleware/validApiKey");
const {
  commandRun,
  createRun,
  snapshotRun,
  streamEvents,
} = require("../../agentRuns");

async function loadApiConversation(request, response, next) {
  const workspace = await Workspace.get({ slug: String(request.params.slug) });
  if (!workspace)
    return response.status(404).json({ error: "Workspace not found." });
  let thread = null;
  if (request.params.threadSlug) {
    thread = await WorkspaceThread.get({
      slug: String(request.params.threadSlug),
      workspace_id: workspace.id,
    });
    if (!thread)
      return response
        .status(404)
        .json({ error: "Workspace thread not found." });
  }
  response.locals.workspace = workspace;
  response.locals.thread = thread;
  next();
}

async function listAgents(_request, response) {
  await require("../../../agent-skills/seed").seedBuiltinSkills();
  const [agents, defaultAgentId] = await Promise.all([
    PredefinedAgent.all({ enabledOnly: true }),
    PredefinedAgent.defaultId(),
  ]);
  const safeAgents = await Promise.all(
    agents.map(async (agent) => {
      const skills = await PredefinedAgentSkill.whereIds(agent.skillIds || []);
      return {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        default: agent.id === defaultAgentId,
        runtime: agent.runtimeKey,
        skillNames: skills.map((skill) => skill.name),
        attachmentMode: agent.runtimeConfig?.attachmentMode || "parsed",
      };
    })
  );
  return response.status(200).json({ agents: safeAgents, defaultAgentId });
}

function apiAgentEndpoints(app) {
  if (!app) return;
  app.get("/v1/agents", [validApiKey], listAgents);
  app.post(
    "/v1/workspace/:slug/agent-runs",
    [validApiKey, loadApiConversation],
    createRun
  );
  app.post(
    "/v1/workspace/:slug/thread/:threadSlug/agent-runs",
    [validApiKey, loadApiConversation],
    createRun
  );
  app.get("/v1/agent-runs/:runId/events", [validApiKey], streamEvents);
  app.get("/v1/agent-runs/:runId/snapshot", [validApiKey], snapshotRun);
  app.post("/v1/agent-runs/:runId/commands", [validApiKey], commandRun);
}

module.exports = { apiAgentEndpoints, listAgents, loadApiConversation };
