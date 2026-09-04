const { Workspace } = require("../../models/workspace");
const { WorkspaceThread } = require("../../models/workspaceThread");
const { userFromSession, multiUserMode } = require("../http");

// Will pre-validate and set the workspace for a request if the slug is provided in the URL path.
async function validWorkspaceSlug(request, response, next) {
  const { slug } = request.params;
  const user = await userFromSession(request, response);
  const workspace = multiUserMode(response)
    ? await Workspace.getAccessibleWithUser(user, { slug })
    : await Workspace.get({ slug });

  if (!workspace) {
    response.status(404).send("Workspace does not exist.");
    return;
  }

  if (
    multiUserMode(response) &&
    workspace.viewerAccess === "public_readonly" &&
    !readonlyWorkspaceRequestAllowed(request)
  ) {
    response.status(403).json({
      error: "该工作区当前为只读公开，只有正式成员可以执行此操作。",
    });
    return;
  }

  response.locals.workspace = workspace;
  response.locals.workspaceAccess =
    workspace.viewerAccess || (multiUserMode(response) ? "member" : "manager");
  next();
}

// Will pre-validate and set the workspace AND a thread for a request if the slugs are provided in the URL path.
async function validWorkspaceAndThreadSlug(request, response, next) {
  const { slug, threadSlug } = request.params;
  const user = await userFromSession(request, response);
  const workspace = multiUserMode(response)
    ? await Workspace.getAccessibleWithUser(user, { slug })
    : await Workspace.get({ slug });

  if (!workspace) {
    response.status(404).send("Workspace does not exist.");
    return;
  }

  if (
    multiUserMode(response) &&
    workspace.viewerAccess === "public_readonly" &&
    !readonlyWorkspaceRequestAllowed(request)
  ) {
    response.status(403).json({
      error: "该工作区当前为只读公开，只有正式成员可以执行此操作。",
    });
    return;
  }

  const thread = await WorkspaceThread.get({
    slug: threadSlug,
    workspace_id: workspace.id,
  });
  if (!thread) {
    response.status(404).send("Workspace thread does not exist.");
    return;
  }

  response.locals.workspace = workspace;
  response.locals.workspaceAccess =
    workspace.viewerAccess || (multiUserMode(response) ? "member" : "manager");
  response.locals.thread = thread;
  next();
}

function readonlyWorkspaceRequestAllowed(request) {
  if (request.method !== "GET") return false;
  const path = String(request.path || request.originalUrl || "");
  return (
    /\/workspace\/[^/]+\/pfp\/?$/.test(path) ||
    /\/workspace\/[^/]+\/threads\/?$/.test(path) ||
    /\/workspace\/[^/]+\/thread\/[^/]+\/chats\/?$/.test(path)
  );
}

function requireWorkspaceParticipant(_request, response, next) {
  if (response.locals.workspaceAccess === "public_readonly")
    return response.status(403).json({
      error: "只有工作区成员可以查看和管理计划任务。",
    });
  next();
}

async function canManageWorkspaceThread(request, response) {
  if (!multiUserMode(response)) return true;
  const user = await userFromSession(request, response);
  const thread = response.locals.thread;
  return (
    thread?.user_id === user?.id || ["admin", "manager"].includes(user?.role)
  );
}

async function manageWorkspaceThread(request, response, next) {
  if (await canManageWorkspaceThread(request, response)) {
    next();
    return;
  }

  response.status(403).json({
    error: "You do not have permission to modify this workspace thread.",
  });
}

module.exports = {
  validWorkspaceSlug,
  validWorkspaceAndThreadSlug,
  canManageWorkspaceThread,
  manageWorkspaceThread,
  requireWorkspaceParticipant,
};
