const { setDataSigner } = require("../middleware/setDataSigner");
const { verifyPayloadIntegrity } = require("../middleware/verifyIntegrity");
const { loadGithubRepo } = require("../utils/extensions/RepoLoader/GithubRepo");
const RepoLoader = require("../utils/extensions/RepoLoader/GithubRepo/RepoLoader");
const { reqBody } = require("../utils/http");
const RESYNC_METHODS = require("./resync");

function extensions(app) {
  if (!app) return;

  app.post(
    "/ext/resync-source-document",
    [verifyPayloadIntegrity, setDataSigner],
    async function (request, response) {
      try {
        const { type, options } = reqBody(request);
        if (!RESYNC_METHODS.hasOwnProperty(type))
          throw new Error(`Type "${type}" is not a valid type to sync.`);
        return await RESYNC_METHODS[type](options, response);
      } catch (e) {
        console.error(e);
        response.status(200).json({
          success: false,
          content: null,
          reason: e.message || "A processing error occurred.",
        });
      }
      return;
    }
  );

  app.post(
    "/ext/github-repo",
    [verifyPayloadIntegrity, setDataSigner],
    async function (request, response) {
      try {
        const { success, reason, data } = await loadGithubRepo(
          reqBody(request),
          response
        );
        response.status(200).json({
          success,
          reason,
          data,
        });
      } catch (e) {
        console.error(e);
        response.status(200).json({
          success: false,
          reason: e.message || "A processing error occurred.",
          data: {},
        });
      }
      return;
    }
  );

  // gets all branches for a specific repo
  app.post(
    "/ext/github-repo/branches",
    [verifyPayloadIntegrity],
    async function (request, response) {
      try {
        const allBranches = await new RepoLoader(
          reqBody(request)
        ).getRepoBranches();
        response.status(200).json({
          success: true,
          reason: null,
          data: {
            branches: allBranches,
          },
        });
      } catch (e) {
        console.error(e);
        response.status(400).json({
          success: false,
          reason: e.message,
          data: {
            branches: [],
          },
        });
      }
      return;
    }
  );
}

module.exports = extensions;
