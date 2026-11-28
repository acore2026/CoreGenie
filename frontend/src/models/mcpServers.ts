import { api, errorMessage } from "@/utils/api";

export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, { type?: string | string[] }>;
    required?: string[];
  };
}

export interface MCPServerInfo {
  name: string;
  running: boolean;
  config?: {
    command?: string;
    args?: string[];
    anythingllm?: { suppressedTools?: string[] };
  };
  tools: MCPToolInfo[];
  error: string | null;
  process: { pid: number; cmd: string } | null;
}

export interface MCPServersResponse {
  success: boolean;
  error: string | null;
  servers: MCPServerInfo[];
}

const MCPServers = {
  forceReload: async (): Promise<MCPServersResponse> => {
    try {
      return await api.get<MCPServersResponse>("/mcp-servers/force-reload");
    } catch (e) {
      return { servers: [], success: false, error: errorMessage(e) };
    }
  },

  listServers: async (): Promise<MCPServersResponse> => {
    try {
      return await api.get<MCPServersResponse>("/mcp-servers/list");
    } catch (e) {
      return { success: false, error: errorMessage(e), servers: [] };
    }
  },

  toggleServer: async (
    name: string
  ): Promise<{ success: boolean; error: string | null }> => {
    try {
      return await api.post<{ success: boolean; error: string | null }>(
        "/mcp-servers/toggle",
        { name }
      );
    } catch (e) {
      return { success: false, error: errorMessage(e) };
    }
  },

  deleteServer: async (
    name: string
  ): Promise<{ success: boolean; error: string | null }> => {
    try {
      return await api.post<{ success: boolean; error: string | null }>(
        "/mcp-servers/delete",
        { name }
      );
    } catch (e) {
      return { success: false, error: errorMessage(e) };
    }
  },

  toggleTool: async (
    serverName: string,
    toolName: string,
    enabled: boolean
  ): Promise<{
    success: boolean;
    error: string | null;
    suppressedTools: string[];
  }> => {
    try {
      return await api.post<{
        success: boolean;
        error: string | null;
        suppressedTools: string[];
      }>("/mcp-servers/toggle-tool", { serverName, toolName, enabled });
    } catch (e) {
      return {
        success: false,
        error: errorMessage(e),
        suppressedTools: [],
      };
    }
  },
};

export default MCPServers;
