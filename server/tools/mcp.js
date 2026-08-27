const { loadMcpTools } = require("@langchain/mcp-adapters");
const MCPCompatibilityLayer = require("../utils/MCP");
const { defineTool, toLangChainTool } = require("./descriptor");

async function activeMcpTools(context, allowed = null) {
  const hypervisor = new MCPCompatibilityLayer();
  await hypervisor.bootMCPServers();
  const tools = [];
  for (const [serverName, client] of Object.entries(hypervisor.mcps)) {
    if (allowed && !allowed.has(`@@mcp_${serverName}`)) continue;
    const suppressed = new Set(hypervisor.getSuppressedTools(serverName));
    for (const mcpTool of await loadMcpTools(serverName, client)) {
      const baseName = mcpTool.name.replace(`${serverName}__`, "");
      if (suppressed.has(baseName) || suppressed.has(mcpTool.name)) continue;
      tools.push(
        toLangChainTool(
          defineTool({
            id: `mcp.${serverName}.${baseName}`,
            name: mcpTool.name,
            description:
              mcpTool.description ||
              `Run ${baseName} on MCP server ${serverName}.`,
            schema: mcpTool.schema,
            execute: (args) => mcpTool.invoke(args),
          }),
          context
        )
      );
    }
  }
  return tools;
}

module.exports = { activeMcpTools };
