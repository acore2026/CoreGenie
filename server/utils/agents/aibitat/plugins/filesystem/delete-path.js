const filesystem = require("./lib.js");
const path = require("path");

module.exports.FilesystemDeletePath = {
  name: "filesystem-delete-path",
  plugin: function () {
    return {
      name: "filesystem-delete-path",
      setup(aibitat) {
        aibitat.function({
          super: aibitat,
          name: this.name,
          description:
            "Delete a file or directory from the current workspace. This cannot access or delete anything outside the authenticated workspace, and the workspace root itself can never be deleted. Empty directories can be deleted normally. Set recursive to true only when the user wants a non-empty directory and everything inside it permanently deleted.",
          examples: [
            {
              prompt: "Delete the old report file",
              call: JSON.stringify({ path: "reports/old-report.txt" }),
            },
            {
              prompt: "Delete the obsolete build folder and all its contents",
              call: JSON.stringify({ path: "build-old", recursive: true }),
            },
          ],
          parameters: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: {
              path: {
                type: "string",
                description:
                  "The workspace-relative path of the file or directory to delete.",
              },
              recursive: {
                type: "boolean",
                default: false,
                description:
                  "Required for non-empty directories. Permanently deletes every item below the directory.",
              },
            },
            required: ["path"],
            additionalProperties: false,
          },
          handler: async function ({
            path: targetPath = "",
            recursive = false,
          }) {
            try {
              this.super.handlerProps.log(
                "Using the filesystem-delete-path tool."
              );
              const workspaceFilesystem = filesystem.forInvocation(
                this.super.handlerProps.invocation
              );
              // Validate before requesting approval so an out-of-scope path is
              // rejected without presenting a misleading permission prompt.
              const validPath =
                await workspaceFilesystem.validatePath(targetPath);
              const allowedRoots = workspaceFilesystem
                .getAllowedDirectories()
                .map((root) => path.resolve(root));
              if (allowedRoots.includes(path.resolve(validPath)))
                throw new Error("The workspace root cannot be deleted.");

              this.super.introspect(
                `${this.caller}: Deleting ${targetPath}${recursive ? " recursively" : ""}`
              );

              if (this.super.requestToolApproval) {
                const approval = await this.super.requestToolApproval({
                  skillName: this.name,
                  payload: { path: targetPath, recursive },
                  description: recursive
                    ? "Permanently delete a directory and all of its contents"
                    : "Delete a workspace file or empty directory",
                });
                if (!approval.approved) {
                  this.super.introspect(
                    `${this.caller}: User rejected the ${this.name} request.`
                  );
                  return approval.message;
                }
              }

              const deleted = await workspaceFilesystem.deletePath(targetPath, {
                recursive: recursive === true,
              });
              this.super.introspect(`Successfully deleted ${targetPath}`);
              return `Successfully deleted ${deleted.type} ${targetPath}`;
            } catch (error) {
              this.super.handlerProps.log(
                `filesystem-delete-path error: ${error.message}`
              );
              this.super.introspect(`Error: ${error.message}`);
              return `Error deleting path: ${error.message}`;
            }
          },
        });
      },
    };
  },
};
