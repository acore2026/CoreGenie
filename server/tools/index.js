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
  rag.knowledgeSearch,
  userInput.askUser,
  skills.activateSkill,
  skills.readSkillResource,
  vision.inspectImage,
  knowledge.ingestDocuments,
  knowledge.publishReport,
  threeGpp.resolveMeeting,
  threeGpp.convertMarkdown,
]) {
  toolRegistry.register(descriptor);
}

const TOOL_ID_ALIASES = Object.freeze({
  "rag.search": "knowledge.search",
  rag_search: "knowledge.search",
  "filesystem-search": "filesystem.search",
  "filesystem-search-files": "filesystem.search",
  filesystem_search_files: "filesystem.search",
  "filesystem-read": "filesystem.read",
  "filesystem-read-text-file": "filesystem.read",
  "filesystem-read-multiple-files": "filesystem.read",
  filesystem_read_text_file: "filesystem.read",
  filesystem_read_multiple_files: "filesystem.read",
  "filesystem-list": "filesystem.list",
  "filesystem-list-directory": "filesystem.list",
  filesystem_list_directory: "filesystem.list",
  "filesystem-write": "filesystem.write",
  "filesystem-edit-file": "filesystem.write",
  filesystem_edit_file: "filesystem.write",
});

function normalizeToolId(toolId) {
  const value = String(toolId || "").trim();
  const normalized = TOOL_ID_ALIASES[value] || value;
  return (
    toolRegistry
      .list()
      .find(
        (descriptor) =>
          descriptor.id === normalized || descriptor.name === normalized
      )?.id || normalized
  );
}

function normalizedSelection(allowed) {
  if (!allowed) return null;
  return new Set([...allowed].map(normalizeToolId));
}

function legacySelectionAllows(allowed, descriptor) {
  if (!allowed) return true;
  const normalized = normalizedSelection(allowed);
  if (
    normalized.has(normalizeToolId(descriptor.id)) ||
    normalized.has(normalizeToolId(descriptor.name))
  )
    return true;
  if (
    descriptor.id.startsWith("filesystem.") &&
    normalized.has("filesystem-agent")
  )
    return true;
  if (descriptor.id === "knowledge.search" && normalized.has("rag-memory"))
    return true;
  if (descriptor.id.startsWith("memory.") && normalized.has("memory"))
    return true;
  if (
    descriptor.id.startsWith("web.") &&
    (normalized.has("web-browsing") || normalized.has("web-scraping"))
  )
    return true;
  return false;
}

function taskSelectionAllows(allowed, descriptor, strictSelection = false) {
  if (!strictSelection && descriptor.id.startsWith("skill.")) return true;
  return legacySelectionAllows(allowed, descriptor);
}

function visibleToolDescriptorsForAgent(
  agent,
  { allowActions = true, excludeToolIds = [], strictSelection = false } = {}
) {
  const allowed = Array.isArray(agent?.tools) ? new Set(agent.tools) : null;
  const excluded = new Set(excludeToolIds.map(normalizeToolId));
  return toolRegistry
    .list()
    .filter((descriptor) => !excluded.has(descriptor.id))
    .filter((descriptor) =>
      taskSelectionAllows(allowed, descriptor, strictSelection)
    )
    .filter((descriptor) => allowActions || descriptor.action === false);
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
  const tools = visibleToolDescriptorsForAgent(agent, {
    allowActions,
    excludeToolIds,
    strictSelection,
  }).map((descriptor) => toLangChainTool(descriptor, context));
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
  normalizeToolId,
  taskSelectionAllows,
  toolRegistry,
  toolsForAgent,
  visibleToolDescriptorsForAgent,
  ...require("./descriptor"),
};
