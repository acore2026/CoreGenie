const { Workspace } = require("../../models/workspace");
const { WorkspaceThread } = require("../../models/workspaceThread");
const { userFromSession, multiUserMode } = require("../http");

// Will pre-validate and set the workspace for a request if the slug is provided in the URL path.
async function validWorkspaceSlug(request, response, next) {
  const { slug } = request.params;
  const user = await userFromSession(request, response);
  const workspace = multiUserMode(response)
    ? await Workspace.getWithUser(user, { slug })
    : await Workspace.get({ slug });

  if (!workspace) {
    response.status(404).send("Workspace does not exist.");
    return;
  }

  response.locals.workspace = workspace;
  next();
}

// Will pre-validate and set the workspace AND a thread for a request if the slugs are provided in the URL path.
async function validWorkspaceAndThreadSlug(request, response, next) {
  const { slug, threadSlug } = request.params;
  const user = await userFromSession(request, response);
  const workspace = multiUserMode(response)
    ? await Workspace.getWithUser(user, { slug })
    : await Workspace.get({ slug });

  if (!workspace) {
    response.status(404).send("Workspace does not exist.");
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
  response.locals.thread = thread;
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
};
