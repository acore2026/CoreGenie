const { SystemSettings } = require("../models/systemSettings");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  validExportTypes,
  sendChatHistoryFile,
} = require("../utils/chats/exportChatToFile");
const { multiUserMode, reqBody, userFromSession } = require("../utils/http");

function utilEndpoints(app) {
  if (!app) return;

  app.get("/utils/metrics", async (_, response) => {
    try {
      const metrics = {
        online: true,
        version: getGitVersion(),
        mode: (await SystemSettings.isMultiUserMode())
          ? "multi-user"
          : "single-user",
        vectorDB: process.env.VECTOR_DB || "lancedb",
        storage: await getDiskStorage(),
        appVersion: getDeploymentVersion(),
      };
      response.status(200).json(metrics);
    } catch (e) {
      console.error(e);
      response.sendStatus(500).end();
    }
  });

  app.post(
    "/export-chat/:type",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { type } = request.params;
        if (!validExportTypes.includes(type))
          return response.sendStatus(400).end();

        const { workspaceSlug, threadSlug } = reqBody(request);
        const { Workspace } = require("../models/workspace");
        const { WorkspaceThread } = require("../models/workspaceThread");
        const { WorkspaceChats } = require("../models/workspaceChats");

        const user = await userFromSession(request, response);
        const workspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug: String(workspaceSlug) })
          : await Workspace.get({ slug: String(workspaceSlug) });
        if (!workspace) return response.sendStatus(404).end();

        let thread;
        if (threadSlug) {
          thread = await WorkspaceThread.get({
            slug: String(threadSlug),
            user_id: user?.id || null,
          });
          if (!thread) return response.sendStatus(404).end();
        }

        const chats = await WorkspaceChats.where({
          workspaceId: workspace.id,
          user_id: user?.id || null,
          thread_id: thread?.id || null,
        });
        if (chats.length === 0) return response.sendStatus(400).end();

        const meta = {
          workspaceName: workspace.name,
          threadName: thread?.name || null,
        };

        return sendChatHistoryFile(response, chats, meta, type);
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );
}

function getGitVersion() {
  if (process.env.ANYTHING_LLM_RUNTIME === "docker") return "--";
  try {
    return require("child_process")
      .execSync("git rev-parse HEAD")
      .toString()
      .trim();
  } catch (e) {
    console.error("getGitVersion", e.message);
    return "--";
  }
}

function byteToGigaByte(n) {
  return n / Math.pow(10, 9);
}

async function getDiskStorage() {
  try {
    const checkDiskSpace = require("check-disk-space").default;
    const { free, size } = await checkDiskSpace("/");
    return {
      current: Math.floor(byteToGigaByte(free)),
      capacity: Math.floor(byteToGigaByte(size)),
    };
  } catch {
    return {
      current: null,
      capacity: null,
    };
  }
}

/**
 * Returns the deployment version.
 * - Dev: reads from package.json
 * - Prod: reads from ENV
 * expected format: major.minor.patch
 * @returns {string|null} The deployment version.
 */
function getDeploymentVersion() {
  if (process.env.NODE_ENV === "development")
    return require("../../package.json").version;
  if (process.env.DEPLOYMENT_VERSION) return process.env.DEPLOYMENT_VERSION;
  return null;
}

/**
 * Returns the user agent for the AnythingLLM deployment.
 * @returns {string} The user agent.
 */
function getAnythingLLMUserAgent() {
  const version = getDeploymentVersion() || "unknown";
  return `AnythingLLM/${version}`;
}

module.exports = {
  utilEndpoints,
  getGitVersion,
  getAnythingLLMUserAgent,
  getDeploymentVersion,
};
