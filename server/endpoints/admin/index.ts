const { registerAdminUserAndInviteEndpoints } = require("./usersAndInvites.ts");
const { registerAdminWorkspaceEndpoints } = require("./workspaces.ts");
const {
  registerAdminPreferencesAndKeysEndpoints,
} = require("./preferencesAndKeys.ts");

function adminEndpoints(app: Record<string, any>): void {
  if (!app) return;
  registerAdminUserAndInviteEndpoints(app);
  registerAdminWorkspaceEndpoints(app);
  registerAdminPreferencesAndKeysEndpoints(app);
}

module.exports = { adminEndpoints };
