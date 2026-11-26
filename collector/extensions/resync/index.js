const { getLinkText } = require("../../processLink");

/**
 * Fetches the content of a raw link. Returns the content as a text string of the link in question.
 * @param {object} data - metadata from document (eg: link)
 * @param {import("../../middleware/setDataSigner").ResponseWithSigner} response
 */
async function resyncLink({ link }, response) {
  if (!link) throw new Error("Invalid link provided");
  try {
    const { success, content = null, reason } = await getLinkText(link);
    if (!success) throw new Error(`Failed to sync link content. ${reason}`);
    response.status(200).json({ success, content });
  } catch (e) {
    console.error(e);
    response.status(200).json({
      success: false,
      content: null,
    });
  }
}

async function resyncGithub({ chunkSource }, response) {
  if (!chunkSource) throw new Error("Invalid source property provided");
  try {
    // Github file data is `payload` encrypted (might contain PAT). So we need to expand its
    // encrypted payload back into query params so we can reFetch the page with same access token/params.
    const source = response.locals.encryptionWorker.expandPayload(chunkSource);
    const {
      fetchGithubFile,
    } = require("../../utils/extensions/RepoLoader/GithubRepo");
    const { success, reason, content } = await fetchGithubFile({
      repoUrl: `https:${source.pathname}`, // need to add back the real protocol
      branch: source.searchParams.get("branch"),
      accessToken: source.searchParams.get("pat"),
      sourceFilePath: source.searchParams.get("path"),
    });

    if (!success)
      throw new Error(`Failed to sync GitHub file content. ${reason}`);
    response.status(200).json({ success, content });
  } catch (e) {
    console.error(e);
    response.status(200).json({
      success: false,
      content: null,
    });
  }
}

module.exports = { link: resyncLink, github: resyncGithub };
