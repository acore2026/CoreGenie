import { parseContentType } from "../../processLink/helpers/index.js";
import {
  WATCH_DIRECTORY,
  ACCEPTED_MIMES,
  SUPPORTED_FILETYPE_CONVERTERS,
} from "../constants.js";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { validURL } from "../url/index.js";
import slugify from "slugify";

// Add a custom slugify extension for slashing to handle URLs with paths.
slugify.extend({ "/": "-" });

/**
 * Maps a MIME type to the preferred file extension using ACCEPTED_MIMES.
 * Returns null if the MIME type is not recognized or if there are no possible extensions.
 * @param {string} mimeType - The MIME type to resolve (e.g., "application/pdf")
 * @returns {string|null} - The file extension (e.g., ".pdf") or null
 */
function mimeToExtension(mimeType?: string | null) {
  if (!mimeType || !ACCEPTED_MIMES.hasOwnProperty(mimeType)) return null;
  const possibleExtensions = ACCEPTED_MIMES[mimeType] ?? [];
  if (possibleExtensions.length === 0) return null;
  return possibleExtensions[0];
}

function buildFilenameWithExtension(
  filename: string,
  contentType: string | null
) {
  const extension = path.extname(filename).toLowerCase();
  if (Object.hasOwn(SUPPORTED_FILETYPE_CONVERTERS, extension)) return filename;
  const inferred = mimeToExtension(parseContentType(contentType));
  return inferred ? filename + inferred : filename;
}

/**
 * Download a file to the hotdir
 * @param {string} url - The URL of the file to download
 * @param {number} maxTimeout - The maximum timeout in milliseconds
 * @returns {Promise<{success: boolean, fileLocation: string|null, reason: string|null}>} - The path to the downloaded file
 */
async function downloadURIToFile(url: string, maxTimeout = 10_000) {
  if (!url || typeof url !== "string" || !validURL(url))
    return { success: false, reason: "Not a valid URL.", fileLocation: null };

  try {
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
      console.error(
        `Timeout ${maxTimeout}ms reached while downloading file for URL:`,
        url.toString()
      );
    }, maxTimeout);

    const res = await fetch(url, { signal: abortController.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res;
      })
      .finally(() => clearTimeout(timeout));

    const urlObj = new URL(url);
    const sluggedPath = slugify(urlObj.pathname, { lower: true });
    const filename = buildFilenameWithExtension(
      `${urlObj.hostname}-${sluggedPath}`,
      res.headers.get("Content-Type")
    );

    const localFilePath = path.join(WATCH_DIRECTORY, filename);
    if (!res.body) throw new Error("Download returned no content.");
    const writeStream = fs.createWriteStream(localFilePath);
    await pipeline(res.body, writeStream);

    console.log(`[SUCCESS]: File ${localFilePath} downloaded to hotdir.`);
    return { success: true, fileLocation: localFilePath, reason: null };
  } catch (error) {
    console.error(`Error writing to hotdir: ${error} for URL: ${url}`);
    return {
      success: false,
      reason: error instanceof Error ? error.message : String(error),
      fileLocation: null,
    };
  }
}

export { downloadURIToFile, mimeToExtension, buildFilenameWithExtension };
