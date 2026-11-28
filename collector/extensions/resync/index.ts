import type { ExtensionContext } from "../../types.js";
import { getLinkText } from "../../processLink/index.js";

async function resyncLink({ link }: { link?: string }) {
  if (!link) throw new Error("Invalid link provided");
  try {
    const { success, content = null, reason } = await getLinkText(link);
    if (!success) throw new Error(`Failed to sync link content. ${reason}`);
    return { success, content };
  } catch (e) {
    console.error(e);
    return { success: false, content: null };
  }
}

async function resyncGithub(
  { chunkSource }: { chunkSource?: string },
  responseContext: ExtensionContext
) {
  if (!chunkSource) throw new Error("Invalid source property provided");
  try {
    const source =
      responseContext.locals.encryptionWorker.expandPayload(chunkSource);
    const { fetchGithubFile } = await import(
      "../../utils/extensions/RepoLoader/GithubRepo/index.js"
    );
    const { success, reason, content } = await fetchGithubFile({
      repoUrl: `https:${source.pathname}`,
      branch: source.searchParams.get("branch"),
      accessToken: source.searchParams.get("pat"),
      sourceFilePath: source.searchParams.get("path") ?? "",
    });

    if (!success)
      throw new Error(`Failed to sync GitHub file content. ${reason}`);
    return { success, content };
  } catch (e) {
    console.error(e);
    return { success: false, content: null };
  }
}

export { resyncLink, resyncGithub };
