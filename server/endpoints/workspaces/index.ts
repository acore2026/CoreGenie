const { workspaceParsedFilesEndpoints } = require("../workspacesParsedFiles");
const { registerWorkspaceCrudEndpoints } = require("./crud.ts");
const { registerWorkspaceDocumentEndpoints } = require("./documents.ts");
const { registerWorkspaceChatEndpoints } = require("./chats.ts");
const { registerWorkspaceAssetEndpoints } = require("./assets.ts");

function workspaceEndpoints(app: Record<string, any>): void {
  if (!app) return;
  const responseCache = new Map();

  registerWorkspaceCrudEndpoints(app);
  registerWorkspaceDocumentEndpoints(app);
  registerWorkspaceChatEndpoints(app);
  registerWorkspaceAssetEndpoints(app, responseCache);

  // Parsed Files in separate endpoint just to keep the workspace endpoints clean
  workspaceParsedFilesEndpoints(app);
}

module.exports = { workspaceEndpoints };
