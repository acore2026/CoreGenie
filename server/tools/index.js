const { ResourceRegistry } = require("../resources/registry");
const { toLangChainTool } = require("./descriptor");
const sandbox = require("./sandbox");
const filesystem = require("./filesystem");
const memory = require("./memory");
const web = require("./web");
const rag = require("./rag");
const userInput = require("./userInput");
const skills = require("./skills");
const vision = require("./vision");
const knowledge = require("./knowledge");
const threeGpp = require("./threeGpp");

const toolRegistry = new ResourceRegistry("tool");
for (const descriptor of [
  ...Object.values(sandbox),
  ...Object.values(filesystem),
  ...Object.values(memory),
  web.webSearch,
  web.webFetch,
  rag.ragSearch,
  userInput.askUser,
  skills.activateSkill,
  skills.readSkillResource,
  vision.inspectImage,
  knowledge.publishReport,
  threeGpp.resolveMeeting,
]) {
  toolRegistry.register(descriptor);
}

function legacySelectionAllows(allowed, descriptor) {
  if (!allowed) return true;
  if (allowed.has(descriptor.id) || allowed.has(descriptor.name)) return true;
  if (
    descriptor.id.startsWith("filesystem.") &&
    allowed.has("filesystem-agent")
  )
    return true;
  if (descriptor.id.startsWith("rag.") && allowed.has("rag-memory"))
    return true;
  if (descriptor.id.startsWith("memory.") && allowed.has("memory")) return true;
  if (
    descriptor.id.startsWith("web.") &&
    (allowed.has("web-browsing") || allowed.has("web-scraping"))
  )
    return true;
  return false;
}

function taskSelectionAllows(allowed, descriptor, strictSelection = false) {
  if (!strictSelection && descriptor.id.startsWith("skill.")) return true;
  return legacySelectionAllows(allowed, descriptor);
}

async function toolsForAgent(
  agent,
  context,
  {
    allowActions = true,
    availableAgents = [],
    excludeToolIds = [],
    strictSelection = false,
  } = {}
) {
  const allowed = Array.isArray(agent?.tools) ? new Set(agent.tools) : null;
  const excluded = new Set(excludeToolIds);
  const tools = toolRegistry
    .list()
    .filter((descriptor) => !excluded.has(descriptor.id))
    .filter((descriptor) =>
      taskSelectionAllows(allowed, descriptor, strictSelection)
    )
    .filter((descriptor) => allowActions || descriptor.action === false)
    .map((descriptor) => toLangChainTool(descriptor, context));
  if (
    allowActions &&
    availableAgents.length > 0 &&
    legacySelectionAllows(allowed, { id: "agent.call", name: "call_agent" })
  ) {
    const { createSubagentTool } = require("./subagent");
    tools.push(createSubagentTool(context, availableAgents));
  }
  if (allowActions) {
    const { activeMcpTools } = require("./mcp");
    tools.push(...(await activeMcpTools(context, allowed)));
  }
  return tools;
}

module.exports = {
  legacySelectionAllows,
  taskSelectionAllows,
  toolRegistry,
  toolsForAgent,
  ...require("./descriptor"),
};
