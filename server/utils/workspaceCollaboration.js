// Only named conversations in explicitly collaborative public workspaces
// are jointly editable. Personal default conversations are not shared.
function canCollaborateOnThread(user, workspace, thread) {
  return Boolean(
    user?.id &&
    workspace?.accessMode === "public_collaborative" &&
    thread?.id &&
    thread.workspace_id === workspace.id
  );
}

module.exports = { canCollaborateOnThread };
