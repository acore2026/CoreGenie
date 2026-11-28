import type { FileInput } from "../../types.js";
import { randomUUID as v4 } from "node:crypto";
import { EPub } from "epub2";
import { convert as htmlToText } from "html-to-text";
import { tokenizeString } from "../../utils/tokenizer/index.js";
import {
  createdDate,
  trashFile,
  writeToServerDocuments,
} from "../../utils/files/index.js";
import slugify from "slugify";

async function extractEpubText(fullFilePath: string) {
  const epub = await EPub.createAsync(fullFilePath);
  const chapters = await Promise.all(
    (epub.flow || []).map(async (chapter: { id?: string }) => {
      if (!chapter?.id) return "";
      const html = await epub.getChapterRawAsync(chapter.id);
      if (!html) return "";
      return htmlToText(html, { wordwrap: false });
    })
  );
  return chapters.filter(Boolean).join("\n\n");
}

async function asEPub({
  fullFilePath = "",
  filename = "",
  options = {},
  metadata = {},
}: FileInput) {
  let content = "";
  try {
    content = await extractEpubText(fullFilePath);
  } catch (err) {
    console.error("Could not read epub file!", err);
  }

  if (!content?.length) {
    console.error(`Resulting text content was empty for ${filename}.`);
    if (!options.absolutePath) trashFile(fullFilePath);
    return {
      success: false,
      reason: `No text content found in ${filename}.`,
      documents: [],
    };
  }

  console.log(`-- Working ${filename} --`);
  const data = {
    id: v4(),
    url: "file://" + fullFilePath,
    title: metadata.title || filename,
    docAuthor: metadata.docAuthor || "Unknown",
    description: metadata.description || "Unknown",
    docSource: metadata.docSource || "epub file uploaded by the user.",
    chunkSource: metadata.chunkSource || "",
    published: createdDate(fullFilePath),
    wordCount: content.split(" ").length,
    pageContent: content,
    token_count_estimate: tokenizeString(content),
  };

  const document = writeToServerDocuments({
    data,
    filename: `${slugify(filename)}-${data.id}`,
    options: { parseOnly: options.parseOnly },
  });
  if (!options.absolutePath) trashFile(fullFilePath);
  console.log(`[SUCCESS]: ${filename} converted & ready for embedding.\n`);
  return { success: true, reason: null, documents: [document] };
}

export default asEPub;
