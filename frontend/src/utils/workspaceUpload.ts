export const WORKSPACE_UPLOAD_COMPLETE = "workspaceUploadComplete";
export const WORKSPACE_FILES_CHANGED = "workspaceFilesChanged";

export function appendWorkspacePaths(input: string, paths: string[]) {
  return `${input}${input && !input.endsWith("\n") ? "\n" : ""}${paths.join("\n")}`;
}
